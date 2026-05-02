/**
 * seller-conditions.ts — Seller Terms for Secure Deals
 *
 * Endpoints:
 *   POST /api/seller-conditions          — seller submits conditions (auth required)
 *   GET  /api/seller-conditions/:dealId  — any authenticated user with the deal link
 *                                          can read (seller, buyer, or potential buyer)
 *
 * Security model:
 *   • seller_id is always taken from the verified JWT — never from the request body.
 *   • Only the deal's actual seller (verified against transactions.seller_id) may submit.
 *   • Conditions can only be submitted / updated while payment_status = 'pending'.
 *   • Re-submission replaces the previous row (upsert on unique deal_id index).
 *   • Buyer notification is best-effort: if no buyer has interacted yet, the
 *     notification is skipped silently — the buyer will see conditions when they open
 *     the payment link.
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

// ── POST /api/seller-conditions ───────────────────────────────────────────────
//
// Seller submits (or re-submits) their terms for a deal.
// Flow:
//   1. Validate JWT → extract authenticated seller ID
//   2. Load deal — assert it exists, caller IS the seller, payment_status = 'pending'
//   3. Upsert into seller_conditions (one row per deal_id)
//   4. Notify buyer if one can be identified (non-fatal)

router.post("/seller-conditions", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const body     = submitSchema.safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "INVALID_BODY", details: body.error.flatten() });
    return;
  }

  const { deal_id: dealId, conditions } = body.data;

  try {
    // 1. Load deal
    const { rows: dealRows } = await pool.query(
      `SELECT deal_id, seller_id, buyer_id, payment_status
       FROM transactions WHERE deal_id = $1`,
      [dealId],
    );

    if (!dealRows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const deal = dealRows[0];

    // 2. Only the deal's seller may submit seller conditions
    if (deal.seller_id !== callerId) {
      res.status(403).json({
        error:   "FORBIDDEN",
        message: "Only the deal's seller can submit seller conditions.",
      });
      return;
    }

    // 3. Conditions locked after payment is secured
    if (deal.payment_status !== "pending") {
      res.status(409).json({
        error:   "DEAL_ALREADY_PAID",
        message: "Cannot update conditions after payment has been secured.",
      });
      return;
    }

    // 4. Upsert — one row per deal_id; re-submission updates in place
    const { rows: upserted } = await pool.query(
      `INSERT INTO seller_conditions (deal_id, seller_id, conditions, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (deal_id) DO UPDATE
         SET conditions = EXCLUDED.conditions,
             status     = 'pending',
             updated_at = NOW()
       RETURNING *`,
      [dealId, callerId, conditions.trim()],
    );

    const conditionRow = upserted[0];
    const isUpdate     = conditionRow.created_at !== conditionRow.updated_at;

    logger.info(
      { dealId, sellerId: callerId, conditionId: conditionRow.id, isUpdate },
      "seller_conditions: conditions submitted",
    );

    // 5. Notify the buyer (non-fatal — DB write already committed above)
    try {
      // Resolve buyer ID: prefer transactions.buyer_id, fall back to deal_conditions submitter
      let buyerId: string | null = deal.buyer_id ?? null;

      if (!buyerId) {
        const { rows: dcRows } = await pool.query(
          `SELECT buyer_id FROM deal_conditions WHERE deal_id = $1 LIMIT 1`,
          [dealId],
        );
        if (dcRows.length) buyerId = dcRows[0].buyer_id as string;
      }

      if (buyerId) {
        const [{ data: sellerProfile }, { data: buyerProfile }] = await Promise.all([
          supabaseAdmin
            .from("profiles")
            .select("display_name, username")
            .eq("id", callerId)
            .maybeSingle(),
          supabaseAdmin
            .from("profiles")
            .select("language")
            .eq("id", buyerId)
            .maybeSingle(),
        ]);

        const sellerName = (sellerProfile as any)?.display_name
          || (sellerProfile as any)?.username
          || "The seller";

        const lang = (buyerProfile as any)?.language ?? "en";
        const isAr = lang === "ar";

        await createNotification({
          userId:   buyerId,
          type:     "seller_conditions_submitted",
          title:    isAr ? "📋 شروط البائع" : "📋 Seller Conditions Added",
          body:     isAr
            ? `أضاف ${sellerName} شروطه للصفقة ${dealId} — راجع الشروط قبل إتمام الدفع.`
            : `${sellerName} added conditions to deal ${dealId} — review before paying.`,
          actorId:  callerId,
          metadata: { dealId, conditionId: conditionRow.id },
        });
      } else {
        logger.info(
          { dealId },
          "seller_conditions: no buyer identified yet — notification deferred",
        );
      }
    } catch (notifyErr) {
      logger.warn(
        { err: notifyErr, dealId, sellerId: callerId },
        "seller_conditions: buyer notification failed (non-fatal)",
      );
    }

    res.status(201).json({ condition: conditionRow });
  } catch (err) {
    logger.error({ err, dealId, sellerId: callerId }, "POST /seller-conditions failed");
    res.status(500).json({ error: "SUBMIT_FAILED", message: "Could not submit conditions." });
  }
});

// ── GET /api/seller-conditions/:dealId ───────────────────────────────────────
//
// Returns the seller's conditions for a deal.
// Any authenticated user who has the deal link can read (seller, buyer,
// or potential buyer who submitted deal_conditions).

router.get("/seller-conditions/:dealId", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const dealId   = String(req.params["dealId"]);

  try {
    // Verify deal exists and caller has some relationship with it
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
    const isBuyer   = deal.buyer_id  === callerId;

    if (!isSeller && !isBuyer) {
      // Allow if caller has submitted buyer conditions (potential buyer with link)
      const { rows: dcCheck } = await pool.query(
        `SELECT 1 FROM deal_conditions WHERE deal_id = $1 AND buyer_id = $2`,
        [dealId, callerId],
      );
      if (!dcCheck.length) {
        res.status(403).json({ error: "FORBIDDEN", message: "Access denied." });
        return;
      }
    }

    const { rows } = await pool.query(
      `SELECT * FROM seller_conditions WHERE deal_id = $1`,
      [dealId],
    );

    res.json({ condition: rows.length > 0 ? rows[0] : null });
  } catch (err) {
    logger.error({ err, dealId, callerId }, "GET /seller-conditions/:dealId failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load conditions." });
  }
});

export default router;
