/**
 * payout-methods.ts — Seller Payout Method management
 *
 * Sellers store the bank/wallet/crypto details they want the platform to use
 * when paying them out. Account details are encrypted at rest with the same
 * AES-256-GCM system used for the digital vault (VAULT_ENCRYPTION_KEY).
 *
 * Endpoints (all require seller auth):
 *   GET    /my/payout-methods              — list own methods (no decrypted data)
 *   POST   /my/payout-methods              — add new method
 *   PUT    /my/payout-methods/:id          — update method
 *   DELETE /my/payout-methods/:id          — delete method
 *   PATCH  /my/payout-methods/:id/set-default — make method the default
 *
 * Security:
 *   - Decrypted account details are NEVER returned from any seller endpoint.
 *   - Decryption only happens in admin-only GET /admin/payouts/:id (payouts.ts).
 *   - is_default enforcement: setting a new default unsets all others atomically.
 */

import { Router, json } from "express";
import { z }            from "zod";
import { requireAuth }  from "../middlewares/requireAuth";
import { pool }         from "../lib/pg-pool";
import { logger }       from "../lib/logger";
import {
  encryptVault,
  isVaultKeyReady,
} from "../lib/vault-crypto";

const router = Router();
router.use(json({ limit: "32kb" }));

// ── Guard ─────────────────────────────────────────────────────────────────────

function assertKeyReady(res: any): boolean {
  if (!isVaultKeyReady()) {
    res.status(503).json({
      error:   "VAULT_UNAVAILABLE",
      message: "Encryption key is not configured. Payout method management is temporarily unavailable.",
    });
    return false;
  }
  return true;
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const ALLOWED_METHOD_TYPES = [
  "bank_transfer",
  "paypal",
  "crypto",
  "vodafone_cash",
  "wise",
  "western_union",
  "other",
] as const;

const upsertSchema = z.object({
  method_type:      z.enum(ALLOWED_METHOD_TYPES),
  account_details:  z.string().min(1).max(5000),
  is_default:       z.boolean().optional().default(true),
});

// ── Safe shape: never include encrypted fields in responses ───────────────────

function safeShape(row: any) {
  return {
    id:          row.id,
    user_id:     row.user_id,
    method_type: row.method_type,
    is_default:  row.is_default,
    created_at:  row.created_at,
    updated_at:  row.updated_at,
    // account_details_encrypted and account_details_iv intentionally excluded
  };
}

// ── GET /my/payout-methods ────────────────────────────────────────────────────

router.get("/my/payout-methods", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  try {
    const { rows } = await pool.query(
      `SELECT id, user_id, method_type, is_default, created_at, updated_at
       FROM seller_payout_methods
       WHERE user_id = $1
       ORDER BY is_default DESC, created_at ASC`,
      [userId],
    );
    res.json({ payout_methods: rows.map(safeShape) });
  } catch (err) {
    logger.error({ err, userId }, "GET /my/payout-methods failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load payout methods." });
  }
});

// ── POST /my/payout-methods ───────────────────────────────────────────────────

router.post("/my/payout-methods", requireAuth, async (req, res) => {
  if (!assertKeyReady(res)) return;

  const userId = req.user!.id;
  const body = upsertSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "INVALID_BODY", details: body.error.flatten() });
    return;
  }

  const { method_type, account_details, is_default } = body.data;
  const { ciphertext, iv } = encryptVault(account_details);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // If this method should be default, unset all existing defaults first
    if (is_default) {
      await client.query(
        `UPDATE seller_payout_methods SET is_default = FALSE WHERE user_id = $1`,
        [userId],
      );
    }

    const { rows } = await client.query(
      `INSERT INTO seller_payout_methods
         (user_id, method_type, account_details_encrypted, account_details_iv, is_default)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, method_type, is_default, created_at, updated_at`,
      [userId, method_type, ciphertext, iv, is_default],
    );

    await client.query("COMMIT");

    logger.info({ userId, methodType: method_type, isDefault: is_default }, "POST /my/payout-methods: method added");
    res.status(201).json({ payout_method: safeShape(rows[0]) });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err, userId }, "POST /my/payout-methods failed");
    res.status(500).json({ error: "CREATE_FAILED", message: "Could not add payout method." });
  } finally {
    client.release();
  }
});

