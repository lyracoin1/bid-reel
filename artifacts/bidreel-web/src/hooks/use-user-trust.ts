import { useEffect, useState } from "react";
import { getUserTrustApi, type ApiTrust } from "@/lib/api-client";

// Module-level cache so the same userId isn't refetched across cards in the feed.
const cache = new Map<string, ApiTrust>();
const inflight = new Map<string, Promise<ApiTrust>>();

/**
 * Fetches a user's public trust profile. Cached per userId for the page session.
 * Returns `null` while loading or on error (caller should render a graceful
 * fallback — usually nothing for inline badges, "—" for stat tiles).
 */
export function useUserTrust(userId: string | null | undefined) {
  const [trust, setTrust] = useState<ApiTrust | null>(() => (userId ? cache.get(userId) ?? null : null));
  const [error, setError] = useState<string | null>(null);
  const loading = !!userId && !trust && !error;

  useEffect(() => {
    // Reset on userId change to avoid showing the previous user's trust while
    // a new fetch is in flight, or carrying a sticky error across navigations.
    setError(null);
    if (!userId) { setTrust(null); return; }
    const cached = cache.get(userId);
    setTrust(cached ?? null);
    if (cached) return;

    let cancelled = false;
    let p = inflight.get(userId);
    if (!p) {
      p = getUserTrustApi(userId).then(t => { cache.set(userId, t); inflight.delete(userId); return t; });
      inflight.set(userId, p);
    }
    p.then(t => { if (!cancelled) setTrust(t); })
     .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "trust fetch failed"); inflight.delete(userId); });
    return () => { cancelled = true; };
  }, [userId]);

  return { trust, loading, error };
}

/** Manually invalidate a cached trust entry (e.g. after submitting a rating). */
export function invalidateTrust(userId: string) {
  cache.delete(userId);
  inflight.delete(userId);
}
