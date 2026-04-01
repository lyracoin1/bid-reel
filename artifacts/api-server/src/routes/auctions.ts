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

// ─── POST /api/auctions ───────────────────────────────────────────────────────

const VALID_CATEGORIES = [
  "electronics", "fashion", "collectibles", "home_and_garden",
  "vehicles", "jewelry", "art", "sports", "other",
] as const;

/**
 * Detects phone numbers or WhatsApp contact attempts in user-supplied text.
 *
 * Catches:
 *   - Raw phone digits: +14155550123, 07911 123456, (555) 867-5309
 *   - WhatsApp keywords: "whatsapp", "wa.me", "wa " followed by digits
 *   - Telegram / contact-me solicitations (belt-and-suspenders)
 *
 * Contact is handled by the server via GET /api/auctions/:id/contact —
 * phone numbers must never appear in auction content.
 */
const CONTACT_PATTERNS = [
  /\bwhatsapp\b/i,
  /\bwa\.me\b/i,
  /\bwa\s*[+\d]/i,
  /\btelegram\b/i,
  /(?<!\d)(\+?1?\s*[\-.(]?\d{3}[\-.)\s]?\s*\d{3}[\-.\s]?\d{4})(?!\d)/,  // North-American
  /(?<!\d)\+\d[\d\s\-().]{6,14}\d(?!\d)/,                                  // International E.164-ish
];

function containsContactInfo(text: string): boolean {
  return CONTACT_PATTERNS.some((pattern) => pattern.test(text));
}

const createAuctionSchema = z.object({
  title: z
    .string()
    .min(3, "Title must be at least 3 characters")
    .max(80, "Title must be 80 characters or fewer"),
  description: z
    .string()
    .max(500, "Description must be 500 characters or fewer")
    .optional(),
  category: z.enum(VALID_CATEGORIES, {
    errorMap: () => ({ message: `Category must be one of: ${VALID_CATEGORIES.join(", ")}` }),
  }),
  startPrice: z
    .number()
    .positive("Start price must be greater than 0"),
  minIncrement: z
    .number()
    .positive("Minimum increment must be greater than 0")
    .optional()
    .default(10),
  videoUrl: z.string().url("videoUrl must be a valid URL"),
  thumbnailUrl: z.string().url("thumbnailUrl must be a valid URL"),
});

// Columns returned to the client — never expose internal/deleted fields.
const AUCTION_SELECT = [
  "id", "seller_id", "title", "description", "category",
  "start_price", "current_bid", "min_increment",
  "video_url", "thumbnail_url",
  "bid_count", "like_count", "status",
  "starts_at", "ends_at", "created_at",
].join(", ");

router.post("/auctions", requireAuth, async (req, res) => {
  const parsed = createAuctionSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "Invalid request body",
    });
    return;
  }

  const { title, description, category, startPrice, minIncrement, videoUrl, thumbnailUrl } =
    parsed.data;
  const sellerId = req.user!.id;

  // ── Content safety: no phone numbers or WhatsApp contact info ──────────────
  if (description && containsContactInfo(description)) {
    res.status(422).json({
      error: "CONTACT_INFO_FORBIDDEN",
      message:
        "Descriptions must not include phone numbers or contact handles. " +
        "Buyers contact sellers through the in-app contact feature after the auction ends.",
    });
    return;
  }

  if (containsContactInfo(title)) {
    res.status(422).json({
      error: "CONTACT_INFO_FORBIDDEN",
      message: "Titles must not include phone numbers or contact handles.",
    });
    return;
  }

  // ── Timestamps ─────────────────────────────────────────────────────────────
  const endsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  // Media purge starts 7 days after auction ends (video), 14 days (thumbnail).
  // media_purge_after is the Phase-1 threshold; Phase-2 = purge_after + 7d.
  const mediaPurgeAfter = new Date(endsAt.getTime() + 7 * 24 * 60 * 60 * 1000);

  const { data: auction, error } = await supabaseAdmin
    .from("auctions")
    .insert({
      seller_id: sellerId,
      title,
      description: description ?? null,
      category,
      start_price: startPrice,
      current_bid: startPrice,
      min_increment: minIncrement,
      video_url: videoUrl,
      thumbnail_url: thumbnailUrl,
      ends_at: endsAt.toISOString(),
      media_purge_after: mediaPurgeAfter.toISOString(),
    })
    .select(AUCTION_SELECT)
    .single();

  if (error || !auction) {
    logger.error({ err: error }, "POST /auctions failed");
    res.status(500).json({
      error: "CREATE_FAILED",
      message: error?.message ?? "Failed to create auction",
    });
    return;
  }

  logger.info({ auctionId: auction.id, sellerId }, "Auction created");
  res.status(201).json({ auction });
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

// ─── POST /api/auctions/:id/bids ─────────────────────────────────────────────
// Place a bid on a specific auction. auctionId comes from the URL, not the body.

const auctionBidSchema = z.object({
  amount: z
    .number()
    .int("Amount must be an integer (cents)")
    .positive("Amount must be positive"),
});

router.post("/auctions/:id/bids", requireAuth, async (req, res) => {
  const auctionId = req.params["id"];
  const userId = req.user!.id;

  const parsed = auctionBidSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "Invalid request body",
    });
    return;
  }

  const { amount } = parsed.data;

  const { data: auction, error: auctionErr } = await supabaseAdmin
    .from("auctions")
    .select("id, seller_id, current_bid, min_increment, starts_at, ends_at, bid_count, title")
    .eq("id", auctionId)
    .single();

  if (auctionErr || !auction) {
    res.status(404).json({ error: "AUCTION_NOT_FOUND", message: "Auction not found" });
    return;
  }

  if (!isAuctionActive(auction.starts_at, auction.ends_at)) {
    res.status(409).json({
      error: "AUCTION_NOT_ACTIVE",
      message: "This auction is not currently accepting bids",
    });
    return;
  }

  if (auction.seller_id === userId) {
    res.status(403).json({
      error: "SELLER_CANNOT_BID",
      message: "You cannot bid on your own auction",
    });
    return;
  }

  const minIncrement = auction.min_increment ?? 10;
  const minimumBid = auction.current_bid + minIncrement;

  if (amount < minimumBid) {
    res.status(422).json({
      error: "BID_TOO_LOW",
      message: `Bid must be at least ${minimumBid} (current: ${auction.current_bid}, increment: ${minIncrement})`,
      minimumBid,
      currentBid: auction.current_bid,
      minIncrement,
    });
    return;
  }

  const { data: prevLeader } = await supabaseAdmin
    .from("bids")
    .select("user_id")
    .eq("auction_id", auctionId)
    .order("amount", { ascending: false })
    .limit(1)
    .maybeSingle();

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

  const { data: updatedAuction } = await supabaseAdmin
    .from("auctions")
    .update({
      current_bid: amount,
      bid_count: auction.bid_count + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", auctionId)
    .select("id, current_bid, bid_count, ends_at")
    .single();

  if (prevLeader && prevLeader.user_id !== userId) {
    void notifyOutbid(
      prevLeader.user_id,
      auctionId,
      (auction as any).title ?? "this auction",
      amount,
    );
  }

  logger.info({ bidId: newBid.id, auctionId, userId, amount }, "Bid placed via /auctions/:id/bids");

  res.status(201).json({
    bid: newBid,
    auction: updatedAuction ?? {
      id: auctionId,
      current_bid: amount,
      bid_count: auction.bid_count + 1,
    },
  });
});

export default router;
