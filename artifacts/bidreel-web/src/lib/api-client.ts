/**
 * api-client.ts
 *
 * Thin HTTP client for the BidReel API server.
 *
 * Auth strategy:
 *   1. Check in-memory cache (fast path for the current page session).
 *   2. Check localStorage for a valid (non-expired) Supabase JWT — persisted
 *      after the user signs in with email + password.
 *   3. Ask Supabase to refresh the session (uses the 60-day refresh token stored
 *      in Supabase's own localStorage key) — handles the common case where the
 *      1-hour access token has expired but the user is still within their session.
 *   4. Return null — the caller must redirect to /login.
 *
 * Auth identity is email + password (Supabase Auth).
 * Phone is a profile/contact field only — never used for authentication.
 */

import { getValidSessionToken, setSessionToken, clearSessionToken } from "./session";
import { supabase } from "./supabase";
import { Capacitor } from "@capacitor/core";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

/**
 * API_BASE resolution order:
 *  1. VITE_API_URL build-time env var — ONLY used for native Capacitor (Android/iOS)
 *     APK builds where there is no same-domain proxy.  Set to the full base URL of
 *     the API server (e.g. https://your-api.replit.app/api) when building the APK.
 *  2. Relative path `<BASE>/api` — used in the web app where the Replit proxy routes
 *     /api/* to the Express server on the same domain.  This survives any domain
 *     change automatically, so it is always preferred on web.
 */
export const API_BASE: string = (() => {
  const configured = (import.meta.env["VITE_API_URL"] as string | undefined)?.replace(/\/$/, "");
  // Only honour VITE_API_URL when running inside a native Capacitor app (APK/IPA).
  // On web, the API is always co-hosted on the same domain via the Replit proxy, so a
  // relative path is correct and will never break due to a misconfigured env var.
  if (configured && Capacitor.isNativePlatform()) return configured;
  return `${BASE}/api`;
})();

// ─── Token management ─────────────────────────────────────────────────────────

let cachedToken: string | null = null;

/** Stores a Supabase JWT received after email+password sign-in into memory + localStorage. */
export function setToken(token: string): void {
  cachedToken = token;
  setSessionToken(token);
  console.log("[auth] token stored — user is now authenticated");
}

/** Clears the in-memory and persisted token (called on logout / 401). */
export function clearToken(): void {
  cachedToken = null;
  clearSessionToken();
  console.log("[auth] token cleared — user is logged out");
}

/** Redirects to the login page and clears the stale session. */
export function redirectToLogin(): void {
  const loginPath = `${import.meta.env.BASE_URL?.replace(/\/$/, "") ?? ""}/login`;
  if (window.location.pathname === loginPath || window.location.pathname.endsWith("/login")) return;
  clearToken();
  window.location.replace(loginPath);
}

/**
 * Returns a valid Bearer token, or null if the user is not authenticated.
 *
 * Resolution order:
 *  1. In-memory cache (fastest — avoids any I/O)
 *  2. Our localStorage key (valid if within the 1-hour JWT expiry window)
 *  3. Supabase session refresh — uses the 60-day refresh token that Supabase
 *     stores in its own localStorage key to obtain a fresh access token.
 *     This is the key path that keeps users logged in between sessions.
 */
export async function getToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;

  const stored = getValidSessionToken();
  if (stored) {
    cachedToken = stored;
    console.log("[auth] ✅ session restored from localStorage");
    return cachedToken;
  }

  // Fallback: ask Supabase to refresh the session.
  // getSession() returns the stored session, refreshing the access token if
  // needed via the refresh token (valid for 60 days by default).
  if (supabase) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        cachedToken = session.access_token;
        setSessionToken(session.access_token);
        console.log("[auth] ✅ session restored via Supabase token refresh");
        return cachedToken;
      }
    } catch {
      // Supabase unreachable — fall through to unauthenticated
    }
  }

  return null;
}

// ─── Shared fetch helper ──────────────────────────────────────────────────────

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

// ─── Typed shapes ─────────────────────────────────────────────────────────────

interface ApiError {
  error: string;
  message: string;
  [key: string]: unknown;
}

export interface ApiBid {
  id: string;
  auction_id: string;
  user_id: string;
  amount: number;
  created_at: string;
}

export interface ApiAuction {
  id: string;
  current_bid: number;
  bid_count: number;
  min_increment: number | null;
  ends_at: string;
}

export interface PlaceBidResult {
  bid: ApiBid;
  auction: ApiAuction;
}

