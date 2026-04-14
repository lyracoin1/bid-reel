/**
 * Follow system routes
 *
 * POST   /api/users/:userId/follow        — Follow a user (auth required)
 * DELETE /api/users/:userId/follow        — Unfollow a user (auth required)
 * GET    /api/users/:userId/followers     — Get a user's followers list
 * GET    /api/users/:userId/following     — Get a user's following list
 * GET    /api/users/me/following-ids      — All IDs the caller follows (for local state)
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { supabaseAdmin } from "../lib/supabase";
import { logger } from "../lib/logger";
import { notifyNewFollower } from "../lib/notifications";

const router: IRouter = Router();

const uuidSchema = z.string().uuid("userId must be a valid UUID");

// ─── Shared: resolve and validate target userId ────────────────────────────────

function parseUserId(raw: string) {
  const parsed = uuidSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ─── GET /api/users/me/following-ids ─────────────────────────────────────────
// Returns the flat list of profile IDs that the caller currently follows.
// Used by the frontend to seed its local follow-state cache on load.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/users/me/following-ids", requireAuth, async (req, res) => {
  const callerId = req.user!.id;

  const { data, error } = await supabaseAdmin
    .from("user_follows")
    .select("following_id")
    .eq("follower_id", callerId);

  if (error) {
    logger.error({ err: error.message, callerId }, "GET following-ids: query failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not fetch following list." });
    return;
  }

  const ids = (data ?? []).map((r: { following_id: string }) => r.following_id);
  res.json({ followingIds: ids });
});

// ─── GET /api/users/me/mutual-follows ─────────────────────────────────────────
// Returns profiles for users who mutually follow the caller (caller follows them
// AND they follow caller). Used by the "Mention" sheet in the reel action menu.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/users/me/mutual-follows", requireAuth, async (req, res) => {
  const callerId = req.user!.id;

  // Step 1: get all IDs of people who follow the caller
  const { data: followerRows, error: err1 } = await supabaseAdmin
    .from("user_follows")
    .select("follower_id")
    .eq("following_id", callerId);

  if (err1) {
    logger.error({ err: err1.message, callerId }, "GET mutual-follows: step1 failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not fetch mutual follows." });
    return;
  }

  const followerIds = (followerRows ?? []).map((r: { follower_id: string }) => r.follower_id);
  if (followerIds.length === 0) {
    res.json({ mutualFollows: [] });
    return;
  }

  // Step 2: from people the caller follows, keep only those who also follow the caller
  const { data: mutualRows, error: err2 } = await supabaseAdmin
    .from("user_follows")
    .select("following_id")
    .eq("follower_id", callerId)
    .in("following_id", followerIds);

  if (err2) {
    logger.error({ err: err2.message, callerId }, "GET mutual-follows: step2 failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not fetch mutual follows." });
    return;
  }

  const mutualIds = (mutualRows ?? []).map((r: { following_id: string }) => r.following_id);
  if (mutualIds.length === 0) {
    res.json({ mutualFollows: [] });
    return;
  }

  // Step 3: fetch their profiles
  const { data: profiles, error: err3 } = await supabaseAdmin
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", mutualIds);

  if (err3) {
    logger.error({ err: err3.message, callerId }, "GET mutual-follows: step3 failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not fetch mutual follows." });
    return;
  }

  res.json({ mutualFollows: profiles ?? [] });
});

// ─── POST /api/users/:userId/follow ──────────────────────────────────────────
// Follow a user. Idempotent — returns 200 if already following.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/users/:userId/follow", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const targetId = parseUserId(req.params["userId"] as string);

  if (!targetId) {
    res.status(400).json({ error: "INVALID_USER_ID", message: "userId must be a valid UUID." });
    return;
  }

  if (targetId === callerId) {
    res.status(400).json({ error: "SELF_FOLLOW", message: "You cannot follow yourself." });
    return;
  }

  // Check target exists and is not banned
  const { data: target } = await supabaseAdmin
    .from("profiles")
    .select("id, display_name, is_banned")
    .eq("id", targetId)
    .maybeSingle();

  if (!target) {
    res.status(404).json({ error: "USER_NOT_FOUND", message: "No user found with that ID." });
    return;
  }

  if (target.is_banned) {
    res.status(403).json({ error: "USER_BANNED", message: "Cannot follow a banned user." });
    return;
  }

  // Upsert the follow relationship (ignore conflict = already following)
  const { error } = await supabaseAdmin
    .from("user_follows")
    .upsert(
      { follower_id: callerId, following_id: targetId },
      { onConflict: "follower_id,following_id", ignoreDuplicates: true }
    );

  if (error) {
    logger.error({ err: error.message, callerId, targetId }, "POST follow: upsert failed");
    res.status(500).json({ error: "FOLLOW_FAILED", message: "Could not follow user." });
    return;
  }

  // Get updated counts
  const [followersRes, followingRes] = await Promise.all([
    supabaseAdmin.from("user_follows").select("id", { count: "exact", head: true }).eq("following_id", targetId),
    supabaseAdmin.from("user_follows").select("id", { count: "exact", head: true }).eq("follower_id", targetId),
  ]);

  // Fire notification (non-blocking, never throws)
  // Fetch caller's display name for the notification message
  void (async () => {
    try {
      const { data: callerProfile } = await supabaseAdmin
        .from("profiles")
        .select("display_name")
        .eq("id", callerId)
        .maybeSingle();
      const callerName = callerProfile?.display_name ?? "Someone";
      await notifyNewFollower(targetId, callerId, callerName);
    } catch { /* non-blocking — ignore notification failures */ }
  })();

  res.json({
    isFollowing: true,
    followersCount: followersRes.count ?? 0,
    followingCount: followingRes.count ?? 0,
  });
});

