/**
 * escrow.ts — Escrow Logic API routes (Part #12)
 *
 * One escrow row per Secure Deal (UNIQUE on deal_id).
 * Created lazily when payment_status transitions to 'secured'.
 *
 * Endpoints:
 *   GET  /api/escrow/:dealId  — buyer, seller, or admin reads escrow status
 *   POST /api/escrow/release  — admin only: release funds to seller
 *   POST /api/escrow/dispute  — buyer or seller: open escrow dispute
 *
 * Security:
 *   - GET:     requireAuth; caller must be buyer, seller, or admin
 *   - release: requireAuth + requireAdmin
 *   - dispute: requireAuth; caller must be buyer or seller
 *
 * Notifications (non-fatal — never block the main flow):
 *   escrow_released → buyer + seller
 *   escrow_disputed → other party (buyer notifies seller; seller notifies buyer)
 */

import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { pool } from "../lib/pg-pool";
import { supabaseAdmin } from "../lib/supabase";
import { logger } from "../lib/logger";
import { createNotification } from "../lib/notifications";

const router = Router();

// ── Schemas ───────────────────────────────────────────────────────────────────

const releaseSchema = z.object({ deal_id: z.string().min(1) });
const disputeSchema = z.object({ deal_id: z.string().min(1) });

// ── Helper: check admin ────────────────────────────────────────────────────────

async function callerIsAdmin(userId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("is_admin")
      .eq("id", userId)
      .maybeSingle();
    return Boolean((data as any)?.is_admin);
  } catch {
    return false;
  }
}

// ── Helper: lazy-upsert escrow row ────────────────────────────────────────────
// Returns the escrow row (existing or newly created). Returns null when
// the deal has no buyer yet (can't create escrow without both parties).

async function ensureEscrowRow(
  dealId: string,
  buyerId: string,
  sellerId: string,
  amount: number,
): Promise<any> {
  await pool.query(
    `INSERT INTO escrow (deal_id, buyer_id, seller_id, amount)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (deal_id) DO NOTHING`,
    [dealId, buyerId, sellerId, amount],
  );
  const { rows } = await pool.query(
    `SELECT * FROM escrow WHERE deal_id = $1`,
    [dealId],
  );
  return rows[0] ?? null;
}

// ── GET /api/escrow/:dealId ───────────────────────────────────────────────────
//
// Returns the escrow row for the deal.
// Performs lazy-create when the deal is paid but no escrow row exists yet.
// Access: caller must be buyer, seller, or admin.

router.get("/escrow/:dealId", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const { dealId } = req.params;

  try {
    const { rows: txRows } = await pool.query(
      `SELECT deal_id, seller_id, buyer_id, price, payment_status
       FROM transactions WHERE deal_id = $1`,
      [dealId],
    );

    if (!txRows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const tx = txRows[0];
    const admin = await callerIsAdmin(callerId);

    if (!admin && tx.seller_id !== callerId && tx.buyer_id !== callerId) {
      res.status(403).json({ error: "FORBIDDEN", message: "You are not a party to this deal." });
      return;
    }

    // Load existing row
    const { rows: escrowRows } = await pool.query(
      `SELECT * FROM escrow WHERE deal_id = $1`,
      [dealId],
    );

    // Lazy-create when payment is secured and buyer exists
    if (!escrowRows.length && tx.payment_status === "secured" && tx.buyer_id) {
      const row = await ensureEscrowRow(dealId, tx.buyer_id, tx.seller_id, Number(tx.price));
      res.json({ escrow: row });
      return;
    }

    res.json({ escrow: escrowRows[0] ?? null });
  } catch (err) {
    logger.error({ err, dealId }, "GET /escrow/:dealId failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load escrow." });
  }
});

// ── POST /api/escrow/release ──────────────────────────────────────────────────
//
// Admin only. Marks escrow as released and sets funds_released on the deal.
// Guards: payment=secured, status≠released, status≠disputed.
// Prevent double-release via WHERE status = 'pending' in the UPDATE.

