/**
 * Feed Intelligence Ranking — v2
 *
 * Computes a weighted relevance score for each auction in a feed page using
 * behavioural signals already captured in the product schema.
 * No new DB tables are required.
 *
 * Score components (additive, deterministic):
 *
 *   Explicit signals (this auction)
 *     interested                           +100   (hard positive)
 *     not_interested                        → hard-excluded in caller, not scored
 *
 *   Implicit auction-level engagement
 *     User has placed a bid                 +80
 *     User has saved this auction           +50
 *     User has liked this auction           +35
 *
 *   Popularity signal (auction-level, not user-level)
 *     qualified_views_count                 +0.5 each, cap +15
 *
 *   Temporal boosts (universal — no affinity multiplier)
 *     ends_at < 2 h                         +60
 *     ends_at 2 h – 6 h                     +30
 *     bid_count ≥ 5 AND ends_at < 24 h      +40   (hot)
 *
 *   Seller affinity (× premium multiplier for is_premium users)
 *     User follows this seller              +30
 *     Per bid on seller's auctions          +8 each, cap +15
 *     Per interested signal on seller       +8 each, cap +20
 *     Per like on seller's auctions         +5 each, cap +12
 *     Per save on seller's auctions         +5 each, cap +12
 *     Per not_interested signal on seller   −8 each, floor −20
 *
 *   Category affinity (× premium multiplier for is_premium users)
 *     Per bid in category                   +8 each, cap +20
 *     Per interested signal in category     +5 each, cap +10
 *     Per save in category                  +4 each, cap +10
 *     Per like in category                  +3 each, cap +8
 *     Per not_interested signal in category −5 each, floor −10
 *
 * Premium boost:
 *   All seller + category affinity components are multiplied by 1.2 for
 *   authenticated users with is_premium = true.
 *
 * Hard suppression:
 *   Auctions marked not_interested by the user are filtered out of the
 *   response entirely by the caller — they are never scored here.
 *
 * Design rules:
 *   - Works per-page: cursor-based pagination is never disrupted.
 *   - All context queries run in parallel (Promise.allSettled).
 *   - Each data source fails independently — error → empty, never throws.
 *   - Tie-breaking: Array.sort is stable in V8, equal-score items keep
 *     their original created_at DESC order from the DB query.
 */

import { supabaseAdmin } from "./supabase.js";
import { getBidderCol } from "./dbSchema.js";
import { logger } from "./logger.js";

// ─── Score weights ─────────────────────────────────────────────────────────────

