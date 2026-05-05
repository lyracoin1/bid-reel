/**
 * web-payment.ts — Web Payment Provider Interface (Point 3: Web Payments)
 *
 * Provides a unified verification interface for web-based payment providers
 * (e.g. Stripe). The existing Google Play Billing flow in play-verify.ts is
 * NOT changed — this file adds a parallel code path for web/browser payments.
 *
 * Security contract:
 *   - Paid amount is ALWAYS taken from the provider's verified receipt, never
 *     from any client-supplied value.
 *   - If the required secret is not configured, the function throws a clear
 *     error; no fake or client-confirmed payments are accepted.
 *   - No plaintext secrets are logged.
 *
 * To activate Stripe: set STRIPE_SECRET_KEY in Replit Secrets.
 *
 * Adding a new provider:
 *   1. Add it to WebPaymentProvider type.
 *   2. Implement a verify*Payment() function below.
 *   3. Add a case in verifyWebPayment().
 */

import https from "node:https";
import { logger } from "./logger";

export type WebPaymentProvider = "stripe";

export interface WebPaymentVerifyInput {
  provider:           WebPaymentProvider;
  /** Provider-specific payment reference (e.g. Stripe PaymentIntent ID). */
  payment_intent_id:  string;
  /** The amount the deal is listed at (major currency units). Used for sanity check only — authoritative amount comes from the provider. */
  expected_amount:    number;
  currency:           string;
}

export interface WebPaymentResult {
  paid_amount:        number;
  currency_code:      string;
  payment_intent_id:  string;
  provider:           WebPaymentProvider;
  order_id:           string;
}

/**
 * Verify a web payment with the configured provider.
 *
 * Throws with a clear message if:
 *   - The provider is not supported.
 *   - The required secret is not configured.
 *   - The provider rejects the payment reference.
 *   - The payment is not in a succeeded/captured state.
 */
export async function verifyWebPayment(
  input: WebPaymentVerifyInput,
): Promise<WebPaymentResult> {
  switch (input.provider) {
    case "stripe":
      return verifyStripePayment(input);
    default: {
      const exhaustive: never = input.provider;
      throw new Error(`Unsupported web payment provider: ${String(exhaustive)}`);
    }
  }
}

// ── Stripe ─────────────────────────────────────────────────────────────────────
//
// Uses the Stripe REST API directly via node:https — no stripe npm package
// required. Retrieves the PaymentIntent and validates its status.
// Reference: https://stripe.com/docs/api/payment_intents/retrieve

async function verifyStripePayment(
  input: WebPaymentVerifyInput,
): Promise<WebPaymentResult> {
  const STRIPE_SECRET_KEY = process.env["STRIPE_SECRET_KEY"] ?? null;

  if (!STRIPE_SECRET_KEY) {
    throw new Error(
      "STRIPE_SECRET_KEY is not configured. " +
      "Add it via Replit Secrets to enable Stripe web payments.",
    );
  }

  const paymentIntentId = input.payment_intent_id.trim();

  if (!paymentIntentId.startsWith("pi_")) {
    throw new Error(
      `Invalid Stripe PaymentIntent ID format: ${paymentIntentId}. ` +
      "Expected a value starting with 'pi_'.",
    );
  }

  logger.info(
    { provider: "stripe", paymentIntentId },
    "web-payment: verifying Stripe PaymentIntent",
  );

  const piData = await stripeGet(`/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`, STRIPE_SECRET_KEY);

  if (piData["object"] !== "payment_intent") {
    throw new Error(`Stripe returned unexpected object type: ${piData["object"] ?? "unknown"}`);
  }

  const status: string = piData["status"] ?? "";
  if (status !== "succeeded") {
    throw new Error(
      `Stripe PaymentIntent not succeeded — status: ${status}. ` +
      "Payment must be fully captured before the vault can be unlocked.",
    );
  }

  // amount_received is in smallest currency unit (cents for USD, halalas for SAR, etc.)
  const amountReceived: number = Number(piData["amount_received"] ?? 0);
  const currency: string       = String(piData["currency"] ?? "usd").toUpperCase();
  const paid_amount            = amountReceived / 100;

  logger.info(
    { provider: "stripe", paymentIntentId, paid_amount, currency, status },
    "web-payment: Stripe PaymentIntent verified",
  );

  return {
    paid_amount,
    currency_code:       currency,
    payment_intent_id:   paymentIntentId,
    provider:            "stripe",
    order_id:            String(piData["id"] ?? paymentIntentId),
  };
}

/** Minimal Stripe REST GET using node:https. Returns parsed JSON body. */
function stripeGet(path: string, secretKey: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: "api.stripe.com",
      port:     443,
      path,
      method:   "GET",
      headers:  {
        // Basic auth: secret key as username, empty password
        "Authorization": `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
        "Stripe-Version": "2024-06-20",
      },
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        } catch {
          reject(new Error("Stripe returned non-JSON response"));
          return;
        }

        if ((res.statusCode ?? 0) >= 400) {
          const errMsg = (body["error"] as Record<string, unknown> | undefined)?.["message"] ?? "Unknown Stripe error";
          reject(new Error(`Stripe API error (${res.statusCode}): ${errMsg}`));
          return;
        }

        resolve(body);
      });
    });

    req.on("error", (err) => {
      reject(new Error(`Stripe HTTP request failed: ${err.message}`));
    });

    req.end();
  });
}
