/**
 * Feed Intelligence Ranking
 *
 * Computes a weighted relevance score for each auction in a feed page using
 * behavioural signals already captured in the product schema.
 * No new DB tables are required.
 *
 * Score components (additive, deterministic):
 *
 *   Explicit signals (this auction)
 *     interested                           +100
 *     not_interested                       −100
 *
 *   Implicit engagement (this auction)
 *     User has placed a bid                 +80
 *     User has saved this auction           +50
 *
 *   Seller affinity
 *     User follows this seller              +30
 *     Per "interested" on seller's others   +8 each, cap +20
 *     Per bid on seller's other auctions    +8 each, cap +15
 *     Per "not_interested" on seller        −8 each, floor −20
 *
 *   Category affinity
 *     Per "interested" in same category     +5 each, cap +10
 *     Per "not_interested" in category      −5 each, floor −10
 *
 * Design rules:
 *   - Works per-page — cursor-based pagination is never disrupted.
 *   - All context queries run in parallel (Promise.allSettled).
 *   - Each data source fails independently — an error = that source returns
 *     empty, never a thrown exception that aborts ranking.
 *   - Tie-breaking: Array.sort is stable in V8, so equal-score items keep
 *     their original created_at DESC order from the DB query.
 */

import { supabaseAdmin } from "./supabase.js";
import { getBidderCol } from "./dbSchema.js";
import { logger } from "./logger.js";

// ─── Score weights ─────────────────────────────────────────────────────────────

const W = {
  EXACT_INTERESTED:            100,
  EXACT_NOT_INTERESTED:       -100,
  BID_THIS:                     80,
  SAVED_THIS:                   50,
  FOLLOWS_SELLER:               30,
  SELLER_INTERESTED_PER:         8,
  SELLER_INTERESTED_MAX:        20,
  SELLER_BID_PER:                8,
  SELLER_BID_MAX:               15,
  CATEGORY_INTERESTED_PER:       5,
  CATEGORY_INTERESTED_MAX:      10,
  SELLER_NOT_INTERESTED_PER:    -8,
  SELLER_NOT_INTERESTED_FLOOR: -20,
  CATEGORY_NOT_INTERESTED_PER:  -5,
  CATEGORY_NOT_INTERESTED_FLOOR:-10,
} as const;

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface FeedUserContext {
  /** All of the user's explicit signals: auction_id → signal value */
  allSignals:        Map<string, "interested" | "not_interested">;
  /** Aggregate signal counts per seller: seller_id → { pos, neg } */
  sellerSignals:     Map<string, { pos: number; neg: number }>;
  /** Aggregate signal counts per category: category → { pos, neg } */
  categorySignals:   Map<string, { pos: number; neg: number }>;
  /** Auction IDs the user has bid on */
  biddedAuctionIds:  Set<string>;
  /** Number of auctions bid on per seller: seller_id → count */
  sellerBidCounts:   Map<string, number>;
  /** Auction IDs the user has saved */
  savedAuctionIds:   Set<string>;
  /** Seller IDs the user follows */
  followedSellerIds: Set<string>;
}

// ─── Context builder ──────────────────────────────────────────────────────────

/**
 * Gather all user signals and behavioural data for scoring the feed.
 *
 * Uses two serial rounds of parallel queries:
 *   Round 1 (parallel): signals, bids, saves, follows
 *   Round 2 (single):   auction details (seller_id, category) for signal/bid IDs
 *
 * Max latency overhead: ~2 × round-trip ≈ 30 ms on a warm connection.
 * All failures are non-fatal.
 */
