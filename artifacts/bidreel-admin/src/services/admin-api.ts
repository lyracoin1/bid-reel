import { supabase } from "@/lib/supabase";

// ─── API base URL resolution ──────────────────────────────────────────────────
//
// Resolution order (first truthy value wins):
//   1. VITE_API_URL build-time env var — set in Vercel dashboard if needed.
//      IMPORTANT: set this to the ORIGIN only (https://www.bid-reel.com),
//      NOT including /api — the /api segment is appended below.
//      If /api is accidentally included it is stripped to prevent double-prefix.
//   2. Auto-detect: when running on admin.bid-reel.com, API lives on the same
//      root domain (www.bid-reel.com) as a Vercel serverless function.
//   3. Relative /api — used in local Replit dev where the Replit proxy routes
//      /api/* to the Express server on port 8080.
//
// Final URL for each call: {API_BASE}/admin/{path}
//   Dev                : /api/admin/stats
//   admin.bid-reel.com : https://www.bid-reel.com/api/admin/stats
//   VITE_API_URL set   : https://www.bid-reel.com/api/admin/stats

const _rawEnvOrigin = (import.meta.env.VITE_API_URL as string | undefined) || "";
// Strip trailing /api or /api/ — prevents the double-prefix /api/api/admin/*
// that occurs when VITE_API_URL is mistakenly set to https://host.com/api.
const _envOrigin = _rawEnvOrigin.replace(/\/api\/?$/, "").replace(/\/$/, "");

const _hostname = typeof window !== "undefined" ? window.location.hostname : "";
const _autoOrigin = _hostname === "admin.bid-reel.com" ? "https://www.bid-reel.com" : "";

const _origin = _envOrigin || _autoOrigin;
export const API_BASE = _origin ? `${_origin}/api` : "/api";

// Log the resolved API base at startup — visible in browser console and helpful
// for diagnosing "Failed to fetch" issues in production.
console.info(
  `[admin-api] API_BASE = "${API_BASE}"` +
  ` | VITE_API_URL="${_rawEnvOrigin || "(not set)"}"` +
  ` | hostname="${_hostname || "ssr"}"` +
  (_rawEnvOrigin && _rawEnvOrigin !== _envOrigin
    ? ` | ⚠️  trailing /api stripped from VITE_API_URL to prevent double-prefix`
    : ""),
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function adminHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!supabase) {
    console.warn("[admin-api] supabase client is null — missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
    return headers;
  }
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    } else {
      console.warn("[admin-api] getSession() returned no session — Authorization header will be absent");
    }
  } catch (err) {
    console.warn("[admin-api] getSession() threw — sending request without Authorization header:", err);
  }
  return headers;
}

async function adminFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await adminHeaders();
  const url = `${API_BASE}/admin${path}`;
  const method = (options.method ?? "GET").toUpperCase();

  const hasAuth = "Authorization" in headers;
  const tokenSnippet = hasAuth
    ? `Bearer …(${(headers["Authorization"] as string).length - 7} chars)`
    : "⚠️  MISSING";

  console.info(`[admin-api] → ${method} ${url} | Authorization: ${tokenSnippet}`);

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers: { ...headers, ...((options.headers as Record<string, string>) ?? {}) },
    });
  } catch (err) {
    // fetch() itself threw — no HTTP response received.
    // Most common causes:
    //   1. CORS preflight OPTIONS was blocked (check Network tab → OPTIONS request)
    //   2. API server unreachable / not deployed (check www.bid-reel.com/api/healthz)
    //   3. Network offline
    const rawMsg = (err as Error)?.message ?? "Unknown network error";
    console.error(
      `[admin-api] ✗ Network error — fetch() threw for ${method} ${url}\n` +
      `  Raw error: ${rawMsg}\n` +
      `  Auth header present: ${hasAuth}\n` +
      `  Likely causes:\n` +
      `    • CORS preflight (OPTIONS) rejected — check Network tab for the OPTIONS request\n` +
      `    • API server not deployed or env vars missing at www.bid-reel.com\n` +
      `    • Browser is offline\n` +
      `  Diagnosis: open DevTools → Network tab → filter "admin" → look for a red OPTIONS request`,
      err,
    );
    throw new Error(
      `Network error: cannot reach ${url}. ` +
      `Open DevTools → Network tab and look for a failed OPTIONS preflight. ` +
      `If missing CORS headers, redeploy www.bid-reel.com.`,
    );
  }

  console.info(`[admin-api] ← ${res.status} ${res.statusText} | ${method} ${url}`);

  // Detect HTML responses before attempting JSON.parse — this surfaces a clear
  // error instead of the cryptic "Unexpected token '<'" message, and usually
  // means the URL resolved to a CDN/SPA index.html fallback (wrong API_BASE).
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    console.error(
      `[admin-api] ✗ Received HTML instead of JSON from ${url} (status ${res.status}).\n` +
      `  This usually means the API_BASE is wrong and the request hit a CDN/SPA fallback.\n` +
      `  Current API_BASE: "${API_BASE}"\n` +
      `  Check VITE_API_URL in Vercel → Settings → Environment Variables.`,
    );
    throw new Error(
      `API misroute (${res.status}): received HTML from ${url}. ` +
      `API_BASE="${API_BASE}" — check VITE_API_URL in Vercel dashboard.`,
    );
  }

  if (!res.ok) {
    let errBody: { message?: string; error?: string } = {};
    try {
      errBody = await res.json();
    } catch {
      // Non-JSON error body (rare)
    }

    const humanStatus = {
      400: "Bad request",
      401: "Unauthorized — session may have expired, try logging out and back in",
      403: "Forbidden — your account does not have admin access",
      404: "Not found — check API_BASE and Vercel deployment",
      429: "Too many requests — slow down",
      500: "Internal server error — check Vercel function logs",
      503: "API server unavailable — check Vercel environment variables (SUPABASE_URL etc.)",
    }[res.status];

    const message = errBody.message ?? humanStatus ?? `HTTP ${res.status}`;
    console.error(`[admin-api] ✗ ${res.status} from ${method} ${url}: ${message}`);
    throw Object.assign(
      new Error(message),
      { statusCode: res.status, code: errBody.error ?? `http_${res.status}` },
    );
  }

  return res.json() as Promise<T>;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export interface AdminStats {
  totalUsers: number;
  totalAuctions: number;
  activeAuctions: number;
  endedAuctions: number;
  removedAuctions: number;
  totalBids: number;
  totalReports: number;
  openReports: number;
  resolvedReports: number;
  dismissedReports: number;
  bannedUsers: number;
  totalAdmins: number;
}

