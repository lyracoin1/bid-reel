export interface User {
  id: string;
  name: string;
  avatar: string;
  handle: string;
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
  mediaUrl: string;
  seller: User;
  likes: number;
  bidCount: number;
  bids: Bid[];
  isLikedByMe?: boolean;
}

const mockUsers: User[] = [
  { id: "u1", name: "Alex Chen", handle: "@alexc", avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop" },
  { id: "u2", name: "Sarah Jenkins", handle: "@sarahj", avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop" },
  { id: "u3", name: "Marcus Doe", handle: "@marcusd", avatar: "https://images.unsplash.com/photo-1599566150163-29194dcaad36?w=100&h=100&fit=crop" },
  { id: "u4", name: "Elena V.", handle: "@elena_v", avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop" },
];

export const currentUser: User = mockUsers[0];

const generateFutureDate = (hours: number) => {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
};

export const mockAuctions: Auction[] = [
  {
    id: "a1",
    title: "Vintage Leica M6 Camera",
    description: "Mint condition Leica M6. Comes with original leather strap and 50mm Summicron lens. Tested and fully working. A dream for street photographers.",
    currentBid: 2450,
    startingBid: 1500,
    endsAt: generateFutureDate(0.5), // Ends soon
    mediaUrl: "https://images.unsplash.com/photo-1516961642265-531546e84af2?w=800&h=1400&fit=crop",
    seller: mockUsers[1],
    likes: 342,
    bidCount: 14,
    bids: [
      { id: "b1", user: mockUsers[2], amount: 2450, timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString() },
      { id: "b2", user: mockUsers[3], amount: 2300, timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString() },
    ],
    isLikedByMe: true,
  },
  {
    id: "a2",
    title: "Air Jordan 1 'Chicago' 2015 - Size 10",
    description: "Deadstock, never worn. Authenticated. Includes original box and extra laces.",
    currentBid: 1800,
    startingBid: 1000,
    endsAt: generateFutureDate(24),
    mediaUrl: "https://images.unsplash.com/photo-1552346154-21d32810aba3?w=800&h=1400&fit=crop",
    seller: mockUsers[2],
    likes: 890,
    bidCount: 32,
    bids: [
      { id: "b3", user: mockUsers[1], amount: 1800, timestamp: new Date(Date.now() - 1000 * 3600).toISOString() },
    ]
  },
  {
    id: "a3",
    title: "Cyberpunk Custom PC Build",
    description: "RTX 4090, i9-13900K, custom loop water cooling. Built in a modded case with reactive neon lighting.",
    currentBid: 4200,
    startingBid: 3000,
    endsAt: generateFutureDate(48),
    mediaUrl: "https://images.unsplash.com/photo-1587831990711-23ca6441447b?w=800&h=1400&fit=crop",
    seller: mockUsers[3],
    likes: 1205,
    bidCount: 8,
    bids: []
  },
  {
    id: "a4",
    title: "Rolex Submariner 'Hulk'",
    description: "Ref 116610LV. Box and papers included. 2018 model, excellent condition.",
    currentBid: 18500,
    startingBid: 15000,
    endsAt: generateFutureDate(72),
    mediaUrl: "https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=800&h=1400&fit=crop",
    seller: mockUsers[1],
    likes: 450,
    bidCount: 22,
    bids: []
  }
];
