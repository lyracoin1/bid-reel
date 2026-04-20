/**
 * whatsapp.ts — WhatsApp dispatch stub.
 *
 * This module is the SINGLE integration point for outbound WhatsApp
 * messages. It currently logs the rendered message at INFO level (which is
 * sufficient for development and for any production deployment that wires
 * a Pino transport to a log shipper). Swap the body of `sendWhatsApp` to
 * call your gateway of choice (Twilio, Meta Cloud API, Vonage, etc.) — no
 * other call site needs to change.
 *
 * Rationale for keeping the in-app `notifications` row separate from this
 * call: the auction_won / reminder / expired messages are ALSO surfaced
 * inside the app via the existing `notifications` table; this dispatch
 * function just adds the outbound WhatsApp channel on top.
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

/**
 * Send a WhatsApp message. Returns true if the dispatch was accepted (or
 * stubbed successfully); false if the phone is invalid or the gateway
 * rejected the send. Never throws.
 *
 * The current stub considers any non-empty E.164-looking phone valid. Real
 * gateway integration goes inside the marked block below.
 */
export async function sendWhatsApp(input: SendWhatsAppInput): Promise<boolean> {
  const phone = (input.phone ?? "").trim();
  if (!phone || !/^\+?[1-9]\d{6,14}$/.test(phone)) {
    logger.warn({ kind: input.kind, ...input.meta }, "whatsapp: invalid phone — skipping");
    return false;
  }

  // ── Gateway call goes here. Stub logs the full payload so it is fully
  //    auditable from the server logs in development.
  logger.info(
    {
      channel: "whatsapp",
      kind: input.kind,
      phone,
      lang: input.lang,
      bodyPreview: input.body.split("\n")[0],
      ...input.meta,
    },
    "whatsapp: dispatch",
  );

  return true;
}
