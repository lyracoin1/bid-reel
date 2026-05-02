/**
 * deal-conditions.ts — Buyer Terms for Secure Deals
 *
 * Endpoints:
 *   POST /api/deal-conditions          — buyer submits conditions (auth required)
 *   GET  /api/deal-conditions/:dealId  — seller or buyer reads conditions (auth required)
 *
 * Security model:
 *   • buyer_id is always taken from the verified JWT — never from the request body.
 *   • Seller cannot submit conditions on their own deal.
 *   • Conditions can only be submitted while payment_status = 'pending'.
 *   • Re-submission replaces the previous conditions row (upsert on conflict).
 *   • Read access is restricted to the deal's seller and the submitting buyer.
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
  deal_id:    z.string().min(1),
  conditions: z.string().min(1).max(2000),
});

// ── POST /api/deal-conditions ─────────────────────────────────────────────────
//
// Buyer submits (or re-submits) their conditions for a deal.
// Flow:
//   1. Validate JWT → extract authenticated buyer ID
//   2. Load deal — assert it exists and payment_status = 'pending'
//   3. Seller self-submission guard
//   4. Upsert into deal_conditions (one row per deal per buyer)
//   5. Notify seller via real FCM + in-app notification

router.post("/deal-conditions", requireAuth, async (req, res) => {
  const buyerId = req.user!.id;
  const body    = submitSchema.safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "INVALID_BODY", details: body.error.flatten() });
    return;
  }

  const { deal_id: dealId, conditions } = body.data;

  try {
    // 1. Load deal
    const { rows: dealRows } = await pool.query(
      `SELECT deal_id, seller_id, payment_status FROM transactions WHERE deal_id = $1`,
      [dealId],
    );

    if (!dealRows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const deal = dealRows[0];

    // 2. Seller cannot submit buyer conditions on their own deal
    if (deal.seller_id === buyerId) {
      res.status(403).json({
        error:   "SELLER_CANNOT_SUBMIT",
        message: "The deal seller cannot submit buyer conditions.",
      });
      return;
    }

    // 3. Conditions are only meaningful before payment is locked in
    if (deal.payment_status !== "pending") {
      res.status(409).json({
        error:   "DEAL_ALREADY_PAID",
        message: "Cannot submit conditions after payment has been secured.",
      });
      return;
    }

    // 4. Upsert — one row per (deal_id, buyer_id); re-submission updates in place
    const { rows: upserted } = await pool.query(
      `INSERT INTO deal_conditions (deal_id, buyer_id, conditions, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (deal_id, buyer_id) DO UPDATE
         SET conditions = EXCLUDED.conditions,
             status     = 'pending',
             updated_at = NOW()
       RETURNING *`,
      [dealId, buyerId, conditions.trim()],
    );

    const conditionRow = upserted[0];
    const isUpdate     = conditionRow.created_at !== conditionRow.updated_at;

    logger.info(
      { dealId, buyerId, conditionId: conditionRow.id, isUpdate },
      "deal_conditions: conditions submitted",
    );

    // 5. Notify the seller (non-fatal — DB write already committed above)
    try {
      const [{ data: buyerProfile }, { data: sellerProfile }] = await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select("display_name, username")
          .eq("id", buyerId)
          .maybeSingle(),
        supabaseAdmin
          .from("profiles")
          .select("language")
          .eq("id", deal.seller_id)
          .maybeSingle(),
      ]);

      const buyerName = (buyerProfile as any)?.display_name
        || (buyerProfile as any)?.username
        || "A buyer";

      const lang = (sellerProfile as any)?.language ?? "en";
      const isAr = lang === "ar";

      await createNotification({
        userId:   deal.seller_id,
        type:     "buyer_conditions_submitted",
        title:    isAr ? "📋 شروط المشتري" : "📋 Buyer Conditions Submitted",
        body:     isAr
          ? `أرسل ${buyerName} شروطه للصفقة ${dealId} — راجع الشروط قبل متابعة البيع.`
          : `${buyerName} submitted conditions for deal ${dealId} — review before proceeding.`,
        actorId:  buyerId,
        metadata: { dealId, conditionId: conditionRow.id },
      });
    } catch (notifyErr) {
      logger.warn(
        { err: notifyErr, dealId, buyerId },
        "deal_conditions: seller notification failed (non-fatal)",
      );
    }

    res.status(201).json({ condition: conditionRow });
  } catch (err) {
    logger.error({ err, dealId, buyerId }, "POST /deal-conditions failed");
    res.status(500).json({ error: "SUBMIT_FAILED", message: "Could not submit conditions." });
  }
});

// ── GET /api/deal-conditions/:dealId ─────────────────────────────────────────
//
// Returns all conditions submitted for a deal.
// Access: the deal's seller (reads all rows) OR a buyer who has submitted
// conditions for this deal (reads their own row only).

router.get("/deal-conditions/:dealId", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const dealId   = String(req.params["dealId"]);

  try {
    // Load deal to resolve seller
    const { rows: dealRows } = await pool.query(
      `SELECT seller_id, buyer_id FROM transactions WHERE deal_id = $1`,
      [dealId],
    );

    if (!dealRows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const deal      = dealRows[0];
    const isSeller  = deal.seller_id === callerId;

    if (!isSeller) {
      // Allow only if the caller has conditions submitted for this deal
      const { rows: myRow } = await pool.query(
        `SELECT 1 FROM deal_conditions WHERE deal_id = $1 AND buyer_id = $2`,
        [dealId, callerId],
      );

      if (!myRow.length) {
        res.status(403).json({ error: "FORBIDDEN", message: "Access denied." });
        return;
      }
    }

    // Seller gets all submitted conditions; buyer gets only their own row
    const { rows } = await pool.query(
      isSeller
        ? `SELECT * FROM deal_conditions WHERE deal_id = $1 ORDER BY updated_at DESC`
        : `SELECT * FROM deal_conditions WHERE deal_id = $1 AND buyer_id = $2 ORDER BY updated_at DESC`,
      isSeller ? [dealId] : [dealId, callerId],
    );

    res.json({ conditions: rows });
  } catch (err) {
    logger.error({ err, dealId, callerId }, "GET /deal-conditions/:dealId failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load conditions." });
  }
});

export default router;