export interface ApiAuctionRaw {
  id: string;
  seller_id: string;
  title: string;
  description: string | null;
  category: string;
  start_price: number;
  current_bid: number;
  min_increment: number | null;
  video_url: string | null;
  thumbnail_url: string | null;
  bid_count: number;
  like_count: number;
  status: string;
  starts_at: string | null;
  ends_at: string;
  created_at: string;
  lat?: number | null;
  lng?: number | null;
  currency_code?: string | null;
  currency_label?: string | null;
  seller: {
    id: string;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    phone: string | null;
  } | null;
}

export interface ApiAuctionBid {
  id: string;
  user_id: string;
  amount: number;
  created_at: string;
  bidder: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

// ─── Auction list ─────────────────────────────────────────────────────────────

export async function getAuctionsApi(): Promise<ApiAuctionRaw[]> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/auctions`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as ApiError;
    throw new Error(err.message ?? "Failed to fetch auctions");
  }
  const data = await res.json() as { auctions: ApiAuctionRaw[] };
  console.log(`[api-client] ✅ GET /auctions → ${data.auctions.length} auctions`);
  return data.auctions;
}

// ─── Auction detail ───────────────────────────────────────────────────────────

export async function getAuctionApi(id: string): Promise<{ auction: ApiAuctionRaw; bids: ApiAuctionBid[] }> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/auctions/${id}`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as ApiError;
    throw new Error(err.message ?? "Auction not found");
  }
  const data = await res.json() as { auction: ApiAuctionRaw; bids: ApiAuctionBid[] };
  console.log(`[api-client] ✅ GET /auctions/${id} → ${data.bids.length} bids`);
  return data;
}

// ─── Place bid ────────────────────────────────────────────────────────────────

export async function placeBidApi(
  auctionId: string,
  amount: number,
): Promise<PlaceBidResult> {
  const token = await getToken();

  if (!token) {
    throw Object.assign(new Error("Not authenticated — API unreachable in dev"), {
      code: "NO_TOKEN",
    });
  }

  const res = await fetch(`${API_BASE}/bids`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ auctionId, amount }),
  });

  const data = await res.json() as PlaceBidResult | ApiError;

  if (!res.ok) {
    const err = data as ApiError;
    throw Object.assign(new Error(err.message ?? "Bid failed"), {
      code: err.error,
      statusCode: res.status,
      ...(err as object),
    });
  }

  return data as PlaceBidResult;
}

// ─── Create auction ───────────────────────────────────────────────────────────

export interface CreateAuctionInput {
  title: string;
  description?: string;
  category: string;
  startPrice: number;
  videoUrl: string;
  thumbnailUrl: string;
  lat: number;
  lng: number;
  currencyCode?: string;
  currencyLabel?: string;
  /** Auction duration in whole hours. Must be 1–48. Defaults to 24 on the server if omitted. */
  durationHours?: number;
}

export async function createAuctionApi(input: CreateAuctionInput): Promise<{ auction: ApiAuctionRaw }> {
  const token = await getToken();
  if (!token) { redirectToLogin(); throw new Error("Not authenticated"); }

  const res = await fetch(`${API_BASE}/auctions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });

  if (res.status === 401) { redirectToLogin(); throw new Error("Session expired"); }

  const data = await res.json();
  if (!res.ok) {
    const err = data as ApiError;
    throw Object.assign(new Error(err.message ?? "Failed to create auction"), { code: err.error });
  }

  return data as { auction: ApiAuctionRaw };
}

// ─── Media upload ─────────────────────────────────────────────────────────────

export interface UploadUrlResponse {
  uploadUrl: string;
  path: string;
  publicUrl: string;
  fileType: "video" | "image";
  expiresInSeconds: number;
}

export async function getUploadUrlApi(
  fileType: "video" | "image",
  mimeType: string,
  sizeBytes: number,
): Promise<UploadUrlResponse> {
  const token = await getToken();
  if (!token) { redirectToLogin(); throw new Error("Not authenticated"); }

  const res = await fetch(`${API_BASE}/media/upload-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ fileType, mimeType, sizeBytes }),
  });

  if (res.status === 401) { redirectToLogin(); throw new Error("Session expired"); }

  const data = await res.json();
  if (!res.ok) {
    const err = data as ApiError;
    throw Object.assign(new Error(err.message ?? "Failed to get upload URL"), { code: err.error });
  }

  return data as UploadUrlResponse;
}

export async function uploadFileToStorage(
  uploadUrl: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during upload"));
    });

    xhr.open("PUT", uploadUrl);

    xhr.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream"
    );

    xhr.send(file);
  });
}

// ─── Current user (own profile) ───────────────────────────────────────────────

