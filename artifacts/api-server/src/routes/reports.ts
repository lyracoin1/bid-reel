/**
 * Reports route
 *
 * POST /api/reports — submit a content violation report (requires auth)
 */

import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../lib/supabase";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const router = Router();

const VALID_REASONS = [
  "spam_or_fake",
  "offensive_content",
  "prohibited_item",
  "other",
] as const;

const createReportSchema = z.object({
  auctionId: z.string().uuid("auctionId must be a valid UUID"),
  reason: z.enum(VALID_REASONS, {
    errorMap: () => ({
      message: `Reason must be one of: ${VALID_REASONS.join(", ")}`,
    }),
  }),
  details: z
    .string()
    .max(500, "Details must be 500 characters or fewer")
    .optional(),
});

// ─── POST /api/reports ────────────────────────────────────────────────────────

router.post("/reports", requireAuth, async (req, res) => {
  const parsed = createReportSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "Invalid request body",
    });
    return;
  }

  const { auctionId, reason, details } = parsed.data;
  const reporterId = req.user!.id;

  const { data: auction, error: auctionErr } = await supabaseAdmin
    .from("auctions")
    .select("id, seller_id")
    .eq("id", auctionId)
    .single();

  if (auctionErr || !auction) {
    res.status(404).json({ error: "AUCTION_NOT_FOUND", message: "Auction not found" });
    return;
  }

  if (auction.seller_id === reporterId) {
    res.status(403).json({
      error: "CANNOT_REPORT_OWN_AUCTION",
      message: "You cannot report your own auction",
    });
    return;
  }

  const { data: report, error } = await supabaseAdmin
    .from("reports")
    .insert({
      reporter_id: reporterId,
      auction_id: auctionId,
      reason,
      details: details ?? null,
    })
    .select("id, auction_id, reason, details, status, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      res.status(409).json({
        error: "ALREADY_REPORTED",
        message: "You have already reported this auction",
      });
      return;
    }

    logger.error({ err: error, auctionId, reporterId }, "POST /reports failed");
    res.status(500).json({ error: "REPORT_FAILED", message: "Failed to submit report" });
    return;
  }

  logger.info({ reportId: report.id, auctionId, reporterId, reason }, "Report submitted");

  res.status(201).json({ report });
});

export default router;
