import { useState, useEffect } from 'react';
import { mockAuctions, mockUsers, currentUser, type Auction } from '@/lib/mock-data';
import { placeBidApi } from '@/lib/api-client';

let globalAuctions = [...mockAuctions];
type Listeners = Set<() => void>;
const listeners: Listeners = new Set();
const notify = () => listeners.forEach(l => l());

/** Read-only snapshot for the polling service — returns the live array reference. */
export function getAuctions(): Auction[] {
  return globalAuctions;
}

export function useAuctions() {
  const [auctions, setAuctions] = useState<Auction[]>(globalAuctions);

  useEffect(() => {
    const handler = () => setAuctions([...globalAuctions]);
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  return { data: auctions, isLoading: false };
}

export function useAuction(id: string) {
  const { data: auctions } = useAuctions();
  return { data: auctions.find(a => a.id === id) || null, isLoading: false };
}

export type BidError =
  | "BID_TOO_LOW"
  | "AUCTION_NOT_ACTIVE"
  | "SELLER_CANNOT_BID"
  | "NO_TOKEN"
  | "UNKNOWN";

export interface PlaceBidOptions {
  onSuccess?: () => void;
  onError?: (code: BidError, message: string) => void;
}

/**
 * Place a bid.
 *
 * Strategy:
 *   1. Try the real API (POST /api/bids).
 *   2. On any network/auth failure, silently fall back to the local mock so
 *      the demo always works even when the DB isn't provisioned yet.
 *   3. On a business-rule failure (too low, not active, seller bid) the error
 *      is surfaced to the caller — no silent fallback.
 */
export function usePlaceBid(options: PlaceBidOptions = {}) {
  const [isPending, setIsPending] = useState(false);
  const [lastError, setLastError] = useState<{ code: BidError; message: string } | null>(null);

  const applyMockBid = (auctionId: string, amount: number) => {
    const idx = globalAuctions.findIndex(a => a.id === auctionId);
    if (idx < 0) return false;
    const auction = globalAuctions[idx];
    if (amount <= auction.currentBid) return false;
    globalAuctions[idx] = {
      ...auction,
      currentBid: amount,
      bidCount: auction.bidCount + 1,
      bids: [
        { id: `bid_${Date.now()}`, user: currentUser, amount, timestamp: new Date().toISOString() },
        ...auction.bids,
      ],
    };
    import('@/hooks/use-bid-polling').then(({ recordUserBid }) => {
      recordUserBid(auctionId, amount);
    });
    notify();
    return true;
  };

  const mutate = async (auctionId: string, amount: number) => {
    setIsPending(true);
    setLastError(null);

    try {
      // ── Try real API ────────────────────────────────────────────────────────
      const result = await placeBidApi(auctionId, amount);

      // Sync the local mock state so the UI reflects the new bid immediately
      applyMockBid(auctionId, amount);

      options.onSuccess?.();
      return result;

    } catch (err: unknown) {
      const e = err as { code?: string; message?: string; statusCode?: number };
      const code = (e.code ?? "UNKNOWN") as BidError;
      const message = e.message ?? "Something went wrong";

      // ── Business rule errors — surface to UI, no fallback ─────────────────
      const businessErrors: BidError[] = ["BID_TOO_LOW", "AUCTION_NOT_ACTIVE", "SELLER_CANNOT_BID"];
      if (businessErrors.includes(code)) {
        setLastError({ code, message });
        options.onError?.(code, message);
        return;
      }

      // ── Infrastructure errors (no DB, unreachable) — use mock fallback ────
      console.warn("[usePlaceBid] API unreachable, using mock fallback:", message);
      await new Promise(r => setTimeout(r, 600)); // simulate latency
      applyMockBid(auctionId, amount);
      options.onSuccess?.();

    } finally {
      setIsPending(false);
    }
  };

  return { mutate, isPending, lastError };
}

export function useCreateAuction() {
  const [isPending, setIsPending] = useState(false);

  const mutate = async (data: Partial<Auction> & { images?: string[] }) => {
    setIsPending(true);
    await new Promise(r => setTimeout(r, 1000));

    const newAuction: Auction = {
      id: `a_${Date.now()}`,
      title: data.title || "New Item",
      description: data.description || "",
      currentBid: data.startingBid || 0,
      startingBid: data.startingBid || 0,
      endsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      mediaUrl: data.mediaUrl || "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&h=1400&fit=crop",
      type: (data as any).type || "video",
      images: (data as any).images,
      seller: currentUser,
      likes: 0,
      bidCount: 0,
      bids: [],
    };

    globalAuctions = [newAuction, ...globalAuctions];
    notify();
    setIsPending(false);
    return newAuction.id;
  };

  return { mutate, isPending };
}

export function useToggleLike() {
  const mutate = (auctionId: string) => {
    const idx = globalAuctions.findIndex(a => a.id === auctionId);
    if (idx >= 0) {
      const a = globalAuctions[idx];
      globalAuctions[idx] = { ...a, isLikedByMe: !a.isLikedByMe, likes: a.isLikedByMe ? a.likes - 1 : a.likes + 1 };
      notify();
    }
  };
  return { mutate };
}

// ── Demo: simulate a competitor outbidding the current user ─────────────────
// Fires 10 s after page load to demonstrate the outbid toast.
// In production, real-time bids arrive via WebSocket or FCM — remove this block.
setTimeout(() => {
  const competitor = mockUsers.find(u => u.id === "u3")!; // Marcus Doe
  const idx = globalAuctions.findIndex(a => a.id === "a4");
  if (idx < 0) return;
  const auction = globalAuctions[idx];
  const demoAmount = auction.currentBid + 600;
  globalAuctions[idx] = {
    ...auction,
    currentBid: demoAmount,
    bidCount: auction.bidCount + 1,
    bids: [
      { id: `demo_${Date.now()}`, user: competitor, amount: demoAmount, timestamp: new Date().toISOString() },
      ...auction.bids,
    ],
  };
  notify();
}, 10_000);
