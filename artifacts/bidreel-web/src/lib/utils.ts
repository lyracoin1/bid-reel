import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { differenceInSeconds } from "date-fns";
import { serverNow } from "@/lib/server-clock";
import { Capacitor } from "@capacitor/core";

// ── Auction state ────────────────────────────────────────────────────────────

export type AuctionState = "upcoming" | "active" | "ended";

export function getAuctionState(auction: {
  startsAt?: string | null;
  endsAt: string;
}): AuctionState {
  const now = serverNow();
  if (new Date(auction.endsAt) <= now) return "ended";
  if (auction.startsAt && new Date(auction.startsAt) > now) return "upcoming";
  return "active";
}

export function getCountdownToStart(startsAt: string): string {
  const secondsLeft = differenceInSeconds(new Date(startsAt), serverNow());
  if (secondsLeft <= 0) return "now";
  if (secondsLeft < 60) return `${secondsLeft}s`;
  if (secondsLeft < 3600) return `${Math.ceil(secondsLeft / 60)}m`;
  if (secondsLeft < 86400) return `${Math.ceil(secondsLeft / 3600)}h`;
  return `${Math.ceil(secondsLeft / 86400)}d`;
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
  const secondsLeft = differenceInSeconds(new Date(endsAt), serverNow());

  if (secondsLeft <= 0) return { text: "Ended", isUrgent: true, isEnded: true };

  const isUrgent = secondsLeft < 3600;

  if (secondsLeft < 60) return { text: `${secondsLeft}s`, isUrgent, isEnded: false };
  if (secondsLeft < 3600) return { text: `${Math.ceil(secondsLeft / 60)}m left`, isUrgent, isEnded: false };

  return { text: `${Math.ceil(secondsLeft / 3600)}h left`, isUrgent: false, isEnded: false };
}

export function getWhatsAppUrl(phone: string, itemTitle?: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "#";
  const text = itemTitle
    ? `Hi, I'm interested in your BidReel auction: "${itemTitle}"`
    : "Hi, I saw your auction on BidReel and I'm interested.";
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function getPublicBaseUrl(): string {
  const configured =
    (import.meta.env["VITE_PUBLIC_BASE_URL"] as string | undefined)?.replace(/\/$/, "") ||
    "https://bid-reel.com";

  if (configured && Capacitor.isNativePlatform()) return configured;

  return window.location.origin;
}