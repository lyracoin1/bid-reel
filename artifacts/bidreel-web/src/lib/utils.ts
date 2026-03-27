import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { differenceInSeconds } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function getTimeRemaining(endsAt: string | Date): {
  text: string;
  isUrgent: boolean;
  isEnded: boolean;
} {
  const secondsLeft = differenceInSeconds(new Date(endsAt), new Date());

  if (secondsLeft <= 0) return { text: "Ended", isUrgent: true, isEnded: true };

  const isUrgent = secondsLeft < 3600;

  if (secondsLeft < 60)    return { text: `${secondsLeft}s`, isUrgent, isEnded: false };
  if (secondsLeft < 3600)  return { text: `${Math.floor(secondsLeft / 60)}m left`, isUrgent, isEnded: false };
  if (secondsLeft < 86400) return { text: `${Math.floor(secondsLeft / 3600)}h left`, isUrgent: false, isEnded: false };

  return { text: `${Math.floor(secondsLeft / 86400)}d left`, isUrgent: false, isEnded: false };
}

/** Builds a wa.me deep-link that opens a WhatsApp chat with a pre-filled message. */
export function getWhatsAppUrl(phone: string, itemTitle: string): string {
  const msg = `Hi! I saw your listing on BidReel: "${itemTitle}". I'm interested — can we talk?`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}
