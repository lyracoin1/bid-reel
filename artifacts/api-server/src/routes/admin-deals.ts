/**
 * admin-deals.ts — Full Deal Data View for Admin Dashboard (Part #6)
 *
 * Endpoints:
 *   GET /api/admin/full-deals           — paginated list of all deals with all linked data
 *   GET /api/admin/full-deal/:dealId    — single deal with all linked data
 *
 * Data sources (two databases, merged server-side):
 *   Replit PostgreSQL (pool.query):
 *     transactions, payment_proofs, shipment_proofs
 *   Supabase REST (supabaseAdmin):
 *     profiles (buyer + seller info), deal_conditions, seller_conditions, deal_ratings
 *
 * Security:
 *   requireAuth + requireAdmin on every route — read-only, no mutations.
 *
 * Route registration:
 *   Registered at root level BEFORE adminRouter in routes/index.ts because these
 *   routes define /admin/* paths that would otherwise be swallowed by the
 *   /admin subrouter.
 */

import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { pool } from "../lib/pg-pool";
import { supabaseAdmin } from "../lib/supabase";
import { logger } from "../lib/logger";

const router = Router();

// ── SQL: join transactions + payment_proofs + shipment_proofs ─────────────────

const FULL_DEAL_SQL = `
  SELECT
    t.deal_id,
    t.seller_id,
    t.buyer_id,
    t.product_name,
    t.price,
    t.currency,
    t.description,
    t.delivery_method,
    t.payment_status,
    t.payment_date,
    t.paid_amount,
    t.shipment_status,
    t.funds_released,
    t.payment_link,
    t.terms,
    t.media_urls,
    t.created_at,
    t.updated_at,
    t.external_payment_warning,
    t.external_payment_confirmed_at,
    t.external_payment_warning_reason,
    t.buyer_info_visible,

    pp.id          AS payment_proof_id,
    pp.file_url    AS payment_proof_url,
    pp.file_name   AS payment_proof_name,
    pp.file_type   AS payment_proof_type,
    pp.file_size   AS payment_proof_size,
    pp.uploaded_at AS payment_proof_uploaded_at,

    sp.id            AS shipment_proof_id,
    sp.file_url      AS shipment_proof_url,
    sp.tracking_link AS shipment_tracking_link,
    sp.uploaded_at   AS shipment_proof_uploaded_at

  FROM transactions t
  LEFT JOIN payment_proofs  pp ON pp.deal_id  = t.deal_id
  LEFT JOIN shipment_proofs sp ON sp.deal_id  = t.deal_id
                               AND sp.seller_id = t.seller_id
`;

// ── Helper: row → FullDeal shape ──────────────────────────────────────────────

function shapeRow(
  row: any,
  profileMap:   Map<string, any>,
  condMap:      Map<string, any>,
  sellCondMap:  Map<string, any>,
  ratingsMap:   Map<string, any[]>,
  disputesMap:  Map<string, any[]>,
  penaltiesMap: Map<string, any[]>,
) {
  return {
    deal_id:         row.deal_id,
    seller_id:       row.seller_id,
    buyer_id:        row.buyer_id ?? null,
    product_name:    row.product_name,
    price:           Number(row.price),
    currency:        row.currency,
    description:     row.description ?? null,
    delivery_method: row.delivery_method,
    payment_status:  row.payment_status,
    payment_date:    row.payment_date ?? null,
    paid_amount:     row.paid_amount != null ? Number(row.paid_amount) : null,
    shipment_status: row.shipment_status,
    funds_released:  Boolean(row.funds_released),
    payment_link:    row.payment_link ?? null,
    terms:           row.terms ?? null,
    media_urls:                     row.media_urls ?? [],
    created_at:                     row.created_at,
    updated_at:                     row.updated_at,
    external_payment_warning:       Boolean(row.external_payment_warning),
    external_payment_confirmed_at:  row.external_payment_confirmed_at ?? null,
    external_payment_warning_reason: row.external_payment_warning_reason ?? null,
    buyer_info_visible:             Boolean(row.buyer_info_visible),

    seller: profileMap.get(row.seller_id) ?? null,
    buyer:  row.buyer_id ? (profileMap.get(row.buyer_id) ?? null) : null,

    payment_proof: row.payment_proof_id ? {
      id:          row.payment_proof_id,
      file_url:    row.payment_proof_url,
      file_name:   row.payment_proof_name,
      file_type:   row.payment_proof_type,
      file_size:   row.payment_proof_size ?? null,
      uploaded_at: row.payment_proof_uploaded_at,
    } : null,

    shipment_proof: row.shipment_proof_id ? {
      id:            row.shipment_proof_id,
      file_url:      row.shipment_proof_url,
      tracking_link: row.shipment_tracking_link ?? "",
      uploaded_at:   row.shipment_proof_uploaded_at,
    } : null,

    buyer_conditions:      condMap.get(row.deal_id) ?? null,
    seller_conditions:     sellCondMap.get(row.deal_id) ?? null,
    ratings:               ratingsMap.get(row.deal_id) ?? [],
    shipping_fee_disputes: disputesMap.get(row.deal_id) ?? [],
    seller_penalties:      penaltiesMap.get(row.deal_id) ?? [],
  };
}

