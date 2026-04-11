import { getAdminToken } from "@/lib/admin-session";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";

function adminHeaders(): Record<string, string> {
  const token = getAdminToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function adminFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}/admin${path}`, {
    ...options,
    headers: { ...adminHeaders(), ...((options.headers as Record<string, string>) ?? {}) },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string; error?: string };
    throw Object.assign(
      new Error(err.message ?? `Admin API error: ${res.status}`),
      { statusCode: res.status, code: err.error },
    );
  }

  return res.json() as Promise<T>;
}

export async function adminLogin(
  phoneNumber: string,
  adminCode: string,
): Promise<{ token: string }> {
  const res = await fetch(`${API_BASE}/auth/admin-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumber, adminCode }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message ?? `Login failed: ${res.status}`);
  }

  const data = await res.json() as { token: string };
  return data;
}

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
