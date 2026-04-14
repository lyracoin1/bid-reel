import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { differenceInSeconds } from "date-fns";
import { Capacitor } from "@capacitor/core";

// ── Auction state ────────────────────────────────────────────────────────────

export type AuctionState = "upcoming" | "active" | "ended";

/**
 * Derives the canonical state of an auction from its timestamps.
 * upcoming → startsAt is in the future
 * active   → between startsAt (or has no startsAt) and endsAt
 * ended    → endsAt is in the past
 */
export function getAuctionState(auction: {
  startsAt?: string | null;
  endsAt: string;
}): AuctionState {
  const now = new Date();
  if (new Date(auction.endsAt) <= now) return "ended";
  if (auction.startsAt && new Date(auction.startsAt) > now) return "upcoming";
  return "active";
}

/** Returns a human-readable countdown string until the auction starts. */
export function getCountdownToStart(startsAt: string): string {
  const secondsLeft = differenceInSeconds(new Date(startsAt), new Date());
  if (secondsLeft <= 0) return "now";
  if (secondsLeft < 60)    return `${secondsLeft}s`;
  if (secondsLeft < 3600)  return `${Math.floor(secondsLeft / 60)}m`;
  if (secondsLeft < 86400) return `${Math.floor(secondsLeft / 3600)}h`;
  return `${Math.floor(secondsLeft / 86400)}d`;
}

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

/** Builds a wa.me deep-link that opens a direct WhatsApp chat with the seller.
 *  Includes a contextual prefilled message so the buyer doesn't need to type.
 *  When itemTitle is supplied the message references the specific auction.
 *  Returns "#" when no phone is available so the link is safe to render. */
export function getWhatsAppUrl(phone: string, itemTitle?: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "#";
  const text = itemTitle
    ? `Hi, I'm interested in your BidReel auction: "${itemTitle}"`
    : "Hi, I saw your auction on BidReel and I'm interested.";
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/**
 * Returns the public-facing base URL to use when generating shareable links.
 *
 * On web: `window.location.origin` — always correct for any domain.
 * On Android Capacitor: `window.location.origin` returns `capacitor://localhost`
 * which is meaningless when shared externally.
 *
 * VITE_PUBLIC_BASE_URL is ONLY used in native Capacitor builds (APK/IPA).
 * Set it to your deployed API domain (e.g. https://bidreel.replit.app) when
 * running `pnpm run android:build`.  On web, window.location.origin is used
 * directly and survives any domain change automatically.
 */
export function getPublicBaseUrl(): string {
  const configured = (import.meta.env["VITE_PUBLIC_BASE_URL"] as string | undefined)?.replace(/\/$/, "");
  // Only use the configured URL in native Capacitor context (APK/IPA).
  // On web, window.location.origin is always the correct public domain and
  // survives any domain change automatically.
  if (configured && Capacitor.isNativePlatform()) return configured;
  return window.location.origin;
}
