/**
 * transactions.ts
 *
 * Client-side helpers for the Secure Deals (transactions) feature.
 *
 * All reads and writes go through the BidReel API server:
 *   GET  /api/secure-deals/:dealId       — load deal (+ seller_name)
 *   POST /api/secure-deals               — seller creates deal
 *   POST /api/transactions/pay-now       — buyer pays
 *   PATCH /api/secure-deals/:dealId/ship — seller updates shipment
 *
 * PAYMENT GATEWAY INTEGRATION POINT
 *   POST /api/transactions/pay-now currently performs a placeholder charge.
 *   Replace the gateway block in artifacts/api-server/src/routes/secure-deals.ts
 *   with the real call (Google Play Billing / Stripe / etc.) before going live.
 */

import { API_BASE, getToken } from "./api-client";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PaymentStatus  = "pending" | "secured" | "refunded";
export type ShipmentStatus = "pending" | "verified" | "delivered";

export interface Transaction {
  deal_id:         string;
  seller_id:       string;
  /** Resolved from Supabase profiles by the api-server; null if not found. */
  seller_name:     string | null;
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
 * The response includes `seller_name` resolved by the api-server.
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
 * Mark a transaction as payment-secured.
 *
 * Calls POST /api/transactions/pay-now with the exact body shape:
 *   { deal_id, buyer_id, amount, currency }
 *
 * PAYMENT GATEWAY NOTE:
 *   The real gateway charge lives in api-server/src/routes/secure-deals.ts.
 *   Replace the placeholder `gatewaySuccess = true` block there before going live.
 */
export async function updatePaymentStatus(
  dealId:   string,
  buyerId:  string,
  amount:   number,
  currency: string,
): Promise<void> {
  const res = await apiFetch("/transactions/pay-now", {
    method: "POST",
    body: JSON.stringify({
      deal_id:  dealId,
      buyer_id: buyerId,
      amount,
      currency,
    }),
  }, true);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message ?? `Payment failed (${res.status})`);
  }

  console.log("[transactions] Payment secured via /transactions/pay-now:", { dealId, buyerId, amount, currency });
}

/**
 * Placeholder notification log — the real FCM / Email notification fires
 * server-side inside the /api/transactions/pay-now route handler.
 */
export function sendPaymentNotification(
  dealId:   string,
  buyerId:  string,
  amount:   number,
  currency: string,
): void {
  console.log("[notify] server-side notification triggered for payment:", {
    dealId, buyerId, amount, currency,
    note: "Real FCM/Email fires in api-server/src/routes/secure-deals.ts → sendNotificationPlaceholder()",
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
 * Mark funds as released (admin action — handled via admin panel).
 * Wire this to a /api/secure-deals/:dealId/release endpoint when needed.
 */
export async function releaseFunds(_dealId: string): Promise<void> {
  console.log("[transactions] releaseFunds — admin operation; use admin panel");
}
