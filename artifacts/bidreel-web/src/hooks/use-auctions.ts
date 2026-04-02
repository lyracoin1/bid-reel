import { useState, useEffect } from 'react';
import { type User, type Auction, type Bid } from '@/lib/mock-data';
import {
  placeBidApi,
  getAuctionsApi,
  getAuctionApi,
  createAuctionApi,
  type ApiAuctionRaw,
  type ApiAuctionBid,
  type CreateAuctionInput,
} from '@/lib/api-client';
import { getCurrentUserId, getCachedCurrentUser } from '@/hooks/use-current-user';

// ─── Module-level cache ───────────────────────────────────────────────────────
let globalAuctions: Auction[] = [];
type Listeners = Set<() => void>;
const listeners: Listeners = new Set();
const notify = () => listeners.forEach(l => l());

/** Read-only snapshot for the polling service — returns the live array reference. */
export function getAuctions(): Auction[] {
  return globalAuctions;
}

/** Optimistically remove an auction from the global cache (e.g. after delete). */
export function removeAuctionFromCache(auctionId: string): void {
  globalAuctions = globalAuctions.filter(a => a.id !== auctionId);
  notify();
}

// ─── Data mapping helpers ─────────────────────────────────────────────────────

function apiProfileToUser(
  profile: ApiAuctionRaw['seller'] | ApiAuctionBid['bidder'],
  fallbackId: string,
): User {
  return {
    id: profile?.id ?? fallbackId,
    name: profile?.display_name ?? 'Seller',
    avatar:
      profile?.avatar_url ??
      '',
    handle: `@${(profile?.id ?? fallbackId).slice(0, 8)}`,
    phone: '', // never exposed from API
  };
}

function apiBidToFrontend(bid: ApiAuctionBid): Bid {
  return {
    id: bid.id,
    user: apiProfileToUser(bid.bidder, bid.user_id),
    amount: bid.amount,
    // created_at does not exist in the live bids table — fall back to epoch string
    timestamp: (bid as unknown as Record<string, unknown>).created_at as string ?? new Date(0).toISOString(),
  };
}

function backendToAuction(raw: ApiAuctionRaw, bids: ApiAuctionBid[] = []): Auction {
  // Handle both old schema (current_price, minimum_increment) and new schema (current_bid, min_increment).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any;
  const currentBid: number = r.current_bid ?? r.current_price ?? r.start_price ?? 0;
  const startingBid: number = r.start_price ?? r.starting_bid ?? 0;
  const videoUrl: string | undefined = r.video_url ?? r.storage_path;
  const thumbUrl: string | undefined = r.thumbnail_url ?? r.image_paths?.[0];
  const mediaUrl = videoUrl ?? thumbUrl ?? '';

  return {
    id: raw.id,
    title: raw.title,
    description: raw.description ?? '',
    currentBid,
    startingBid,
    startsAt: raw.starts_at,
    endsAt: raw.ends_at,
    mediaUrl,
    type: videoUrl ? 'video' : 'album',
    seller: apiProfileToUser(raw.seller, raw.seller_id),
    likes: r.like_count ?? 0,
    bidCount: r.bid_count ?? 0,
    bids: bids.map(apiBidToFrontend),
    isLikedByMe: false,
  };
}

// ─── Global refresh (also used by bid polling) ────────────────────────────────

export async function refreshAuctions(): Promise<void> {
  try {
    const auctions = await getAuctionsApi();
    globalAuctions = auctions.map(a => backendToAuction(a));
    console.log(`[use-auctions] ✅ Refreshed — ${globalAuctions.length} auctions from DB`);
    notify();
  } catch (err) {
    console.error('[use-auctions] ❌ Failed to refresh auctions:', err);
  }
}

// ─── useAuctions ──────────────────────────────────────────────────────────────

export function useAuctions() {
  const [auctions, setAuctions] = useState<Auction[]>(globalAuctions);
  const [isLoading, setIsLoading] = useState(globalAuctions.length === 0);

  useEffect(() => {
    const handler = () => setAuctions([...globalAuctions]);
    listeners.add(handler);

    if (globalAuctions.length === 0) {
      refreshAuctions().finally(() => setIsLoading(false));
    }

    const interval = setInterval(refreshAuctions, 30_000);

    return () => {
      listeners.delete(handler);
      clearInterval(interval);
    };
  }, []);

  return { data: auctions, isLoading };
}

// ─── useAuction ───────────────────────────────────────────────────────────────