router.post("/escrow/release", requireAuth, requireAdmin, async (req, res) => {
  const adminId = req.user!.id;

  const body = releaseSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "INVALID_BODY", details: body.error.flatten() });
    return;
  }

  const { deal_id: dealId } = body.data;

  try {
    // Load transaction
    const { rows: txRows } = await pool.query(
      `SELECT deal_id, seller_id, buyer_id, price, currency, payment_status, funds_released
       FROM transactions WHERE deal_id = $1`,
      [dealId],
    );

    if (!txRows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const tx = txRows[0];

    if (tx.payment_status !== "secured") {
      res.status(409).json({
        error: "PAYMENT_NOT_SECURED",
        message: "Deal payment must be secured before releasing escrow.",
      });
      return;
    }

    if (Boolean(tx.funds_released)) {
      res.status(409).json({
        error: "ALREADY_RELEASED",
        message: "Funds have already been released for this deal.",
      });
      return;
    }

    if (!tx.buyer_id) {
      res.status(409).json({ error: "NO_BUYER", message: "Deal has no buyer yet." });
      return;
    }

    // Ensure escrow row exists (lazy-create if needed)
    const escrow = await ensureEscrowRow(dealId, tx.buyer_id, tx.seller_id, Number(tx.price));

    if (!escrow) {
      res.status(500).json({ error: "ESCROW_CREATE_FAILED", message: "Could not create escrow row." });
      return;
    }

    if (escrow.status === "released") {
      res.status(409).json({ error: "ALREADY_RELEASED", message: "Escrow already released." });
      return;
    }

    if (escrow.status === "disputed") {
      res.status(409).json({
        error: "OPEN_DISPUTE",
        message: "Cannot release funds while an escrow dispute is open.",
      });
      return;
    }

    const now = new Date().toISOString();

    // Calculate 3% platform commission
    const PLATFORM_FEE_RATE    = 0.03;
    const paidAmount           = Number(escrow.amount);
    const platformFee          = Math.round(paidAmount * PLATFORM_FEE_RATE * 100) / 100;
    const sellerReceiveAmount  = Math.round((paidAmount - platformFee) * 100) / 100;

    // Atomic release — WHERE status = 'pending' prevents double-release
    // Records platform_fee and seller_receive_amount for internal accounting.
    // Funds do NOT leave escrow — this is internal bookkeeping only.
    const { rows: updatedEscrow } = await pool.query(
      `UPDATE escrow
       SET status                = 'released',
           released_at           = $1,
           platform_fee          = $3,
           seller_receive_amount = $4
       WHERE deal_id = $2 AND status = 'pending'
       RETURNING *`,
      [now, dealId, platformFee, sellerReceiveAmount],
    );

    if (!updatedEscrow.length) {
      res.status(409).json({
        error: "CONCURRENT_UPDATE",
        message: "Escrow state changed concurrently — please refresh and try again.",
      });
      return;
    }

    // Mark deal as funds_released
    await pool.query(
      `UPDATE transactions
       SET funds_released = true, release_date = $1, updated_at = $1
       WHERE deal_id = $2`,
      [now, dealId],
    );

    // Notifications (non-fatal) — use escrow_released_with_fee type (Part #14)
    const currency = tx.currency ?? "SAR";
    const feeStr   = `${platformFee.toLocaleString()} ${currency}`;
    const rcvStr   = `${sellerReceiveAmount.toLocaleString()} ${currency}`;
    const totStr   = `${paidAmount.toLocaleString()} ${currency}`;
    const meta     = { deal_id: dealId, platform_fee: platformFee, seller_receive_amount: sellerReceiveAmount };

    void Promise.allSettled([
      createNotification({
        userId:   tx.seller_id,
        type:     "escrow_released_with_fee",
        title:    "تم تحرير الأموال",
        body:     `تم تحرير الصفقة. المبلغ الإجمالي ${totStr} — عمولة المنصة (3%) ${feeStr} — يستلم البائع ${rcvStr}. تبقى الأموال داخل المنصة.`,
        actorId:  adminId,
        metadata: meta,
      }),
      createNotification({
        userId:   tx.buyer_id,
        type:     "escrow_released_with_fee",
        title:    "Escrow Released",
        body:     `The deal is complete. Total paid: ${totStr}. Platform fee (3%): ${feeStr}. Seller receives: ${rcvStr}. Funds remain within the platform.`,
        actorId:  adminId,
        metadata: meta,
      }),
    ]);

    logger.info({ dealId, adminId }, "escrow: funds released");
    res.json({ escrow: updatedEscrow[0] });
  } catch (err) {
    logger.error({ err, dealId }, "POST /escrow/release failed");
    res.status(500).json({ error: "RELEASE_FAILED", message: "Could not release escrow." });
  }
});

