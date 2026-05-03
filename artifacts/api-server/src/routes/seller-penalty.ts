/**
 * seller-penalty.ts — Seller Penalty System for Secure Deals (Part #10)
 *
 * Endpoints:
 *   POST  /api/seller-penalty              — create a penalty (admin only)
 *   GET   /api/seller-penalties/:sellerId  — list penalties for a seller
 *   PATCH /api/seller-penalty/:id/resolve  — mark a penalty resolved (admin only)
 *   GET   /api/admin/seller-penalties      — list all penalties with deal metadata (admin only)
 *
 * Business rules:
 *   • Only admin may create or resolve penalties.
 *   • seller_id must match the deal's seller_id — wrong seller returns 422.
 *   • A seller may only read their own penalties (admin reads all).
 *   • Seller is notified via push + in-app "seller_penalty_applied" (non-fatal).
 *   • penalty_type must be one of: 'warning' | 'fee' | 'suspension' | 'other'.
 *   • amount is optional; only meaningful for penalty_type = 'fee'.
 *
 * Request body for POST (JSON):
 *   { deal_id, seller_id, reason, penalty_type, amount? }
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

const VALID_TYPES = new Set(["warning", "fee", "suspension", "other"]);

// ── POST /api/seller-penalty ──────────────────────────────────────────────────

router.post("/seller-penalty", requireAuth, requireAdmin, async (req, res) => {
  const {
    deal_id:      dealId,
    seller_id:    sellerId,
    reason,
    penalty_type: penaltyType,
    amount,
  } = req.body as {
    deal_id?:      string;
    seller_id?:    string;
    reason?:       string;
    penalty_type?: string;
    amount?:       number | string | null;
  };

  if (!dealId || typeof dealId !== "string" || !dealId.trim()) {
    res.status(400).json({ error: "BAD_REQUEST", message: "deal_id is required." });
    return;
  }
  if (!sellerId || typeof sellerId !== "string" || !sellerId.trim()) {
    res.status(400).json({ error: "BAD_REQUEST", message: "seller_id is required." });
    return;
  }
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    res.status(400).json({ error: "BAD_REQUEST", message: "reason is required." });
    return;
  }
  if (!penaltyType || !VALID_TYPES.has(penaltyType)) {
    res.status(400).json({ error: "BAD_REQUEST", message: "penalty_type must be warning | fee | suspension | other." });
    return;
  }

  const cleanReason = reason.trim().slice(0, 2000);
  const parsedAmount = amount != null && amount !== "" ? Number(amount) : null;
  if (parsedAmount !== null && isNaN(parsedAmount)) {
    res.status(400).json({ error: "BAD_REQUEST", message: "amount must be a number." });
    return;
  }

  try {
    // Validate deal + seller ownership
    const { rows: dealRows } = await pool.query(
      `SELECT deal_id, seller_id, product_name FROM transactions WHERE deal_id = $1`,
      [dealId],
    );
    if (!dealRows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }
    if (dealRows[0].seller_id !== sellerId) {
      res.status(422).json({ error: "SELLER_MISMATCH", message: "seller_id does not match the deal's seller." });
      return;
    }

    // Insert penalty
    const { rows } = await pool.query(
      `INSERT INTO seller_penalties (deal_id, seller_id, reason, penalty_type, amount)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [dealId, sellerId, cleanReason, penaltyType, parsedAmount],
    );
    const penalty = rows[0];

    logger.info(
      { dealId, sellerId, penaltyType, hasAmount: parsedAmount != null },
      "seller_penalty: created",
    );

    // Notify seller (non-fatal)
    try {
      const [{ data: adminProfile }, { data: sellerProfile }] = await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select("display_name, username")
          .eq("id", req.user!.id)
          .maybeSingle(),
        supabaseAdmin
          .from("profiles")
          .select("language")
          .eq("id", sellerId)
          .maybeSingle(),
      ]);

      const lang  = (sellerProfile as any)?.language ?? "ar";
      const isAr  = lang === "ar";

      const typeLabels: Record<string, { ar: string; en: string }> = {
        warning:    { ar: "تحذير",   en: "Warning" },
        fee:        { ar: "غرامة",   en: "Fee" },
        suspension: { ar: "إيقاف",   en: "Suspension" },
        other:      { ar: "أخرى",    en: "Other" },
      };
      const typeLabel = typeLabels[penaltyType] ?? { ar: penaltyType, en: penaltyType };

      const amountStr = parsedAmount != null ? ` (${parsedAmount})` : "";
      await createNotification({
        userId:   sellerId,
        type:     "seller_penalty_applied",
        title:    isAr ? `⚠️ عقوبة جديدة: ${typeLabel.ar}${amountStr}` : `⚠️ Penalty Applied: ${typeLabel.en}${amountStr}`,
        body:     isAr
          ? `تم تطبيق عقوبة على صفقتك (${dealId}). السبب: ${cleanReason}`
          : `A penalty was applied to your deal (${dealId}). Reason: ${cleanReason}`,
        actorId:  req.user!.id,
        metadata: { dealId, penaltyId: penalty.id, penaltyType, amount: parsedAmount },
      });
    } catch (notifyErr) {
      logger.warn({ err: notifyErr, sellerId, dealId }, "seller_penalty: notification failed (non-fatal)");
    }

    res.status(201).json({ penalty });
  } catch (err) {
    logger.error({ err, dealId, sellerId }, "POST /seller-penalty failed");
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Could not create penalty." });
  }
});

// ── GET /api/seller-penalties/:sellerId ───────────────────────────────────────

router.get("/seller-penalties/:sellerId", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const sellerId = String(req.params["sellerId"]);
  const dealId   = typeof req.query["dealId"] === "string" ? req.query["dealId"] : null;

  // Seller can only read own penalties; admin can read anyone's
  if (callerId !== sellerId) {
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

  try {
    const params: unknown[] = [sellerId];
    let sql = `SELECT * FROM seller_penalties WHERE seller_id = $1`;
    if (dealId) {
      params.push(dealId);
      sql += ` AND deal_id = $2`;
    }
    sql += ` ORDER BY created_at DESC`;

    const { rows } = await pool.query(sql, params);
    res.json({ penalties: rows });
  } catch (err) {
    logger.error({ err, sellerId }, "GET /seller-penalties/:sellerId failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load penalties." });
  }
});

// ── PATCH /api/seller-penalty/:id/resolve ─────────────────────────────────────

router.patch("/seller-penalty/:id/resolve", requireAuth, requireAdmin, async (req, res) => {
  const id = String(req.params["id"]);

  try {
    const { rows } = await pool.query(
      `UPDATE seller_penalties SET resolved = TRUE WHERE id = $1 RETURNING *`,
      [id],
    );
    if (!rows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Penalty not found." });
      return;
    }
    logger.info({ id }, "seller_penalty: resolved");
    res.json({ penalty: rows[0] });
  } catch (err) {
    logger.error({ err, id }, "PATCH /seller-penalty/:id/resolve failed");
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Could not resolve penalty." });
  }
});

// ── GET /api/admin/seller-penalties ───────────────────────────────────────────

router.get("/admin/seller-penalties", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         p.id,
         p.deal_id,
         p.seller_id,
         p.reason,
         p.penalty_type,
         p.amount,
         p.resolved,
         p.created_at,
         t.product_name,
         t.currency,
         t.price
       FROM seller_penalties p
       LEFT JOIN transactions t ON t.deal_id = p.deal_id
       ORDER BY p.created_at DESC`,
    );
    res.json({ penalties: rows });
  } catch (err) {
    logger.error({ err }, "GET /admin/seller-penalties failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load penalties." });
  }
});

export default router;
