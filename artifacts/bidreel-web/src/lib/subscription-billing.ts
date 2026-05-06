/**
 * subscription-billing.ts
 *
 * Subscription purchase flow for BidReel Pro (SUBS type).
 *
 * Used by:
 *   - src/pages/auction-detail.tsx  (premium gate "Subscribe now" button)
 *   - src/pages/subscription.tsx    (dedicated subscription page)
 *
 * Flow:
 *   startSubscription() → querySkuDetails → launchBillingFlow → /billing/verify → sendAck
 *
 * IMPORTANT:
 *   - Never acknowledge a purchase before the backend has verified it.
 *   - Never log the purchaseToken — it is bearer-equivalent.
 *   - Backend now uses requireAuth — userId is derived from the JWT, not the body.
 *
 * Error codes returned in SubscriptionResult.error:
 *   not_authenticated        — user not signed in
 *   no_auth_token            — session expired
 *   no_offer_token           — Play Console base plan has no active offer
 *   no_purchase_token        — purchase resolved without a token
 *   subscription_pending     — payment method requires additional steps; purchase is in PENDING state
 *   play_purchase_empty      — code=OK but Google Play returned no purchase object
 *   play_user_canceled       — user dismissed the Play sheet (BillingResponseCode=1)
 *   play_service_unavailable — Google Play service temporarily down (code=2)
 *   play_billing_unavailable — payment method / region issue (code=3)
 *   play_item_unavailable    — product not available in this region (code=4)
 *   play_developer_error     — Play Console misconfiguration (code=5)
 *   play_item_already_owned  — user already has this subscription (code=7)
 *   play_error               — generic Play error (code=6 or unknown code)
 *   BILLING_NOT_CONFIGURED   — server secret not set
 *   PURCHASE_INVALID         — subscription expired or cancelled
 *   GOOGLE_API_ERROR         — server could not reach Google Play API
 *   DB_ERROR                 — server could not update the profile
 */

import { BillingPlugin } from "capacitor-billing";
import { Capacitor }     from "@capacitor/core";
import { API_BASE, getToken } from "@/lib/api-client";

export const SUBSCRIPTION_PRODUCT_ID = "bidreel_plus";

/** True only when running as a native Android app with Play Billing access. */
export function isSubscriptionAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export interface SubscriptionResult {
  success: boolean;
  error?:  string;
}

// ── Error code parser ─────────────────────────────────────────────────────────
// The capacitor-billing plugin rejects with messages in the form:
//   "Purchase canceled"
//   "Error during purchase: [debug msg] (code=N)"
//   "Billing service not connected (code=N)"
//   "No valid offerToken for basePlanId=..."
// We extract the code and return a structured error key the UI can map.

function parseBillingError(rawMessage: string): string {
  // Explicit user cancel (no code suffix in the plugin's message)
  if (rawMessage === "Purchase canceled") return "play_user_canceled";

  const codeMatch = /\(code=(\d+)\)/.exec(rawMessage);
  if (codeMatch) {
    const code = parseInt(codeMatch[1], 10);
    switch (code) {
      case 1: return "play_user_canceled";
      case 2: return "play_service_unavailable";
      case 3: return "play_billing_unavailable";
      case 4: return "play_item_unavailable";
      case 5: return "play_developer_error";
      case 6: return "play_error";
      case 7: return "play_item_already_owned";
      case 8: return "play_item_not_owned";
      default: return `play_error_${code}`;
    }
  }

  // Offer token guard from the plugin
  if (rawMessage.includes("offerToken") || rawMessage.includes("offer details")) {
    console.error(
      "[Billing][DIAG] parseBillingError → no_offer_token via offerToken/offer-details match."
      + " raw_message=\"" + rawMessage + "\""
      + " PATH=B (plugin rejected during querySkuDetails or launchBillingFlow)",
    );
    return "no_offer_token";
  }

  // PENDING purchase — payment method requires additional steps in Google Play
  if (rawMessage === "SUBSCRIPTION_PENDING" || rawMessage.includes("pending")) {
    return "subscription_pending";
  }

  // code=OK but Google Play returned no purchase object
  if (rawMessage === "PLAY_PURCHASE_EMPTY") {
    return "play_purchase_empty";
  }

  return "play_error";
}

// ── startSubscription ─────────────────────────────────────────────────────────

/**
 * Start a BidReel Pro subscription purchase.
 *
 * Steps:
 *   1. Guard — userId must be present
 *   2. querySkuDetails  — confirm product is live in Play Console + offer token present
 *   3. launchBillingFlow — show native Play purchase sheet
 *   4. /billing/verify  — backend confirms and grants premium (uses JWT, not body userId)
 *   5. sendAck          — acknowledge only after server success
 */
