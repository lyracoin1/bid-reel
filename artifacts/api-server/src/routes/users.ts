/**
 * User profile routes
 *
 * GET    /api/users/me                — own full profile (authenticated)
 * PATCH  /api/users/me                — update own profile fields
 * GET    /api/users/me/bids           — auctions the caller has bid on
 * GET    /api/users/check-username    — check username availability (authenticated)
 * GET    /api/users/:userId           — another user's public profile
 *
 * NOTE: The former POST /api/users/me/activate-admin endpoint has been
 * permanently removed. Admin access is granted exclusively through
 * POST /api/auth/admin-login with the correct admin code.
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { supabaseAdmin } from "../lib/supabase";
import {
  getOwnProfile,
  getPublicProfile,
  updateProfile,
  UsernameTakenError,
} from "../lib/profiles";
import { getBidderCol, getBidderUserId } from "../lib/dbSchema";
import { logger } from "../lib/logger";

// ─── Shared username schema ────────────────────────────────────────────────────
// 3–30 characters; lowercase letters, digits, underscores.
// No leading/trailing underscores.  Examples: john_doe, bidder99
const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(30, "Username must be 30 characters or fewer")
  .regex(
    /^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$|^[a-z0-9]{3}$/,
    "Username may only contain lowercase letters, numbers, and underscores, and cannot start or end with an underscore",
  );

const router: IRouter = Router();

// ─── GET /api/users/me ────────────────────────────────────────────────────────
// Returns the full own profile for the authenticated caller, including the
// user's own phone number (so the profile-edit screen can prefill it).
// Phone is never returned for other users (see GET /api/users/:userId).
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
// Update safe profile fields: username, displayName, avatarUrl, bio.
// Protected fields (is_admin, is_banned, phone) are silently stripped.
// Username uniqueness is enforced: 409 is returned if already taken.
// ─────────────────────────────────────────────────────────────────────────────

const e164Regex = /^\+[1-9]\d{7,14}$/;

const updateProfileSchema = z.object({
  username: usernameSchema
    .transform(v => v.toLowerCase().trim())
    .optional(),
  displayName: z
    .string()
    .min(2, "Display name must be at least 2 characters")
    .max(50, "Display name must be 50 characters or fewer")
    .trim()
    .optional(),
  avatarUrl: z
    .string()
    .url("avatarUrl must be a valid URL")
    .optional(),
  bio: z
    .string()
    .max(300, "Bio must be 300 characters or fewer")
    .trim()
    .optional(),
  // Phone stored as profile data (WhatsApp contact). Must be E.164 format.
  phone: z
    .string()
    .regex(e164Regex, "Phone must be in international E.164 format starting with + (e.g. +966500000000)")
    .optional(),
  // City / region the user is based in. Free text, max 100 chars.
  location: z
    .string()
    .min(2, "Location must be at least 2 characters")
    .max(100, "Location must be 100 characters or fewer")
    .trim()
    .optional(),
});

router.patch("/users/me", requireAuth, async (req, res) => {
  // Diagnostic log: prove whether phone arrives in the request body.
  // Logs ONLY field presence (not the actual phone digits) to avoid PII spill.
  req.log.info(
    {
      userId: req.user!.id,
      hasPhone: typeof req.body?.phone === "string" && req.body.phone.length > 0,
      phoneLen: typeof req.body?.phone === "string" ? req.body.phone.length : 0,
      bodyKeys: Object.keys(req.body ?? {}),
    },
    "PATCH /users/me request received",
  );

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
      message: "Provide at least one field to update: username, displayName, avatarUrl, bio, phone, or location.",
    });
    return;
  }

  let profile;
  try {
    profile = await updateProfile(req.user!.id, parsed.data);
  } catch (err) {
    if (err instanceof UsernameTakenError) {
      res.status(409).json({
        error: err.code,
        message: err.message,
      });
      return;
    }
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

  // Diagnostic: confirm the DB row reflects what the client requested.
  // Logs presence + length only — never the digits.
  req.log.info(
    {
      userId: req.user!.id,
      requestHadPhone: typeof req.body?.phone === "string" && req.body.phone.length > 0,
      dbHasPhone: typeof profile.phone === "string" && profile.phone.length > 0,
      dbPhoneLen: typeof profile.phone === "string" ? profile.phone.length : 0,
      dbIsCompleted: profile.isCompleted,
    },
    "PATCH /users/me persisted",
  );

  res.json({ user: profile });
});

// ─── GET /api/users/check-username ────────────────────────────────────────────
// Real-time availability check. Returns { available: true/false }.
// Requires auth so anonymous bots cannot enumerate taken usernames.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/users/check-username", requireAuth, async (req, res) => {
  const raw = typeof req.query["username"] === "string" ? req.query["username"].toLowerCase().trim() : "";

  const parsed = usernameSchema.safeParse(raw);
  if (!parsed.success) {
    res.status(400).json({
      error: "INVALID_USERNAME",
      message: parsed.error.issues[0]?.message ?? "Invalid username format",
      available: false,
    });
    return;
  }

  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .ilike("username", parsed.data)
    .neq("id", req.user!.id)
    .maybeSingle();

  res.json({ available: !existing });
});

// ─── GET /api/users/me/bids ───────────────────────────────────────────────────
// Returns the most recent 30 auctions the caller has bid on, with leading/
// outbid status and their highest bid amount per auction.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/users/me/bids", requireAuth, async (req, res) => {
  const userId = req.user!.id;

  // Fetch all bids by this user, most recent first. Use select("*") to tolerate schema variations.
  const bCol = await getBidderCol();
  const { data: bidRows, error } = await supabaseAdmin
    .from("bids")
    .select("*")
    .eq(bCol, userId)
    .order("created_at", { ascending: false });

  if (error) {
    // Fallback: if created_at doesn't exist in older schemas, order by amount
    const { data: bidRowsFallback, error: err2 } = error.code === "42703"
      ? await supabaseAdmin.from("bids").select("*").eq(bCol, userId).order("amount", { ascending: false })
      : { data: null, error };

    if (err2 || !bidRowsFallback) {
      logger.error({ err: error, userId, bCol }, "GET /users/me/bids: bids query failed");
      res.status(500).json({ error: "FETCH_FAILED", message: "Could not fetch bids" });
      return;
    }

    // Continue with fallback data
    const seen2 = new Map<string, { amount: number; created_at: string | null }>();
    for (const row of bidRowsFallback) {
      const existing = seen2.get(row.auction_id);
      if (!existing || row.amount > existing.amount) {
        seen2.set(row.auction_id, { amount: row.amount, created_at: row.created_at ?? null });
      }
    }
    const auctionIds2 = [...seen2.keys()].slice(0, 30);
    if (auctionIds2.length === 0) { res.json({ bids: [] }); return; }
    const { data: auctions2 } = await supabaseAdmin.from("auctions").select("*").in("id", auctionIds2);
    const { data: topBids2 } = await supabaseAdmin.from("bids").select(`auction_id, ${bCol}, amount`).in("auction_id", auctionIds2).order("amount", { ascending: false });
    const leaderMap2 = new Map<string, string>();
    for (const b of topBids2 ?? []) { if (!leaderMap2.has(b.auction_id)) leaderMap2.set(b.auction_id, getBidderUserId(b)); }
    const auctionMap2 = new Map((auctions2 ?? []).map((a: any) => [a.id, a]));
    res.json({ bids: auctionIds2.map(aId => {
      const a = auctionMap2.get(aId) as any;
      const myBid = seen2.get(aId)!;
      return { auctionId: aId, myBidAmount: myBid.amount, isLeading: leaderMap2.get(aId) === userId, auction: a ? { id: a.id, title: a.title, mediaUrl: a.video_url ?? a.thumbnail_url ?? null, currentBid: a.current_bid ?? 0, bidCount: a.bid_count, endsAt: a.ends_at, startsAt: a.starts_at, currencyCode: a.currency_code ?? null } : null };
    }).filter(r => r.auction !== null) });
    return;
  }

  // Deduplicate: preserve recency order (most recently bid auction first),
  // but track the highest amount per auction (user's best bid)
  const seen = new Map<string, { amount: number; created_at: string | null }>();
  for (const row of bidRows ?? []) {
    const existing = seen.get(row.auction_id);
    if (!existing) {
      // First encounter = most recent bid on this auction
      seen.set(row.auction_id, { amount: row.amount, created_at: row.created_at ?? null });
    } else if (row.amount > existing.amount) {
      // Keep highest amount but preserve the recency (created_at from first encounter)
      seen.set(row.auction_id, { ...existing, amount: row.amount });
    }
  }
  const auctionIds = [...seen.keys()].slice(0, 30);

  if (auctionIds.length === 0) {
    res.json({ bids: [] });
    return;
  }

  // Fetch auction details + current leading bidder
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
            currentBid: a.current_bid ?? 0,
            bidCount: a.bid_count,
            endsAt: a.ends_at,
            startsAt: a.starts_at,
          }
        : null,
    };
  }).filter(r => r.auction !== null);

  res.json({ bids: result });
});

// ─── DELETE /api/users/me ─────────────────────────────────────────────────────
// Permanently deletes the authenticated user's account.
// Deletes: auth record, profile row, bids, follows, saves, device tokens.
// Auction listings are anonymised (seller_id set to null) to preserve history.
// ─────────────────────────────────────────────────────────────────────────────

router.delete("/users/me", requireAuth, async (req, res) => {
  const userId = req.user!.id;

  try {
    // 1. Anonymise auctions (preserve auction integrity — set seller to null)
    await supabaseAdmin
      .from("auctions")
      .update({ seller_id: null } as any)
      .eq("seller_id", userId);

    // 2. Delete profile row (cascades: follows, saves, device tokens via FK)
    await supabaseAdmin.from("profiles").delete().eq("id", userId);

    // 3. Delete the Supabase Auth user — this is irreversible
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authError) {
      logger.error({ err: authError, userId }, "DELETE /users/me: auth deletion failed");
      res.status(500).json({
        error: "DELETE_FAILED",
        message: "Could not delete account. Please try again or contact support.",
      });
      return;
    }

    req.log.info({ userId }, "Account permanently deleted");
    res.status(200).json({ success: true, message: "Account permanently deleted." });
  } catch (err) {
    logger.error({ err, userId }, "DELETE /users/me: unexpected error");
    res.status(500).json({
      error: "DELETE_FAILED",
      message: "Could not delete account. Please try again or contact support.",
    });
  }
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
