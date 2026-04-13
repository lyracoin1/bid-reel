/**
 * use-current-user.ts
 *
 * Module-level cache of the authenticated user's profile.
 * Fetched once (on first call to useCurrentUser / getCurrentUserId) and
 * reused for the lifetime of the page session.
 *
 * ISOLATION GUARANTEE: Each email address maps to a unique Supabase auth user
 * and profile row. The cached user is always the owner of the active JWT.
 * Call clearCurrentUserCache() before logout to prevent stale data.
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

/**
 * Clears the module-level user cache.
 * Must be called on logout to prevent the next logged-in user from seeing
 * stale data from the previous session (same browser tab, different user).
 */
export function clearCurrentUserCache(): void {
  cachedUser = null;
  fetchPromise = null;
  notifyAll();
  console.log("[auth] user cache cleared");
}

async function loadCurrentUser(): Promise<ApiUserProfile | null> {
  if (cachedUser) return cachedUser;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const user = await getUserMeApi();
      cachedUser = user;
      fetchPromise = null;
      console.log(`[auth] ✅ user resolved — id=${user.id} isAdmin=${user.isAdmin}`);
      notifyAll();
      return user;
    } catch (err) {
      console.warn("[auth] failed to load own profile:", err);
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
