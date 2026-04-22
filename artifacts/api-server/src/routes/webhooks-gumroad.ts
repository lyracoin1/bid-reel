/**
 * Gumroad webhook ("Ping") receiver — the ONLY path that can flip an
 * auction_unlocks row from `pending` → `paid`.
 *
 * Trust model (real payment verification, replaces the old trust-on-claim):
 *   1. URL-path shared secret (`GUMROAD_WEBHOOK_SECRET`) gates the endpoint.
 *      Mismatched / missing secret → 404 (don't leak existence).
 *   2. Body must originate from OUR seller account
 *      (`product_permalink === GUMROAD_PRODUCT_PERMALINK`,
 *       optionally also `seller_id === GUMROAD_SELLER_ID` if configured).
 *   3. Body must carry our server-issued unlock_token
 *      (forwarded by Gumroad as `url_params[token]`).
 *   4. Token must resolve to an EXISTING `auction_unlocks` row whose
 *      `payment_status='pending'`. Anything else (unknown token, already-paid,
 *      refunded, etc.) → fail-closed with a logged 4xx and NO state change.
 *
 * Idempotency:
 *   • The (auction_id,user_id) row's UNIQUE constraint plus the new UNIQUE
 *     index on payment_reference (migration 035) means a duplicate Gumroad
 *     delivery hits a no-op branch (status already 'paid' with the same
 *     sale_id) and returns 200 "duplicate ignored" without re-touching state.
 *   • A Gumroad re-delivery with a DIFFERENT sale_id but the same token is
 *     rejected (the row has already been finalised) — protects against
 *     replay with forged sale_ids.
 *
 * Direct API calls cannot bypass this:
 *   • `POST /auctions/:id/unlock` is now a STATUS CHECK only — it never
 *     sets payment_status='paid'. Only this webhook can.
 */

