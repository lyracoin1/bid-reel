/**
 * google-play-billing.ts
 *
 * Thin TypeScript bridge over the `capacitor-billing` plugin for
 * one-time in-app purchases (INAPP consumable) used by the Secure Deals
 * Pay Now flow.
 *
 * This module is separate from the subscription flow in auction-detail.tsx
 * which uses type "SUBS". The Secure Deal payment uses type "INAPP" and a
 * dedicated consumable product created in the Play Console.
 *
 * PLAY CONSOLE SETUP (one-time, done by the developer):
 *   1. Open Play Console → your app → Monetise → In-app products.
 *   2. Create a new "Managed product" (one-time, consumable):
 *        Product ID : secure_deal_payment   (must match SECURE_DEAL_PRODUCT_ID)
 *        Name       : Secure Deal Payment
 *        Pricing    : set the price that matches your deal price tier(s).
 *        Status     : Active
 *   3. Wait ~1 hour for the product to propagate to the sandbox.
 *   4. Add internal testers or use the "License test accounts" in Play Console
 *      to exercise the sandbox purchase flow without real charges.
 *
 * DYNAMIC PRICING NOTE:
 *   Google Play does not support per-deal runtime pricing. The price shown in
 *   the Play payment sheet is the one configured in Play Console for the SKU.
 *   The actual charged amount is verified server-side from priceAmountMicros
 *   and stored as paid_amount. For multi-tier pricing, create separate SKUs
 *   (e.g. secure_deal_payment_10, secure_deal_payment_50 …) and select the
 *   closest one to the buyer's requested amount.
 *
 * ACKNOWLEDGEMENT CONTRACT:
 *   Do NOT call acknowledgeDealPurchase() before the backend has verified and
 *   recorded the token. Google will auto-refund unacknowledged purchases after
 *   3 days.
 */

import { Capacitor } from "@capacitor/core";
import { BillingPlugin } from "capacitor-billing";

/** Default consumable product ID — must match the one in Play Console. */
export const SECURE_DEAL_PRODUCT_ID = "secure_deal_payment";

export interface DealPurchaseResult {
  purchase_token: string;
  product_id:     string;
}

/**
 * Returns true when running as a native Android app with access to
 * the Google Play Billing API.
 *
 * Always false in a browser / web preview.
 */
export function isPlayBillingAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

/**
 * Launch the Google Play one-time payment sheet for a secure deal.
 *
 * Steps:
 *   1. querySkuDetails  — confirm the product is active in Play Console.
 *   2. launchBillingFlow — display the native Play payment dialog.
 *   3. Return the purchase_token (do NOT acknowledge here).
 *
 * @param productId  Defaults to SECURE_DEAL_PRODUCT_ID. Override to select a
 *                   different price-tier SKU.
 * @throws           If the product is unavailable, the user cancels, or the
 *                   Play Billing API returns an error.
 */
export async function purchaseDealProduct(
  productId = SECURE_DEAL_PRODUCT_ID,
): Promise<DealPurchaseResult> {
  // 1. Confirm the product is live and purchasable in Play Console
  await BillingPlugin.querySkuDetails({ product: productId, type: "INAPP" });

  // 2. Show the native Google Play payment sheet
  const result = await BillingPlugin.launchBillingFlow({ product: productId, type: "INAPP" });

  const purchaseToken = result.value;
  if (!purchaseToken) {
    throw new Error("Google Play returned an empty purchase token.");
  }

  return { purchase_token: purchaseToken, product_id: productId };
}

/**
 * Acknowledge the purchase AFTER the backend has verified the token and
 * updated the database. Must be called within 3 days of purchase.
 *
 * @param purchaseToken  The token returned by purchaseDealProduct().
 */
export async function acknowledgeDealPurchase(purchaseToken: string): Promise<void> {
  await BillingPlugin.sendAck({ purchaseToken });
}