export async function startSubscription(userId: string): Promise<SubscriptionResult> {
  console.log("[Billing] startSubscription — userId:", userId || "(empty)");

  if (!userId) {
    console.error("[Billing] ABORT: user is not authenticated");
    return { success: false, error: "not_authenticated" };
  }

  // ── Step 1: querySkuDetails ───────────────────────────────────────────────
  console.log("[Billing] Step 1: querySkuDetails — product=" + SUBSCRIPTION_PRODUCT_ID + " type=SUBS");

  let sku: {
    productId?:         string;
    title?:             string;
    price?:             string;
    currency_code?:     string;
    billing_period?:    string;
    offer_count?:       number;
    base_plan_id?:      string;
    offer_id?:          string;
    offer_token_present?: boolean;
  };

  try {
    const skuResult = await BillingPlugin.querySkuDetails({
      product: SUBSCRIPTION_PRODUCT_ID,
      type:    "SUBS",
    });
    sku = skuResult as unknown as typeof sku;
  } catch (skuErr) {
    const msg = skuErr instanceof Error ? skuErr.message : String(skuErr);
    console.error("[Billing] Step 1 FAILED — querySkuDetails rejected:", msg);
    return { success: false, error: parseBillingError(msg) };
  }

  console.log(
    "[Billing] Step 1 OK:"
    + " productId="        + (sku.productId       ?? "?")
    + " title="            + (sku.title            ?? "?")
    + " price="            + (sku.price            ?? "?")
    + " currency="         + (sku.currency_code    ?? "?")
    + " billing_period="   + (sku.billing_period   ?? "?")
    + " offer_count="      + (sku.offer_count      ?? "?")
    + " base_plan_id="     + (sku.base_plan_id     ?? "?")
    + " offer_id="         + (sku.offer_id         ?? "?")
    + " offer_token_present=" + (sku.offer_token_present ?? "?"),
  );

  if (!sku.offer_token_present) {
    console.error(
      "[Billing][DIAG] → no_offer_token."
      + " PATH=A (querySkuDetails resolved but subscriptionOfferDetails empty)."
      + " offer_count=" + (sku.offer_count ?? "undefined")
      + " base_plan_id=" + (sku.base_plan_id ?? "undefined")
      + " offer_id=" + (sku.offer_id ?? "undefined")
      + " productId=" + (sku.productId ?? "undefined")
      + " price=" + (sku.price ?? "undefined")
      + " FIX: Check Play Console → bidreel_plus → Base plans & offers."
      + " Ensure at least one base plan is ACTIVE and has a published offer.",
    );
    return { success: false, error: "no_offer_token" };
  }

  // ── Step 2: launchBillingFlow ─────────────────────────────────────────────
  console.log("[Billing] Step 2: launchBillingFlow — product=" + SUBSCRIPTION_PRODUCT_ID + " type=SUBS");

  let purchaseToken: string | undefined;
  try {
    const result = await BillingPlugin.launchBillingFlow({
      product: SUBSCRIPTION_PRODUCT_ID,
      type:    "SUBS",
    });

    // Plugin resolves with purchase.getOriginalJson() — contains purchaseToken field.
    const parsed = result as unknown as {
      purchaseToken?: string;
      orderId?:       string;
      purchaseState?: number;
    };

    console.log(
      "[Billing] Step 2 OK — purchaseState:", parsed.purchaseState,
      "orderId:", parsed.orderId ?? "?",
      "hasPurchaseToken:", Boolean(parsed.purchaseToken),
    );

    purchaseToken = parsed.purchaseToken;
  } catch (flowErr) {
    const msg = flowErr instanceof Error ? flowErr.message : String(flowErr);
    const code = parseBillingError(msg);
    console.error("[Billing] Step 2 FAILED — launchBillingFlow rejected:", msg, "→ code:", code);
    return { success: false, error: code };
  }

  if (!purchaseToken) {
    console.error("[Billing] ABORT: launchBillingFlow resolved without a purchaseToken");
    return { success: false, error: "no_purchase_token" };
  }

  // ── Step 3: get auth token ────────────────────────────────────────────────
  const authToken = await getToken();
  if (!authToken) {
    console.error("[Billing] ABORT: missing auth token — session may have expired");
    return { success: false, error: "no_auth_token" };
  }

  // ── Step 4: backend verification (BEFORE acknowledgement) ────────────────
  // Backend uses requireAuth — userId is taken from the JWT, not the body.
  // We still pass productId for the API to use as subscriptionId.
  console.log("[Billing] Step 4: calling /billing/verify — productId:", SUBSCRIPTION_PRODUCT_ID);

  let verifyJson: { success?: boolean; error?: string } = {};
  let verifyOk = false;
  try {
    const response = await fetch(`${API_BASE}/billing/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${authToken}`,
      },
      body: JSON.stringify({ productId: SUBSCRIPTION_PRODUCT_ID, purchaseToken }),
    });

    try { verifyJson = await response.json() as typeof verifyJson; } catch { /* non-JSON */ }
    console.log("[Billing] Step 4: /billing/verify — HTTP", response.status, "success:", verifyJson.success, "error:", verifyJson.error ?? "(none)");
    verifyOk = response.ok && verifyJson.success === true;
  } catch (fetchErr) {
    const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    console.error("[Billing] Step 4 FAILED — fetch error:", msg);
    return { success: false, error: "play_error" };
  }

  if (!verifyOk) {
    console.error("[Billing] ABORT: backend verification failed — error:", verifyJson.error ?? "unknown");
    return { success: false, error: verifyJson.error ?? "play_error" };
  }

  // ── Step 5: acknowledge (only after successful backend verification) ───────
  console.log("[Billing] Step 5: sendAck");
  try {
    await BillingPlugin.sendAck({ purchaseToken });
    console.log("[Billing] Step 5 OK: purchase acknowledged — BidReel Pro active for userId:", userId);
  } catch (ackErr) {
    // Acknowledgement failure is non-fatal: backend already granted premium.
    // Google will retry ack for up to 3 days before auto-refunding.
    const msg = ackErr instanceof Error ? ackErr.message : String(ackErr);
    console.warn("[Billing] Step 5 WARNING: sendAck failed (non-fatal — premium already granted):", msg);
  }

  return { success: true };
}

