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
import { notifyOutbid, notifyAuctionStarted, notifyBidReceived } from "../lib/notifications";
import { sendWhatsAppMessage } from "../lib/whatsapp";
import { buildOutbidMessage } from "../lib/whatsappTemplates";
import { getBidderCol, getBidderUserId, hasWinnerBidIdCol } from "../lib/dbSchema";
import { deleteMediaFile } from "../lib/media-lifecycle";
import { runAuctionLifecycle } from "../lib/auction-lifecycle";
import { processVideoAsync } from "../lib/video-processing";
import { assertOwnedMediaUrl } from "../lib/r2";
import { buildUserFeedContext, scoreAuction } from "../lib/feed-ranking";
import { recordEngagement } from "./views";

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
    sale_type, fixed_price,
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
      sale_type,
      fixed_price,
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

/**
 * Buyer-side $1 unlock model (migration 032 — auction_unlocks table).
 *
 * For each (auction, viewer) pair the API decides whether the viewer is
 * "unlocked". Unlocked viewers see the seller's phone and may place bids;
 * locked viewers get a redacted seller (phone=null) and 402 from the bid
 * endpoint. The seller of an auction is always treated as unlocked on
 * their own listing (they never pay to access their own auction). Fixed-
 * price listings (sale_type='fixed') are exempt from the gate entirely.
 *
 * The {@link loadUnlockedAuctionIdsForUser} helper does ONE query for
 * a batch of auction ids so the public feed pays a single round-trip
 * regardless of page size.
 */
async function loadUnlockedAuctionIdsForUser(
  userId: string | null,
  auctionIds: string[],
): Promise<Set<string>> {
  if (!userId || auctionIds.length === 0) return new Set();
  const { data, error } = await supabaseAdmin
    .from("auction_unlocks")
    .select("auction_id")
    .eq("user_id", userId)
    .eq("payment_status", "paid")
    .eq("can_view_contact", true)
    .in("auction_id", auctionIds);
  if (error) {
    // Log + fail closed (treat user as locked). Schema-cache hiccups should
    // not silently un-redact phone numbers.
    logger.warn(
      { err: error.message, userId, count: auctionIds.length },
      "loadUnlockedAuctionIdsForUser: query failed — treating as locked",
    );
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.auction_id as string));
}

/**
 * Decide whether the calling viewer can see contact / bid on this auction.
 * Returns true for fixed-price listings, for the auction's own seller, or
 * when the viewer has a paid unlock row. False otherwise (including when
 * viewer is anonymous).
 */
function isUnlockedForViewer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auction: any,
  viewerId: string | null,
  unlockedAuctionIds: Set<string>,
): boolean {
  if (!auction) return false;
  if (auction.sale_type === "fixed") return true;
  if (viewerId && auction.seller_id === viewerId) return true;
  return unlockedAuctionIds.has(auction.id as string);
}

/**
 * Strip the seller's phone number from a seller profile if the calling
 * viewer is not unlocked for this specific auction. Other profile fields
 * (name, avatar, username) stay so the UI can still show "Listed by
 * @username" — only the contact channel is gated.
 *
 * Always returns a NEW object when redacting; never mutates input.
 */
