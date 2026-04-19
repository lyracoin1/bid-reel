/**
 * Deals + Trust Rating routes
 *
 * Powers the BidReel trust system (Bybit-style, no stars).
 *
 * Endpoints
 *   GET    /api/deals/me                   — list caller's deals (as buyer + seller)
 *   GET    /api/deals/:dealId              — single deal (must be buyer or seller)
 *   POST   /api/deals/:dealId/confirm      — body: { outcome: "completed" | "failed" }
 *   POST   /api/deals/:dealId/rate         — body: 5 booleans (see schema below)
 *   GET    /api/users/:userId/trust        — public trust profile for any user
 *   GET    /api/users/me/trust             — caller's own trust profile
 *
 * All write paths enforce:
 *   • caller must be seller or buyer of the deal
 *   • rating allowed ONLY when deal.status = 'completed'
 *   • exactly one rating per (deal, rater) — DB-level UNIQUE
 *   • each side may submit one confirmation; later confirmations overwrite
 *     a still-'pending' value but a finalised confirmation is locked in.
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { supabaseAdmin } from "../lib/supabase";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── helpers ────────────────────────────────────────────────────────────────

const uuidSchema = z.string().uuid();

function colorFor(score: number | null): "green" | "yellow" | "red" | null {
  if (score === null || Number.isNaN(score)) return null;
  if (score >= 80) return "green";
  if (score >= 50) return "yellow";
  return "red";
}

type TrustRow = {
  user_id: string;
  completed_sales: number;
  total_sell_deals: number;
  completed_buys: number;
  total_buy_deals: number;
  seller_completion_rate: number | null;
  buyer_completion_rate: number | null;
  seller_review_score: number | null;
  buyer_review_score: number | null;
  seller_reviews_count: number;
  buyer_reviews_count: number;
  final_seller_score: number | null;
  final_buyer_score: number | null;
  number_of_completed_deals: number;
};

function shapeTrust(row: TrustRow | null) {
  const fs = row?.final_seller_score ?? null;
  const fb = row?.final_buyer_score ?? null;
  return {
    user_id: row?.user_id ?? null,
    completed_sales: row?.completed_sales ?? 0,
    total_sell_deals: row?.total_sell_deals ?? 0,
    completed_buys: row?.completed_buys ?? 0,
    total_buy_deals: row?.total_buy_deals ?? 0,
    seller_completion_rate: row?.seller_completion_rate ?? null,
    buyer_completion_rate: row?.buyer_completion_rate ?? null,
    seller_review_score: row?.seller_review_score ?? null,
    buyer_review_score: row?.buyer_review_score ?? null,
    seller_reviews_count: row?.seller_reviews_count ?? 0,
    buyer_reviews_count: row?.buyer_reviews_count ?? 0,
    final_seller_score: fs,
    final_buyer_score: fb,
    final_seller_color: colorFor(fs),
    final_buyer_color: colorFor(fb),
    number_of_completed_deals: row?.number_of_completed_deals ?? 0,
  };
}

function isMissingTableError(error: { code?: string }): boolean {
  return error.code === "42P01";
}

const TABLE_NOT_READY = {
  error: "TABLE_NOT_READY",
  message:
    "The trust system tables are not present. Run migration 028_trust_rating_system.sql in Supabase.",
} as const;

// ─── GET /api/deals/me ──────────────────────────────────────────────────────

router.get("/deals/me", requireAuth, async (req, res) => {
  const callerId = req.user!.id;

  const { data, error } = await supabaseAdmin
    .from("auction_deals")
    .select(
      "id, auction_id, seller_id, buyer_id, winning_bid_id, winning_amount, status, seller_confirmation, buyer_confirmation, failed_by, completed_at, failed_at, created_at, updated_at",
    )
    .or(`seller_id.eq.${callerId},buyer_id.eq.${callerId}`)
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingTableError(error)) {
      logger.warn({ callerId }, "GET /deals/me: auction_deals missing — run migration 028");
      res.status(503).json(TABLE_NOT_READY);
      return;
    }
    logger.error({ err: error.message, callerId }, "GET /deals/me failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not fetch deals." });
    return;
  }

  res.json({
    deals: (data ?? []).map((d) => ({
      ...d,
      role: d.seller_id === callerId ? "seller" : "buyer",
    })),
  });
});

// ─── GET /api/deals/:dealId ─────────────────────────────────────────────────

router.get("/deals/:dealId", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const dealId = uuidSchema.safeParse(req.params["dealId"]);
  if (!dealId.success) {
    res.status(400).json({ error: "INVALID_ID", message: "dealId must be a UUID." });
    return;
  }

  const { data: deal, error } = await supabaseAdmin
    .from("auction_deals")
    .select(
      "id, auction_id, seller_id, buyer_id, winning_bid_id, winning_amount, status, seller_confirmation, buyer_confirmation, failed_by, completed_at, failed_at, created_at, updated_at",
    )
    .eq("id", dealId.data)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      res.status(503).json(TABLE_NOT_READY);
      return;
    }
    logger.error({ err: error.message, dealId: dealId.data }, "GET /deals/:id failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not fetch deal." });
    return;
  }
  if (!deal) {
    res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
    return;
  }
  if (deal.seller_id !== callerId && deal.buyer_id !== callerId) {
    res.status(403).json({ error: "FORBIDDEN", message: "Not a party to this deal." });
    return;
  }

  // Include caller's own rating (if any) so the UI can disable the form.
  const { data: ratings } = await supabaseAdmin
    .from("deal_ratings")
    .select("id, rater_id, ratee_id, role, f1, f2, f3, f4, f5, score, created_at")
    .eq("deal_id", deal.id);

  res.json({
    deal: { ...deal, role: deal.seller_id === callerId ? "seller" : "buyer" },
    ratings: ratings ?? [],
  });
});

// ─── POST /api/deals/:dealId/confirm ────────────────────────────────────────

const confirmSchema = z.object({
  outcome: z.enum(["completed", "failed"]),
});

router.post("/deals/:dealId/confirm", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const dealId = uuidSchema.safeParse(req.params["dealId"]);
  if (!dealId.success) {
    res.status(400).json({ error: "INVALID_ID", message: "dealId must be a UUID." });
    return;
  }
  const body = confirmSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({
      error: "INVALID_BODY",
      message: "outcome must be 'completed' or 'failed'.",
    });
    return;
  }

  const { data: deal, error: fetchErr } = await supabaseAdmin
    .from("auction_deals")
    .select("id, seller_id, buyer_id, status, seller_confirmation, buyer_confirmation")
    .eq("id", dealId.data)
    .maybeSingle();

  if (fetchErr) {
    if (isMissingTableError(fetchErr)) {
      res.status(503).json(TABLE_NOT_READY);
      return;
    }
    logger.error({ err: fetchErr.message }, "confirm: fetch failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load deal." });
    return;
  }
  if (!deal) {
    res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
    return;
  }

  const isSeller = deal.seller_id === callerId;
  const isBuyer = deal.buyer_id === callerId;
  if (!isSeller && !isBuyer) {
    res.status(403).json({ error: "FORBIDDEN", message: "Not a party to this deal." });
    return;
  }

  // Once a side has finalised (completed/failed), it cannot be flipped.
  const existing = isSeller ? deal.seller_confirmation : deal.buyer_confirmation;
  if (existing !== "pending") {
    res.status(409).json({
      error: "ALREADY_CONFIRMED",
      message: `You have already submitted a '${existing}' confirmation for this deal.`,
    });
    return;
  }

  const patch = isSeller
    ? { seller_confirmation: body.data.outcome }
    : { buyer_confirmation: body.data.outcome };

  const { error: updateErr } = await supabaseAdmin
    .from("auction_deals")
    .update(patch)
    .eq("id", deal.id);

  if (updateErr) {
    logger.error({ err: updateErr.message, dealId: deal.id }, "confirm: update failed");
    res.status(500).json({ error: "UPDATE_FAILED", message: "Could not record confirmation." });
    return;
  }

  // Recompute derived status via the SQL function (atomic + single source of truth).
  const { data: recomputed, error: rpcErr } = await supabaseAdmin.rpc("recompute_deal_status", {
    p_deal_id: deal.id,
  });

  if (rpcErr) {
    logger.error({ err: rpcErr.message, dealId: deal.id }, "confirm: recompute failed");
    res.status(500).json({ error: "RECOMPUTE_FAILED", message: "Confirmation saved but status not refreshed." });
    return;
  }

  res.json({ deal: recomputed });
});

// ─── POST /api/deals/:dealId/rate ───────────────────────────────────────────

const rateSchema = z.object({
  commitment: z.boolean(),
  communication: z.boolean(),
  // Field 3 + 4 names depend on the rater's role; accept either alias.
  authenticity: z.boolean().optional(),     // buyer rates seller
  seriousness: z.boolean().optional(),      // seller rates buyer
  accuracy: z.boolean().optional(),         // buyer rates seller
  timeliness: z.boolean().optional(),       // seller rates buyer
  experience: z.boolean(),
});

router.post("/deals/:dealId/rate", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const dealId = uuidSchema.safeParse(req.params["dealId"]);
  if (!dealId.success) {
    res.status(400).json({ error: "INVALID_ID", message: "dealId must be a UUID." });
    return;
  }
  const body = rateSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({
      error: "INVALID_BODY",
      message: "Required: commitment, communication, experience + (authenticity, accuracy) for buyers OR (seriousness, timeliness) for sellers — all booleans.",
      details: body.error.flatten(),
    });
    return;
  }

  const { data: deal, error: fetchErr } = await supabaseAdmin
    .from("auction_deals")
    .select("id, seller_id, buyer_id, status")
    .eq("id", dealId.data)
    .maybeSingle();

  if (fetchErr) {
    if (isMissingTableError(fetchErr)) {
      res.status(503).json(TABLE_NOT_READY);
      return;
    }
    logger.error({ err: fetchErr.message }, "rate: fetch failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load deal." });
    return;
  }
  if (!deal) {
    res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
    return;
  }

  const isSeller = deal.seller_id === callerId;
  const isBuyer = deal.buyer_id === callerId;
  if (!isSeller && !isBuyer) {
    res.status(403).json({ error: "FORBIDDEN", message: "Not a party to this deal." });
    return;
  }

  if (deal.status !== "completed") {
    res.status(409).json({
      error: "DEAL_NOT_COMPLETED",
      message: `Ratings allowed only after both sides confirm completion. Current status: ${deal.status}.`,
    });
    return;
  }

  // Resolve role-specific field 3/4 names.
  const role = isBuyer ? "buyer_rates_seller" : "seller_rates_buyer";
  const f3 = isBuyer ? body.data.authenticity : body.data.seriousness;
  const f4 = isBuyer ? body.data.accuracy : body.data.timeliness;
  if (typeof f3 !== "boolean" || typeof f4 !== "boolean") {
    res.status(400).json({
      error: "INVALID_BODY",
      message: isBuyer
        ? "Buyers must provide 'authenticity' and 'accuracy' booleans."
        : "Sellers must provide 'seriousness' and 'timeliness' booleans.",
    });
    return;
  }

  const ratee = isBuyer ? deal.seller_id : deal.buyer_id;

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("deal_ratings")
    .insert({
      deal_id: deal.id,
      rater_id: callerId,
      ratee_id: ratee,
      role,
      f1: body.data.commitment,
      f2: body.data.communication,
      f3,
      f4,
      f5: body.data.experience,
    })
    .select("id, rater_id, ratee_id, role, f1, f2, f3, f4, f5, score, created_at")
    .maybeSingle();

  if (insertErr) {
    // Unique violation = one rating per rater per deal.
    if (insertErr.code === "23505") {
      res.status(409).json({
        error: "ALREADY_RATED",
        message: "You have already submitted a rating for this deal.",
      });
      return;
    }
    logger.error({ err: insertErr.message, dealId: deal.id }, "rate: insert failed");
    res.status(500).json({ error: "INSERT_FAILED", message: "Could not save rating." });
    return;
  }

  res.status(201).json({ rating: inserted });
});

// ─── GET /api/users/me/trust ────────────────────────────────────────────────

router.get("/users/me/trust", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const { data, error } = await supabaseAdmin
    .from("user_trust_stats")
    .select("*")
    .eq("user_id", callerId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      res.status(503).json(TABLE_NOT_READY);
      return;
    }
    logger.error({ err: error.message, callerId }, "GET /users/me/trust failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load trust stats." });
    return;
  }

  res.json({ trust: shapeTrust(data as TrustRow | null) });
});

// ─── GET /api/users/:userId/trust ───────────────────────────────────────────

router.get("/users/:userId/trust", async (req, res) => {
  const userId = uuidSchema.safeParse(req.params["userId"]);
  if (!userId.success) {
    res.status(400).json({ error: "INVALID_ID", message: "userId must be a UUID." });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("user_trust_stats")
    .select("*")
    .eq("user_id", userId.data)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      res.status(503).json(TABLE_NOT_READY);
      return;
    }
    logger.error({ err: error.message, userId: userId.data }, "GET /users/:id/trust failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load trust stats." });
    return;
  }

  res.json({ trust: shapeTrust(data as TrustRow | null) });
});

export default router;
