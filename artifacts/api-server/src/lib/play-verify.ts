/**
 * play-verify.ts
 *
 * Verifies a Google Play one-time in-app purchase (INAPP consumable) using
 * the Google Play Developer API (androidpublisher v3).
 *
 * Required environment:
 *   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON — service account JSON downloaded from
 *     Google Cloud Console (must have "Android Publisher" API access granted
 *     via Play Console → Setup → API access).
 *
 *   GOOGLE_PLAY_PACKAGE_NAME — optional override; defaults to com.bidreel.android.
 *
 * Flow (called from POST /api/transactions/pay-now):
 *   1. Parse service-account credentials from the secret.
 *   2. Authenticate as the service account (androidpublisher scope).
 *   3. GET purchases.products — assert purchaseState = 0 (purchased).
 *   4. Extract priceAmountMicros → paid_amount in major currency units.
 *   5. Consume the purchase so the product becomes re-purchasable.
 *
 * References:
 *   https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/get
 *   https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/consume
 */

import { google } from "googleapis";
import { logger } from "./logger";

const PACKAGE_NAME =
  process.env["GOOGLE_PLAY_PACKAGE_NAME"] ?? "com.bidreel.android";

export interface PlayPurchaseResult {
  paid_amount:      number;
  order_id:         string;
  purchase_state:   number;
  purchase_time_ms: number;
  region_code:      string;
  currency_code:    string;
}

/**
 * Verify a Google Play one-time purchase token and consume it.
 *
 * @param productId     - The in-app product ID (e.g. "secure_deal_payment").
 * @param purchaseToken - The token returned by the device after purchase.
 * @returns Verified purchase details including the actual charged amount.
 * @throws  If the service account is not configured, the token is invalid,
 *          or the purchase is not in the "purchased" state.
 */
export async function verifyPlayInAppPurchase(
  productId:     string,
  purchaseToken: string,
): Promise<PlayPurchaseResult> {
  const serviceAccountJson = process.env["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"];

  if (!serviceAccountJson) {
    throw new Error(
      "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON secret is not configured. " +
      "Add it via Replit Secrets to enable Play purchase verification.",
    );
  }

  let credentials: object;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error(
      "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON contains invalid JSON. " +
      "Re-paste the full service account key file from Google Cloud Console.",
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });

  const publisher = google.androidpublisher({ version: "v3", auth });

  // 1. Fetch purchase details
  let purchaseData: Record<string, any>;
  try {
    const response = await publisher.purchases.products.get({
      packageName: PACKAGE_NAME,
      productId,
      token: purchaseToken,
    });
    purchaseData = response.data as Record<string, any>;
  } catch (err: any) {
    const status  = err?.response?.status ?? 0;
    const reason  = (err?.response?.data as any)?.error?.message ?? err?.message ?? "unknown";
    logger.error({ productId, status, reason }, "play-verify: purchases.products.get failed");
    throw new Error(`Google Play token verification failed (${status}): ${reason}`);
  }

  // 2. Assert purchase state = 0 (Purchased)
  const purchaseState = (purchaseData["purchaseState"] as number | undefined) ?? -1;
  if (purchaseState !== 0) {
    const stateLabel = purchaseState === 1 ? "Canceled" : purchaseState === 2 ? "Pending" : `Unknown(${purchaseState})`;
    throw new Error(`Purchase not completed — state: ${stateLabel}. Token may have been refunded or is still pending.`);
  }

  // 3. Extract charged amount
  const microsCents      = parseInt(purchaseData["priceAmountMicros"] ?? "0", 10);
  const paid_amount      = microsCents / 1_000_000;
  const currency_code    = (purchaseData["priceCurrencyCode"] as string | undefined) ?? "USD";
  const order_id         = (purchaseData["orderId"]           as string | undefined) ?? "";
  const region_code      = (purchaseData["regionCode"]        as string | undefined) ?? "";
  const purchase_time_ms = parseInt(purchaseData["purchaseTimeMillis"] ?? "0", 10);

  logger.info(
    { productId, order_id, paid_amount, currency_code, purchaseState },
    "play-verify: purchase verified",
  );

  // 4. Consume the purchase (consumable product — required to allow re-purchase)
  //    Non-fatal: token is already verified and DB will be updated before this call.
  try {
    await publisher.purchases.products.consume({
      packageName: PACKAGE_NAME,
      productId,
      token: purchaseToken,
    });
    logger.info({ productId, order_id }, "play-verify: purchase consumed");
  } catch (err: any) {
    logger.warn(
      { err: err?.message, productId, order_id },
      "play-verify: failed to consume purchase (non-fatal — may already be consumed)",
    );
  }

  return { paid_amount, order_id, purchase_state: purchaseState, purchase_time_ms, region_code, currency_code };
}
