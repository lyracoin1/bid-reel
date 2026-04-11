const TOKEN_KEY = "bidreel_admin_token";
const SESSION_KEY = "bidreel_admin_session_ts";
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

export function getAdminToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAdminSession(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(SESSION_KEY, String(Date.now()));
}

export function isAdminSessionValid(): boolean {
  const token = localStorage.getItem(TOKEN_KEY);
  const raw = localStorage.getItem(SESSION_KEY);
  if (!token || !raw) return false;
  const ts = Number(raw);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < SESSION_DURATION_MS;
}

export function clearAdminSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
}