const W = {
  // Exact-auction explicit signal
  EXACT_INTERESTED:              100,

  // Exact-auction implicit engagement
  BID_THIS:                       80,
  SAVED_THIS:                     50,
  LIKED_THIS:                     35,

  // Popularity (auction-level view count — not user-specific)
  POPULARITY_PER_VIEW:             0.5,
  POPULARITY_MAX:                 15,

  // Temporal boosts (not scaled by affinity multiplier)
  ENDING_SOON_2H:                 60,
  ENDING_SOON_6H:                 30,
  HOT_AUCTION:                    40,
  HOT_BID_THRESHOLD:               5,   // min bid_count to qualify as "hot"
  HOT_HOURS_WINDOW:               24,   // hours window for hot detection

  // Seller affinity (scaled by premium multiplier)
  FOLLOWS_SELLER:                 30,
  SELLER_BID_PER:                  8,
  SELLER_BID_MAX:                 15,
  SELLER_INTERESTED_PER:           8,
  SELLER_INTERESTED_MAX:          20,
  SELLER_LIKED_PER:                5,
  SELLER_LIKED_MAX:               12,
  SELLER_SAVED_PER:                5,
  SELLER_SAVED_MAX:               12,
  SELLER_NOT_INTERESTED_PER:      -8,
  SELLER_NOT_INTERESTED_FLOOR:   -20,

  // Category affinity (scaled by premium multiplier)
  CATEGORY_BID_PER:                8,
  CATEGORY_BID_MAX:               20,
  CATEGORY_INTERESTED_PER:         5,
  CATEGORY_INTERESTED_MAX:        10,
  CATEGORY_SAVED_PER:              4,
  CATEGORY_SAVED_MAX:             10,
  CATEGORY_LIKED_PER:              3,
  CATEGORY_LIKED_MAX:              8,
  CATEGORY_NOT_INTERESTED_PER:    -5,
  CATEGORY_NOT_INTERESTED_FLOOR: -10,

  // Premium subscription: affinity components × this multiplier
  PREMIUM_AFFINITY_MULTIPLIER:     1.2,
} as const;

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface FeedUserContext {
  /** All of the user's explicit signals: auction_id → signal value */
  allSignals:         Map<string, "interested" | "not_interested">;
  /** Auction IDs the user has bid on */
  biddedAuctionIds:   Set<string>;
  /** Auction IDs the user has saved */
  savedAuctionIds:    Set<string>;
  /** Auction IDs the user has liked */
  likedAuctionIds:    Set<string>;
  /** Seller IDs the user follows */
  followedSellerIds:  Set<string>;
  /** Per-seller interested/not_interested counts from content_signals */
  sellerSignals:      Map<string, { pos: number; neg: number }>;
  /** Per-seller bid counts (how many of that seller's auctions the user bid on) */
  sellerBidCounts:    Map<string, number>;
  /** Per-seller like counts */
  sellerLikeCounts:   Map<string, number>;
  /** Per-seller save counts */
  sellerSaveCounts:   Map<string, number>;
  /** Per-category interested/not_interested counts from content_signals */
  categorySignals:    Map<string, { pos: number; neg: number }>;
  /** Per-category bid counts */
  categoryBidCounts:  Map<string, number>;
  /** Per-category like counts */
  categoryLikeCounts: Map<string, number>;
  /** Per-category save counts */
  categorySaveCounts: Map<string, number>;
}

// ─── Activity group ────────────────────────────────────────────────────────────

export type UserActivityGroup =
  | "power_bidder"
  | "active_user"
  | "casual_browser"
  | "new_user";

/**
 * Derives the user's activity group from their FeedUserContext.
 * No additional DB queries — all signals are already loaded.
 *
 * Activity score formula:
 *   unique auctions bid on × 7
 *   + follows            × 2.0
 *   + saves              × 1.5
 *   + likes              × 1.0
 *   + explicit signals   × 0.5
 *
 * Thresholds (calibrate post-launch as data accumulates):
 *   power_bidder   ≥ 40
 *   active_user    ≥ 15
 *   casual_browser ≥  3
 *   new_user       <  3
 */
export function computeUserActivityGroup(ctx: FeedUserContext): UserActivityGroup {
  const score =
    ctx.biddedAuctionIds.size  * 7.0
    + ctx.followedSellerIds.size * 2.0
    + ctx.savedAuctionIds.size   * 1.5
    + ctx.likedAuctionIds.size   * 1.0
    + ctx.allSignals.size        * 0.5;

  if (score >= 40) return "power_bidder";
  if (score >= 15) return "active_user";
  if (score >=  3) return "casual_browser";
  return "new_user";
}

// ─── Recommendation tag ────────────────────────────────────────────────────────

export type RecommendationTag =
  | "recommended_for_you"
  | "hot"
  | "ending_soon"
  | null;

/**
 * Returns the single best recommendation tag for an auction.
 * Priority order: hot > ending_soon > recommended_for_you > null.
 *
 * @param auction     Public fields: bid_count, ends_at.
 * @param score       Relevance score computed by scoreAuction().
 * @param hasSignals  Whether the user has any positive behavioural signals.
 */
export function getRecommendationTag(
  auction: { bid_count?: number | null; ends_at?: string | null },
  score: number,
  hasSignals: boolean,
): RecommendationTag {
  const now       = Date.now();
  const endsAt    = auction.ends_at ? new Date(auction.ends_at).getTime() : null;
  const bidCount  = auction.bid_count ?? 0;
  const msLeft    = endsAt !== null ? endsAt - now : null;

  // Hot: high bid activity, actively ending within 24 h
  if (
    bidCount >= W.HOT_BID_THRESHOLD &&
    msLeft !== null &&
    msLeft > 0 &&
    msLeft <= W.HOT_HOURS_WINDOW * 60 * 60 * 1000
  ) {
    return "hot";
  }

  // Ending soon: less than 2 h remaining
  if (msLeft !== null && msLeft > 0 && msLeft <= 2 * 60 * 60 * 1000) {
    return "ending_soon";
  }

  // Recommended for you: positive personalized score with at least one signal
  if (score > 0 && hasSignals) {
    return "recommended_for_you";
  }

  return null;
}

