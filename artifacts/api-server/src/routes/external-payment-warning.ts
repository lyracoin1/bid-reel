/**
 * external-payment-warning.ts — External Payment Warning (Part #13)
 *
 * POST /api/deal/external-payment-warning
 *   - Buyer or seller flags a deal as having an external payment warning.
 *   - Sets external_payment_warning = TRUE on the transactions row.
 *   - Notifies all admin users (non-fatal — never blocks the response).
 *
 * Security:
 *   - requireAuth: valid JWT required
 *   - Only buyer or seller of that deal can trigger this
 *   - Idempotent: second call returns 409 ALREADY_FLAGGED (WHERE-guarded UPDATE)
 */

import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { pool } from "../lib/pg-pool";
import { logger } from "../lib/logger";
import { createNotification } from "../lib/notifications";
import { supabaseAdmin } from "../lib/supabase";

const router = Router();

const warningSchema = z.object({
  deal_id: z.string().min(1),
  reason:  z.string().max(1000).optional(),
});

/** Fetch all admin user IDs from profiles. Non-fatal — returns [] on error. */
async function getAllAdminIds(): Promise<string[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("is_admin", true);
    if (error || !data) return [];
    return (data as { id: string }[]).map(r => r.id);
  } catch {
    return [];
  }
}

// ── POST /api/deal/external-payment-warning ────────────────────────────────────
//
// Body: { deal_id: string; reason?: string }
// Returns: { deal: Transaction row }

router.post("/deal/external-payment-warning", requireAuth, async (req, res) => {
  const callerId = req.user!.id;

  const body = warningSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "INVALID_BODY", details: body.error.flatten() });
    return;
  }

  const { deal_id: dealId, reason } = body.data;

  try {
    // 1. Load deal — include the flag so we can check idempotency
    const { rows: txRows } = await pool.query(
      `SELECT deal_id, seller_id, buyer_id, product_name, currency, price,
              external_payment_warning
       FROM transactions WHERE deal_id = $1`,
      [dealId],
    );

    if (!txRows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const tx = txRows[0];

    // 2. Only buyer or seller may flag
    const isBuyer  = tx.buyer_id  === callerId;
    const isSeller = tx.seller_id === callerId;
    if (!isBuyer && !isSeller) {
      res.status(403).json({
        error:   "FORBIDDEN",
        message: "Only the buyer or seller of this deal can report an external payment warning.",
      });
      return;
    }

    // 3. Fast-path idempotency check before the UPDATE
    if (Boolean(tx.external_payment_warning)) {
      res.status(409).json({
        error:   "ALREADY_FLAGGED",
        message: "This deal has already been flagged for an external payment warning.",
      });
      return;
    }

    // 4. Atomic UPDATE — WHERE external_payment_warning = FALSE prevents races
    const now = new Date().toISOString();
    const { rows: updated } = await pool.query(
      `UPDATE transactions
       SET external_payment_warning         = TRUE,
           external_payment_confirmed_at    = $1,
           external_payment_warning_reason  = $2,
           updated_at                       = $1
       WHERE deal_id = $3 AND external_payment_warning = FALSE
       RETURNING *`,
      [now, reason ?? null, dealId],
    );

    if (!updated.length) {
      // Race: another request flagged it between our SELECT and UPDATE
      res.status(409).json({
        error:   "ALREADY_FLAGGED",
        message: "Deal was already flagged by a concurrent request.",
      });
      return;
    }

    const party      = isBuyer ? "buyer" : "seller";
    const partyLabel = isBuyer ? "المشتري" : "البائع";

    // 5. Notify all admins — fire-and-forget, never blocks response
    void (async () => {
      try {
        const adminIds = await getAllAdminIds();
        const notifPromises = adminIds.map(adminId =>
          createNotification({
            userId:   adminId,
            type:     "external_payment_warning",
            title:    "⚠️ تحذير دفع خارجي",
            body:     `الصفقة ${dealId} (${tx.product_name}) — تم الإبلاغ عن دفع خارج التطبيق بواسطة ${partyLabel}.${reason ? ` السبب: ${reason}` : ""}`,
            metadata: { dealId, party, reason: reason ?? null },
          }).catch(err =>
            logger.warn({ err, adminId, dealId }, "external-payment-warning: notify admin failed (non-fatal)"),
          ),
        );
        await Promise.allSettled(notifPromises);
      } catch (notifErr) {
        logger.warn({ notifErr, dealId }, "external-payment-warning: admin notification block failed (non-fatal)");
      }
    })();

    logger.info({ dealId, callerId, party, reason: reason ?? null }, "external-payment-warning: deal flagged");
    res.json({ deal: updated[0] });
  } catch (err) {
    logger.error({ err, dealId, callerId }, "POST /deal/external-payment-warning failed");
    res.status(500).json({
      error:   "FLAG_FAILED",
      message: "Could not flag external payment. Please try again.",
    });
  }
});

export default router;
