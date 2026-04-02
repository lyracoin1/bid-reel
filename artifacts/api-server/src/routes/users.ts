/**
 * User profile routes
 *
 * GET    /api/users/me          — own full profile (authenticated)
 * PATCH  /api/users/me          — update own profile fields
 * GET    /api/users/me/bids     — auctions the caller has bid on (leading/outbid)
 * GET    /api/users/:userId     — another user's public profile
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { supabaseAdmin } from "../lib/supabase";
import {
  getOwnProfile,
  getPublicProfile,
  updateProfile,
} from "../lib/profiles";
import { getBidderCol, getBidderUserId } from "../lib/dbSchema";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── GET /api/users/me ────────────────────────────────────────────────────────
// Returns the full own profile for the authenticated caller.
// Never returns phone number.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/users/me", requireAuth, async (req, res) => {
  const profile = await getOwnProfile(req.user!.id);

  if (!profile) {
    res.status(404).json({
      error: "PROFILE_NOT_FOUND",
      message: "No profile found for this user.",
    });
    return;
  }

  res.json({ user: profile });
});

// ─── PATCH /api/users/me ──────────────────────────────────────────────────────
// Update safe profile fields: displayName, avatarUrl, bio.
// Protected fields (is_admin, is_banned, phone) are silently stripped.
// ─────────────────────────────────────────────────────────────────────────────

const updateProfileSchema = z.object({
  displayName: z
    .string()
    .min(2, "Display name must be at least 2 characters")
    .max(50, "Display name must be 50 characters or fewer")
    .optional(),
  avatarUrl: z
    .string()
    .url("avatarUrl must be a valid URL")
    .optional(),
  bio: z
    .string()
    .max(300, "Bio must be 300 characters or fewer")
    .optional(),
});

router.patch("/users/me", requireAuth, async (req, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "Invalid request body",
    });
    return;
  }

  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({
      error: "EMPTY_UPDATE",
      message: "Provide at least one field to update: displayName, avatarUrl, or bio.",
    });
    return;
  }

  let profile;
  try {
    profile = await updateProfile(req.user!.id, parsed.data);
  } catch (err) {
    req.log.error({ err }, "Profile update failed");
    res.status(500).json({
      error: "UPDATE_FAILED",
      message: "Could not update profile. Please try again.",
    });
    return;
  }

  if (!profile) {
    res.status(404).json({
      error: "PROFILE_NOT_FOUND",
      message: "No profile found for this user.",
    });
    return;
  }

  res.json({ user: profile });
});

// ─── GET /api/users/me/bids ───────────────────────────────────────────────────
// Returns the most recent 30 auctions the caller has bid on, with leading/
// outbid status and their highest bid amount per auction.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/users/me/bids", requireAuth, async (req, res) => {
  const userId = req.user!.id;

  // Fetch distinct auctions this user has bid on, plus their max bid per auction.
  // Use select("*") so we tolerate schema variations (created_at may not exist in older DBs).
  const bCol = await getBidderCol();
  const { data: bidRows, error } = await supabaseAdmin
    .from("bids")
    .select("*")
    .eq(bCol, userId)
    .order("amount", { ascending: false });

  if (error) {
    logger.error({ err: error, userId, bCol }, "GET /users/me/bids: bids query failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not fetch bids" });
    return;
  }

  // Deduplicate: keep highest bid per auction
  const seen = new Map<string, { amount: number; created_at: string | null }>();
  for (const row of bidRows ?? []) {
    const existing = seen.get(row.auction_id);
    if (!existing || row.amount > existing.amount) {
      seen.set(row.auction_id, { amount: row.amount, created_at: row.created_at ?? null });
    }
  }
  const auctionIds = [...seen.keys()].slice(0, 30);

  if (auctionIds.length === 0) {
    res.json({ bids: [] });
    return;
  }

  // Fetch auction details + current leading bidder
  // select("*") works with both old schema (current_price) and new schema (current_bid)
  const { data: auctions } = await supabaseAdmin
    .from("auctions")
    .select("*")
    .in("id", auctionIds);

  // Fetch current leader per auction (top bid per auction)
  const { data: topBids } = await supabaseAdmin
    .from("bids")
    .select(`auction_id, ${bCol}, amount`)
    .in("auction_id", auctionIds)
    .order("amount", { ascending: false });

  const leaderMap = new Map<string, string>(); // auctionId → leading user id
  for (const b of topBids ?? []) {
    if (!leaderMap.has(b.auction_id)) leaderMap.set(b.auction_id, getBidderUserId(b));
  }

  const auctionMap = new Map((auctions ?? []).map(a => [a.id, a]));

  const result = auctionIds.map(aId => {
    const a = auctionMap.get(aId);
    const myBid = seen.get(aId)!;
    const isLeading = leaderMap.get(aId) === userId;
    const mediaUrl = a?.video_url ?? a?.thumbnail_url ?? null;
    return {
      auctionId: aId,
      myBidAmount: myBid.amount,
      isLeading,
      auction: a
        ? {
            id: a.id,
            title: a.title,
            mediaUrl,
            currentBid: a.current_bid ?? (a as any).current_price ?? 0,
            bidCount: a.bid_count,
            endsAt: a.ends_at,
            startsAt: a.starts_at,
          }
        : null,
    };
  }).filter(r => r.auction !== null);

  res.json({ bids: result });
});

// ─── GET /api/users/:userId ───────────────────────────────────────────────────
// Returns another user's public profile.
// Excludes phone, expo_push_token, ban_reason.
// ─────────────────────────────────────────────────────────────────────────────

const uuidSchema = z.string().uuid("userId must be a valid UUID");

router.get("/users/:userId", requireAuth, async (req, res) => {
  const parsed = uuidSchema.safeParse(req.params["userId"]);

  if (!parsed.success) {
    res.status(400).json({
      error: "INVALID_USER_ID",
      message: "userId must be a valid UUID.",
    });
    return;
  }

  const profile = await getPublicProfile(parsed.data);

  if (!profile) {
    res.status(404).json({
      error: "USER_NOT_FOUND",
      message: "No user found with that ID.",
    });
    return;
  }

  res.json({ user: profile });
});

export default router;
