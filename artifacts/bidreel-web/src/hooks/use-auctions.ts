import { useState, useEffect, useCallback } from 'react';
import { type User, type Auction, type Bid } from '@/lib/mock-data';
import {
  placeBidApi,
  getAuctionsApi,
  getAuctionApi,
  getMyAuctionsApi,
  createAuctionApi,
  buyNowApi,
  markSoldApi,
  likeAuctionApi,
  unlikeAuctionApi,
  startUnlockApi,
  unlockAuctionApi,
  getAuctionApi as _getAuctionApiForUnlockRefetch,
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

/**
 * Append a bid to an auction in the global cache (used by realtime INSERT events
 * so other users' bids appear in the bid history without a manual refresh).
 * Idempotent — bids with an id already present are ignored.
 */
export function appendBidToCache(
  auctionId: string,
  bid: Bid,
  newCurrentBid: number,
  newBidCount: number,
): void {
  const idx = globalAuctions.findIndex(a => a.id === auctionId);
  if (idx < 0) return;
  const existing = globalAuctions[idx].bids;
  if (existing.some(b => b.id === bid.id)) return;
  globalAuctions[idx] = {
    ...globalAuctions[idx],
    currentBid: Math.max(globalAuctions[idx].currentBid, newCurrentBid),
    bidCount: Math.max(globalAuctions[idx].bidCount, newBidCount),
    bids: [...existing, bid],
  };
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
    views: r.views_count ?? 0,
    bidCount: r.bid_count ?? 0,
    // Server is source of truth; fall back to 10 (the server's own default in
    // routes/auctions.ts → getMinIncrement) so the UI floor matches the
    // backend floor exactly when the column is null on legacy rows.
    minIncrement: Math.max(1, Number(r.min_increment ?? 10)),
    bids: bids.map(apiBidToFrontend),
    isLikedByMe: r.is_liked_by_me === true,
    lat: r.lat ?? null,
    lng: r.lng ?? null,
    currencyCode: r.currency_code ?? null,
    currencyLabel: r.currency_label ?? null,
    userSignal: (r.user_signal as "interested" | "not_interested" | null | undefined) ?? null,
    saleType: (r.sale_type as "auction" | "fixed" | null | undefined) ?? "auction",
    fixedPrice: r.fixed_price != null ? Number(r.fixed_price) : null,
    buyerId: r.buyer_id ?? null,
    // Per-viewer unlock flag (migration 032 — buyer-side $1 gate).
    // The server computes this for the calling user: true when fixed-price,
    // when caller is seller, or when (auctionId, callerId) has a paid row in
    // auction_unlocks. Defaults to false (fail-closed = locked) when missing.
    viewerUnlocked: r.viewer_unlocked === true,
    status: (r.status as "active" | "ended" | "removed" | "archived" | "sold" | "reserved" | undefined) ?? "active",
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
  const [isRefetching, setIsRefetching] = useState(false);

  // Single-auction fetch that also writes through to the global cache so
  // the feed stays consistent. Used both for the initial load and for the
  // `refetch()` function callers can invoke to force-refresh the detail page
  // (e.g. after a BID_CONFLICT to replace the stale current_bid + bids).
  const fetchOnce = useCallback(async (): Promise<void> => {
    if (!id) return;
    const { auction: raw, bids } = await getAuctionApi(id);
    const mapped = backendToAuction(raw, bids);
    setAuction(mapped);
    const idx = globalAuctions.findIndex(a => a.id === id);
    if (idx >= 0) globalAuctions[idx] = mapped;
    else globalAuctions = [mapped, ...globalAuctions];
    notify();
  }, [id]);

  const refetch = useCallback(async (): Promise<void> => {
    if (!id) return;
    setIsRefetching(true);
    try {
      await fetchOnce();
    } catch (err) {
      console.error(`[use-auctions] ❌ refetch(${id}) failed:`, err);
    } finally {
      setIsRefetching(false);
    }
  }, [id, fetchOnce]);

  useEffect(() => {
    if (!id) return;

    const handler = () => {
      const found = globalAuctions.find(a => a.id === id);
      if (found) {
        // Merge rule: prefer whichever bids list is longer/fresher.
        // - Feed loads write empty bids[] → keep our richer detail bids.
        // - place-bid / realtime appends grow the list → adopt them so the
        //   bid history reflects every new bid immediately.
        setAuction(prev => {
          const prevBids = prev?.bids ?? [];
          const nextBids = found.bids.length >= prevBids.length ? found.bids : prevBids;
          return { ...found, bids: nextBids };
        });
      }
    };
    listeners.add(handler);

    setIsLoading(true);
    fetchOnce()
      .catch(err => console.error(`[use-auctions] ❌ Failed to fetch auction ${id}:`, err))
      .finally(() => setIsLoading(false));

    return () => { listeners.delete(handler); };
  }, [id, fetchOnce]);

  return { data: auction, isLoading, isRefetching, refetch };
}

// ─── usePlaceBid ──────────────────────────────────────────────────────────────

export type BidError =
  | 'INCREMENT_TOO_LOW'
  | 'BID_TOO_LOW'
  | 'BID_CONFLICT'
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

  // mutate accepts a bid_increment (how much to add).
  // The server computes the final price — clients never send it.
  const mutate = async (auctionId: string, bidIncrement: number) => {
    setIsPending(true);
    setLastError(null);
    console.log(`[usePlaceBid] Submitting bid — auctionId=${auctionId} bid_increment=${bidIncrement}`);

    try {
      const result = await placeBidApi(auctionId, bidIncrement);

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

        // Append (not prepend) — server orders bids by created_at ASC,
        // so the newest bid is the LAST element. Skip if a row with this
        // id is already present (defensive against realtime racing).
        const existingBids = globalAuctions[idx].bids;
        const alreadyPresent = existingBids.some(b => b.id === result.bid.id);
        const nextBids = alreadyPresent
          ? existingBids
          : [
              ...existingBids,
              {
                id: result.bid.id,
                user: meAsUser,
                amount: result.bid.amount,
                timestamp: result.bid.created_at,
              },
            ];
        globalAuctions[idx] = {
          ...globalAuctions[idx],
          currentBid: result.auction.current_bid,
          bidCount: result.auction.bid_count,
          bids: nextBids,
        };
        notify();
      }

      // Record the server-confirmed final amount (not the increment) for outbid tracking.
      import('@/hooks/use-bid-polling').then(({ recordUserBid }) => {
        recordUserBid(auctionId, result.bid.amount);
      });

      console.log(
        `[usePlaceBid] ✅ Bid written to DB — bid.id=${result.bid.id}` +
        ` bid_increment=${bidIncrement} final_amount=${result.bid.amount}` +
        ` new_current_bid=${result.auction.current_bid} new_bid_count=${result.auction.bid_count}`,
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

// ─── useBuyAuction (fixed-price Buy Now) ─────────────────────────────────────
//
// One-shot purchase for `sale_type === "fixed"` listings. The server performs
// an atomic single-row UPDATE; on success it returns the updated auction with
// status='sold' and buyer_id set. We splice the updated row into the cache so
// FeedCard / detail page re-render with the Sold badge immediately.

export function useBuyAuction(auctionId: string) {
  const [isPending, setIsPending] = useState(false);
  const [lastError, setLastError] = useState<{ code: string; message: string } | null>(null);

  const mutate = async (
    options: { onSuccess?: () => void; onError?: (code: string, message: string) => void } = {},
  ): Promise<void> => {
    setIsPending(true);
    setLastError(null);

    try {
      const { auction } = await buyNowApi(auctionId);
      const mapped = backendToAuction(auction);
      globalAuctions = globalAuctions.map((a) => (a.id === auctionId ? { ...a, ...mapped } : a));
      notify();
      options.onSuccess?.();
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      const code = e.code ?? 'BUY_FAILED';
      const message = e.message ?? 'Purchase failed';
      console.error(`[useBuyAuction] ❌ ${code}: ${message}`);
      setLastError({ code, message });
      options.onError?.(code, message);
    } finally {
      setIsPending(false);
    }
  };

  return { mutate, isPending, lastError };
}

// ─── useMarkSold (seller closes a fixed-price listing) ───────────────────────
//
// One-shot mutation that flips status='active' → 'sold' for a fixed-price
// listing the seller closed out-of-band. The server is the only place that
// can authorize this (seller-only, fixed-price-only, status-CAS), so this
// hook is a thin wrapper that patches the cache on success.
export function useMarkSold(auctionId: string) {
  const [isPending, setIsPending] = useState(false);
  const [lastError, setLastError] = useState<{ code: string; message: string } | null>(null);

  const mutate = async (
    options: { onSuccess?: () => void; onError?: (code: string, message: string) => void } = {},
  ): Promise<void> => {
    setIsPending(true);
    setLastError(null);
    try {
      await markSoldApi(auctionId);
      // Locally flip the cache so the UI shows the Sold state immediately
      // without a round-trip. The next detail refetch will reconcile any
      // server-side fields we don't track here (e.g. updated_at).
      const idx = globalAuctions.findIndex((a) => a.id === auctionId);
      if (idx >= 0) {
        globalAuctions[idx] = { ...globalAuctions[idx], status: "sold" };
        notify();
      }
      options.onSuccess?.();
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      const code = e.code ?? "MARK_SOLD_FAILED";
      const message = e.message ?? "Could not mark sold";
      console.error(`[useMarkSold] ❌ ${code}: ${message}`);
      setLastError({ code, message });
      options.onError?.(code, message);
    } finally {
      setIsPending(false);
    }
  };

  return { mutate, isPending, lastError };
}

// ─── useStartUnlock (real Gumroad checkout flow — step 1) ────────────────────
//
// Calls POST /auctions/:id/unlock/start. On success the server returns a
// Gumroad checkout URL carrying a server-generated unlock_token. The caller
// is expected to redirect the buyer to that URL. If the buyer has already
// paid for this auction, alreadyUnlocked=true and checkout_url=null —
// the caller should skip the redirect and treat the auction as unlocked.
//
// Idempotent: re-clicking returns the same token / checkout URL for any
// existing pending row, so closing and reopening the panel is safe.
export function useStartUnlock(auctionId: string) {
  const [isPending, setIsPending] = useState(false);
  const [lastError, setLastError] = useState<{ code: string; message: string } | null>(null);

  const mutate = async (
    options: {
      onSuccess?: (result: {
        checkout_url: string | null;
        unlock_token: string | null;
        alreadyUnlocked: boolean;
      }) => void;
      onError?: (code: string, message: string) => void;
    } = {},
  ): Promise<void> => {
    setIsPending(true);
    setLastError(null);
    try {
      const result = await startUnlockApi(auctionId);
      options.onSuccess?.({
        checkout_url: result.checkout_url,
        unlock_token: result.unlock_token,
        alreadyUnlocked: result.alreadyUnlocked,
      });
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      const code = e.code ?? "START_FAILED";
      const message = e.message ?? "Could not start checkout";
      console.error(`[useStartUnlock] ❌ ${code}: ${message}`);
      setLastError({ code, message });
      options.onError?.(code, message);
    } finally {
      setIsPending(false);
    }
  };

  return { mutate, isPending, lastError };
}

// ─── useUnlockAuction ($1 Gumroad gate — buyer-side, per user, per auction) ──
//
// Wraps unlockAuctionApi and patches the cached auction row in place so the
// UI flips from locked → unlocked without waiting for a feed refresh. We
// also kick off a single targeted detail refetch so the seller's phone (a
// field only the API knows) is populated in cache for the WhatsApp CTA.
// Failures surface a code + message via onError; idempotent re-unlock
// succeeds silently (alreadyUnlocked=true).

export function useUnlockAuction(auctionId: string) {
  const [isPending, setIsPending] = useState(false);
  const [lastError, setLastError] = useState<{ code: string; message: string } | null>(null);

  const mutate = async (
    options: {
      onUnlocked?: () => void;
      onPending?: (status: "pending" | "none") => void;
      onError?: (code: string, message: string) => void;
    } = {},
  ): Promise<void> => {
    setIsPending(true);
    setLastError(null);
    console.log(`[useUnlockAuction] Checking unlock status — auctionId=${auctionId}`);

    try {
      const { unlocked, status } = await unlockAuctionApi(auctionId);

      if (!unlocked) {
        // Webhook hasn't finalised payment yet. We do NOT touch the cache —
        // the server is the source of truth and viewerUnlocked stays false.
        console.log(`[useUnlockAuction] ⌛ Not yet unlocked — status=${status}`);
        options.onPending?.(status === "pending" ? "pending" : "none");
        return;
      }

      // Server confirmed unlocked. Patch cache so the UI panel disappears
      // immediately, then refetch detail to pull the now-visible seller.phone
      // into the cache for the WhatsApp CTA.
      const idx = globalAuctions.findIndex((a) => a.id === auctionId);
      if (idx >= 0) {
        globalAuctions[idx] = { ...globalAuctions[idx], viewerUnlocked: true };
        notify();
      }
      try {
        const { auction: rawDetail, bids: rawBids } = await _getAuctionApiForUnlockRefetch(auctionId);
        if (idx >= 0) {
          globalAuctions[idx] = backendToAuction(rawDetail, rawBids);
          notify();
        }
      } catch (refetchErr) {
        console.warn(`[useUnlockAuction] post-unlock detail refetch failed (continuing):`, refetchErr);
      }

      console.log(`[useUnlockAuction] ✅ Unlocked (verified by webhook) — id=${auctionId}`);
      options.onUnlocked?.();
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      const code = e.code ?? "UNLOCK_FAILED";
      const message = e.message ?? "Status check failed";
      console.error(`[useUnlockAuction] ❌ ${code}: ${message}`);
      setLastError({ code, message });
      options.onError?.(code, message);
    } finally {
      setIsPending(false);
    }
  };

  return { mutate, isPending, lastError };
}

// ─── useToggleLike ────────────────────────────────────────────────────────────

// Per-auction monotonic version counter for like toggles. Each tap bumps
// the version BEFORE firing the network request; only the latest version's
// response is allowed to write back to the cache. This prevents stale,
// out-of-order responses (e.g. like → unlike → like, where the first
// like's response arrives last) from clobbering the user's latest intent.
const likeVersionByAuction = new Map<string, number>();

export function useToggleLike() {
  // Optimistic update + server persistence. Flip the cache immediately so
  // the heart animates without network latency, then call POST/DELETE
  // /api/auctions/:id/like and reconcile against the trigger-maintained
  // `like_count` returned by the server. On failure or stale response we
  // touch ONLY the like fields — never the whole row — so concurrent bid
  // updates aren't clobbered.
  const mutate = (auctionId: string) => {
    const idx = globalAuctions.findIndex(a => a.id === auctionId);
    if (idx < 0) return;

    const prev = globalAuctions[idx];
    const prevIsLiked = prev.isLikedByMe;
    const prevLikes = prev.likes;
    const willLike = !prevIsLiked;

    globalAuctions[idx] = {
      ...prev,
      isLikedByMe: willLike,
      likes: willLike ? prev.likes + 1 : Math.max(prev.likes - 1, 0),
    };
    notify();

    const myVersion = (likeVersionByAuction.get(auctionId) ?? 0) + 1;
    likeVersionByAuction.set(auctionId, myVersion);

    void (async () => {
      try {
        const result = willLike
          ? await likeAuctionApi(auctionId)
          : await unlikeAuctionApi(auctionId);
        // Out-of-order guard: a newer toggle has already been issued — drop.
        if (likeVersionByAuction.get(auctionId) !== myVersion) return;

        const j = globalAuctions.findIndex(a => a.id === auctionId);
        if (j >= 0) {
          globalAuctions[j] = {
            ...globalAuctions[j],
            isLikedByMe: result.isLiked,
            likes: result.likeCount,
          };
          notify();
        }
      } catch (err) {
        // Roll back ONLY the like fields (preserve any concurrent updates
        // to bids/currentBid/etc). Skip if a newer toggle is already in
        // flight — its response is the source of truth.
        if (likeVersionByAuction.get(auctionId) !== myVersion) return;
        const j = globalAuctions.findIndex(a => a.id === auctionId);
        if (j >= 0) {
          globalAuctions[j] = {
            ...globalAuctions[j],
            isLikedByMe: prevIsLiked,
            likes: prevLikes,
          };
          notify();
        }
        console.error("[useToggleLike] failed", err);
      }
    })();
  };
  return { mutate };
}

// ─── useMyAuctions ────────────────────────────────────────────────────────────
// Fetches the current authenticated user's own auctions from GET /api/auctions/mine.
// This endpoint is seller-scoped, auth-gated, and excludes only 'removed' auctions —
// consistent with the auctionCount stat returned by GET /api/users/me.
// Unlike useAuctions(), this is NOT a global paginated feed; it returns all of the
// seller's auctions (active, ended, archived) with no PAGE_SIZE cap.

export function useMyAuctions() {
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    getMyAuctionsApi()
      .then(raw => {
        if (!cancelled) {
          setAuctions(raw.map(a => backendToAuction(a)));
        }
      })
      .catch(err => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to load your auctions';
          console.error('[useMyAuctions] ❌', msg);
          setError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return { data: auctions, isLoading, error };
}
