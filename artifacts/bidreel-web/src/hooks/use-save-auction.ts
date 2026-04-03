/**
 * use-save-auction.ts — Real API-backed save/bookmark system
 *
 * Module-level state so all component instances share a single source of truth.
 * Fetches the initial saved-IDs list once from the backend, then manages
 * state locally with optimistic updates and real API sync.
 */

import { useState, useEffect } from "react";
import { getSavedIdsApi, saveAuctionApi, unsaveAuctionApi } from "@/lib/api-client";

// ─── Module-level state ───────────────────────────────────────────────────────

let savedIds = new Set<string>();
let pendingIds = new Set<string>();
let initialized = false;
let initializing = false;

type Listener = () => void;
const listeners = new Set<Listener>();

function notifyAll() {
  listeners.forEach(l => l());
}

/** Load the full saved-IDs list from the backend once per session. */
async function initSaveState() {
  if (initialized || initializing) return;
  initializing = true;
  try {
    const ids = await getSavedIdsApi();
    savedIds = new Set(ids);
    initialized = true;
    notifyAll();
  } catch (err) {
    console.warn("[use-save-auction] Failed to initialize save state:", err);
    initialized = true;
  } finally {
    initializing = false;
  }
}

/** Call this to force a re-sync from the backend (e.g. after login). */
export function resetSaveState() {
  savedIds = new Set();
  initialized = false;
  initializing = false;
  notifyAll();
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSaveAuction() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const handler = () => forceUpdate(n => n + 1);
    listeners.add(handler);

    if (!initialized) {
      initSaveState();
    }

    return () => {
      listeners.delete(handler);
    };
  }, []);

  /** Returns true if the current user has saved auctionId. */
  function isSaved(auctionId: string): boolean {
    return savedIds.has(auctionId);
  }

  /**
   * Toggle save / unsave for an auction.
   *
   * - Optimistic update: local state changes immediately.
   * - API sync: real request fires in background.
   * - Rollback: if the API call fails, state is reverted.
   * - De-duplicated: no-op if a request is already in-flight.
   */
  async function toggle(auctionId: string): Promise<void> {
    if (pendingIds.has(auctionId)) return;

    const wasSaved = savedIds.has(auctionId);

    pendingIds.add(auctionId);
    if (wasSaved) {
      savedIds.delete(auctionId);
    } else {
      savedIds.add(auctionId);
    }
    notifyAll();

    try {
      if (wasSaved) {
        await unsaveAuctionApi(auctionId);
      } else {
        await saveAuctionApi(auctionId);
      }
    } catch (err) {
      console.error("[use-save-auction] toggle failed, rolling back:", err);
      if (wasSaved) {
        savedIds.add(auctionId);
      } else {
        savedIds.delete(auctionId);
      }
      notifyAll();
    } finally {
      pendingIds.delete(auctionId);
      notifyAll();
    }
  }

  return { isSaved, toggle, initialized };
}
