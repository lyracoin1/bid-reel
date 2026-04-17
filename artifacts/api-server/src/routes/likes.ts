/**
 * Likes (heart) routes — POST/DELETE /api/auctions/:auctionId/like
 *
 * Persists hearts in the `likes` table (created by migration 005). Triggers
 * `fn_likes_inc` / `fn_likes_dec` keep `auctions.like_count` denormalized in
 * sync, so feed cards stay O(1).
 *
 * On a fresh like (not duplicate, not self) we fire `liked_your_auction`
 * to the seller — in-app only (push intentionally disabled for low-value
 * spammy events per the notification spec).
 */

import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { notifyLikedYourAuction } from "../lib/notifications";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const parseAuctionId = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  return UUID_RE.test(trimmed) ? trimmed : null;
};

const isMissingTableError = (err: { code?: string }) => err.code === "42P01";
const TABLE_NOT_READY_RESPONSE = {
  error: "TABLE_NOT_READY",
  message: "Likes are temporarily unavailable. Please try again soon.",
};

// ─── POST /api/auctions/:auctionId/like ──────────────────────────────────────
// Like an auction. Idempotent — re-calling with the same (user, auction) is a no-op.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/auctions/:auctionId/like", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const auctionId = parseAuctionId(req.params["auctionId"] as string);

  if (!auctionId) {
    res.status(400).json({ error: "INVALID_AUCTION_ID", message: "auctionId must be a valid UUID." });
    return;
  }

  const { data: auction } = await supabaseAdmin
    .from("auctions")
    .select("id, seller_id, title")
    .eq("id", auctionId)
    .maybeSingle();

  if (!auction) {
    res.status(404).json({ error: "AUCTION_NOT_FOUND", message: "No auction found with that ID." });
    return;
  }

  // Insert-driven freshness detection: we attempt the insert directly and
  // treat a successful insert as "this is a brand-new like". A 23505
  // unique_violation means the row already existed (concurrent or repeat
  // tap) — we do NOT fire a notification in that case. This is race-safe
  // even under concurrent POSTs because the unique index on
  // (user_id, auction_id) is the single source of truth.
  let isFreshLike = false;
  const { error: insertErr } = await supabaseAdmin
    .from("likes")
    .insert({ user_id: callerId, auction_id: auctionId });

  if (insertErr) {
    const code = (insertErr as { code?: string }).code;
    if (code === "23505") {
      // already liked — idempotent success, no notification
      isFreshLike = false;
    } else if (isMissingTableError(insertErr)) {
      logger.warn({ callerId, auctionId }, "POST like: likes table missing — run migration 005");
      res.status(503).json(TABLE_NOT_READY_RESPONSE);
      return;
    } else {
      logger.error({ err: insertErr.message, callerId, auctionId }, "POST like: insert failed");
      res.status(500).json({ error: "LIKE_FAILED", message: "Could not like auction." });
      return;
    }
  } else {
    isFreshLike = true;
  }

  // Read the post-trigger denormalized count (cheaper than COUNT(*) on likes).
  const { data: counterRow } = await supabaseAdmin
    .from("auctions")
    .select("like_count")
    .eq("id", auctionId)
    .maybeSingle();
  const likeCount = (counterRow as { like_count?: number } | null)?.like_count ?? 0;

  // Fire-and-forget notification to the seller — only on the FIRST like by
  // this user, never to themselves. The helper double-checks self + dedup.
  const sellerId = (auction as { seller_id?: string | null }).seller_id ?? null;
  const auctionTitle = (auction as { title?: string | null }).title ?? "your auction";
  if (isFreshLike && sellerId && sellerId !== callerId) {
    void (async () => {
      const { data: likerProfile } = await supabaseAdmin
        .from("profiles")
        .select("display_name, username")
        .eq("id", callerId)
        .maybeSingle();
      const likerName = likerProfile?.display_name ?? likerProfile?.username ?? "Someone";
      await notifyLikedYourAuction(sellerId, callerId, likerName, auctionId, auctionTitle);
    })().catch(err =>
      logger.warn({ err: String(err), auctionId }, "POST like: notifyLikedYourAuction failed"),
    );
  }

  res.json({ isLiked: true, likeCount });
});

// ─── DELETE /api/auctions/:auctionId/like ────────────────────────────────────
// Unlike an auction. Idempotent — safe to call when not liked.
// ─────────────────────────────────────────────────────────────────────────────

router.delete("/auctions/:auctionId/like", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const auctionId = parseAuctionId(req.params["auctionId"] as string);

  if (!auctionId) {
    res.status(400).json({ error: "INVALID_AUCTION_ID", message: "auctionId must be a valid UUID." });
    return;
  }

  const { error } = await supabaseAdmin
    .from("likes")
    .delete()
    .eq("user_id", callerId)
    .eq("auction_id", auctionId);

  if (error) {
    if (isMissingTableError(error)) {
      logger.warn({ callerId, auctionId }, "DELETE like: likes table missing — run migration 005");
      res.status(503).json(TABLE_NOT_READY_RESPONSE);
      return;
    }
    logger.error({ err: error.message, callerId, auctionId }, "DELETE like: delete failed");
    res.status(500).json({ error: "UNLIKE_FAILED", message: "Could not unlike auction." });
    return;
  }

  const { data: counterRow } = await supabaseAdmin
    .from("auctions")
    .select("like_count")
    .eq("id", auctionId)
    .maybeSingle();
  const likeCount = (counterRow as { like_count?: number } | null)?.like_count ?? 0;

  res.json({ isLiked: false, likeCount });
});

export default router;
