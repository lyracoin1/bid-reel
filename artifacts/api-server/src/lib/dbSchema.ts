/**
 * dbSchema.ts — Runtime schema detection helpers
 *
 * The live Supabase database may be on different migration levels depending on
 * when it was first deployed. This module probes for column existence once per
 * server start and caches the result so every request uses the right column name.
 *
 * Handles:
 *   bids.bidder_id  (migration 005+)  vs  bids.user_id  (migration 002/004)
 */

import { supabaseAdmin } from "./supabase";
import { logger } from "./logger";

// ── Bids: bidder column name ──────────────────────────────────────────────────

let _bidderCol: "bidder_id" | "user_id" | null = null;

/**
 * Returns the correct column name for the bidder in the bids table.
 * Probes the DB once per server start; subsequent calls are synchronous-fast.
 */
export async function getBidderCol(): Promise<"bidder_id" | "user_id"> {
  if (_bidderCol !== null) return _bidderCol;

  const { error } = await supabaseAdmin
    .from("bids")
    .select("bidder_id")
    .limit(0);

  _bidderCol = error?.code === "42703" ? "user_id" : "bidder_id";
  logger.info({ col: _bidderCol }, "bids: detected bidder column name");
  return _bidderCol;
}

/**
 * Given a bid row (from select("*")), returns the bidder's user ID
 * regardless of whether the column is named bidder_id or user_id.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getBidderUserId(bid: any): string {
  return bid.bidder_id ?? bid.user_id ?? null;
}