export async function buildUserFeedContext(userId: string): Promise<FeedUserContext> {
  const ctx: FeedUserContext = {
    allSignals:        new Map(),
    sellerSignals:     new Map(),
    categorySignals:   new Map(),
    biddedAuctionIds:  new Set(),
    sellerBidCounts:   new Map(),
    savedAuctionIds:   new Set(),
    followedSellerIds: new Set(),
  };

  // ── Round 1: fetch all user behavioural data in parallel ──────────────────
  const bidderCol = await getBidderCol();

  const [signalRes, bidRes, saveRes, followRes] = await Promise.allSettled([
    supabaseAdmin
      .from("content_signals")
      .select("auction_id, signal")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(500),

    supabaseAdmin
      .from("bids")
      .select("auction_id")
      .eq(bidderCol, userId)
      .limit(200),

    supabaseAdmin
      .from("saved_auctions")
      .select("auction_id")
      .eq("user_id", userId)
      .limit(200),

    supabaseAdmin
      .from("user_follows")
      .select("following_id")
      .eq("follower_id", userId)
      .limit(500),
  ]);

  // Follows — no auction join needed
  if (followRes.status === "fulfilled") {
    for (const row of followRes.value.data ?? []) {
      ctx.followedSellerIds.add(row.following_id as string);
    }
  } else {
    logger.warn({ err: String(followRes.reason), userId }, "feed-ranking: follows query failed");
  }

  // Saves — no auction join needed
  if (saveRes.status === "fulfilled") {
    for (const row of saveRes.value.data ?? []) {
      ctx.savedAuctionIds.add(row.auction_id as string);
    }
  } else {
    logger.warn({ err: String(saveRes.reason), userId }, "feed-ranking: saves query failed");
  }

  // Collect auction IDs that need seller_id + category for the Round 2 query
  const signaledIds: string[] = signalRes.status === "fulfilled"
    ? (signalRes.value.data ?? []).map(r => r.auction_id as string)
    : [];

  const biddedIds: string[] = bidRes.status === "fulfilled"
    ? (bidRes.value.data ?? []).map(r => r.auction_id as string)
    : [];

  for (const id of biddedIds) ctx.biddedAuctionIds.add(id);

  if (bidRes.status === "rejected") {
    logger.warn({ err: String(bidRes.reason), userId }, "feed-ranking: bids query failed");
  }

  // ── Round 2: one batch query for auction details (seller + category) ───────
  const needsDetail = [...new Set([...signaledIds, ...biddedIds])];
  const auctionDetailMap = new Map<string, { seller_id: string; category: string }>();

  if (needsDetail.length > 0) {
    const { data: details, error } = await supabaseAdmin
      .from("auctions")
      .select("id, seller_id, category")
      .in("id", needsDetail);

    if (!error && details) {
      for (const d of details) {
        auctionDetailMap.set(d.id as string, {
          seller_id: d.seller_id as string,
          category: d.category as string,
        });
      }
    } else if (error) {
      logger.warn({ err: error.message, userId }, "feed-ranking: auction-detail query failed");
    }
  }

  // ── Build aggregated signal maps ─────────────────────────────────────────
  if (signalRes.status === "fulfilled") {
    for (const row of signalRes.value.data ?? []) {
      const aId = row.auction_id as string;
      const sig = row.signal as "interested" | "not_interested";
      ctx.allSignals.set(aId, sig);

      const detail = auctionDetailMap.get(aId);
      if (detail) {
        const s = ctx.sellerSignals.get(detail.seller_id) ?? { pos: 0, neg: 0 };
        if (sig === "interested") s.pos++; else s.neg++;
        ctx.sellerSignals.set(detail.seller_id, s);

        const c = ctx.categorySignals.get(detail.category) ?? { pos: 0, neg: 0 };
        if (sig === "interested") c.pos++; else c.neg++;
        ctx.categorySignals.set(detail.category, c);
      }
    }
  } else {
    logger.warn({ err: String(signalRes.reason), userId }, "feed-ranking: signals query failed");
  }

  // ── Build seller bid counts ──────────────────────────────────────────────
  for (const aId of biddedIds) {
    const detail = auctionDetailMap.get(aId);
    if (detail) {
      const count = ctx.sellerBidCounts.get(detail.seller_id) ?? 0;
      ctx.sellerBidCounts.set(detail.seller_id, count + 1);
    }
  }

  logger.info({
    userId,
    signals:        ctx.allSignals.size,
    sellerSignals:  ctx.sellerSignals.size,
    categorySignals:ctx.categorySignals.size,
    bids:           ctx.biddedAuctionIds.size,
    saves:          ctx.savedAuctionIds.size,
    follows:        ctx.followedSellerIds.size,
  }, "feed-ranking: context built");

  return ctx;
}

// ─── Scorer ───────────────────────────────────────────────────────────────────

/**
 * Compute a relevance score for a single auction.
 * All components are additive and independent.
 * Returns 0 for fully neutral / unknown auctions.
 */
export function scoreAuction(
  auction: { id: string; seller_id: string; category: string },
  ctx: FeedUserContext,
): number {
  let score = 0;
  const { id, seller_id, category } = auction;

  // 1. Explicit signal on this exact auction
  const sig = ctx.allSignals.get(id);
  if (sig === "interested")     score += W.EXACT_INTERESTED;
  if (sig === "not_interested") score += W.EXACT_NOT_INTERESTED;

  // 2. User has bid on this auction (strongest implicit positive)
  if (ctx.biddedAuctionIds.has(id)) score += W.BID_THIS;

  // 3. User has saved this auction
  if (ctx.savedAuctionIds.has(id)) score += W.SAVED_THIS;

  // 4. User follows this seller
  if (ctx.followedSellerIds.has(seller_id)) score += W.FOLLOWS_SELLER;

  // 5. Seller-level signals from other auctions (capped)
  const ss = ctx.sellerSignals.get(seller_id);
  if (ss) {
    if (ss.pos > 0) {
      score += Math.min(W.SELLER_INTERESTED_MAX,      ss.pos * W.SELLER_INTERESTED_PER);
    }
    if (ss.neg > 0) {
      score += Math.max(W.SELLER_NOT_INTERESTED_FLOOR, ss.neg * W.SELLER_NOT_INTERESTED_PER);
    }
  }

  // 6. User bid on other auctions by this seller (capped)
  const sellerBids = ctx.sellerBidCounts.get(seller_id) ?? 0;
  if (sellerBids > 0) {
    score += Math.min(W.SELLER_BID_MAX, sellerBids * W.SELLER_BID_PER);
  }

  // 7. Category-level signals (capped)
  const cs = ctx.categorySignals.get(category);
  if (cs) {
    if (cs.pos > 0) {
      score += Math.min(W.CATEGORY_INTERESTED_MAX,      cs.pos * W.CATEGORY_INTERESTED_PER);
    }
    if (cs.neg > 0) {
      score += Math.max(W.CATEGORY_NOT_INTERESTED_FLOOR, cs.neg * W.CATEGORY_NOT_INTERESTED_PER);
    }
  }

  return score;
}
