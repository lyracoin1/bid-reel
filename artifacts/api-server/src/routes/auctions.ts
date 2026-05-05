/**
 * Auction & Bid routes
 *
 * GET  /api/auctions          — list all active/upcoming auctions
 * GET  /api/auctions/:id      — single auction with top bids
 * POST /api/bids              — place a bid (requires auth)
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { supabaseAdmin } from "../lib/supabase";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { notifyOutbid, notifyAuctionStarted, notifyBidReceived, createNotification } from "../lib/notifications";
import { sendWhatsAppMessage } from "../lib/whatsapp";
import { buildOutbidMessage } from "../lib/whatsappTemplates";
import { getBidderCol, getBidderUserId, hasWinnerBidIdCol } from "../lib/dbSchema";
import { deleteMediaFile } from "../lib/media-lifecycle";
import { runAuctionLifecycle } from "../lib/auction-lifecycle";
import { processVideoAsync, processAudioReelAsync } from "../lib/video-processing";
import { assertOwnedMediaUrl } from "../lib/r2";
import { buildUserFeedContext, scoreAuction } from "../lib/feed-ranking";
import { recordEngagement } from "./views";
import {
  buyNowLimiter,
  markSoldLimiter,
} from "../middleware/rate-limit";

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
  return a.min_increment ?? 1;
}

/** Maps user country/location string to a default ISO currency code */
function getDefaultCurrencyForLocation(location: string | null | undefined): { code: string; label: string } {
  const loc = (location || "").toLowerCase().trim();
  if (loc.includes("egypt") || loc.includes("eg") || loc.includes("مصر")) {
    return { code: "EGP", label: "Egyptian Pound" };
  }
  if (loc.includes("saudi") || loc.includes("sa") || loc.includes("السعودية")) {
    return { code: "SAR", label: "Saudi Riyal" };
  }
  if (loc.includes("japan") || loc.includes("jp") || loc.includes("اليابان")) {
    return { code: "JPY", label: "Japanese Yen" };
  }
  return { code: "USD", label: "US Dollar" };
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
  image_urls?: string[] | null;
  media_type?: string;
  created_at: string;
  ends_at: string;
  media_purge_after: string;
  sale_type: "auction" | "fixed";
  fixed_price: number | null;
  lat?: number;
  lng?: number;
  currency_code?: string;
  currency_label?: string;
}) {
  const {
    start_price_value, min_increment_value, media_purge_after,
    lat, lng, currency_code, currency_label,
    sale_type, fixed_price, image_urls, media_type,
    ...base
  } = payload;

  const locationFields = lat !== undefined && lng !== undefined ? { lat, lng } : {};
  const currencyFields = {
    currency_code: currency_code ?? "USD",
    currency_label: currency_label ?? "US Dollar",
  };

  // Insert WITHOUT media_type — the column may not exist yet (migration pending).
  // A best-effort UPDATE sets it immediately after insert succeeds.
  const result = await supabaseAdmin
    .from("auctions")
    .insert({
      ...base,
      current_bid: start_price_value,
      min_increment: min_increment_value,
      media_purge_after,
      sale_type,
      fixed_price,
      image_urls: image_urls ?? null,
      ...locationFields,
      ...currencyFields,
    })
    .select("*")
    .single();

  if (!result.error && result.data && media_type) {
    const auctionId = (result.data as { id: string }).id;
    supabaseAdmin
      .from("auctions")
      .update({ media_type })
      .eq("id", auctionId)
      .then(({ error: mtErr }) => {
        if (mtErr) {
          logger.warn(
            { auctionId, err: mtErr.message },
            "insertAuction: media_type set skipped — run the add_media_type migration",
          );
        }
      });
  }

  return result;
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

/** Best-effort viewer id from the Authorization header. Returns null on any failure. */
async function getViewerIdFromAuthHeader(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  try {
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    return user?.id ?? null;
  } catch {
    return null;
  }
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

  // Batch-fetch view counters so the public feed can render the views badge.
  // Missing rows are treated as zero (table not yet provisioned, or auction
  // never viewed). Failures degrade gracefully — feed still renders without views.
  const auctionIds = (auctions ?? []).map((a) => a.id as string);
  const { data: viewRows, error: viewsErr } = auctionIds.length > 0
    ? await supabaseAdmin
        .from("auction_view_stats")
        .select("auction_id, qualified_views_count")
        .in("auction_id", auctionIds)
    : { data: [], error: null };

  if (viewsErr) {
    logger.warn({ err: viewsErr.message }, "GET /auctions: view_stats lookup failed (continuing without views)");
  }

  const viewMap = new Map<string, number>(
    (viewRows ?? []).map((r) => [r.auction_id as string, (r.qualified_views_count as number | null) ?? 0]),
  );

  // Base list — ordered by created_at DESC from the DB query (already stable).
  type AuctionWithMeta = ReturnType<typeof normalizeAuction> & {
    seller: (typeof profileMap extends Map<string, infer V> ? V : null) | null;
    user_signal: "interested" | "not_interested" | null;
    views_count: number;
  };

  // ── Cursor for next page ──────────────────────────────────────────────────
  // Captured from the RAW DB result (before signal re-ranking) so the client
  // can request the next page of older items without gaps or duplicates.
  // We return null when fewer than PAGE_SIZE items came back (= no more pages).
  const rawItems = auctions ?? [];
  const nextCursor: string | null = rawItems.length === PAGE_SIZE
    ? (rawItems[rawItems.length - 1].created_at as string)
    : null;

  // Seller contact is always visible — no buyer-side payment gate.
  let feed: AuctionWithMeta[] = rawItems.map((a) => ({
    ...normalizeAuction(a),
    seller: profileMap.get(a.seller_id) ?? null,
    user_signal: null as "interested" | "not_interested" | null,
    views_count: viewMap.get(a.id as string) ?? 0,
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

// ─── GET /api/auctions/bidded ────────────────────────────────────────────────
// Returns every auction the authenticated user has placed at least one bid on,
// with their highest bid, the current price, whether they're the top bidder,
// and their **server-computed rank** among all bidders on that auction.
//
// Rank is computed strictly here (not on the client): for each auction we
// fetch every bid, group by bidder, take MAX(amount) per bidder, sort that
// list DESC by amount (ties broken by earliest bid time), then find the
// caller's position. Rank 1 = highest bidder.
//
// Edge cases handled:
//   • multiple bids by the same user → take the highest
//   • auction ended → still returned (the user wants to see the result)
//   • no bids by this user → empty array
// ─────────────────────────────────────────────────────────────────────────────

router.get("/auctions/bidded", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const bCol = await getBidderCol();

  // 1. Every bid this user has ever placed.
  const { data: myBids, error: myErr } = await supabaseAdmin
    .from("bids")
    .select("auction_id, amount, created_at")
    .eq(bCol, userId)
    .order("created_at", { ascending: false });

  if (myErr) {
    logger.error({ err: myErr, userId }, "GET /auctions/bidded: my-bids query failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load your bids" });
    return;
  }

  if (!myBids || myBids.length === 0) {
    res.json({ auctions: [] });
    return;
  }

  // 2. Reduce my bids to one entry per auction = my highest bid on that auction,
  //    preserving recency order so the most recently bid auction surfaces first.
  const myBestPerAuction = new Map<string, { amount: number; latestAt: string | null }>();
  for (const b of myBids) {
    const cur = myBestPerAuction.get(b.auction_id);
    if (!cur) {
      myBestPerAuction.set(b.auction_id, { amount: b.amount, latestAt: b.created_at ?? null });
    } else if (b.amount > cur.amount) {
      myBestPerAuction.set(b.auction_id, { amount: b.amount, latestAt: cur.latestAt });
    }
  }
  const auctionIds = [...myBestPerAuction.keys()];

  // 3. Fetch the auction rows.
  const { data: auctions, error: aErr } = await supabaseAdmin
    .from("auctions")
    .select("*")
    .in("id", auctionIds);

  if (aErr) {
    logger.error({ err: aErr, userId }, "GET /auctions/bidded: auctions query failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load auctions" });
    return;
  }

  // 4. Fetch every bid for those auctions in one round-trip and bucket by auction.
  const { data: allBids, error: bidsErr } = await supabaseAdmin
    .from("bids")
    .select(`auction_id, ${bCol}, amount, created_at`)
    .in("auction_id", auctionIds);

  if (bidsErr) {
    logger.error({ err: bidsErr, userId }, "GET /auctions/bidded: bids query failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load bids" });
    return;
  }

  type RawBid = { auction_id: string; amount: number; created_at: string | null; [k: string]: unknown };
  const byAuction = new Map<string, RawBid[]>();
  for (const b of (allBids ?? []) as RawBid[]) {
    const arr = byAuction.get(b.auction_id) ?? [];
    arr.push(b);
    byAuction.set(b.auction_id, arr);
  }

  const auctionMap = new Map((auctions ?? []).map(a => [a.id as string, a]));

  // 5. Compute rank per auction: group bids by bidder, take MAX(amount) per
  //    bidder, sort that list DESC by amount (ties → earliest bid first).
  //    The caller's rank is their position (1-indexed) in that ordered list.
  const result = auctionIds
    .map(aId => {
      const a = auctionMap.get(aId);
      if (!a) return null;

      const bidsForAuction = byAuction.get(aId) ?? [];

      // Per-bidder best bid (amount + earliest time of their best bid).
      const perBidder = new Map<string, { amount: number; firstAt: string }>();
      for (const b of bidsForAuction) {
        const bidderId = getBidderUserId(b);
        if (!bidderId) continue;
        const at = b.created_at ?? new Date(0).toISOString();
        const prev = perBidder.get(bidderId);
        if (!prev || b.amount > prev.amount) {
          perBidder.set(bidderId, { amount: b.amount, firstAt: at });
        } else if (b.amount === prev.amount && at < prev.firstAt) {
          perBidder.set(bidderId, { amount: prev.amount, firstAt: at });
        }
      }

      // Sort bidders DESC by amount, tiebreak by earliest time, then by uid
      // for full determinism (transitive comparator — never returns ±1 on equal keys).
      const ranking = [...perBidder.entries()]
        .map(([uid, v]) => ({ uid, amount: v.amount, firstAt: v.firstAt }))
        .sort((x, y) => {
          if (y.amount !== x.amount) return y.amount - x.amount;
          if (x.firstAt !== y.firstAt) return x.firstAt < y.firstAt ? -1 : 1;
          if (x.uid === y.uid) return 0;
          return x.uid < y.uid ? -1 : 1;
        });

      const rank = ranking.findIndex(r => r.uid === userId) + 1; // 1-indexed
      const isHighest = rank === 1;

      const my = myBestPerAuction.get(aId)!;
      const currentPrice = ranking[0]?.amount ?? a.current_bid ?? a.start_price ?? 0;
      // Split media_url and thumbnail_url so the FE can render a poster
      // image inside an <img> tag for VIDEO auctions (an .mp4 URL inside <img>
      // renders broken / distorted).
      const mediaUrl = a.video_url ?? a.thumbnail_url ?? null;
      const thumbnailUrl = (a.thumbnail_url as string | null) ?? null;

      return {
        id: a.id as string,
        title: a.title as string,
        media_url: mediaUrl as string | null,
        thumbnail_url: thumbnailUrl,
        current_price: Number(currentPrice),
        user_bid: Number(my.amount),
        is_highest_bidder: isHighest,
        rank,
        // Extras the FE can use for richer display (do not break the documented shape).
        ends_at: a.ends_at as string,
        starts_at: (a.starts_at as string) ?? null,
        currency_code: (a.currency_code as string) ?? null,
        status: (a.status as string) ?? "active",
        bid_count: (a.bid_count as number) ?? perBidder.size,
        latest_bid_at: my.latestAt,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    // Most recently bid first.
    .sort((a, b) => {
      const at = a.latest_bid_at ?? "";
      const bt = b.latest_bid_at ?? "";
      return at < bt ? 1 : at > bt ? -1 : 0;
    });

  logger.info({ userId, count: result.length }, "GET /auctions/bidded → returning bid history");
  res.json({ auctions: result });
});

// ─── GET /api/auctions/:id ────────────────────────────────────────────────────

router.get("/auctions/:id", async (req, res) => {
  const { id } = req.params;

  // Best-effort caller resolution — the route is public, but if a Bearer
  // token is present we use it to populate is_liked_by_me / is_saved_by_me
  // so the heart and bookmark icons render correctly on first paint.
  let callerId: string | null = null;
  const auth = req.headers.authorization ?? "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token) {
      const { data: userData } = await supabaseAdmin.auth.getUser(token);
      callerId = userData?.user?.id ?? null;
    }
  }

  const [auctionResult, bidsResult] = await Promise.all([
    supabaseAdmin
      .from("auctions")
      .select("*")
      .eq("id", id)
      .single(),

    // Order chronologically (created_at ASC) so the client can render true
    // bid order: #1 = first bid placed, #N = most recent. The "highest" bid
    // is derived on the client by max(amount) — independent of position —
    // so the rank numbers always reflect when each bid was made.
    supabaseAdmin
      .from("bids")
      .select("*")
      .eq("auction_id", id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(100),
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

  // Seller contact is always visible — no buyer-side payment gate.
  const auctionWithSeller = {
    ...normalizeAuction(auctionData),
    seller: profileMap.get(auctionData.seller_id) ?? null,
  };

  const bidsWithBidders = bids.map((b) => ({
    ...b,
    bidder: profileMap.get(getBidderUserId(b)) ?? null,
  }));

  // Resolve is_liked_by_me for the authenticated caller (if any). Cheap —
  // PK lookup on (user_id, auction_id) backed by likes_user_auction_uniq.
  let isLikedByMe = false;
  if (callerId) {
    const { data: likeRow } = await supabaseAdmin
      .from("likes")
      .select("id")
      .eq("user_id", callerId)
      .eq("auction_id", id)
      .maybeSingle();
    isLikedByMe = !!likeRow;
  }

  // Public view counter — used by the auction detail screen. Missing row → 0.
  const { data: viewStatRow } = await supabaseAdmin
    .from("auction_view_stats")
    .select("qualified_views_count")
    .eq("auction_id", id)
    .maybeSingle();
  const viewsCount = (viewStatRow as { qualified_views_count?: number } | null)?.qualified_views_count ?? 0;

  logger.info({ auctionId: id, bidCount: bids.length, views: viewsCount }, "GET /auctions/:id → returning detail");
  res.json({
    auction: { ...auctionWithSeller, is_liked_by_me: isLikedByMe, views_count: viewsCount },
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
    .positive("Start price must be greater than 0")
    .optional(),
  saleType: z
    .enum(["auction", "fixed"], { errorMap: () => ({ message: "saleType must be 'auction' or 'fixed'" }) })
    .optional()
    .default("auction"),
  fixedPrice: z
    .number()
    .positive("Fixed price must be greater than 0")
    .optional(),
  minIncrement: z
    .number()
    .positive("Minimum increment must be greater than 0")
    .optional()
    .default(1),
  videoUrl: z.string().url("videoUrl must be a valid URL"),
  thumbnailUrl: z.string().url("thumbnailUrl must be a valid URL"),
  imageUrls: z
    .array(z.string().url("Each imageUrl must be a valid URL"))
    .max(6, "A maximum of 6 images are allowed per listing")
    .optional(),
  lat: z
    .number({ required_error: "lat is required — location must be granted before publishing" })
    .min(-90).max(90),
  lng: z
    .number({ required_error: "lng is required — location must be granted before publishing" })
    .min(-180).max(180),
  currencyCode: z.string().max(10).optional().default("USD"),
  currencyLabel: z.string().max(60).optional().default("US Dollar"),
  // Auctions last between 1 and 48 hours. The DB constraint
  // chk_auction_duration enforces the same range; keep them in sync.
  durationHours: z
    .number({ invalid_type_error: "durationHours must be a number between 1 and 48" })
    .int("durationHours must be a whole number")
    .min(1, "durationHours must be at least 1")
    .max(48, "durationHours must be at most 48")
    .optional()
    .default(24),
}).superRefine((val, ctx) => {
  // Sale-type / price consistency:
  //   auction → startPrice required, fixedPrice ignored
  //   fixed   → fixedPrice required, startPrice optional (defaults to fixedPrice)
  if (val.saleType === "fixed") {
    if (val.fixedPrice == null || val.fixedPrice <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fixedPrice"],
        message: "fixedPrice is required and must be > 0 when saleType is 'fixed'",
      });
    }
  } else {
    if (val.startPrice == null || val.startPrice <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startPrice"],
        message: "startPrice is required and must be > 0 for auctions",
      });
    }
  }
});

// Columns returned to the client — never expose internal/deleted fields.
// Must include every field read by backendToAuction so newly-created posts
// arrive in the cache with complete data without requiring a feed refresh.
const AUCTION_SELECT = [
  "id", "seller_id", "title", "description", "category",
  "start_price", "current_bid", "min_increment",
  "video_url", "thumbnail_url", "image_urls", "media_type",
  "bid_count", "like_count", "status",
  "starts_at", "ends_at", "created_at",
  "sale_type", "fixed_price",
  "currency_code", "currency_label",
  "lat", "lng", "buyer_id",
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

  const { title, description, category, startPrice, saleType, fixedPrice, minIncrement, videoUrl, thumbnailUrl, imageUrls, lat, lng, currencyCode, currencyLabel, durationHours } =
    parsed.data;
  const sellerId = req.user!.id;
  // Sale-type normalization:
  //   - For fixed-price listings, both start_price and fixed_price are set to
  //     the chosen flat price so the existing UI columns ("price") still render
  //     a sensible number for any code path that doesn't yet branch on saleType.
  //   - For auctions, fixed_price is null (DB CHECK constraint requires this).
  const effectiveStartPrice = saleType === "fixed" ? (fixedPrice as number) : (startPrice as number);
  const effectiveFixedPrice = saleType === "fixed" ? (fixedPrice as number) : null;

  // ── Phone-required gate ────────────────────────────────────────────────────
  // Auctions cannot be created without a WhatsApp contact phone on file —
  // buyers need a way to reach the seller. We block at this layer because the
  // PATCH /users/me path is partial-update and accepts other-field-only edits.
  // Existing accounts (signed up before phone became required) hit this gate
  // and are forced to set a phone before publishing.
  let finalCurrencyCode = currencyCode;
  let finalCurrencyLabel = currencyLabel;

  {
    const { data: sellerRow, error: sellerErr } = await supabaseAdmin
      .from("profiles")
      .select("phone, country, location, username, display_name, avatar_url")
      .eq("id", sellerId)
      .maybeSingle();
    if (sellerErr) {
      logger.error({ err: sellerErr, sellerId }, "POST /auctions: profile lookup failed");
      res.status(500).json({ error: "PROFILE_LOOKUP_FAILED", message: "Could not verify seller profile." });
      return;
    }
    // Profile completeness gate — same fields as the frontend gate.
    // is_premium / payment is NOT required; only a completed profile is.
    const phone       = (sellerRow?.phone        ?? "").trim();
    const username    = (sellerRow?.username      ?? "").trim();
    const displayName = ((sellerRow as { display_name?: string })?.display_name ?? "").trim();
    const avatarUrl   = (sellerRow?.avatar_url    ?? "").trim();
    const location    = (sellerRow?.location      ?? "").trim();
    if (!phone || !username || !displayName || !avatarUrl || !location) {
      logger.warn({ sellerId }, "POST /auctions blocked: seller profile incomplete");
      res.status(400).json({
        error: "SELLER_PROFILE_INCOMPLETE",
        message: "Seller profile is incomplete",
      });
      return;
    }

    // Default currency by location if missing from request
    if (!finalCurrencyCode) {
      const locationStr = (sellerRow as { country?: string; location?: string }).country || (sellerRow as { country?: string; location?: string }).location;
      const defaults = getDefaultCurrencyForLocation(locationStr);
      finalCurrencyCode = defaults.code;
      finalCurrencyLabel = defaults.label;
    }
  }

  // ── Media URL ownership / origin enforcement ───────────────────────────────
  // Reject any URL that is not from our R2 / legacy Supabase project AND
  // whose key prefix doesn't match this user's upload namespace.  Without
  // this, an attacker could submit crafted URLs and steer server-side
  // download/delete operations (cleanup, processing) at unintended objects.
  try {
    assertOwnedMediaUrl(videoUrl, sellerId);
    assertOwnedMediaUrl(thumbnailUrl, sellerId);
    for (const imgUrl of imageUrls ?? []) {
      assertOwnedMediaUrl(imgUrl, sellerId);
    }
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

  // ── Determine initial media_type ───────────────────────────────────────────
  // Computed before the DB insert so the row starts with the correct type.
  // Audio uploads start as "processing" (an MP4 reel will be generated async).
  // Video uploads are immediately "video". Photo listings are "album" or "image".
  const isAudioUpload = /\.(mp3|m4a|aac|ogg|opus)(\?|$)/i.test(videoUrl);
  const isVideoUpload = !isAudioUpload && /\.(mp4|mov|webm|avi)(\?|$)/i.test(videoUrl);
  const initialMediaType: string = isAudioUpload
    ? "processing"
    : isVideoUpload
    ? "video"
    : imageUrls && imageUrls.length > 1
    ? "album"
    : "image";

  // ── Timestamps ─────────────────────────────────────────────────────────────
  // durationHours is validated by the schema (1–48). We defensively
  // re-coerce + re-validate here because this value is fed directly into
  // the DB duration CHECK constraint — a stray value would surface as an
  // opaque 500 from Postgres instead of a clean 400.
  const duration = Number(durationHours);
  if (!Number.isFinite(duration) || duration < 1 || duration > 48) {
    res.status(400).json({
      error: "INVALID_DURATION",
      message: "Duration must be between 1 and 48 hours",
    });
    return;
  }

  // IMPORTANT: pin `created_at` and `ends_at` to the same Node clock so the
  // delta is exactly `duration` hours. If we let Postgres set
  // `created_at = NOW()` while we compute `ends_at` from Node's clock, even
  // a few ms of clock skew between Node and Postgres pushes the delta over
  // 48h and trips the chk_auction_duration CHECK constraint.
  const nowMs = Date.now();
  const createdAt = new Date(nowMs);
  const endsAt = new Date(nowMs + duration * 60 * 60 * 1000);
  const mediaPurgeAfter = new Date(endsAt.getTime() + 7 * 24 * 60 * 60 * 1000);

  const { data: auction, error } = await insertAuction({
    seller_id: sellerId,
    title,
    description: description ?? null,
    category,
    start_price: effectiveStartPrice,
    start_price_value: effectiveStartPrice,
    min_increment_value: minIncrement,
    video_url: videoUrl,
    thumbnail_url: thumbnailUrl,
    image_urls: imageUrls && imageUrls.length > 0 ? imageUrls : null,
    media_type: initialMediaType,
    created_at: createdAt.toISOString(),
    ends_at: endsAt.toISOString(),
    media_purge_after: mediaPurgeAfter.toISOString(),
    sale_type: saleType,
    fixed_price: effectiveFixedPrice,
    lat,
    lng,
    currency_code: finalCurrencyCode,
    currency_label: finalCurrencyLabel,
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

  // ── Async media processing (fire-and-forget) ───────────────────────────────
  // isAudioUpload / isVideoUpload were computed above before insertAuction.
  if (isAudioUpload) {
    // Combine the audio with cover image(s) into an MP4 reel, then update
    // video_url / thumbnail_url in the DB so the feed plays it as a standard
    // video.  While processing is in-flight the frontend falls back to the
    // ImageSlider + hidden <audio> path (type="audio").
    const audioImageUrls: string[] = imageUrls && imageUrls.length > 0
      ? imageUrls
      : (thumbnailUrl && thumbnailUrl !== videoUrl ? [thumbnailUrl] : []);
    void processAudioReelAsync(auction.id, videoUrl, audioImageUrls, sellerId)
      .catch(err => logger.error({ err: String(err), auctionId: auction.id }, "audio-reel: unhandled crash"));
  } else if (isVideoUpload) {
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

  // 1a. Require a premium subscription to place bids.
  const { data: bidder } = await supabaseAdmin
    .from("profiles")
    .select("is_premium")
    .eq("id", userId)
    .maybeSingle();

  if (!bidder?.is_premium) {
    // Free users: allow up to 5 bids per calendar month.
    const FREE_MONTHLY_BID_LIMIT = 5;
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    const freeCol = await getBidderCol();

    const { count: monthlyBidCount, error: monthlyBidErr } = await supabaseAdmin
      .from("bids")
      .select("id", { count: "exact", head: true })
      .eq(freeCol, userId)
      .gte("created_at", monthStart)
      .lt("created_at", monthEnd);

    if (monthlyBidErr) {
      logger.error({ err: monthlyBidErr, userId, freeCol, monthStart, monthEnd }, `${logTag}: monthly bid count failed`);
      return {
        ok: false,
        status: 500,
        body: {
          error: "BID_LIMIT_CHECK_FAILED",
          message: "Could not verify monthly bid quota",
        },
      };
    }

    const usedFreeBids = monthlyBidCount ?? 0;
    const remainingFreeBids = Math.max(0, FREE_MONTHLY_BID_LIMIT - usedFreeBids);

    if (usedFreeBids >= FREE_MONTHLY_BID_LIMIT) {
      return {
        ok: false,
        status: 403,
        body: {
          error: "PREMIUM_REQUIRED",
          message: "Subscribe to place more bids",
          freeBidLimit: FREE_MONTHLY_BID_LIMIT,
          usedFreeBids,
          remainingFreeBids,
          monthlyResetDate: monthEnd,
        },
      };
    }
  }

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

  // 3a. Fixed-price listings do not accept bids — they use POST /:id/buy.
  if (auction.sale_type === "fixed") {
    return { ok: false, status: 409, body: { error: "FIXED_PRICE_LISTING", message: "This is a fixed-price listing — use Buy Now instead." } };
  }

  // 3b. A 'sold' or 'reserved' listing cannot receive bids either.
  if (auction.status === "sold" || auction.status === "reserved") {
    return { ok: false, status: 409, body: { error: "AUCTION_NOT_ACTIVE", message: "This listing is no longer accepting bids" } };
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

  // 9. Update winner pointers only.
  //
  //    DO NOT include `current_bid` or `bid_count` in this UPDATE — the
  //    Postgres trigger `trg_bid_placed` (migration 009) already updates
  //    them on bid INSERT. A previous version of this code also wrote
  //    `current_bid` + `bid_count` and used `WHERE current_bid = snapshotBid`
  //    as an optimistic lock. That always lost the race against the trigger,
  //    which had already set `current_bid = newPrice` by the time the UPDATE
  //    ran — so the UPDATE matched 0 rows, the just-inserted bid was deleted
  //    by the rollback path below, and `bid_count` (incremented by the trigger
  //    but never decremented on DELETE) leaked upward forever. Net effect in
  //    prod: every single bid was rolled back, leaving `bid_count > 0` with
  //    zero rows in the bids table — exactly what the user reported.
  //
  //    The optimistic-lock condition is now expressed as
  //    `WHERE current_bid = newPrice` — i.e. "our bid is still the top". If
  //    another bid landed simultaneously and is now the top, our bid is still
  //    a valid recorded row and we just don't claim winner; we re-fetch and
  //    return success with the latest auction state.
  const wbidColExists = await hasWinnerBidIdCol();
  const auctionPatch: Record<string, unknown> = {
    winner_id: userId,
    updated_at: new Date().toISOString(),
  };
  if (wbidColExists) auctionPatch["winner_bid_id"] = newBid.id;

  const { data: updatedAuction } = await supabaseAdmin
    .from("auctions")
    .update(auctionPatch)
    .eq("id", auctionId)
    .eq("current_bid", newPrice)   // claim winner only if our bid is still the top
    .select("*")
    .single();

  if (!updatedAuction) {
    // Another bid raced ours and is now the top. Our bid row IS still in the
    // bids table (the trigger has already counted it). We just aren't the
    // winner. Re-fetch the auction so the caller gets fresh current_bid /
    // bid_count / winner pointers.
    const { data: latest, error: latestErr } = await supabaseAdmin
      .from("auctions")
      .select("*")
      .eq("id", auctionId)
      .single();
    if (latestErr || !latest) {
      logger.error({ err: latestErr, auctionId }, `${logTag}: race-refetch failed`);
      return { ok: false, status: 500, body: { error: "BID_INSERT_FAILED", message: "Failed to record bid" } };
    }
    logger.info({ auctionId, userId, newPrice }, `${logTag}: bid recorded but another bid won the winner slot`);
    return {
      ok: true,
      status: 201,
      body: {
        bid: newBid,
        auction: {
          ...latest,
          current_bid: getCurrentBid(latest),
          bid_count: latest.bid_count,
        },
      },
    };
  }

  // 10/11. Bid notifications.
  //
  // IMPORTANT — these MUST be awaited, not fire-and-forget.
  //
  // On Vercel serverless, once this handler returns and `res.json(...)` flushes,
  // the lambda is suspended/frozen and any detached promises (`void notifyX(...)`
  // or `void (async () => {})()`) are killed mid-await. That is exactly why the
  // earlier production trace showed [1] and [2.x] (which ran synchronously
  // before the await boundary) but never [3] onward — the notification work was
  // scheduled, then the lambda froze before `createNotification` resumed past
  // its first `await`.
  //
  // We collect both notification tasks and `Promise.all` them before returning.
  // Each task .catch's its own error so one failure can't reject the other.
  // Cost: ~100–300ms added latency per bid POST, in exchange for actual
  // delivery. Correctness > latency.
  const prevLeaderUserId = prevLeader ? getBidderUserId(prevLeader) : null;
  logger.info(
    { auctionId, bidderId: userId, prevLeaderUserId, sellerId: auction.seller_id, newPrice },
    "push-chain[1]: bid notification path ENTERED",
  );

  const notifyTasks: Promise<unknown>[] = [];

  if (prevLeaderUserId && prevLeaderUserId !== userId) {
    logger.info(
      { auctionId, recipient: prevLeaderUserId, actor: userId },
      "push-chain[2.outbid]: calling notifyOutbid",
    );
    notifyTasks.push(
      notifyOutbid(
        prevLeaderUserId,
        userId,
        auctionId,
        auction.title ?? "this auction",
        newPrice,
        (auction as { currency_code?: string | null }).currency_code ?? null,
      ).catch(err => logger.error({ err: String(err), auctionId, recipient: prevLeaderUserId }, "push-chain[2.outbid]: notifyOutbid threw")),
    );

    // WhatsApp side-channel for the outbid event. Truly fire-and-forget
    // (NOT pushed onto `notifyTasks`) so the bid POST response is never
    // gated on a Wapilot HTTP round-trip + extra DB phone lookup. The
    // in-app notification + FCM push above remain the authoritative
    // delivery channels; WA is best-effort enrichment.
    //
    // Failure modes (all logged, none re-thrown):
    //   • profile lookup error → logged at warn, no send attempted
    //   • previous bidder has no phone on file → logged at info, skipped
    //   • Wapilot non-2xx / network error → logged at warn by sendWhatsApp
    void (async () => {
      try {
        const { data: prevProfile, error: prevProfileErr } = await supabaseAdmin
          .from("profiles")
          .select("phone")
          .eq("id", prevLeaderUserId)
          .maybeSingle();
        if (prevProfileErr) {
          logger.warn(
            { err: prevProfileErr.message, auctionId, recipient: prevLeaderUserId },
            "push-chain[2.outbid.wa]: profile lookup failed — skipping",
          );
          return;
        }
        const prevPhone = (prevProfile as { phone?: string | null } | null)?.phone ?? null;
        if (!prevPhone) {
          logger.info(
            { auctionId, recipient: prevLeaderUserId },
            "push-chain[2.outbid.wa]: SKIP — prev leader has no phone on file",
          );
          return;
        }
        await sendWhatsAppMessage({
          phone: prevPhone,
          text: buildOutbidMessage(auction.title),
        });
      } catch (err) {
        logger.warn(
          { err: String(err), auctionId, recipient: prevLeaderUserId },
          "push-chain[2.outbid.wa]: WhatsApp dispatch failed — non-blocking",
        );
      }
    })();
  } else {
    logger.info(
      { auctionId, prevLeaderUserId, bidderId: userId },
      "push-chain[2.outbid]: SKIP — no prev leader or self-bid",
    );
  }

  if (auction.seller_id) {
    logger.info(
      { auctionId, recipient: auction.seller_id, actor: userId },
      "push-chain[2.bid_received]: calling notifyBidReceived",
    );
    notifyTasks.push(
      (async () => {
        const { data: bidderProfile } = await supabaseAdmin
          .from("profiles")
          .select("display_name, username")
          .eq("id", userId)
          .maybeSingle();
        const bidderName = bidderProfile?.display_name ?? bidderProfile?.username ?? null;
        await notifyBidReceived(
          auction.seller_id,
          userId,
          bidderName,
          auctionId,
          auction.title ?? "this auction",
          newPrice,
          (auction as { currency_code?: string | null }).currency_code ?? null,
        );
      })().catch(err =>
        logger.warn({ err: String(err), auctionId }, `${logTag}: notifyBidReceived failed`),
      ),
    );
  }

  // Mark this bidder's most recent qualified view (≤30 min) as engaged.
  // Fire-and-forget — does not block the response and never throws.
  void recordEngagement({ auctionId, userId, sessionId: null, action: "bid" });

  // Wait for both before returning so the serverless runtime doesn't kill
  // them on response flush. The .catch on each task means this never rejects.
  await Promise.all(notifyTasks);
  logger.info(
    { auctionId, taskCount: notifyTasks.length },
    "push-chain[1.done]: all bid notification tasks settled",
  );

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

// ─── POST /api/auctions/:id/buy ──────────────────────────────────────────────
// Buy Now flow for fixed-price listings.
//
// Atomic single-row UPDATE that claims the listing only if it is still
// active and fixed-price. The .eq("status", "active") guard ensures that two
// concurrent buyers cannot both succeed — one wins, one gets ALREADY_SOLD.
// Mirrors the optimistic-lock pattern used by executePlaceBid.
//
// Per product spec we do not yet implement a payment flow, so we mark the
// listing 'sold' immediately and stamp buyer_id. The 'reserved' status is
// reserved for a future hold-and-pay step but is not written here.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/auctions/:id/buy", requireAuth, buyNowLimiter, async (req, res) => {
  const auctionId = req.params["id"] as string;
  const buyerId = req.user!.id;

  // 1. Fetch auction.
  const { data: auction, error: fetchErr } = await supabaseAdmin
    .from("auctions")
    .select("*")
    .eq("id", auctionId)
    .maybeSingle();

  if (fetchErr) {
    logger.error({ err: fetchErr, auctionId }, "POST /auctions/:id/buy: fetch failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load listing" });
    return;
  }
  if (!auction) {
    res.status(404).json({ error: "AUCTION_NOT_FOUND", message: "Listing not found" });
    return;
  }

  // 2. Sale-type / status / self-buy guards (cheap pre-checks).
  if (auction.sale_type !== "fixed") {
    res.status(409).json({ error: "NOT_FIXED_PRICE", message: "This listing is not a fixed-price listing" });
    return;
  }
  if (auction.status !== "active") {
    res.status(409).json({
      error: auction.status === "sold" ? "ALREADY_SOLD" : "NOT_AVAILABLE",
      message: auction.status === "sold" ? "This listing has already been sold" : "This listing is not available",
    });
    return;
  }
  if (auction.seller_id === buyerId) {
    res.status(403).json({ error: "SELLER_CANNOT_BUY", message: "You cannot buy your own listing" });
    return;
  }
  if (auction.fixed_price == null) {
    logger.error({ auctionId }, "POST /auctions/:id/buy: fixed-price listing has null fixed_price");
    res.status(500).json({ error: "INVALID_LISTING", message: "Listing is missing a price" });
    return;
  }

  // 3. ATOMIC claim. The .eq("status", "active") clause is the concurrency
  //    guard: if two buyers race, only one .update() will return a row — the
  //    other will see zero rows back and gets ALREADY_SOLD.
  //    Stamps purchase_deadline = now + 48h in the same write so the
  //    reminder/expiry scheduler picks this row up.
  const purchaseDeadline = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("auctions")
    .update({
      status: "sold",
      buyer_id: buyerId,
      winner_id: buyerId,
      purchase_deadline: purchaseDeadline,
    })
    .eq("id", auctionId)
    .eq("status", "active")
    .eq("sale_type", "fixed")
    .select("*")
    .maybeSingle();

  if (updateErr) {
    logger.error({ err: updateErr, auctionId, buyerId }, "POST /auctions/:id/buy: atomic claim failed");
    res.status(500).json({ error: "BUY_FAILED", message: "Could not complete purchase" });
    return;
  }
  if (!updated) {
    // Lost the race — another buyer claimed it first.
    res.status(409).json({ error: "ALREADY_SOLD", message: "This listing has just been sold to another buyer" });
    return;
  }

  // 4. Record the deal so it shows up in both parties' Trust/Deals tabs.
  //    Idempotent on auction_id (UNIQUE constraint).
  const { error: dealErr } = await supabaseAdmin
    .from("auction_deals")
    .insert({
      auction_id: auctionId,
      seller_id: auction.seller_id,
      buyer_id: buyerId,
      winning_bid_id: null,
      winning_amount: auction.fixed_price,
    });

  if (dealErr && !/duplicate key/i.test(dealErr.message ?? "")) {
    // The auction is already marked sold — surface the deal failure but do
    // NOT roll back the sale. Log loudly so it can be reconciled.
    logger.error({ err: dealErr, auctionId, buyerId }, "POST /auctions/:id/buy: auction_deals insert failed (sale stands)");
  }

  logger.info({ auctionId, buyerId, sellerId: auction.seller_id, price: auction.fixed_price }, "Buy Now succeeded");

  res.status(200).json({ auction: updated });
});

// ─── POST /api/auctions/:id/mark-sold ────────────────────────────────────────
//
// Seller-only "Mark as sold" for fixed-price listings the seller closed
// out-of-band (e.g. via WhatsApp). Flips status 'active' → 'sold' atomically.
//
// Authorization rules (server-enforced — never trust the client):
//   • Caller must be authenticated.
//   • Caller must be the seller (auction.seller_id === req.user.id), else 403.
//   • Sale type must be 'fixed' — auctions close themselves via the lifecycle
//     scheduler when the timer expires; sellers must not short-circuit them.
//   • Status must currently be 'active' — re-marking 'sold' is a no-op 200,
//     'removed' returns 404, anything else returns 409.
//
// We use a status-CAS UPDATE (.eq("status","active")) to make the flip
// atomic against a concurrent /buy from another buyer; whichever request
// wins the race wins the row and the other gets a clean 409.
router.post("/auctions/:id/mark-sold", requireAuth, markSoldLimiter, async (req, res) => {
  const auctionId = req.params["id"];
  const userId = req.user!.id;

  // Input shape validation: id is a route param so already a string, but
  // a malformed/empty id would generate a confusing PostgREST error if we
  // didn't 400 here.
  if (!auctionId || typeof auctionId !== "string") {
    res.status(400).json({ error: "MISSING_ID", message: "Auction ID is required" });
    return;
  }

  const { data: auction, error: fetchErr } = await supabaseAdmin
    .from("auctions")
    .select("id, seller_id, sale_type, status")
    .eq("id", auctionId)
    .maybeSingle();

  if (fetchErr) {
    logger.error({ err: fetchErr.message, auctionId }, "POST /mark-sold: fetch failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load listing" });
    return;
  }
  if (!auction || auction.status === "removed") {
    res.status(404).json({ error: "NOT_FOUND", message: "Listing not found" });
    return;
  }
  if (auction.seller_id !== userId) {
    // Hard authorization fail — only the owning seller may close their listing.
    res.status(403).json({ error: "NOT_SELLER", message: "Only the seller can mark this listing sold" });
    return;
  }
  if (auction.sale_type !== "fixed") {
    res.status(409).json({
      error: "NOT_FIXED_PRICE",
      message: "Only fixed-price listings can be marked sold by the seller",
    });
    return;
  }
  if (auction.status === "sold") {
    // Idempotent — re-tap is harmless.
    res.json({ ok: true, alreadyMarked: true });
    return;
  }
  if (auction.status !== "active") {
    res.status(409).json({
      error: "NOT_ACTIVE",
      message: "Only active listings can be marked sold",
    });
    return;
  }

  // CAS update — defends against a /buy completing between our SELECT
  // above and our UPDATE here. If the buyer won the race, the buy handler
  // already stamped buyer_id + status='sold'; that row no longer matches
  // .eq("status","active") and our UPDATE returns 0 rows, which we treat
  // as "already sold" (idempotent success).
  const { data: updated, error: updErr } = await supabaseAdmin
    .from("auctions")
    .update({ status: "sold" })
    .eq("id", auctionId)
    .eq("seller_id", userId)
    .eq("sale_type", "fixed")
    .eq("status", "active")
    .select("id, status")
    .maybeSingle();

  if (updErr) {
    logger.error({ err: updErr.message, auctionId, userId }, "POST /mark-sold: update failed");
    res.status(500).json({ error: "UPDATE_FAILED", message: "Could not mark sold" });
    return;
  }
  if (!updated) {
    // Lost the race to a concurrent /buy — the listing is already sold.
    res.json({ ok: true, alreadyMarked: true });
    return;
  }

  logger.info({ auctionId, sellerId: userId }, "Fixed-price listing marked sold by seller");
  res.json({ ok: true, alreadyMarked: false });
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

// ─── POST /api/auctions/:id/share-to-followers ────────────────────────────────
// Sends an in-app "auction_shared" notification to every follower of the caller.
// Non-blocking per follower — a single failed notification never aborts the rest.
// Returns { success: true } immediately; notification delivery is fire-and-forget.

router.post("/auctions/:id/share-to-followers", requireAuth, async (req, res) => {
  const sharerId = req.user!.id;
  const auctionId = req.params.id;

  // 1. Verify the auction exists and is not deleted/removed.
  const { data: auction, error: auctionErr } = await supabaseAdmin
    .from("auctions")
    .select("id, title, status, seller_id")
    .eq("id", auctionId)
    .maybeSingle();

  if (auctionErr) {
    logger.error({ err: auctionErr, auctionId, sharerId }, "POST share-to-followers: auction lookup failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not verify auction." });
    return;
  }

  if (!auction || auction.status === "removed") {
    res.status(404).json({ error: "NOT_FOUND", message: "Auction not found." });
    return;
  }

  // 2. Fetch all followers of the caller.
  const { data: followRows, error: followErr } = await supabaseAdmin
    .from("user_follows")
    .select("follower_id")
    .eq("following_id", sharerId);

  if (followErr) {
    logger.error({ err: followErr, sharerId }, "POST share-to-followers: followers lookup failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not fetch followers." });
    return;
  }

  const followerIds = (followRows ?? []).map((r: { follower_id: string }) => r.follower_id);

  // 3. Reply immediately — notification delivery is fire-and-forget.
  res.json({ success: true, notified: followerIds.length });

  // 4. Send notifications in parallel (non-blocking, never crashes the response).
  if (followerIds.length > 0) {
    void Promise.allSettled(
      followerIds.map(followerId =>
        createNotification({
          userId: followerId,
          type: "auction_shared",
          actorId: sharerId,
          auctionId,
          title: auction.title,
          body: auction.title,
          metadata: { auctionId, actorId: sharerId },
        }).catch(err =>
          logger.warn({ err: String(err), followerId, auctionId }, "share-to-followers: notification failed for one follower"),
        ),
      ),
    );
    logger.info({ sharerId, auctionId, followerCount: followerIds.length }, "POST share-to-followers → notifications queued");
  }
});

export default router;
