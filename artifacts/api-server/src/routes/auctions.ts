/**
 * Auction & Bid routes
 *
 * GET  /api/auctions          — list all active/upcoming auctions
 * GET  /api/auctions/:id      — single auction with top bids
 * POST /api/bids              — place a bid (requires auth)
 */

import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../lib/supabase";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { notifyOutbid } from "../lib/notifications";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true when the auction window is currently open */
function isAuctionActive(startsAt: string | null, endsAt: string): boolean {
  const now = Date.now();
  const end = new Date(endsAt).getTime();
  if (now >= end) return false;
  if (startsAt) {
    const start = new Date(startsAt).getTime();
    if (now < start) return false;
  }
  return true;
}

// ─── GET /api/auctions ────────────────────────────────────────────────────────

router.get("/auctions", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("auctions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    logger.error({ err: error }, "GET /auctions failed");
    res.status(500).json({ error: "FETCH_FAILED", message: error.message });
    return;
  }

  res.json({ auctions: data ?? [] });
});

// ─── GET /api/auctions/:id ────────────────────────────────────────────────────

router.get("/auctions/:id", async (req, res) => {
  const { id } = req.params;

  const [auctionResult, bidsResult] = await Promise.all([
    supabaseAdmin
      .from("auctions")
      .select("*")
      .eq("id", id)
      .single(),

    supabaseAdmin
      .from("bids")
      .select("id, user_id, amount, created_at")
      .eq("auction_id", id)
      .order("amount", { ascending: false })
      .limit(20),
  ]);

  if (auctionResult.error || !auctionResult.data) {
    res.status(404).json({ error: "NOT_FOUND", message: "Auction not found" });
    return;
  }

  res.json({
    auction: auctionResult.data,
    bids: bidsResult.data ?? [],
  });
});

// ─── POST /api/bids ───────────────────────────────────────────────────────────

const placeBidSchema = z.object({
  auctionId: z.string().uuid("auctionId must be a valid UUID"),
  amount: z
    .number()
    .int("Amount must be an integer (cents)")
    .positive("Amount must be positive"),
});

router.post("/bids", requireAuth, async (req, res) => {
  // 1. Validate request body
  const parsed = placeBidSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "Invalid request body",
    });
    return;
  }

  const { auctionId, amount } = parsed.data;
  const userId = req.user!.id;

  // 2. Fetch auction (include title for notification message)
  const { data: auction, error: auctionErr } = await supabaseAdmin
    .from("auctions")
    .select("id, seller_id, current_bid, min_increment, starts_at, ends_at, bid_count, title")
    .eq("id", auctionId)
    .single();

  if (auctionErr || !auction) {
    res.status(404).json({ error: "AUCTION_NOT_FOUND", message: "Auction not found" });
    return;
  }

  // 3. Auction must be active
  if (!isAuctionActive(auction.starts_at, auction.ends_at)) {
    res.status(409).json({
      error: "AUCTION_NOT_ACTIVE",
      message: "This auction is not currently accepting bids",
    });
    return;
  }

  // 4. Seller cannot bid on own auction
  if (auction.seller_id === userId) {
    res.status(403).json({
      error: "SELLER_CANNOT_BID",
      message: "You cannot bid on your own auction",
    });
    return;
  }

  // 5. Bid must be strictly greater than current price
  const minIncrement = auction.min_increment ?? 10;
  const minimumBid = auction.current_bid + minIncrement;

  if (amount < minimumBid) {
    res.status(422).json({
      error: "BID_TOO_LOW",
      message: `Bid must be at least ${minimumBid} cents (current: ${auction.current_bid}, increment: ${minIncrement})`,
      minimumBid,
      currentBid: auction.current_bid,
      minIncrement,
    });
    return;
  }

  // 6. Find the current leading bidder (for outbid notification after insert)
  const { data: prevLeader } = await supabaseAdmin
    .from("bids")
    .select("user_id")
    .eq("auction_id", auctionId)
    .order("amount", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 7. Insert bid
  const { data: newBid, error: bidErr } = await supabaseAdmin
    .from("bids")
    .insert({ auction_id: auctionId, user_id: userId, amount })
    .select("id, auction_id, user_id, amount, created_at")
    .single();

  if (bidErr || !newBid) {
    logger.error({ err: bidErr, auctionId, userId, amount }, "Bid insert failed");
    res.status(500).json({ error: "BID_INSERT_FAILED", message: "Failed to record bid" });
    return;
  }

  // 8. Update auction current_bid and bid_count atomically
  const { data: updatedAuction, error: updateErr } = await supabaseAdmin
    .from("auctions")
    .update({
      current_bid: amount,
      bid_count: auction.bid_count + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", auctionId)
    .select("id, current_bid, bid_count, min_increment, ends_at")
    .single();

  if (updateErr || !updatedAuction) {
    logger.error({ err: updateErr, auctionId }, "Auction current_bid update failed after bid insert");
  }

  // 9. Fire outbid notification (fire-and-forget, non-fatal)
  if (prevLeader && prevLeader.user_id !== userId) {
    void notifyOutbid(
      prevLeader.user_id,
      auctionId,
      (auction as any).title ?? "this auction",
      amount,
    );
  }

  logger.info({ bidId: newBid.id, auctionId, userId, amount }, "Bid placed successfully");

  res.status(201).json({
    bid: newBid,
    auction: updatedAuction ?? { id: auctionId, current_bid: amount, bid_count: auction.bid_count + 1 },
  });
});

export default router;
