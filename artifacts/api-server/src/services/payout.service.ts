/**
 * payout.service.ts — Payout record creation helper
 *
 * createPayoutRecord() is called from multiple trigger points:
 *   - digital-vault.ts  → buyer ACKs vault (vault_ack_status = 'accepted')
 *   - digital-vault.ts  → admin resolves digital dispute in seller's favour
 *   - escrow.ts         → escrow is released (covers physical deals)
 *
 * Design:
 *   - Idempotent: ON CONFLICT (deal_id) DO NOTHING prevents double-creation
 *     even when multiple triggers fire for the same deal.
 *   - Non-fatal: failures are logged but never propagated to the caller.
 *   - No payout is created if payment is not 'secured'.
 *   - platform_fee and net_amount are taken from the escrow row when available,
 *     or calculated at 3% when the escrow row hasn't been created yet.
 *   - payout_method_id is the seller's current default method; NULL if none set.
 */

import { pool }   from "../lib/pg-pool";
import { logger } from "../lib/logger";

const PLATFORM_FEE_RATE = 0.03;

/**
 * Create a payout record for the seller of the given deal.
 *
 * Safe to call multiple times for the same deal — idempotent.
 * Never throws; errors are logged at ERROR level.
 *
 * @param dealId — TEXT primary key from the transactions table.
 */
export async function createPayoutRecord(dealId: string): Promise<void> {
  try {
    // ── 1. Load the transaction ───────────────────────────────────────────────
    const { rows: txRows } = await pool.query(
      `SELECT deal_id, seller_id, paid_amount, price, payment_status
       FROM transactions WHERE deal_id = $1`,
      [dealId],
    );

    if (!txRows.length) {
      logger.warn({ dealId }, "createPayoutRecord: transaction not found — skipping");
      return;
    }

    const tx = txRows[0];

    // Safety gate: never create a payout for an unsecured deal
    if (tx.payment_status !== "secured") {
      logger.warn(
        { dealId, payment_status: tx.payment_status },
        "createPayoutRecord: payment not secured — payout not created",
      );
      return;
    }

    // ── 2. Determine amounts (prefer escrow row; fall back to 3% calculation) ─
    const { rows: escrowRows } = await pool.query(
      `SELECT amount, platform_fee, seller_receive_amount, status
       FROM escrow WHERE deal_id = $1`,
      [dealId],
    );

    let grossAmount: number;
    let platformFee: number;
    let netAmount:   number;

    if (escrowRows.length) {
      const e = escrowRows[0];
      grossAmount = Number(e.amount);
      platformFee = Number(e.platform_fee ?? 0);
      netAmount   = Number(e.seller_receive_amount) || (grossAmount - platformFee);
    } else {
      // Escrow row not yet created — calculate conservatively from transaction
      grossAmount = Number(tx.paid_amount ?? tx.price);
      platformFee = Math.round(grossAmount * PLATFORM_FEE_RATE * 100) / 100;
      netAmount   = Math.round((grossAmount - platformFee) * 100) / 100;
    }

    // ── 3. Find seller's default payout method ────────────────────────────────
    // payout_method_id is nullable: seller may not have configured one yet.
    const { rows: methodRows } = await pool.query(
      `SELECT id FROM seller_payout_methods
       WHERE user_id = $1 AND is_default = TRUE
       LIMIT 1`,
      [tx.seller_id],
    );
    const payoutMethodId: string | null = methodRows.length ? methodRows[0].id : null;

    // ── 4. Insert payout record (idempotent) ──────────────────────────────────
    const { rowCount } = await pool.query(
      `INSERT INTO payouts
         (deal_id, seller_id, gross_amount, platform_fee, net_amount,
          payout_method_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'ready')
       ON CONFLICT (deal_id) DO NOTHING`,
      [dealId, tx.seller_id, grossAmount, platformFee, netAmount, payoutMethodId],
    );

    if ((rowCount ?? 0) > 0) {
      logger.info(
        { dealId, sellerId: tx.seller_id, grossAmount, platformFee, netAmount, payoutMethodId },
        "payout.service: payout record created (status=ready)",
      );
    } else {
      logger.info(
        { dealId },
        "payout.service: payout record already exists — idempotent skip",
      );
    }
  } catch (err) {
    // Never propagate — the caller's main flow must not fail because of this
    logger.error({ err, dealId }, "payout.service: createPayoutRecord failed (non-fatal)");
  }
}
