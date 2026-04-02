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

import React from "react";
import { useEffect, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { currentUser } from "@/lib/mock-data";
import { getAuctions, refreshAuctions } from "@/hooks/use-auctions";
import { formatCurrency } from "@/lib/utils";

// ── Singleton state ─────────────────────────────────────────────────────────
/** Tracks the amount the current user last bid per auction */
const userBids = new Map<string, number>();

/** Prevents the same outbid event from firing a duplicate toast */
const alreadyNotified = new Set<string>();

let pollIntervalId: ReturnType<typeof setInterval> | null = null;
const POLL_INTERVAL_MS = 30_000; // 30 s — matches auction list refresh

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
        // Action button — navigates to the auction detail page
        action: React.createElement(
          ToastAction,
          {
            altText: "Bid now",
            onClick: () => { window.location.href = `/auction/${auctionId}`; },
          },
          "Bid now",
        ),
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

// ── Status API ────────────────────────────────────────────────────────────────
export type BidStatus = "leading" | "outbid" | "not_bidding";

/**
 * Returns the current user's bidding position on a given auction.
 * "leading"     — user has bid AND currently holds the top spot
 * "outbid"      — user has bid BUT someone else holds the top spot
 * "not_bidding" — user has not placed a bid on this auction
 */
export function getUserBidStatus(
  auctionId: string,
  topBidUserId: string | undefined,
): BidStatus {
  const myBid = userBids.get(auctionId);
  if (!myBid) return "not_bidding";
  if (topBidUserId === currentUser.id) return "leading";
  return "outbid";
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
    try {
      await refreshAuctions(); // real API fetch
      checkOutbids();
    } finally {
      setIsRefreshing(false);
    }
  };

  return { isRefreshing, refresh };
}
