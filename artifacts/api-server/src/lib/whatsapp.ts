/**
 * whatsapp.ts — Real WhatsApp dispatch via Wapilot.
 *
 * Single integration point for outbound WhatsApp. Every caller
 * (auction-won, 24h reminder, 48h expired, password-reset OTP) goes
 * through `sendWhatsApp` — only this module knows about Wapilot.
 *
 * Wapilot HTTP contract (verified by direct probing of api.wapilot.net):
 *   POST {WAPILOT_BASE_URL}/api/send-message
 *   Headers:
 *     Token: <WAPILOT_API_KEY>          ← NOT "Authorization: Bearer …"
 *     Content-Type: application/json
 *   Body (JSON):
 *     {
 *       "instance_id": "<WAPILOT_INSTANCE_ID>",
 *       "phone":       "<E.164 without the leading +>",
 *       "message":     "<utf-8 text body>"
 *     }
 *
 * Errors observed during integration probing:
 *   401 {"message":"Unauthorized: API token is missing in the request headers."}
 *      → wrong header name (Wapilot wants `Token:`, not `Authorization: Bearer`).
 *   404 {"message":"Bad Request: Instance not found."}
 *      → WAPILOT_INSTANCE_ID does not match any instance on the account.
 *        Fix in the Wapilot dashboard, NOT in code.
 *
 * Failure policy: NEVER throws. Returns false on any failure so the
 * caller's main flow (in-app notification, OTP issuance, deadline stamp)
 * continues uninterrupted. The full response body is logged at WARN/ERROR
 * — un-truncated up to 4 KB — so misconfigurations are immediately
 * diagnosable from the server logs.
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
// Override path only if your Wapilot deployment uses a non-standard route.
const SEND_PATH = process.env["WAPILOT_SEND_PATH"] ?? "/api/send-message";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_LOGGED_BODY_CHARS = 4096;

function isConfigured(): boolean {
  return Boolean(BASE_URL && API_KEY && INSTANCE_ID);
}

// Wapilot expects the digits only (no leading "+").
function normalizeNumberForWapilot(phone: string): string {
  return phone.trim().replace(/^\+/, "");
}

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
    instance_id: INSTANCE_ID,
    phone: number,
    message: input.body,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        // Wapilot uses a custom `Token` header, not Bearer.
        Token: API_KEY,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const rawText = await res.text().catch(() => "");
    const fullBody = rawText.slice(0, MAX_LOGGED_BODY_CHARS);

    if (!res.ok) {
      logger.warn(
        {
          channel: "whatsapp",
          provider: "wapilot",
          kind: input.kind,
          phone: number,
          lang: input.lang,
          url,
          status: res.status,
          response: fullBody,
          ...input.meta,
        },
        "whatsapp: Wapilot returned non-2xx",
      );
      return false;
    }

    // Wapilot 2xx responses are typically JSON like {"status":"success", ...}
    // or {"success":true, "data":{…}}. We log the raw body so the actual
    // shape is always visible without truncation.
    logger.info(
      {
        channel: "whatsapp",
        provider: "wapilot",
        kind: input.kind,
        phone: number,
        lang: input.lang,
        url,
        status: res.status,
        response: fullBody,
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
        url,
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
