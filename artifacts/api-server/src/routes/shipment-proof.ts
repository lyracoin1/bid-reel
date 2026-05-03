/**
 * shipment-proof.ts — Seller Shipment Proof Upload for Secure Deals (Part #5)
 *
 * Endpoints:
 *   POST /api/shipment-proof                — seller uploads a shipping receipt + tracking link
 *   GET  /api/shipment-proof/:dealId        — fetch current proof for a deal
 *   GET  /api/admin/shipment-proofs         — list all proofs (admin only)
 *
 * Upload flow:
 *   • Client sends raw file bytes as the request body (same as /api/media/upload and /api/payment-proof).
 *   • Query params: dealId, mimeType, fileName (URL-encoded), trackingLink (URL-encoded).
 *   • File is stored in R2 under  shipment-proofs/{sellerId}/{uuid}.{ext}
 *   • DB row in shipment_proofs is upserted (UNIQUE deal_id, seller_id) — re-upload replaces.
 *   • Buyer receives FCM push + in-app notification (non-fatal).
 *
 * Security:
 *   • seller_id is always from the verified JWT — never from the request body.
 *   • Only the deal's seller_id may upload (403 NOT_SELLER if caller is someone else).
 *   • File type: PDF, JPEG, PNG, WebP. File size: ≤ 10 MB.
 *
 * Route registration note:
 *   shipmentProofRouter is mounted BEFORE adminRouter in routes/index.ts because it
 *   defines GET /admin/shipment-proofs — adminRouter (mounted at /admin) would otherwise
 *   intercept the path and return 404 before reaching this handler.
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

// ── POST /api/shipment-proof ──────────────────────────────────────────────────
//
// Seller uploads raw binary file. Query params: dealId, mimeType, fileName, trackingLink.
// Stores in R2, upserts shipment_proofs row, notifies buyer.

router.post(
  "/shipment-proof",
  requireAuth,
  express.raw({ limit: "12mb", type: "*/*" }),
  async (req, res) => {
    const callerId    = req.user!.id;
    const dealId      = String(req.query["dealId"]       ?? "").trim();
    const rawMime     = String(req.query["mimeType"]     ?? "").split(";")[0]?.trim() ?? "";
    const fileName    = String(req.query["fileName"]     ?? "shipment").slice(0, 200);
    const trackingLink = decodeURIComponent(String(req.query["trackingLink"] ?? "")).trim().slice(0, 500);

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
      // 1. Load deal — verify seller ownership
      const { rows: dealRows } = await pool.query(
        `SELECT deal_id, seller_id, buyer_id FROM transactions WHERE deal_id = $1`,
        [dealId],
      );
      if (!dealRows.length) {
        res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
        return;
      }

      const deal = dealRows[0];

      if (deal.seller_id !== callerId) {
        res.status(403).json({
          error:   "NOT_SELLER",
          message: "Only the deal's seller can upload a shipment proof.",
        });
        return;
      }

      // 2. Upload to R2 (UUID key per upload — no collision, old file orphaned)
      const ext      = safeExt(rawMime);
      const uuid     = randomUUID();
      const key      = `shipment-proofs/${callerId}/${uuid}.${ext}`;
      const { publicUrl } = await r2Upload(key, body, rawMime);

      // 3. Upsert into shipment_proofs (UNIQUE deal_id, seller_id)
      const { rows: upserted } = await pool.query(
        `INSERT INTO shipment_proofs (deal_id, seller_id, file_url, tracking_link)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (deal_id, seller_id) DO UPDATE
           SET file_url      = EXCLUDED.file_url,
               tracking_link = EXCLUDED.tracking_link,
               uploaded_at   = NOW()
         RETURNING *`,
        [dealId, callerId, publicUrl, trackingLink],
      );

      const proof = upserted[0];

      logger.info(
        { dealId, sellerId: callerId, proofId: proof.id, key, sizeBytes: body.length, hasTracking: !!trackingLink },
        "shipment_proof: uploaded",
      );

      // 4. Notify buyer (non-fatal)
      if (deal.buyer_id) {
        try {
          const [{ data: sellerProfile }, { data: buyerProfile }] = await Promise.all([
            supabaseAdmin
              .from("profiles")
              .select("display_name, username")
              .eq("id", callerId)
              .maybeSingle(),
            supabaseAdmin
              .from("profiles")
              .select("language")
              .eq("id", deal.buyer_id)
              .maybeSingle(),
          ]);

          const sellerName = (sellerProfile as any)?.display_name
            || (sellerProfile as any)?.username
            || "The seller";
          const lang = (buyerProfile as any)?.language ?? "en";
          const isAr = lang === "ar";

          await createNotification({
            userId:   deal.buyer_id,
            type:     "shipment_proof_uploaded",
            title:    isAr ? "🚚 البائع شحن طلبك!" : "🚚 Seller Has Shipped Your Order!",
            body:     isAr
              ? `${sellerName} رفع إثبات الشحن للصفقة ${dealId}.${trackingLink ? ` رقم التتبع: ${trackingLink}` : ""}`
              : `${sellerName} uploaded a shipment proof for deal ${dealId}.${trackingLink ? ` Tracking: ${trackingLink}` : ""}`,
            actorId:  callerId,
            metadata: { dealId, proofId: proof.id, trackingLink },
          });
        } catch (notifyErr) {
          logger.warn(
            { err: notifyErr, dealId, buyerId: deal.buyer_id },
            "shipment_proof: buyer notification failed (non-fatal)",
          );
        }
      }

      res.status(201).json({ proof });
    } catch (err) {
      logger.error({ err, dealId, callerId }, "POST /shipment-proof failed");
      res.status(500).json({ error: "UPLOAD_FAILED", message: "Could not upload shipment proof." });
    }
  },
);

// ── GET /api/shipment-proof/:dealId ───────────────────────────────────────────
//
// Returns the current shipment proof for a deal.
// Accessible by: the deal's seller, the assigned buyer, or an admin.

router.get("/shipment-proof/:dealId", requireAuth, async (req, res) => {
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

    const { rows: proofRows } = await pool.query(
      `SELECT * FROM shipment_proofs WHERE deal_id = $1 ORDER BY uploaded_at DESC LIMIT 1`,
      [dealId],
    );
    const proof = proofRows.length ? proofRows[0] : null;

    const isSeller = deal.seller_id === callerId;
    const isBuyer  = deal.buyer_id  === callerId;

    if (!isSeller && !isBuyer) {
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
    logger.error({ err, dealId, callerId }, "GET /shipment-proof/:dealId failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load shipment proof." });
  }
});

// ── GET /api/admin/shipment-proofs ────────────────────────────────────────────
//
// Lists all shipment proofs across all deals — admin only.
// Registered at root level BEFORE adminRouter so Express matches this path
// before delegating to the /admin subrouter (which would return 404).

router.get(
  "/admin/shipment-proofs",
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT
           sp.id,
           sp.deal_id,
           sp.seller_id,
           sp.file_url,
           sp.tracking_link,
           sp.uploaded_at,
           t.product_name,
           t.buyer_id,
           t.currency,
           t.price
         FROM shipment_proofs sp
         JOIN transactions t ON t.deal_id = sp.deal_id
         ORDER BY sp.uploaded_at DESC`,
      );
      res.json({ proofs: rows });
    } catch (err) {
      logger.error({ err }, "GET /admin/shipment-proofs failed");
      res.status(500).json({ error: "FETCH_FAILED", message: "Could not load shipment proofs." });
    }
  },
);

export default router;
