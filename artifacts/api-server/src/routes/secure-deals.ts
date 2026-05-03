/**
 * secure-deals.ts — Secure Deals (Transactions) API routes
 *
 * All transaction data lives in the Replit PostgreSQL `transactions` table.
 * Seller profile data is fetched from Supabase cloud (read-only, admin key).
 *
 * Endpoints
 *   GET    /api/secure-deals/:dealId         — public; read deal + seller_name
 *   POST   /api/secure-deals                 — auth required; seller creates deal
 *   POST   /api/transactions/pay-now         — auth required; buyer pays
 *   POST   /api/secure-deals/:dealId/pay     — alias for pay-now (backward compat)
 *   PATCH  /api/secure-deals/:dealId/ship    — auth required (seller only)
 *
 * PAYMENT GATEWAY INTEGRATION POINT
 *   POST /api/transactions/pay-now performs a placeholder charge.
 *   Replace the gateway block before going live (Google Play Billing / Stripe).
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { pool } from "../lib/pg-pool";
import { supabaseAdmin } from "../lib/supabase";
import { logger } from "../lib/logger";
import { verifyPlayInAppPurchase } from "../lib/play-verify";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendNotificationPlaceholder(event: {
  type:      "payment_secured" | "shipment_updated";
  dealId:    string;
  buyerId:   string;
  sellerId:  string;
  amount?:   number;
  currency?: string;
}) {
  // PLACEHOLDER — replace with real FCM / Email notification
  logger.info({ event }, "[notify] PLACEHOLDER: secure-deal notification");
  // FCM example:  await sendToDevice(buyerFcmToken, { title: '…', body: '…' });
  // Email example: await sendEmail(buyerEmail, 'Payment Secured', `…`);
}

/** Resolve display_name or username from Supabase profiles for a given user UUID. */
async function resolveSellerName(sellerId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("display_name, username")
      .eq("id", sellerId)
      .maybeSingle();

    if (error || !data) return null;

    const name = (data as any).display_name || (data as any).username;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
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

const payNowSchema = z.object({
  deal_id:        z.string().min(1),
  buyer_id:       z.string().uuid(),
  amount:         z.number().positive(),
  currency:       z.string().min(2).max(5),
  // Google Play Billing — present only when paying from native Android.
  // When provided the backend verifies the token and uses priceAmountMicros
  // from Google as the authoritative paid_amount, overriding the `amount` field.
  purchase_token: z.string().min(1).optional(),
  product_id:     z.string().min(1).optional(),
});

const shipSchema = z.object({
  shipment_status: z.enum(["pending", "verified", "delivered"]).optional(),
  tracking_link:   z.string().url().optional(),
});

// ── GET /api/secure-deals/:dealId  (public — buyer reads deal by link) ────────

router.get("/secure-deals/:dealId", async (req, res) => {
  const { dealId } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT deal_id, seller_id, buyer_id, product_name, price, currency,
              description, delivery_method, media_urls, terms,
              payment_status, payment_date, paid_amount, shipment_status,
              funds_released, payment_link, release_date, created_at, updated_at,
              external_payment_warning, external_payment_confirmed_at,
              external_payment_warning_reason
       FROM transactions WHERE deal_id = $1`,
      [dealId],
    );

    if (!rows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const deal = rows[0];

    // Enrich with seller display name from Supabase profiles (best-effort)
    const seller_name = await resolveSellerName(deal.seller_id);

    res.json({ deal: { ...deal, seller_name } });
  } catch (err) {
    logger.error({ err, dealId }, "GET /secure-deals/:id failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load deal." });
  }
});

// ── POST /api/secure-deals  (seller creates a deal) ──────────────────────────

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

// ── POST /api/transactions/pay-now  (primary buyer payment endpoint) ──────────
//
// Body: { deal_id, buyer_id, amount, currency }
//
// Flow:
//   1. Validate JWT → extract authenticated buyer ID (must match body.buyer_id)
//   2. Load the deal, assert payment_status = 'pending'
//   3. ── PAYMENT GATEWAY BLOCK (placeholder) ──
//   4. Update DB: payment_status = 'secured', payment_date, buyer_id
//   5. Fire placeholder notification
//   6. Return updated deal

router.post("/transactions/pay-now", requireAuth, async (req, res) => {
  const authenticatedBuyerId = req.user!.id;

  const body = payNowSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "INVALID_BODY", details: body.error.flatten() });
    return;
  }

  const { deal_id: dealId, buyer_id: bodyBuyerId, amount, currency,
          purchase_token, product_id } = body.data;

  // Prevent spoofing: the buyer_id in the body must match the authenticated user
  if (bodyBuyerId !== authenticatedBuyerId) {
    res.status(403).json({
      error: "BUYER_MISMATCH",
      message: "buyer_id does not match the authenticated user.",
    });
    return;
  }

  try {
    // 1. Load deal
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

    // Seller cannot pay for their own deal
    if (deal.seller_id === authenticatedBuyerId) {
      res.status(403).json({
        error: "SELLER_CANNOT_PAY",
        message: "The seller cannot pay for their own deal.",
      });
      return;
    }

    if (deal.payment_status !== "pending") {
      res.status(409).json({
        error: "ALREADY_PAID",
        message: `Deal is already in '${deal.payment_status}' state.`,
      });
      return;
    }

    // 2. ── PAYMENT GATEWAY BLOCK ──────────────────────────────────────────────
    //
    // Two modes:
    //
    //   A) Google Play Billing (native Android — purchase_token present):
    //      Verify the token with the Play Developer API.
    //      paid_amount comes from priceAmountMicros in the verified receipt —
    //      the buyer's self-reported `amount` field is ignored for security.
    //
    //   B) Placeholder / web (no purchase_token):
    //      Allowed only in development (NODE_ENV !== 'production').
    //      paid_amount falls back to the buyer-entered `amount`.
    //
    let finalPaidAmount = amount;

    if (purchase_token && product_id) {
      // ── Mode A: Google Play Billing ────────────────────────────────────────
      const verified = await verifyPlayInAppPurchase(product_id, purchase_token);
      // Use the amount Google actually charged, not what the client claimed
      finalPaidAmount = verified.paid_amount;

      logger.info(
        { dealId, product_id, order_id: verified.order_id, finalPaidAmount },
        "Secure deal: Play purchase verified",
      );
    } else {
      // ── Mode B: placeholder (dev only) ────────────────────────────────────
      if (process.env["NODE_ENV"] === "production") {
        res.status(402).json({
          error: "PAYMENT_REQUIRED",
          message: "A verified Google Play purchase token is required in production.",
        });
        return;
      }
      logger.warn(
        { dealId },
        "Secure deal: using placeholder payment (no purchase_token) — dev mode only",
      );
    }
    // ── END PAYMENT GATEWAY BLOCK ────────────────────────────────────────────

    const now = new Date().toISOString();

    // 3. Atomic update — concurrent-request safe via WHERE payment_status = 'pending'
    //    paid_amount is set from Google's verified receipt (or buyer-entered in dev).
    const { rows: updated } = await pool.query(
      `UPDATE transactions
       SET payment_status = 'secured',
           payment_date   = $1,
           buyer_id       = $2,
           paid_amount    = $3,
           updated_at     = $1
       WHERE deal_id = $4 AND payment_status = 'pending'
       RETURNING *`,
      [now, authenticatedBuyerId, finalPaidAmount, dealId],
    );

    if (!updated.length) {
      res.status(409).json({
        error: "CONCURRENT_UPDATE",
        message: "Deal status changed concurrently — please refresh and try again.",
      });
      return;
    }

    const updatedDeal = updated[0];

    // Lazy-create escrow row now that payment is secured (non-blocking)
    void pool.query(
      `INSERT INTO escrow (deal_id, buyer_id, seller_id, amount)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (deal_id) DO NOTHING`,
      [String(dealId), authenticatedBuyerId, deal.seller_id, finalPaidAmount],
    ).catch(err => logger.warn({ err, dealId }, "escrow: lazy-create on pay-now failed"));

    // 4. Placeholder notification
    sendNotificationPlaceholder({
      type:     "payment_secured",
      dealId:   String(dealId),
      buyerId:  authenticatedBuyerId,
      sellerId: deal.seller_id,
      amount,
      currency,
    });

    logger.info(
      { dealId, buyerId: authenticatedBuyerId, amount, currency },
      "Secure deal: payment secured via /transactions/pay-now",
    );

    res.json({ deal: updatedDeal });
  } catch (err) {
    logger.error({ err, dealId, buyerId: authenticatedBuyerId }, "POST /transactions/pay-now failed");
    res.status(500).json({ error: "PAY_FAILED", message: "Could not process payment. Please try again." });
  }
});

// ── POST /api/secure-deals/:dealId/pay  (backward-compat alias) ──────────────
// Delegates to the same logic as /transactions/pay-now but reads deal_id from the URL.

router.post("/secure-deals/:dealId/pay", requireAuth, async (req, res) => {
  const buyerId = req.user!.id;
  const dealId  = String(req.params["dealId"]);

  try {
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

    if (deal.seller_id === buyerId) {
      res.status(403).json({ error: "SELLER_CANNOT_PAY", message: "The seller cannot pay for their own deal." });
      return;
    }

    if (deal.payment_status !== "pending") {
      res.status(409).json({ error: "ALREADY_PAID", message: `Deal is already in '${deal.payment_status}' state.` });
      return;
    }

    // Placeholder gateway
    const gatewaySuccess = true;
    if (!gatewaySuccess) {
      res.status(402).json({ error: "PAYMENT_DECLINED", message: "Payment declined." });
      return;
    }

    const now = new Date().toISOString();
    const { rows: updated } = await pool.query(
      `UPDATE transactions
       SET payment_status = 'secured',
           payment_date   = $1,
           buyer_id       = $2,
           paid_amount    = $3,
           updated_at     = $1
       WHERE deal_id = $4 AND payment_status = 'pending'
       RETURNING *`,
      [now, buyerId, deal.price, dealId],
    );

    if (!updated.length) {
      res.status(409).json({ error: "CONCURRENT_UPDATE", message: "Deal status changed concurrently." });
      return;
    }

    // Lazy-create escrow row now that payment is secured (non-blocking)
    void pool.query(
      `INSERT INTO escrow (deal_id, buyer_id, seller_id, amount)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (deal_id) DO NOTHING`,
      [String(dealId), buyerId, deal.seller_id, deal.price],
    ).catch(err => logger.warn({ err, dealId }, "escrow: lazy-create on /:id/pay failed"));

    sendNotificationPlaceholder({
      type:     "payment_secured",
      dealId:   String(dealId),
      buyerId,
      sellerId: deal.seller_id,
      amount:   deal.price,
      currency: deal.currency,
    });

    logger.info({ dealId, buyerId }, "Secure deal: payment secured via /:dealId/pay");
    res.json({ deal: updated[0] });
  } catch (err) {
    logger.error({ err, dealId, buyerId }, "POST /secure-deals/:id/pay failed");
    res.status(500).json({ error: "PAY_FAILED", message: "Could not process payment." });
  }
});

// ── PATCH /api/secure-deals/:dealId/ship  (seller updates shipment) ───────────

router.patch("/secure-deals/:dealId/ship", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const dealId   = String(req.params["dealId"]);
  const body     = shipSchema.safeParse(req.body);

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
        error:   "PAYMENT_PENDING",
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
      values.push(`Tracking: ${d.tracking_link}`);
      setClauses.push(`terms = COALESCE(terms || ' | ', '') || $${values.length}`);
    }

    const { rows: updated } = await pool.query(
      `UPDATE transactions SET ${setClauses.join(", ")} WHERE deal_id = $1 RETURNING *`,
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
