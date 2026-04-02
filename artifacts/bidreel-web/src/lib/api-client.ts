/**
 * api-client.ts
 *
 * Thin HTTP client for the BidReel API server.
 *
 * Auth strategy:
 *   1. Check localStorage for a valid (non-expired) session token — used in
 *      production after the user completes phone OTP login.
 *   2. If no stored token, attempt dev-login (only works when the API server
 *      has USE_DEV_AUTH=true set, i.e. the development environment).
 *   3. If both fail, return null — the caller must redirect to /login.
 */

import { getValidSessionToken, setSessionToken, clearSessionToken } from "./session";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const API_BASE = `${BASE}/api`;

// ─── Token management ─────────────────────────────────────────────────────────

let cachedToken: string | null = null;
let tokenPromise: Promise<string | null> | null = null;

/** Stores a token received from the OTP login flow into memory + localStorage. */
export function setToken(token: string): void {
  cachedToken = token;
  setSessionToken(token);
}

/** Clears the in-memory and persisted token (called on logout / 401). */
export function clearToken(): void {
  cachedToken = null;
  clearSessionToken();
}

/** Redirects to the login page and clears the stale session. */
export function redirectToLogin(): void {
  const loginPath = `${import.meta.env.BASE_URL?.replace(/\/$/, "") ?? ""}/login`;
  if (window.location.pathname === loginPath || window.location.pathname.endsWith("/login")) return;
  clearToken();
  window.location.replace(loginPath);
}

/**
 * Returns a valid Bearer token.
 * Order of precedence:
 *   1. In-memory cache (fast path)
 *   2. localStorage (persisted production session)
 *   3. Dev-login endpoint (development only — returns null in production)
 */
export async function getToken(): Promise<string | null> {
  // 1. In-memory cache
  if (cachedToken) return cachedToken;

  // 2. localStorage session (production OTP login)
  const stored = getValidSessionToken();
  if (stored) {
    cachedToken = stored;
    console.log("[api-client] ✅ session token loaded from localStorage");
    return cachedToken;
  }

  // 3. Dev-login fallback (only works when USE_DEV_AUTH=true on the server)
  if (tokenPromise) return tokenPromise;

  tokenPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/dev-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: "+14155550001" }),
      });

      if (!res.ok) {
        console.warn("[api-client] dev-login not available (production?) — please log in");
        return null;
      }

      const data = await res.json() as { token: string };
      cachedToken = data.token;
      console.log("[api-client] ✅ dev-login OK — JWT acquired");
      return cachedToken;
    } catch {
      console.warn("[api-client] dev-login network error — API unreachable");
      return null;
    } finally {
      tokenPromise = null;
    }
  })();

  return tokenPromise;
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

// ─── Raw auction shape returned by the backend ───────────────────────────────

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
  seller: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
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

/**
 * Place a bid on an auction.
 *
 * Returns the created bid + updated auction on success.
 * Throws an error with `code` and `message` fields on failure so callers
 * can distinguish between "too low", "not active", "seller cannot bid", etc.
 */
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

  console.log(`[api-client] POST /bids auctionId=${auctionId} amount=${amount}`);

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
    console.error(`[api-client] ❌ POST /bids failed: ${err.error} — ${err.message}`);
    throw Object.assign(new Error(err.message ?? "Bid failed"), {
      code: err.error,
      statusCode: res.status,
      ...(err as object),
    });
  }

  const result = data as PlaceBidResult;
  console.log(`[api-client] ✅ Bid placed — id=${result.bid.id} amount=${result.bid.amount} new_current=${result.auction.current_bid}`);
  return result;
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
}

export async function createAuctionApi(input: CreateAuctionInput): Promise<{ auction: ApiAuctionRaw }> {
  const token = await getToken();
  if (!token) { redirectToLogin(); throw new Error("Not authenticated"); }

  console.log(`[api-client] POST /auctions title="${input.title}" startPrice=${input.startPrice}`);

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
    console.error(`[api-client] ❌ POST /auctions failed: ${err.error} — ${err.message}`);
    throw Object.assign(new Error(err.message ?? "Failed to create auction"), { code: err.error });
  }

  const result = data as { auction: ApiAuctionRaw };
  console.log(`[api-client] ✅ Auction created — id=${result.auction.id}`);
  return result;
}

// ─── Media upload ─────────────────────────────────────────────────────────────

export interface UploadUrlResponse {
  uploadUrl: string;
  path: string;
  publicUrl: string;
  fileType: "video" | "image";
  expiresInSeconds: number;
}

/**
 * Step 1: Get a presigned upload URL from the server.
 */
export async function getUploadUrlApi(
  fileType: "video" | "image",
  mimeType: string,
  sizeBytes: number,
): Promise<UploadUrlResponse> {
  const token = await getToken();
  if (!token) { redirectToLogin(); throw new Error("Not authenticated"); }

  console.log(`[api-client] POST /media/upload-url fileType=${fileType} mimeType=${mimeType} size=${(sizeBytes / 1024).toFixed(1)}KB`);

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

  const result = data as UploadUrlResponse;
  console.log(`[api-client] ✅ Upload URL acquired — path=${result.path}`);
  return result;
}

/**
 * Step 2: Upload the file directly to Supabase Storage via the presigned URL.
 * Uses PUT as required by Supabase Storage presigned uploads.
 */
export async function uploadFileToStorage(
  uploadUrl: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> {
  console.log(`[api-client] PUT file to storage — name=${file.name} size=${(file.size / 1024).toFixed(1)}KB`);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          onProgress(pct);
        }
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        console.log(`[api-client] ✅ File uploaded to storage successfully`);
        resolve();
      } else {
        console.error(`[api-client] ❌ Storage upload failed: HTTP ${xhr.status}`);
        reject(new Error(`Storage upload failed: HTTP ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => {
      console.error(`[api-client] ❌ Storage upload network error`);
      reject(new Error("Network error during file upload"));
    });

    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.send(file);
  });
}

// ─── Current user (own profile) ───────────────────────────────────────────────

export interface ApiUserProfile {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  auctionCount: number;
  totalLikesReceived: number;
  bidsPlacedCount: number;
  isAdmin: boolean;
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
  console.log(`[api-client] ✅ GET /users/me → id=${data.user.id}`);
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
  console.log(`[api-client] ✅ GET /users/me/bids → ${data.bids.length} entries`);
  return data.bids;
}

// ─── Delete auction ───────────────────────────────────────────────────────────

/**
 * Soft-delete an auction (sets status = 'removed').
 * Only the auction owner can call this — the backend enforces it.
 * @throws Error with a message if not authorized or request fails.
 */
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

// ─── Admin activation ─────────────────────────────────────────────────────────

/**
 * Activate admin status for the current user by providing the secret code.
 * The code is validated entirely on the backend — never stored or checked
 * in client-side logic.
 *
 * @throws Error with an Arabic message on failure (wrong code, server error).
 */
export async function activateAdminApi(code: string): Promise<ApiUserProfile> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/users/me/activate-admin`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = await res.json() as { user?: ApiUserProfile; error?: string; message?: string };
  if (!res.ok) {
    throw new Error(data.message ?? "حدث خطأ غير متوقع");
  }
  console.log(`[api-client] ✅ POST /users/me/activate-admin → isAdmin=${data.user?.isAdmin}`);
  return data.user!;
}

// ─── Device token ─────────────────────────────────────────────────────────────

/**
 * Register an FCM device token with the server.
 * Safe to call on every app load — the server upserts idempotently.
 */
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
