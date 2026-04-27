import { Router, type IRouter } from "express";
import { google } from "googleapis";
import { logger } from "../lib/logger";
import { supabaseAdmin } from "../lib/supabase";

const PACKAGE_NAME = "com.bidreel.android";

const router: IRouter = Router();

router.post("/billing/verify", async (req, res) => {
  const { userId, purchaseToken, productId } = req.body as {
    userId: string;
    purchaseToken: string;
    productId: string;
  };

  // Never log the token — it is bearer-equivalent.
  logger.info(
    { userId, productId, hasPurchaseToken: Boolean(purchaseToken) },
    "billing/verify called",
  );

  // ── 1. Validate inputs ────────────────────────────────────────────────────
  if (!userId || !purchaseToken || !productId) {
    return res.status(400).json({
      success: false,
      error: "MISSING_FIELDS",
      message: "userId, purchaseToken and productId are required",
    });
  }

  // ── 2. Load service-account credentials ──────────────────────────────────
  const serviceAccountJson = process.env["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"];
  if (!serviceAccountJson) {
    logger.error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON env var is not set");
    return res.status(503).json({
      success: false,
      error: "BILLING_NOT_CONFIGURED",
      message: "Billing verification is not configured on this server",
    });
  }

  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(serviceAccountJson) as Record<string, unknown>;
  } catch {
    logger.error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON");
    return res.status(503).json({
      success: false,
      error: "BILLING_NOT_CONFIGURED",
      message: "Billing verification is not configured on this server",
    });
  }

  // ── 3. Call Google Play Developer API ────────────────────────────────────
  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/androidpublisher"],
    });

    const androidpublisher = google.androidpublisher({ version: "v3", auth });

    const { data } = await androidpublisher.purchases.subscriptions.get({
      packageName: PACKAGE_NAME,
      subscriptionId: productId,
      token: purchaseToken,
    });

    // purchaseState 0 = purchased/active.
    // expiryTimeMillis is a string of epoch-milliseconds from Google's API.
    const purchaseState = (data as { purchaseState?: number }).purchaseState;
    const expiryMs = Number(data.expiryTimeMillis ?? 0);
    const isPurchased = purchaseState === 0;
    const notExpired = expiryMs > Date.now();

    if (!isPurchased || !notExpired) {
      logger.info(
        { userId, productId, purchaseState, expiryMs },
        "billing/verify: purchase invalid or expired",
      );
      return res.status(402).json({
        success: false,
        error: "PURCHASE_INVALID",
        message: "Purchase is not valid or has expired",
      });
    }

    // ── 4. Grant premium in Supabase ────────────────────────────────────────
    const { error: dbError } = await supabaseAdmin
      .from("profiles")
      .update({ is_premium: true })
      .eq("id", userId);

    if (dbError) {
      logger.error(
        { err: dbError, userId },
        "billing/verify: failed to set is_premium",
      );
      return res.status(500).json({
        success: false,
        error: "DB_ERROR",
        message: "Failed to update subscription status",
      });
    }

    logger.info({ userId, productId }, "billing/verify: premium granted");
    return res.json({ success: true });

  } catch (err) {
    logger.error(
      { err: (err as Error).message, userId, productId },
      "billing/verify: Google API error",
    );
    return res.status(502).json({
      success: false,
      error: "GOOGLE_API_ERROR",
      message: "Failed to verify purchase with Google",
    });
  }
});

export default router;
