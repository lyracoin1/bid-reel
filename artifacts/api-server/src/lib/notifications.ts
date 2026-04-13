/**
 * Notification creation helpers — server-side only.
 * Uses the service_role admin client so RLS is bypassed.
 *
 * Each public function:
 *   1. Inserts a row into the `notifications` table (in-app inbox)
 *   2. Looks up the user's FCM device tokens and fires push notifications
 *      via Firebase Cloud Messaging (no-op when FCM is not configured)
 *
 * Schema (migration 003 + 020):
 *   id, user_id, type, message, auction_id, actor_id, read, created_at
 *
 * All functions are non-throwing — they log errors but never bubble them up.
 */

import { supabaseAdmin } from "./supabase";
import { logger } from "./logger";
import { sendFcmPush } from "./fcm";

export type NotificationType =
  | "outbid"
  | "auction_started"
  | "auction_won"
  | "new_bid"
  | "new_bid_received"
  | "auction_ending_soon"
  | "auction_removed"
  | "new_follower";

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  message: string;
  auctionId?: string;
  actorId?: string;
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
 *
 * Error handling policy:
 *   42P01  — table does not exist (environment not yet migrated) → silent INFO
 *   PGRST204 — column not found (schema/code mismatch) → ERROR with full context
 *   23514  — check_violation (type not in CHECK list) → ERROR with full context
 *   other  — unexpected DB error → ERROR with full context
 */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  const { error } = await supabaseAdmin.from("notifications").insert({
    user_id: input.userId,
    type: input.type,
    message: input.message,
    auction_id: input.auctionId ?? null,
    actor_id: input.actorId ?? null,
    read: false,
  });

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01") {
      // Table not yet created — expected in fresh environments before migrations run.
      logger.info({ userId: input.userId, type: input.type }, "notifications: table not found — run migrations");
    } else if (code === "PGRST204") {
      // Column not found in PostgREST schema cache — schema/code mismatch.
      // Apply migration 020 to fix this.
      logger.error(
        { err: error.message, code, type: input.type },
        "notifications: column mismatch — apply migration 020_notifications_schema_fix.sql"
      );
    } else if (code === "23514") {
      // CHECK constraint violation — notification type not in the allowed list.
      // Apply migration 020 to fix this.
      logger.error(
        { err: error.message, code, type: input.type },
        "notifications: type rejected by CHECK constraint — apply migration 020_notifications_schema_fix.sql"
      );
    } else {
      logger.error({ err: error.message, code, input }, "notifications: insert failed unexpectedly");
    }
    return;
  }

  logger.debug({ userId: input.userId, type: input.type }, "notifications: created");

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
 * Wired: routes/auctions.ts → POST /api/bids
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
 * Not yet wired — no auction-start trigger exists. Phase 2.
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

/**
 * Notify user B that user A started following them.
 * Wired: routes/follows.ts → POST /api/users/:id/follow
 */
export async function notifyNewFollower(
  followedUserId: string,
  followerUserId: string,
  followerName: string,
): Promise<void> {
  const message = `${followerName} started following you`;

  await createNotification({
    userId: followedUserId,
    type: "new_follower",
    message,
    actorId: followerUserId,
    fcm: {
      title: "New follower 🎉",
      body: message,
      data: { actorId: followerUserId, type: "new_follower" },
    },
  });
}