// ─── Context builder ──────────────────────────────────────────────────────────

/**
 * Gather all user signals and behavioural data needed to score the feed.
 *
 * Two rounds:
 *   Round 1 (parallel): content_signals, bids, saved_auctions, likes, user_follows
 *   Round 2 (single):   batch auction details (seller_id, category) for all IDs
 *                        collected in Round 1
 *
 * Max latency overhead: ~2 × one round-trip ≈ 30 ms on a warm connection.
 * All failures are non-fatal — the failing source returns empty data.
 */
export async function buildUserFeedContext(userId: string): Promise<FeedUserContext> {
  const ctx: FeedUserContext = {
    allSignals:         new Map(),
    biddedAuctionIds:   new Set(),
    savedAuctionIds:    new Set(),
    likedAuctionIds:    new Set(),
    followedSellerIds:  new Set(),
    sellerSignals:      new Map(),
    sellerBidCounts:    new Map(),
    sellerLikeCounts:   new Map(),
    sellerSaveCounts:   new Map(),
    categorySignals:    new Map(),
    categoryBidCounts:  new Map(),
    categoryLikeCounts: new Map(),
    categorySaveCounts: new Map(),
  };

  const bidderCol = await getBidderCol();

  // ── Round 1: all user signals in parallel ─────────────────────────────────
  const [signalRes, bidRes, saveRes, likeRes, followRes] = await Promise.allSettled([
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
      .from("likes")
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

  // Saves
  const savedIds: string[] = [];
  if (saveRes.status === "fulfilled") {
    for (const row of saveRes.value.data ?? []) {
      const id = row.auction_id as string;
      ctx.savedAuctionIds.add(id);
      savedIds.push(id);
    }
  } else {
    logger.warn({ err: String(saveRes.reason), userId }, "feed-ranking: saves query failed");
  }

  // Likes
  const likedIds: string[] = [];
  if (likeRes.status === "fulfilled") {
    for (const row of likeRes.value.data ?? []) {
      const id = row.auction_id as string;
      ctx.likedAuctionIds.add(id);
      likedIds.push(id);
    }
  } else {
    logger.warn({ err: String(likeRes.reason), userId }, "feed-ranking: likes query failed");
  }

  // Bids
  const biddedIds: string[] = [];
  if (bidRes.status === "fulfilled") {
    for (const row of bidRes.value.data ?? []) {
      const id = row.auction_id as string;
      ctx.biddedAuctionIds.add(id);
      biddedIds.push(id);
    }
  } else {
    logger.warn({ err: String(bidRes.reason), userId }, "feed-ranking: bids query failed");
  }

  // Signal auction IDs
  const signaledIds: string[] = signalRes.status === "fulfilled"
    ? (signalRes.value.data ?? []).map(r => r.auction_id as string)
    : [];
  if (signalRes.status === "rejected") {
    logger.warn({ err: String(signalRes.reason), userId }, "feed-ranking: signals query failed");
  }

  // ── Round 2: batch auction detail lookup (seller_id + category) ───────────
  // Merge all auction IDs from every signal source into one deduplicated set,
  // then fetch seller_id + category in a single round-trip.
  const needsDetail = [...new Set([...signaledIds, ...biddedIds, ...savedIds, ...likedIds])];
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
          category:  d.category  as string,
        });
      }
    } else if (error) {
      logger.warn({ err: error.message, userId }, "feed-ranking: auction-detail query failed");
    }
  }

  // ── Populate content_signal maps (interested / not_interested) ────────────
  if (signalRes.status === "fulfilled") {
    for (const row of signalRes.value.data ?? []) {
      const aId = row.auction_id as string;
      const sig  = row.signal as "interested" | "not_interested";
      ctx.allSignals.set(aId, sig);

      const detail = auctionDetailMap.get(aId);
      if (!detail) continue;

      const ss = ctx.sellerSignals.get(detail.seller_id) ?? { pos: 0, neg: 0 };
      if (sig === "interested") ss.pos++; else ss.neg++;
      ctx.sellerSignals.set(detail.seller_id, ss);

      const cs = ctx.categorySignals.get(detail.category) ?? { pos: 0, neg: 0 };
      if (sig === "interested") cs.pos++; else cs.neg++;
      ctx.categorySignals.set(detail.category, cs);
    }
  }

  // ── Populate bid affinity maps ────────────────────────────────────────────
  for (const aId of biddedIds) {
    const detail = auctionDetailMap.get(aId);
    if (!detail) continue;
    ctx.sellerBidCounts.set(
      detail.seller_id,
      (ctx.sellerBidCounts.get(detail.seller_id) ?? 0) + 1,
    );
    ctx.categoryBidCounts.set(
      detail.category,
      (ctx.categoryBidCounts.get(detail.category) ?? 0) + 1,
    );
  }

  // ── Populate like affinity maps ───────────────────────────────────────────
  for (const aId of likedIds) {
    const detail = auctionDetailMap.get(aId);
    if (!detail) continue;
    ctx.sellerLikeCounts.set(
      detail.seller_id,
      (ctx.sellerLikeCounts.get(detail.seller_id) ?? 0) + 1,
    );
    ctx.categoryLikeCounts.set(
      detail.category,
      (ctx.categoryLikeCounts.get(detail.category) ?? 0) + 1,
    );
  }

  // ── Populate save affinity maps ───────────────────────────────────────────
  for (const aId of savedIds) {
    const detail = auctionDetailMap.get(aId);
    if (!detail) continue;
    ctx.sellerSaveCounts.set(
      detail.seller_id,
      (ctx.sellerSaveCounts.get(detail.seller_id) ?? 0) + 1,
    );
    ctx.categorySaveCounts.set(
      detail.category,
      (ctx.categorySaveCounts.get(detail.category) ?? 0) + 1,
    );
  }

  logger.info({
    userId,
    signals:         ctx.allSignals.size,
    sellerSignals:   ctx.sellerSignals.size,
    categorySignals: ctx.categorySignals.size,
    bids:            ctx.biddedAuctionIds.size,
    saves:           ctx.savedAuctionIds.size,
    likes:           ctx.likedAuctionIds.size,
    follows:         ctx.followedSellerIds.size,
  }, "feed-ranking: context built");

  return ctx;
}

