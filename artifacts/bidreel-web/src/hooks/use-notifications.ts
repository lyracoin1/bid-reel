/**
 * useNotifications
 *
 * Manages the notification list for the current user.
 *
 * Strategy:
 *  1. On mount: fetches the last 50 notifications from GET /api/notifications
 *     so historical items survive page reloads.
 *  2. Subscribes to Supabase Realtime INSERT events on `notifications`
 *     filtered by `user_id = eq.{userId}` — new rows arrive instantly and are
 *     prepended without a refetch.
 *  3. Exposes helpers to mark all as read.
 *
 * Falls back gracefully when Supabase credentials or the auth token are absent.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/hooks/use-current-user";
import { API_BASE, getToken } from "@/lib/api-client";

export type NotificationType =
  | "outbid"
  | "auction_started"
  | "auction_won"
  | "new_bid"
  | "new_bid_received"
  | "new_follower"
  | "auction_ending_soon"
  | "auction_removed";

export interface AppNotification {
  id: string;
  type: NotificationType;
  message: string;
  auctionId?: string;
  actorId?: string;
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

  // ── Historical fetch on mount ────────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      const token = await getToken();
      if (!token) return;

      try {
        const res = await fetch(`${API_BASE}/notifications`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const json = await res.json() as {
          notifications: Array<{
            id: string;
            type: string;
            message: string;
            auction_id?: string;
            actor_id?: string;
            read: boolean;
            created_at: string;
          }>;
        };
        const historical: AppNotification[] = (json.notifications ?? []).map(row => ({
          id: row.id,
          type: row.type as NotificationType,
          message: row.message,
          auctionId: row.auction_id,
          actorId: row.actor_id,
          read: row.read ?? false,
          createdAt: row.created_at,
        }));
        setNotifications(historical);
      } catch {
        // Network error — silently ignore, Realtime will still deliver new items
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
            type: string;
            message: string;
            auction_id?: string;
            actor_id?: string;
            read: boolean;
            created_at: string;
          };

          const incoming: AppNotification = {
            id: row.id,
            type: row.type as NotificationType,
            message: row.message,
            auctionId: row.auction_id,
            actorId: row.actor_id,
            read: row.read ?? false,
            createdAt: row.created_at,
          };

          // Prepend only — avoid duplicating an item that arrived via the
          // initial fetch before the Realtime channel was subscribed.
          setNotifications(prev =>
            prev.some(n => n.id === incoming.id) ? prev : [incoming, ...prev]
          );
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

  // ── Mark all read ────────────────────────────────────────────────────────────
  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));

    void (async () => {
      const token = await getToken();
      if (!token) return;
      try {
        await fetch(`${API_BASE}/notifications/read-all`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
      } catch {
        // Non-critical — UI already updated optimistically
      }
    })();
  }, []);

  return { notifications, unreadCount, markAllRead, isConnected };
}
