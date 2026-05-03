/**
 * delivery-proof.ts — Buyer Delivery Proof Upload for Secure Deals (Part #8)
 *
 * Endpoints:
 *   POST /api/delivery-proof               — buyer uploads a receipt/photo proving delivery
 *   GET  /api/delivery-proof/:dealId       — fetch current proof (buyer, seller, or admin)
 *   GET  /api/admin/delivery-proofs        — list all proofs (admin only)
 *
 * Upload flow:
 *   • Client sends raw file bytes as request body (same as payment-proof, shipment-proof).
 *   • Query params: dealId, mimeType, fileName (URL-encoded).
 *   • File stored in R2 under  delivery-proofs/{buyerId}/{uuid}.{ext}
 *   • DB row in delivery_proofs is upserted (UNIQUE deal_id, buyer_id) — re-upload replaces.
 *   • Seller receives FCM push + in-app notification (non-fatal).
 *
 * Security:
 *   • buyer_id is always from the verified JWT — never from the request body.
 *   • Only the deal's buyer_id may upload (403 NOT_BUYER if caller is someone else).
 *   • Deal must be in 'delivered' state (shipment_status = 'delivered') to upload.
 *   • File type: PDF, JPEG, PNG, WebP. File size: ≤ 10 MB.
 *
 * Note on transactions table:
 *   The transactions table lives in Replit PostgreSQL (DATABASE_URL), bootstrapped
 *   via bootstrapTransactionsTable() in pg-pool.ts. The delivery_proofs table is
 *   also in Replit PostgreSQL — created by the same bootstrap function at startup.
 *   No Supabase migration is needed for delivery_proofs itself.
 *   Only the Supabase notifications CHECK constraint needs updating (see
 *   migrations/048_delivery_proofs.sql).
 */

import express, { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { pool } from "../lib/pg-pool";
import { r2Upload } from "../lib/r2";
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

const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg":       "jpg",
  "image/jpg":        "jpg",
  "image/png":        "png",
  "image/webp":       "webp",
};

function safeExt(mime: string): string {
  return MIME_TO_EXT[mime] ?? "bin";
}

// ── POST /api/delivery-proof ──────────────────────────────────────────────────
//
// Buyer uploads raw binary file. Query params: dealId, mimeType, fileName.
// Stores in R2, upserts delivery_proofs row, notifies seller.

router.post(
  "/delivery-proof",
  requireAuth,
  express.raw({ limit: "12mb", type: "*/*" }),
  async (req, res) => {
    const callerId = req.user!.id;
    const dealId   = String(req.query["dealId"]   ?? "").trim();
    const rawMime  = String(req.query["mimeType"] ?? "").split(";")[0]?.trim() ?? "";
    const fileName = String(req.query["fileName"] ?? "delivery").slice(0, 200);

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
        error:    "FILE_TOO_LARGE",
        message:  `File must be smaller than ${MAX_PROOF_BYTES / (1024 * 1024)} MB.`,
        maxBytes: MAX_PROOF_BYTES,
      });
      return;
    }

    try {
      // 1. Load deal — verify buyer ownership + delivery state
      const { rows: dealRows } = await pool.query(
        `SELECT deal_id, seller_id, buyer_id, shipment_status, product_name
         FROM transactions
         WHERE deal_id = $1`,
        [dealId],
      );
      if (!dealRows.length) {
        res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
        return;
      }

      const deal = dealRows[0];

      if (!deal.buyer_id || deal.buyer_id !== callerId) {
        res.status(403).json({
          error:   "NOT_BUYER",
          message: "Only the deal's buyer can upload a delivery proof.",
        });
        return;
      }

      if (deal.shipment_status !== "delivered") {
        res.status(409).json({
          error:   "DEAL_NOT_DELIVERED",
          message: "Delivery proof can only be uploaded after the buyer confirms receipt.",
        });
        return;
      }

      // 2. Upload to R2 (new UUID per upload — re-upload orphans old file)
      const ext   = safeExt(rawMime);
      const uuid  = randomUUID();
      const key   = `delivery-proofs/${callerId}/${uuid}.${ext}`;
      const { publicUrl } = await r2Upload(key, body, rawMime);

      // 3. Upsert into delivery_proofs (UNIQUE deal_id, buyer_id)
      const { rows: upserted } = await pool.query(
        `INSERT INTO delivery_proofs (deal_id, buyer_id, file_url)
         VALUES ($1, $2, $3)
         ON CONFLICT (deal_id, buyer_id) DO UPDATE
           SET file_url    = EXCLUDED.file_url,
               uploaded_at = NOW()
         RETURNING *`,
        [dealId, callerId, publicUrl],
      );

      const proof = upserted[0];

      logger.info(
        { dealId, buyerId: callerId, proofId: proof.id, key, sizeBytes: body.length },
        "delivery_proof: uploaded",
      );

      // 4. Notify seller (non-fatal — DB is already written)
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
          type:     "buyer_delivery_proof_uploaded",
          title:    isAr ? "📦 المشتري رفع إثبات الاستلام" : "📦 Buyer Uploaded Delivery Proof",
          body:     isAr
            ? `${buyerName} رفع إثبات استلام المنتج للصفقة ${dealId}.`
            : `${buyerName} uploaded a delivery proof for deal ${dealId}.`,
          actorId:  callerId,
          metadata: { dealId, proofId: proof.id },
        });
      } catch (notifyErr) {
        logger.warn(
          { err: notifyErr, dealId, sellerId: deal.seller_id },
          "delivery_proof: seller notification failed (non-fatal)",
        );
      }

      res.status(201).json({ proof });
    } catch (err) {
      logger.error({ err, dealId, callerId }, "POST /delivery-proof failed");
      res.status(500).json({ error: "UPLOAD_FAILED", message: "Could not upload delivery proof." });
    }
  },
);

// ── GET /api/delivery-proof/:dealId ───────────────────────────────────────────
//
// Returns the current delivery proof for a deal.
// Accessible by: the deal's buyer, the deal's seller, or an admin.

router.get("/delivery-proof/:dealId", requireAuth, async (req, res) => {
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
    const isBuyer  = deal.buyer_id  === callerId;
    const isSeller = deal.seller_id === callerId;

    if (!isBuyer && !isSeller) {
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

    const { rows: proofRows } = await pool.query(
      `SELECT * FROM delivery_proofs WHERE deal_id = $1 ORDER BY uploaded_at DESC LIMIT 1`,
      [dealId],
    );
    const proof = proofRows.length ? proofRows[0] : null;

    res.json({ proof });
  } catch (err) {
    logger.error({ err, dealId, callerId }, "GET /delivery-proof/:dealId failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load delivery proof." });
  }
});

// ── GET /api/admin/delivery-proofs ────────────────────────────────────────────
//
// Lists all delivery proofs across all deals — admin only.
// Registered at root level BEFORE adminRouter so Express matches this path
// before delegating to the /admin subrouter (which would return 404).

router.get(
  "/admin/delivery-proofs",
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT
           dp.id,
           dp.deal_id,
           dp.buyer_id,
           dp.file_url,
           dp.uploaded_at,
           t.product_name,
           t.seller_id,
           t.currency,
           t.price
         FROM delivery_proofs dp
         JOIN transactions t ON t.deal_id = dp.deal_id
         ORDER BY dp.uploaded_at DESC`,
      );
      res.json({ proofs: rows });
    } catch (err) {
      logger.error({ err }, "GET /admin/delivery-proofs failed");
      res.status(500).json({ error: "FETCH_FAILED", message: "Could not load delivery proofs." });
    }
  },
);

export default router;