// ── PUT /my/payout-methods/:id ────────────────────────────────────────────────

router.put("/my/payout-methods/:id", requireAuth, async (req, res) => {
  if (!assertKeyReady(res)) return;

  const userId   = req.user!.id;
  const methodId = String(req.params["id"]);
  const body = upsertSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "INVALID_BODY", details: body.error.flatten() });
    return;
  }

  const { method_type, account_details, is_default } = body.data;
  const { ciphertext, iv } = encryptVault(account_details);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Verify ownership
    const { rows: existing } = await client.query(
      `SELECT id FROM seller_payout_methods WHERE id = $1 AND user_id = $2`,
      [methodId, userId],
    );
    if (!existing.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "NOT_FOUND", message: "Payout method not found." });
      return;
    }

    if (is_default) {
      await client.query(
        `UPDATE seller_payout_methods SET is_default = FALSE WHERE user_id = $1 AND id != $2`,
        [userId, methodId],
      );
    }

    const { rows } = await client.query(
      `UPDATE seller_payout_methods
       SET method_type               = $1,
           account_details_encrypted = $2,
           account_details_iv        = $3,
           is_default                = $4,
           updated_at                = NOW()
       WHERE id = $5 AND user_id = $6
       RETURNING id, user_id, method_type, is_default, created_at, updated_at`,
      [method_type, ciphertext, iv, is_default, methodId, userId],
    );

    await client.query("COMMIT");

    logger.info({ userId, methodId, methodType: method_type }, "PUT /my/payout-methods/:id: method updated");
    res.json({ payout_method: safeShape(rows[0]) });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err, userId, methodId }, "PUT /my/payout-methods/:id failed");
    res.status(500).json({ error: "UPDATE_FAILED", message: "Could not update payout method." });
  } finally {
    client.release();
  }
});

// ── DELETE /my/payout-methods/:id ────────────────────────────────────────────

router.delete("/my/payout-methods/:id", requireAuth, async (req, res) => {
  const userId   = req.user!.id;
  const methodId = String(req.params["id"]);

  try {
    const { rowCount } = await pool.query(
      `DELETE FROM seller_payout_methods WHERE id = $1 AND user_id = $2`,
      [methodId, userId],
    );

    if (!rowCount) {
      res.status(404).json({ error: "NOT_FOUND", message: "Payout method not found." });
      return;
    }

    logger.info({ userId, methodId }, "DELETE /my/payout-methods/:id: method deleted");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userId, methodId }, "DELETE /my/payout-methods/:id failed");
    res.status(500).json({ error: "DELETE_FAILED", message: "Could not delete payout method." });
  }
});

// ── PATCH /my/payout-methods/:id/set-default ─────────────────────────────────

router.patch("/my/payout-methods/:id/set-default", requireAuth, async (req, res) => {
  const userId   = req.user!.id;
  const methodId = String(req.params["id"]);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: existing } = await client.query(
      `SELECT id FROM seller_payout_methods WHERE id = $1 AND user_id = $2`,
      [methodId, userId],
    );
    if (!existing.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "NOT_FOUND", message: "Payout method not found." });
      return;
    }

    // Unset all existing defaults, then set the target
    await client.query(
      `UPDATE seller_payout_methods SET is_default = FALSE WHERE user_id = $1`,
      [userId],
    );
    const { rows } = await client.query(
      `UPDATE seller_payout_methods
       SET is_default = TRUE, updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, method_type, is_default, created_at, updated_at`,
      [methodId, userId],
    );

    await client.query("COMMIT");

    logger.info({ userId, methodId }, "PATCH /my/payout-methods/:id/set-default: default updated");
    res.json({ payout_method: safeShape(rows[0]) });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err, userId, methodId }, "PATCH /my/payout-methods/:id/set-default failed");
    res.status(500).json({ error: "UPDATE_FAILED", message: "Could not update default payout method." });
  } finally {
    client.release();
  }
});

export default router;
