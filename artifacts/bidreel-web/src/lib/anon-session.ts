/**
 * Anonymous viewer session ID — stable per browser, persisted to localStorage.
 *
 * Used by view-tracking when no user is logged in so the server can dedupe
 * "same anonymous viewer watched this auction twice" within the rolling
 * 30-minute window. Format: 22-char URL-safe random token.
 */

const STORAGE_KEY = "bidreel:anon_session_id";

let cached: string | null = null;

function generate(): string {
  // 16 random bytes → 22-char base64url. Falls back to Math.random for very
  // old environments without crypto (server-side rendering / older Android WebViews).
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function getAnonSessionId(): string {
  if (cached) return cached;
  if (typeof window === "undefined") {
    // SSR safety — return a transient ID. Browser will overwrite on hydrate.
    cached = generate();
    return cached;
  }
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && existing.length >= 8) {
      cached = existing;
      return cached;
    }
    const fresh = generate();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    cached = fresh;
    return cached;
  } catch {
    // Private mode / storage disabled — use in-memory only.
    cached = generate();
    return cached;
  }
}