// ── GET /api/admin/full-deals ─────────────────────────────────────────────────
//
// Returns paginated full deals with all linked Supabase data merged in.
// Query params: page (default 1), limit (default 50, max 100)

router.get("/admin/full-deals", requireAuth, requireAdmin, async (req, res) => {
  const page   = Math.max(1, parseInt(String(req.query["page"]  ?? "1"), 10));
  const limit  = Math.min(100, Math.max(1, parseInt(String(req.query["limit"] ?? "50"), 10)));
  const offset = (page - 1) * limit;

  try {
    // 1. Fetch transactions + proofs from Replit Postgres
    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(`${FULL_DEAL_SQL} ORDER BY t.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]),
      pool.query(`SELECT COUNT(*) AS total FROM transactions`),
    ]);

    const total = parseInt(countRows[0]?.total ?? "0", 10);

    if (rows.length === 0) {
      res.json({ deals: [], total, page, limit });
      return;
    }

    const dealIds  = rows.map((r: any) => r.deal_id);
    const userIds  = [...new Set(rows.flatMap((r: any) => [r.seller_id, r.buyer_id].filter(Boolean)))] as string[];

    // 2. Batch-fetch Supabase data + disputes + penalties in parallel
    const [profilesRes, condRes, sellCondRes, ratingsRes, { rows: disputeRows }, { rows: penaltyRows }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, username, display_name, phone, avatar_url, location, country")
        .in("id", userIds),
      supabaseAdmin
        .from("deal_conditions")
        .select("id, deal_id, buyer_id, conditions, created_at, updated_at")
        .in("deal_id", dealIds),
      supabaseAdmin
        .from("seller_conditions")
        .select("id, deal_id, seller_id, conditions, created_at, updated_at")
        .in("deal_id", dealIds),
      supabaseAdmin
        .from("deal_ratings")
        .select("id, deal_id, rater_id, ratee_id, stars, comment, created_at")
        .in("deal_id", dealIds),
      pool.query(
        `SELECT id, deal_id, submitted_by, party, proof_url, comment, created_at
         FROM shipping_fee_disputes
         WHERE deal_id = ANY($1::text[])
         ORDER BY created_at ASC`,
        [dealIds],
      ),
      pool.query(
        `SELECT id, deal_id, seller_id, reason, penalty_type, amount, resolved, created_at
         FROM seller_penalties
         WHERE deal_id = ANY($1::text[])
         ORDER BY created_at DESC`,
        [dealIds],
      ),
    ]);

    // 3. Build lookup maps
    const profileMap  = new Map<string, any>();
    for (const p of profilesRes.data ?? []) profileMap.set(p.id, p);

    const condMap = new Map<string, any>();
    for (const c of condRes.data ?? []) condMap.set(c.deal_id, c);

    const sellCondMap = new Map<string, any>();
    for (const c of sellCondRes.data ?? []) sellCondMap.set(c.deal_id, c);

    const ratingsMap = new Map<string, any[]>();
    for (const r of ratingsRes.data ?? []) {
      const arr = ratingsMap.get(r.deal_id) ?? [];
      arr.push(r);
      ratingsMap.set(r.deal_id, arr);
    }

    const disputesMap = new Map<string, any[]>();
    for (const d of disputeRows) {
      const arr = disputesMap.get(d.deal_id) ?? [];
      arr.push(d);
      disputesMap.set(d.deal_id, arr);
    }

    const penaltiesMap = new Map<string, any[]>();
    for (const p of penaltyRows) {
      const arr = penaltiesMap.get(p.deal_id) ?? [];
      arr.push(p);
      penaltiesMap.set(p.deal_id, arr);
    }

    // 4. Merge
    const deals = rows.map((row: any) => shapeRow(row, profileMap, condMap, sellCondMap, ratingsMap, disputesMap, penaltiesMap));

    res.json({ deals, total, page, limit });
  } catch (err) {
    logger.error({ err }, "GET /admin/full-deals failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load deals." });
  }
});

// ── GET /api/admin/full-deal/:dealId ─────────────────────────────────────────
//
// Returns a single deal with all linked data. Used when the admin clicks
// into a specific deal for the detail panel.

router.get("/admin/full-deal/:dealId", requireAuth, requireAdmin, async (req, res) => {
  const dealId = String(req.params["dealId"]);

  try {
    const { rows } = await pool.query(
      `${FULL_DEAL_SQL} WHERE t.deal_id = $1`,
      [dealId],
    );

    if (!rows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const row     = rows[0];
    const userIds = [row.seller_id, row.buyer_id].filter(Boolean) as string[];

    const [profilesRes, condRes, sellCondRes, ratingsRes, { rows: disputeRows }, { rows: penaltyRows }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, username, display_name, phone, avatar_url, location, country")
        .in("id", userIds),
      supabaseAdmin
        .from("deal_conditions")
        .select("id, deal_id, buyer_id, conditions, created_at, updated_at")
        .eq("deal_id", dealId),
      supabaseAdmin
        .from("seller_conditions")
        .select("id, deal_id, seller_id, conditions, created_at, updated_at")
        .eq("deal_id", dealId),
      supabaseAdmin
        .from("deal_ratings")
        .select("id, deal_id, rater_id, ratee_id, stars, comment, created_at")
        .eq("deal_id", dealId),
      pool.query(
        `SELECT id, deal_id, submitted_by, party, proof_url, comment, created_at
         FROM shipping_fee_disputes
         WHERE deal_id = $1
         ORDER BY created_at ASC`,
        [dealId],
      ),
      pool.query(
        `SELECT id, deal_id, seller_id, reason, penalty_type, amount, resolved, created_at
         FROM seller_penalties
         WHERE deal_id = $1
         ORDER BY created_at DESC`,
        [dealId],
      ),
    ]);

    const profileMap  = new Map<string, any>();
    for (const p of profilesRes.data ?? []) profileMap.set(p.id, p);

    const condMap     = new Map<string, any>();
    const c0 = condRes.data?.[0];
    if (c0) condMap.set(c0.deal_id, c0);

    const sellCondMap = new Map<string, any>();
    const sc0 = sellCondRes.data?.[0];
    if (sc0) sellCondMap.set(sc0.deal_id, sc0);

    const ratingsMap  = new Map<string, any[]>();
    for (const r of ratingsRes.data ?? []) {
      const arr = ratingsMap.get(r.deal_id) ?? [];
      arr.push(r);
      ratingsMap.set(r.deal_id, arr);
    }

    const disputesMap = new Map<string, any[]>();
    for (const d of disputeRows) {
      const arr = disputesMap.get(d.deal_id) ?? [];
      arr.push(d);
      disputesMap.set(d.deal_id, arr);
    }

    const penaltiesMap = new Map<string, any[]>();
    for (const p of penaltyRows) {
      const arr = penaltiesMap.get(p.deal_id) ?? [];
      arr.push(p);
      penaltiesMap.set(p.deal_id, arr);
    }

    const deal = shapeRow(row, profileMap, condMap, sellCondMap, ratingsMap, disputesMap, penaltiesMap);
    res.json({ deal });
  } catch (err) {
    logger.error({ err, dealId }, "GET /admin/full-deal/:dealId failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load deal." });
  }
});

export default router;
