/**
 * escrow.ts — Escrow Logic API routes (Part #12)
 *
 * One escrow row per Secure Deal (UNIQUE on deal_id).
 * Created lazily when payment_status transitions to 'secured'.
 *
 * Endpoints:
 *   GET  /api/escrow/:dealId          — buyer, seller, or admin reads escrow status
 *   POST /api/escrow/release          — admin only: release funds to seller
 *   POST /api/escrow/dispute          — buyer or seller: open escrow dispute
 *   POST /api/escrow/resolve-dispute  — admin only: resolve an open escrow dispute
 *
 * Security:
 *   - GET:             requireAuth; caller must be buyer, seller, or admin
 *   - release:         requireAuth + requireAdmin
 *   - dispute:         requireAuth; caller must be buyer or seller
 *   - resolve-dispute: requireAuth + requireAdmin
 *
 * Point 4 — Dispute resolution:
 *   POST /api/escrow/resolve-dispute allows admins to settle a disputed escrow:
 *     favor_seller → release funds to seller (same flow as /escrow/release)
 *     favor_buyer  → mark escrow as 'refunded' (placeholder; actual payout is manual)
 *   Funds CANNOT be released via /escrow/release while escrow.status = 'disputed'.
 *   Only /escrow/resolve-dispute can unblock a disputed escrow.
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

const releaseSchema         = z.object({ deal_id: z.string().min(1) });
const disputeSchema         = z.object({ deal_id: z.string().min(1) });
const resolveDisputeSchema  = z.object({
  deal_id:    z.string().min(1),
  resolution: z.enum(["favor_seller", "favor_buyer"]),
  admin_note: z.string().max(2000).optional(),
});

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

// ── Helper: calculate and apply 3% platform fee release ───────────────────────
// Shared by /release and /resolve-dispute (favor_seller) so fee logic is not duplicated.

async function applyEscrowRelease(opts: {
  dealId:    string;
  escrow:    any;
  tx:        any;
  adminId:   string;
  adminNote?: string | null;
}): Promise<any> {
  const { dealId, escrow, tx, adminId, adminNote } = opts;

  const PLATFORM_FEE_RATE   = 0.03;
  const paidAmount          = Number(escrow.amount);
  const platformFee         = Math.round(paidAmount * PLATFORM_FEE_RATE * 100) / 100;
  const sellerReceiveAmount = Math.round((paidAmount - platformFee) * 100) / 100;
  const now                 = new Date().toISOString();

  // Atomic release — WHERE status IN ('pending','disputed') allows resolving disputed escrows.
  // Normal /release only allows 'pending'; /resolve-dispute also allows 'disputed'.
  const { rows: updatedEscrow } = await pool.query(
    `UPDATE escrow
     SET status                = 'released',
         released_at           = $1,
         platform_fee          = $3,
         seller_receive_amount = $4,
         resolved_by_admin     = $5,
         admin_note            = $6
     WHERE deal_id = $2 AND status IN ('pending', 'disputed')
     RETURNING *`,
    [now, dealId, platformFee, sellerReceiveAmount, adminId, adminNote ?? null],
  );

  if (!updatedEscrow.length) return null;

  await pool.query(
    `UPDATE transactions
     SET funds_released = true, release_date = $1, updated_at = $1
     WHERE deal_id = $2`,
    [now, dealId],
  );

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

  return updatedEscrow[0];
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
//
// Point 4: this endpoint CANNOT release while escrow.status = 'disputed'.
// Use POST /api/escrow/resolve-dispute (favor_seller) to release a disputed escrow.

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

    // Point 4: block release while disputed — admin must use /resolve-dispute instead.
    if (escrow.status === "disputed") {
      res.status(409).json({
        error:   "OPEN_DISPUTE",
        message: "Cannot release funds while an escrow dispute is open. Use POST /api/escrow/resolve-dispute to settle the dispute first.",
      });
      return;
    }

    const updatedEscrow = await applyEscrowRelease({ dealId, escrow, tx, adminId });

    if (!updatedEscrow) {
      res.status(409).json({
        error: "CONCURRENT_UPDATE",
        message: "Escrow state changed concurrently — please refresh and try again.",
      });
      return;
    }

    logger.info({ dealId, adminId }, "escrow: funds released");
    res.json({ escrow: updatedEscrow });
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

// ── POST /api/escrow/resolve-dispute ─────────────────────────────────────────
//
// Admin only. Resolves an open escrow dispute in favour of one party.
//
// Point 4 — Completes escrow dispute resolution:
//   favor_seller → release funds to seller (3% platform fee applied, same as /release)
//   favor_buyer  → mark escrow as 'refunded' (blocks any future release);
//                  actual refund payout to buyer is handled externally/manually.
//
// This is the ONLY route that can transition escrow out of 'disputed' status.
// POST /escrow/release explicitly blocks on status='disputed'.

router.post("/escrow/resolve-dispute", requireAuth, requireAdmin, async (req, res) => {
  const adminId = req.user!.id;

  const body = resolveDisputeSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "INVALID_BODY", details: body.error.flatten() });
    return;
  }

  const { deal_id: dealId, resolution, admin_note } = body.data;

  try {
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

    if (!tx.buyer_id) {
      res.status(409).json({ error: "NO_BUYER", message: "Deal has no buyer — cannot resolve escrow dispute." });
      return;
    }

    const { rows: escrowRows } = await pool.query(
      `SELECT * FROM escrow WHERE deal_id = $1`,
      [dealId],
    );

    if (!escrowRows.length) {
      res.status(404).json({ error: "ESCROW_NOT_FOUND", message: "No escrow row found for this deal." });
      return;
    }

    const escrow = escrowRows[0];

    if (escrow.status !== "disputed") {
      res.status(409).json({
        error:   "NOT_DISPUTED",
        message: `Escrow is not in 'disputed' state — current status: ${escrow.status}.`,
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

    if (resolution === "favor_seller") {
      // Release funds to seller — same 3% fee flow as /escrow/release
      const updatedEscrow = await applyEscrowRelease({
        dealId,
        escrow,
        tx,
        adminId,
        adminNote: admin_note ?? "Escrow dispute resolved in favour of seller.",
      });

      if (!updatedEscrow) {
        res.status(409).json({
          error: "CONCURRENT_UPDATE",
          message: "Escrow state changed concurrently — please refresh and try again.",
        });
        return;
      }

      logger.info({ dealId, adminId, resolution }, "escrow: dispute resolved — funds released to seller");
      res.json({ escrow: updatedEscrow, resolution });

    } else {
      // favor_buyer — mark escrow as 'refunded'; actual payout is external/manual
      const { rows: updatedEscrow } = await pool.query(
        `UPDATE escrow
         SET status            = 'refunded',
             resolved_by_admin = $1,
             admin_note        = $2
         WHERE deal_id = $3 AND status = 'disputed'
         RETURNING *`,
        [adminId, admin_note ?? "Escrow dispute resolved in favour of buyer.", dealId],
      );

      if (!updatedEscrow.length) {
        res.status(409).json({
          error: "CONCURRENT_UPDATE",
          message: "Escrow state changed concurrently — please refresh and try again.",
        });
        return;
      }

      // Notify both parties
      const meta = { deal_id: dealId };
      void Promise.allSettled([
        createNotification({
          userId:   tx.buyer_id,
          type:     "escrow_disputed",
          title:    "Dispute Resolved — Refund Approved",
          body:     "Admin has resolved your escrow dispute in your favour. A refund will be processed. Contact support for details.",
          actorId:  adminId,
          metadata: meta,
        }),
        createNotification({
          userId:   tx.seller_id,
          type:     "escrow_disputed",
          title:    "Dispute Resolved — Buyer Refund",
          body:     "Admin has resolved the escrow dispute in the buyer's favour. Funds will not be released to you.",
          actorId:  adminId,
          metadata: meta,
        }),
      ]);

      logger.info({ dealId, adminId, resolution }, "escrow: dispute resolved — refund approved for buyer");
      res.json({ escrow: updatedEscrow[0], resolution });
    }
  } catch (err) {
    logger.error({ err, dealId, adminId }, "POST /escrow/resolve-dispute failed");
    res.status(500).json({ error: "RESOLVE_FAILED", message: "Could not resolve escrow dispute." });
  }
});

export default router;
