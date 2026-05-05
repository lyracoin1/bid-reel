/**
 * payouts.ts — Manual Payout System
 *
 * The platform holds buyer payments, takes a 3% fee, and manually pays sellers
 * via their configured payout method. All payouts are tracked and auditable.
 *
 * Admin endpoints (requireAuth + requireAdmin):
 *   GET  /admin/payouts               — list all payouts (filter by status)
 *   GET  /admin/payouts/:id           — full payout details + decrypted payout method (audited)
 *   POST /admin/payouts/:id/process   — status → 'processing', assign admin
 *   POST /admin/payouts/:id/complete  — status → 'paid', requires external_reference
 *   POST /admin/payouts/:id/cancel    — status → 'cancelled' (before 'paid' only)
 *
 * Seller endpoints (requireAuth, caller must be the payout's seller):
 *   GET  /my/payouts                  — list own payouts (safe — no decrypted data)
 *
 * Security:
 *   - Decrypted account details are ONLY returned from GET /admin/payouts/:id.
 *   - Every admin decrypt is audit-logged (last_admin_view_at + last_admin_view_by
 *     on the seller_payout_methods row + server INFO log).
 *   - No payout state can be set to 'paid' without an external_reference (transfer ID).
 *   - Payouts in 'paid' status cannot be cancelled.
 *   - All state transitions are protected by status guards.
 *
 * Payout lifecycle:
 *   ready → processing → paid
 *                     ↘ cancelled  (any status before 'paid')
 */

import { Router, json } from "express";
import { z }            from "zod";
import { requireAuth }  from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { pool }         from "../lib/pg-pool";
import { logger }       from "../lib/logger";
import {
  decryptVault,
  isVaultKeyReady,
} from "../lib/vault-crypto";

const router = Router();
router.use(json({ limit: "32kb" }));

// ── Schemas ───────────────────────────────────────────────────────────────────

const completeSchema = z.object({
  external_reference: z.string().min(1).max(500),
  admin_note:         z.string().max(2000).optional(),
});

const cancelSchema = z.object({
  admin_note: z.string().max(2000).optional(),
});

// ── Safe payout shape (no encrypted data) ────────────────────────────────────

function safePayoutShape(row: any) {
  return {
    id:                 row.id,
    deal_id:            row.deal_id,
    seller_id:          row.seller_id,
    gross_amount:       Number(row.gross_amount),
    platform_fee:       Number(row.platform_fee),
    net_amount:         Number(row.net_amount),
    payout_method_id:   row.payout_method_id ?? null,
    status:             row.status,
    admin_id:           row.admin_id ?? null,
    admin_note:         row.admin_note ?? null,
    external_reference: row.external_reference ?? null,
    created_at:         row.created_at,
    paid_at:            row.paid_at ?? null,
  };
}

// ── GET /admin/payouts ────────────────────────────────────────────────────────
// List all payouts. Optional ?status= filter (comma-separated values allowed).

router.get("/admin/payouts", requireAuth, requireAdmin, async (req, res) => {
  try {
    const statusParam = typeof req.query["status"] === "string" ? req.query["status"] : null;
    const validStatuses = ["pending", "ready", "processing", "paid", "cancelled"];

    let query: string;
    let params: any[];

    if (statusParam) {
      const requested = statusParam.split(",").map(s => s.trim()).filter(s => validStatuses.includes(s));
      if (!requested.length) {
        res.status(400).json({ error: "INVALID_STATUS", message: `status must be one of: ${validStatuses.join(", ")}` });
        return;
      }
      query  = `SELECT * FROM payouts WHERE status = ANY($1) ORDER BY created_at DESC`;
      params = [requested];
    } else {
      query  = `SELECT * FROM payouts ORDER BY created_at DESC`;
      params = [];
    }

    const { rows } = await pool.query(query, params);
    res.json({ payouts: rows.map(safePayoutShape) });
  } catch (err) {
    logger.error({ err }, "GET /admin/payouts failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load payouts." });
  }
});

// ── GET /admin/payouts/:id ────────────────────────────────────────────────────
// Full payout details. Decrypts the seller's payout method when present.
// Every access is audit-logged (last_admin_view_at + last_admin_view_by + logger).