export function useAuction(id: string) {
  const [auction, setAuction] = useState<Auction | null>(
    () => globalAuctions.find(a => a.id === id) ?? null,
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    const handler = () => {
      const found = globalAuctions.find(a => a.id === id);
      if (found) {
        setAuction(prev => ({ ...found, bids: prev?.bids?.length ? prev.bids : found.bids }));
      }
    };
    listeners.add(handler);

    setIsLoading(true);
    getAuctionApi(id)
      .then(({ auction: raw, bids }) => {
        const mapped = backendToAuction(raw, bids);
        setAuction(mapped);
        // Update the global cache so bid polling sees fresh data
        const idx = globalAuctions.findIndex(a => a.id === id);
        if (idx >= 0) globalAuctions[idx] = mapped;
        else globalAuctions = [mapped, ...globalAuctions];
        notify();
      })
      .catch(err => {
        console.error(`[use-auctions] ❌ Failed to fetch auction ${id}:`, err);
      })
      .finally(() => setIsLoading(false));

    return () => { listeners.delete(handler); };
  }, [id]);

  return { data: auction, isLoading };
}

// ─── usePlaceBid ──────────────────────────────────────────────────────────────

export type BidError =
  | 'BID_TOO_LOW'
  | 'AUCTION_NOT_ACTIVE'
  | 'SELLER_CANNOT_BID'
  | 'NO_TOKEN'
  | 'UNKNOWN';

export interface PlaceBidOptions {
  onSuccess?: () => void;
  onError?: (code: BidError, message: string) => void;
}

export function usePlaceBid(options: PlaceBidOptions = {}) {
  const [isPending, setIsPending] = useState(false);
  const [lastError, setLastError] = useState<{ code: BidError; message: string } | null>(null);

  const mutate = async (auctionId: string, amount: number) => {
    setIsPending(true);
    setLastError(null);
    console.log(`[usePlaceBid] Submitting bid — auctionId=${auctionId} amount=${amount}`);

    try {
      const result = await placeBidApi(auctionId, amount);

      // Update local cache with server-confirmed values
      const idx = globalAuctions.findIndex(a => a.id === auctionId);
      if (idx >= 0) {
        const me = getCachedCurrentUser();
        const meAsUser: User = me
          ? {
              id: me.id,
              name: me.displayName ?? 'You',
              avatar: me.avatarUrl ?? '',
              handle: `@${me.id.slice(0, 8)}`,
              phone: '',
            }
          : {
              id: getCurrentUserId() ?? 'me',
              name: 'You',
              avatar: '',
              handle: '@me',
              phone: '',
            };

        globalAuctions[idx] = {
          ...globalAuctions[idx],
          currentBid: result.auction.current_bid,
          bidCount: result.auction.bid_count,
          bids: [
            {
              id: result.bid.id,
              user: meAsUser,
              amount: result.bid.amount,
              timestamp: result.bid.created_at,
            },
            ...globalAuctions[idx].bids,
          ],
        };
        notify();
      }

      import('@/hooks/use-bid-polling').then(({ recordUserBid }) => {
        recordUserBid(auctionId, amount);
      });

      console.log(
        `[usePlaceBid] ✅ Bid written to DB — bid.id=${result.bid.id}` +
        ` amount=${result.bid.amount} new_current_bid=${result.auction.current_bid}` +
        ` new_bid_count=${result.auction.bid_count}`,
      );
      options.onSuccess?.();

    } catch (err: unknown) {
      const e = err as { code?: string; message?: string; statusCode?: number };
      const code = (e.code ?? 'UNKNOWN') as BidError;
      const message = e.message ?? 'Something went wrong';

      console.error(`[usePlaceBid] ❌ Bid failed — code=${code} status=${e.statusCode} message=${message}`);
      setLastError({ code, message });
      options.onError?.(code, message);

    } finally {
      setIsPending(false);
    }
  };

  return { mutate, isPending, lastError };
}

// ─── useCreateAuction ─────────────────────────────────────────────────────────

export type { CreateAuctionInput };

export function useCreateAuction() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = async (data: CreateAuctionInput): Promise<string> => {
    setIsPending(true);
    setError(null);
    console.log(`[useCreateAuction] Creating auction — title="${data.title}" startPrice=${data.startPrice}`);

    try {
      const { auction } = await createAuctionApi(data);
      const mapped = backendToAuction(auction);
      globalAuctions = [mapped, ...globalAuctions];
      notify();
      console.log(`[useCreateAuction] ✅ Auction written to DB — id=${auction.id}`);
      return auction.id;
    } catch (err: unknown) {
      const msg = (err as Error).message ?? 'Failed to create auction';
      console.error(`[useCreateAuction] ❌ ${msg}`);
      setError(msg);
      throw err;
    } finally {
      setIsPending(false);
    }
  };

  return { mutate, isPending, error };
}

// ─── useToggleLike ────────────────────────────────────────────────────────────

export function useToggleLike() {
  const mutate = (auctionId: string) => {
    const idx = globalAuctions.findIndex(a => a.id === auctionId);
    if (idx >= 0) {
      const a = globalAuctions[idx];
      globalAuctions[idx] = {
        ...a,
        isLikedByMe: !a.isLikedByMe,
        likes: a.isLikedByMe ? a.likes - 1 : a.likes + 1,
      };
      notify();
    }
  };
  return { mutate };
}
