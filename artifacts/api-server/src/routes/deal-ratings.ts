/**
 * deal-ratings.ts — Post-deal ratings for Secure Deals
 *
 * Endpoints:
 *   POST /api/deal-ratings           — submit a rating (auth required)
 *   GET  /api/deal-ratings/:dealId   — fetch all ratings for a deal (auth required)
 *
 * Security model:
 *   • rater_id is always taken from the verified JWT — never from the request body.
 *   • Only the deal's buyer or seller may rate, and only the other participant.
 *   • Rating is only allowed after the deal reaches the 'delivered' state
 *     (payment_status = 'secured' AND shipment_status = 'delivered').
 *   • Each user can submit exactly one rating per deal (UNIQUE constraint +
 *     409 ALREADY_RATED guard before the INSERT).
 *   • Self-rating is blocked both here and at the DB-level CHECK constraint.
 *   • Ratee notification is non-fatal — a notification failure never rolls
 *     back the committed rating row.
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { pool } from "../lib/pg-pool";
import { supabaseAdmin } from "../lib/supabase";
import { logger } from "../lib/logger";
import { createNotification } from "../lib/notifications";

const router: IRouter = Router();

// ── Validation ────────────────────────────────────────────────────────────────

const submitSchema = z.object({
  deal_id:  z.string().min(1),
  ratee_id: z.string().uuid(),
  stars:    z.number().int().min(1).max(5),
  comment:  z.string().max(500).optional(),
});

// ── Star label helpers ────────────────────────────────────────────────────────

function starLabel(stars: number, lang: string): string {
  const labels: Record<string, string[]> = {
    en: ["Terrible", "Poor", "Okay", "Good", "Excellent"],
    ar: ["سيء جداً",  "سيء",  "مقبول", "جيد",  "ممتاز"],
  };
  return (labels[lang] ?? labels["en"])![stars - 1]!;
}

// ── POST /api/deal-ratings ────────────────────────────────────────────────────
//
// Submits a rating from the authenticated user to the other deal participant.
// Notifications are sent to the ratee (non-fatal).

router.post("/deal-ratings", requireAuth, async (req, res) => {
  const raterId = req.user!.id;
  const body    = submitSchema.safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "INVALID_BODY", details: body.error.flatten() });
    return;
  }

  const { deal_id: dealId, ratee_id: rateeId, stars, comment } = body.data;

  // 1. Self-rating guard (belt-and-suspenders; DB constraint also enforces this)
  if (raterId === rateeId) {
    res.status(400).json({ error: "SELF_RATING", message: "You cannot rate yourself." });
    return;
  }

  try {
    // 2. Load deal
    const { rows: dealRows } = await pool.query(
      `SELECT deal_id, seller_id, buyer_id, payment_status, shipment_status
       FROM transactions WHERE deal_id = $1`,
      [dealId],
    );

    if (!dealRows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const deal = dealRows[0];

    // 3. Deal must be in terminal 'delivered' state
    if (deal.payment_status !== "secured" || deal.shipment_status !== "delivered") {
      res.status(409).json({
        error:   "DEAL_NOT_COMPLETE",
        message: "Ratings can only be submitted after the deal has been fully completed.",
      });
      return;
    }

    // 4. Caller must be a deal participant
    const isRaterSeller = deal.seller_id === raterId;
    const isRaterBuyer  = deal.buyer_id  === raterId;

    if (!isRaterSeller && !isRaterBuyer) {
      res.status(403).json({
        error:   "FORBIDDEN",
        message: "Only the buyer or seller of this deal can submit a rating.",
      });
      return;
    }

    // 5. ratee_id must be the OTHER participant
    const expectedRateeId = isRaterSeller ? deal.buyer_id : deal.seller_id;
    if (rateeId !== expectedRateeId) {
      res.status(400).json({
        error:   "INVALID_RATEE",
        message: "You can only rate the other participant of this deal.",
      });
      return;
    }

    // 6. Idempotency check — prevent duplicate rating
    const { rows: existing } = await pool.query(
      `SELECT id FROM deal_ratings WHERE deal_id = $1 AND rater_id = $2`,
      [dealId, raterId],
    );

    if (existing.length) {
      res.status(409).json({
        error:   "ALREADY_RATED",
        message: "You have already submitted a rating for this deal.",
      });
      return;
    }

    // 7. Insert rating
    const { rows: inserted } = await pool.query(
      `INSERT INTO deal_ratings (deal_id, rater_id, ratee_id, stars, comment)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [dealId, raterId, rateeId, stars, comment?.trim() || null],
    );

    const rating = inserted[0];

    logger.info(
      { dealId, raterId, rateeId, stars, ratingId: rating.id },
      "deal_ratings: rating submitted",
    );

    // 8. Notify ratee (non-fatal)
    try {
      const [{ data: raterProfile }, { data: rateeProfile }] = await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select("display_name, username")
          .eq("id", raterId)
          .maybeSingle(),
        supabaseAdmin
          .from("profiles")
          .select("language")
          .eq("id", rateeId)
          .maybeSingle(),
      ]);

      const raterName = (raterProfile as any)?.display_name
        || (raterProfile as any)?.username
        || "A deal participant";

      const lang = (rateeProfile as any)?.language ?? "en";
      const isAr = lang === "ar";
      const label = starLabel(stars, lang);

      await createNotification({
        userId:   rateeId,
        type:     "deal_rated",
        title:    isAr ? `⭐ تقييم جديد — ${stars}/5` : `⭐ New Rating — ${stars}/5`,
        body:     isAr
          ? `قيّمك ${raterName} بـ ${stars} نجوم (${label}) على الصفقة ${dealId}.`
          : `${raterName} rated you ${stars} stars (${label}) on deal ${dealId}.`,
        actorId:  raterId,
        metadata: { dealId, ratingId: rating.id, stars },
      });
    } catch (notifyErr) {
      logger.warn(
        { err: notifyErr, dealId, raterId, rateeId },
        "deal_ratings: ratee notification failed (non-fatal)",
      );
    }

    res.status(201).json({ rating });
  } catch (err) {
    logger.error({ err, dealId, raterId }, "POST /deal-ratings failed");
    res.status(500).json({ error: "SUBMIT_FAILED", message: "Could not submit rating." });
  }
});

// ── GET /api/deal-ratings/:dealId ─────────────────────────────────────────────
//
// Returns all ratings for the deal.
// Only authenticated deal participants (buyer or seller) can access.

router.get("/deal-ratings/:dealId", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const dealId   = String(req.params["dealId"]);

  try {
    const { rows: dealRows } = await pool.query(
      `SELECT seller_id, buyer_id FROM transactions WHERE deal_id = $1`,
      [dealId],
    );

    if (!dealRows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const deal = dealRows[0];
    const isSeller = deal.seller_id === callerId;
    const isBuyer  = deal.buyer_id  === callerId;

    if (!isSeller && !isBuyer) {
      res.status(403).json({ error: "FORBIDDEN", message: "Access denied." });
      return;
    }

    const { rows: ratings } = await pool.query(
      `SELECT * FROM deal_ratings WHERE deal_id = $1 ORDER BY created_at ASC`,
      [dealId],
    );

    res.json({ ratings });
  } catch (err) {
    logger.error({ err, dealId, callerId }, "GET /deal-ratings/:dealId failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load ratings." });
  }
});

export default router;
