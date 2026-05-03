/**
 * confirm-receipt.ts — Buyer Confirm Receipt for Secure Deals (Part #7)
 *
 * Endpoint:
 *   POST /api/confirm-receipt
 *
 * Auth:
 *   requireAuth — JWT required.  Only the deal's buyer may call this.
 *
 * Body: { deal_id: string }
 *
 * Happy path:
 *   1. Fetch transaction from Replit Postgres.
 *   2. Verify caller is the buyer (403 NOT_BUYER otherwise).
 *   3. Guard: shipment_status must be 'verified' or 'delivered'.
 *      — if already 'delivered': respond 200 { already_confirmed: true } (idempotent).
 *      — if 'pending': respond 409 SHIPMENT_NOT_VERIFIED.
 *   4. UPDATE transactions SET shipment_status='delivered', confirmed_at=NOW().
 *   5. Notify seller via createNotification (non-fatal).
 *   6. Return { deal_id, shipment_status: 'delivered', confirmed_at }.
 *
 * Idempotency:
 *   Calling this multiple times is safe — the UPDATE is a no-op after the
 *   first call and the seller gets at most one notification per state change.
 */

import { Router, json } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { pool } from "../lib/pg-pool";
import { supabaseAdmin } from "../lib/supabase";
import { logger } from "../lib/logger";
import { createNotification } from "../lib/notifications";

const router = Router();

router.use(json({ limit: "8kb" }));

router.post("/confirm-receipt", requireAuth, async (req, res) => {
  const callerId = (req as any).user?.id as string | undefined;
  if (!callerId) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  const { deal_id: dealId } = req.body as { deal_id?: string };

  if (!dealId || typeof dealId !== "string" || !dealId.trim()) {
    res.status(400).json({ error: "BAD_REQUEST", message: "deal_id is required." });
    return;
  }

  try {
    // 1. Fetch transaction
    const { rows } = await pool.query(
      `SELECT deal_id, seller_id, buyer_id, product_name,
              shipment_status, payment_status, confirmed_at
       FROM transactions
       WHERE deal_id = $1`,
      [dealId],
    );

    if (!rows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const deal = rows[0];

    // 2. Caller must be the buyer
    if (!deal.buyer_id || deal.buyer_id !== callerId) {
      res.status(403).json({ error: "NOT_BUYER", message: "Only the buyer can confirm receipt." });
      return;
    }

    // 3. Payment must be secured
    if (deal.payment_status !== "secured") {
      res.status(409).json({
        error:   "PAYMENT_NOT_SECURED",
        message: "Payment has not been secured yet.",
      });
      return;
    }

    // 4. Idempotency — already confirmed
    if (deal.shipment_status === "delivered") {
      res.json({
        deal_id:          deal.deal_id,
        shipment_status:  "delivered",
        confirmed_at:     deal.confirmed_at,
        already_confirmed: true,
      });
      return;
    }

    // 5. Guard — shipment must be verified before buyer can confirm
    if (deal.shipment_status !== "verified") {
      res.status(409).json({
        error:   "SHIPMENT_NOT_VERIFIED",
        message: "Shipment has not been verified by the seller yet.",
      });
      return;
    }

    // 6. Mark as delivered
    const { rows: updated } = await pool.query(
      `UPDATE transactions
          SET shipment_status = 'delivered',
              confirmed_at    = NOW()
        WHERE deal_id = $1
        RETURNING deal_id, shipment_status, confirmed_at`,
      [dealId],
    );

    const result = updated[0];

    logger.info(
      { dealId, buyerId: callerId, confirmedAt: result.confirmed_at },
      "confirm-receipt: buyer confirmed receipt",
    );

    // 7. Notify seller (non-fatal — DB is already updated)
    try {
      const [{ data: buyerProfile }, { data: sellerProfile }] = await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select("display_name, username")
          .eq("id", callerId)
          .maybeSingle(),
        supabaseAdmin
          .from("profiles")
          .select("language")
          .eq("id", deal.seller_id)
          .maybeSingle(),
      ]);

      const buyerName =
        (buyerProfile as any)?.display_name ||
        (buyerProfile as any)?.username ||
        "The buyer";

      const lang = (sellerProfile as any)?.language ?? "en";
      const isAr = lang === "ar";

      await createNotification({
        userId:   deal.seller_id,
        type:     "buyer_confirmed_receipt",
        title:    isAr ? "✅ المشتري أكّد الاستلام" : "✅ Buyer Confirmed Receipt",
        body:     isAr
          ? `أكّد ${buyerName} استلام المنتج للصفقة ${dealId}. يمكنك الآن تحرير الأموال.`
          : `${buyerName} confirmed receipt of the item for deal ${dealId}. You can now release funds.`,
        actorId:  callerId,
        metadata: { dealId, confirmedAt: result.confirmed_at },
      });
    } catch (notifyErr) {
      logger.warn(
        { err: notifyErr, dealId, sellerId: deal.seller_id },
        "confirm-receipt: seller notification failed (non-fatal)",
      );
    }

    res.json({
      deal_id:          result.deal_id,
      shipment_status:  result.shipment_status,
      confirmed_at:     result.confirmed_at,
      already_confirmed: false,
    });
  } catch (err) {
    logger.error({ err, dealId, callerId }, "POST /confirm-receipt failed");
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Could not confirm receipt." });
  }
});

export default router;
