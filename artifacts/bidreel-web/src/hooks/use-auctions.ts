import { useState, useEffect } from 'react';
import { mockAuctions, currentUser, type Auction } from '@/lib/mock-data';

// Simple global state for mock purposes
let globalAuctions = [...mockAuctions];
type Listeners = Set<() => void>;
const listeners: Listeners = new Set();

const notify = () => listeners.forEach(l => l());

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
  const auction = auctions.find(a => a.id === id);
  return { data: auction || null, isLoading: false };
}

export function usePlaceBid() {
  const [isPending, setIsPending] = useState(false);

  const mutate = async (auctionId: string, amount: number) => {
    setIsPending(true);
    // Simulate network delay
    await new Promise(r => setTimeout(r, 600));
    
    const auctionIndex = globalAuctions.findIndex(a => a.id === auctionId);
    if (auctionIndex >= 0) {
      const auction = globalAuctions[auctionIndex];
      if (amount > auction.currentBid) {
        globalAuctions[auctionIndex] = {
          ...auction,
          currentBid: amount,
          bidCount: auction.bidCount + 1,
          bids: [
            {
              id: `bid_${Date.now()}`,
              user: currentUser,
              amount: amount,
              timestamp: new Date().toISOString()
            },
            ...auction.bids
          ]
        };
        notify();
      } else {
        throw new Error("Bid must be higher than current bid");
      }
    }
    setIsPending(false);
  };

  return { mutate, isPending };
}

export function useCreateAuction() {
  const [isPending, setIsPending] = useState(false);

  const mutate = async (data: Partial<Auction>) => {
    setIsPending(true);
    await new Promise(r => setTimeout(r, 1000));
    
    const newAuction: Auction = {
      id: `a_${Date.now()}`,
      title: data.title || "New Item",
      description: data.description || "",
      currentBid: data.startingBid || 0,
      startingBid: data.startingBid || 0,
      endsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days
      mediaUrl: data.mediaUrl || "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&h=1400&fit=crop",
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
      globalAuctions[idx] = {
        ...a,
        isLikedByMe: !a.isLikedByMe,
        likes: a.isLikedByMe ? a.likes - 1 : a.likes + 1
      };
      notify();
    }
  };
  return { mutate };
}
