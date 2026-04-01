/**
 * api-client.ts
 *
 * Thin HTTP client for the BidReel API server.
 *
 * Auth strategy (MVP):
 *   Uses the dev-login endpoint to exchange the mock user's phone number for
 *   a real Supabase JWT.  This keeps the frontend functional without a full
 *   login UI while still exercising the exact same requireAuth middleware that
 *   production will use.
 *
 *   Token is cached in memory for the lifetime of the page.  On the next
 *   reload it is re-fetched (dev logins are idempotent and fast).
 */

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const API_BASE = `${BASE}/api`;

// ─── Token management ─────────────────────────────────────────────────────────

let cachedToken: string | null = null;
let tokenPromise: Promise<string | null> | null = null;

/**
 * Returns a valid Bearer token, initialising a dev-login session if needed.
 * Concurrent callers await the same in-flight promise (no double-login).
 */
export async function getToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  if (tokenPromise) return tokenPromise;

  tokenPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/dev-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: "+14155550001" }), // Alex Chen (currentUser)
      });

      if (!res.ok) {
        console.warn("[api-client] dev-login failed, API may not be reachable");
        return null;
      }

      const data = await res.json() as { token: string };
      cachedToken = data.token;
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

// ─── Typed response helpers ────────────────────────────────────────────────────

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

// ─── Public API surface ────────────────────────────────────────────────────────

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
