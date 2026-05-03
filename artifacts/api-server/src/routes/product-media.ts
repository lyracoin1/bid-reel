/**
 * product-media.ts — Product Media Upload for Secure Deals (Part #15)
 *
 * Endpoints:
 *   POST /api/product-media                 — seller uploads product image/video
 *   GET  /api/product-media/:dealId         — buyer/seller/admin reads media list
 *   GET  /api/admin/product-media           — admin lists all product media (admin only)
 *
 * Upload flow:
 *   • Client sends raw file bytes as the request body.
 *   • Query params: dealId, mimeType, fileName (URL-encoded).
 *   • File stored in R2 under  product-media/{sellerId}/{uuid}.{ext}
 *   • DB row upserted on (deal_id, file_name) — re-upload replaces same filename.
 *   • Allowed types: JPEG, PNG, WebP (image) | MP4 (video).
 *   • Max size: 10 MB for images, 50 MB for video.
 *
 * Security:
 *   • seller_id always from verified JWT.
 *   • Only the deal's seller_id may upload.
 *   • GET: caller must be buyer, seller, or admin.
 *
 * Route registration:
 *   productMediaRouter is mounted BEFORE adminRouter in routes/index.ts because
 *   it defines GET /admin/product-media — adminRouter would otherwise swallow it.
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

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;  // 10 MB
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;  // 50 MB

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const ALLOWED_VIDEO_TYPES = new Set([
  "video/mp4",
]);

const ALLOWED_TYPES = new Set([...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES]);

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg":  "jpg",
  "image/png":  "png",
  "image/webp": "webp",
  "video/mp4":  "mp4",
};

function safeExt(mime: string): string {
  return MIME_TO_EXT[mime] ?? "bin";
}

function mediaType(mime: string): "image" | "video" {
  return ALLOWED_VIDEO_TYPES.has(mime) ? "video" : "image";
}

// ── POST /api/product-media ───────────────────────────────────────────────────
//
// Seller uploads a product image or video for a deal.
// Query params: dealId, mimeType, fileName.
// Stores in R2, upserts product_media row, optionally notifies admin.

router.post(
  "/product-media",
  requireAuth,
  express.raw({ limit: "55mb", type: "*/*" }),
  async (req, res) => {
    const callerId = req.user!.id;
    const dealId   = String(req.query["dealId"]   ?? "").trim();
    const rawMime  = String(req.query["mimeType"] ?? "").split(";")[0]?.trim() ?? "";
    const fileName = String(req.query["fileName"] ?? "media").slice(0, 200);

    if (!dealId) {
      res.status(400).json({ error: "MISSING_DEAL_ID", message: "dealId query param is required." });
      return;
    }

    if (!ALLOWED_TYPES.has(rawMime)) {
      res.status(400).json({
        error:   "INVALID_FILE_TYPE",
        message: `Unsupported file type "${rawMime}". Allowed: JPEG, PNG, WebP, MP4.`,
        allowed: [...ALLOWED_TYPES],
      });
      return;
    }

    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "EMPTY_BODY", message: "Request body is empty." });
      return;
    }

    const isVideo  = ALLOWED_VIDEO_TYPES.has(rawMime);
    const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (body.length > maxBytes) {
      res.status(400).json({
        error:    "FILE_TOO_LARGE",
        message:  `File must be smaller than ${maxBytes / (1024 * 1024)} MB.`,
        maxBytes,
      });
      return;
    }

    try {
      // 1. Load deal — verify seller
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
          message: "Only the deal's seller can upload product media.",
        });
        return;
      }

      // 2. Upload to R2
      const ext  = safeExt(rawMime);
      const uuid = randomUUID();
      const key  = `product-media/${callerId}/${uuid}.${ext}`;
      const { publicUrl } = await r2Upload(key, body, rawMime);

      // 3. Upsert product_media row — UNIQUE (deal_id, file_name)
      const { rows: upserted } = await pool.query(
        `INSERT INTO product_media (deal_id, seller_id, media_type, file_url, file_name, file_size)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (deal_id, file_name) DO UPDATE
           SET media_type = EXCLUDED.media_type,
               file_url   = EXCLUDED.file_url,
               file_size  = EXCLUDED.file_size,
               seller_id  = EXCLUDED.seller_id,
               uploaded_at = NOW()
         RETURNING *`,
        [dealId, callerId, mediaType(rawMime), publicUrl, fileName, body.length],
      );

      const media = upserted[0];

      logger.info(
        { dealId, sellerId: callerId, mediaId: media.id, key, sizeBytes: body.length },
        "product_media: uploaded",
      );

      // 4. Notify admin (non-fatal) — gather all admin IDs from profiles
      void (async () => {
        try {
          const { data: admins } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("is_admin", true);
          if (!admins?.length) return;
          const notifMeta = { deal_id: dealId, media_id: media.id };
          await Promise.allSettled(
            admins.map((a: { id: string }) =>
              createNotification({
                userId:   a.id,
                type:     "product_media_uploaded",
                title:    "Product Media Uploaded",
                body:     `Seller uploaded a new ${mediaType(rawMime)} for deal ${dealId}.`,
                actorId:  callerId,
                metadata: notifMeta,
              }),
            ),
          );
        } catch (notifyErr) {
          logger.warn({ err: notifyErr, dealId }, "product_media: admin notification failed (non-fatal)");
        }
      })();

      res.status(201).json({ media });
    } catch (err) {
      logger.error({ err, dealId, callerId }, "POST /product-media failed");
      res.status(500).json({ error: "UPLOAD_FAILED", message: "Could not upload product media." });
    }
  },
);

// ── GET /api/product-media/:dealId ────────────────────────────────────────────
//
// Returns all product media rows for a deal.
// Caller must be the buyer, seller, or an admin.

router.get("/product-media/:dealId", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const { dealId } = req.params;

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

    const { rows: media } = await pool.query(
      `SELECT * FROM product_media WHERE deal_id = $1 ORDER BY uploaded_at DESC`,
      [dealId],
    );

    res.json({ media });
  } catch (err) {
    logger.error({ err, dealId, callerId }, "GET /product-media/:dealId failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load product media." });
  }
});

// ── GET /api/admin/product-media ─────────────────────────────────────────────
//
// Admin: list all product media across all deals, joined with deal info.
// Registered before adminRouter to avoid /admin/* being swallowed.

router.get(
  "/admin/product-media",
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT
           pm.id,
           pm.deal_id,
           pm.seller_id,
           pm.media_type,
           pm.file_url,
           pm.file_name,
           pm.file_size,
           pm.uploaded_at,
           t.product_name,
           t.buyer_id,
           t.currency,
           t.price
         FROM product_media pm
         JOIN transactions t ON t.deal_id = pm.deal_id
         ORDER BY pm.uploaded_at DESC`,
      );
      res.json({ media: rows });
    } catch (err) {
      logger.error({ err }, "GET /admin/product-media failed");
      res.status(500).json({ error: "FETCH_FAILED", message: "Could not load product media." });
    }
  },
);

export default router;
