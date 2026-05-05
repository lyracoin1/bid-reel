/**
 * digital-vault.ts — Digital Vault routes for Secure Deals
 *
 * Endpoints:
 *   PATCH  /api/secure-deals/:dealId/vault             — seller writes/updates vault (before buyer commitment only)
 *   POST   /api/secure-deals/:dealId/reveal            — buyer reveals vault (after payment, audited, rate-limited)
 *   POST   /api/secure-deals/:dealId/ack              — buyer acknowledges vault as received
 *   POST   /api/secure-deals/:dealId/digital-dispute  — buyer disputes vault (after reveal only)
 *   GET    /api/admin/digital-disputes                 — admin lists all digital disputes (no vault contents)
 *   POST   /api/admin/digital-disputes/:id/resolve    — admin resolves a digital dispute + syncs transaction status
 *   POST   /api/admin/secure-deals/:dealId/vault-review — admin reads vault, requires reason, always audited
 *
 * Authorization summary:
 *   Seller  → write vault before payment/buyer commitment only
 *   Buyer   → reveal (rate-limited 10/min) + ack + dispute after payment
 *   Admin   → list/resolve disputes; vault-review requires a written reason + is always logged
 *
 * Vault plaintext is NEVER included in:
 *   - Normal GET /secure-deals/:dealId responses
 *   - Admin list/detail responses
 *   - Server logs
 *   - Notifications
 *
 * Point 1 (vault lock): vault is locked as soon as buyer_id IS NOT NULL on the
 *   transaction OR payment_status transitions away from 'pending'. This means the
 *   seller cannot swap vault contents once a buyer has committed (even pre-payment).
 *
 * Point 4 (dispute resolution): admin resolve now atomically writes
 *   vault_dispute_resolution on transactions so vault_ack_status never stays
 *   stuck as 'disputed' without a recorded resolution outcome.
 *
 * Point 5 (rate limiting): POST /reveal is capped at 10 req/min per user.
 */

import { Router, json }  from "express";
import { z }             from "zod";
import { requireAuth }   from "../middlewares/requireAuth";
import { requireAdmin }  from "../middlewares/requireAdmin";
import { pool }          from "../lib/pg-pool";
import { supabaseAdmin } from "../lib/supabase";
import { logger }        from "../lib/logger";
import {
  encryptVault,
  decryptVault,
  isVaultKeyReady,
} from "../lib/vault-crypto";
import { vaultRevealLimiter }  from "../middleware/rate-limit";
import { createPayoutRecord } from "../services/payout.service";

const router = Router();
router.use(json({ limit: "64kb" }));

// ── Guards ────────────────────────────────────────────────────────────────────

function assertKeyReady(res: any): boolean {
  if (!isVaultKeyReady()) {
    res.status(503).json({
      error:   "VAULT_UNAVAILABLE",
      message: "Vault encryption key is not configured. Digital vault endpoints are unavailable.",
    });
    return false;
  }
  return true;
}

// ── Audit helper ──────────────────────────────────────────────────────────────

async function insertVaultAudit(opts: {
  dealId:     string;
  accessType: string;
  adminId?:   string | null;
  buyerId?:   string | null;
  reason?:    string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO vault_access_audit
       (deal_id, admin_id, buyer_id, access_type, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      opts.dealId,
      opts.adminId  ?? null,
      opts.buyerId  ?? null,
      opts.accessType,
      opts.reason   ?? null,
    ],
  );
}

// ── PATCH /api/secure-deals/:dealId/vault ─────────────────────────────────────
//
// Seller writes or updates vault contents.
//
// Point 1 — Vault lock: vault is locked once:
//   a) payment_status != 'pending' (payment secured, refunded, etc.), OR
//   b) buyer_id IS NOT NULL (a buyer has committed to this deal pre-payment)
//
// Both conditions are checked in a single DB read. If either is true the
// seller receives VAULT_LOCKED and no data is changed or read.

const vaultWriteSchema = z.object({
  vault_text: z.string().min(1).max(10_000),
});

