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
  endsAt: string;
  mediaUrl: string;         // Cover / first image / video thumbnail
  type: "video" | "album"; // Post type
  images?: string[];        // Album: up to 6 images (mediaUrl = images[0])
  seller: User;
  likes: number;
  bidCount: number;
  bids: Bid[];
  isLikedByMe?: boolean;
}

const mockUsers: User[] = [
  { id: "u1", name: "Alex Chen",     handle: "@alexc",   phone: "14155550001", avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&auto=format" },
  { id: "u2", name: "Sarah Jenkins", handle: "@sarahj",  phone: "14155550002", avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop&auto=format" },
  { id: "u3", name: "Marcus Doe",    handle: "@marcusd", phone: "14155550003", avatar: "https://images.unsplash.com/photo-1599566150163-29194dcaad36?w=100&h=100&fit=crop&auto=format" },
  { id: "u4", name: "Elena V.",      handle: "@elena_v", phone: "14155550004", avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop&auto=format" },
];

export const currentUser: User = mockUsers[0];

const future = (hours: number) => {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
};

export const mockAuctions: Auction[] = [
  {
    id: "a1",
    type: "album",
    title: "Vintage Leica M6 Camera",
    description: "Mint condition Leica M6. Original leather strap + 50mm Summicron lens. Tested and fully working. A dream for street photographers.",
    currentBid: 2450, startingBid: 1500,
    endsAt: future(0.5),
    mediaUrl: "https://images.unsplash.com/photo-1516961642265-531546e84af2?w=800&h=1400&fit=crop&auto=format",
    images: [
      "https://images.unsplash.com/photo-1516961642265-531546e84af2?w=800&h=1400&fit=crop&auto=format",
      "https://images.unsplash.com/photo-1452780212940-6f5c0d14d848?w=800&h=1400&fit=crop&auto=format",
      "https://images.unsplash.com/photo-1542038784456-1ea8e935640e?w=800&h=1400&fit=crop&auto=format",
      "https://images.unsplash.com/photo-1495121605193-b116b5b9c0c6?w=800&h=1400&fit=crop&auto=format",
    ],
    seller: mockUsers[1], likes: 342, bidCount: 14, isLikedByMe: true,
    bids: [
      { id: "b1", user: mockUsers[2], amount: 2450, timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString() },
      { id: "b2", user: mockUsers[3], amount: 2300, timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString() },
      { id: "b3", user: mockUsers[0], amount: 2100, timestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString() },
    ],
  },
  {
    id: "a2",
    type: "video",
    title: "Air Jordan 1 'Chicago' 2015 — Size 10",
    description: "Deadstock, never worn. Authenticated by GOAT. Includes original box and extra laces.",
    currentBid: 1800, startingBid: 1000,
    endsAt: future(24),
    mediaUrl: "https://images.unsplash.com/photo-1552346154-21d32810aba3?w=800&h=1400&fit=crop&auto=format",
    seller: mockUsers[2], likes: 890, bidCount: 32,
    bids: [
      { id: "b4", user: mockUsers[1], amount: 1800, timestamp: new Date(Date.now() - 1000 * 3600).toISOString() },
      { id: "b5", user: mockUsers[3], amount: 1650, timestamp: new Date(Date.now() - 1000 * 3600 * 3).toISOString() },
    ],
  },
  {
    id: "a3",
    type: "video",
    title: "Cyberpunk Custom PC Build",
    description: "RTX 4090, i9-13900K, 64GB DDR5, custom loop water cooling. Built in a modded Lian-Li case with reactive neon lighting.",
    currentBid: 4200, startingBid: 3000,
    endsAt: future(48),
    mediaUrl: "https://images.unsplash.com/photo-1587831990711-23ca6441447b?w=800&h=1400&fit=crop&auto=format",
    seller: mockUsers[3], likes: 1205, bidCount: 8, bids: [],
  },
  {
    id: "a4",
    type: "album",
    title: "Rolex Submariner 'Hulk'",
    description: "Ref 116610LV. Box and papers included. 2018 model. Green bezel in excellent condition. Service history available.",
    currentBid: 18500, startingBid: 15000,
    endsAt: future(72),
    mediaUrl: "https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=800&h=1400&fit=crop&auto=format",
    images: [
      "https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=800&h=1400&fit=crop&auto=format",
      "https://images.unsplash.com/photo-1547996160-81dfa63595aa?w=800&h=1400&fit=crop&auto=format",
      "https://images.unsplash.com/photo-1585386959984-a4155224a1ad?w=800&h=1400&fit=crop&auto=format",
    ],
    seller: mockUsers[1], likes: 450, bidCount: 22,
    bids: [
      { id: "b6", user: mockUsers[0], amount: 18500, timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString() },
    ],
  },
  {
    id: "a5",
    type: "album",
    title: "Original Banksy Print — 'Girl with Balloon'",
    description: "Authenticated screen print. COA included. Framed, museum quality glass.",
    currentBid: 6800, startingBid: 5000,
    endsAt: future(36),
    mediaUrl: "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800&h=1400&fit=crop&auto=format",
    images: [
      "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800&h=1400&fit=crop&auto=format",
      "https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=800&h=1400&fit=crop&auto=format",
      "https://images.unsplash.com/photo-1549887534-1541e9326642?w=800&h=1400&fit=crop&auto=format",
      "https://images.unsplash.com/photo-1561214115-f2f134cc4912?w=800&h=1400&fit=crop&auto=format",
    ],
    seller: mockUsers[0], likes: 678, bidCount: 19,
    bids: [
      { id: "b7", user: mockUsers[2], amount: 6800, timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString() },
    ],
  },
  {
    id: "a6",
    type: "video",
    title: "Vintage Fender Stratocaster 1974",
    description: "All-original sunburst finish. Plays beautifully. Comes with original hardshell case.",
    currentBid: 9200, startingBid: 7000,
    endsAt: future(60),
    mediaUrl: "https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=800&h=1400&fit=crop&auto=format",
    seller: mockUsers[3], likes: 321, bidCount: 11, bids: [],
  },
];
