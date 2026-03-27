/**
 * Notification creation helpers — server-side only.
 * Uses the service_role admin client so RLS is bypassed.
 */

import { supabaseAdmin } from "./supabase";
import { logger } from "./logger";
import type { NotificationType } from "@workspace/db/schema";

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  message: string;
  auctionId?: string;
}

/**
 * Insert a single notification row.
 * Non-throwing — logs errors but does not bubble them up so callers
 * (like the bid endpoint) are not blocked by a notification failure.
 */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  const { error } = await supabaseAdmin.from("notifications").insert({
    user_id: input.userId,
    type: input.type,
    message: input.message,
    auction_id: input.auctionId ?? null,
    read: false,
  });

  if (error) {
    // Table may not be provisioned yet in MVP — log and swallow.
    logger.warn({ err: error.message, input }, "notifications: insert failed (table may not exist yet)");
  } else {
    logger.debug({ userId: input.userId, type: input.type }, "notifications: created");
  }
}

/**
 * Notify the previous highest bidder that they have been outbid.
 *
 * @param prevBidderId  The user_id of the bidder who just lost first place.
 * @param auctionId     UUID of the auction.
 * @param auctionTitle  Human-readable auction title for the notification message.
 * @param newAmount     The new highest bid amount (in cents).
 */
export async function notifyOutbid(
  prevBidderId: string,
  auctionId: string,
  auctionTitle: string,
  newAmount: number,
): Promise<void> {
  const dollars = (newAmount / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  await createNotification({
    userId: prevBidderId,
    type: "outbid",
    message: `You've been outbid on "${auctionTitle}" — new high bid is ${dollars}`,
    auctionId,
  });
}

/**
 * Notify all watchers of an auction that it has gone live.
 * Pass the full list of watcher user_ids.
 */
export async function notifyAuctionStarted(
  watcherUserIds: string[],
  auctionId: string,
  auctionTitle: string,
): Promise<void> {
  if (watcherUserIds.length === 0) return;

  const rows = watcherUserIds.map(userId => ({
    user_id: userId,
    type: "auction_started" as NotificationType,
    message: `Auction is now live: "${auctionTitle}"`,
    auction_id: auctionId,
    read: false,
  }));

  const { error } = await supabaseAdmin.from("notifications").insert(rows);
  if (error) {
    logger.warn({ err: error.message, auctionId }, "notifications: auction_started batch insert failed");
  }
}
