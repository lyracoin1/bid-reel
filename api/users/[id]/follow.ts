import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_lib/supabase";
import { requireAuth } from "../../_lib/requireAuth";
import { ApiError } from "../../_lib/errors";
import { logger } from "../../_lib/logger";

// ---------------------------------------------------------------------------
// POST   /api/users/:id/follow  — follow a user
// DELETE /api/users/:id/follow  — unfollow a user
//
// Auth required.
// Self-follow is rejected with 400.
// Duplicate follows are silently ignored (idempotent).
// Response: { isFollowing: boolean; followersCount: number; followingCount: number }
// ---------------------------------------------------------------------------

async function getFollowersCount(userId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("user_follows")
    .select("following_id", { count: "exact", head: true })
    .eq("following_id", userId);
  return count ?? 0;
}

async function getFollowingCount(userId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("user_follows")
    .select("follower_id", { count: "exact", head: true })
    .eq("follower_id", userId);
  return count ?? 0;
}

// ─── POST — follow ────────────────────────────────────────────────────────────

async function handleFollow(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const user = await requireAuth(req.headers["authorization"]);
  const targetId = req.query["id"] as string;

  if (!targetId) {
    res.status(400).json({ error: "BAD_REQUEST", message: "Missing user id." });
    return;
  }

  if (user.id === targetId) {
    res.status(400).json({
      error: "SELF_FOLLOW",
      message: "You cannot follow yourself.",
    });
    return;
  }

  // Check for an existing follow to keep the operation idempotent.
  const { data: existing } = await supabaseAdmin
    .from("user_follows")
    .select("follower_id")
    .eq("follower_id", user.id)
    .eq("following_id", targetId)
    .maybeSingle();

  if (!existing) {
    const { error } = await supabaseAdmin
      .from("user_follows")
      .insert({ follower_id: user.id, following_id: targetId });

    if (error) {
      // 23505 = unique_violation — another request raced in; treat as success.
      if (error.code !== "23505") {
        logger.error("POST /api/users/:id/follow insert failed", {
          error,
          userId: user.id,
          targetId,
        });
        res.status(500).json({
          error: "FOLLOW_FAILED",
          message: "Failed to follow user.",
        });
        return;
      }
    }
  }

  const [followersCount, followingCount] = await Promise.all([
    getFollowersCount(targetId),
    getFollowingCount(user.id),
  ]);

  res.status(200).json({ isFollowing: true, followersCount, followingCount });
}

// ─── DELETE — unfollow ────────────────────────────────────────────────────────

async function handleUnfollow(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const user = await requireAuth(req.headers["authorization"]);
  const targetId = req.query["id"] as string;

  if (!targetId) {
    res.status(400).json({ error: "BAD_REQUEST", message: "Missing user id." });
    return;
  }

  const { error } = await supabaseAdmin
    .from("user_follows")
    .delete()
    .eq("follower_id", user.id)
    .eq("following_id", targetId);

  if (error) {
    logger.error("DELETE /api/users/:id/follow failed", {
      error,
      userId: user.id,
      targetId,
    });
    res.status(500).json({
      error: "UNFOLLOW_FAILED",
      message: "Failed to unfollow user.",
    });
    return;
  }

  const [followersCount, followingCount] = await Promise.all([
    getFollowersCount(targetId),
    getFollowingCount(user.id),
  ]);

  res.status(200).json({ isFollowing: false, followersCount, followingCount });
}

// ─── Router ───────────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  try {
    if (req.method === "POST") return await handleFollow(req, res);
    if (req.method === "DELETE") return await handleUnfollow(req, res);

    res.status(405).json({
      error: "METHOD_NOT_ALLOWED",
      message: "Allowed methods: POST, DELETE",
    });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }
    logger.error(
      `${req.method} /api/users/${req.query["id"]}/follow unexpected error`,
      err,
    );
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unexpected error." });
  }
}
