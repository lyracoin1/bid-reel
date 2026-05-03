/**
 * buyer-info.ts — Hide Buyer Info Until Payment Confirmed
 *
 * Endpoints:
 *   POST /api/deal/show-buyer-info           — seller reveals buyer contact info
 *   GET  /api/deal/buyer-info/:dealId        — fetch revealed buyer contact info
 *
 * Access matrix:
 *   POST: only the deal's seller, only when payment_status = 'secured'
 *   GET:
 *     • buyer    → always sees own profile (their info)
 *     • seller   → sees buyer profile only after buyer_info_visible = TRUE
 *     • admin    → always sees buyer profile
 *
 * Security:
 *   • seller_id / buyer_id always taken from verified JWT (no spoofing)
 *   • Double-reveal is idempotent (200 OK, no error)
 *   • Escrow status also accepted as confirmation (status = 'released')
 */

import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { pool } from "../lib/pg-pool";
import { supabaseAdmin } from "../lib/supabase";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Fetch buyer's contact profile from Supabase ───────────────────────────────

async function resolveBuyerProfile(buyerId: string) {
  try {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, username, phone, avatar_url, location")
      .eq("id", buyerId)
      .maybeSingle();

    if (error || !data) return null;
    return {
      id:           (data as any).id           ?? null,
      display_name: (data as any).display_name ?? null,
      username:     (data as any).username     ?? null,
      phone:        (data as any).phone        ?? null,
      avatar_url:   (data as any).avatar_url   ?? null,
      location:     (data as any).location     ?? null,
    };
  } catch {
    return null;
  }
}

// ── POST /api/deal/show-buyer-info ────────────────────────────────────────────
// Seller calls this after payment is confirmed.
// Idempotent — second call still returns 200 OK.

router.post("/deal/show-buyer-info", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const dealId   = String(req.body?.deal_id ?? "").trim();

  if (!dealId) {
    res.status(400).json({ error: "MISSING_DEAL_ID", message: "deal_id is required in the request body." });
    return;
  }

  try {
    // 1. Load deal
    const { rows } = await pool.query(
      `SELECT seller_id, buyer_id, payment_status, buyer_info_visible
       FROM transactions WHERE deal_id = $1`,
      [dealId],
    );

    if (!rows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const deal = rows[0];

    // 2. Only the seller can reveal buyer info
    if (deal.seller_id !== callerId) {
      res.status(403).json({
        error:   "NOT_SELLER",
        message: "Only the deal's seller can reveal buyer info.",
      });
      return;
    }

    // 3. Idempotent — already revealed
    if (deal.buyer_info_visible) {
      res.json({ success: true, visible: true, already_revealed: true });
      return;
    }

    // 4. Payment must be confirmed (secured) — also accept if escrow is released
    if (deal.payment_status !== "secured") {
      // Check escrow as fallback
      const { rows: escrowRows } = await pool.query(
        `SELECT status FROM escrow WHERE deal_id = $1`,
        [dealId],
      );
      const escrowReleased = escrowRows.length > 0 && escrowRows[0].status === "released";
      if (!escrowReleased) {
        res.status(402).json({
          error:   "PAYMENT_NOT_CONFIRMED",
          message: "Buyer info can only be revealed after payment is confirmed.",
        });
        return;
      }
    }

    // 5. Set buyer_info_visible = TRUE
    await pool.query(
      `UPDATE transactions SET buyer_info_visible = TRUE, updated_at = NOW()
       WHERE deal_id = $1`,
      [dealId],
    );

    logger.info({ dealId, sellerId: callerId }, "buyer-info: revealed");

    res.json({ success: true, visible: true });
  } catch (err) {
    logger.error({ err, dealId, callerId }, "POST /deal/show-buyer-info failed");
    res.status(500).json({ error: "REVEAL_FAILED", message: "Could not reveal buyer info." });
  }
});

// ── GET /api/deal/buyer-info/:dealId ─────────────────────────────────────────
// Returns the buyer's contact profile.
// Access: buyer (own profile always) | seller (only if buyer_info_visible=true) | admin (always)

router.get("/deal/buyer-info/:dealId", requireAuth, async (req, res) => {
  const callerId         = req.user!.id;
  const { dealId }       = req.params;

  try {
    // 1. Load deal
    const { rows } = await pool.query(
      `SELECT seller_id, buyer_id, payment_status, buyer_info_visible
       FROM transactions WHERE deal_id = $1`,
      [dealId],
    );

    if (!rows.length) {
      res.status(404).json({ error: "NOT_FOUND", message: "Deal not found." });
      return;
    }

    const deal = rows[0];

    if (!deal.buyer_id) {
      res.status(404).json({ error: "NO_BUYER", message: "No buyer has been assigned to this deal yet." });
      return;
    }

    const isBuyer  = deal.buyer_id  === callerId;
    const isSeller = deal.seller_id === callerId;

    if (!isBuyer && !isSeller) {
      // Check admin
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

    // 2. For seller: only if buyer_info_visible = TRUE
    if (isSeller && !deal.buyer_info_visible) {
      res.status(403).json({
        error:   "BUYER_INFO_HIDDEN",
        message: "Buyer info is not yet revealed. Reveal it after payment is confirmed.",
        visible: false,
      });
      return;
    }

    // 3. Fetch buyer profile from Supabase
    const buyerProfile = await resolveBuyerProfile(deal.buyer_id);

    if (!buyerProfile) {
      res.status(404).json({ error: "PROFILE_NOT_FOUND", message: "Buyer profile not found." });
      return;
    }

    res.json({
      visible:       deal.buyer_info_visible,
      buyer_profile: buyerProfile,
    });
  } catch (err) {
    logger.error({ err, dealId, callerId }, "GET /deal/buyer-info/:dealId failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load buyer info." });
  }
});

export default router;
