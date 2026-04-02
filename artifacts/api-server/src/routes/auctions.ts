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
import { getBidderCol, getBidderUserId } from "../lib/dbSchema";

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

// ─── Schema-agnostic helpers (handles both old and new column names) ───────────
// The live DB may have either:
//   OLD: current_price / minimum_increment
//   NEW: current_bid  / min_increment        (after migration 009)
// All bid/auction logic goes through these helpers so it works with both.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getCurrentBid(a: any): number {
  return a.current_bid ?? a.current_price ?? 0;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMinIncrement(a: any): number {
  return a.min_increment ?? a.minimum_increment ?? 10;
}
/** Returns the correct column name for the price field in this DB row */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function priceColName(a: any): string {
  return "current_bid" in a ? "current_bid" : "current_price";
}

/**
 * Insert an auction row — tries new column names (current_bid, min_increment)
 * first; if the DB returns a "column does not exist" (42703) error it retries
 * with the old names (current_price, minimum_increment).
 */
async function insertAuction(payload: {
  seller_id: string;
  title: string;
  description: string | null;
  category: string;
  start_price: number;
  start_price_value: number;
  min_increment_value: number;
  video_url: string;
  thumbnail_url: string;
  ends_at: string;
  media_purge_after: string;
  lat?: number;
  lng?: number;
  currency_code?: string;
  currency_label?: string;
}) {
  const {
    start_price_value, min_increment_value, media_purge_after,
    lat, lng, currency_code, currency_label,
    ...base
  } = payload;

  // PostgREST returns PGRST204 for "column not in schema cache"; Postgres returns 42703.
  const isColErr = (code: string | undefined) =>
    code === "PGRST204" || code === "42703";

  const locationFields = lat !== undefined && lng !== undefined ? { lat, lng } : {};
  const currencyFields = {
    currency_code: currency_code ?? "USD",
    currency_label: currency_label ?? "US Dollar",
  };

  // Attempt 1: new schema + lat/lng + media_purge_after + currency
  const a1 = await supabaseAdmin
    .from("auctions")
    .insert({
      ...base,
      current_bid: start_price_value,
      min_increment: min_increment_value,
      media_purge_after,
      ...locationFields,
      ...currencyFields,
    })
    .select("*")
    .single();

  if (!a1.error) return a1;
  if (!isColErr(a1.error.code)) return a1;

  // Fallback A: without lat/lng (currency columns exist but lat/lng may not)
  logger.warn({ code: a1.error.code, msg: a1.error.message }, "Schema fallback A: retrying without lat/lng (keeping currency)");
  const a2 = await supabaseAdmin
    .from("auctions")
    .insert({
      ...base,
      current_bid: start_price_value,
      min_increment: min_increment_value,
      media_purge_after,
      ...currencyFields,
    })
    .select("*")
    .single();

  if (!a2.error) return a2;
  if (!isColErr(a2.error.code)) return a2;

  // Fallback B: without currency (currency columns not yet migrated) — keep lat/lng
  logger.warn({ code: a2.error.code, msg: a2.error.message }, "Schema fallback B: retrying without currency fields (keeping lat/lng)");
  const a2b = await supabaseAdmin
    .from("auctions")
    .insert({
      ...base,
      current_bid: start_price_value,
      min_increment: min_increment_value,
      media_purge_after,
      ...locationFields,
    })
    .select("*")
    .single();

  if (!a2b.error) return a2b;
  if (!isColErr(a2b.error.code)) return a2b;

  // Fallback C: without lat/lng or currency
  logger.warn({ code: a2b.error.code, msg: a2b.error.message }, "Schema fallback C: retrying without lat/lng or currency");
  const a3 = await supabaseAdmin
    .from("auctions")
    .insert({
      ...base,
      current_bid: start_price_value,
      min_increment: min_increment_value,
      media_purge_after,
    })
    .select("*")
    .single();

  if (!a3.error) return a3;
  if (!isColErr(a3.error.code)) return a3;

  // Fallback C: without media_purge_after
  logger.warn({ code: a3.error.code, msg: a3.error.message }, "Schema fallback C: retrying without media_purge_after");
  const a4 = await supabaseAdmin
    .from("auctions")
    .insert({
      ...base,
      current_bid: start_price_value,
      min_increment: min_increment_value,
    })
    .select("*")
    .single();

  if (!a4.error) return a4;
  if (!isColErr(a4.error.code)) return a4;

  // Fallback D: old schema names (current_price, minimum_increment)
  logger.warn({ code: a4.error.code, msg: a4.error.message }, "Schema fallback D: using old column names (current_price, minimum_increment)");
  return supabaseAdmin
    .from("auctions")
    .insert({
      ...base,
      current_price: start_price_value,
      minimum_increment: min_increment_value,
    })
    .select("*")
    .single();
}

// ─── GET /api/auctions ────────────────────────────────────────────────────────

/** Normalize a raw auction DB row so the API always returns consistent field names */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeAuction(a: any): any {
  const currentBid = getCurrentBid(a);
  const minInc = getMinIncrement(a);
  return {
    ...a,
    current_bid: currentBid,
    min_increment: minInc,
  };
}

