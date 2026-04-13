/**
 * auction-lifecycle.ts — Auction expiration and winner assignment
 *
 * expireAuctions()
 *   Scans for active auctions whose ends_at has passed, marks them
 *   as 'ended', and records the winner (highest bid holder).
 *
 *   Execution model: triggered on-demand before reads/writes that depend
 *   on auction status. No cron required.
 *
 *   Idempotency: the UPDATE is guarded with .eq("status", "active") so
 *   concurrent or duplicate calls are safe — already-ended auctions are
 *   never touched again.
 *
 *   Batch cap: processes at most 50 expired auctions per call to avoid
 *   unbounded latency.
 */

import { supabaseAdmin } from "./supabase";
import { logger } from "./logger";
import { getBidderCol, getBidderUserId, hasWinnerBidIdCol } from "./dbSchema";

/**
 * Expire all active auctions whose ends_at is in the past.
 *
 * For each expired auction:
 *   - status → 'ended'
 *   - winner_id → ID of the user who placed the highest bid (or null if no bids)
 *   - winner_bid_id → ID of the highest bid row (if migration 021 is applied)
 *
 * Safe to call concurrently and repeatedly — the UPDATE is guarded so only
 * auctions still in 'active' status are ever modified.
 */
export async function expireAuctions(): Promise<void> {
  const now = new Date().toISOString();

  // 1. Find active auctions that have passed their end time.
  const { data: expired, error: fetchErr } = await supabaseAdmin
    .from("auctions")
    .select("id")
    .eq("status", "active")
    .lt("ends_at", now)
    .limit(50);

  if (fetchErr) {
    logger.warn({ err: fetchErr.message }, "expireAuctions: fetch failed");
    return;
  }

  if (!expired || expired.length === 0) return;

  logger.info({ count: expired.length }, "expireAuctions: processing expired auctions");

  const bCol = await getBidderCol();
  const wbidColExists = await hasWinnerBidIdCol();

  for (const { id } of expired) {
    // 2. Find the highest bid for this auction (winner determination).
    //    Ordering by amount desc, then by created_at desc as tiebreaker
    //    ensures we always pick a deterministic winner.
    const { data: topBid, error: bidErr } = await supabaseAdmin
      .from("bids")
      .select(`id, ${bCol}, amount, created_at`)
      .eq("auction_id", id)
      .order("amount", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (bidErr) {
      logger.warn({ err: bidErr.message, auctionId: id }, "expireAuctions: bid fetch failed — skipping");
      continue;
    }

    // 3. Build the update patch.
    const patch: Record<string, unknown> = { status: "ended" };

    if (topBid) {
      const winnerId = getBidderUserId(topBid);
      if (winnerId) {
        patch["winner_id"] = winnerId;
        if (wbidColExists) patch["winner_bid_id"] = topBid.id;
      }
    }

    // 4. Atomic update — .eq("status", "active") makes this idempotent.
    //    If the auction was already ended by a concurrent call, this is a no-op.
    const { error: updateErr } = await supabaseAdmin
      .from("auctions")
      .update(patch)
      .eq("id", id)
      .eq("status", "active");

    if (updateErr) {
      logger.warn(
        { err: updateErr.message, auctionId: id },
        "expireAuctions: update failed",
      );
    } else {
      logger.info(
        {
          auctionId: id,
          winnerId: patch["winner_id"] ?? null,
          winnerBidId: patch["winner_bid_id"] ?? null,
        },
        "expireAuctions: auction ended",
      );
    }
  }
}
