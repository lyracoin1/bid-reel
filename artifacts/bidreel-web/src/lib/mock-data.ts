export interface User {
  id: string;
  name: string;
  avatar: string;
  handle: string;
  phone: string;
}

export interface Bid {
  id: string;
  user: User;
  amount: number;
  timestamp: string;
}

export interface Auction {
  id: string;
  title: string;
  description: string;
  currentBid: number;
  startingBid: number;
  startsAt?: string | null;
  endsAt: string;
  mediaUrl: string;
  /** Thumbnail/poster URL. For video auctions this is the separate thumbnail;
   *  for image auctions it's the same as mediaUrl. Used as video poster. */
  thumbnailUrl?: string | null;
  type: "video" | "album";
  images?: string[];
  seller: User;
  likes: number;
  bidCount: number;
  bids: Bid[];
  isLikedByMe?: boolean;
  lat?: number | null;
  lng?: number | null;
  currencyCode?: string | null;
  currencyLabel?: string | null;
  /** The current user's saved signal for this auction, or null if they haven't signaled. */
  userSignal?: "interested" | "not_interested" | null;
  /** Public qualified-views count (server-decided; ≥2s watch, deduped per viewer / 30 min). */
  views?: number;
  /** "auction" (live bidding, default) or "fixed" (Buy Now flow). */
  saleType?: "auction" | "fixed";
  /** Flat purchase price for fixed-price listings; null for auctions. */
  fixedPrice?: number | null;
  /** ID of the buyer who claimed a fixed-price listing; null while available. */
  buyerId?: string | null;
  /** Server-side lifecycle status. UI uses this for Sold/Reserved badges
   *  on top of the orthogonal time-window state (upcoming/active/ended). */
  status?: "active" | "ended" | "removed" | "archived" | "sold" | "reserved";
  /** Per-auction $1 activation timestamp (ISO 8601) — null = locked.
   *  When `saleType === "auction"` and this is null, bidding is blocked
   *  and the seller's contact details are hidden from buyers. Fixed-price
   *  listings are exempt and ignore this field. See migration 031. */
  activatedAt?: string | null;
}
