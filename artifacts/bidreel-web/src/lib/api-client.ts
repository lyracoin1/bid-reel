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
  /** The authenticated user's saved signal for this auction.
   *  Returned by GET /auctions when a valid Bearer token is present. */
  user_signal?: "interested" | "not_interested" | null;
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

export interface GetAuctionsResult {
  auctions: ApiAuctionRaw[];
  /** ISO timestamp cursor for the next page, or null when no more pages exist. */
  nextCursor: string | null;
}

export async function getAuctionsApi(opts?: { before?: string }): Promise<GetAuctionsResult> {
  const headers = await authHeaders();
  // Use string concatenation — NOT new URL() — to handle relative API_BASE ("/api")
  // on web builds where new URL(relativeString) throws "Invalid URL" without a base.
  const qs = opts?.before ? `?before=${encodeURIComponent(opts.before)}` : "";
  const res = await fetch(`${API_BASE}/auctions${qs}`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as ApiError;
    throw new Error(err.message ?? "Failed to fetch auctions");
  }
  const data = await res.json() as { auctions: ApiAuctionRaw[]; nextCursor: string | null };
  console.log(
    `[api-client] ✅ GET /auctions → ${data.auctions.length} auctions` +
    (opts?.before ? " (load-more)" : " (initial)") +
    (data.nextCursor ? ` nextCursor=${data.nextCursor}` : " [last page]"),
  );
  return { auctions: data.auctions, nextCursor: data.nextCursor ?? null };
}

// ─── Server-proxied file upload ───────────────────────────────────────────────
// Sends the raw file binary to POST /api/media/upload (same origin as all other
// API calls) so the server can relay it to Supabase Storage without the client
// ever making a cross-origin PUT directly to Supabase.  Eliminates the CORS
// preflight failure that causes "Network error during upload" on Capacitor Android.
//
// Uses XHR so we can track upload progress.
// Returns the public URL of the stored file.

