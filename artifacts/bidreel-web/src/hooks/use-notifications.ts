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
 * Race condition fix: if the user cache is not yet populated at mount time
 * (common when BottomNav mounts before use-current-user resolves), we
 * subscribe to user-cache changes via subscribeToUserChange and set up
 * the Realtime channel as soon as the userId becomes available.
 *
 * Falls back gracefully when Supabase credentials or the auth token are absent.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentUserId, subscribeToUserChange } from "@/hooks/use-current-user";
import { API_BASE, getToken } from "@/lib/api-client";

export type NotificationType =
  // canonical (spec) names
  | "followed_you"
  | "liked_your_auction"
  | "saved_your_auction"
  | "commented_on_your_auction"
  | "replied_to_your_comment"
  | "mentioned_you"
  | "bid_received"
  | "outbid"
  | "auction_won"
  | "auction_unsold"
  | "auction_ended"
  | "auction_ending_soon"
  | "admin_message"
  | "account_warning"
  | "auction_shared"
  // Secure Deals
  | "buyer_conditions_submitted"
  | "seller_conditions_submitted"
  | "deal_rated"
  | "payment_proof_uploaded"
  | "shipment_proof_uploaded"
  | "buyer_confirmed_receipt"
  | "buyer_delivery_proof_uploaded"
  | "shipping_fee_dispute_created"
  | "seller_penalty_applied"
  // Escrow (Part #12)
  | "escrow_released"
  | "escrow_disputed"
  // legacy aliases (still emitted by older rows in production)
  | "new_follower"
  | "new_bid"
  | "new_bid_received"
  | "auction_started"
  | "auction_removed";

export interface AppNotification {
  id: string;
  type: NotificationType;
  /** Long-form body. Falls back to `message` for legacy rows. */
  message: string;
  /** Optional short headline (added in migration 026). */
  title?: string;
  auctionId?: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
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

  // Track the user ID as state so that the Realtime subscription effect
  // re-runs when the user cache populates (fixes the mount-time race condition
  // where getCurrentUserId() returns null before the profile fetch completes).
  const [userId, setUserId] = useState<string | null>(() => getCurrentUserId());

  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);

  const unreadCount = notifications.filter(n => !n.read).length;

  // ── Subscribe to user cache so we get the userId once it resolves ────────────
  useEffect(() => {
    const unsub = subscribeToUserChange(() => {
      setUserId(getCurrentUserId());
    });
    return unsub;
  }, []);

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
            title?: string | null;
            body?: string | null;
            metadata?: Record<string, unknown> | null;
            auction_id?: string;
            actor_id?: string;
            read: boolean;
            created_at: string;
          }>;
        };
        const historical: AppNotification[] = (json.notifications ?? []).map(row => ({
          id: row.id,
          type: row.type as NotificationType,
          message: row.body ?? row.message,
          title: row.title ?? undefined,
          auctionId: row.auction_id,
          actorId: row.actor_id,
          metadata: row.metadata ?? undefined,
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

  // ── Supabase Realtime subscription — re-runs when userId becomes available ───
  useEffect(() => {
    const sb = supabase;
    if (!sb || !userId) return;

    // Tear down any existing channel before creating a new one (safety net for
    // the case where userId changes, though in practice it only goes null→string).
    if (channelRef.current) {
      void sb.removeChannel(channelRef.current);
      channelRef.current = null;
    }

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
            title?: string | null;
            body?: string | null;
            metadata?: Record<string, unknown> | null;
            auction_id?: string;
            actor_id?: string;
            read: boolean;
            created_at: string;
          };

          const incoming: AppNotification = {
            id: row.id,
            type: row.type as NotificationType,
            message: row.body ?? row.message,
            title: row.title ?? undefined,
            auctionId: row.auction_id,
            actorId: row.actor_id,
            metadata: row.metadata ?? undefined,
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
  }, [userId]);

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
