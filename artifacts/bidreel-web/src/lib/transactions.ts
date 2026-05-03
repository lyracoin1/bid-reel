/**
 * transactions.ts
 *
 * Client-side helpers for the Secure Deals (transactions) feature.
 *
 * All reads and writes go through the BidReel API server:
 *   GET  /api/secure-deals/:dealId            — load deal (+ seller_name)
 *   POST /api/secure-deals                    — seller creates deal
 *   POST /api/transactions/pay-now            — buyer pays
 *   PATCH /api/secure-deals/:dealId/ship      — seller updates shipment
 *   POST /api/deal-conditions                 — buyer submits conditions
 *   GET  /api/deal-conditions/:dealId         — read submitted conditions
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
  /** Buyer-chosen open-price amount stored at payment time. May differ from price. */
  paid_amount:     number | null;
  shipment_status: ShipmentStatus;
  /** Set when buyer calls POST /api/confirm-receipt (Part #7). */
  confirmed_at:    string | null;
  funds_released:  boolean;
  payment_link:    string | null;
  release_date:    string | null;
  created_at:      string;
  updated_at:      string;
}

export type ConditionStatus = "pending" | "accepted" | "rejected";

export interface DealCondition {
  id:          string;
  deal_id:     string;
  buyer_id:    string;
  conditions:  string;
  status:      ConditionStatus;
  created_at:  string;
  updated_at:  string;
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
 * Calls POST /api/transactions/pay-now with the body:
 *   { deal_id, buyer_id, amount, currency [, purchase_token, product_id] }
 *
 * When playPurchase is provided the backend verifies the token with the
 * Google Play Developer API and uses priceAmountMicros as the authoritative
 * paid_amount. The returned paid_amount should be used for the UI instead of
 * the buyer-entered amount.
 *
 * Without playPurchase the backend falls back to the buyer-entered amount
 * (allowed only in development).
 */
export async function updatePaymentStatus(
  dealId:       string,
  buyerId:      string,
  amount:       number,
  currency:     string,
  playPurchase?: { purchase_token: string; product_id: string },
): Promise<{ paid_amount: number }> {
  const res = await apiFetch("/transactions/pay-now", {
    method: "POST",
    body: JSON.stringify({
      deal_id:  dealId,
      buyer_id: buyerId,
      amount,
      currency,
      ...(playPurchase ?? {}),
    }),
  }, true);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message ?? `Payment failed (${res.status})`);
  }

  const json = await res.json();
  const paid_amount: number = json?.deal?.paid_amount ?? amount;

  console.log("[transactions] Payment secured via /transactions/pay-now:", {
    dealId, buyerId, paid_amount, currency,
    via: playPurchase ? "Google Play Billing" : "placeholder",
  });

  return { paid_amount };
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

// ── Seller Conditions (seller-conditions) ────────────────────────────────────

export interface SellerCondition {
  id:          string;
  deal_id:     string;
  seller_id:   string;
  conditions:  string;
  status:      ConditionStatus;
  created_at:  string;
  updated_at:  string;
}

/**
 * Submit (or re-submit) seller conditions for a deal.
 * Calls POST /api/seller-conditions — requires auth (seller only).
 * A re-submission silently replaces the previous conditions row.
 * Throws if the request fails or the server returns an error.
 */
export async function submitSellerConditions(
  dealId:     string,
  conditions: string,
): Promise<SellerCondition> {
  const res = await apiFetch("/seller-conditions", {
    method: "POST",
    body:   JSON.stringify({ deal_id: dealId, conditions }),
  }, true);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message ?? `Failed to submit conditions (${res.status})`);
  }

  const { condition } = await res.json();
  return condition as SellerCondition;
}

/**
 * Fetch seller conditions for a deal.
 * Calls GET /api/seller-conditions/:dealId — requires auth.
 * Returns the seller's condition row or null if none submitted yet.
 * Returns null on 403 (caller not authorised) or 404 (deal not found).
 */
