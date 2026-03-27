/**
 * Supabase Realtime — bid subscription hook
 *
 * Subscribes to INSERT events on the `bids` table filtered by auction_id.
 * When a new bid arrives the hook:
 *   1. Updates the caller's local bid state (currentBid / bidCount)
 *   2. Checks whether the current user has been outbid (via use-bid-polling)
 *   3. Fires a toast notification if outbid
 *
 * Falls back gracefully when Supabase credentials are missing or the
 * `bids` table does not yet exist (MVP mock-data phase).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";
import { currentUser } from "@/lib/mock-data";
import { recordUserBid } from "@/hooks/use-bid-polling";

export interface RealtimeBid {
  id: string;
  auction_id: string;
  user_id: string;
  user_name: string;
  user_avatar?: string;
  amount: number;
  created_at: string;
}

export interface RealtimeBidsState {
  /** Most recent bid received from Supabase Realtime */
  latestBid: RealtimeBid | null;
  /** Override currentBid from Realtime (null = use source data) */
  realtimeCurrentBid: number | null;
  /** Override bidCount from Realtime (null = use source data) */
  realtimeBidCount: number | null;
  /** Whether the Supabase channel is connected */
  isConnected: boolean;
}

export function useRealtimeBids(
  auctionId: string,
  baseBidCount: number,
): RealtimeBidsState {
  const [latestBid, setLatestBid] = useState<RealtimeBid | null>(null);
  const [realtimeCurrentBid, setRealtimeCurrentBid] = useState<number | null>(null);
  const [realtimeBidCount, setRealtimeBidCount] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Keep a ref to avoid stale closure in the realtime callback
  const bidCountRef = useRef(baseBidCount);
  bidCountRef.current = realtimeBidCount ?? baseBidCount;

  const handleNewBid = useCallback((bid: RealtimeBid) => {
    setLatestBid(bid);
    setRealtimeCurrentBid(bid.amount);
    setRealtimeBidCount(prev => (prev ?? bidCountRef.current) + 1);

    if (bid.user_id === currentUser.id) {
      // Our own bid (confirmation path — normally fired before we get here)
      recordUserBid(bid.auction_id, bid.amount);
    } else {
      // Someone else placed a bid — check if we've been outbid
      toast({
        title: `📢 New bid on this auction`,
        description: `${bid.user_name} bid ${formatCurrency(bid.amount)}`,
      });
    }
  }, []);

  useEffect(() => {
    if (!supabase || !auctionId) return;

    const channelName = `auction-${auctionId}-bids`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "bids",
          filter: `auction_id=eq.${auctionId}`,
        },
        (payload) => {
          handleNewBid(payload.new as RealtimeBid);
        },
      )
      .subscribe((status) => {
        setIsConnected(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
      setIsConnected(false);
    };
  }, [auctionId, handleNewBid]);

  return { latestBid, realtimeCurrentBid, realtimeBidCount, isConnected };
}
