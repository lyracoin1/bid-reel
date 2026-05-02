/**
 * payment-proof.ts — Buyer Payment Proof Upload for Secure Deals (Part #4)
 *
 * Endpoints:
 *   POST /api/payment-proof                — buyer uploads a proof file (raw binary body)
 *   GET  /api/payment-proof/:dealId        — fetch the current proof for a deal
 *   GET  /api/admin/payment-proofs         — list all proofs (admin only)
 *
 * Upload flow:
 *   • Client sends raw file bytes as the request body (same pattern as /api/media/upload).
 *   • Query params:  dealId, mimeType, fileName (URL-encoded original filename)
 *   • File is stored in R2 under  payment-proofs/{buyerId}/{uuid}.{ext}
 *   • DB row in payment_proofs is upserted (UNIQUE deal_id) — re-upload replaces.
 *   • Seller receives FCM push + in-app notification (non-fatal).
 *
 * Security:
 *   • buyer_id is always from the verified JWT — never from the request body.
 *   • The deal's seller cannot upload (403 SELLER_CANNOT_UPLOAD).
 *   • If the deal already has a buyer_id assigned (post-payment), only that buyer
 *     may upload (403 NOT_BUYER).
 *   • File type must be PDF, JPEG, PNG, or WebP.
 *   • File size must be ≤ 10 MB.
 */

import express, { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { pool } from "../lib/pg-pool";
import { r2Upload, R2_BUCKET } from "../lib/r2";
import { supabaseAdmin } from "../lib/supabase";
import { logger } from "../lib/logger";
import { createNotification } from "../lib/notifications";

const router: IRouter = Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_PROOF_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_PROOF_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const PROOF_MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg":       "jpg",
  "image/jpg":        "jpg",
  "image/png":        "png",
  "image/webp":       "webp",
};

function safeExt(mime: string): string {
  return PROOF_MIME_TO_EXT[mime] ?? "bin";
}

// ── POST /api/payment-proof ───────────────────────────────────────────────────
//
// Accepts a raw binary body. Query params: dealId, mimeType, fileName.
// Stores in R2, upserts a payment_proofs row, notifies the seller.

router.post(
  "/payment-proof",
  requireAuth,
  express.raw({ limit: "12mb", type: "*/*" }),
  async (req, res) => {
    const callerId = req.user!.id;
    const dealId   = String(req.query["dealId"] ?? "").trim();
    const rawMime  = String(req.query["mimeType"] ?? "").split(";")[0]?.trim() ?? "";
    const fileName = String(req.query["fileName"] ?? "proof").slice(0, 200);

    if (!dealId) {
      res.status(400).json({ error: "MISSING_DEAL_ID", message: "dealId query param is required." });
      return;
    }

    if (!ALLOWED_PROOF_TYPES.has(rawMime)) {
      res.status(400).json({
        error:   "INVALID_FILE_TYPE",
        message: `Unsupported file type "${rawMime}". Allowed: PDF, JPEG, PNG, WebP.`,
        allowed: [...ALLOWED_PROOF_TYPES],
      });
      return;
    }

    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "EMPTY_BODY", message: "Request body is empty." });
      return;
    }
    if (body.length > MAX_PROOF_BYTES) {
      res.status(400).json({
        error:   "FILE_TOO_LARGE",
        message: `File must be smaller than ${MAX_PROOF_BYTES / (1024 * 1024)} MB.`,
        maxBytes: MAX_PROOF_BYTES,
      });
      return;
    }

    try {
      // 1. Load deal
      const { rows: dealRows } = await pool.query(
        `SELECT deal_id, seller_id, buyer_id FROM transactions WHERE deal_id = $1`,
        [dealId],
      );
      if (!dealRows.length) {
        res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
        return;
      }

      const deal = dealRows[0];

      // 2. Seller cannot upload buyer's payment proof
      if (deal.seller_id === callerId) {
        res.status(403).json({
          error:   "SELLER_CANNOT_UPLOAD",
          message: "The seller cannot upload a payment proof for their own deal.",
        });
        return;
      }

      // 3. If deal already has an assigned buyer, only they may upload
      if (deal.buyer_id && deal.buyer_id !== callerId) {
        res.status(403).json({
          error:   "NOT_BUYER",
          message: "Only the deal's buyer can upload a payment proof.",
        });
        return;
      }

      // 4. Upload to R2
      const ext      = safeExt(rawMime);
      const uuid     = randomUUID();
      const key      = `payment-proofs/${callerId}/${uuid}.${ext}`;

      // r2Upload enforces no-overwrite; since we use a UUID key each time,
      // there is no collision — the previous file is orphaned in R2.
      const { publicUrl } = await r2Upload(key, body, rawMime);

      // 5. Upsert into payment_proofs (one row per deal_id)
      const { rows: upserted } = await pool.query(
        `INSERT INTO payment_proofs (deal_id, buyer_id, file_url, file_name, file_type, file_size)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (deal_id) DO UPDATE
           SET file_url    = EXCLUDED.file_url,
               file_name   = EXCLUDED.file_name,
               file_type   = EXCLUDED.file_type,
               file_size   = EXCLUDED.file_size,
               buyer_id    = EXCLUDED.buyer_id,
               uploaded_at = NOW()
         RETURNING *`,
        [dealId, callerId, publicUrl, fileName, rawMime, body.length],
      );

      const proof = upserted[0];

      logger.info(
        { dealId, buyerId: callerId, proofId: proof.id, key, sizeBytes: body.length },
        "payment_proof: uploaded",
      );

      // 6. Notify seller (non-fatal)
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

        const buyerName = (buyerProfile as any)?.display_name
          || (buyerProfile as any)?.username
          || "The buyer";
        const lang = (sellerProfile as any)?.language ?? "en";
        const isAr = lang === "ar";

        await createNotification({
          userId:   deal.seller_id,
          type:     "payment_proof_uploaded",
          title:    isAr ? "📎 تم رفع إثبات الدفع" : "📎 Payment Proof Uploaded",
          body:     isAr
            ? `رفع ${buyerName} إثبات الدفع للصفقة ${dealId} — راجعه قبل تأكيد الشحن.`
            : `${buyerName} uploaded a payment proof for deal ${dealId} — review it before confirming shipment.`,
          actorId:  callerId,
          metadata: { dealId, proofId: proof.id },
        });
      } catch (notifyErr) {
        logger.warn(
          { err: notifyErr, dealId, sellerId: deal.seller_id },
          "payment_proof: seller notification failed (non-fatal)",
        );
      }

      res.status(201).json({ proof });
    } catch (err) {
      logger.error({ err, dealId, callerId }, "POST /payment-proof failed");
      res.status(500).json({ error: "UPLOAD_FAILED", message: "Could not upload proof." });
    }
  },
);

