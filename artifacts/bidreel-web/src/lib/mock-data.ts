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
}
