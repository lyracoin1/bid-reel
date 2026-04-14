import { useState, useEffect, useCallback } from 'react';
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

// Pagination state — shared across all subscribers.
// feedCursor: the ISO timestamp to pass as ?before= on the next load-more request.
// feedHasMore: false when the last page returned fewer than PAGE_SIZE items.
let feedCursor: string | null = null;
let feedHasMore = true;

// True when the last refreshAuctions() call threw a network/API error.
// Reset to false on any successful refresh.
let lastRefreshError = false;

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
  // username is the real handle stored in profiles.username (set during onboarding).
  // display_name is the full name shown elsewhere.
  // Fall back to truncated UUID only when the profile has no username yet.
  const rawUsername = (profile as (typeof profile & { username?: string | null }))?.username;
  const handle = rawUsername ? `@${rawUsername}` : `@${(profile?.id ?? fallbackId).slice(0, 8)}`;

  return {
    id: profile?.id ?? fallbackId,
    name: profile?.display_name ?? rawUsername ?? 'Seller',
    avatar: profile?.avatar_url ?? '',
    handle,
    phone: (profile as (typeof profile & { phone?: string | null }))?.phone ?? '',
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any;
  const currentBid: number = r.current_bid ?? r.start_price ?? 0;
  const startingBid: number = r.start_price ?? 0;
  const videoUrl: string | undefined = r.video_url;
  const thumbUrl: string | undefined = r.thumbnail_url;
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
    // Keep thumbnailUrl separate so FeedCard can use it as a video poster.
    // For video auctions: thumbUrl is the thumbnail image.
    // For image auctions: thumbUrl may equal mediaUrl — fine as a poster fallback.
    thumbnailUrl: thumbUrl ?? null,
    type: videoUrl ? 'video' : 'album',
    seller: apiProfileToUser(raw.seller, raw.seller_id),
    likes: r.like_count ?? 0,
    bidCount: r.bid_count ?? 0,
    bids: bids.map(apiBidToFrontend),
    isLikedByMe: false,
    lat: r.lat ?? null,
    lng: r.lng ?? null,
    currencyCode: r.currency_code ?? null,
    currencyLabel: r.currency_label ?? null,
    userSignal: (r.user_signal as "interested" | "not_interested" | null | undefined) ?? null,
  };
}

// ─── Global refresh (initial load + pull-to-refresh) ─────────────────────────
// Replaces the full cache and resets pagination state back to page 1.
// Do NOT call this on a timer — it would discard pages the user has already
// scrolled through. Manual refresh (pull-to-refresh) intentionally resets.

export async function refreshAuctions(): Promise<void> {
  try {
    const { auctions, nextCursor } = await getAuctionsApi();
    globalAuctions = auctions.map(a => backendToAuction(a));
    feedCursor = nextCursor;
    feedHasMore = nextCursor !== null;
    lastRefreshError = false;
    console.log(
      `[use-auctions] ✅ Refreshed — ${globalAuctions.length} auctions from DB` +
      (feedHasMore ? ` | nextCursor=${feedCursor}` : ' | [last page]'),
    );
    notify();
  } catch (err) {
    console.error('[use-auctions] ❌ Failed to refresh auctions:', err);
    lastRefreshError = true;
    notify();
  }
}

// ─── Load more (pagination / infinite scroll) ────────────────────────────────
// Fetches the next page of older auctions and appends them to the cache.
// Signal ranking is applied per-page (the server ranks each page independently).
// Duplicate IDs are filtered out as a safety net for overlapping cursors.

export async function loadMoreAuctions(): Promise<void> {
  if (!feedCursor || !feedHasMore) return;
  try {
    const { auctions: more, nextCursor } = await getAuctionsApi({ before: feedCursor });
    const existingIds = new Set(globalAuctions.map(a => a.id));
    const newItems = more
      .map(a => backendToAuction(a))
      .filter(a => !existingIds.has(a.id));
    globalAuctions = [...globalAuctions, ...newItems];
    feedCursor = nextCursor;
    feedHasMore = nextCursor !== null;
    console.log(
      `[use-auctions] ✅ Loaded more — ${newItems.length} new auctions` +
      ` (total=${globalAuctions.length})` +
      (feedHasMore ? ` | nextCursor=${feedCursor}` : ' | [last page]'),
    );
    notify();
  } catch (err) {
    console.error('[use-auctions] ❌ loadMoreAuctions failed:', err);
    throw err; // re-throw so the hook can clear isLoadingMore
  }
}

// ─── useAuctions ──────────────────────────────────────────────────────────────

export function useAuctions() {
  const [auctions, setAuctions] = useState<Auction[]>(globalAuctions);
  const [isLoading, setIsLoading] = useState(globalAuctions.length === 0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // Mirror module-level feedHasMore in component state so the feed can react.
  const [hasMore, setHasMore] = useState(feedHasMore);
  // True when the last refresh failed with a network/API error.
  const [isError, setIsError] = useState(lastRefreshError);

  useEffect(() => {
    // Sync component state whenever the global cache or pagination state changes.
    const handler = () => {
      setAuctions([...globalAuctions]);
      setHasMore(feedHasMore);
      setIsError(lastRefreshError);
    };
    listeners.add(handler);

    // Only trigger an initial fetch if the cache is empty.
    // If the cache is already warm (e.g. navigating back to feed), skip the fetch.
    if (globalAuctions.length === 0) {
      setIsLoading(true);
      refreshAuctions().finally(() => setIsLoading(false));
    }

    // Note: No setInterval here. The 30s auto-refresh was removed because it
    // would discard paginated pages the user has scrolled through.
    // Bid count freshness is maintained by useBidPolling's checkOutbids().
    // Users can always pull-to-refresh for the latest data.

    return () => {
      listeners.delete(handler);
    };
  }, []);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !feedHasMore || !feedCursor) return;
    setIsLoadingMore(true);
    try {
      await loadMoreAuctions();
      // hasMore is synced by the notify() handler above — no need to set it here.
    } catch {
      // Error is already logged in loadMoreAuctions.
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore]);

  return { data: auctions, isLoading, loadMore, hasMore, isLoadingMore, isError };
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
