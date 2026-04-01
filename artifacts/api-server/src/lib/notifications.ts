/**
 * Notification creation helpers — server-side only.
 * Uses the service_role admin client so RLS is bypassed.
 *
 * Each public function:
 *   1. Inserts a row into the `notifications` table (in-app inbox)
 *   2. Looks up the user's FCM device tokens and fires push notifications
 *      via Firebase Cloud Messaging (no-op when FCM is not configured)
 */

import { supabaseAdmin } from "./supabase";
import { logger } from "./logger";
import { sendFcmPush } from "./fcm";

export type NotificationType =
  | "outbid"
  | "auction_started"
  | "auction_won"
  | "new_bid_received"
  | "auction_ending_soon"
  | "auction_removed";

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  message: string;
  auctionId?: string;
  fcm?: {
    title: string;
    body: string;
    data?: Record<string, string>;
  };
}

/**
 * Look up all active FCM device tokens for a user.
 * Returns an empty array when the user_devices table does not yet exist or
 * the user has no registered devices.
 */
async function getUserFcmTokens(userId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("user_devices")
    .select("token")
    .eq("user_id", userId);

  if (error) {
    if ((error as { code?: string }).code !== "42P01") {
      logger.warn({ err: error.message, userId }, "fcm: failed to fetch device tokens");
    }
    return [];
  }

  return (data ?? []).map((r: { token: string }) => r.token);
}

/**
 * Insert a single notification row and optionally fire an FCM push.
 * Non-throwing — logs errors but does not bubble them up.
 */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  // 1. Insert in-app notification
  const { error } = await supabaseAdmin.from("notifications").insert({
    user_id: input.userId,
    type: input.type,
    message: input.message,
    auction_id: input.auctionId ?? null,
    read: false,
  });

  if (error) {
    logger.warn({ err: error.message, input }, "notifications: insert failed");
  } else {
    logger.debug({ userId: input.userId, type: input.type }, "notifications: created");
  }

  // 2. Fire FCM push if payload provided
  if (!input.fcm) return;

  const tokens = await getUserFcmTokens(input.userId);
  await Promise.all(
    tokens.map(token =>
      sendFcmPush(token, {
        title: input.fcm!.title,
        body: input.fcm!.body,
        data: input.fcm!.data,
      })
    )
  );
}

/**
 * Notify the previous highest bidder that they have been outbid.
 */
export async function notifyOutbid(
  prevBidderId: string,
  auctionId: string,
  auctionTitle: string,
  newAmount: number,
): Promise<void> {
  const dollars = (newAmount / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const message = `You've been outbid on "${auctionTitle}" — new high bid is ${dollars}`;

  await createNotification({
    userId: prevBidderId,
    type: "outbid",
    message,
    auctionId,
    fcm: {
      title: "You've been outbid! 🔴",
      body: `${message} — bid again now!`,
      data: { auctionId, type: "outbid" },
    },
  });
}

/**
 * Notify all watchers of an auction that it has gone live.
 */
export async function notifyAuctionStarted(
  watcherUserIds: string[],
  auctionId: string,
  auctionTitle: string,
): Promise<void> {
  if (watcherUserIds.length === 0) return;

  const message = `Auction is now live: "${auctionTitle}"`;
  const fcmTitle = "🟢 Auction is live!";
  const fcmBody = `${auctionTitle} just started — place your bid now!`;

  await Promise.all(
    watcherUserIds.map(userId =>
      createNotification({
        userId,
        type: "auction_started",
        message,
        auctionId,
        fcm: {
          title: fcmTitle,
          body: fcmBody,
          data: { auctionId, type: "auction_started" },
        },
      })
    )
  );
}
