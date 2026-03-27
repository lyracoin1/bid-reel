import { useState, useEffect } from 'react';
import { mockAuctions, mockUsers, currentUser, type Auction } from '@/lib/mock-data';

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

export function usePlaceBid() {
  const [isPending, setIsPending] = useState(false);

  const mutate = async (auctionId: string, amount: number) => {
    setIsPending(true);
    await new Promise(r => setTimeout(r, 600));

    const idx = globalAuctions.findIndex(a => a.id === auctionId);
    if (idx >= 0) {
      const auction = globalAuctions[idx];
      if (amount > auction.currentBid) {
        globalAuctions[idx] = {
          ...auction,
          currentBid: amount,
          bidCount: auction.bidCount + 1,
          bids: [{ id: `bid_${Date.now()}`, user: currentUser, amount, timestamp: new Date().toISOString() }, ...auction.bids],
        };
        // Inform the polling service of the user's new bid so outbid detection is accurate
        import('@/hooks/use-bid-polling').then(({ recordUserBid }) => {
          recordUserBid(auctionId, amount);
        });
        notify();
      }
    }
    setIsPending(false);
  };

  return { mutate, isPending };
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
