/**
 * whatsapp.ts — Real WhatsApp dispatch.
 *
 * Single integration point for outbound WhatsApp. Every caller
 * (auction-won, 24h reminder, 48h expired, password-reset OTP) goes
 * through `sendWhatsApp` — only this module knows about providers.
 *
 * Supports two providers behind the same abstraction. The active
 * provider is chosen at module load:
 *
 *   1. META  (preferred) — used when WHATSAPP_ACCESS_TOKEN +
 *      WHATSAPP_PHONE_NUMBER_ID are both set in the environment.
 *      Calls Meta's WhatsApp Cloud Graph API:
 *        POST https://graph.facebook.com/v22.0/{PHONE_NUMBER_ID}/messages
 *        Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}
 *        Body: {
 *          "messaging_product": "whatsapp",
 *          "to":   "<E.164 digits, no leading +>",
 *          "type": "text",
 *          "text": { "body": "<utf-8 message>" }
 *        }
 *      Verified live: HTTP 200 returns {messages:[{id:"wamid…"}]}.
 *
 *   2. WAPILOT (fallback) — used when Meta env vars are missing but
 *      WAPILOT_BASE_URL + WAPILOT_API_KEY + WAPILOT_INSTANCE_ID are set.
 *        POST {WAPILOT_BASE_URL}/{WAPILOT_INSTANCE_ID}/send-message
 *        Token: {WAPILOT_API_KEY}
 *        Body: { "chat_id": "<digits>@c.us", "text": "<message>" }
 *      Verified live: HTTP 200 returns {success:true, message_id:…}.
 *
 * If neither provider is configured, sends are skipped (returns false)
 * and the omission is logged loudly so misconfigurations surface fast.
 *
 * Failure policy: NEVER throws. Returns false on any failure so the
 * caller's main flow (in-app notification, OTP issuance, deadline stamp)
 * continues uninterrupted. The full provider response body is logged at
 * WARN/ERROR — un-truncated up to 4 KB — so misconfigurations are
 * immediately diagnosable from the server logs.
 */

import { logger } from "./logger";

export type WhatsAppKind =
  | "auction_won"
  | "purchase_reminder_24h"
  | "purchase_expired"
  | "password_otp"
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

// ── Provider configuration ────────────────────────────────────────────────
const META_TOKEN = process.env["WHATSAPP_ACCESS_TOKEN"] ?? "";
const META_PHONE_NUMBER_ID = process.env["WHATSAPP_PHONE_NUMBER_ID"] ?? "";
const META_API_VERSION = process.env["WHATSAPP_API_VERSION"] ?? "v22.0";
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

const WAPILOT_BASE_URL = (process.env["WAPILOT_BASE_URL"] ?? "").replace(/\/+$/, "");
const WAPILOT_API_KEY = process.env["WAPILOT_API_KEY"] ?? "";
const WAPILOT_INSTANCE_ID = process.env["WAPILOT_INSTANCE_ID"] ?? "";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_LOGGED_BODY_CHARS = 4096;

type Provider = "meta" | "wapilot" | "none";

function resolveProvider(): Provider {
  if (META_TOKEN && META_PHONE_NUMBER_ID) return "meta";
  if (WAPILOT_BASE_URL && WAPILOT_API_KEY && WAPILOT_INSTANCE_ID) return "wapilot";
  return "none";
}

const ACTIVE_PROVIDER: Provider = resolveProvider();

// ── Startup diagnostic banner ──────────────────────────────────────────────
// Emitted ONCE on cold start. Logs presence + length only — never the
// secret value itself. This is the single source of truth for "did the
// runtime actually receive my env vars?".
logger.info(
  {
    channel: "whatsapp",
    diag: "startup",
    runtime: process.env["VERCEL"] ? "vercel" : (process.env["REPL_ID"] ? "replit" : "other"),
    nodeEnv: process.env["NODE_ENV"] ?? null,
    activeProvider: ACTIVE_PROVIDER,
    meta: {
      hasToken: Boolean(META_TOKEN),
      tokenLen: META_TOKEN.length,
      hasPhoneNumberId: Boolean(META_PHONE_NUMBER_ID),
      phoneNumberIdLen: META_PHONE_NUMBER_ID.length,
      apiVersion: META_API_VERSION,
    },
    wapilot: {
      hasBaseUrl: Boolean(WAPILOT_BASE_URL),
      baseUrlHost: WAPILOT_BASE_URL ? new URL(WAPILOT_BASE_URL).host : null,
      hasApiKey: Boolean(WAPILOT_API_KEY),
      apiKeyLen: WAPILOT_API_KEY.length,
      hasInstanceId: Boolean(WAPILOT_INSTANCE_ID),
      instanceIdLen: WAPILOT_INSTANCE_ID.length,
    },
  },
  "whatsapp: provider config snapshot at module load",
);

// E.164 digits only (no leading "+"). Both providers want this format.
function normalizeDigits(phone: string): string {
  return phone.trim().replace(/^\+/, "");
}

