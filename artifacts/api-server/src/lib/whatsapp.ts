/**
 * whatsapp.ts — Real WhatsApp dispatch via Wapilot.
 *
 * Single integration point for outbound WhatsApp. Every caller
 * (auction-won, 24h reminder, 48h expired, password-reset OTP) goes
 * through `sendWhatsApp` — only this module knows about Wapilot.
 *
 * Environment (already configured):
 *   WAPILOT_BASE_URL      Base URL of the Wapilot tenant (no trailing slash needed).
 *   WAPILOT_API_KEY       API token / access token issued by Wapilot.
 *   WAPILOT_INSTANCE_ID   Instance / device identifier.
 *   WAPILOT_SEND_PATH     (optional) Override path. Defaults to "/api/send".
 *
 * Wapilot's HTTP contract follows the common WhatsApp-gateway shape:
 *   POST {BASE}/api/send
 *   Authorization: Bearer <API_KEY>
 *   Content-Type: application/json
 *   { "number": "<E.164>", "type": "text", "message": "<body>",
 *     "instance_id": "<id>", "access_token": "<key>" }
 *
 * The token is sent in BOTH the `Authorization` header and the JSON body
 * because different Wapilot deployments accept it in different places —
 * sending both is harmless and means the integration works without
 * tweaking regardless of which auth style the tenant uses.
 *
 * Failure policy: NEVER throws. Returns false on any failure so the
 * caller's main flow (in-app notification, OTP issuance, deadline stamp)
 * continues uninterrupted. All non-2xx responses are logged at WARN
 * with the response body excerpt for debugging.
 */

import { logger } from "./logger";

export type WhatsAppKind =
  | "auction_won"
  | "purchase_reminder_24h"
  | "purchase_expired"
  | "password_otp";

export interface SendWhatsAppInput {
  /** E.164 phone number (e.g. +201060088141). Required. */
  phone: string;
  /** Localized message body — already finalised by a template builder. */
  body: string;
  /** ISO language code the body was rendered in (for logging only). */
  lang: string;
  /** Categorical kind for downstream metrics + log filtering. */
  kind: WhatsAppKind;
  /** Optional metadata for the log line (auction id, user id, etc.). */
  meta?: Record<string, unknown>;
}

const BASE_URL = (process.env["WAPILOT_BASE_URL"] ?? "").replace(/\/+$/, "");
const API_KEY = process.env["WAPILOT_API_KEY"] ?? "";
const INSTANCE_ID = process.env["WAPILOT_INSTANCE_ID"] ?? "";
const SEND_PATH = process.env["WAPILOT_SEND_PATH"] ?? "/api/send";
const REQUEST_TIMEOUT_MS = 10_000;

function isConfigured(): boolean {
  return Boolean(BASE_URL && API_KEY && INSTANCE_ID);
}

// Wapilot expects the number WITHOUT a leading "+" in most deployments;
// some tolerate both. We strip it defensively but keep all digits intact.
function normalizeNumberForWapilot(phone: string): string {
  return phone.trim().replace(/^\+/, "");
}

/**
 * Send a WhatsApp message via Wapilot. Returns true if Wapilot accepted
 * the request (HTTP 2xx); false if the phone is invalid, Wapilot is not
 * configured, the network failed, or Wapilot returned a non-2xx. Never
 * throws — caller flows must not be interrupted by WA delivery failures.
 */
export async function sendWhatsApp(input: SendWhatsAppInput): Promise<boolean> {
  const phone = (input.phone ?? "").trim();
  if (!phone || !/^\+?[1-9]\d{6,14}$/.test(phone)) {
    logger.warn({ kind: input.kind, ...input.meta }, "whatsapp: invalid phone — skipping");
    return false;
  }

  if (!isConfigured()) {
    logger.error(
      {
        kind: input.kind,
        hasBase: Boolean(BASE_URL),
        hasKey: Boolean(API_KEY),
        hasInstance: Boolean(INSTANCE_ID),
        ...input.meta,
      },
      "whatsapp: Wapilot not configured — message NOT sent",
    );
    return false;
  }

  const url = `${BASE_URL}${SEND_PATH.startsWith("/") ? SEND_PATH : `/${SEND_PATH}`}`;
  const number = normalizeNumberForWapilot(phone);

  const payload = {
    number,
    type: "text",
    message: input.body,
    instance_id: INSTANCE_ID,
    access_token: API_KEY,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const rawText = await res.text().catch(() => "");
    const bodyExcerpt = rawText.slice(0, 500);

    if (!res.ok) {
      logger.warn(
        {
          channel: "whatsapp",
          provider: "wapilot",
          kind: input.kind,
          phone: number,
          lang: input.lang,
          status: res.status,
          response: bodyExcerpt,
          ...input.meta,
        },
        "whatsapp: Wapilot returned non-2xx",
      );
      return false;
    }

    // Wapilot success bodies are typically JSON with {status:"success"} or
    // similar. We don't hard-fail on shape — HTTP 2xx is the contract.
    logger.info(
      {
        channel: "whatsapp",
        provider: "wapilot",
        kind: input.kind,
        phone: number,
        lang: input.lang,
        status: res.status,
        response: bodyExcerpt,
        ...input.meta,
      },
      "whatsapp: dispatched via Wapilot",
    );
    return true;
  } catch (err) {
    const aborted = (err as { name?: string } | null)?.name === "AbortError";
    logger.warn(
      {
        channel: "whatsapp",
        provider: "wapilot",
        kind: input.kind,
        phone: number,
        lang: input.lang,
        err: aborted ? `timeout after ${REQUEST_TIMEOUT_MS}ms` : String(err),
        ...input.meta,
      },
      "whatsapp: Wapilot dispatch failed",
    );
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}