// ─── DELETE /api/users/:userId/follow ─────────────────────────────────────────
// Unfollow a user. Idempotent — safe to call even if not following.
// ─────────────────────────────────────────────────────────────────────────────

router.delete("/users/:userId/follow", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const targetId = parseUserId(req.params["userId"] as string);

  if (!targetId) {
    res.status(400).json({ error: "INVALID_USER_ID", message: "userId must be a valid UUID." });
    return;
  }

  if (targetId === callerId) {
    res.status(400).json({ error: "SELF_FOLLOW", message: "You cannot unfollow yourself." });
    return;
  }

  const { error } = await supabaseAdmin
    .from("user_follows")
    .delete()
    .eq("follower_id", callerId)
    .eq("following_id", targetId);

  if (error) {
    logger.error({ err: error.message, callerId, targetId }, "DELETE follow: delete failed");
    res.status(500).json({ error: "UNFOLLOW_FAILED", message: "Could not unfollow user." });
    return;
  }

  // Get updated counts
  const [followersRes, followingRes] = await Promise.all([
    supabaseAdmin.from("user_follows").select("id", { count: "exact", head: true }).eq("following_id", targetId),
    supabaseAdmin.from("user_follows").select("id", { count: "exact", head: true }).eq("follower_id", targetId),
  ]);

  res.json({
    isFollowing: false,
    followersCount: followersRes.count ?? 0,
    followingCount: followingRes.count ?? 0,
  });
});

// ─── GET /api/users/:userId/followers ─────────────────────────────────────────
// Returns a list of users who follow :userId.
// Each entry includes whether the caller follows that person (isFollowing).
// ─────────────────────────────────────────────────────────────────────────────

router.get("/users/:userId/followers", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const targetId = parseUserId(req.params["userId"] as string);

  if (!targetId) {
    res.status(400).json({ error: "INVALID_USER_ID", message: "userId must be a valid UUID." });
    return;
  }

  // Fetch all follower IDs for the target user
  const { data: follows, error } = await supabaseAdmin
    .from("user_follows")
    .select("follower_id, created_at")
    .eq("following_id", targetId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    logger.error({ err: error.message, targetId }, "GET followers: query failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not fetch followers." });
    return;
  }

  if (!follows || follows.length === 0) {
    res.json({ followers: [] });
    return;
  }

  const followerIds = follows.map((f: { follower_id: string }) => f.follower_id);

  // Fetch profiles for all follower IDs
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", followerIds);

  // Check which of these the caller follows
  const { data: callerFollows } = await supabaseAdmin
    .from("user_follows")
    .select("following_id")
    .eq("follower_id", callerId)
    .in("following_id", followerIds);

  const callerFollowsSet = new Set(
    (callerFollows ?? []).map((r: { following_id: string }) => r.following_id)
  );

  const profileMap = new Map(
    (profiles ?? []).map((p: { id: string; username: string | null; display_name: string | null; avatar_url: string | null }) => [p.id, p])
  );

  const result = followerIds
    .map(fid => {
      const p = profileMap.get(fid);
      if (!p) return null;
      return {
        id: p.id,
        username: p.username,
        displayName: p.display_name,
        avatarUrl: p.avatar_url,
        isFollowing: callerFollowsSet.has(p.id),
        isSelf: p.id === callerId,
      };
    })
    .filter(Boolean);

  res.json({ followers: result });
});

// ─── GET /api/users/:userId/following ─────────────────────────────────────────
// Returns the list of users that :userId follows.
// Each entry includes whether the caller follows that person (isFollowing).
// ─────────────────────────────────────────────────────────────────────────────

router.get("/users/:userId/following", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const targetId = parseUserId(req.params["userId"] as string);

  if (!targetId) {
    res.status(400).json({ error: "INVALID_USER_ID", message: "userId must be a valid UUID." });
    return;
  }

  const { data: follows, error } = await supabaseAdmin
    .from("user_follows")
    .select("following_id, created_at")
    .eq("follower_id", targetId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    logger.error({ err: error.message, targetId }, "GET following: query failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not fetch following list." });
    return;
  }

  if (!follows || follows.length === 0) {
    res.json({ following: [] });
    return;
  }

  const followingIds = follows.map((f: { following_id: string }) => f.following_id);

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", followingIds);

  // Check which of these the caller follows
  const { data: callerFollows } = await supabaseAdmin
    .from("user_follows")
    .select("following_id")
    .eq("follower_id", callerId)
    .in("following_id", followingIds);

  const callerFollowsSet = new Set(
    (callerFollows ?? []).map((r: { following_id: string }) => r.following_id)
  );

  const profileMap = new Map(
    (profiles ?? []).map((p: { id: string; username: string | null; display_name: string | null; avatar_url: string | null }) => [p.id, p])
  );

  const result = followingIds
    .map(fid => {
      const p = profileMap.get(fid);
      if (!p) return null;
      return {
        id: p.id,
        username: p.username,
        displayName: p.display_name,
        avatarUrl: p.avatar_url,
        isFollowing: callerFollowsSet.has(p.id),
        isSelf: p.id === callerId,
      };
    })
    .filter(Boolean);

  res.json({ following: result });
});

export default router;