function redactSellerForViewer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auction: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  seller: any,
  viewerId: string | null,
  unlockedAuctionIds: Set<string>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (!seller) return seller;
  if (isUnlockedForViewer(auction, viewerId, unlockedAuctionIds)) return seller;
  return { ...seller, phone: null };
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
    viewer_unlocked: boolean;
  };

  // ── Cursor for next page ──────────────────────────────────────────────────
  // Captured from the RAW DB result (before signal re-ranking) so the client
  // can request the next page of older items without gaps or duplicates.
  // We return null when fewer than PAGE_SIZE items came back (= no more pages).
  const rawItems = auctions ?? [];
  const nextCursor: string | null = rawItems.length === PAGE_SIZE
    ? (rawItems[rawItems.length - 1].created_at as string)
    : null;

  // ── Per-viewer unlock resolution (migration 032 — buyer-side $1 gate) ────
  // ONE batch query against auction_unlocks for the visible page. For
  // anonymous viewers viewerId is null and the helper returns an empty set
  // (everything stays locked).
  const viewerId = await getViewerIdFromAuthHeader(req.headers["authorization"] as string | undefined);
  const unlockedAuctionIds = await loadUnlockedAuctionIdsForUser(viewerId, auctionIds);

  let feed: AuctionWithMeta[] = rawItems.map((a) => ({
    ...normalizeAuction(a),
    // Redact seller phone unless this viewer is unlocked for this auction.
    // Fixed-price listings and the seller's own listings are never redacted.
    seller: redactSellerForViewer(a, profileMap.get(a.seller_id) ?? null, viewerId, unlockedAuctionIds),
    user_signal: null as "interested" | "not_interested" | null,
    views_count: viewMap.get(a.id as string) ?? 0,
    viewer_unlocked: isUnlockedForViewer(a, viewerId, unlockedAuctionIds),
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

  // NOTE: This is the seller's OWN auctions endpoint. The seller is always
  // "unlocked" on their own listings (they never pay to access their own
  // contact info), so we never redact here. viewer_unlocked is also set to
  // true for every row so the response shape matches the public feed.
  const feed = (auctions ?? []).map((a) => ({
    ...normalizeAuction(a),
    seller: profile ?? null,
    user_signal: null,
    viewer_unlocked: true,
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

  // ── Per-viewer unlock resolution (migration 032 — buyer-side $1 gate) ──
  // Single (auction, viewer) lookup. callerId is set above from the optional
  // Bearer token — anonymous viewers stay locked.
  const unlockedAuctionIds = await loadUnlockedAuctionIdsForUser(callerId, [id]);
  const viewerUnlocked = isUnlockedForViewer(auctionData, callerId, unlockedAuctionIds);

  const auctionWithSeller = {
    ...normalizeAuction(auctionData),
    seller: redactSellerForViewer(
      auctionData,
      profileMap.get(auctionData.seller_id) ?? null,
      callerId,
      unlockedAuctionIds,
    ),
    viewer_unlocked: viewerUnlocked,
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

  const { title, description, category, startPrice, saleType, fixedPrice, minIncrement, videoUrl, thumbnailUrl, lat, lng, currencyCode, currencyLabel, durationHours } =
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
  {
    const { data: sellerRow, error: sellerErr } = await supabaseAdmin
      .from("profiles")
      .select("phone")
      .eq("id", sellerId)
      .maybeSingle();
    if (sellerErr) {
      logger.error({ err: sellerErr, sellerId }, "POST /auctions: phone gate lookup failed");
      res.status(500).json({ error: "PROFILE_LOOKUP_FAILED", message: "Could not verify seller profile." });
      return;
    }
    const phone = (sellerRow?.phone ?? "").trim();
    if (phone.length === 0) {
      logger.warn({ sellerId }, "POST /auctions blocked: seller has no phone on file");
      res.status(400).json({
        error: "PHONE_REQUIRED",
        message: "Phone required before creating auction",
      });
      return;
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
  // durationHours is validated by the schema (1–48). We defensively
  // re-coerce + re-validate here because this value is fed directly into
  // the DB duration CHECK constraint — a stray value would surface as an
  // opaque 500 from Postgres instead of a clean 400.
  console.log("DEBUG incoming durationHours:", durationHours, typeof durationHours);
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
    created_at: createdAt.toISOString(),
    ends_at: endsAt.toISOString(),
    media_purge_after: mediaPurgeAfter.toISOString(),
    sale_type: saleType,
    fixed_price: effectiveFixedPrice,
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

  // 3a. Fixed-price listings do not accept bids — they use POST /:id/buy.
  if (auction.sale_type === "fixed") {
    return { ok: false, status: 409, body: { error: "FIXED_PRICE_LISTING", message: "This is a fixed-price listing — use Buy Now instead." } };
  }

  // 3a-bis. Buyer-side unlock gate (migration 032). Auction listings
  // (sale_type='auction') require the BIDDER to have paid $1 for THIS
  // specific auction before they can bid. Fixed-price is exempt (handled
  // above). The seller of an auction never needs to pay (handled at step
  // 4 below — own-auction → 403 SELLER_CANNOT_BID). For everyone else,
  // we look up the unlock row and reject with 402 if missing. Failing
  // closed: a query error here also returns 402, never silently allows.
  const unlockSet = await loadUnlockedAuctionIdsForUser(userId, [auctionId]);
  if (auction.seller_id !== userId && !unlockSet.has(auctionId)) {
    return {
      ok: false,
      status: 402,
      body: {
        error: "AUCTION_NOT_UNLOCKED",
        message: "Pay $1 to unlock bidding for this auction.",
      },
    };
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
      notifyOutbid(prevLeaderUserId, userId, auctionId, auction.title ?? "this auction", newPrice)
        .catch(err => logger.error({ err: String(err), auctionId, recipient: prevLeaderUserId }, "push-chain[2.outbid]: notifyOutbid threw")),
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

router.post("/auctions/:id/buy", requireAuth, async (req, res) => {
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

// ─── Gumroad checkout config ─────────────────────────────────────────────────
// The single $1 product link. The token query-param is appended per checkout
// so we can later reconcile the Gumroad receipt back to the (auction,user)
// pair that created it (see /unlock/start).
const GUMROAD_PRODUCT_URL = "https://lyracoin.gumroad.com/l/frgfn";

// ─── POST /api/auctions/:id/unlock/start ─────────────────────────────────────
//
// Step 1 of the real payment flow. The frontend calls this BEFORE redirecting
// the buyer to Gumroad. We:
//   1. Validate caller may unlock (auth, not seller, not fixed-price, exists).
//   2. Look up any existing auction_unlocks row for (auctionId, userId).
//      • If already 'paid'   → return alreadyUnlocked=true, no checkout.
//      • If already 'pending'→ reuse the existing unlock_token (idempotent).
//      • Otherwise           → INSERT a new pending row with a fresh token.
//   3. Build the Gumroad checkout URL by appending ?token=<unlock_token> to
//      the product URL. The token is what the future webhook will use to
//      flip this row from 'pending' to 'paid' against the right pair.
//
// Returns:
//   { ok, status: 'pending' | 'paid', alreadyUnlocked, checkout_url, unlock_token }
//
// The token is a server-generated UUIDv4 stored in auction_unlocks.unlock_token
// (UNIQUE WHERE NOT NULL). It is opaque to the client — used only as a
// receipt-matching identifier. Pending rows are kept indefinitely so that a
// buyer who closes the tab mid-checkout can resume with the same token.
router.post("/auctions/:id/unlock/start", requireAuth, async (req, res) => {
  const auctionId = req.params["id"];
  const userId = req.user!.id;

  if (!auctionId) {
    res.status(400).json({ error: "MISSING_ID", message: "Auction ID is required" });
    return;
  }

  const { data: auction, error: fetchErr } = await supabaseAdmin
    .from("auctions")
    .select("id, seller_id, sale_type, status")
    .eq("id", auctionId)
    .maybeSingle();

  if (fetchErr) {
    logger.error({ err: fetchErr.message, auctionId }, "POST /unlock/start: lookup failed");
    res.status(500).json({ error: "LOOKUP_FAILED", message: "Could not load auction." });
    return;
  }
  if (!auction || auction.status === "removed") {
    res.status(404).json({ error: "NOT_FOUND", message: "Auction not found" });
    return;
  }
  if (auction.sale_type === "fixed") {
    res.status(400).json({
      error: "FIXED_PRICE_NO_UNLOCK",
      message: "Fixed-price listings are free — no unlock needed.",
    });
    return;
  }
  if (auction.seller_id === userId) {
    res.status(400).json({
      error: "SELLER_CANNOT_UNLOCK_OWN",
      message: "You don't need to unlock your own auction.",
    });
    return;
  }

  // Reuse an existing row when present so the same token is returned on
  // re-clicks (idempotent). If no row exists, create one with a fresh token.
  const { data: existing, error: existErr } = await supabaseAdmin
    .from("auction_unlocks")
    .select("payment_status, unlock_token")
    .eq("auction_id", auctionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existErr) {
    logger.error({ err: existErr.message, auctionId, userId }, "POST /unlock/start: existing lookup failed");
    res.status(500).json({ error: "LOOKUP_FAILED", message: "Could not check unlock state." });
    return;
  }

  if (existing && existing.payment_status === "paid") {
    res.json({
      ok: true,
      status: "paid",
      alreadyUnlocked: true,
      checkout_url: null,
      unlock_token: null,
    });
    return;
  }

  let unlockToken = existing?.unlock_token ?? null;

  if (!unlockToken) {
    unlockToken = randomUUID();
    const { error: upsertErr } = await supabaseAdmin
      .from("auction_unlocks")
      .upsert(
        {
          auction_id: auctionId,
          user_id: userId,
          payment_status: "pending",
          can_bid: false,
          can_view_contact: false,
          payment_provider: "gumroad",
          unlock_token: unlockToken,
        },
        { onConflict: "auction_id,user_id" },
      );

    if (upsertErr) {
      logger.error(
        { err: upsertErr.message, auctionId, userId },
        "POST /unlock/start: pending upsert failed",
      );
      res.status(500).json({ error: "START_FAILED", message: "Could not start unlock." });
      return;
    }
  }

  const checkoutUrl = `${GUMROAD_PRODUCT_URL}?token=${encodeURIComponent(unlockToken)}`;

  logger.info(
    { auctionId, userId, reused: !!existing?.unlock_token },
    "Unlock checkout session started",
  );

  res.json({
    ok: true,
    status: "pending",
    alreadyUnlocked: false,
    checkout_url: checkoutUrl,
    unlock_token: unlockToken,
  });
});

// ─── POST /api/auctions/:id/unlock ───────────────────────────────────────────
//
// Per-user, per-auction buyer unlock ("I have paid" confirmation step).
//
// Real payment flow:
//   1. Buyer opens an auction detail; if not yet unlocked, sees the panel.
//   2. Tap "Pay $1 to Unlock" → POST /unlock/start → redirected to Gumroad
//      checkout URL (which carries our unlock_token).
//   3. After paying on Gumroad, buyer returns and taps "I have paid".
//   4. Frontend POSTs here. If a pending row exists for this (auction,user)
//      it is flipped to 'paid'; otherwise a fresh paid row is created.
//      The (auction_id, user_id) UNIQUE constraint guarantees idempotency.
//
// Trust model (MVP): this endpoint trusts the buyer's "I have paid" claim.
// A production webhook will set payment_status='paid' only after Gumroad
// confirms the receipt for the matching unlock_token.
//
// Authorization rules:
//   • Caller must be authenticated.
//   • The auction's seller may NOT unlock their own auction (400).
//   • Fixed-price listings are exempt from the gate entirely (400).
//   • Soft-deleted ('removed') rows return 404.
router.post("/auctions/:id/unlock", requireAuth, async (req, res) => {
  const auctionId = req.params["id"];
  const userId = req.user!.id;

  if (!auctionId) {
    res.status(400).json({ error: "MISSING_ID", message: "Auction ID is required" });
    return;
  }

  const { data: auction, error: fetchErr } = await supabaseAdmin
    .from("auctions")
    .select("id, seller_id, sale_type, status")
    .eq("id", auctionId)
    .maybeSingle();

  if (fetchErr) {
    logger.error({ err: fetchErr.message, auctionId }, "POST /auctions/:id/unlock: lookup failed");
    res.status(500).json({ error: "LOOKUP_FAILED", message: "Could not load auction." });
    return;
  }
  if (!auction || auction.status === "removed") {
    res.status(404).json({ error: "NOT_FOUND", message: "Auction not found" });
    return;
  }
  if (auction.sale_type === "fixed") {
    res.status(400).json({
      error: "FIXED_PRICE_NO_UNLOCK",
      message: "Fixed-price listings are free — no unlock needed.",
    });
    return;
  }
  if (auction.seller_id === userId) {
    res.status(400).json({
      error: "SELLER_CANNOT_UNLOCK_OWN",
      message: "You don't need to unlock your own auction.",
    });
    return;
  }

  // Look up an existing row first so we know whether this is:
  //   • a fresh paid insert       (no row, or no token-row from /start),
  //   • a pending→paid transition (the /start row gets flipped to 'paid'),
  //   • or a re-click no-op       (already paid).
  const { data: existing, error: existErr } = await supabaseAdmin
    .from("auction_unlocks")
    .select("payment_status, created_at")
    .eq("auction_id", auctionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existErr) {
    logger.error({ err: existErr.message, auctionId, userId }, "POST /unlock: existing lookup failed");
    res.status(500).json({ error: "LOOKUP_FAILED", message: "Could not check unlock state." });
    return;
  }

  if (existing && existing.payment_status === "paid") {
    logger.info({ auctionId, userId }, "POST /unlock: already paid — no-op");
    res.json({
      ok: true,
      unlockedAt: existing.created_at,
      alreadyUnlocked: true,
    });
    return;
  }

  // UPSERT to 'paid'. When a pending row exists (created by /unlock/start),
  // this flips it; otherwise it inserts fresh. The unlock_token (if any)
  // is intentionally preserved so a future Gumroad webhook can still match.
  const { data: upserted, error: upErr } = await supabaseAdmin
    .from("auction_unlocks")
    .upsert(
      {
        auction_id: auctionId,
        user_id: userId,
        payment_status: "paid",
        can_bid: true,
        can_view_contact: true,
        payment_provider: "gumroad",
      },
      { onConflict: "auction_id,user_id" },
    )
    .select("created_at")
    .maybeSingle();

  if (upErr || !upserted) {
    logger.error({ err: upErr?.message, auctionId, userId }, "POST /unlock: upsert failed");
    res.status(500).json({ error: "UNLOCK_FAILED", message: "Could not unlock auction." });
    return;
  }

  logger.info(
    { auctionId, userId, transitioned: existing?.payment_status === "pending" },
    "Auction unlocked for buyer (MVP — trust-on-claim)",
  );
  res.json({ ok: true, unlockedAt: upserted.created_at, alreadyUnlocked: false });
});

export default router;