export interface ApiUserProfile {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  location: string | null;
  auctionCount: number;
  totalLikesReceived: number;
  bidsPlacedCount: number;
  followersCount: number;
  followingCount: number;
  isAdmin: boolean;
  /** true once the user has set a username (onboarding complete). */
  isCompleted: boolean;
  createdAt: string;
}

export async function getUserMeApi(): Promise<ApiUserProfile> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/users/me`, { headers });
  if (res.status === 401) {
    redirectToLogin();
    throw Object.assign(new Error("Session expired"), { code: "UNAUTHORIZED" });
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as ApiError;
    throw new Error(err.message ?? "Failed to fetch own profile");
  }
  const data = await res.json() as { user: ApiUserProfile };
  return data.user;
}

// ─── Update own profile ───────────────────────────────────────────────────────

export interface UpdateProfilePayload {
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
  /** Phone in E.164 format (e.g. +201060088141). Used for WhatsApp contact links. */
  phone?: string;
  /** City / region the user is based in (e.g. "Riyadh", "Cairo"). Free text, max 100 chars. */
  location?: string;
}

export class UsernameTakenError extends Error {
  readonly code = "USERNAME_TAKEN";
  constructor(message: string) {
    super(message);
    this.name = "UsernameTakenError";
  }
}

export async function updateProfileApi(payload: UpdateProfilePayload): Promise<ApiUserProfile> {
  const token = await getToken();
  if (!token) {
    redirectToLogin();
    throw Object.assign(new Error("Not authenticated"), { code: "UNAUTHORIZED" });
  }
  const res = await fetch(`${API_BASE}/users/me`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (res.status === 401) {
    redirectToLogin();
    throw Object.assign(new Error("Session expired"), { code: "UNAUTHORIZED" });
  }
  if (res.status === 409) {
    const err = await res.json().catch(() => ({})) as ApiError;
    throw new UsernameTakenError(err.message ?? "Username is already taken");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as ApiError;
    throw new Error(err.message ?? "Failed to update profile");
  }
  const data = await res.json() as { user: ApiUserProfile };
  return data.user;
}

/** Check whether a username is available for the current user.
 *  Returns true if the username can be claimed. */
export async function checkUsernameApi(username: string): Promise<boolean> {
  const token = await getToken();
  if (!token) return false;
  const res = await fetch(
    `${API_BASE}/users/check-username?username=${encodeURIComponent(username.toLowerCase())}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return false;
  const data = await res.json() as { available: boolean };
  return data.available;
}

// ─── Public user profile ──────────────────────────────────────────────────────

export interface ApiPublicProfile {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  location: string | null;
  auctionCount: number;
  totalLikesReceived: number;
  followersCount: number;
  followingCount: number;
  isBanned: boolean;
  isCompleted: boolean;
  createdAt: string;
}

export async function getUserPublicProfileApi(userId: string): Promise<ApiPublicProfile> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/users/${userId}`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as ApiError;
    throw new Error(err.message ?? "Failed to fetch user profile");
  }
  const data = await res.json() as { user: ApiPublicProfile };
  return data.user;
}

// ─── My bids (auctions bid on) ────────────────────────────────────────────────

export interface ApiMyBidEntry {
  auctionId: string;
  myBidAmount: number;
  isLeading: boolean;
  auction: {
    id: string;
    title: string;
    mediaUrl: string | null;
    currentBid: number;
    bidCount: number;
    endsAt: string;
    startsAt: string | null;
    currencyCode: string | null;
  };
}

export async function getUserBidsApi(): Promise<ApiMyBidEntry[]> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/users/me/bids`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as ApiError;
    throw new Error(err.message ?? "Failed to fetch my bids");
  }
  const data = await res.json() as { bids: ApiMyBidEntry[] };
  return data.bids;
}

// ─── Delete auction ───────────────────────────────────────────────────────────

export async function deleteAuctionApi(auctionId: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/auctions/${auctionId}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as ApiError;
    throw new Error(data.message ?? "فشل حذف المزاد");
  }
}

// ─── Device token ─────────────────────────────────────────────────────────────

export async function registerDeviceToken(
  token: string,
  platform: "web" | "ios" | "android" = "web",
): Promise<void> {
  const authToken = await getToken();
  if (!authToken) return;

  try {
    await fetch(`${API_BASE}/notifications/register-device`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ token, platform }),
    });
  } catch {
    console.warn("[api-client] registerDeviceToken failed — server unreachable");
  }
}

/**
 * Unregister an FCM device token from the backend.
 * Call on logout or when push permission is revoked so the device stops
 * receiving push notifications.  Non-throwing.
 */
