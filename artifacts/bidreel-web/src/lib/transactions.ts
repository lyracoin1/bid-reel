/**
 * transactions.ts
 *
 * Client-side helpers for the Secure Deals (transactions) feature.
 *
 * All reads and writes go through the BidReel API server
 * (GET /api/secure-deals/:dealId, POST /api/secure-deals, etc.)
 * which stores data in the Replit PostgreSQL `transactions` table.
 *
 * The API server validates Supabase auth JWTs for write operations,
 * so the buyer/seller must be signed in.
 *
 * PAYMENT GATEWAY INTEGRATION POINT
 *   POST /api/secure-deals/:dealId/pay currently performs a placeholder.
 *   The real gateway call (Google Play Billing, Stripe, etc.) lives in
 *   artifacts/api-server/src/routes/secure-deals.ts — replace the
 *   placeholder block there to go live.
 */

import { API_BASE, getToken } from "./api-client";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PaymentStatus  = "pending" | "secured" | "refunded";
export type ShipmentStatus = "pending" | "verified" | "delivered";

export interface Transaction {
  deal_id:         string;
  seller_id:       string;
  buyer_id:        string | null;
  product_name:    string;
  price:           number;
  currency:        string;
  description:     string | null;
  delivery_method: string;
  media_urls:      string[];
  terms:           string | null;
  payment_status:  PaymentStatus;
  payment_date:    string | null;
  shipment_status: ShipmentStatus;
  funds_released:  boolean;
  payment_link:    string | null;
  release_date:    string | null;
  created_at:      string;
  updated_at:      string;
}

export interface CreateTransactionInput {
  deal_id:         string;
  seller_id:       string;
  product_name:    string;
  price:           number;
  currency:        string;
  description?:    string;
  delivery_method: string;
  media_urls?:     string[];
  terms?:          string;
  payment_link:    string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Generate a cryptographically-random deal ID: BD-XXXXXX (uppercase hex). */
export function generateDealId(): string {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return "BD-" + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()
    .slice(0, 6);
}

/** Build the buyer-facing payment URL from the current origin + deal ID. */
export function buildPaymentLink(dealId: string): string {
  const origin =
    (import.meta.env.VITE_PUBLIC_BASE_URL as string | undefined)?.trim() ||
    window.location.origin;
  return `${origin.replace(/\/$/, "")}/secure-deals/pay/${dealId}`;
}

// ── Internal fetch helper ─────────────────────────────────────────────────────

async function apiFetch(
  path: string,
  options: RequestInit = {},
  requiresAuth = false,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> ?? {}),
  };

  if (requiresAuth) {
    const token = await getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

// ── DB operations (via api-server) ────────────────────────────────────────────

/**
 * Insert a new secure deal into the database via the api-server.
 * Throws if the request fails or the server returns an error.
 */
export async function createTransaction(input: CreateTransactionInput): Promise<Transaction> {
  const res = await apiFetch("/secure-deals", {
    method: "POST",
    body: JSON.stringify({
      deal_id:         input.deal_id,
      product_name:    input.product_name,
      price:           input.price,
      currency:        input.currency,
      description:     input.description,
      delivery_method: input.delivery_method,
      media_urls:      input.media_urls ?? [],
      terms:           input.terms,
      payment_link:    input.payment_link,
    }),
  }, true);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message ?? `Failed to create deal (${res.status})`);
  }

  const { deal } = await res.json();
  return deal as Transaction;
}

/**
 * Fetch a single transaction by deal_id (public — no auth required).
 * Returns null if not found.
 */
export async function getTransaction(dealId: string): Promise<Transaction | null> {
  const res = await apiFetch(`/secure-deals/${encodeURIComponent(dealId)}`);

  if (res.status === 404) return null;
  if (!res.ok) {
    console.error("[transactions] fetch error:", res.status);
    return null;
  }

  const { deal } = await res.json();
  return deal as Transaction;
}

/**
 * Mark a transaction as payment-secured via the api-server.
 *
 * PAYMENT GATEWAY NOTE:
 *   The api-server POST /secure-deals/:dealId/pay is the integration point.
 *   Replace the placeholder block in secure-deals.ts (api-server) with the
 *   real gateway call before going live.
 */
export async function updatePaymentStatus(
  dealId:    string,
  _buyerId:  string,   // provided by the server from the auth token
  _amount:   number,   // stored in the existing transaction row
  _currency: string,
): Promise<void> {
  const res = await apiFetch(`/secure-deals/${encodeURIComponent(dealId)}/pay`, {
    method: "POST",
    body:   JSON.stringify({}),
  }, true);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message ?? `Payment failed (${res.status})`);
  }

  console.log("[transactions] Payment secured via api-server:", { dealId });
}

/**
 * Send a placeholder FCM/Email notification.
 * The real notification fires server-side in the api-server route.
 * This client-side function just logs for debugging.
 */
export function sendPaymentNotification(
  dealId:   string,
  buyerId:  string,
  amount:   number,
  currency: string,
): void {
  console.log("[notify] Payment secured — server-side notification triggered:", {
    dealId, buyerId, amount, currency,
    note: "Real FCM/Email notification fires in api-server/src/routes/secure-deals.ts",
  });
}

/**
 * Update shipment info via the api-server (seller only).
 */
export async function updateShipment(
  dealId: string,
  patch: { shipment_status?: ShipmentStatus; tracking_link?: string },
): Promise<void> {
  const res = await apiFetch(`/secure-deals/${encodeURIComponent(dealId)}/ship`, {
    method: "PATCH",
    body:   JSON.stringify(patch),
  }, true);

  if (!res.ok) {
    console.error("[transactions] updateShipment error:", res.status);
  }
}

/**
 * Mark funds as released (admin action — handled server-side or admin panel).
 */
export async function releaseFunds(_dealId: string): Promise<void> {
  // Funds release is an admin operation handled in the admin panel.
  // Wire this to a /api/secure-deals/:dealId/release endpoint when needed.
  console.log("[transactions] releaseFunds — admin operation; use admin panel");
}
