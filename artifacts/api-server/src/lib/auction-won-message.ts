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

// ─── 24-hour reminder (purchase still not completed) ─────────────────────────
// Sent ~24h after the win, when the winner still has 24h left to act. The
// seller's phone is re-included so the message is fully self-contained — the
// winner does not need to scroll back to the original "won" message.

export function buildPurchaseReminderTitle(language: WonMessageLang): string {
  switch (language) {
    case "ar": return "⏰ تذكير: 24 ساعة متبقية";
    case "tr": return "⏰ Hatırlatma: 24 saat kaldı";
    case "es": return "⏰ Recordatorio: quedan 24 horas";
    case "fr": return "⏰ Rappel : il reste 24 heures";
    case "ru": return "⏰ Напоминание: осталось 24 часа";
    case "en":
    default:   return "⏰ Reminder: 24 hours left";
  }
}

export function buildPurchaseReminderMessage(
  language: WonMessageLang,
  sellerPhone: string,
): string {
  switch (language) {
    case "ar":
      return [
        "⏰ تذكير: لم تكمل عملية الشراء بعد.",
        "",
        "تبقّى لديك 24 ساعة فقط قبل انتهاء المهلة.",
        "",
        `يرجى التواصل مع البائع على: ${sellerPhone}`,
      ].join("\n");
    case "tr":
      return [
        "⏰ Hatırlatma: Satın alma işleminizi henüz tamamlamadınız.",
        "",
        "Süre dolmadan önce yalnızca 24 saatiniz kaldı.",
        "",
        `Lütfen satıcıyla iletişime geçin: ${sellerPhone}`,
      ].join("\n");
    case "es":
      return [
        "⏰ Recordatorio: aún no has completado la compra.",
        "",
        "Te quedan solo 24 horas antes de que expire el plazo.",
        "",
        `Por favor, contacta al vendedor en: ${sellerPhone}`,
      ].join("\n");
    case "fr":
      return [
        "⏰ Rappel : vous n’avez pas encore finalisé l’achat.",
        "",
        "Il ne vous reste que 24 heures avant l’expiration du délai.",
        "",
        `Veuillez contacter le vendeur au : ${sellerPhone}`,
      ].join("\n");
    case "ru":
      return [
        "⏰ Напоминание: вы ещё не завершили покупку.",
        "",
        "У вас осталось всего 24 часа до истечения срока.",
        "",
        `Пожалуйста, свяжитесь с продавцом: ${sellerPhone}`,
      ].join("\n");
    case "en":
    default:
      return [
        "⏰ Reminder: you have not completed your purchase yet.",
        "",
        "Only 24 hours remain before the deadline expires.",
        "",
        `Please contact the seller at: ${sellerPhone}`,
      ].join("\n");
  }
}

// ─── 48-hour deadline expired ────────────────────────────────────────────────
// Sent once per auction after the 48h window passes without completion.
// Phone is intentionally omitted — at this point the listing is no longer
// transactable and a future strike may be issued (see migration 031 marker).

export function buildPurchaseExpiredTitle(language: WonMessageLang): string {
  switch (language) {
    case "ar": return "❌ انتهت مهلة الشراء";
    case "tr": return "❌ Satın alma süresi doldu";
    case "es": return "❌ Plazo de compra expirado";
    case "fr": return "❌ Délai d’achat expiré";
    case "ru": return "❌ Срок покупки истёк";
    case "en":
    default:   return "❌ Purchase deadline expired";
  }
}

export function buildPurchaseExpiredMessage(language: WonMessageLang): string {
  switch (language) {
    case "ar":
      return [
        "❌ انتهت مهلة الـ 48 ساعة لإتمام عملية الشراء.",
        "",
        "لم تعد هذه الصفقة متاحة. قد يؤثر ذلك على تقييم حسابك مستقبلاً.",
      ].join("\n");
    case "tr":
      return [
        "❌ Satın alma için verilen 48 saatlik süre doldu.",
        "",
        "Bu işlem artık geçerli değildir. Bu durum hesabınızın gelecekteki güvenilirlik puanını etkileyebilir.",
      ].join("\n");
    case "es":
      return [
        "❌ El plazo de 48 horas para completar la compra ha expirado.",
        "",
        "Esta transacción ya no está disponible. Esto podría afectar la reputación futura de tu cuenta.",
      ].join("\n");
    case "fr":
      return [
        "❌ Le délai de 48 heures pour finaliser l’achat a expiré.",
        "",
        "Cette transaction n’est plus disponible. Cela pourra affecter la fiabilité future de votre compte.",
      ].join("\n");
    case "ru":
      return [
        "❌ 48-часовой срок для завершения покупки истёк.",
        "",
        "Эта сделка больше недоступна. Это может повлиять на надёжность вашего аккаунта в будущем.",
      ].join("\n");
    case "en":
    default:
      return [
        "❌ The 48-hour purchase deadline has expired.",
        "",
        "This transaction is no longer available. This may affect your account's future trust standing.",
      ].join("\n");
  }
}
