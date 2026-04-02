/**
 * Session token management.
 *
 * The token key intentionally uses a versioned suffix (":v2").
 * When the auth architecture changes in a breaking way (e.g. removing the
 * shared dev-user fallback), bumping the version forces all browsers to
 * discard stale tokens and re-authenticate with their own phone number.
 *
 * Key history:
 *   bidreel:token  — v1, used the shared +14155550001 dev-user (insecure)
 *   bidreel:session:v2 — current, per-user tokens only
 */

const TOKEN_KEY = "bidreel:session:v2";

// Keys from previous versions to clean up on startup
const LEGACY_KEYS = ["bidreel:token"];

/**
 * Called once when the module loads.
 * Removes any tokens from previous storage key versions so stale shared
 * sessions from older builds cannot resurrect.
 */
function purgeLegacyTokens(): void {
  try {
    for (const key of LEGACY_KEYS) {
      if (localStorage.getItem(key) !== null) {
        localStorage.removeItem(key);
        console.log(`[auth] purged legacy session key "${key}"`);
      }
    }
  } catch {
    // localStorage may be unavailable in some contexts — ignore
  }
}

purgeLegacyTokens();

function isExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return Date.now() / 1000 >= (payload.exp as number) - 30;
  } catch {
    return true;
  }
}

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getValidSessionToken(): string | null {
  const t = getSessionToken();
  if (!t) return null;
  if (isExpired(t)) {
    clearSessionToken();
    return null;
  }
  return t;
}

export function setSessionToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
  }
}

export function clearSessionToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
  }
}
