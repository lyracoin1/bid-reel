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
import { notifyOutbid, notifyAuctionStarted } from "../lib/notifications";
import { getBidderCol, getBidderUserId, hasWinnerBidIdCol } from "../lib/dbSchema";
import { deleteMediaFile } from "../lib/media-lifecycle";
import { runAuctionLifecycle } from "../lib/auction-lifecycle";
import { processVideoAsync } from "../lib/video-processing";
import { assertOwnedMediaUrl } from "../lib/r2";
import { buildUserFeedContext, scoreAuction } from "../lib/feed-ranking";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getCurrentBid(a: any): number {
  return a.current_bid ?? 0;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMinIncrement(a: any): number {
  return a.min_increment ?? 10;
}

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

  const locationFields = lat !== undefined && lng !== undefined ? { lat, lng } : {};
  const currencyFields = {
    currency_code: currency_code ?? "USD",
    currency_label: currency_label ?? "US Dollar",
  };

  return supabaseAdmin
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
}

// ─── GET /api/auctions ────────────────────────────────────────────────────────

/** Normalize a raw auction DB row so the API always returns consistent field names */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeAuction(a: any): any {
  return {
    ...a,
    current_bid: getCurrentBid(a),
    min_increment: getMinIncrement(a),
  };
}

router.get("/auctions", async (req, res) => {
  // Run lifecycle cleanup before serving the list (fire-and-forget — does not
  // block the response; status changes will be accurate on the next fetch).
  // This handles both expiration (active → ended) and archival (ended → archived).
  void runAuctionLifecycle().catch(err =>
    logger.warn({ err: String(err) }, "GET /auctions: runAuctionLifecycle background call failed"),
  );

  // ── Pagination cursor ─────────────────────────────────────────────────────
  // The client passes ?before=<ISO timestamp> to fetch the next page.
  // Items are fetched in created_at DESC order so "before" means "older than".
  // Page size is 20 — small enough for fast initial load, large enough for variety.
  const PAGE_SIZE = 20;
  const before = typeof req.query.before === "string" && req.query.before.length > 0
    ? req.query.before
    : null;

  // Exclude soft-deleted ('removed') and archived auctions from the public feed.
  // Ended auctions are kept visible (they show as "ended" for up to 7 days).
  let dbQuery = supabaseAdmin
    .from("auctions")
    .select("*")
    .neq("status", "removed")
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (before) {
    dbQuery = dbQuery.lt("created_at", before);
  }

  const { data: auctions, error } = await dbQuery;

  if (error) {
    logger.error({ err: error }, "GET /auctions failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load auctions. Please try again." });
    return;
  }

  // Batch-fetch seller profiles so the client can display seller info
  const sellerIds = [...new Set((auctions ?? []).map((a) => a.seller_id))];
  const { data: profiles } = sellerIds.length > 0
    ? await supabaseAdmin
        .from("profiles")
        .select("id, username, display_name, avatar_url, phone")
        .in("id", sellerIds)
    : { data: [] };

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  // Base list — ordered by created_at DESC from the DB query (already stable).
  type AuctionWithMeta = ReturnType<typeof normalizeAuction> & {
    seller: (typeof profileMap extends Map<string, infer V> ? V : null) | null;
    user_signal: "interested" | "not_interested" | null;
  };

  // ── Cursor for next page ──────────────────────────────────────────────────
  // Captured from the RAW DB result (before signal re-ranking) so the client
  // can request the next page of older items without gaps or duplicates.
  // We return null when fewer than PAGE_SIZE items came back (= no more pages).
  const rawItems = auctions ?? [];
  const nextCursor: string | null = rawItems.length === PAGE_SIZE
    ? (rawItems[rawItems.length - 1].created_at as string)
    : null;

  let feed: AuctionWithMeta[] = rawItems.map((a) => ({
    ...normalizeAuction(a),
    seller: profileMap.get(a.seller_id) ?? null,
    user_signal: null as "interested" | "not_interested" | null,
  }));

  // ── Feed intelligence ranking (optional — skipped for unauthenticated) ──────
  //
  // Verifies the Bearer token without hard-requiring auth, so anonymous users
  // still get the default recency-ordered feed.
  //
  // For authenticated users, a weighted relevance score is computed per auction
  // using existing behavioural signals (no new tables needed):
  //
  //   EXACT_INTERESTED / NOT_INTERESTED   ±100   (explicit button press)
  //   User bid on this auction             +80   (strongest implicit positive)
  //   User saved this auction              +50
  //   User follows this seller             +30
  //   Seller interest signals              +8 each, capped at +20
  //   Seller bid history                   +8 each, capped at +15
  //   Category interest signals            +5 each, capped at +10
  //   Seller not-interested signals        −8 each, floor  −20
  //   Category not-interested signals      −5 each, floor  −10
  //
  // Array.sort is stable in V8 so equal-score items keep created_at DESC order.
  // Failures in any single data source degrade gracefully to empty (non-fatal).
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);

    if (user) {
      try {
        const ctx = await buildUserFeedContext(user.id);

        // Tag each auction with the user's exact signal for the frontend UI
        feed = feed.map((a) => ({
          ...a,
          user_signal: (ctx.allSignals.get((a as { id: string }).id) ?? null) as
            "interested" | "not_interested" | null,
        }));

        // Score and sort — stable sort preserves recency within equal scores
        const scores = new Map<string, number>();
        for (const item of feed) {
          const id         = (item as { id: string }).id;
          const seller_id  = (item as { seller_id: string }).seller_id;
          const category   = (item as { category: string }).category;
          scores.set(id, scoreAuction({ id, seller_id, category }, ctx));
        }
        feed.sort((a, b) =>
          (scores.get((b as { id: string }).id) ?? 0) -
          (scores.get((a as { id: string }).id) ?? 0),
        );

        logger.info(
          {
            userId:      user.id,
            signals:     ctx.allSignals.size,
            follows:     ctx.followedSellerIds.size,
            bids:        ctx.biddedAuctionIds.size,
            saves:       ctx.savedAuctionIds.size,
          },
          "GET /auctions → ranked with weighted intelligence model",
        );
      } catch (err) {
        // Ranking failed — return unranked (recency-ordered) feed rather than 500
        logger.warn(
          { err: String(err), userId: user.id },
          "GET /auctions: feed ranking failed — returning recency-ordered feed",
        );
      }
    }
  }

  logger.info({ count: feed.length, hasNextCursor: nextCursor !== null }, "GET /auctions → returning auctions");
  res.json({ auctions: feed, nextCursor });
});

