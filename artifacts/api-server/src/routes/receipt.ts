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

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png"]);
const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
};

function safeExt(mime: string): string {
  return MIME_TO_EXT[mime] ?? "bin";
}

router.post("/deal/receipt", requireAuth, express.raw({ limit: "12mb", type: "*/*" }), async (req, res) => {
  const callerId = req.user!.id;
  const dealId = String(req.query["dealId"] ?? "").trim();
  const rawMime = String(req.query["mimeType"] ?? "").split(";")[0]?.trim() ?? "";
  const fileName = String(req.query["fileName"] ?? "receipt").slice(0, 200);
  const orderId = String(req.query["orderId"] ?? "").trim().slice(0, 200) || null;

  if (!dealId) {
    res.status(400).json({ error: "MISSING_DEAL_ID", message: "dealId query param is required." });
    return;
  }
  if (!ALLOWED_TYPES.has(rawMime)) {
    res.status(400).json({ error: "INVALID_FILE_TYPE", message: "Unsupported file type.", allowed: [...ALLOWED_TYPES] });
    return;
  }

  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    res.status(400).json({ error: "EMPTY_BODY", message: "Request body is empty." });
    return;
  }
  if (body.length > MAX_BYTES) {
    res.status(400).json({ error: "FILE_TOO_LARGE", message: "File must be smaller than 10 MB.", maxBytes: MAX_BYTES });
    return;
  }

  try {
    const { rows: dealRows } = await pool.query(
      `SELECT deal_id, buyer_id, seller_id FROM transactions WHERE deal_id = $1`,
      [dealId],
    );
    if (!dealRows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const deal = dealRows[0];
    if (!deal.buyer_id || deal.buyer_id !== callerId) {
      res.status(403).json({ error: "NOT_BUYER", message: "Only the deal's buyer can upload a receipt." });
      return;
    }

    const ext = safeExt(rawMime);
    const key = `receipts/${callerId}/${randomUUID()}.${ext}`;
    const { publicUrl } = await r2Upload(key, body, rawMime);

    const { rows: upserted } = await pool.query(
      `UPDATE transactions
         SET order_id = $2,
             receipt_file_url = $3,
             receipt_uploaded_at = NOW(),
             updated_at = NOW()
       WHERE deal_id = $1
       RETURNING deal_id, order_id, receipt_file_url, receipt_uploaded_at`,
      [dealId, orderId, publicUrl],
    );

    const proof = upserted[0];

    try {
      const [{ data: buyerProfile }, { data: adminProfiles }] = await Promise.all([
        supabaseAdmin.from("profiles").select("display_name, username").eq("id", callerId).maybeSingle(),
        supabaseAdmin.from("profiles").select("id").eq("is_admin", true),
      ]);
      const buyerName = (buyerProfile as any)?.display_name || (buyerProfile as any)?.username || "The buyer";
      await Promise.all((adminProfiles ?? []).map(async (admin: any) => {
        await createNotification({
          userId: admin.id,
          type: "admin_message",
          title: "🧾 Receipt uploaded",
          body: `${buyerName} uploaded a receipt for deal ${dealId}.`,
          actorId: callerId,
          metadata: { dealId, orderId, receiptFileUrl: publicUrl },
        });
      }));
    } catch {}

    res.status(201).json({ proof });
  } catch (err) {
    logger.error({ err, dealId, callerId }, "POST /deal/receipt failed");
    res.status(500).json({ error: "UPLOAD_FAILED", message: "Could not upload receipt." });
  }
});

router.get("/deal/receipt/:dealId", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const dealId = String(req.params["dealId"]);

  try {
    const { rows } = await pool.query(
      `SELECT deal_id, buyer_id, seller_id, order_id, receipt_file_url, receipt_uploaded_at FROM transactions WHERE deal_id = $1`,
      [dealId],
    );
    if (!rows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const deal = rows[0];
    const isBuyer = deal.buyer_id === callerId;
    const isSeller = deal.seller_id === callerId;

    if (!isBuyer && !isSeller) {
      const { data: profile } = await supabaseAdmin.from("profiles").select("is_admin").eq("id", callerId).maybeSingle();
      if (!profile?.is_admin) {
        res.status(403).json({ error: "FORBIDDEN", message: "Access denied." });
        return;
      }
    }

    res.json({
      receipt_file_url: deal.receipt_file_url ?? null,
      order_id: deal.order_id ?? null,
      receipt_uploaded_at: deal.receipt_uploaded_at ?? null,
    });
  } catch (err) {
    logger.error({ err, dealId, callerId }, "GET /deal/receipt/:dealId failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load receipt." });
  }
});

router.get("/admin/receipts", requireAuth, requireAdmin, async (req, res) => {
  try {
    const dealId = String(req.query["dealId"] ?? "").trim();
    const sellerId = String(req.query["sellerId"] ?? "").trim();
    const buyerId = String(req.query["buyerId"] ?? "").trim();
    const where: string[] = [];
    const params: unknown[] = [];
    if (dealId) { params.push(dealId); where.push(`t.deal_id = $${params.length}`); }
    if (sellerId) { params.push(sellerId); where.push(`t.seller_id = $${params.length}`); }
    if (buyerId) { params.push(buyerId); where.push(`t.buyer_id = $${params.length}`); }

    const sql = `
      SELECT t.deal_id, t.seller_id, t.buyer_id, t.product_name, t.currency, t.price, t.order_id, t.receipt_file_url, t.receipt_uploaded_at
      FROM transactions t
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY t.receipt_uploaded_at DESC NULLS LAST, t.created_at DESC
    `;
    const { rows } = await pool.query(sql, params);
    res.json({ receipts: rows });
  } catch (err) {
    logger.error({ err }, "GET /admin/receipts failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load receipts." });
  }
});

export default router;
