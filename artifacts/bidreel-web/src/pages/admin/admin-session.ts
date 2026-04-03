/**
 * Admin session utilities — stored in sessionStorage (tab-scoped, not persisted).
 *
 * The admin session token is written by login.tsx immediately after a successful
 * admin login and is checked on every /admin/* route by AdminGuard.tsx.
 * Expiry is 15 minutes from the timestamp stored in sessionStorage.
 *
 * Kept in a separate module so AdminGuard.tsx only exports a React component,
 * which is required for React Fast Refresh to work correctly.
 */

const SESSION_KEY = "bidreel_admin_ts";
const SESSION_DURATION_MS = 15 * 60 * 1000;

export function isAdminSessionValid(): boolean {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return false;
  const ts = Number(raw);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < SESSION_DURATION_MS;
}

export function setAdminSession(): void {
  sessionStorage.setItem(SESSION_KEY, String(Date.now()));
}

export function clearAdminSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}
