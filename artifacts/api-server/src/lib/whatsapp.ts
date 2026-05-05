/**
 * whatsapp.ts — Real WhatsApp dispatch via Wapilot.
 *
 * Single integration point for outbound WhatsApp. Every caller
 * (auction-won, 24h reminder, 48h expired) goes through `sendWhatsApp`
 * — only this module knows about Wapilot.
 *
 * Wapilot HTTP contract (verified live against api.wapilot.net — HTTP 200,
 * message_id returned):
 *
 *   POST {WAPILOT_BASE_URL}/{WAPILOT_INSTANCE_ID}/send-message
 *     e.g. https://api.wapilot.net/api/v2/instance3788/send-message
 *   Headers:
 *     Token: {WAPILOT_API_KEY}            ← NOT "Authorization: Bearer …"
 *     Content-Type: application/json
 *   Body (JSON):
 *     {
 *       "chat_id": "<digits>@c.us",       ← E.164 digits + "@c.us" suffix
 *       "text":    "<utf-8 message body>"
 *     }
 *
 *   - instance_id is PATH-only. Do NOT also send it in the body.
 *   - The recipient field is "chat_id" (not "phone") and uses the WhatsApp
 *     chat-id format (digits, no leading "+", followed by "@c.us").
 *   - The message field is "text" (not "message").
 *
 * Errors observed during integration probing:
 *   401 {"message":"Unauthorized: API token is missing in the request headers."}
 *      → wrong header name (Wapilot wants `Token:`, not `Authorization: Bearer`).
 *   404 {"message":"Bad Request: Instance not found."}
 *      → WAPILOT_INSTANCE_ID does not match any instance on the account,
 *        OR endpoint shape is wrong (use path-style /{id}/send-message).
 *   400 {"error":"The chat id field is required."} / "The text field is required."
 *      → body fields not named correctly (chat_id, text — see above).
 *
 * NOTE: A Meta WhatsApp Cloud API path was prototyped briefly during
 * provider evaluation; it is intentionally not present in the codebase.
 * Wapilot is the sole production transport. The `WHATSAPP_ACCESS_TOKEN`
 * and `WHATSAPP_PHONE_NUMBER_ID` env vars (if set) are ignored here.
 *
 * Failure policy: NEVER throws. Returns false on any failure so the
 * caller's main flow (in-app notification, OTP issuance, deadline stamp)
 * continues uninterrupted. The full Wapilot response body is logged at
 * WARN/ERROR — un-truncated up to 4 KB — so misconfigurations are
 * immediately diagnosable from the server logs.
 */

import { logger } from "./logger";

export type WhatsAppKind =
  | "auction_won"
  | "purchase_reminder_24h"
  | "purchase_expired"
  | "test";

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
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_LOGGED_BODY_CHARS = 4096;

// ── Startup diagnostic banner ──────────────────────────────────────────────
// Emitted ONCE on cold start. Logs presence + length only — never the
// secret value itself. This is the single source of truth for "did the
// runtime actually receive my env vars?".
logger.info(
  {
    channel: "whatsapp",
    provider: "wapilot",
    diag: "startup",
    runtime: process.env["VERCEL"] ? "vercel" : (process.env["REPL_ID"] ? "replit" : "other"),
    nodeEnv: process.env["NODE_ENV"] ?? null,
    hasBaseUrl: Boolean(BASE_URL),
    baseUrlHost: BASE_URL ? new URL(BASE_URL).host : null,
    hasApiKey: Boolean(API_KEY),
    apiKeyLen: API_KEY.length,
    hasInstanceId: Boolean(INSTANCE_ID),
    instanceIdLen: INSTANCE_ID.length,
  },
  "whatsapp: Wapilot config snapshot at module load",
);

function isConfigured(): boolean {
  return Boolean(BASE_URL && API_KEY && INSTANCE_ID);
}

/**
 * normalizeDigitsForWapilot — strip everything except digits.
 *
 * Wapilot wants the chat_id as `<digits>@c.us`. Accepts every form a
 * user might supply:
 *   "+201559035388"  → "201559035388"
 *   "201559035388"   → "201559035388"
 *   "01559035388"    → "01559035388"  (caller is responsible for resolving
 *                                       local forms to canonical E.164 BEFORE
 *                                       calling sendWhatsApp; see
 *                                       password-reset.ts/phoneCandidates).
 *
 * No country-code promotion happens here — that's the caller's job. The
 * password-reset flow always passes the canonical stored phone so this
 * function only has to cope with the optional leading "+".
 */
function normalizeDigitsForWapilot(phone: string): string {
  return phone.trim().replace(/\D/g, "");
}