export async function unregisterDeviceToken(token: string): Promise<void> {
  const authToken = await getToken();
  if (!authToken) return;

  try {
    await fetch(`${API_BASE}/notifications/unregister-device`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ token }),
    });
  } catch {
    console.warn("[api-client] unregisterDeviceToken failed — server unreachable");
  }
}

// ─── Follow system ────────────────────────────────────────────────────────────

export interface ApiFollowUser {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  isFollowing: boolean;
  isSelf: boolean;
}

export interface ApiFollowResult {
  isFollowing: boolean;
  followersCount: number;
  followingCount: number;
}

/** Fetch the flat list of profile IDs the current user follows. */
export async function getFollowingIdsApi(): Promise<string[]> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/users/me/following-ids`, { headers });
  if (!res.ok) return [];
  const data = await res.json() as { followingIds: string[] };
  return data.followingIds ?? [];
}

/** Follow a user. Returns updated follow counts + isFollowing. */
export async function followUserApi(userId: string): Promise<ApiFollowResult> {
  const token = await getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/users/${userId}/follow`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as ApiError;
    throw new Error(err.message ?? "Failed to follow user");
  }
  return res.json() as Promise<ApiFollowResult>;
}

/** Unfollow a user. Returns updated follow counts + isFollowing. */
export async function unfollowUserApi(userId: string): Promise<ApiFollowResult> {
  const token = await getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/users/${userId}/follow`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as ApiError;
    throw new Error(err.message ?? "Failed to unfollow user");
  }
  return res.json() as Promise<ApiFollowResult>;
}

/** Fetch a user's followers list. */
export async function getFollowersApi(userId: string): Promise<ApiFollowUser[]> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/users/${userId}/followers`, { headers });
  if (!res.ok) return [];
  const data = await res.json() as { followers: ApiFollowUser[] };
  return data.followers ?? [];
}

/** Fetch the list of users someone follows. */
export async function getFollowingApi(userId: string): Promise<ApiFollowUser[]> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/users/${userId}/following`, { headers });
  if (!res.ok) return [];
  const data = await res.json() as { following: ApiFollowUser[] };
  return data.following ?? [];
}

// ─── Save / Bookmark system ───────────────────────────────────────────────────

export interface ApiSaveResult {
  isSaved: boolean;
  savedCount: number;
}

/** Fetch the flat list of auction IDs the current user has saved. */
export async function getSavedIdsApi(): Promise<string[]> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/users/me/saved-ids`, { headers });
  if (!res.ok) return [];
  const data = await res.json() as { savedIds: string[] };
  return data.savedIds ?? [];
}

/** Save (bookmark) an auction. */
export async function saveAuctionApi(auctionId: string): Promise<ApiSaveResult> {
  const token = await getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/auctions/${auctionId}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as ApiError;
    throw new Error(err.message ?? "Failed to save auction");
  }
  return res.json() as Promise<ApiSaveResult>;
}

/** Unsave (remove bookmark) an auction. */
export async function unsaveAuctionApi(auctionId: string): Promise<ApiSaveResult> {
  const token = await getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/auctions/${auctionId}/save`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as ApiError;
    throw new Error(err.message ?? "Failed to unsave auction");
  }
  return res.json() as Promise<ApiSaveResult>;
}

// ─── Content Signal system (Interested / Not Interested) ─────────────────────

export type ContentSignal = "interested" | "not_interested";

/**
 * Record or update the viewer's signal for an auction.
 * One signal per user per auction — subsequent calls upsert the value.
 * Fire-and-forget: non-throwing on network errors.
 */
export async function sendSignalApi(auctionId: string, signal: ContentSignal): Promise<void> {
  const token = await getToken();
  if (!token) return;
  try {
    await fetch(`${API_BASE}/auctions/${auctionId}/signal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ signal }),
    });
  } catch {
    console.warn("[api-client] sendSignalApi failed — server unreachable");
  }
}

/**
 * Remove the viewer's signal for an auction (neutral / undecided).
 * Fire-and-forget: non-throwing on network errors.
 */
export async function removeSignalApi(auctionId: string): Promise<void> {
  const token = await getToken();
  if (!token) return;
  try {
    await fetch(`${API_BASE}/auctions/${auctionId}/signal`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    console.warn("[api-client] removeSignalApi failed — server unreachable");
  }
}

/** Permanently delete the authenticated user's account and all associated data. */
export async function deleteAccountApi(): Promise<void> {
  const token = await getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/users/me`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as ApiError;
    throw new Error(err.message ?? "Failed to delete account");
  }
}