router.get("/admin/payouts/:id", requireAuth, requireAdmin, async (req, res) => {
  const adminId  = req.user!.id;
  const payoutId = String(req.params["id"]);

  try {
    // Load payout row
    const { rows: payoutRows } = await pool.query(
      `SELECT * FROM payouts WHERE id = $1`,
      [payoutId],
    );

    if (!payoutRows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Payout not found." });
      return;
    }

    const payout = payoutRows[0];
    let payout_method: Record<string, any> | null = null;

    // Decrypt payout method if present and key is ready
    if (payout.payout_method_id) {
      const { rows: methodRows } = await pool.query(
        `SELECT id, user_id, method_type, account_details_encrypted, account_details_iv,
                is_default, created_at, updated_at
         FROM seller_payout_methods WHERE id = $1`,
        [payout.payout_method_id],
      );

      if (methodRows.length) {
        const method = methodRows[0];
        let decrypted_account_details: string | null = null;

        if (isVaultKeyReady() && method.account_details_encrypted && method.account_details_iv) {
          try {
            // Decrypt — result must NEVER be logged
            decrypted_account_details = decryptVault(
              method.account_details_encrypted,
              method.account_details_iv,
            );
          } catch (decryptErr) {
            logger.error({ decryptErr, methodId: method.id }, "GET /admin/payouts/:id: decrypt failed");
            decrypted_account_details = null;
          }
        } else if (!isVaultKeyReady()) {
          logger.warn({ payoutId, methodId: method.id }, "GET /admin/payouts/:id: vault key not ready — account details not decrypted");
        }

        payout_method = {
          id:                      method.id,
          user_id:                 method.user_id,
          method_type:             method.method_type,
          decrypted_account_details,  // null if key unavailable or decrypt failed
          is_default:              method.is_default,
          created_at:              method.created_at,
          updated_at:              method.updated_at,
        };

        // Audit log: stamp last access on the method row
        await pool.query(
          `UPDATE seller_payout_methods
           SET last_admin_view_at = NOW(), last_admin_view_by = $1
           WHERE id = $2`,
          [adminId, method.id],
        ).catch(auditErr =>
          logger.warn({ auditErr, methodId: method.id }, "GET /admin/payouts/:id: audit stamp failed (non-fatal)"),
        );

        logger.info(
          {
            adminId,
            payoutId,
            dealId:   payout.deal_id,
            sellerId: payout.seller_id,
            methodId: method.id,
            decryptSucceeded: decrypted_account_details !== null,
          },
          "admin/payouts/:id: payout method decrypted and access audited",
        );
      }
    }

    res.json({
      payout:        safePayoutShape(payout),
      payout_method,
    });
  } catch (err) {
    logger.error({ err, payoutId, adminId }, "GET /admin/payouts/:id failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load payout." });
  }
});

// ── POST /admin/payouts/:id/process ──────────────────────────────────────────
// Admin marks payout as 'processing' and assigns themselves as the responsible admin.
// Allowed from: 'ready'

router.post("/admin/payouts/:id/process", requireAuth, requireAdmin, async (req, res) => {
  const adminId  = req.user!.id;
  const payoutId = String(req.params["id"]);

  try {
    const { rows: existing } = await pool.query(
      `SELECT id, status FROM payouts WHERE id = $1`,
      [payoutId],
    );

    if (!existing.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Payout not found." });
      return;
    }

    const current = existing[0];
    if (current.status !== "ready") {
      res.status(409).json({
        error:          "INVALID_STATUS_TRANSITION",
        message:        `Cannot mark as 'processing' — payout is currently '${current.status}'. Expected 'ready'.`,
        current_status: current.status,
      });
      return;
    }

    const { rows } = await pool.query(
      `UPDATE payouts
       SET status   = 'processing',
           admin_id = $1
       WHERE id = $2 AND status = 'ready'
       RETURNING *`,
      [adminId, payoutId],
    );

    if (!rows.length) {
      res.status(409).json({ error: "CONCURRENT_UPDATE", message: "Payout status changed concurrently." });
      return;
    }

    logger.info({ payoutId, adminId, dealId: rows[0].deal_id }, "admin/payouts/:id/process: payout processing started");
    res.json({ payout: safePayoutShape(rows[0]) });
  } catch (err) {
    logger.error({ err, payoutId, adminId }, "POST /admin/payouts/:id/process failed");
    res.status(500).json({ error: "UPDATE_FAILED", message: "Could not update payout." });
  }
});

// ── POST /admin/payouts/:id/complete ─────────────────────────────────────────
// Admin marks payout as 'paid'. Requires external_reference (transfer ID / receipt).
// Allowed from: 'processing'