router.get("/auctions", async (req, res) => {
  // select("*") is intentional — avoids hard-coding column names that may
  // not yet exist in partially-migrated databases.
  const { data: auctions, error } = await supabaseAdmin
    .from("auctions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    logger.error({ err: error }, "GET /auctions failed");
    res.status(500).json({ error: "FETCH_FAILED", message: error.message });
    return;
  }

  // Batch-fetch seller profiles so the client can display seller info
  const sellerIds = [...new Set((auctions ?? []).map((a) => a.seller_id))];
  const { data: profiles } = sellerIds.length > 0
    ? await supabaseAdmin
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", sellerIds)
    : { data: [] };

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  const auctionsWithSellers = (auctions ?? []).map((a) => ({
    ...normalizeAuction(a),
    seller: profileMap.get(a.seller_id) ?? null,
  }));

  logger.info({ count: auctionsWithSellers.length }, "GET /auctions → returning auctions");
  res.json({ auctions: auctionsWithSellers });
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
      .select("*")
      .eq("auction_id", id)
      .order("amount", { ascending: false })
      .limit(20),
  ]);

  if (auctionResult.error || !auctionResult.data) {
    res.status(404).json({ error: "NOT_FOUND", message: "Auction not found" });
    return;
  }

  const auctionData = auctionResult.data;
  const bids = bidsResult.data ?? [];

  // Batch-fetch profiles for seller + all bidders in one round-trip
  const profileIds = [...new Set([
    auctionData.seller_id,
    ...bids.map((b) => getBidderUserId(b)).filter(Boolean),
  ])];

  const { data: profiles } = profileIds.length > 0
    ? await supabaseAdmin
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", profileIds)
    : { data: [] };

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  const auctionWithSeller = {
    ...normalizeAuction(auctionData),
    seller: profileMap.get(auctionData.seller_id) ?? null,
  };

  const bidsWithBidders = bids.map((b) => ({
    ...b,
    bidder: profileMap.get(getBidderUserId(b)) ?? null,
  }));

  logger.info({ auctionId: id, bidCount: bids.length }, "GET /auctions/:id → returning detail");
  res.json({
    auction: auctionWithSeller,
    bids: bidsWithBidders,
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
  lat: z
    .number({ required_error: "lat is required — location must be granted before publishing" })
    .min(-90).max(90),
  lng: z
    .number({ required_error: "lng is required — location must be granted before publishing" })
    .min(-180).max(180),
  currencyCode: z.string().max(10).optional().default("USD"),
  currencyLabel: z.string().max(60).optional().default("US Dollar"),
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

  const { title, description, category, startPrice, minIncrement, videoUrl, thumbnailUrl, lat, lng, currencyCode, currencyLabel } =
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
  const mediaPurgeAfter = new Date(endsAt.getTime() + 7 * 24 * 60 * 60 * 1000);

  const { data: auction, error } = await insertAuction({
    seller_id: sellerId,
    title,
    description: description ?? null,
    category,
    start_price: startPrice,
    start_price_value: startPrice,
    min_increment_value: minIncrement,
    video_url: videoUrl,
    thumbnail_url: thumbnailUrl,
    ends_at: endsAt.toISOString(),
    media_purge_after: mediaPurgeAfter.toISOString(),
    lat,
    lng,
    currency_code: currencyCode,
    currency_label: currencyLabel,
  });

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

// ─── DELETE /api/auctions/:id ─────────────────────────────────────────────────
// Soft-deletes an auction by setting status = 'removed'.
// Only the auction's seller may call this endpoint.
// ─────────────────────────────────────────────────────────────────────────────

router.delete("/auctions/:id", requireAuth, async (req, res) => {
  const auctionId = req.params["id"];
  const userId = req.user!.id;

  if (!auctionId) {
    res.status(400).json({ error: "MISSING_ID", message: "Auction ID is required" });
    return;
  }

  const { data: auction, error: fetchErr } = await supabaseAdmin
    .from("auctions")
    .select("id, seller_id, status")
    .eq("id", auctionId)
    .maybeSingle();

  if (fetchErr || !auction) {
    res.status(404).json({ error: "NOT_FOUND", message: "Auction not found" });
    return;
  }

  if (auction.seller_id !== userId) {
    res.status(403).json({
      error: "FORBIDDEN",
      message: "Only the auction owner can delete this listing",
    });
    return;
  }

  const { error: updateErr } = await supabaseAdmin
    .from("auctions")
    .update({ status: "removed" })
    .eq("id", auctionId);

  if (updateErr) {
    logger.error({ err: updateErr, auctionId, userId }, "Failed to delete auction");
    res.status(500).json({ error: "DELETE_FAILED", message: "Could not delete auction" });
    return;
  }

  logger.info({ auctionId, userId }, "Auction soft-deleted (status=removed)");
  res.json({ success: true });
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

  // 2. Fetch auction using select("*") so it works with old and new schema
  const { data: auction, error: auctionErr } = await supabaseAdmin
    .from("auctions")
    .select("*")
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

  // 5. Bid must be strictly greater than current price (schema-agnostic)
  const curBid = getCurrentBid(auction);
  const minIncrement = getMinIncrement(auction);
  const minimumBid = curBid + minIncrement;

  if (amount < minimumBid) {
    res.status(422).json({
      error: "BID_TOO_LOW",
      message: `Bid must be at least ${minimumBid} (current: ${curBid}, increment: ${minIncrement})`,
      minimumBid,
      currentBid: curBid,
      minIncrement,
    });
    return;
  }

  // 6. Find the current leading bidder (for outbid notification after insert)
  const bCol = await getBidderCol();
  const { data: prevLeader } = await supabaseAdmin
    .from("bids")
    .select(bCol)
    .eq("auction_id", auctionId)
    .order("amount", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 7. Insert bid — use the column name that actually exists in this DB
  const { data: newBid, error: bidErr } = await supabaseAdmin
    .from("bids")
    .insert({ auction_id: auctionId, [bCol]: userId, amount })
    .select(`id, auction_id, ${bCol}, amount`)
    .single();

  if (bidErr || !newBid) {
    logger.error({ err: bidErr, auctionId, userId, amount }, "Bid insert failed");
    res.status(500).json({ error: "BID_INSERT_FAILED", message: "Failed to record bid" });
    return;
  }

  // 8. Update the price counter using the column name that actually exists in this DB
  const priceCol = priceColName(auction);
  const { data: updatedAuction, error: updateErr } = await supabaseAdmin
    .from("auctions")
    .update({
      [priceCol]: amount,
      bid_count: auction.bid_count + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", auctionId)
    .select("*")
    .single();

  if (updateErr || !updatedAuction) {
    logger.error({ err: updateErr, auctionId }, "Auction price update failed after bid insert");
  }

  // 9. Fire outbid notification (fire-and-forget, non-fatal)
  const prevLeaderUserId = prevLeader ? getBidderUserId(prevLeader) : null;
  if (prevLeaderUserId && prevLeaderUserId !== userId) {
    void notifyOutbid(
      prevLeaderUserId,
      auctionId,
      auction.title ?? "this auction",
      amount,
    );
  }

  const returnedAuction = updatedAuction ?? {
    id: auctionId,
    current_bid: amount,
    bid_count: auction.bid_count + 1,
  };

  logger.info({ bidId: newBid.id, auctionId, userId, amount }, "Bid placed successfully");

  res.status(201).json({
    bid: newBid,
    auction: {
      ...returnedAuction,
      // Always expose as current_bid for the frontend regardless of schema
      current_bid: getCurrentBid(returnedAuction),
      bid_count: returnedAuction.bid_count,
    },
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

  // select("*") works with both old and new schema column names
  const { data: auction, error: auctionErr } = await supabaseAdmin
    .from("auctions")
    .select("*")
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

  const curBid2 = getCurrentBid(auction);
  const minIncrement2 = getMinIncrement(auction);
  const minimumBid2 = curBid2 + minIncrement2;

  if (amount < minimumBid2) {
    res.status(422).json({
      error: "BID_TOO_LOW",
      message: `Bid must be at least ${minimumBid2} (current: ${curBid2}, increment: ${minIncrement2})`,
      minimumBid: minimumBid2,
      currentBid: curBid2,
      minIncrement: minIncrement2,
    });
    return;
  }

  const bCol2 = await getBidderCol();
  const { data: prevLeader2 } = await supabaseAdmin
    .from("bids")
    .select(bCol2)
    .eq("auction_id", auctionId)
    .order("amount", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: newBid, error: bidErr } = await supabaseAdmin
    .from("bids")
    .insert({ auction_id: auctionId, [bCol2]: userId, amount })
    .select(`id, auction_id, ${bCol2}, amount`)
    .single();

  if (bidErr || !newBid) {
    logger.error({ err: bidErr, auctionId, userId, amount }, "Bid insert failed");
    res.status(500).json({ error: "BID_INSERT_FAILED", message: "Failed to record bid" });
    return;
  }

  const priceCol2 = priceColName(auction);
  const { data: updatedAuction2 } = await supabaseAdmin
    .from("auctions")
    .update({
      [priceCol2]: amount,
      bid_count: auction.bid_count + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", auctionId)
    .select("*")
    .single();

  const prevLeaderUserId2 = prevLeader2 ? getBidderUserId(prevLeader2) : null;
  if (prevLeaderUserId2 && prevLeaderUserId2 !== userId) {
    void notifyOutbid(
      prevLeaderUserId2,
      auctionId,
      auction.title ?? "this auction",
      amount,
    );
  }

  logger.info({ bidId: newBid.id, auctionId, userId, amount }, "Bid placed via /auctions/:id/bids");

  const returned2 = updatedAuction2 ?? { id: auctionId, bid_count: auction.bid_count + 1 };
  res.status(201).json({
    bid: newBid,
    auction: {
      ...returned2,
      current_bid: getCurrentBid(returned2) || amount,
      bid_count: returned2.bid_count,
    },
  });
});

export default router;
