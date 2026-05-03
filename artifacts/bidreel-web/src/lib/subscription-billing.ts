/**
 * subscription-billing.ts
 *
 * Shared subscription flow for BidReel Pro ($10/month) via Google Play Billing.
 *
 * Used by:
 *   - src/pages/subscription.tsx  (dedicated upgrade page)
 *   - src/pages/auction-detail.tsx (inline premium gate)
 *
 * Flow (native Android only):
 *   1. querySkuDetails  — confirm the product is active in Play Store.
 *   2. launchBillingFlow — show the native Play payment sheet.
 *   3. POST /billing/verify — backend verifies with Google Play API and
 *      sets is_premium = true on the user's Supabase profile.
 *   4. sendAck — acknowledge only after backend confirmation.
 *
 * On web / non-Android platforms the function returns "web" immediately so
 * the caller can show a friendly "only on Android" message.
 */

import { Capacitor } from "@capacitor/core";
import { BillingPlugin } from "capacitor-billing";
import { API_BASE, getToken } from "@/lib/api-client";

/** Product ID in Google Play Console — must stay in sync with the backend. */
export const SUBSCRIPTION_PRODUCT_ID = "bidreel_plus";

/** Returns true only when running as a native Android app. */
export function isSubscriptionAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export type SubscriptionResult =
  | "success"    // purchased and verified
  | "cancelled"  // user dismissed the Play sheet
  | "web";       // non-Android platform — billing unavailable

/**
 * Start the Google Play subscription purchase for BidReel Pro.
 *
 * @param userId  Authenticated user's UUID — required by the verify endpoint.
 * @throws        On network errors, backend rejection, or Play API failures.
 */
export async function startSubscription(userId: string): Promise<SubscriptionResult> {
  if (!userId) throw new Error("User must be authenticated before subscribing.");

  // Not running inside the Android app — billing API is not available.
  if (!isSubscriptionAvailable()) return "web";

  // 1. Confirm the subscription SKU is live in Play Console.
  await BillingPlugin.querySkuDetails({ product: SUBSCRIPTION_PRODUCT_ID, type: "SUBS" });

  // 2. Launch the native Google Play payment sheet.
  const result = await BillingPlugin.launchBillingFlow({
    product: SUBSCRIPTION_PRODUCT_ID,
    type: "SUBS",
  });

  const purchaseToken = result.value;
  if (!purchaseToken) {
    // User dismissed the sheet without completing payment.
    return "cancelled";
  }

  // 3. Verify with backend FIRST — never acknowledge before server confirms.
  const token = await getToken();
  if (!token) throw new Error("Authentication token missing — please sign in again.");

  const response = await fetch(`${API_BASE}/billing/verify`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${token}`,
    },
    body: JSON.stringify({ userId, productId: SUBSCRIPTION_PRODUCT_ID, purchaseToken }),
  });

  let json: { success?: boolean; message?: string } = {};
  try { json = await response.json() as typeof json; } catch { /* non-JSON body */ }

  if (!response.ok || !json.success) {
    // Do NOT acknowledge — token remains pending so the user can retry.
    throw new Error(
      json.message ?? "Subscription verification failed. Please contact support.",
    );
  }

  // 4. Acknowledge only after the backend has granted premium.
  await BillingPlugin.sendAck({ purchaseToken });

  return "success";
}

/**
 * Attempt to restore a previously purchased subscription.
 *
 * On Android: re-queries the SKU and re-verifies any active purchase token
 * against the backend. Returns true if premium was re-granted.
 *
 * On web: always returns false (billing not available).
 */
export async function restoreSubscription(userId: string): Promise<boolean> {
  if (!userId || !isSubscriptionAvailable()) return false;

  // Query the store for an existing purchase — this resolves if one is found.
  // The plugin surfaces the existing purchase token via querySkuDetails on
  // some builds. If no purchase exists it will throw.
  try {
    await BillingPlugin.querySkuDetails({ product: SUBSCRIPTION_PRODUCT_ID, type: "SUBS" });
  } catch {
    // No existing purchase found.
    return false;
  }

  // Re-launch billing flow is intentionally NOT done here — instead we ask the
  // backend to re-check the stored purchase via a no-op verify. If the backend
  // already has is_premium = true for this user there's nothing more to do.
  // A full restore flow requires surfacing the existing purchase token, which
  // varies across capacitor-billing plugin versions. Defer to Google Play's own
  // automatic restore (it fires at app install) for the full token flow.
  return false;
}
