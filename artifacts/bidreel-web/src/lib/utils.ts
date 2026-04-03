import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { differenceInSeconds } from "date-fns";

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

/** Builds a wa.me deep-link that opens a WhatsApp chat with a pre-filled message. */
export function getWhatsAppUrl(phone: string, itemTitle: string): string {
  const msg = `Hi! I saw your listing on BidReel: "${itemTitle}". I'm interested — can we talk?`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

/**
 * Returns the public-facing base URL to use when generating shareable links.
 *
 * On web: `window.location.origin` (e.g. https://bidreel.app)
 * On Android Capacitor: `window.location.origin` returns `https://localhost`
 * which is meaningless when shared externally.
 *
 * Set VITE_PUBLIC_BASE_URL in your .env (and as a Replit Secret for builds)
 * to your deployed web domain, e.g. https://bidreel.app  or
 * https://your-replit-project.replit.app
 *
 * That value will be baked into the Android APK at build time and used
 * whenever the app generates a link to share via WhatsApp / system share.
 */
export function getPublicBaseUrl(): string {
  const configured = (import.meta.env["VITE_PUBLIC_BASE_URL"] as string | undefined)?.replace(/\/$/, "");
  if (configured) return configured;
  // Fallback — works correctly on web but will be https://localhost on Android
  return window.location.origin;
}