import { Router, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "../lib/supabase";
import { logger } from "../lib/logger";
import { webhookLimiter } from "../middleware/rate-limit";

const router = Router();

// ─── Config (fail-closed if missing) ─────────────────────────────────────────
const WEBHOOK_SECRET   = process.env["GUMROAD_WEBHOOK_SECRET"] ?? "";
const PRODUCT_PERMALINK = process.env["GUMROAD_PRODUCT_PERMALINK"] ?? "frgfn";
const SELLER_ID         = process.env["GUMROAD_SELLER_ID"] ?? ""; // optional extra check

/** Constant-time string compare — defeats timing oracles on the URL secret. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Robustly extract the unlock token from a Gumroad Ping body.
 * Gumroad forwards URL params as either `url_params[token]` (express-parsed
 * into nested `url_params: { token }`) or, depending on parser depth, as a
 * literal flat key `"url_params[token]"`. Accept both shapes.
 * Also accept top-level `token` for hand-test convenience.
 */
function extractToken(body: Record<string, unknown>): string | null {
  const nested = body["url_params"];
  if (nested && typeof nested === "object" && nested !== null) {
    const t = (nested as Record<string, unknown>)["token"];
    if (typeof t === "string" && t.length > 0) return t;
  }
  const flat = body["url_params[token]"];
  if (typeof flat === "string" && flat.length > 0) return flat;
  const top = body["token"];
  if (typeof top === "string" && top.length > 0) return top;
  return null;
}

// ─── POST /api/webhooks/gumroad/:secret ──────────────────────────────────────
router.post("/webhooks/gumroad/:secret", webhookLimiter, async (req: Request, res: Response) => {
  // Layer 1: server-side config must be present, else fail-closed (503).
  if (!WEBHOOK_SECRET) {
    logger.error({}, "Gumroad webhook hit but GUMROAD_WEBHOOK_SECRET is not configured");
    res.status(503).json({ error: "WEBHOOK_NOT_CONFIGURED" });
    return;
  }

  // Layer 2: URL-path shared secret (constant-time compare).
  const presentedRaw = req.params["secret"];
  const presented = typeof presentedRaw === "string" ? presentedRaw : "";
  if (!safeEqual(presented, WEBHOOK_SECRET)) {
    // 404 (not 401) so an attacker cannot enumerate the endpoint by status.
    logger.warn({ ip: req.ip }, "Gumroad webhook: bad secret");
    res.status(404).json({ error: "NOT_FOUND" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;

  // Layer 3: must be a sale from OUR product. product_permalink is the
  // suffix of the Gumroad URL we already publish (.../l/frgfn).
  const permalink = typeof body["product_permalink"] === "string"
    ? (body["product_permalink"] as string)
    : null;
  if (permalink !== PRODUCT_PERMALINK) {
    logger.warn({ permalink }, "Gumroad webhook: wrong product_permalink");
    res.status(400).json({ error: "WRONG_PRODUCT" });
    return;
  }
  // Optional layer 4: also lock to a specific seller_id when configured.
  if (SELLER_ID) {
    const sellerId = typeof body["seller_id"] === "string" ? body["seller_id"] as string : null;
    if (sellerId !== SELLER_ID) {
      logger.warn({ sellerId }, "Gumroad webhook: wrong seller_id");
      res.status(400).json({ error: "WRONG_SELLER" });
      return;
    }
  }

  // Layer 5: extract our token from the URL params Gumroad forwards.
  const token = extractToken(body);
  if (!token) {
    logger.warn({ keys: Object.keys(body) }, "Gumroad webhook: no unlock_token in url_params");
    res.status(400).json({ error: "MISSING_TOKEN" });
    return;
  }

  const saleId = typeof body["sale_id"] === "string" ? (body["sale_id"] as string) : null;
  if (!saleId) {
    logger.warn({ token: token.slice(0, 8) }, "Gumroad webhook: missing sale_id");
    res.status(400).json({ error: "MISSING_SALE_ID" });
    return;
  }

  // Resolve the pending row by token. Service-role key → bypasses RLS.
  const { data: row, error: lookupErr } = await supabaseAdmin
    .from("auction_unlocks")
    .select("id, auction_id, user_id, payment_status, payment_reference")
    .eq("unlock_token", token)
    .maybeSingle();

  if (lookupErr) {
    logger.error({ err: lookupErr.message }, "Gumroad webhook: token lookup failed");
    res.status(500).json({ error: "LOOKUP_FAILED" });
    return;
  }
  if (!row) {
    logger.warn({ token: token.slice(0, 8) }, "Gumroad webhook: token does not match any pending unlock");
    res.status(404).json({ error: "TOKEN_NOT_FOUND" });
    return;
  }

  // Idempotency branch: same sale_id replayed by Gumroad → 200 no-op.
  if (row.payment_status === "paid" && row.payment_reference === saleId) {
    logger.info(
      { auctionId: row.auction_id, userId: row.user_id, saleId },
      "Gumroad webhook: duplicate delivery ignored (already paid with same sale_id)",
    );
    res.json({ ok: true, duplicate: true });
    return;
  }

  // Replay-with-different-sale_id guard: do not mutate a finalised row.
  if (row.payment_status === "paid" && row.payment_reference !== saleId) {
    logger.warn(
      { auctionId: row.auction_id, userId: row.user_id, existing: row.payment_reference, attempted: saleId },
      "Gumroad webhook: token already paid with different sale_id — refusing replay",
    );
    res.status(409).json({ error: "ALREADY_PAID" });
    return;
  }

  // Atomically flip the row from 'pending' → 'paid' ONLY if it is still
  // pending. The .eq("payment_status","pending") gate makes the UPDATE a
  // compare-and-swap, so two concurrent webhook deliveries cannot both
  // succeed — the second one's matched-rows count will be 0 and we treat
  // it as a duplicate. The UNIQUE index on payment_reference (migration
  // 035) is the second line of defence: even a same-instant racing UPDATE
  // with a forged sale_id would error out.
  const { data: updated, error: updErr } = await supabaseAdmin
    .from("auction_unlocks")
    .update({
      payment_status: "paid",
      can_bid: true,
      can_view_contact: true,
      payment_provider: "gumroad",
      payment_reference: saleId,
    })
    .eq("id", row.id)
    .eq("payment_status", "pending")
    .select("id, auction_id, user_id, created_at")
    .maybeSingle();

  if (updErr) {
    // Most likely a UNIQUE-violation on payment_reference — log and 409.
    logger.error(
      { err: updErr.message, code: updErr.code, saleId, token: token.slice(0, 8) },
      "Gumroad webhook: update failed",
    );
    res.status(409).json({ error: "UPDATE_CONFLICT" });
    return;
  }
  if (!updated) {
    // Row was no longer pending when we tried to flip it (another webhook
    // delivery raced us and won). That delivery has the row in the right
    // state — treat ours as a duplicate.
    logger.info(
      { auctionId: row.auction_id, userId: row.user_id, saleId },
      "Gumroad webhook: lost CAS race — row already finalised by a concurrent delivery",
    );
    res.json({ ok: true, duplicate: true });
    return;
  }

  logger.info(
    { auctionId: updated.auction_id, userId: updated.user_id, saleId, token: token.slice(0, 8) },
    "Gumroad webhook: pending → paid (verified)",
  );
  res.json({ ok: true, duplicate: false, auctionId: updated.auction_id });
});

export default router;