export async function getSellerConditions(
  dealId: string,
): Promise<SellerCondition | null> {
  const res = await apiFetch(
    `/seller-conditions/${encodeURIComponent(dealId)}`,
    {},
    true,
  );

  if (res.status === 403 || res.status === 404) return null;

  if (!res.ok) {
    console.warn("[transactions] getSellerConditions error:", res.status);
    return null;
  }

  const { condition } = await res.json();
  return condition as SellerCondition | null;
}

// ── Payment Proof (payment-proof) ────────────────────────────────────────────

export interface PaymentProof {
  id:          string;
  deal_id:     string;
  buyer_id:    string;
  file_url:    string;
  file_name:   string;
  file_type:   string;
  file_size:   number | null;
  uploaded_at: string;
}

/**
 * Upload a payment proof file for a deal.
 * Sends the file as a raw binary body to POST /api/payment-proof.
 * Requires auth (buyer only).
 * Accepted formats: PDF, JPEG, PNG, WebP. Max 10 MB.
 * A re-upload silently replaces the previous proof in the DB (old R2 file orphaned).
 */
export async function uploadPaymentProof(
  dealId: string,
  file:   File,
): Promise<PaymentProof> {
  const buffer = await file.arrayBuffer();
  const res = await apiFetch(
    `/payment-proof?dealId=${encodeURIComponent(dealId)}&mimeType=${encodeURIComponent(file.type)}&fileName=${encodeURIComponent(file.name)}`,
    {
      method:  "POST",
      // Override default "application/json" so the server receives the correct MIME type
      headers: { "Content-Type": file.type },
      body:    buffer,
    },
    true,
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message ?? `Upload failed (${res.status})`);
  }

  const { proof } = await res.json();
  return proof as PaymentProof;
}

/**
 * Fetch the current payment proof for a deal.
 * Calls GET /api/payment-proof/:dealId — requires auth.
 * Returns null when no proof has been uploaded yet, or on 403/404.
 */
export async function getPaymentProof(dealId: string): Promise<PaymentProof | null> {
  const res = await apiFetch(
    `/payment-proof/${encodeURIComponent(dealId)}`,
    {},
    true,
  );

  if (res.status === 403 || res.status === 404) return null;

  if (!res.ok) {
    console.warn("[transactions] getPaymentProof error:", res.status);
    return null;
  }

  const { proof } = await res.json();
  return proof as PaymentProof | null;
}

// ── Deal Ratings (deal-ratings) ───────────────────────────────────────────────

export interface DealRating {
  id:         string;
  deal_id:    string;
  rater_id:   string;
  ratee_id:   string;
  stars:      number;
  comment:    string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Submit a rating for the other deal participant.
 * Calls POST /api/deal-ratings — requires auth.
 * Only allowed after the deal reaches the 'delivered' terminal state.
 * Throws a typed error if the server rejects the request.
 */
export async function submitDealRating(
  dealId:   string,
  rateeId:  string,
  stars:    number,
  comment?: string,
): Promise<DealRating> {
  const res = await apiFetch("/deal-ratings", {
    method: "POST",
    body:   JSON.stringify({ deal_id: dealId, ratee_id: rateeId, stars, comment }),
  }, true);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message ?? `Failed to submit rating (${res.status})`);
  }

  const { rating } = await res.json();
  return rating as DealRating;
}

/**
 * Fetch all ratings submitted for a deal.
 * Calls GET /api/deal-ratings/:dealId — requires auth.
 * Returns an empty array on 403/404 (caller not a participant, or deal not found).
 */
export async function getDealRatings(dealId: string): Promise<DealRating[]> {
  const res = await apiFetch(
    `/deal-ratings/${encodeURIComponent(dealId)}`,
    {},
    true,
  );

  if (res.status === 403 || res.status === 404) return [];

  if (!res.ok) {
    console.warn("[transactions] getDealRatings error:", res.status);
    return [];
  }

  const { ratings } = await res.json();
  return (ratings ?? []) as DealRating[];
}

