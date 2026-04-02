/**
 * use-current-user.ts
 *
 * Module-level cache of the authenticated user's profile.
 * Fetched once (on first call to useCurrentUser / getCurrentUserId) and
 * reused for the lifetime of the page.
 *
 * Why module-level?  The dev-login already cached the JWT.  We just need a
 * second cheap GET /api/users/me to resolve the real UUID so components
 * like auction-detail can compare auction.seller.id === me.id.
 */

import { useState, useEffect } from "react";
import { getUserMeApi, type ApiUserProfile } from "@/lib/api-client";

// ── Module-level cache ────────────────────────────────────────────────────────

let cachedUser: ApiUserProfile | null = null;
let fetchPromise: Promise<ApiUserProfile | null> | null = null;
type Listener = () => void;
const listeners = new Set<Listener>();
const notifyAll = () => listeners.forEach(l => l());

/**
 * Imperatively read the cached user ID — useful inside non-hook callbacks
 * (e.g. usePlaceBid, useRealtimeBids).
 */
export function getCurrentUserId(): string | null {
  return cachedUser?.id ?? null;
}

export function getCachedCurrentUser(): ApiUserProfile | null {
  return cachedUser;
}

async function loadCurrentUser(): Promise<ApiUserProfile | null> {
  if (cachedUser) return cachedUser;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const user = await getUserMeApi();
      cachedUser = user;
      fetchPromise = null;
      notifyAll();
      return user;
    } catch (err) {
      console.warn("[use-current-user] Failed to load own profile:", err);
      fetchPromise = null;
      return null;
    }
  })();

  return fetchPromise;
}

/**
 * Force-refresh the cached user profile.
 * Call this after operations that mutate the profile (e.g. admin activation).
 */
export async function refreshCurrentUser(): Promise<ApiUserProfile | null> {
  cachedUser = null;
  fetchPromise = null;
  const user = await getUserMeApi().catch(() => null);
  cachedUser = user;
  notifyAll();
  return user;
}

// ── React hook ────────────────────────────────────────────────────────────────

export interface CurrentUserState {
  user: ApiUserProfile | null;
  isLoading: boolean;
}

export function useCurrentUser(): CurrentUserState {
  const [user, setUser] = useState<ApiUserProfile | null>(cachedUser);
  const [isLoading, setIsLoading] = useState(cachedUser === null);

  useEffect(() => {
    const handler = () => setUser(cachedUser);
    listeners.add(handler);

    if (cachedUser === null) {
      loadCurrentUser().finally(() => {
        setUser(cachedUser);
        setIsLoading(false);
      });
    }

    return () => { listeners.delete(handler); };
  }, []);

  return { user, isLoading };
}

// Kick off the fetch eagerly so it's ready before components mount
void loadCurrentUser();
