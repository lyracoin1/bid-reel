import { supabase } from "@/lib/supabase";

// ─── API base URL resolution ──────────────────────────────────────────────────
//
// Resolution order (first truthy value wins):
//   1. VITE_API_URL build-time env var — set in Vercel dashboard if needed.
//   2. Auto-detect: when running on admin.bid-reel.com, API lives on the same
//      root domain (www.bid-reel.com) as a Vercel serverless function.
//   3. Relative /api — used in local Replit dev where the Replit proxy routes
//      /api/* to the Express server on port 8080.
//
// Full URL constructed for each call: {API_BASE}/admin/{path}
//   Dev                : /api/admin/stats
//   admin.bid-reel.com : https://www.bid-reel.com/api/admin/stats
//   VITE_API_URL set   : {VITE_API_URL}/api/admin/stats

const _envOrigin = (import.meta.env.VITE_API_URL as string | undefined) || "";
const _autoOrigin =
  typeof window !== "undefined" && window.location.hostname === "admin.bid-reel.com"
    ? "https://www.bid-reel.com"
    : "";
const _origin = _envOrigin || _autoOrigin;
const API_BASE = _origin ? `${_origin}/api` : "/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function adminHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!supabase) return headers;
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
  return headers;
}

async function adminFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await adminHeaders();
  const url = `${API_BASE}/admin${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...headers, ...((options.headers as Record<string, string>) ?? {}) },
  });

  // Detect HTML responses before attempting JSON.parse — this surfaces a clear
  // error instead of the cryptic "Unexpected token '<'" message.
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    throw new Error(
      `Admin API misroute: received HTML instead of JSON from ${url}. ` +
      `Check that VITE_API_URL is set correctly in the Vercel dashboard and redeploy. ` +
      `Status: ${res.status}`,
    );
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string; error?: string };
    throw Object.assign(
      new Error(err.message ?? `Admin API error: ${res.status}`),
      { statusCode: res.status, code: err.error },
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
  displayName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  role: "admin" | "user";
  isBanned: boolean;
  banReason: string | null;
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