// ─── GET /api/auctions/mine ───────────────────────────────────────────────────
// Returns the authenticated seller's own auctions.
// Filter: excludes only 'removed' — consistent with the auctionCount stat in
// fetchProfileStats (profiles.ts). Includes active, ended, and archived so the
// seller sees their full history. Not paginated (a single seller rarely has
// thousands of auctions), and not subject to the global feed's PAGE_SIZE cap.

router.get("/auctions/mine", requireAuth, async (req, res) => {
  const userId = req.user!.id;

  const { data: auctions, error } = await supabaseAdmin
    .from("auctions")
    .select("*")
    .eq("seller_id", userId)
    .neq("status", "removed")
    .order("created_at", { ascending: false });

  if (error) {
    logger.error({ err: error }, "GET /auctions/mine failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load your auctions. Please try again." });
    return;
  }

  // Embed the seller's own profile so the response shape matches the public feed.
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, username, display_name, avatar_url, phone")
    .eq("id", userId)
    .maybeSingle();

  const feed = (auctions ?? []).map((a) => ({
    ...normalizeAuction(a),
    seller: profile ?? null,
    user_signal: null,
  }));

  logger.info({ userId, count: feed.length }, "GET /auctions/mine → returning seller auctions");
  res.json({ auctions: feed });
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

  // Treat soft-deleted auctions as not found
  if (auctionResult.data.status === "removed") {
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
        .select("id, username, display_name, avatar_url, phone")
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
  // Product contract: auctions last exactly 24 or 48 hours. No other values
  // are accepted even via direct API calls so that countdown copy and the
  // “2d left” prevention in the client stay honest.
  durationHours: z
    .union([z.literal(24), z.literal(48)], {
      errorMap: () => ({ message: "durationHours must be 24 or 48" }),
    })
    .optional()
    .default(24),
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

  const { title, description, category, startPrice, minIncrement, videoUrl, thumbnailUrl, lat, lng, currencyCode, currencyLabel, durationHours } =
    parsed.data;
  const sellerId = req.user!.id;

  // ── Media URL ownership / origin enforcement ───────────────────────────────
  // Reject any URL that is not from our R2 / legacy Supabase project AND
  // whose key prefix doesn't match this user's upload namespace.  Without
  // this, an attacker could submit crafted URLs and steer server-side
  // download/delete operations (cleanup, processing) at unintended objects.
  try {
    assertOwnedMediaUrl(videoUrl, sellerId);
    assertOwnedMediaUrl(thumbnailUrl, sellerId);
  } catch (err) {
    res.status(400).json({
      error: "INVALID_MEDIA_URL",
      message: err instanceof Error ? err.message : "Invalid media URL.",
    });
    return;
  }

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
  // durationHours is validated by the schema (1–48 h), default 24 h.
  const endsAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);
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

  // ── Async video processing (fire-and-forget) ───────────────────────────────
  // Detects whether videoUrl is a video by file extension.
  // If yes: compresses to 720p H.264, extracts thumbnail, updates DB URLs.
  // The original URL is valid immediately; processing happens in the background.
  const isVideoUpload = /\.(mp4|mov|webm|avi)(\?|$)/i.test(videoUrl);
  if (isVideoUpload) {
    void processVideoAsync(auction.id, videoUrl, sellerId)
      .catch(err => logger.error({ err: String(err), auctionId: auction.id }, "video-processing: unhandled crash"));
  }

  // Notify seller's followers that a new auction is live (fire-and-forget, non-fatal).
  // Fetches follower_ids from user_follows where following_id = sellerId.
  void (async () => {
    const { data: follows, error: followErr } = await supabaseAdmin
      .from("user_follows")
      .select("follower_id")
      .eq("following_id", sellerId);

    if (followErr) {
      logger.warn({ err: followErr.message, sellerId }, "auction_started: failed to fetch followers");
      return;
    }

    const followerIds = (follows ?? []).map((f: { follower_id: string }) => f.follower_id);
    await notifyAuctionStarted(followerIds, auction.id, title);
  })();

  res.status(201).json({ auction });
});