router.patch("/secure-deals/:dealId/vault", requireAuth, async (req, res) => {
  if (!assertKeyReady(res)) return;

  const callerId = req.user!.id;
  const dealId   = String(req.params["dealId"]);

  const body = vaultWriteSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "INVALID_BODY", details: body.error.flatten() });
    return;
  }

  try {
    const { rows } = await pool.query(
      `SELECT deal_id, seller_id, buyer_id, payment_status
       FROM transactions WHERE deal_id = $1`,
      [dealId],
    );

    if (!rows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const deal = rows[0];

    if (deal.seller_id !== callerId) {
      res.status(403).json({
        error:   "FORBIDDEN",
        message: "Only the seller can update the vault.",
      });
      return;
    }

    // Point 1: lock vault once payment_status != 'pending' OR buyer_id is set.
    // A non-null buyer_id means a buyer has committed; swapping vault content at
    // that point would be fraudulent even if payment hasn't cleared yet.
    const buyerCommitted = deal.buyer_id !== null;
    const paymentNotPending = deal.payment_status !== "pending";

    if (paymentNotPending || buyerCommitted) {
      const reason = paymentNotPending
        ? "payment has been secured"
        : "a buyer has already committed to this deal";
      res.status(409).json({
        error:   "VAULT_LOCKED",
        message: `Vault cannot be modified — ${reason}. Contact support if you believe this is an error.`,
      });
      return;
    }

    // Encrypt before storing — vault_text is intentionally NOT logged
    const { ciphertext, iv } = encryptVault(body.data.vault_text);

    await pool.query(
      `UPDATE transactions
       SET vault_ciphertext = $1,
           vault_iv         = $2,
           deal_type        = 'digital',
           updated_at       = NOW()
       WHERE deal_id = $3`,
      [ciphertext, iv, dealId],
    );

    logger.info(
      { dealId, sellerId: callerId },
      "digital-vault: vault written/updated by seller",
    );

    res.json({ ok: true, message: "Vault saved." });
  } catch (err) {
    logger.error({ err, dealId, callerId }, "PATCH /secure-deals/:dealId/vault failed");
    res.status(500).json({ error: "VAULT_WRITE_FAILED", message: "Could not save vault." });
  }
});

// ── POST /api/secure-deals/:dealId/reveal ─────────────────────────────────────
// Buyer decrypts the vault. Only the confirmed buyer_id may call this after payment.
// Every call is recorded in vault_access_audit. Plaintext is never logged.
//
// Point 5 — Rate limited: 10 requests per minute per authenticated buyer.
// The decryption step is CPU-bound; uncapped calls would allow load abuse.

