/**
 * use-follow.ts — Real API-backed follow system
 *
 * Module-level state so all component instances share a single source of truth.
 * Fetches the initial following-IDs list once from the backend, then manages
 * state locally with optimistic updates and real API sync.
 */

import { useState, useEffect } from "react";
import {
  getFollowingIdsApi,
  followUserApi,
  unfollowUserApi,
} from "@/lib/api-client";

// ─── Module-level state ───────────────────────────────────────────────────────

let followingIds = new Set<string>();
let pendingIds = new Set<string>();     // in-flight requests (prevent double-tap)
let initialized = false;
let initializing = false;

type Listener = () => void;
const listeners = new Set<Listener>();

function notifyAll() {
  listeners.forEach(l => l());
}

/** Load the full following-IDs list from the backend once per session. */
async function initFollowState() {
  if (initialized || initializing) return;
  initializing = true;
  try {
    const ids = await getFollowingIdsApi();
    followingIds = new Set(ids);
    initialized = true;
    notifyAll();
  } catch (err) {
    console.warn("[use-follow] Failed to initialize follow state:", err);
    initialized = true; // don't retry on error — treat as empty
  } finally {
    initializing = false;
  }
}

/** Call this to force a re-sync from the backend (e.g. after login). */
export function resetFollowState() {
  followingIds = new Set();
  initialized = false;
  initializing = false;
  notifyAll();
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useFollow() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    // Subscribe to state changes
    const handler = () => forceUpdate(n => n + 1);
    listeners.add(handler);

    // Initialize on first mount
    if (!initialized) {
      initFollowState();
    }

    return () => {
      listeners.delete(handler);
    };
  }, []);

  /** Returns true if the current user follows userId. */
  function isFollowing(userId: string): boolean {
    return followingIds.has(userId);
  }

  /** Returns true if a follow/unfollow request is in-flight for userId. */
  function isPending(userId: string): boolean {
    return pendingIds.has(userId);
  }

  /**
   * Toggle follow / unfollow for a user.
   *
   * - Optimistic update: local state changes immediately.
   * - API sync: real request fires in background.
   * - Rollback: if the API call fails, state is reverted.
   * - De-duplicated: no-op if a request is already in-flight.
   */
  async function toggle(userId: string): Promise<void> {
    if (pendingIds.has(userId)) return; // prevent double-tap

    const wasFollowing = followingIds.has(userId);

    // Optimistic update
    pendingIds.add(userId);
    if (wasFollowing) {
      followingIds.delete(userId);
    } else {
      followingIds.add(userId);
    }
    notifyAll();

    try {
      if (wasFollowing) {
        await unfollowUserApi(userId);
      } else {
        await followUserApi(userId);
      }
    } catch (err) {
      // Rollback optimistic update
      console.error("[use-follow] toggle failed, rolling back:", err);
      if (wasFollowing) {
        followingIds.add(userId);
      } else {
        followingIds.delete(userId);
      }
      notifyAll();
    } finally {
      pendingIds.delete(userId);
      notifyAll();
    }
  }

  return { isFollowing, isPending, toggle, initialized };
}