// ─── DELETE /api/auctions/:id ─────────────────────────────────────────────────
// Soft-deletes an auction (status = 'removed') and immediately purges its
// storage files (video + thumbnail) so they are not left orphaned.
// Only the auction's seller may call this endpoint.
// ─────────────────────────────────────────────────────────────────────────────

router.delete("/auctions/:id", requireAuth, async (req, res) => {
  const auctionId = req.params["id"];
  const userId = req.user!.id;

  if (!auctionId) {
    res.status(400).json({ error: "MISSING_ID", message: "Auction ID is required" });
    return;
  }

  // Fetch full row so we have video_url and thumbnail_url for storage cleanup
  const { data: auction, error: fetchErr } = await supabaseAdmin
    .from("auctions")
    .select("id, seller_id, status, video_url, thumbnail_url")
    .eq("id", auctionId)
    .maybeSingle();

  if (fetchErr || !auction) {
    res.status(404).json({ error: "NOT_FOUND", message: "Auction not found" });
    return;
  }

  if (auction.status === "removed") {
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

  // ── 1. Soft-delete the auction row ─────────────────────────────────────────
  const { error: updateErr } = await supabaseAdmin
    .from("auctions")
    .update({ status: "removed" })
    .eq("id", auctionId);

  if (updateErr) {
    logger.error({ err: updateErr, auctionId, userId }, "Failed to soft-delete auction");
    res.status(500).json({ error: "DELETE_FAILED", message: "Could not delete auction" });
    return;
  }

  logger.info({ auctionId, userId }, "Auction soft-deleted (status=removed)");

  // ── 2. Immediately purge storage files (best-effort, non-fatal) ────────────
  // We delete both video and thumbnail right away so files are not left
  // orphaned until the 7-day media-lifecycle scheduler runs.
  const now = new Date().toISOString();
  const storageUpdates: Record<string, string> = {};

  try {
    const videoDeleted = await deleteMediaFile(auction.video_url ?? null);
    if (videoDeleted) storageUpdates.video_deleted_at = now;
    logger.info({ auctionId, deleted: videoDeleted }, "Owner-delete: video storage cleanup");
  } catch (err) {
    logger.warn({ auctionId, err }, "Owner-delete: video storage cleanup failed (non-fatal)");
  }

  try {
    const thumbDeleted = await deleteMediaFile(auction.thumbnail_url ?? null);
    if (thumbDeleted) storageUpdates.thumbnail_deleted_at = now;
    logger.info({ auctionId, deleted: thumbDeleted }, "Owner-delete: thumbnail storage cleanup");
  } catch (err) {
    logger.warn({ auctionId, err }, "Owner-delete: thumbnail storage cleanup failed (non-fatal)");
  }

  // Stamp cleanup timestamps if any files were actually deleted
  if (Object.keys(storageUpdates).length > 0) {
    await supabaseAdmin
      .from("auctions")
      .update(storageUpdates)
      .eq("id", auctionId)
      .then(({ error }) => {
        if (error) logger.warn({ auctionId, err: error }, "Owner-delete: failed to stamp cleanup timestamps");
      });
  }

  res.json({ success: true });
});

// ─── Shared bid placement logic ───────────────────────────────────────────────
//
// Both POST /api/bids and POST /api/auctions/:id/bids delegate here.
//
// Model: clients send a `bid_increment` (how much to add). The server:
//   1. Reads the current price from the DB (snapshot).
//   2. Validates the increment is >= the seller-set floor (min_increment, default 1).
//   3. Computes new_price = current_price + bid_increment.
//   4. Inserts the bid row (amount = new_price).
//   5. Atomically updates the auction using an optimistic lock:
//        UPDATE auctions SET current_bid = new_price … WHERE current_bid = snapshot
//      If the affected row count is 0 another bid landed simultaneously —
//      the orphaned bid row is rolled back (deleted) and 409 is returned.
//
// The client must NEVER be trusted to send the final price.
// ─────────────────────────────────────────────────────────────────────────────

interface PlaceBidResult {
  bid: Record<string, unknown>;
  auction: Record<string, unknown>;
}

type PlaceBidOutcome =
  | { ok: true; status: 201; body: PlaceBidResult }
  | { ok: false; status: number; body: Record<string, unknown> };

async function executePlaceBid(
  auctionId: string,
  userId: string,
  bidIncrement: number,
  logTag: string,
): Promise<PlaceBidOutcome> {
  // 1. Run lifecycle so status column is accurate.
  await runAuctionLifecycle().catch(err =>
    logger.warn({ err: String(err) }, `${logTag}: runAuctionLifecycle pre-check failed`),
  );

  // 2. Fetch auction.
  const { data: auction, error: auctionErr } = await supabaseAdmin
    .from("auctions")
    .select("*")
    .eq("id", auctionId)
    .single();

  if (auctionErr || !auction) {
    return { ok: false, status: 404, body: { error: "AUCTION_NOT_FOUND", message: "Auction not found" } };
  }

  // 3. Auction must be within its active time window.
  if (auction.status === "ended" || !isAuctionActive(auction.starts_at, auction.ends_at)) {
    return { ok: false, status: 409, body: { error: "AUCTION_NOT_ACTIVE", message: "This auction is not currently accepting bids" } };
  }

  // 4. Seller cannot bid on own auction.
  if (auction.seller_id === userId) {
    return { ok: false, status: 403, body: { error: "SELLER_CANNOT_BID", message: "You cannot bid on your own auction" } };
  }

  // 5. Validate increment against the seller-set floor (min_increment; default 1).
  //    min_increment remains meaningful as a per-auction minimum step set at
  //    auction creation. If it is null/0 we fall back to 1 (any positive amount).
  const snapshotBid = getCurrentBid(auction);
  const minIncrement = Math.max(1, getMinIncrement(auction));

  if (bidIncrement < minIncrement) {
    return {
      ok: false,
      status: 422,
      body: {
        error: "INCREMENT_TOO_LOW",
        message: `Increment must be at least ${minIncrement}`,
        minIncrement,
        currentBid: snapshotBid,
      },
    };
  }

  // 6. Server computes the new price — client-sent amount is never trusted.
  const newPrice = snapshotBid + bidIncrement;

  // 7. Find the current leading bidder (for outbid notification fired after insert).
  const bCol = await getBidderCol();
  const { data: prevLeader } = await supabaseAdmin
    .from("bids")
    .select(bCol)
    .eq("auction_id", auctionId)
    .order("amount", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 8. Insert the bid row with the server-computed price.
  const { data: newBid, error: bidErr } = await supabaseAdmin
    .from("bids")
    .insert({ auction_id: auctionId, [bCol]: userId, amount: newPrice })
    .select(`id, auction_id, ${bCol}, amount, created_at`)
    .single();

  if (bidErr || !newBid) {
    logger.error({ err: bidErr, auctionId, userId, newPrice }, `${logTag}: bid insert failed`);
    return { ok: false, status: 500, body: { error: "BID_INSERT_FAILED", message: "Failed to record bid" } };
  }

  // 9. Atomic optimistic-lock update.
  //    The WHERE current_bid = snapshotBid clause means: if any other bid
  //    landed between steps 2 and 9, the UPDATE affects 0 rows (stale snapshot).
  //    In that case we delete the just-inserted bid row and return 409 CONFLICT.
  const wbidColExists = await hasWinnerBidIdCol();
  const auctionPatch: Record<string, unknown> = {
    current_bid: newPrice,
    bid_count: (auction.bid_count ?? 0) + 1,
    winner_id: userId,
    updated_at: new Date().toISOString(),
  };
  if (wbidColExists) auctionPatch["winner_bid_id"] = newBid.id;

  const { data: updatedAuction } = await supabaseAdmin
    .from("auctions")
    .update(auctionPatch)
    .eq("id", auctionId)
    .eq("current_bid", snapshotBid)   // optimistic lock
    .select("*")
    .single();

  if (!updatedAuction) {
    // Another bid landed simultaneously. Roll back the orphaned bid row.
    await supabaseAdmin.from("bids").delete().eq("id", (newBid as { id: string }).id);
    logger.warn({ auctionId, userId, snapshotBid, newPrice }, `${logTag}: concurrent bid detected — rolled back`);
    return {
      ok: false,
      status: 409,
      body: {
        error: "BID_CONFLICT",
        message: "Someone else just placed a bid — please refresh and try again",
      },
    };
  }

  // 10. Fire outbid notification (fire-and-forget, non-fatal).
  const prevLeaderUserId = prevLeader ? getBidderUserId(prevLeader) : null;
  if (prevLeaderUserId && prevLeaderUserId !== userId) {
    void notifyOutbid(prevLeaderUserId, auctionId, auction.title ?? "this auction", newPrice);
  }

  logger.info(
    { bidId: (newBid as { id: string }).id, auctionId, userId, bidIncrement, newPrice },
    `${logTag}: bid placed successfully`,
  );

  return {
    ok: true,
    status: 201,
    body: {
      bid: newBid,
      auction: {
        ...updatedAuction,
        current_bid: getCurrentBid(updatedAuction),
        bid_count: updatedAuction.bid_count,
      },
    },
  };
}

// ─── POST /api/bids ───────────────────────────────────────────────────────────
// Legacy flat endpoint. auctionId comes from the request body.

const placeBidSchema = z.object({
  auctionId: z.string().uuid("auctionId must be a valid UUID"),
  bid_increment: z
    .number()
    .int("bid_increment must be a whole number")
    .min(1, "bid_increment must be at least 1"),
});

router.post("/bids", requireAuth, async (req, res) => {
  const parsed = placeBidSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "Invalid request body",
    });
    return;
  }

  const { auctionId, bid_increment } = parsed.data;
  const userId = req.user!.id;

  const outcome = await executePlaceBid(auctionId, userId, bid_increment, "POST /bids");
  res.status(outcome.status).json(outcome.body);
});

