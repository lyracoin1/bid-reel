/**
 * auction-won-message.ts — Localized message builder for the auction_won
 * notification body.
 *
 * The body is a self-contained text block delivered through the in-app
 * notification (which the winner reads inside BidReel) and is also suitable
 * for forwarding via WhatsApp because it embeds the seller's phone number
 * directly. No deep-link is required to know who to call.
 *
 * Format (per spec, English example):
 *   🎉 Congratulations! You won the auction on BidReel.
 *
 *   You have 48 hours to complete the purchase.
 *
 *   Please contact the seller at: +2010XXXXXXX
 *
 * Supported languages: en, ar, tr, es, fr, ru. Anything else falls back to en.
 *
 * IMPORTANT: callers MUST NOT invoke this with an empty/missing phone — the
 * upstream notifier is responsible for skipping the send entirely when the
 * seller has no phone on file (see notifyAuctionWon in notifications.ts).
 */

export type WonMessageLang = "en" | "ar" | "tr" | "es" | "fr" | "ru";

const SUPPORTED: ReadonlySet<string> = new Set(["en", "ar", "tr", "es", "fr", "ru"]);

/** Coerce any incoming locale string to a supported language code. */
export function normalizeWonLang(input: string | null | undefined): WonMessageLang {
  if (!input) return "en";
  const base = input.toLowerCase().split(/[-_]/)[0] ?? "en";
  return (SUPPORTED.has(base) ? base : "en") as WonMessageLang;
}

/**
 * Build the localized auction-won message body. Phone is interpolated as-is
 * (already E.164 from profiles.phone) — no formatting transformation is
 * applied so users see the exact callable number.
 */
export function buildAuctionWonMessage(
  language: WonMessageLang,
  sellerPhone: string,
): string {
  switch (language) {
    case "ar":
      return [
        "🎉 مبروك! لقد فزت بالمزاد على BidReel.",
        "",
        "لديك 48 ساعة لإتمام عملية الشراء.",
        "",
        `يرجى التواصل مع البائع على: ${sellerPhone}`,
      ].join("\n");

    case "tr":
      return [
        "🎉 Tebrikler! BidReel’deki açık artırmayı kazandınız.",
        "",
        "Satın alma işlemini tamamlamak için 48 saatiniz var.",
        "",
        `Lütfen satıcıyla iletişime geçin: ${sellerPhone}`,
      ].join("\n");

    case "es":
      return [
        "🎉 ¡Felicidades! Ganaste la subasta en BidReel.",
        "",
        "Tienes 48 horas para completar la compra.",
        "",
        `Por favor, contacta al vendedor en: ${sellerPhone}`,
      ].join("\n");

    case "fr":
      return [
        "🎉 Félicitations ! Vous avez remporté l’enchère sur BidReel.",
        "",
        "Vous disposez de 48 heures pour finaliser l’achat.",
        "",
        `Veuillez contacter le vendeur au : ${sellerPhone}`,
      ].join("\n");

    case "ru":
      return [
        "🎉 Поздравляем! Вы выиграли аукцион на BidReel.",
        "",
        "У вас есть 48 часов, чтобы завершить покупку.",
        "",
        `Пожалуйста, свяжитесь с продавцом: ${sellerPhone}`,
      ].join("\n");

    case "en":
    default:
      return [
        "🎉 Congratulations! You won the auction on BidReel.",
        "",
        "You have 48 hours to complete the purchase.",
        "",
        `Please contact the seller at: ${sellerPhone}`,
      ].join("\n");
  }
}

/** Localized title for the same notification. */
export function buildAuctionWonTitle(language: WonMessageLang): string {
  switch (language) {
    case "ar": return "🏆 لقد فزت!";
    case "tr": return "🏆 Kazandınız!";
    case "es": return "🏆 ¡Ganaste!";
    case "fr": return "🏆 Vous avez gagné !";
    case "ru": return "🏆 Вы выиграли!";
    case "en":
    default:   return "🏆 You won!";
  }
}
