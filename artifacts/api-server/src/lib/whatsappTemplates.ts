/**
 * whatsappTemplates.ts — Short, brand-consistent WhatsApp message bodies.
 *
 * Each builder returns a single utf-8 string ready to pass directly to
 * `sendWhatsAppMessage({ phone, text })`. Bodies are intentionally short
 * (one emoji + one line), language-neutral, and free of links so they
 * survive WhatsApp's per-message overhead and never trip spam filters.
 *
 * These are NEW templates introduced for the auction-event WhatsApp hooks
 * (outbid, auction-ended, action-required). They live alongside — and do
 * NOT replace — the richer localized templates in `auction-won-message.ts`
 * which are still used by the OTP and winner-notification flows.
 */

const BRAND = "BidReel";

function safeTitle(title: string | null | undefined): string {
  const t = (title ?? "").trim();
  return t.length > 0 ? t : "your auction";
}

/** Password-reset OTP — kept short, no link, no extra context. */
export function buildOtpMessage(code: string): string {
  return `${BRAND} 🔐\nCode: ${code}`;
}

/** Sent to the previous high bidder when someone outbids them. */
export function buildOutbidMessage(title: string | null | undefined): string {
  return `${BRAND} 📢\nYou were outbid on: ${safeTitle(title)}`;
}

/** Sent to the auction winner when an auction transitions active → ended. */
export function buildAuctionWonMessage(title: string | null | undefined): string {
  return `${BRAND} 🏆\nYou won: ${safeTitle(title)}`;
}

/** Sent to the seller when their auction ends (with a winner). */
export function buildAuctionEndedSellerMessage(title: string | null | undefined): string {
  return `${BRAND} ✅\nYour auction ended: ${safeTitle(title)}`;
}

/**
 * Sent when an auction has ended but a follow-up step is still pending
 * (e.g. ended without bids/confirmation, deal not finalised).
 */
export function buildAuctionActionRequiredMessage(title: string | null | undefined): string {
  return `${BRAND} ⚠️\nAction required for: ${safeTitle(title)}`;
}