// ─── Scorer ───────────────────────────────────────────────────────────────────

/**
 * Compute a relevance score for a single auction given the user's feed context.
 * All components are additive and independent.
 *
 * Note: not_interested auctions must be filtered out by the caller BEFORE
 * calling this function — they are excluded, not scored with a negative value.
 *
 * @param auction      Public fields from the auction row.
 * @param ctx          User feed context (signals, bids, saves, likes, follows).
 * @param isPremium    True when the authenticated user has an active subscription.
 *                     Premium users get a 1.2× multiplier on seller + category
 *                     affinity components (not on temporal or exact-match signals).
 */
export function scoreAuction(
  auction: {
    id:                     string;
    seller_id:              string;
    category:               string;
    bid_count?:             number | null;
    ends_at?:               string | null;
    qualified_views_count?: number | null;
  },
  ctx: FeedUserContext,
  isPremium = false,
): number {
  let score = 0;
  const affinityMul = isPremium ? W.PREMIUM_AFFINITY_MULTIPLIER : 1.0;
  const { id, seller_id, category } = auction;

  // ── 1. Explicit signal on this exact auction ──────────────────────────────
  // not_interested is handled as a hard exclude in the caller — never scored.
  const sig = ctx.allSignals.get(id);
  if (sig === "interested") score += W.EXACT_INTERESTED;

  // ── 2. User has bid on this auction (strongest implicit positive) ─────────
  if (ctx.biddedAuctionIds.has(id)) score += W.BID_THIS;

  // ── 3. User has saved this auction ───────────────────────────────────────
  if (ctx.savedAuctionIds.has(id)) score += W.SAVED_THIS;

  // ── 4. User has liked this auction ───────────────────────────────────────
  if (ctx.likedAuctionIds.has(id)) score += W.LIKED_THIS;

  // ── 5. Popularity (qualified view count — auction-level, not user-level) ──
  const views = auction.qualified_views_count ?? 0;
  if (views > 0) {
    score += Math.min(W.POPULARITY_MAX, views * W.POPULARITY_PER_VIEW);
  }

  // ── 6. Temporal boosts (not scaled — apply equally to all users) ──────────
  const now    = Date.now();
  const endsAt = auction.ends_at ? new Date(auction.ends_at).getTime() : null;
  if (endsAt !== null && endsAt > now) {
    const msLeft = endsAt - now;
    if (msLeft <= 2 * 60 * 60 * 1000) {
      score += W.ENDING_SOON_2H;
    } else if (msLeft <= 6 * 60 * 60 * 1000) {
      score += W.ENDING_SOON_6H;
    }
    // Hot: high bid count AND ending within 24 h
    const bidCount = auction.bid_count ?? 0;
    if (bidCount >= W.HOT_BID_THRESHOLD && msLeft <= W.HOT_HOURS_WINDOW * 60 * 60 * 1000) {
      score += W.HOT_AUCTION;
    }
  }

  // ── 7. Seller affinity (× affinityMul for premium users) ─────────────────
  const sellerAffinity = (() => {
    let s = 0;

    if (ctx.followedSellerIds.has(seller_id))
      s += W.FOLLOWS_SELLER;

    const sellerBids = ctx.sellerBidCounts.get(seller_id) ?? 0;
    if (sellerBids > 0)
      s += Math.min(W.SELLER_BID_MAX, sellerBids * W.SELLER_BID_PER);

    const ss = ctx.sellerSignals.get(seller_id);
    if (ss) {
      if (ss.pos > 0)
        s += Math.min(W.SELLER_INTERESTED_MAX, ss.pos * W.SELLER_INTERESTED_PER);
      if (ss.neg > 0)
        s += Math.max(W.SELLER_NOT_INTERESTED_FLOOR, ss.neg * W.SELLER_NOT_INTERESTED_PER);
    }

    const sellerLikes = ctx.sellerLikeCounts.get(seller_id) ?? 0;
    if (sellerLikes > 0)
      s += Math.min(W.SELLER_LIKED_MAX, sellerLikes * W.SELLER_LIKED_PER);

    const sellerSaves = ctx.sellerSaveCounts.get(seller_id) ?? 0;
    if (sellerSaves > 0)
      s += Math.min(W.SELLER_SAVED_MAX, sellerSaves * W.SELLER_SAVED_PER);

    return s;
  })();
  score += sellerAffinity * affinityMul;

  // ── 8. Category affinity (× affinityMul for premium users) ───────────────
  const categoryAffinity = (() => {
    let s = 0;

    const catBids = ctx.categoryBidCounts.get(category) ?? 0;
    if (catBids > 0)
      s += Math.min(W.CATEGORY_BID_MAX, catBids * W.CATEGORY_BID_PER);

    const cs = ctx.categorySignals.get(category);
    if (cs) {
      if (cs.pos > 0)
        s += Math.min(W.CATEGORY_INTERESTED_MAX, cs.pos * W.CATEGORY_INTERESTED_PER);
      if (cs.neg > 0)
        s += Math.max(W.CATEGORY_NOT_INTERESTED_FLOOR, cs.neg * W.CATEGORY_NOT_INTERESTED_PER);
    }

    const catSaves = ctx.categorySaveCounts.get(category) ?? 0;
    if (catSaves > 0)
      s += Math.min(W.CATEGORY_SAVED_MAX, catSaves * W.CATEGORY_SAVED_PER);

    const catLikes = ctx.categoryLikeCounts.get(category) ?? 0;
    if (catLikes > 0)
      s += Math.min(W.CATEGORY_LIKED_MAX, catLikes * W.CATEGORY_LIKED_PER);

    return s;
  })();
  score += categoryAffinity * affinityMul;

  return score;
}
