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
 * Wiring status:
 *   notifyOutbid          — ✅ WIRED  (routes/auctions.ts, both bid endpoints)
 *   notifyNewFollower     — ✅ WIRED  (routes/follows.ts, POST follow)
 *   notifyAuctionStarted  — ✅ WIRED  (routes/auctions.ts, POST /api/auctions)
 *   notifyAuctionWon      — ✅ WIRED  (lib/auction-lifecycle.ts, expireAuctions loop)
 *   notifyAuctionEndingSoon — ⏳ READY (not wired — requires scheduler, phase 2)
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
 *   42P01    — table does not exist (environment not yet migrated) → INFO
 *   PGRST204 — column not found (schema/code mismatch) → ERROR with remediation hint
 *   23514    — check_violation (type not in CHECK list) → ERROR with remediation hint
 *   other    — unexpected DB error → ERROR with full context
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
      logger.info(
        { userId: input.userId, type: input.type },
        "notifications: table not found — run migrations"
      );
    } else if (code === "PGRST204") {
      logger.error(
        { err: error.message, code, type: input.type },
        "notifications: column mismatch — apply migration 020_notifications_schema_fix.sql"
      );
    } else if (code === "23514") {
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

// =============================================================================
// ── WIRED HELPERS ─────────────────────────────────────────────────────────────
// =============================================================================

/**
 * Notify the previous highest bidder that they have been outbid.
 * WIRED: routes/auctions.ts → POST /api/bids and POST /api/auctions/:id/bids
 */
export async function notifyOutbid(
  prevBidderId: string,
  auctionId: string,
  auctionTitle: string,
  newAmount: number,
): Promise<void> {
  const dollars = (newAmount / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const message = `You've been outbid on "${auctionTitle}" — new high bid is ${dollars}`;

  logger.info({ prevBidderId, auctionId }, "notifications: triggering outbid");

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
 * Notify all followers of a seller that their auction just went live.
 * WIRED: routes/auctions.ts → POST /api/auctions
 *
 * watcherUserIds — follower_ids from user_follows where following_id = sellerId.
 * Safe early-return when the list is empty.
 */
export async function notifyAuctionStarted(
  watcherUserIds: string[],
  auctionId: string,
  auctionTitle: string,
): Promise<void> {
  if (watcherUserIds.length === 0) return;

  logger.info(
    { auctionId, watcherCount: watcherUserIds.length },
    "notifications: triggering auction_started"
  );

  const message = `Auction is now live: "${auctionTitle}"`;

  await Promise.all(
    watcherUserIds.map(userId =>
      createNotification({
        userId,
        type: "auction_started",
        message,
        auctionId,
        fcm: {
          title: "🟢 Auction is live!",
          body: `${auctionTitle} just started — place your bid now!`,
          data: { auctionId, type: "auction_started" },
        },
      })
    )
  );
}

/**
 * Notify user B that user A started following them.
 * WIRED: routes/follows.ts → POST /api/users/:id/follow
 */
export async function notifyNewFollower(
  followedUserId: string,
  followerUserId: string,
  followerName: string,
): Promise<void> {
  const message = `${followerName} started following you`;

  logger.info({ followedUserId, followerUserId }, "notifications: triggering new_follower");

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

// =============================================================================
// ── AUCTION LIFECYCLE NOTIFICATIONS ───────────────────────────────────────────
// =============================================================================

/**
 * Notify the auction winner that they won.
 *
 * WIRED — called from lib/auction-lifecycle.ts expireAuctions() loop.
 * Fires at most once per auction: guarded by updatedCount === 1 check so
 * concurrent expiry calls cannot double-send.
 *
 * Payload matches notifications schema (migration 003 + 020):
 *   user_id    = winnerId
 *   type       = "auction_won"
 *   message    = human-readable win message with final price
 *   auction_id = auctionId
 *   actor_id   = null (system event)
 */
export async function notifyAuctionWon(
  winnerId: string,
  auctionId: string,
  auctionTitle: string,
  finalAmount: number,
): Promise<void> {
  const dollars = (finalAmount / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const message = `You won "${auctionTitle}" with a final bid of ${dollars}. Contact the seller to arrange the exchange.`;

  logger.info({ winnerId, auctionId, finalAmount }, "notifications: triggering auction_won");

  await createNotification({
    userId: winnerId,
    type: "auction_won",
    message,
    auctionId,
    fcm: {
      title: "🏆 You won!",
      body: message,
      data: { auctionId, type: "auction_won" },
    },
  });
}

/**
 * Notify the current leading bidder that the auction ends soon.
 *
 * NOT WIRED — waiting for a scheduler or cron that polls ending auctions.
 * Call this from the expiry scheduler with minutesLeft = 60 (or 30).
 *
 * Payload matches notifications schema (migration 003 + 020):
 *   user_id    = leadingBidderId
 *   type       = "auction_ending_soon"
 *   message    = countdown message
 *   auction_id = auctionId
 *   actor_id   = null (system event)
 */
export async function notifyAuctionEndingSoon(
  leadingBidderId: string,
  auctionId: string,
  auctionTitle: string,
  minutesLeft: number,
): Promise<void> {
  const timeLabel = minutesLeft >= 60
    ? `${Math.round(minutesLeft / 60)} hour${minutesLeft >= 120 ? "s" : ""}`
    : `${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""}`;

  const message = `"${auctionTitle}" ends in ${timeLabel} — you're currently winning!`;

  logger.info({ leadingBidderId, auctionId, minutesLeft }, "notifications: triggering auction_ending_soon");

  await createNotification({
    userId: leadingBidderId,
    type: "auction_ending_soon",
    message,
    auctionId,
    fcm: {
      title: "⏳ Auction ending soon!",
      body: message,
      data: { auctionId, type: "auction_ending_soon", minutesLeft: String(minutesLeft) },
    },
  });
}