export async function sendWhatsApp(input: SendWhatsAppInput): Promise<boolean> {
  // Per-call entry marker — proves the code path was reached at all
  // (rules out "stale bundle / old code still running" theories).
  logger.info(
    {
      channel: "whatsapp",
      provider: "wapilot",
      diag: "entered",
      kind: input.kind,
      lang: input.lang,
      phoneLen: (input.phone ?? "").length,
      bodyLen: (input.body ?? "").length,
      hasBaseUrl: Boolean(BASE_URL),
      hasApiKey: Boolean(API_KEY),
      apiKeyLen: API_KEY.length,
      hasInstanceId: Boolean(INSTANCE_ID),
      instanceIdLen: INSTANCE_ID.length,
      ...input.meta,
    },
    "whatsapp: sendWhatsApp invoked",
  );

  const phone = (input.phone ?? "").trim();
  if (!phone || !/^\+?[1-9]\d{6,14}$/.test(phone)) {
    logger.warn(
      { kind: input.kind, phoneLen: phone.length, ...input.meta },
      "whatsapp: invalid phone — skipping",
    );
    return false;
  }

  if (!isConfigured()) {
    logger.error(
      {
        kind: input.kind,
        hasBase: Boolean(BASE_URL),
        hasKey: Boolean(API_KEY),
        hasInstance: Boolean(INSTANCE_ID),
        baseUrlLen: BASE_URL.length,
        apiKeyLen: API_KEY.length,
        instanceIdLen: INSTANCE_ID.length,
        ...input.meta,
      },
      "whatsapp: Wapilot not configured — message NOT sent",
    );
    return false;
  }

  const url = `${BASE_URL}/${encodeURIComponent(INSTANCE_ID)}/send-message`;
  const number = normalizeDigitsForWapilot(phone);
  const chatId = `${number}@c.us`;

  // Wapilot v2 path-style send-message body shape:
  //   chat_id = "<digits>@c.us"  (WhatsApp chat-id format)
  //   text    = utf-8 message body
  // (instance_id lives in the URL path; do NOT also send it in the body)
  const payload = {
    chat_id: chatId,
    text: input.body,
  };

  // Pre-flight log — captures the EXACT outbound shape (without secrets)
  // so any "wrong endpoint / wrong body / wrong number format" claim can
  // be verified from a single log line in production.
  logger.info(
    {
      channel: "whatsapp",
      provider: "wapilot",
      diag: "request",
      kind: input.kind,
      method: "POST",
      url,
      authHeader: "Token",
      bodyKeys: Object.keys(payload),
      chatId,
      phoneStartsWithPlus: phone.startsWith("+"),
      messageLen: input.body.length,
      instanceIdLen: INSTANCE_ID.length,
    },
    "whatsapp: outgoing Wapilot request",
  );

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
          chatId,
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

    logger.info(
      {
        channel: "whatsapp",
        provider: "wapilot",
        kind: input.kind,
        chatId,
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
        chatId,
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

/**
 * sendWhatsAppMessage — thin centralized wrapper around `sendWhatsApp`.
 *
 * The ONLY public entry point that the auction-event hooks (outbid,
 * auction-ended, action-required) should call. Keeps callers ignorant of
 * provider details, tagging, and metadata shape.
 *
 *   • phone is normalized to digits and sent as `<digits>@c.us` (delegated
 *     to `sendWhatsApp`).
 *   • Wapilot endpoint only — never touches Meta or any other provider.
 *   • No queue, no retry, no delay — direct API call.
 *   • Never throws. Returns false on any failure (missing phone, bad
 *     phone shape, provider not configured, network error, non-2xx)
 *     so the calling auction flow is never blocked.
 *
 * For OTP / winner-with-seller-phone use the existing `sendWhatsApp` to
 * keep their richer logging metadata (kind, lang, userId, auctionId, …).
 */
export async function sendWhatsAppMessage(input: {
  phone: string | null | undefined;
  text: string;
}): Promise<boolean> {
  const phone = (input.phone ?? "").trim();
  const text = input.text ?? "";
  if (!phone || !text) {
    logger.info(
      { hasPhone: Boolean(phone), hasText: Boolean(text) },
      "whatsapp: sendWhatsAppMessage skipped — missing phone or text",
    );
    return false;
  }
  try {
    return await sendWhatsApp({
      phone,
      body: text,
      lang: "en",
      kind: "auction_won", // generic categorical bucket for auction-event sends
      meta: { source: "sendWhatsAppMessage" },
    });
  } catch (err) {
    // Defense-in-depth: sendWhatsApp already swallows; this catch ensures
    // even an unexpected throw never bubbles into the caller's main flow.
    logger.warn({ err: String(err) }, "whatsapp: sendWhatsAppMessage caught error");
    return false;
  }
}

/**
 * Returns Wapilot configuration diagnostic info for the /api/whatsapp/test
 * route. Never returns the API token itself — only presence + lengths so
 * the test endpoint can confirm the runtime environment without leaking
 * secrets.
 */
export function getWhatsAppDiagnostics(): {
  provider: "wapilot";
  configured: boolean;
  hasBaseUrl: boolean;
  baseUrlHost: string | null;
  hasApiKey: boolean;
  apiKeyLen: number;
  hasInstanceId: boolean;
  instanceIdLen: number;
} {
  return {
    provider: "wapilot",
    configured: isConfigured(),
    hasBaseUrl: Boolean(BASE_URL),
    baseUrlHost: BASE_URL ? new URL(BASE_URL).host : null,
    hasApiKey: Boolean(API_KEY),
    apiKeyLen: API_KEY.length,
    hasInstanceId: Boolean(INSTANCE_ID),
    instanceIdLen: INSTANCE_ID.length,
  };
}
