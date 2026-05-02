/**
 * secure-deals.ts — Secure Deals (Transactions) API routes
 *
 * All data is stored in the Replit PostgreSQL `transactions` table
 * (created on first boot via bootstrapTransactionsTable).
 *
 * Endpoints
 *   GET    /api/secure-deals/:dealId        — public; read deal by ID
 *   POST   /api/secure-deals               — auth required; create deal
 *   POST   /api/secure-deals/:dealId/pay   — auth required; mark as paid
 *   PATCH  /api/secure-deals/:dealId/ship  — auth required (seller only); update shipment
 *
 * PAYMENT GATEWAY INTEGRATION POINT
 *   The POST /pay endpoint currently performs a placeholder "payment".
 *   Replace the placeholder block with the real gateway call
 *   (Google Play Billing, Stripe, etc.) before going live.
 *   All DB updates, notifications, and UI state are already wired to deal_id.
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { pool } from "../lib/pg-pool";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendNotificationPlaceholder(event: {
  type: "payment_secured" | "shipment_updated";
  dealId: string;
  buyerId: string;
  sellerId: string;
  amount?: number;
  currency?: string;
}) {
  // PLACEHOLDER — replace with real FCM / Email notification
  logger.info({ event }, "[notify] PLACEHOLDER: secure-deal notification");
  // When wiring FCM:
  //   await sendToDevice(buyerFcmToken, { title: '...', body: '...' });
  // When wiring Email:
  //   await sendEmail(buyerEmail, 'Payment Secured', `Deal ${dealId} ...`);
}

// ── Validation schemas ────────────────────────────────────────────────────────

const createDealSchema = z.object({
  deal_id:         z.string().min(1),
  product_name:    z.string().min(1),
  price:           z.number().positive(),
  currency:        z.string().min(2).max(5).default("USD"),
  description:     z.string().optional(),
  delivery_method: z.string().min(1),
  media_urls:      z.array(z.string().url()).optional().default([]),
  terms:           z.string().optional(),
  payment_link:    z.string().url(),
});

const shipSchema = z.object({
  shipment_status: z.enum(["pending", "verified", "delivered"]).optional(),
  tracking_link:   z.string().url().optional(),
});

// ── GET /api/secure-deals/:dealId  (public — buyer reads deal by link) ─────────

router.get("/secure-deals/:dealId", async (req, res) => {
  const { dealId } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT deal_id, seller_id, buyer_id, product_name, price, currency,
              description, delivery_method, media_urls, terms,
              payment_status, payment_date, shipment_status,
              funds_released, payment_link, release_date, created_at, updated_at
       FROM transactions WHERE deal_id = $1`,
      [dealId],
    );

    if (!rows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    res.json({ deal: rows[0] });
  } catch (err) {
    logger.error({ err, dealId }, "GET /secure-deals/:id failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load deal." });
  }
});

// ── POST /api/secure-deals  (seller creates a deal) ───────────────────────────

router.post("/secure-deals", requireAuth, async (req, res) => {
  const sellerId = req.user!.id;
  const body = createDealSchema.safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "INVALID_BODY", details: body.error.flatten() });
    return;
  }

  const d = body.data;

  try {
    const { rows } = await pool.query(
      `INSERT INTO transactions
         (deal_id, seller_id, product_name, price, currency, description,
          delivery_method, media_urls, terms, payment_link)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        d.deal_id, sellerId, d.product_name, d.price, d.currency,
        d.description ?? null, d.delivery_method,
        d.media_urls ?? [], d.terms ?? null, d.payment_link,
      ],
    );

    logger.info({ dealId: d.deal_id, sellerId }, "Secure deal created");
    res.status(201).json({ deal: rows[0] });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "DUPLICATE_DEAL_ID", message: "Deal ID already exists." });
      return;
    }
    logger.error({ err, sellerId }, "POST /secure-deals failed");
    res.status(500).json({ error: "CREATE_FAILED", message: "Could not create deal." });
  }
});

// ── POST /api/secure-deals/:dealId/pay  (buyer pays) ──────────────────────────

router.post("/secure-deals/:dealId/pay", requireAuth, async (req, res) => {
  const buyerId = req.user!.id;
  const { dealId } = req.params;

  try {
    // Load the deal
    const { rows } = await pool.query(
      `SELECT deal_id, seller_id, buyer_id, price, currency, payment_status
       FROM transactions WHERE deal_id = $1`,
      [dealId],
    );

    if (!rows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const deal = rows[0];

    if (deal.payment_status !== "pending") {
      res.status(409).json({
        error: "ALREADY_PAID",
        message: `Deal is already in '${deal.payment_status}' state.`,
      });
      return;
    }

    // ── PAYMENT GATEWAY INTEGRATION POINT ──────────────────────────────────────
    // Replace this block with the real gateway charge call:
    //   Android: Google Play Billing (via Capacitor plugin → webhook → this route)
    //   Web:     Stripe / PayPal / etc.
    //
    // Only call the DB update below AFTER the gateway confirms a successful charge.
    // Current behaviour: placeholder — always succeeds.
    const gatewaySuccess = true; // ← replace with real gateway call
    if (!gatewaySuccess) {
      res.status(402).json({ error: "PAYMENT_FAILED", message: "Payment was declined." });
      return;
    }
    // ── END PAYMENT GATEWAY BLOCK ───────────────────────────────────────────────

    const now = new Date().toISOString();

    const { rows: updated } = await pool.query(
      `UPDATE transactions
       SET payment_status = 'secured',
           payment_date   = $1,
           buyer_id       = $2,
           updated_at     = $1
       WHERE deal_id = $3 AND payment_status = 'pending'
       RETURNING *`,
      [now, buyerId, dealId],
    );

    if (!updated.length) {
      // Another request snuck in — idempotent guard
      res.status(409).json({ error: "CONCURRENT_UPDATE", message: "Deal status changed concurrently." });
      return;
    }

    const updatedDeal = updated[0];

    // Placeholder notification
    sendNotificationPlaceholder({
      type:     "payment_secured",
      dealId:   String(dealId),
      buyerId,
      sellerId: deal.seller_id,
      amount:   deal.price,
      currency: deal.currency,
    });

    logger.info({ dealId, buyerId, amount: deal.price, currency: deal.currency },
      "Secure deal: payment secured (placeholder)");

    res.json({ deal: updatedDeal });
  } catch (err) {
    logger.error({ err, dealId, buyerId }, "POST /secure-deals/:id/pay failed");
    res.status(500).json({ error: "PAY_FAILED", message: "Could not process payment." });
  }
});

// ── PATCH /api/secure-deals/:dealId/ship  (seller updates shipment) ────────────

router.patch("/secure-deals/:dealId/ship", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const { dealId } = req.params;
  const body = shipSchema.safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "INVALID_BODY", details: body.error.flatten() });
    return;
  }

  try {
    const { rows: existing } = await pool.query(
      `SELECT seller_id, buyer_id, payment_status FROM transactions WHERE deal_id = $1`,
      [dealId],
    );

    if (!existing.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const deal = existing[0];
    if (deal.seller_id !== callerId) {
      res.status(403).json({ error: "FORBIDDEN", message: "Only the seller can update shipment." });
      return;
    }
    if (deal.payment_status !== "secured") {
      res.status(409).json({
        error: "PAYMENT_PENDING",
        message: "Cannot update shipment before payment is secured.",
      });
      return;
    }

    const d = body.data;
    const setClauses: string[] = ["updated_at = NOW()"];
    const values: any[]        = [dealId];

    if (d.shipment_status) {
      values.push(d.shipment_status);
      setClauses.push(`shipment_status = $${values.length}`);
    }
    if (d.tracking_link) {
      // tracking_link is stored in terms field for now (no separate column)
      values.push(`Tracking: ${d.tracking_link}`);
      setClauses.push(`terms = COALESCE(terms || ' | ', '') || $${values.length}`);
    }

    const { rows: updated } = await pool.query(
      `UPDATE transactions SET ${setClauses.join(", ")}
       WHERE deal_id = $1 RETURNING *`,
      values,
    );

    sendNotificationPlaceholder({
      type:     "shipment_updated",
      dealId:   String(dealId),
      buyerId:  deal.buyer_id ?? "",
      sellerId: callerId,
    });

    res.json({ deal: updated[0] });
  } catch (err) {
    logger.error({ err, dealId, callerId }, "PATCH /secure-deals/:id/ship failed");
    res.status(500).json({ error: "UPDATE_FAILED", message: "Could not update shipment." });
  }
});

export default router;