router.post("/admin/payouts/:id/complete", requireAuth, requireAdmin, async (req, res) => {
  const adminId  = req.user!.id;
  const payoutId = String(req.params["id"]);

  const body = completeSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "INVALID_BODY", details: body.error.flatten() });
    return;
  }

  const { external_reference, admin_note } = body.data;

  try {
    const { rows: existing } = await pool.query(
      `SELECT id, status FROM payouts WHERE id = $1`,
      [payoutId],
    );

    if (!existing.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Payout not found." });
      return;
    }

    const current = existing[0];
    if (current.status !== "processing") {
      res.status(409).json({
        error:          "INVALID_STATUS_TRANSITION",
        message:        `Cannot complete — payout is currently '${current.status}'. Expected 'processing'.`,
        current_status: current.status,
      });
      return;
    }

    const { rows } = await pool.query(
      `UPDATE payouts
       SET status             = 'paid',
           paid_at            = NOW(),
           admin_id           = $1,
           external_reference = $2,
           admin_note         = $3
       WHERE id = $4 AND status = 'processing'
       RETURNING *`,
      [adminId, external_reference, admin_note ?? null, payoutId],
    );

    if (!rows.length) {
      res.status(409).json({ error: "CONCURRENT_UPDATE", message: "Payout status changed concurrently." });
      return;
    }

    logger.info(
      { payoutId, adminId, dealId: rows[0].deal_id, external_reference },
      "admin/payouts/:id/complete: payout marked as paid",
    );
    res.json({ payout: safePayoutShape(rows[0]) });
  } catch (err) {
    logger.error({ err, payoutId, adminId }, "POST /admin/payouts/:id/complete failed");
    res.status(500).json({ error: "UPDATE_FAILED", message: "Could not complete payout." });
  }
});

// ── POST /admin/payouts/:id/cancel ────────────────────────────────────────────
// Admin cancels a payout. Not allowed once the payout is 'paid'.

router.post("/admin/payouts/:id/cancel", requireAuth, requireAdmin, async (req, res) => {
  const adminId  = req.user!.id;
  const payoutId = String(req.params["id"]);

  const body = cancelSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "INVALID_BODY", details: body.error.flatten() });
    return;
  }

  try {
    const { rows: existing } = await pool.query(
      `SELECT id, status FROM payouts WHERE id = $1`,
      [payoutId],
    );

    if (!existing.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Payout not found." });
      return;
    }

    const current = existing[0];

    if (current.status === "paid") {
      res.status(409).json({
        error:   "ALREADY_PAID",
        message: "Cannot cancel a payout that has already been paid.",
      });
      return;
    }

    if (current.status === "cancelled") {
      res.status(409).json({
        error:   "ALREADY_CANCELLED",
        message: "Payout is already cancelled.",
      });
      return;
    }

    const { rows } = await pool.query(
      `UPDATE payouts
       SET status     = 'cancelled',
           admin_id   = $1,
           admin_note = $2
       WHERE id = $3 AND status != 'paid'
       RETURNING *`,
      [adminId, body.data.admin_note ?? null, payoutId],
    );

    if (!rows.length) {
      res.status(409).json({ error: "CONCURRENT_UPDATE", message: "Payout status changed concurrently." });
      return;
    }

    logger.info(
      { payoutId, adminId, dealId: rows[0].deal_id, previousStatus: current.status },
      "admin/payouts/:id/cancel: payout cancelled",
    );
    res.json({ payout: safePayoutShape(rows[0]) });
  } catch (err) {
    logger.error({ err, payoutId, adminId }, "POST /admin/payouts/:id/cancel failed");
    res.status(500).json({ error: "UPDATE_FAILED", message: "Could not cancel payout." });
  }
});

// ── GET /my/payouts ───────────────────────────────────────────────────────────
// Seller sees their own payouts — amounts, status, timestamps.
// Decrypted account details are NOT included.

router.get("/my/payouts", requireAuth, async (req, res) => {
  const sellerId = req.user!.id;
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.deal_id, p.seller_id, p.gross_amount, p.platform_fee,
              p.net_amount, p.status, p.external_reference, p.created_at, p.paid_at,
              -- Include payout method type only (never the encrypted account details)
              pm.method_type AS payout_method_type
       FROM payouts p
       LEFT JOIN seller_payout_methods pm ON pm.id = p.payout_method_id
       WHERE p.seller_id = $1
       ORDER BY p.created_at DESC`,
      [sellerId],
    );

    res.json({
      payouts: rows.map(row => ({
        id:                  row.id,
        deal_id:             row.deal_id,
        gross_amount:        Number(row.gross_amount),
        platform_fee:        Number(row.platform_fee),
        net_amount:          Number(row.net_amount),
        status:              row.status,
        // external_reference intentionally omitted — for admin visibility only
        payout_method_type:  row.payout_method_type ?? null,
        created_at:          row.created_at,
        paid_at:             row.paid_at ?? null,
      })),
    });
  } catch (err) {
    logger.error({ err, sellerId }, "GET /my/payouts failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load payouts." });
  }
});

export default router;