// ── Buyer Conditions (deal-conditions) ───────────────────────────────────────

/**
 * Submit (or re-submit) buyer conditions for a deal.
 * Calls POST /api/deal-conditions — requires auth.
 * A re-submission silently replaces the previous conditions row.
 * Throws if the request fails or the server returns an error.
 */
export async function submitDealConditions(
  dealId:     string,
  conditions: string,
): Promise<DealCondition> {
  const res = await apiFetch("/deal-conditions", {
    method: "POST",
    body:   JSON.stringify({ deal_id: dealId, conditions }),
  }, true);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message ?? `Failed to submit conditions (${res.status})`);
  }

  const { condition } = await res.json();
  return condition as DealCondition;
}

// ── Shipment Proof (shipment-proof) ──────────────────────────────────────────

export interface ShipmentProof {
  id:            string;
  deal_id:       string;
  seller_id:     string;
  file_url:      string;
  tracking_link: string;
  uploaded_at:   string;
}

/**
 * Upload a shipment proof file for a deal (seller only).
 * Sends the file as a raw binary body to POST /api/shipment-proof.
 * Also passes an optional tracking_link URL via query param.
 * Accepted formats: PDF, JPEG, PNG, WebP. Max 10 MB.
 * A re-upload upserts the DB row (old R2 file is orphaned).
 */
export async function uploadShipmentProof(
  dealId:       string,
  file:         File,
  trackingLink: string,
): Promise<ShipmentProof> {
  const buffer = await file.arrayBuffer();
  const res = await apiFetch(
    `/shipment-proof?dealId=${encodeURIComponent(dealId)}&mimeType=${encodeURIComponent(file.type)}&fileName=${encodeURIComponent(file.name)}&trackingLink=${encodeURIComponent(trackingLink)}`,
    {
      method:  "POST",
      headers: { "Content-Type": file.type },
      body:    buffer,
    },
    true,
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message ?? `Upload failed (${res.status})`);
  }

  const { proof } = await res.json();
  return proof as ShipmentProof;
}

/**
 * Fetch the current shipment proof for a deal.
 * Calls GET /api/shipment-proof/:dealId — requires auth.
 * Returns null when no proof has been uploaded yet, or on 403/404.
 */
export async function getShipmentProof(dealId: string): Promise<ShipmentProof | null> {
  const res = await apiFetch(
    `/shipment-proof/${encodeURIComponent(dealId)}`,
    {},
    true,
  );

  if (res.status === 403 || res.status === 404) return null;

  if (!res.ok) {
    console.warn("[transactions] getShipmentProof error:", res.status);
    return null;
  }

  const { proof } = await res.json();
  return proof as ShipmentProof | null;
}

// ── Delivery Proof (Part #8) ─────────────────────────────────────────────────

export interface DeliveryProof {
  id:          string;
  deal_id:     string;
  buyer_id:    string;
  file_url:    string;
  uploaded_at: string;
}

/**
 * Upload a delivery proof file for a deal (buyer only).
 * Sends the file as a raw binary body to POST /api/delivery-proof.
 * Accepted formats: PDF, JPEG, PNG, WebP. Max 10 MB.
 * A re-upload upserts the DB row (old R2 file is orphaned).
 */
export async function uploadDeliveryProof(
  dealId: string,
  file:   File,
): Promise<DeliveryProof> {
  const buffer = await file.arrayBuffer();
  const res = await apiFetch(
    `/delivery-proof?dealId=${encodeURIComponent(dealId)}&mimeType=${encodeURIComponent(file.type)}&fileName=${encodeURIComponent(file.name)}`,
    {
      method:  "POST",
      headers: { "Content-Type": file.type },
      body:    buffer,
    },
    true,
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message ?? `Upload failed (${res.status})`);
  }

  const { proof } = await res.json();
  return proof as DeliveryProof;
}

/**
 * Fetch the current delivery proof for a deal.
 * Calls GET /api/delivery-proof/:dealId — requires auth.
 * Returns null when no proof has been uploaded yet, or on 403/404.
 */
