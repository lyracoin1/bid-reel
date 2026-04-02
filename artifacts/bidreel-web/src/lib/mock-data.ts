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
}