export async function uploadMediaApi(
  file: File,
  fileType: "video" | "image",
  onProgress?: (pct: number) => void,
): Promise<string> {
  const token = await getToken();
  if (!token) { redirectToLogin(); throw new Error("Not authenticated"); }

  // Strip charset or codec suffixes Android sometimes appends (e.g. "video/mp4; codecs=avc1")
  const mimeType = (file.type || "").split(";")[0].trim()
    || (fileType === "video" ? "video/mp4" : "image/jpeg");

  // Build URL with string concatenation — NOT new URL() — so it works with
  // both relative paths ("/api") used on web AND absolute URLs used on Android.
  // new URL(relativeString) without a base throws "Invalid URL" on mobile.
  const qs = new URLSearchParams({ fileType, mimeType }).toString();
  const uploadEndpoint = `${API_BASE}/media/upload?${qs}`;

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
        const data = JSON.parse(xhr.responseText) as { publicUrl: string };
        console.log(`[api-client] ✅ POST /media/upload → publicUrl=${data.publicUrl}`);
        resolve(data.publicUrl);
      } else {
        // Vercel returns HTML ("Request Entity Too Large") for 413; JSON.parse
        // would throw and mask the real cause. Guard against that and hint to
        // the caller that the file exceeds the serverless body limit.
        let errText: string | null = null;
        try {
          errText = xhr.responseText
            ? (JSON.parse(xhr.responseText) as { message?: string }).message ?? null
            : null;
        } catch { /* non-JSON response (e.g. Vercel 413 HTML) */ }
        if (!errText && xhr.status === 413) {
          errText = "File is too large for the proxy upload path. Please try a shorter video.";
        }
        reject(new Error(errText ?? `Upload failed: HTTP ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during upload"));
    });

    xhr.open("POST", uploadEndpoint);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    // Content-Type tells the server what kind of file this is;
    // express.raw() on the server reads the raw body regardless of Content-Type.
    xhr.setRequestHeader("Content-Type", mimeType);
    xhr.send(file);
  });
}

// ─── Direct-to-R2 presigned upload ────────────────────────────────────────────
// For videos (which exceed the ~4.5 MB Vercel serverless body limit) the
// client asks the API for a short-lived signed PUT URL and uploads the file
// body straight to Cloudflare R2. This path only hits our API for the small
// JSON sign request, so it scales to the full 20 MB compressed-video cap.
//
// Required R2 bucket CORS policy (paste into the Cloudflare dashboard exactly
// — R2 rejects OPTIONS in AllowedMethods because it manages preflight itself):
//
// [
//   {
//     "AllowedOrigins": ["https://<your-site>", "capacitor://localhost", "http://localhost"],
//     "AllowedMethods": ["PUT", "GET"],
//     "AllowedHeaders": ["Content-Type", "Authorization"],
//     "ExposeHeaders":  ["ETag"],
//     "MaxAgeSeconds": 3600
//   }
// ]
//
// Every thrown Error from this function has .name = "PresignedUploadError" and
// a .step field set to one of: "presign_http", "presign_parse", "put_network",
// "put_http" — plus the full request/response context in the message so the
// UI can show exactly which hop failed.

export class PresignedUploadError extends Error {
  step: "presign_http" | "presign_parse" | "put_network" | "put_http";
  httpStatus?: number;
  url?: string;
  responseBody?: string;
  constructor(init: {
    step: PresignedUploadError["step"];
    message: string;
    httpStatus?: number;
    url?: string;
    responseBody?: string;
  }) {
    super(init.message);
    this.name = "PresignedUploadError";
    this.step = init.step;
    this.httpStatus = init.httpStatus;
    this.url = init.url;
    this.responseBody = init.responseBody;
  }
}

export async function uploadMediaPresignedApi(
  file: File,
  fileType: "video" | "image",
  onProgress?: (pct: number) => void,
): Promise<string> {
  const token = await getToken();
  if (!token) { redirectToLogin(); throw new Error("Not authenticated"); }

  const mimeType = (file.type || "").split(";")[0].trim()
    || (fileType === "video" ? "video/mp4" : "image/jpeg");

  const presignUrl = `${API_BASE}/media/presign-upload`;

  // 1. Ask API for a signed URL
  let signRes: Response;
  try {
    signRes = await fetch(presignUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ fileType, mimeType, sizeBytes: file.size }),
    });
  } catch (networkErr) {
    const detail = networkErr instanceof Error ? networkErr.message : String(networkErr);
    throw new PresignedUploadError({
      step: "presign_http",
      message: `Could not reach presign endpoint (${presignUrl}): ${detail}`,
      url: presignUrl,
    });
  }

  const rawSignBody = await signRes.text();
  if (!signRes.ok) {
    let parsed: { message?: string; detail?: string } = {};
    try { parsed = JSON.parse(rawSignBody); } catch { /* non-JSON */ }
    throw new PresignedUploadError({
      step: "presign_http",
      httpStatus: signRes.status,
      url: presignUrl,
      responseBody: rawSignBody.slice(0, 500),
      message:
        `Presign failed [HTTP ${signRes.status} ${presignUrl}]: ` +
        (parsed.message ?? parsed.detail ?? (rawSignBody.slice(0, 200) || "no body")),
    });
  }

  let signed: { uploadUrl: string; publicUrl: string; key: string };
  try {
    signed = JSON.parse(rawSignBody);
  } catch {
    throw new PresignedUploadError({
      step: "presign_parse",
      httpStatus: signRes.status,
      url: presignUrl,
      responseBody: rawSignBody.slice(0, 500),
      message: `Presign returned non-JSON body: ${rawSignBody.slice(0, 200)}`,
    });
  }
  const { uploadUrl, publicUrl } = signed;
  const signedHost = safeHost(uploadUrl);
  console.log(`[api-client] Presign OK → PUT ${signedHost}, expected publicUrl=${publicUrl}`);

  // 2. PUT file directly to R2
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        console.log(`[api-client] ✅ PUT R2 → publicUrl=${publicUrl}`);
        resolve(publicUrl);
        return;
      }
      // R2 returns XML on error (e.g. <Error><Code>SignatureDoesNotMatch</Code>…).
      // Extract Code + Message so the UI can point at the exact problem.
      const body = xhr.responseText || "";
      const codeMatch = body.match(/<Code>([^<]+)<\/Code>/);
      const msgMatch  = body.match(/<Message>([^<]+)<\/Message>/);
      const detail = [codeMatch?.[1], msgMatch?.[1]].filter(Boolean).join(": ");
      reject(new PresignedUploadError({
        step: "put_http",
        httpStatus: xhr.status,
        url: signedHost,
        responseBody: body.slice(0, 500),
        message:
          `R2 PUT rejected [HTTP ${xhr.status} host=${signedHost}]: ` +
          (detail || body.slice(0, 200) || "no body"),
      }));
    });

    xhr.addEventListener("error", () => {
      // No HTTP status available — this is a pre-response failure, almost
      // always CORS (R2 CORS policy missing/misconfigured) or DNS/TLS.
      reject(new PresignedUploadError({
        step: "put_network",
        url: signedHost,
        message:
          `Network error PUTting to R2 (host=${signedHost}). ` +
          "Most common cause: R2 bucket CORS does not allow PUT from this origin. " +
          "Verify bucket CORS has AllowedMethods: ['PUT','GET'] (NOT OPTIONS) and " +
          "AllowedHeaders includes 'Content-Type'.",
      }));
    });

    xhr.open("PUT", uploadUrl);
    // Must match the Content-Type used when signing — R2 verifies it.
    xhr.setRequestHeader("Content-Type", mimeType);
    xhr.send(file);
  });
}

function safeHost(url: string): string {
  try { return new URL(url).host; } catch { return url.slice(0, 80); }
}

// ─── Seller's own auctions (for Profile → My Auctions tab) ───────────────────
// Uses GET /api/auctions/mine — auth-gated, returns all non-removed auctions for
// the logged-in user only. Consistent with the auctionCount stat on /api/users/me.

export async function getMyAuctionsApi(): Promise<ApiAuctionRaw[]> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/auctions/mine`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as ApiError;
    throw new Error(err.message ?? "Failed to fetch my auctions");
  }
  const data = await res.json() as { auctions: ApiAuctionRaw[] };
  console.log(`[api-client] ✅ GET /auctions/mine → ${data.auctions.length} auctions`);
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
//
// Sends bid_increment (how much to add). The server computes the new price.
// Client must never send the final amount as the source of truth.

export async function placeBidApi(
  auctionId: string,
  bidIncrement: number,
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
    body: JSON.stringify({ auctionId, bid_increment: bidIncrement }),
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

// ─── Current user (own profile) ───────────────────────────────────────────────

export interface ApiUserProfile {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  location: string | null;
  /** E.164 WhatsApp contact number. Only returned for the authenticated user's own profile. */
  phone: string | null;
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

// ─── Likes (heart) ───────────────────────────────────────────────────────────

export interface ApiLikeResult {
  isLiked: boolean;
  likeCount: number;
}

/** Like (heart) an auction. Idempotent. */
export async function likeAuctionApi(auctionId: string): Promise<ApiLikeResult> {
  const token = await getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/auctions/${auctionId}/like`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as ApiError;
    throw new Error(err.message ?? "Failed to like auction");
  }
  return res.json() as Promise<ApiLikeResult>;
}

/** Unlike (remove heart) an auction. Idempotent. */
export async function unlikeAuctionApi(auctionId: string): Promise<ApiLikeResult> {
  const token = await getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/auctions/${auctionId}/like`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as ApiError;
    throw new Error(err.message ?? "Failed to unlike auction");
  }
  return res.json() as Promise<ApiLikeResult>;
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

// ─── Report system ────────────────────────────────────────────────────────────

/**
 * Submit a content violation report for an auction.
 * Throws with a human-readable message on failure (including 409 Already Reported).
 */
export async function submitReportApi(data: {
  auctionId: string;
  reason: string;
  details?: string;
}): Promise<void> {
  const token = await getToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/reports`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as ApiError;
    throw new Error(err.message ?? "Failed to submit report");
  }
}

// ─── Mutual follows (for mention system) ─────────────────────────────────────

export interface ApiMutualFollow {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

/**
 * Return profiles of users who mutually follow the authenticated user
 * (caller follows them AND they follow caller).
 * Returns [] on error — non-throwing.
 */
export async function getMutualFollowsApi(): Promise<ApiMutualFollow[]> {
  const token = await getToken();
  if (!token) return [];
  try {
    const res = await fetch(`${API_BASE}/users/me/mutual-follows`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json() as { mutualFollows: ApiMutualFollow[] };
    return data.mutualFollows ?? [];
  } catch {
    return [];
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