export async function getDeliveryProof(dealId: string): Promise<DeliveryProof | null> {
  const res = await apiFetch(
    `/delivery-proof/${encodeURIComponent(dealId)}`,
    {},
    true,
  );

  if (res.status === 403 || res.status === 404) return null;

  if (!res.ok) {
    console.warn("[transactions] getDeliveryProof error:", res.status);
    return null;
  }

  const { proof } = await res.json();
  return proof as DeliveryProof | null;
}

// ── Shipping Fee Dispute (Part #9) ───────────────────────────────────────────

export interface ShippingFeeDispute {
  id:           string;
  deal_id:      string;
  submitted_by: string;
  /** Who the submitter claims should pay the shipping fee. */
  party:        "buyer" | "seller";
  proof_url:    string | null;
  comment:      string | null;
  created_at:   string;
}

/**
 * Create or update a shipping fee dispute for a deal.
 * Calls POST /api/shipping-fee-dispute — requires auth.
 * Re-submitting for the same deal_id + user upserts the existing row.
 * Throws if the server rejects the request (not participant, payment not secured, etc.).
 */
export async function createShippingFeeDispute(
  dealId:    string,
  party:     "buyer" | "seller",
  comment?:  string,
  proofUrl?: string,
): Promise<ShippingFeeDispute> {
  const res = await apiFetch("/shipping-fee-dispute", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ deal_id: dealId, party, comment, proof_url: proofUrl }),
  }, true);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message ?? `Failed to create dispute (${res.status})`);
  }

  const { dispute } = await res.json();
  return dispute as ShippingFeeDispute;
}

/**
 * Fetch all shipping fee disputes for a deal.
 * Calls GET /api/shipping-fee-dispute/:dealId — requires auth.
 * Returns [] if the caller is not a participant or the deal is not found.
 */
export async function getShippingFeeDisputes(dealId: string): Promise<ShippingFeeDispute[]> {
  const res = await apiFetch(
    `/shipping-fee-dispute/${encodeURIComponent(dealId)}`,
    {},
    true,
  );

  if (res.status === 403 || res.status === 404) return [];
  if (!res.ok) {
    console.warn("[transactions] getShippingFeeDisputes error:", res.status);
    return [];
  }

  const { disputes } = await res.json();
  return (disputes ?? []) as ShippingFeeDispute[];
}

// ── Confirm Receipt (Part #7) ─────────────────────────────────────────────────

export interface ConfirmReceiptResult {
  deal_id:           string;
  shipment_status:   string;
  confirmed_at:      string;
  already_confirmed: boolean;
}

/**
 * Buyer confirms they received the item, releasing funds to the seller.
 * Calls POST /api/confirm-receipt — requires auth.
 *
 * Idempotent: calling multiple times is safe.
 * Throws if the server responds with an error (not buyer, shipment not
 * verified, deal not found, etc.).
 */
export async function confirmReceipt(dealId: string): Promise<ConfirmReceiptResult> {
  const res = await apiFetch(
    `/confirm-receipt`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ deal_id: dealId }),
    },
    true,
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message ?? `Confirm receipt failed (${res.status})`);
  }

  return res.json() as Promise<ConfirmReceiptResult>;
}

/**
 * Fetch previously submitted conditions for a deal.
 * Calls GET /api/deal-conditions/:dealId — requires auth.
 * Returns the caller's own condition row (buyer) or all rows (seller).
 * Returns null if the caller has not submitted any conditions yet.
 */
export async function getDealConditions(
  dealId: string,
): Promise<DealCondition | null> {
  const res = await apiFetch(
    `/deal-conditions/${encodeURIComponent(dealId)}`,
    {},
    true,
  );

  if (res.status === 403 || res.status === 404) return null;

  if (!res.ok) {
    console.warn("[transactions] getDealConditions error:", res.status);
    return null;
  }

  const { conditions } = await res.json();
  const rows = conditions as DealCondition[];
  return rows.length > 0 ? rows[0] : null;
}
