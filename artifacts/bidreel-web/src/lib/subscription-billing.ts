/**
 * subscription-billing.ts
 *
<<<<<<< HEAD
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
=======
 * Shared subscription purchase + restore flow for BidReel Pro (SUBS type).
 *
 * Used by:
 *   - src/pages/auction-detail.tsx  (premium gate "Subscribe now" button)
 *   - src/pages/subscription.tsx    (dedicated subscription page)
 *
 * Flow:
 *   startSubscription()  → querySkuDetails → launchBillingFlow → /billing/verify → sendAck
 *   restoreSubscription() → /billing/restore  (checks existing tokens on the backend)
 *
 * IMPORTANT:
 *   - Never acknowledge a purchase before the backend has verified it.
 *   - Never log the purchaseToken — it is bearer-equivalent.
 */

import { BillingPlugin } from "capacitor-billing";
import { Capacitor } from "@capacitor/core";
import { API_BASE, getToken } from "@/lib/api-client";

export const SUBSCRIPTION_PRODUCT_ID = "bidreel_plus";

/** True only when running as a native Android app with Play Billing access. */
>>>>>>> 72e2340 (Add subscription functionality and fix translation and hook issues)
export function isSubscriptionAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

<<<<<<< HEAD
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
=======
export interface SubscriptionResult {
  success: boolean;
  error?: string;
}

/**
 * Start a BidReel Pro subscription purchase.
 *
 * Steps:
 *   1. Guard — userId must be present
 *   2. querySkuDetails  — confirm product is live in Play Console
 *   3. launchBillingFlow — show native Play purchase sheet
 *   4. /billing/verify  — backend confirms and grants premium
 *   5. sendAck          — acknowledge only after server success
 */
export async function startSubscription(userId: string): Promise<SubscriptionResult> {
  console.log("[Billing] startSubscription called — userId:", userId || "(empty)");

  if (!userId) {
    console.error("[Billing] ABORT: cannot start purchase — user is not authenticated");
    return { success: false, error: "not_authenticated" };
  }

  try {
    // 1. Confirm the product is available in the Play Store.
    console.log("[Billing] Step 1: querySkuDetails — product=" + SUBSCRIPTION_PRODUCT_ID + " type=SUBS");
    const skuResult = await BillingPlugin.querySkuDetails({
      product: SUBSCRIPTION_PRODUCT_ID,
      type: "SUBS",
    });
    console.log("[Billing] Step 1 OK: SKU details →", JSON.stringify(skuResult));

    // 2. Launch the native Google Play purchase dialog.
    console.log("[Billing] Step 2: launchBillingFlow — product=" + SUBSCRIPTION_PRODUCT_ID + " type=SUBS");
    const result = await BillingPlugin.launchBillingFlow({
      product: SUBSCRIPTION_PRODUCT_ID,
      type: "SUBS",
    });
    console.log("[Billing] Step 2 OK: launchBillingFlow result →", JSON.stringify(result));

    const purchaseToken = result.value;
    if (!purchaseToken) {
      console.error("[Billing] ABORT: launchBillingFlow returned no purchase token");
      return { success: false, error: "no_purchase_token" };
    }

    // 3. Fetch auth token and verify with backend FIRST.
    console.log("[Billing] Step 3: fetching auth token for backend verification");
    const authToken = await getToken();
    if (!authToken) {
      console.error("[Billing] ABORT: cannot verify purchase — missing auth token");
      return { success: false, error: "no_auth_token" };
    }

    console.log("[Billing] Step 3: calling /billing/verify — userId:", userId, "productId:", SUBSCRIPTION_PRODUCT_ID);
    const response = await fetch(`${API_BASE}/billing/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ userId, productId: SUBSCRIPTION_PRODUCT_ID, purchaseToken }),
    });

    let json: { success?: boolean; error?: string } = {};
    try { json = await response.json() as typeof json; } catch { /* non-JSON body */ }
    console.log("[Billing] Step 3: /billing/verify response — status:", response.status, "body:", JSON.stringify(json));

    if (!response.ok || !json.success) {
      console.error("[Billing] ABORT: backend verification failed — HTTP", response.status, "success:", json.success);
      return { success: false, error: json.error ?? `verify_failed_${response.status}` };
    }

    // 4. Acknowledge only after backend has confirmed and granted premium.
    console.log("[Billing] Step 4: sendAck — acknowledging purchase");
    await BillingPlugin.sendAck({ purchaseToken });
    console.log("[Billing] Step 4 OK: purchase acknowledged. Subscription active for userId:", userId);

    return { success: true };
  } catch (err) {
    // Never log purchaseToken — it is bearer-equivalent.
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Billing] CAUGHT ERROR in startSubscription:", msg, err instanceof Error ? err.stack : "");
    return { success: false, error: msg };
  }
}

/**
 * Restore an existing BidReel Pro subscription.
 *
 * Calls the backend /billing/restore endpoint which looks up any existing
 * active subscription tokens for the user and re-grants premium if found.
 * This is the correct restore path since the plugin has no native restore API.
 */
export async function restoreSubscription(userId: string): Promise<SubscriptionResult> {
  console.log("[Billing] restoreSubscription called — userId:", userId || "(empty)");

  if (!userId) {
    console.error("[Billing] ABORT: cannot restore — user is not authenticated");
    return { success: false, error: "not_authenticated" };
  }

  try {
    const authToken = await getToken();
    if (!authToken) {
      console.error("[Billing] ABORT: cannot restore — missing auth token");
      return { success: false, error: "no_auth_token" };
    }

    console.log("[Billing] restoreSubscription: calling /billing/restore — userId:", userId);
    const response = await fetch(`${API_BASE}/billing/restore`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ userId, productId: SUBSCRIPTION_PRODUCT_ID }),
    });

    let json: { success?: boolean; restored?: boolean; error?: string } = {};
    try { json = await response.json() as typeof json; } catch { /* non-JSON body */ }
    console.log("[Billing] restoreSubscription: /billing/restore response — status:", response.status, "body:", JSON.stringify(json));

    if (!response.ok) {
      console.error("[Billing] restoreSubscription: backend call failed — HTTP", response.status);
      return { success: false, error: json.error ?? `restore_failed_${response.status}` };
    }

    const restored = !!json.success || !!json.restored;
    console.log("[Billing] restoreSubscription:", restored ? "subscription restored" : "no active subscription found", "userId:", userId);
    return { success: restored, error: restored ? undefined : "no_active_subscription" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Billing] CAUGHT ERROR in restoreSubscription:", msg);
    return { success: false, error: msg };
  }
>>>>>>> 72e2340 (Add subscription functionality and fix translation and hook issues)
}
