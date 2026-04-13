/**
 * useNotifications
 *
 * Manages the notification list for the current user.
 *
 * Strategy:
 *  1. Starts with an empty list — no mock data.
 *  2. Subscribes to Supabase Realtime INSERT events on `notifications`
 *     filtered by `user_id = eq.{userId}` — new rows arrive instantly.
 *  3. Exposes helpers to mark all as read and dismiss the panel.
 *
 * Falls back gracefully when Supabase credentials are not configured.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/hooks/use-current-user";

export type NotificationType = "outbid" | "auction_started" | "auction_won" | "new_bid";

export interface AppNotification {
  id: string;
  type: NotificationType;
  message: string;
  auctionId?: string;
  read: boolean;
  createdAt: string;
}


export interface UseNotificationsReturn {
  notifications: AppNotification[];
  unreadCount: number;
  markAllRead: () => void;
  isConnected: boolean;
}

export function useNotifications(): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
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
    const sb = supabase;
    if (!sb) return;

    const userId = getCurrentUserId();
    if (!userId) return;

    const channelName = `notifications:${userId}`;

    const channel = sb
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
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
      void sb.removeChannel(channel);
      channelRef.current = null;
      setIsConnected(false);
    };
  }, []);

  return { notifications, unreadCount, markAllRead, isConnected };
}