interface DispatchResult {
  ok: boolean;
  status: number;
  body: string;
  url: string;
  bodyKeys: string[];
  err?: string;
}

async function dispatchMeta(number: string, text: string): Promise<DispatchResult> {
  const url = `${META_BASE}/${encodeURIComponent(META_PHONE_NUMBER_ID)}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: number,
    type: "text",
    text: { body: text },
  };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${META_TOKEN}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await res.text().catch(() => "");
    return {
      ok: res.ok,
      status: res.status,
      body: raw.slice(0, MAX_LOGGED_BODY_CHARS),
      url,
      bodyKeys: Object.keys(payload),
    };
  } catch (err) {
    const aborted = (err as { name?: string } | null)?.name === "AbortError";
    return {
      ok: false,
      status: 0,
      body: "",
      url,
      bodyKeys: Object.keys(payload),
      err: aborted ? `timeout after ${REQUEST_TIMEOUT_MS}ms` : String(err),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function dispatchWapilot(number: string, text: string): Promise<DispatchResult> {
  const url = `${WAPILOT_BASE_URL}/${encodeURIComponent(WAPILOT_INSTANCE_ID)}/send-message`;
  const payload = {
    chat_id: `${number}@c.us`,
    text,
  };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Token: WAPILOT_API_KEY,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await res.text().catch(() => "");
    return {
      ok: res.ok,
      status: res.status,
      body: raw.slice(0, MAX_LOGGED_BODY_CHARS),
      url,
      bodyKeys: Object.keys(payload),
    };
  } catch (err) {
    const aborted = (err as { name?: string } | null)?.name === "AbortError";
    return {
      ok: false,
      status: 0,
      body: "",
      url,
      bodyKeys: Object.keys(payload),
      err: aborted ? `timeout after ${REQUEST_TIMEOUT_MS}ms` : String(err),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function sendWhatsApp(input: SendWhatsAppInput): Promise<boolean> {
  // Per-call entry marker — proves the code path was reached at all.
  logger.info(
    {
      channel: "whatsapp",
      diag: "entered",
      provider: ACTIVE_PROVIDER,
      kind: input.kind,
      lang: input.lang,
      phoneLen: (input.phone ?? "").length,
      bodyLen: (input.body ?? "").length,
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

  if (ACTIVE_PROVIDER === "none") {
    logger.error(
      { kind: input.kind, ...input.meta },
      "whatsapp: no provider configured (Meta nor Wapilot) — message NOT sent",
    );
    return false;
  }

  const number = normalizeDigits(phone);

  const result =
    ACTIVE_PROVIDER === "meta"
      ? await dispatchMeta(number, input.body)
      : await dispatchWapilot(number, input.body);

  // Pre-flight log — captures the EXACT outbound shape (without secrets).
  logger.info(
    {
      channel: "whatsapp",
      diag: "request",
      provider: ACTIVE_PROVIDER,
      kind: input.kind,
      method: "POST",
      url: result.url,
      bodyKeys: result.bodyKeys,
      phoneNormalized: number,
      phoneStartsWithPlus: phone.startsWith("+"),
      messageLen: input.body.length,
    },
    "whatsapp: outgoing request",
  );

  if (!result.ok) {
    logger.warn(
      {
        channel: "whatsapp",
        provider: ACTIVE_PROVIDER,
        kind: input.kind,
        phone: number,
        lang: input.lang,
        url: result.url,
        status: result.status,
        response: result.body,
        err: result.err,
        ...input.meta,
      },
      "whatsapp: provider returned non-2xx",
    );
    return false;
  }

  logger.info(
    {
      channel: "whatsapp",
      provider: ACTIVE_PROVIDER,
      kind: input.kind,
      phone: number,
      lang: input.lang,
      url: result.url,
      status: result.status,
      response: result.body,
      ...input.meta,
    },
    "whatsapp: dispatched successfully",
  );
  return true;
}

/**
 * Returns provider-level diagnostic info for the /api/whatsapp/test route.
 * Never returns the API tokens themselves — only presence + lengths so the
 * test endpoint can confirm the runtime environment without leaking secrets.
 */
export function getWhatsAppDiagnostics(): {
  activeProvider: Provider;
  meta: { hasToken: boolean; tokenLen: number; hasPhoneNumberId: boolean; phoneNumberIdLen: number; apiVersion: string };
  wapilot: { hasBaseUrl: boolean; hasApiKey: boolean; hasInstanceId: boolean };
} {
  return {
    activeProvider: ACTIVE_PROVIDER,
    meta: {
      hasToken: Boolean(META_TOKEN),
      tokenLen: META_TOKEN.length,
      hasPhoneNumberId: Boolean(META_PHONE_NUMBER_ID),
      phoneNumberIdLen: META_PHONE_NUMBER_ID.length,
      apiVersion: META_API_VERSION,
    },
    wapilot: {
      hasBaseUrl: Boolean(WAPILOT_BASE_URL),
      hasApiKey: Boolean(WAPILOT_API_KEY),
      hasInstanceId: Boolean(WAPILOT_INSTANCE_ID),
    },
  };
}
