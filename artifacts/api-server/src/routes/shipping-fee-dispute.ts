/**
 * shipping-fee-dispute.ts — Shipping Fee Dispute for Secure Deals (Part #9)
 *
 * Endpoints:
 *   POST /api/shipping-fee-dispute           — create or update a dispute
 *   GET  /api/shipping-fee-dispute/:dealId   — list all disputes for a deal
 *   GET  /api/admin/shipping-fee-disputes    — list all disputes (admin only)
 *
 * Business rules:
 *   • Only the deal's buyer or seller may create a dispute.
 *   • Deal must have payment_status = 'secured' (funds are in escrow).
 *   • `party` = who the submitter claims should pay the shipping fee ('buyer'|'seller').
 *   • UNIQUE (deal_id, submitted_by) — one dispute per participant per deal.
 *     Re-submitting updates the existing row (comment + party can change).
 *   • Other party is notified via push + in-app notification (non-fatal).
 *
 * Request body (JSON):
 *   { deal_id: string; party: "buyer"|"seller"; comment?: string; proof_url?: string }
 */

import { Router, json } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { pool } from "../lib/pg-pool";
import { supabaseAdmin } from "../lib/supabase";
import { logger } from "../lib/logger";
import { createNotification } from "../lib/notifications";

const router = Router();

router.use(json({ limit: "16kb" }));

// ── POST /api/shipping-fee-dispute ────────────────────────────────────────────

router.post("/shipping-fee-dispute", requireAuth, async (req, res) => {
  const callerId = req.user!.id;

  const {
    deal_id:   dealId,
    party,
    comment,
    proof_url: proofUrl,
  } = req.body as {
    deal_id?:   string;
    party?:     string;
    comment?:   string;
    proof_url?: string;
  };

  if (!dealId || typeof dealId !== "string" || !dealId.trim()) {
    res.status(400).json({ error: "BAD_REQUEST", message: "deal_id is required." });
    return;
  }
  if (party !== "buyer" && party !== "seller") {
    res.status(400).json({ error: "BAD_REQUEST", message: 'party must be "buyer" or "seller".' });
    return;
  }

  const cleanComment  = typeof comment   === "string" ? comment.trim().slice(0, 2000)   : null;
  const cleanProofUrl = typeof proofUrl  === "string" ? proofUrl.trim().slice(0, 1000)  : null;

  try {
    // 1. Validate deal + caller role
    const { rows: dealRows } = await pool.query(
      `SELECT deal_id, seller_id, buyer_id, payment_status, product_name FROM transactions WHERE deal_id = $1`,
      [dealId],
    );
    if (!dealRows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const deal = dealRows[0];

    const isBuyer  = deal.buyer_id  === callerId;
    const isSeller = deal.seller_id === callerId;

    if (!isBuyer && !isSeller) {
      res.status(403).json({ error: "NOT_PARTICIPANT", message: "Only the buyer or seller of this deal can create a dispute." });
      return;
    }

    if (deal.payment_status !== "secured") {
      res.status(409).json({
        error:   "PAYMENT_NOT_SECURED",
        message: "A shipping fee dispute can only be raised after payment is secured.",
      });
      return;
    }

    // 2. Upsert dispute (re-submit updates existing row)
    const { rows: upserted } = await pool.query(
      `INSERT INTO shipping_fee_disputes (deal_id, submitted_by, party, comment, proof_url)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (deal_id, submitted_by) DO UPDATE
         SET party      = EXCLUDED.party,
             comment    = EXCLUDED.comment,
             proof_url  = EXCLUDED.proof_url,
             created_at = NOW()
       RETURNING *`,
      [dealId, callerId, party, cleanComment || null, cleanProofUrl || null],
    );

    const dispute = upserted[0];

    logger.info(
      { dealId, submittedBy: callerId, party, hasComment: !!cleanComment, hasProof: !!cleanProofUrl },
      "shipping_fee_dispute: created/updated",
    );

    // 3. Notify other party (non-fatal)
    const otherPartyId = isSeller ? deal.buyer_id : deal.seller_id;
    if (otherPartyId) {
      try {
        const [{ data: submitterProfile }, { data: otherProfile }] = await Promise.all([
          supabaseAdmin
            .from("profiles")
            .select("display_name, username")
            .eq("id", callerId)
            .maybeSingle(),
          supabaseAdmin
            .from("profiles")
            .select("language")
            .eq("id", otherPartyId)
            .maybeSingle(),
        ]);

        const submitterName =
          (submitterProfile as any)?.display_name ||
          (submitterProfile as any)?.username ||
          (isSeller ? "The seller" : "The buyer");

        const lang = (otherProfile as any)?.language ?? "en";
        const isAr = lang === "ar";

        const partyLabel = isAr
          ? (party === "buyer" ? "المشتري" : "البائع")
          : (party === "buyer" ? "the buyer"  : "the seller");

        await createNotification({
          userId:   otherPartyId,
          type:     "shipping_fee_dispute_created",
          title:    isAr ? "⚠️ نزاع على رسوم الشحن" : "⚠️ Shipping Fee Dispute",
          body:     isAr
            ? `${submitterName} فتح نزاعاً حول رسوم الشحن للصفقة ${dealId}. المسؤول المقترح: ${partyLabel}.`
            : `${submitterName} opened a shipping fee dispute for deal ${dealId}. Claimed responsible party: ${partyLabel}.`,
          actorId:  callerId,
          metadata: { dealId, party, disputeId: dispute.id },
        });
      } catch (notifyErr) {
        logger.warn(
          { err: notifyErr, dealId, otherPartyId },
          "shipping_fee_dispute: other-party notification failed (non-fatal)",
        );
      }
    }

    res.status(201).json({ dispute });
  } catch (err) {
    logger.error({ err, dealId, callerId }, "POST /shipping-fee-dispute failed");
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Could not create dispute." });
  }
});

// ── GET /api/shipping-fee-dispute/:dealId ─────────────────────────────────────

router.get("/shipping-fee-dispute/:dealId", requireAuth, async (req, res) => {
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
    const isBuyer  = deal.buyer_id  === callerId;
    const isSeller = deal.seller_id === callerId;

    if (!isBuyer && !isSeller) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("is_admin")
        .eq("id", callerId)
        .maybeSingle();
      if (!(profile as any)?.is_admin) {
        res.status(403).json({ error: "FORBIDDEN", message: "Access denied." });
        return;
      }
    }

    const { rows: disputes } = await pool.query(
      `SELECT * FROM shipping_fee_disputes WHERE deal_id = $1 ORDER BY created_at ASC`,
      [dealId],
    );

    res.json({ disputes });
  } catch (err) {
    logger.error({ err, dealId, callerId }, "GET /shipping-fee-dispute/:dealId failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load disputes." });
  }
});

// ── GET /api/admin/shipping-fee-disputes ──────────────────────────────────────

router.get(
  "/admin/shipping-fee-disputes",
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT
           d.id,
           d.deal_id,
           d.submitted_by,
           d.party,
           d.proof_url,
           d.comment,
           d.created_at,
           t.product_name,
           t.seller_id,
           t.buyer_id,
           t.currency,
           t.price
         FROM shipping_fee_disputes d
         LEFT JOIN transactions t ON t.deal_id = d.deal_id
         ORDER BY d.created_at DESC`,
      );
      res.json({ disputes: rows });
    } catch (err) {
      logger.error({ err }, "GET /admin/shipping-fee-disputes failed");
      res.status(500).json({ error: "FETCH_FAILED", message: "Could not load disputes." });
    }
  },
);

export default router;