// ─── POST /api/auctions/:id/bids ─────────────────────────────────────────────
// RESTful endpoint. auctionId comes from the URL path parameter.

const auctionBidSchema = z.object({
  bid_increment: z
    .number()
    .int("bid_increment must be a whole number")
    .min(1, "bid_increment must be at least 1"),
});

router.post("/auctions/:id/bids", requireAuth, async (req, res) => {
  const auctionId = req.params["id"] as string;
  const userId = req.user!.id;

  const parsed = auctionBidSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "Invalid request body",
    });
    return;
  }

  const outcome = await executePlaceBid(auctionId, userId, parsed.data.bid_increment, "POST /auctions/:id/bids");
  res.status(outcome.status).json(outcome.body);
});

// ─── Content Signal endpoints ─────────────────────────────────────────────────
//
// POST   /api/auctions/:id/signal  — record or update viewer's signal
// DELETE /api/auctions/:id/signal  — remove (neutral) viewer's signal
//
// A signal is one of: 'interested' | 'not_interested'.
// One signal per (user, auction) pair — upserted on conflict.
// ─────────────────────────────────────────────────────────────────────────────

const signalSchema = z.object({
  signal: z.enum(["interested", "not_interested"]),
});

router.post("/auctions/:id/signal", requireAuth, async (req, res) => {
  const parsed = signalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: 'signal must be "interested" or "not_interested"',
    });
    return;
  }

  const { error } = await supabaseAdmin
    .from("content_signals")
    .upsert(
      {
        user_id: req.user!.id,
        auction_id: req.params.id,
        signal: parsed.data.signal,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,auction_id" },
    );

  if (error) {
    logger.error({ err: error }, "POST /auctions/:id/signal — upsert failed");
    res.status(500).json({ error: "SIGNAL_FAILED", message: "Failed to record signal." });
    return;
  }

  res.json({ ok: true, signal: parsed.data.signal });
});

router.delete("/auctions/:id/signal", requireAuth, async (req, res) => {
  await supabaseAdmin
    .from("content_signals")
    .delete()
    .eq("user_id", req.user!.id)
    .eq("auction_id", req.params.id);

  res.json({ ok: true });
});

export default router;
