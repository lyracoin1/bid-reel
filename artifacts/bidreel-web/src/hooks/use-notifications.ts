/**
 * useNotifications
 *
 * Manages the notification list for the current user.
 *
 * Strategy:
 *  1. Starts with rich mock data so the panel looks good immediately.
 *  2. Subscribes to Supabase Realtime INSERT events on `notifications`
 *     filtered by `user_id = eq.{currentUser.id}` — new rows arrive instantly.
 *  3. Exposes helpers to mark all as read and dismiss the panel.
 *
 * Falls back gracefully when Supabase credentials are not configured.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { currentUser } from "@/lib/mock-data";

export type NotificationType = "outbid" | "auction_started" | "auction_won" | "new_bid";

export interface AppNotification {
  id: string;
  type: NotificationType;
  message: string;
  auctionId?: string;
  read: boolean;
  createdAt: string;
}

// ─── Seed data (shown before real DB rows arrive) ─────────────────────────────

const now = () => new Date();
const ago = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000).toISOString();

const MOCK_NOTIFICATIONS: AppNotification[] = [
  {
    id: "mn-1",
    type: "outbid",
    message: 'You\'ve been outbid on "Air Jordan 1 \'Chicago\' 2015" — new high bid is $2,100',
    auctionId: "a2",
    read: false,
    createdAt: ago(3),
  },
  {
    id: "mn-2",
    type: "auction_started",
    message: 'Auction is now live: "Vintage Leica M6 Camera — Film Tested"',
    auctionId: "a3",
    read: false,
    createdAt: ago(12),
  },
  {
    id: "mn-3",
    type: "new_bid",
    message: 'Someone placed a $850 bid on your listing "Cyberpunk Custom PC Build"',
    auctionId: "a5",
    read: false,
    createdAt: ago(28),
  },
  {
    id: "mn-4",
    type: "auction_won",
    message: 'Congratulations! You won "Hermès Birkin 25 — Togo Leather"',
    auctionId: "a1",
    read: true,
    createdAt: ago(60 * 24),
  },
  {
    id: "mn-5",
    type: "outbid",
    message: 'You\'ve been outbid on "Rolex Daytona 116500LN" — new high bid is $22,000',
    auctionId: "a4",
    read: true,
    createdAt: ago(60 * 48),
  },
];

export interface UseNotificationsReturn {
  notifications: AppNotification[];
  unreadCount: number;
  markAllRead: () => void;
  isConnected: boolean;
}

export function useNotifications(): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<AppNotification[]>(MOCK_NOTIFICATIONS);
  const [isConnected, setIsConnected] = useState(false);
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    // Best-effort API call (fire-and-forget) — don't block UI
    void fetch("/api/notifications/read-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }).catch(() => {/* ignore */});
  }, []);

  // ── Supabase Realtime subscription ──────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;

    const channelName = `notifications:${currentUser.id}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${currentUser.id}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            type: NotificationType;
            message: string;
            auction_id?: string;
            read: boolean;
            created_at: string;
          };

          const incoming: AppNotification = {
            id: row.id,
            type: row.type,
            message: row.message,
            auctionId: row.auction_id,
            read: row.read ?? false,
            createdAt: row.created_at,
          };

          setNotifications(prev => [incoming, ...prev]);
        },
      )
      .subscribe((status) => {
        setIsConnected(status === "SUBSCRIBED");
      });

    channelRef.current = channel;

    return () => {
      void supabase.removeChannel(channel);
      channelRef.current = null;
      setIsConnected(false);
    };
  }, []);

  return { notifications, unreadCount, markAllRead, isConnected };
}
