/**
 * Saved Auctions (Bookmarks) routes
 *
 * POST   /api/auctions/:auctionId/save     — Save (bookmark) an auction
 * DELETE /api/auctions/:auctionId/save     — Unsave an auction
 * GET    /api/users/me/saved-ids           — All saved auction IDs for the caller
 * GET    /api/users/me/saved               — Full saved auction list with details
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { supabaseAdmin } from "../lib/supabase";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const uuidSchema = z.string().uuid("auctionId must be a valid UUID");

function parseAuctionId(raw: string) {
  const parsed = uuidSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ─── GET /api/users/me/saved-ids ─────────────────────────────────────────────
// Returns a flat list of auction IDs the caller has saved.
// Used by the frontend to seed its local save-state cache on load.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/users/me/saved-ids", requireAuth, async (req, res) => {
  const callerId = req.user!.id;

  const { data, error } = await supabaseAdmin
    .from("saved_auctions")
    .select("auction_id")
    .eq("user_id", callerId);

  if (error) {
    logger.error({ err: error.message, callerId }, "GET saved-ids: query failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not fetch saved auctions." });
    return;
  }

  const ids = (data ?? []).map((r: { auction_id: string }) => r.auction_id);
  res.json({ savedIds: ids });
});

// ─── GET /api/users/me/saved ──────────────────────────────────────────────────
// Returns saved auctions with basic auction details.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/users/me/saved", requireAuth, async (req, res) => {
  const callerId = req.user!.id;

  const { data: savedRows, error } = await supabaseAdmin
    .from("saved_auctions")
    .select("auction_id, created_at")
    .eq("user_id", callerId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error({ err: error.message, callerId }, "GET saved: query failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not fetch saved auctions." });
    return;
  }

  if (!savedRows || savedRows.length === 0) {
    res.json({ auctions: [] });
    return;
  }

  const auctionIds = (savedRows as { auction_id: string; created_at: string }[]).map(r => r.auction_id);

  const { data: auctions, error: auctionErr } = await supabaseAdmin
    .from("auctions")
    .select(`
      id, title, status, current_bid, start_price, bid_count,
      ends_at, starts_at, video_url, thumbnail_url, currency_code,
      seller:profiles!auctions_seller_id_fkey(id, display_name, avatar_url)
    `)
    .in("id", auctionIds);

  if (auctionErr) {
    logger.error({ err: auctionErr.message }, "GET saved: auction fetch failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not fetch auction details." });
    return;
  }

  res.json({ auctions: auctions ?? [] });
});

// ─── POST /api/auctions/:auctionId/save ──────────────────────────────────────
// Save (bookmark) an auction. Idempotent — safe to call if already saved.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/auctions/:auctionId/save", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const auctionId = parseAuctionId(req.params["auctionId"] ?? "");

  if (!auctionId) {
    res.status(400).json({ error: "INVALID_AUCTION_ID", message: "auctionId must be a valid UUID." });
    return;
  }

  // Verify the auction exists
  const { data: auction } = await supabaseAdmin
    .from("auctions")
    .select("id")
    .eq("id", auctionId)
    .maybeSingle();

  if (!auction) {
    res.status(404).json({ error: "AUCTION_NOT_FOUND", message: "No auction found with that ID." });
    return;
  }

  const { error } = await supabaseAdmin
    .from("saved_auctions")
    .upsert(
      { user_id: callerId, auction_id: auctionId },
      { onConflict: "user_id,auction_id", ignoreDuplicates: true }
    );

  if (error) {
    logger.error({ err: error.message, callerId, auctionId }, "POST save: upsert failed");
    res.status(500).json({ error: "SAVE_FAILED", message: "Could not save auction." });
    return;
  }

  const { count } = await supabaseAdmin
    .from("saved_auctions")
    .select("id", { count: "exact", head: true })
    .eq("auction_id", auctionId);

  res.json({ isSaved: true, savedCount: count ?? 0 });
});

// ─── DELETE /api/auctions/:auctionId/save ────────────────────────────────────
// Unsave an auction. Idempotent — safe to call if not saved.
// ─────────────────────────────────────────────────────────────────────────────

router.delete("/auctions/:auctionId/save", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const auctionId = parseAuctionId(req.params["auctionId"] ?? "");

  if (!auctionId) {
    res.status(400).json({ error: "INVALID_AUCTION_ID", message: "auctionId must be a valid UUID." });
    return;
  }

  const { error } = await supabaseAdmin
    .from("saved_auctions")
    .delete()
    .eq("user_id", callerId)
    .eq("auction_id", auctionId);

  if (error) {
    logger.error({ err: error.message, callerId, auctionId }, "DELETE save: delete failed");
    res.status(500).json({ error: "UNSAVE_FAILED", message: "Could not unsave auction." });
    return;
  }

  const { count } = await supabaseAdmin
    .from("saved_auctions")
    .select("id", { count: "exact", head: true })
    .eq("auction_id", auctionId);

  res.json({ isSaved: false, savedCount: count ?? 0 });
});

export default router;