// ── GET /api/payment-proof/:dealId ────────────────────────────────────────────
//
// Returns the current payment proof for a deal.
// Accessible by: the uploader (buyer), the deal's seller, or an admin.

router.get("/payment-proof/:dealId", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const dealId   = String(req.params["dealId"]);

  try {
    const { rows: dealRows } = await pool.query(
      `SELECT seller_id, buyer_id FROM transactions WHERE deal_id = $1`,
      [dealId],
    );
    if (!dealRows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const deal = dealRows[0];

    // Fetch proof first so we can also check proof.buyer_id for pre-payment uploads
    const { rows: proofRows } = await pool.query(
      `SELECT * FROM payment_proofs WHERE deal_id = $1`,
      [dealId],
    );
    const proof = proofRows.length ? proofRows[0] : null;

    const isSeller       = deal.seller_id === callerId;
    const isBuyer        = deal.buyer_id === callerId;
    const isProofOwner   = proof?.buyer_id === callerId;

    if (!isSeller && !isBuyer && !isProofOwner) {
      // Allow admin as a last resort
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("is_admin")
        .eq("id", callerId)
        .maybeSingle();
      if (!profile?.is_admin) {
        res.status(403).json({ error: "FORBIDDEN", message: "Access denied." });
        return;
      }
    }

    res.json({ proof });
  } catch (err) {
    logger.error({ err, dealId, callerId }, "GET /payment-proof/:dealId failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load proof." });
  }
});

// ── GET /api/admin/payment-proofs ────────────────────────────────────────────
//
// Lists all payment proofs across all deals — admin only.
// Registered at the root level BEFORE adminRouter so Express matches this
// specific path before delegating to the broader /admin subrouter.

router.get(
  "/admin/payment-proofs",
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT
           pp.id,
           pp.deal_id,
           pp.buyer_id,
           pp.file_url,
           pp.file_name,
           pp.file_type,
           pp.file_size,
           pp.uploaded_at,
           t.product_name,
           t.seller_id,
           t.currency,
           t.price
         FROM payment_proofs pp
         JOIN transactions t ON t.deal_id = pp.deal_id
         ORDER BY pp.uploaded_at DESC`,
      );
      res.json({ proofs: rows });
    } catch (err) {
      logger.error({ err }, "GET /admin/payment-proofs failed");
      res.status(500).json({ error: "FETCH_FAILED", message: "Could not load payment proofs." });
    }
  },
);

export default router;
