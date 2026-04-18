/**
 * Auction view tracking — POST /api/auctions/:id/view
 *
 * The frontend reports "this card was visible for N ms in source X". The
 * server is the only place that decides:
 *   - whether the view qualifies (watch_ms threshold)
 *   - whether it's a duplicate (rolling 30-min window per viewer)
 *   - whether the viewer is brand new (unique_viewers_count)
 *
 * Counting is done atomically inside the SECURITY DEFINER SQL function
 * `record_auction_view` (migration 027) so two concurrent POSTs can never
 * both win an "is this the first event?" race.
 *
 * Also exports `recordEngagement(...)` which is called fire-and-forget from
 * likes / saves / bid placement / detail-open routes to mark the viewer's
 * most recent qualified view as engaged.
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../lib/supabase";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const trackBodySchema = z.object({
  sessionId: z.string().min(8).max(128).optional().nullable(),
  watchMs:   z.number().int().min(0).max(60 * 60 * 1000),
  source:    z.enum(["feed", "profile", "search", "saved", "direct"]).default("feed"),
  platform:  z.enum(["web", "android", "ios"]).default("web"),
});

const isMissingObject = (err: { code?: string; message?: string }) =>
  err.code === "42P01" || err.code === "PGRST202" ||
  (typeof err.message === "string" && err.message.toLowerCase().includes("could not find the function"));

const TABLE_NOT_READY = {
  error: "TABLE_NOT_READY",
  message: "View tracking is not yet provisioned. Run migration 027_auction_views.sql.",
} as const;

// ─── POST /api/auctions/:id/view ─────────────────────────────────────────────
// Public — anonymous viewers may report views via sessionId.
//
// Auth handling:
//   • Bearer token present and valid → user_id wins, sessionId is ignored
//   • Otherwise → sessionId is required (returns 400 if missing)
//
// The handler trusts only the auctionId in the URL and the watchMs/source
// in the body. The qualified / dedupe / unique decision is made entirely
// inside record_auction_view().
router.post("/auctions/:id/view", async (req, res) => {
  const auctionId = (req.params["id"] ?? "").toLowerCase();
  if (!UUID_RE.test(auctionId)) {
    res.status(400).json({ error: "INVALID_AUCTION_ID", message: "auctionId must be a valid UUID." });
    return;
  }

  const parsed = trackBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "Invalid request body",
    });
    return;
  }

  // Resolve viewer identity. Auth wins; otherwise sessionId is required.
  let userId: string | null = null;
  const auth = req.headers.authorization ?? "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token) {
      const { data: userData } = await supabaseAdmin.auth.getUser(token);
      userId = userData?.user?.id ?? null;
    }
  }

  const sessionId = parsed.data.sessionId ?? null;
  if (!userId && !sessionId) {
    res.status(400).json({
      error: "VIEWER_REQUIRED",
      message: "Provide a Bearer token or a sessionId for anonymous tracking.",
    });
    return;
  }

  // Confirm the auction exists and is not soft-deleted. Cheap PK lookup.
  const { data: auctionRow, error: auctionErr } = await supabaseAdmin
    .from("auctions")
    .select("id, status")
    .eq("id", auctionId)
    .maybeSingle();

  if (auctionErr) {
    logger.error({ err: auctionErr.message, auctionId }, "POST /auctions/:id/view: auction lookup failed");
    res.status(500).json({ error: "LOOKUP_FAILED", message: "Could not resolve auction." });
    return;
  }
  if (!auctionRow || auctionRow.status === "removed") {
    res.status(404).json({ error: "AUCTION_NOT_FOUND", message: "No auction found with that ID." });
    return;
  }

  const { data, error } = await supabaseAdmin.rpc("record_auction_view", {
    p_auction_id: auctionId,
    p_user_id:    userId,
    p_session_id: sessionId,
    p_platform:   parsed.data.platform,
    p_source:     parsed.data.source,
    p_watch_ms:   parsed.data.watchMs,
  });

  if (error) {
    if (isMissingObject(error)) {
      logger.warn({ auctionId }, "POST /view: record_auction_view RPC missing — apply migration 027");
      res.status(503).json(TABLE_NOT_READY);
      return;
    }
    logger.error({ err: error.message, auctionId, userId, sessionId }, "POST /view: record_auction_view RPC failed");
    res.status(500).json({ error: "VIEW_RECORD_FAILED", message: "Could not record view." });
    return;
  }

  const result = (data ?? {}) as {
    event_type?: string;
    qualified?: boolean;
    dedup?: boolean;
    unique?: boolean;
  };

  logger.info(
    {
      auctionId, userId: userId ?? "(anon)", sessionId: sessionId ?? "(none)",
      platform: parsed.data.platform, source: parsed.data.source, watchMs: parsed.data.watchMs,
      eventType: result.event_type, qualified: result.qualified, dedup: result.dedup, unique: result.unique,
    },
    "view: recorded",
  );

  res.json({
    ok: true,
    eventType: result.event_type ?? "impression",
    qualified: !!result.qualified,
    dedup:     !!result.dedup,
    unique:    !!result.unique,
  });
});

export default router;

// ─── Engagement helper ────────────────────────────────────────────────────────
// Used by likes / saves / bids / detail-open routes. Fire-and-forget.
// Only counts when the viewer has had a recent (≤30 min) qualified view —
// this is what makes "engaged_view" meaningful instead of a like-count clone.

export async function recordEngagement(args: {
  auctionId: string;
  userId: string | null;
  sessionId: string | null;
  action: "like" | "save" | "bid" | "open_detail";
}): Promise<void> {
  const { auctionId, userId, sessionId, action } = args;
  if (!userId && !sessionId) return;

  try {
    const { data, error } = await supabaseAdmin.rpc("record_auction_engagement", {
      p_auction_id: auctionId,
      p_user_id:    userId,
      p_session_id: sessionId,
      p_action:     action,
    });
    if (error) {
      if (isMissingObject(error)) {
        logger.warn({ auctionId, action }, "engagement: RPC missing — apply migration 027");
        return;
      }
      logger.warn({ err: error.message, auctionId, action }, "engagement: RPC failed");
      return;
    }
    const r = (data ?? {}) as { engaged?: boolean; reason?: string };
    if (r.engaged) {
      logger.info({ auctionId, userId: userId ?? "(anon)", action }, "engagement: marked engaged");
    } else {
      logger.debug({ auctionId, userId: userId ?? "(anon)", action, reason: r.reason }, "engagement: skipped");
    }
  } catch (err) {
    logger.warn({ err: String(err), auctionId, action }, "engagement: threw");
  }
}
