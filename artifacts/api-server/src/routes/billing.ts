/**
 * billing.ts — Google Play Subscription Verification (BidReel Plus)
 *
 * This module is COMPLETELY SEPARATE from the Secure Deals marketplace payment
 * system (google-play-billing.ts / play-verify.ts). It handles SUBS only.
 *
 * Endpoints:
 *   POST /billing/verify  — verify a Play subscription purchaseToken, grant premium
 *   POST /billing/restore — check if user's subscription is still active in DB
 *
 * Security:
 *   Both endpoints require a valid Supabase JWT (requireAuth).
 *   The authenticated user's ID from the JWT is always used.
 *   Any userId field sent in the request body is IGNORED to prevent
 *   privilege escalation (a user granting premium to a different account).
 *
 * Verification API:
 *   purchases.subscriptions.get — the correct endpoint for SUBS tokens.
 *   purchases.products.get is NOT used here (that is for INAPP one-time purchases).
 *
 * Restore logic:
 *   Checks profiles.is_premium. If true, the subscription is still active in
 *   our database and premium is confirmed. If false, the user needs to re-subscribe
 *   (Google Play will not charge them again if they have an active subscription).
 */

import { Router, type IRouter } from "express";
import { google }              from "googleapis";
import { logger }              from "../lib/logger";
import { supabaseAdmin }       from "../lib/supabase";
import { requireAuth }         from "../middlewares/requireAuth";

const PACKAGE_NAME = process.env["GOOGLE_PLAY_PACKAGE_NAME"] ?? "com.bidreel.android";

const router: IRouter = Router();

// ── Shared: load and validate service-account credentials ─────────────────────

interface Credentials { credentials: Record<string, unknown>; projectId: string }

function loadCredentials(): Credentials | null {
  const raw = process.env["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"];
  if (!raw) {
    logger.error("billing: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON secret is not set — subscription verification disabled");
    return null;
  }
  try {
    const credentials = JSON.parse(raw) as Record<string, unknown>;
    const projectId   = (credentials["project_id"] as string | undefined) ?? "unknown";
    return { credentials, projectId };
  } catch {
    logger.error("billing: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON — re-paste from Google Cloud Console");
    return null;
  }
}

// ── POST /billing/verify ──────────────────────────────────────────────────────