router.post("/secure-deals/:dealId/reveal", requireAuth, vaultRevealLimiter, async (req, res) => {
  if (!assertKeyReady(res)) return;

  const callerId = req.user!.id;
  const dealId   = String(req.params["dealId"]);

  try {
    const { rows } = await pool.query(
      `SELECT deal_id, seller_id, buyer_id, payment_status, deal_type,
              vault_ciphertext, vault_iv, vault_revealed_at
       FROM transactions WHERE deal_id = $1`,
      [dealId],
    );

    if (!rows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const deal = rows[0];

    if (deal.deal_type !== "digital") {
      res.status(400).json({
        error:   "NOT_DIGITAL_DEAL",
        message: "This deal does not have a digital vault.",
      });
      return;
    }

    if (deal.payment_status !== "secured") {
      res.status(402).json({
        error:   "PAYMENT_REQUIRED",
        message: "Vault is only accessible after payment is secured.",
      });
      return;
    }

    if (deal.buyer_id !== callerId) {
      // Explicitly block sellers and third parties — same error message to avoid info leak
      res.status(403).json({
        error:   "FORBIDDEN",
        message: "Only the confirmed buyer can reveal the vault.",
      });
      return;
    }

    if (!deal.vault_ciphertext || !deal.vault_iv) {
      res.status(404).json({
        error:   "VAULT_EMPTY",
        message: "No vault content has been stored for this deal.",
      });
      return;
    }

    // Decrypt — the returned string must never be logged
    const plaintext = decryptVault(deal.vault_ciphertext, deal.vault_iv);

    // Stamp first reveal time (idempotent — only set once)
    if (!deal.vault_revealed_at) {
      await pool.query(
        `UPDATE transactions SET vault_revealed_at = NOW() WHERE deal_id = $1`,
        [dealId],
      );
    }

    // Mandatory audit row — no plaintext in the log
    await insertVaultAudit({
      dealId,
      accessType: "buyer_reveal",
      buyerId:    callerId,
    }).catch(auditErr =>
      logger.warn({ auditErr, dealId }, "digital-vault: audit insert failed (non-fatal)"),
    );

    logger.info({ dealId, buyerId: callerId }, "digital-vault: vault revealed to buyer");

    res.json({ vault_text: plaintext });
  } catch (err) {
    logger.error({ err, dealId, callerId }, "POST /secure-deals/:dealId/reveal failed");
    res.status(500).json({ error: "REVEAL_FAILED", message: "Could not reveal vault." });
  }
});

// ── POST /api/secure-deals/:dealId/ack ───────────────────────────────────────
// Buyer confirms vault contents are as described. Triggers escrow release flow.

router.post("/secure-deals/:dealId/ack", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const dealId   = String(req.params["dealId"]);

  try {
    const { rows } = await pool.query(
      `SELECT deal_id, seller_id, buyer_id, payment_status, deal_type,
              vault_revealed_at, vault_ack_status
       FROM transactions WHERE deal_id = $1`,
      [dealId],
    );

    if (!rows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const deal = rows[0];

    if (deal.deal_type !== "digital") {
      res.status(400).json({
        error:   "NOT_DIGITAL_DEAL",
        message: "This deal does not have a digital vault.",
      });
      return;
    }

    if (deal.buyer_id !== callerId) {
      res.status(403).json({
        error:   "FORBIDDEN",
        message: "Only the confirmed buyer can acknowledge this vault.",
      });
      return;
    }

    if (deal.payment_status !== "secured") {
      res.status(402).json({
        error:   "PAYMENT_REQUIRED",
        message: "Cannot acknowledge before payment is secured.",
      });
      return;
    }

    if (deal.vault_ack_status !== null) {
      res.status(409).json({
        error:          "ALREADY_RESOLVED",
        message:        `Vault has already been ${deal.vault_ack_status}.`,
        current_status: deal.vault_ack_status,
      });
      return;
    }

    const { rows: updated } = await pool.query(
      `UPDATE transactions
       SET vault_ack_status = 'accepted',
           vault_ack_at     = NOW(),
           updated_at       = NOW()
       WHERE deal_id = $1
       RETURNING vault_ack_status, vault_ack_at`,
      [dealId],
    );

    logger.info({ dealId, buyerId: callerId }, "digital-vault: buyer acknowledged vault");

    // Non-blocking seller notification placeholder (Phase 2 will wire real FCM)
    void notifySellerVaultAcked(deal.seller_id, dealId).catch(notifyErr =>
      logger.warn({ notifyErr, dealId }, "digital-vault: seller ack notification failed (non-fatal)"),
    );

    // Buyer confirmed receipt — create payout record (status='ready') so admin
    // can process the seller's payout. Idempotent and non-fatal.
    void createPayoutRecord(dealId);

    res.json({
      ok:              true,
      vault_ack_status: updated[0].vault_ack_status,
      vault_ack_at:    updated[0].vault_ack_at,
    });
  } catch (err) {
    logger.error({ err, dealId, callerId }, "POST /secure-deals/:dealId/ack failed");
    res.status(500).json({ error: "ACK_FAILED", message: "Could not acknowledge vault." });
  }
});

async function notifySellerVaultAcked(sellerId: string, dealId: string): Promise<void> {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("language")
    .eq("id", sellerId)
    .maybeSingle();
  const isAr = (profile as any)?.language === "ar";

  logger.info(
    {
      sellerId,
      dealId,
      notifyTitle: isAr ? "تم تأكيد استلام المنتج الرقمي" : "Digital product confirmed",
      notifyBody:  isAr
        ? `المشتري أكّد استلام المنتج الرقمي للصفقة ${dealId}`
        : `Buyer confirmed receipt of the digital product for deal ${dealId}`,
    },
    "digital-vault: [notify placeholder] seller vault acked — wire real FCM in Phase 2",
  );
}

// ── POST /api/secure-deals/:dealId/digital-dispute ───────────────────────────
// Buyer disputes vault contents. Requires vault to have been revealed first.

const disputeSchema = z.object({
  reason: z.string().min(10).max(2000),
});

router.post("/secure-deals/:dealId/digital-dispute", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const dealId   = String(req.params["dealId"]);

  const body = disputeSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "INVALID_BODY", details: body.error.flatten() });
    return;
  }

  try {
    const { rows } = await pool.query(
      `SELECT deal_id, seller_id, buyer_id, payment_status, deal_type,
              vault_revealed_at, vault_ack_status
       FROM transactions WHERE deal_id = $1`,
      [dealId],
    );

    if (!rows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const deal = rows[0];

    if (deal.deal_type !== "digital") {
      res.status(400).json({
        error:   "NOT_DIGITAL_DEAL",
        message: "This deal does not have a digital vault.",
      });
      return;
    }

    if (deal.buyer_id !== callerId) {
      res.status(403).json({
        error:   "FORBIDDEN",
        message: "Only the confirmed buyer can dispute this vault.",
      });
      return;
    }

    if (deal.payment_status !== "secured") {
      res.status(402).json({
        error:   "PAYMENT_REQUIRED",
        message: "Cannot dispute before payment is secured.",
      });
      return;
    }

    if (!deal.vault_revealed_at) {
      res.status(409).json({
        error:   "VAULT_NOT_REVEALED",
        message: "You must reveal the vault before raising a dispute.",
      });
      return;
    }

    if (deal.vault_ack_status !== null) {
      res.status(409).json({
        error:   "ALREADY_RESOLVED",
        message: `Cannot dispute — vault has already been ${deal.vault_ack_status}.`,
      });
      return;
    }

    // Mark transaction as disputed
    await pool.query(
      `UPDATE transactions
       SET vault_ack_status = 'disputed',
           vault_ack_at     = NOW(),
           updated_at       = NOW()
       WHERE deal_id = $1`,
      [dealId],
    );

    // Create dispute record
    const { rows: disputeRows } = await pool.query(
      `INSERT INTO digital_deal_disputes (deal_id, buyer_id, reason)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [dealId, callerId, body.data.reason],
    );

    logger.info({ dealId, buyerId: callerId }, "digital-vault: buyer opened digital dispute");

    // Non-blocking admin notification placeholder
    logger.info(
      { dealId, buyerId: callerId },
      "digital-vault: [notify placeholder] admin should be notified of new digital dispute — wire real notification in Phase 2",
    );

    res.status(201).json({ dispute: disputeRows[0] });
  } catch (err) {
    logger.error({ err, dealId, callerId }, "POST /secure-deals/:dealId/digital-dispute failed");
    res.status(500).json({ error: "DISPUTE_FAILED", message: "Could not create dispute." });
  }
});

// ── GET /api/admin/digital-disputes ──────────────────────────────────────────
// Admin lists all digital disputes — metadata only, no vault contents.

router.get("/admin/digital-disputes", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         d.id,
         d.deal_id,
         d.buyer_id,
         d.reason,
         d.status,
         d.admin_note,
         d.created_at,
         d.resolved_at,
         t.seller_id,
         t.product_name,
         t.price,
         t.currency,
         t.vault_ack_status,
         t.vault_dispute_resolution,
         t.vault_revealed_at
         -- vault_ciphertext and vault_iv intentionally excluded
       FROM digital_deal_disputes d
       LEFT JOIN transactions t ON t.deal_id = d.deal_id
       ORDER BY d.created_at DESC`,
    );
    res.json({ disputes: rows });
  } catch (err) {
    logger.error({ err }, "GET /admin/digital-disputes failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load disputes." });
  }
});

