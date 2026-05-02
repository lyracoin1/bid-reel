/**
 * transactions.ts
 *
 * Client-side helpers for the `transactions` table in Supabase.
 * All operations use the anon key + the authenticated user's JWT (RLS).
 *
 * Schema:
 *   deal_id, seller_id, product_name, price, currency, description,
 *   delivery_method, media_urls, terms, payment_status, shipment_status,
 *   funds_released, payment_link, release_date, created_at, updated_at
 */

import { supabase } from "./supabase";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PaymentStatus  = "pending" | "secured" | "refunded";
export type ShipmentStatus = "pending" | "verified" | "delivered";

export interface Transaction {
  deal_id:         string;
  seller_id:       string;
  product_name:    string;
  price:           number;
  currency:        string;
  description:     string | null;
  delivery_method: string;
  media_urls:      string[];
  terms:           string | null;
  payment_status:  PaymentStatus;
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
  return "BD-" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase().slice(0, 6);
}

/** Build the buyer-facing payment URL from the current origin + deal ID. */
export function buildPaymentLink(dealId: string): string {
  const origin =
    (import.meta.env.VITE_PUBLIC_BASE_URL as string | undefined)?.trim() ||
    window.location.origin;
  return `${origin.replace(/\/$/, "")}/secure-deals/pay/${dealId}`;
}

// ── DB operations ─────────────────────────────────────────────────────────────

/**
 * Insert a new secure deal into Supabase.
 * Throws if Supabase is not configured or the insert fails.
 */
export async function createTransaction(input: CreateTransactionInput): Promise<Transaction> {
  if (!supabase) throw new Error("Supabase not configured — check VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");

  const row = {
    deal_id:         input.deal_id,
    seller_id:       input.seller_id,
    product_name:    input.product_name,
    price:           input.price,
    currency:        input.currency,
    description:     input.description ?? null,
    delivery_method: input.delivery_method,
    media_urls:      input.media_urls ?? [],
    terms:           input.terms ?? null,
    payment_link:    input.payment_link,
    payment_status:  "pending" as PaymentStatus,
    shipment_status: "pending" as ShipmentStatus,
    funds_released:  false,
  };

  const { data, error } = await supabase
    .from("transactions")
    .insert(row)
    .select()
    .single();

  if (error) {
    console.error("[transactions] insert error:", error);
    throw new Error(error.message ?? "Failed to save deal");
  }

  return data as Transaction;
}

/**
 * Fetch a single transaction by deal_id.
 * Returns null if not found.
 */
export async function getTransaction(dealId: string): Promise<Transaction | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (error) {
    console.error("[transactions] fetch error:", error);
    return null;
  }

  return data as Transaction | null;
}

/**
 * Update shipment info (tracking link or doc, status).
 */
export async function updateShipment(
  dealId: string,
  patch: { shipment_status?: ShipmentStatus; tracking_link?: string },
): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase
    .from("transactions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("deal_id", dealId);

  if (error) console.error("[transactions] updateShipment error:", error);
}

/**
 * Mark funds as released for a deal.
 */
export async function releaseFunds(dealId: string): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase
    .from("transactions")
    .update({ funds_released: true, release_date: new Date().toISOString() })
    .eq("deal_id", dealId);

  if (error) console.error("[transactions] releaseFunds error:", error);
}