router.post("/billing/verify", requireAuth, async (req, res) => {
  // Always use the authenticated user — NEVER trust userId from body.
  const userId = req.user!.id;

  const { purchaseToken, productId } = req.body as {
    purchaseToken?: string;
    productId?:     string;
    userId?:        unknown; // ignored
  };

  // ── 1. Validate inputs ────────────────────────────────────────────────────
  if (!purchaseToken || !productId) {
    logger.warn({ userId, productId, hasPurchaseToken: Boolean(purchaseToken) },
      "billing/verify: missing purchaseToken or productId");
    return res.status(400).json({
      success: false,
      error:   "MISSING_FIELDS",
      message: "purchaseToken and productId are required.",
    });
  }

  // Never log the token — it is bearer-equivalent.
  logger.info({ userId, productId, hasPurchaseToken: true }, "billing/verify: request received");

  // ── 2. Load service-account credentials ──────────────────────────────────
  const creds = loadCredentials();
  if (!creds) {
    return res.status(503).json({
      success: false,
      error:   "BILLING_NOT_CONFIGURED",
      message: "Subscription verification is not available. Please contact support.",
    });
  }

  const { credentials, projectId } = creds;
  const env = process.env["NODE_ENV"] !== "production" ? "development" : "production";

  logger.info(
    { userId, productId, serviceProject: projectId, env, packageName: PACKAGE_NAME },
    "billing/verify: calling Google Play subscriptions.get",
  );

  // ── 3. Google Play Developer API — subscriptions.get ─────────────────────
  let playData: Record<string, any>;
  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/androidpublisher"],
    });
    const publisher = google.androidpublisher({ version: "v3", auth });

    const { data } = await publisher.purchases.subscriptions.get({
      packageName:    PACKAGE_NAME,
      subscriptionId: productId,
      token:          purchaseToken,
    });
    playData = data as Record<string, any>;
  } catch (apiErr: any) {
    const httpStatus = (apiErr?.response?.status as number | undefined) ?? 0;
    const reason     = (apiErr?.response?.data as any)?.error?.message
                    ?? apiErr?.message
                    ?? "unknown";
    logger.error(
      { userId, productId, httpStatus, reason, env },
      "billing/verify: purchases.subscriptions.get failed",
    );
    // 410 Gone = token permanently invalid (already consumed / revoked)
    return res.status(502).json({
      success: false,
      error:   "GOOGLE_API_ERROR",
      message: httpStatus === 410
        ? "Purchase token has expired or is no longer valid. Please subscribe again."
        : "Could not verify subscription with Google Play. Please try again.",
    });
  }

  // ── 4. Validate subscription state ───────────────────────────────────────
  const expiryMs          = Number(playData["expiryTimeMillis"] ?? 0);
  const notExpired        = expiryMs > 0 && expiryMs > Date.now();
  const cancelReason      = playData["cancelReason"]  as number | undefined;
  const paymentState      = playData["paymentState"]  as number | undefined;
  const autoRenewing      = playData["autoRenewing"]  as boolean | undefined;
  const cancelledAndExpired = cancelReason !== undefined && cancelReason !== null && !notExpired;

  logger.info(
    {
      userId,
      productId,
      env,
      expiresAt:    expiryMs > 0 ? new Date(expiryMs).toISOString() : null,
      notExpired,
      cancelReason: cancelReason  ?? null,
      paymentState: paymentState  ?? null,
      autoRenewing: autoRenewing  ?? null,
      startTimeMs:  playData["startTimeMillis"] ?? null,
      countryCode:  playData["countryCode"]     ?? null,
    },
    "billing/verify: Google Play subscription data received",
  );

  if (!notExpired || cancelledAndExpired) {
    logger.info(
      { userId, productId, expiryMs, cancelReason: cancelReason ?? null },
      "billing/verify: subscription inactive or expired — premium not granted",
    );
    return res.status(402).json({
      success: false,
      error:   "PURCHASE_INVALID",
      message: "Subscription is not active or has expired. Please subscribe again.",
    });
  }

  // ── 5. Grant premium in Supabase ──────────────────────────────────────────
  const { error: dbError } = await supabaseAdmin
    .from("profiles")
    .update({ is_premium: true })
    .eq("id", userId);

  if (dbError) {
    logger.error({ err: dbError, userId, productId }, "billing/verify: failed to set is_premium");
    return res.status(500).json({
      success: false,
      error:   "DB_ERROR",
      message: "Subscription verified but your account could not be updated. Please contact support.",
    });
  }

  logger.info({ userId, productId, env }, "billing/verify: premium granted successfully");
  return res.json({ success: true });
});

// ── POST /billing/restore ─────────────────────────────────────────────────────
//
// Checks whether the user's subscription is still active in our database
// and re-grants premium if it is.
//
// Common use case: user reinstalled the app — their is_premium is still true
// in Supabase, so the restore completes immediately.
//
// If is_premium is false: user is directed to re-subscribe. Google Play will
// not charge them again if they already have an active subscription on their
// Google account.

router.post("/billing/restore", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  logger.info({ userId }, "billing/restore: request received");

  try {
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("id, is_premium")
      .eq("id", userId)
      .single();

    if (profileErr) {
      logger.error({ err: profileErr, userId }, "billing/restore: could not load profile");
      return res.status(500).json({
        success: false,
        error:   "DB_ERROR",
        message: "Could not check your subscription status. Please try again.",
      });
    }

    if (profile?.is_premium) {
      logger.info({ userId }, "billing/restore: subscription is active in database — confirmed");
      return res.json({ success: true, restored: true });
    }

    logger.info({ userId }, "billing/restore: no active subscription found in database");
    return res.json({ success: false, restored: false, error: "no_active_subscription" });

  } catch (err: any) {
    logger.error({ err: err?.message ?? String(err), userId }, "billing/restore: unexpected error");
    return res.status(500).json({
      success: false,
      error:   "INTERNAL_ERROR",
      message: "An unexpected error occurred. Please try again.",
    });
  }
});

export default router;