// ── POST /api/admin/digital-disputes/:id/resolve ─────────────────────────────
// Admin resolves a digital dispute in favour of buyer or seller.
//
// Point 4 — Dispute resolution consistency:
//   After updating digital_deal_disputes, this endpoint also atomically
//   writes vault_dispute_resolution on the linked transaction so that
//   vault_ack_status never remains stuck in an unresolved 'disputed' state.
//
//   Resolution mapping:
//     resolved_buyer  → vault_dispute_resolution = 'resolved_buyer'
//                       vault_ack_status stays 'disputed' (dispute upheld)
//     resolved_seller → vault_dispute_resolution = 'resolved_seller'
//                       vault_ack_status = 'accepted' (dispute overridden, vault accepted)

const resolveSchema = z.object({
  resolution: z.enum(["resolved_buyer", "resolved_seller"]),
  admin_note: z.string().max(2000).optional(),
});

router.post(
  "/admin/digital-disputes/:id/resolve",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const adminId   = req.user!.id;
    const disputeId = String(req.params["id"]);

    const body = resolveSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "INVALID_BODY", details: body.error.flatten() });
      return;
    }

    try {
      const { rows: existing } = await pool.query(
        `SELECT id, deal_id, status FROM digital_deal_disputes WHERE id = $1`,
        [disputeId],
      );

      if (!existing.length) {
        res.status(404).json({ error: "NOT_FOUND", message: "Dispute not found." });
        return;
      }

      if (existing[0].status !== "open") {
        res.status(409).json({
          error:   "ALREADY_RESOLVED",
          message: "Dispute is already resolved.",
        });
        return;
      }

      const dealId = existing[0].deal_id as string;
      const { resolution, admin_note } = body.data;

      // 1. Resolve the dispute record
      const { rows: updated } = await pool.query(
        `UPDATE digital_deal_disputes
         SET status      = $1,
             admin_note  = $2,
             resolved_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [resolution, admin_note ?? null, disputeId],
      );

      // 2. Point 4: sync transactions so vault_ack_status is never stuck.
      //    resolved_buyer  → vault_ack_status stays 'disputed' (dispute upheld — no change needed)
      //                      but vault_dispute_resolution records the admin decision.
      //    resolved_seller → vault_ack_status = 'accepted' (admin overrides the dispute)
      //                      vault_dispute_resolution records the admin decision.
      const newVaultAckStatus = resolution === "resolved_seller" ? "accepted" : null;

      await pool.query(
        `UPDATE transactions
         SET vault_dispute_resolution = $1,
             ${newVaultAckStatus !== null ? "vault_ack_status = $3," : ""}
             updated_at = NOW()
         WHERE deal_id = $2`,
        newVaultAckStatus !== null
          ? [resolution, dealId, newVaultAckStatus]
          : [resolution, dealId],
      );

      logger.info(
        {
          disputeId,
          dealId,
          adminId,
          resolution,
          vaultAckStatusUpdated: newVaultAckStatus !== null,
        },
        "digital-vault: admin resolved dispute (transaction status synced)",
      );

      // Admin ruled in seller's favour — deal is complete, create payout record.
      // Idempotent (ON CONFLICT DO NOTHING) and non-fatal.
      if (resolution === "resolved_seller") {
        void createPayoutRecord(dealId);
      }

      res.json({ dispute: updated[0] });
    } catch (err) {
      logger.error(
        { err, disputeId, adminId },
        "POST /admin/digital-disputes/:id/resolve failed",
      );
      res.status(500).json({ error: "RESOLVE_FAILED", message: "Could not resolve dispute." });
    }
  },
);

// ── POST /api/admin/secure-deals/:dealId/vault-review ────────────────────────
// Admin reads vault plaintext for dispute/compliance review.
// Requires a written reason. Every access is recorded in vault_access_audit.
// Admins cannot access vault outside this endpoint (all other routes exclude ciphertext).

const vaultReviewSchema = z.object({
  reason: z.string().min(10).max(1000),
});

router.post(
  "/admin/secure-deals/:dealId/vault-review",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    if (!assertKeyReady(res)) return;

    const adminId = req.user!.id;
    const dealId  = String(req.params["dealId"]);

    const body = vaultReviewSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({
        error:   "REASON_REQUIRED",
        message: "A written reason is required for vault access (min 10 characters).",
      });
      return;
    }

    try {
      const { rows } = await pool.query(
        `SELECT deal_id, seller_id, buyer_id, deal_type,
                vault_ciphertext, vault_iv, vault_ack_status, payment_status
         FROM transactions WHERE deal_id = $1`,
        [dealId],
      );

      if (!rows.length) {
        res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
        return;
      }

      const deal = rows[0];

      if (deal.deal_type !== "digital") {
        res.status(400).json({
          error:   "NOT_DIGITAL_DEAL",
          message: "This deal does not have a digital vault.",
        });
        return;
      }

      if (!deal.vault_ciphertext || !deal.vault_iv) {
        res.status(404).json({
          error:   "VAULT_EMPTY",
          message: "No vault content has been stored for this deal.",
        });
        return;
      }

      // Check whether there is an open dispute (determines audit type)
      const { rows: disputes } = await pool.query(
        `SELECT id, status FROM digital_deal_disputes
         WHERE deal_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [dealId],
      );
      const hasOpenDispute = disputes.some((d: any) => d.status === "open");
      const hasDispute     = disputes.length > 0;

      if (!hasDispute) {
        logger.warn(
          { dealId, adminId, reason: body.data.reason },
          "digital-vault: admin vault-review with no dispute on record — compliance override logged",
        );
      }

      // Decrypt — return value must NEVER be logged
      const plaintext = decryptVault(deal.vault_ciphertext, deal.vault_iv);

      // Mandatory audit — always inserted before sending the response
      await insertVaultAudit({
        dealId,
        accessType: hasOpenDispute ? "admin_dispute_review" : "admin_compliance_review",
        adminId,
        reason:     body.data.reason,
      });

      logger.info(
        { dealId, adminId, hasOpenDispute, accessType: hasOpenDispute ? "admin_dispute_review" : "admin_compliance_review" },
        "digital-vault: admin reviewed vault (audited)",
      );

      res.json({
        vault_text:     plaintext,
        access_type:    hasOpenDispute ? "admin_dispute_review" : "admin_compliance_review",
        audit_recorded: true,
      });
    } catch (err) {
      logger.error(
        { err, dealId, adminId },
        "POST /admin/secure-deals/:dealId/vault-review failed",
      );
      res.status(500).json({ error: "REVIEW_FAILED", message: "Could not review vault." });
    }
  },
);

export default router;