// ── POST /api/escrow/dispute ──────────────────────────────────────────────────
//
// Buyer or seller opens an escrow dispute.
// Sets status='disputed' and generates a dispute_id UUID for reference.
// Guards: caller must be buyer or seller; status must be 'pending'.

router.post("/escrow/dispute", requireAuth, async (req, res) => {
  const callerId = req.user!.id;

  const body = disputeSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "INVALID_BODY", details: body.error.flatten() });
    return;
  }

  const { deal_id: dealId } = body.data;

  try {
    const { rows: txRows } = await pool.query(
      `SELECT deal_id, seller_id, buyer_id, price, currency, payment_status
       FROM transactions WHERE deal_id = $1`,
      [dealId],
    );

    if (!txRows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const tx = txRows[0];

    if (tx.seller_id !== callerId && tx.buyer_id !== callerId) {
      res.status(403).json({ error: "FORBIDDEN", message: "You are not a party to this deal." });
      return;
    }

    if (tx.payment_status !== "secured") {
      res.status(409).json({
        error: "PAYMENT_NOT_SECURED",
        message: "Cannot dispute — payment has not been secured.",
      });
      return;
    }

    if (!tx.buyer_id) {
      res.status(409).json({ error: "NO_BUYER", message: "Deal has no buyer yet." });
      return;
    }

    // Ensure escrow row exists
    const escrow = await ensureEscrowRow(dealId, tx.buyer_id, tx.seller_id, Number(tx.price));

    if (!escrow) {
      res.status(500).json({ error: "ESCROW_CREATE_FAILED", message: "Could not create escrow row." });
      return;
    }

    if (escrow.status === "released") {
      res.status(409).json({
        error: "ALREADY_RELEASED",
        message: "Cannot dispute — escrow has already been released.",
      });
      return;
    }

    if (escrow.status === "disputed") {
      res.status(409).json({
        error: "ALREADY_DISPUTED",
        message: "An escrow dispute is already open for this deal.",
      });
      return;
    }

    // Atomic update — WHERE status = 'pending' prevents race conditions
    const { rows: updatedEscrow } = await pool.query(
      `UPDATE escrow
       SET status = 'disputed', dispute_id = gen_random_uuid()
       WHERE deal_id = $1 AND status = 'pending'
       RETURNING *`,
      [dealId],
    );

    if (!updatedEscrow.length) {
      res.status(409).json({
        error: "CONCURRENT_UPDATE",
        message: "Escrow state changed concurrently — please refresh and try again.",
      });
      return;
    }

    const isCallerBuyer = tx.buyer_id === callerId;
    const otherPartyId  = isCallerBuyer ? tx.seller_id : tx.buyer_id;
    const callerRole    = isCallerBuyer ? "buyer" : "seller";
    const meta          = { deal_id: dealId };

    // Notify the other party (non-fatal)
    if (otherPartyId && otherPartyId !== callerId) {
      void createNotification({
        userId:   otherPartyId,
        type:     "escrow_disputed",
        title:    "Escrow Dispute Opened",
        body:     `The ${callerRole} has opened an escrow dispute on this deal. Admin will review shortly.`,
        actorId:  callerId,
        metadata: meta,
      });
    }

    logger.info({ dealId, callerId, callerRole }, "escrow: dispute opened");
    res.json({ escrow: updatedEscrow[0] });
  } catch (err) {
    logger.error({ err, dealId }, "POST /escrow/dispute failed");
    res.status(500).json({ error: "DISPUTE_FAILED", message: "Could not open dispute." });
  }
});

export default router;
