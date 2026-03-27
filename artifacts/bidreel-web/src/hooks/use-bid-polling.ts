/**
 * Real-time bidding awareness — MVP polling layer
 *
 * Architecture is intentionally service-oriented:
 *   • Module-level singletons (userBids, interval) survive component re-mounts
 *   • `recordUserBid()` is the write endpoint — called by usePlaceBid after success
 *   • `checkOutbids()` is the read endpoint — called by the interval + manual refresh
 *   • To upgrade to FCM later: replace `setInterval` with a FCM message handler
 *     that calls `checkOutbids()` on "auction.bid_placed" messages
 */

import { useEffect, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { mockAuctions, currentUser } from "@/lib/mock-data";
import { getAuctions } from "@/hooks/use-auctions";
import { formatCurrency } from "@/lib/utils";

// ── Singleton state ─────────────────────────────────────────────────────────
/** Tracks the amount the current user last bid per auction */
const userBids = new Map<string, number>();

/** Prevents the same outbid event from firing a duplicate toast */
const alreadyNotified = new Set<string>();

let pollIntervalId: ReturnType<typeof setInterval> | null = null;
const POLL_INTERVAL_MS = 12_000; // 12 s — conservative for MVP

// ── Bootstrap ───────────────────────────────────────────────────────────────
/** Seed from mock data so we detect outbids on pre-existing bids immediately */
const seedUserBids = () => {
  mockAuctions.forEach((auction) => {
    const myBid = auction.bids.find((b) => b.user.id === currentUser.id);
    if (myBid) userBids.set(auction.id, myBid.amount);
  });
};
seedUserBids();

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Call this whenever the current user successfully places a bid.
 * Updates the tracked amount and resets the notification gate so a future
 * outbid on this auction will fire a new toast.
 */
export function recordUserBid(auctionId: string, amount: number) {
  userBids.set(auctionId, amount);
  alreadyNotified.delete(auctionId);
}

// ── Core detection ──────────────────────────────────────────────────────────
function checkOutbids() {
  const auctions = getAuctions();

  userBids.forEach((myBid, auctionId) => {
    const auction = auctions.find((a) => a.id === auctionId);
    if (!auction || auction.bids.length === 0) return;

    const topBid = auction.bids[0];

    // Still leading — no notification
    if (topBid.user.id === currentUser.id) return;

    // Outbid and not yet notified for this event
    if (topBid.amount > myBid && !alreadyNotified.has(auctionId)) {
      alreadyNotified.add(auctionId);

      toast({
        title: "🔴 You've been outbid!",
        description: `${topBid.user.name} bid ${formatCurrency(topBid.amount)} on "${auction.title}"`,
        variant: "destructive",
      });
    }
  });
}

function startPolling() {
  if (pollIntervalId !== null) return; // already running
  pollIntervalId = setInterval(checkOutbids, POLL_INTERVAL_MS);
}

// ── React hook ───────────────────────────────────────────────────────────────
export interface BidPollingResult {
  /** True during a manual or pull-to-refresh in progress */
  isRefreshing: boolean;
  /** Call to manually trigger a refresh cycle */
  refresh: () => Promise<void>;
}

export function useBidPolling(): BidPollingResult {
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    startPolling();
    // Intentionally no cleanup — polling is a global singleton.
    // For FCM: here you would also register a foreground message listener.
  }, []);

  const refresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    // Simulate a short network round-trip
    await new Promise((r) => setTimeout(r, 900));
    checkOutbids(); // immediate outbid check on manual refresh
    setIsRefreshing(false);
  };

  return { isRefreshing, refresh };
}
