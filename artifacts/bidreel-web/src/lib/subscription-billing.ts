/**
 * subscription-billing.ts
 *
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
export function isSubscriptionAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

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

    // The plugin's TypeScript definition incorrectly declares the resolved shape as
    // { value: string }. The Java side resolves with `new JSObject(purchase.getOriginalJson())`
    // whose fields are the standard Play Purchase JSON: orderId, purchaseToken, productIds, etc.
    // Capacitor's bridge passes that object directly to JS, so the real field is `purchaseToken`.
    const purchaseResult = result as unknown as {
      purchaseToken?: string;
      orderId?: string;
      purchaseState?: number;
    };
    console.log("[Billing] Step 2 parsed — purchaseState:", purchaseResult.purchaseState, "orderId:", purchaseResult.orderId);

    const purchaseToken = purchaseResult.purchaseToken;
    if (!purchaseToken) {
      console.error("[Billing] ABORT: launchBillingFlow resolved without a purchaseToken — raw result:", JSON.stringify(result));
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
}