export async function adminGetStats(): Promise<AdminStats> {
  return adminFetch<AdminStats>("/stats");
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  username: string | null;
  displayName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  role: "admin" | "user";
  isBanned: boolean;
  banReason: string | null;
  /**
   * True only when ALL five required fields are present:
   * username, display_name, phone, avatar_url, location.
   * Must match isProfileComplete() in api-server/src/lib/profiles.ts.
   */
  isCompleted: boolean;
  /** Names of the missing fields. Empty array when isCompleted = true. */
  missingFields: string[];
  createdAt: string;
}

export async function adminGetUsers(): Promise<AdminUser[]> {
  const data = await adminFetch<{ users: AdminUser[] }>("/users");
  return data.users;
}

export async function adminUpdateUser(
  id: string,
  patch: { role?: "admin" | "user"; isBanned?: boolean; banReason?: string | null },
): Promise<AdminUser> {
  const data = await adminFetch<{ user: AdminUser }>(`/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return data.user;
}

/**
 * Permanently delete a user and all their content.
 * The server handles cascade deletion in the correct FK order.
 * Self-delete is blocked server-side (returns 403).
 */
export async function adminDeleteUser(id: string): Promise<void> {
  await adminFetch(`/users/${id}`, { method: "DELETE" });
}

// ─── Auctions ─────────────────────────────────────────────────────────────────

export interface AdminAuction {
  id: string;
  title: string;
  category: string;
  status: string;
  startPrice: number;
  currentBid: number;
  bidCount: number;
  startsAt: string | null;
  endsAt: string;
  createdAt: string;
  currencyCode: string;
  currencyLabel: string;
  lat: number | null;
  lng: number | null;
  seller: { id: string; displayName: string | null } | null;
  interestedCount: number;
  notInterestedCount: number;
  /** Number of users who have saved this auction. */
  saveCount: number;
}

export async function adminGetAuctions(): Promise<AdminAuction[]> {
  const data = await adminFetch<{ auctions: AdminAuction[] }>("/auctions");
  return data.auctions;
}

export async function adminUpdateAuction(
  id: string,
  patch: { status?: "active" | "ended" | "removed" },
): Promise<void> {
  await adminFetch(`/auctions/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export async function adminDeleteAuction(id: string): Promise<void> {
  await adminFetch(`/auctions/${id}`, { method: "DELETE" });
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export interface AdminReport {
  id: string;
  reason: string;
  details: string | null;
  status: string;
  adminNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  reporter: { id: string; displayName: string | null } | null;
  auction: { id: string; title: string } | null;
}

export async function adminGetReports(): Promise<AdminReport[]> {
  const data = await adminFetch<{ reports: AdminReport[] }>("/reports");
  return data.reports;
}

export async function adminUpdateReport(
  id: string,
  status: "pending" | "dismissed" | "actioned",
): Promise<void> {
  await adminFetch(`/reports/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
}

// ─── Action log ───────────────────────────────────────────────────────────────

export interface AdminAction {
  id: string;
  actionType: string;
  targetType: string;
  targetId: string;
  note: string | null;
  createdAt: string;
  admin: { id: string; displayName: string | null; phone: string | null } | null;
}

export async function adminGetActions(): Promise<AdminAction[]> {
  const data = await adminFetch<{ actions: AdminAction[] }>("/actions");
  return data.actions;
}

// ─── Admin Notifications ──────────────────────────────────────────────────────

export interface AdminNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export async function adminGetNotifications(): Promise<AdminNotification[]> {
  const data = await adminFetch<{ notifications: AdminNotification[] }>("/notifications");
  return data.notifications;
}

export async function adminMarkNotificationRead(id: string): Promise<void> {
  await adminFetch(`/notifications/${id}/read`, { method: "PATCH" });
}

export async function adminMarkAllNotificationsRead(): Promise<void> {
  await adminFetch("/notifications/read-all", { method: "POST" });
}

// ─── Deploy ───────────────────────────────────────────────────────────────────

export interface DeployResult {
  ok: boolean;
  triggeredAt: string;
}

export async function adminTriggerDeploy(): Promise<DeployResult> {
  return adminFetch<DeployResult>("/deploy", { method: "POST" });
}
