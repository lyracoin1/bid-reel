/**
 * Notification creation helpers — server-side only.
 * Uses the service_role admin client so RLS is bypassed.
 *
 * Each public function:
 *   1. Inserts a row into the `notifications` table (in-app inbox)
 *   2. Optionally fires push via FCM when the user has registered tokens
 *      AND the type is in the PUSH_ENABLED set below
 *
 * Schema (migration 003 + 020 + 026):
 *   id, user_id, type, message, title, body, metadata jsonb,
 *   auction_id, actor_id, read, created_at
 *
 * Self-notification guard:
 *   Every helper that takes both an actor and a recipient bails out when
 *   they're the same user — the server NEVER emits a notification to yourself.
 *
 * Dedup window:
 *   For low-value spammy events (liked, saved, followed, ending_soon) we
 *   suppress duplicates against the same (user, actor, auction) within
 *   DEDUP_WINDOW_MINUTES so a single user mass-liking your reels doesn't
 *   spam your inbox.
 */

import { supabaseAdmin } from "./supabase";
import { logger } from "./logger";
import { sendFcmPush } from "./fcm";
import {
  buildAuctionWonMessage,
  buildAuctionWonTitle,
  normalizeWonLang,
} from "./auction-won-message";
import { sendWhatsApp } from "./whatsapp";

// ─── Type taxonomy ────────────────────────────────────────────────────────────

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
  // legacy aliases (kept so older inserts and existing rows still parse)
  | "new_follower"
  | "new_bid"
  | "new_bid_received"
  | "auction_started"
  | "auction_removed";

/**
 * Types that fire a push notification (in addition to the in-app row).
 * Low-value events (liked/saved/comment/reply/mention) are intentionally
 * in-app only — see spec rule "Do not send push for low-value spammy events".
 */
const PUSH_ENABLED: ReadonlySet<NotificationType> = new Set<NotificationType>([
  "followed_you",
  "new_follower",            // legacy alias also pushes
  "bid_received",
  "new_bid_received",        // legacy alias also pushes
  "outbid",
  "auction_won",
  "auction_ended",
  "auction_unsold",
  "auction_ending_soon",
  "admin_message",
  "account_warning",
]);

/**
 * Types that get deduplicated against the most recent same-actor / same-auction
 * row within DEDUP_WINDOW_MINUTES. Spec: dedup liked/saved/followed/ending_soon.
 * NEVER dedup: outbid, bid_received, auction_won.
 */
const DEDUP_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  "liked_your_auction",
  "saved_your_auction",
  "followed_you",
  "auction_ending_soon",
]);

const DEDUP_WINDOW_MINUTES = 60;

// ─── Core insert ──────────────────────────────────────────────────────────────

export interface CreateNotificationInput {
  userId: string;                  // recipient
  type: NotificationType;
  /** Short headline. Stored in `title` and used as the FCM push title. */
  title: string;
  /** Long-form text. Stored in `body` AND in legacy `message` (back-compat). */
  body: string;
  auctionId?: string;
  actorId?: string;                // who triggered the event (NULL for system)
  metadata?: Record<string, unknown>;
}

/**
 * Look up all active FCM device tokens for a user. Empty array on missing table
 * or zero registered devices.
 */
async function getUserFcmTokens(userId: string): Promise<string[]> {
  logger.info({ userId }, "push-chain[5]: token lookup START (user_devices)");
  const { data, error } = await supabaseAdmin
    .from("user_devices")
    .select("token, platform, last_seen_at")
    .eq("user_id", userId);

  if (error) {
    const code = (error as { code?: string }).code;
    logger.error(
      { userId, err: error.message, code },
      "push-chain[5]: token lookup FAILED",
    );
    if (code !== "42P01") {
      logger.warn({ err: error.message, userId }, "fcm: failed to fetch device tokens");
    }
    return [];
  }
  const rows = data ?? [];
  logger.info(
    {
      userId,
      tokenCount: rows.length,
      platforms: rows.map((r: { platform: string | null }) => r.platform ?? "unknown"),
    },
    "push-chain[6]: token lookup OK",
  );
  return rows.map((r: { token: string }) => r.token);
}

/**
 * Returns true when an equivalent notification was inserted within the dedup
 * window. Equivalence keys: (user_id, type, actor_id, auction_id).
 * Used only for the 4 dedup types — other types skip this check entirely.
 */
async function isDuplicate(input: CreateNotificationInput): Promise<boolean> {
  if (!DEDUP_TYPES.has(input.type)) return false;

  const since = new Date(Date.now() - DEDUP_WINDOW_MINUTES * 60_000).toISOString();

  let q = supabaseAdmin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", input.userId)
    .eq("type", input.type)
    .gte("created_at", since);

  // actor_id can be NULL — match exactly
  q = input.actorId ? q.eq("actor_id", input.actorId) : q.is("actor_id", null);
  q = input.auctionId ? q.eq("auction_id", input.auctionId) : q.is("auction_id", null);

  const { count, error } = await q;
  if (error) {
    // On any error, fail open (allow insert) so notifications never silently disappear.
    logger.warn({ err: error.message, type: input.type }, "notifications: dedup check failed — proceeding");
    return false;
  }
  return (count ?? 0) > 0;
}

/**
 * Insert a notification row. Optionally fires FCM push when the type is push-enabled.
 * Non-throwing — logs errors but never bubbles them up.
 *
 * Self-notification guard: caller is expected to check actorId !== userId before
 * calling, but we double-check here as a safety net.
 */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  // Hard self-notification guard
  if (input.actorId && input.actorId === input.userId) {
    logger.debug({ userId: input.userId, type: input.type }, "notifications: skipped self-notification");
    return;
  }

  // Dedup
  if (await isDuplicate(input)) {
    logger.debug(
      { userId: input.userId, type: input.type, actorId: input.actorId, auctionId: input.auctionId },
      "notifications: deduped — recent equivalent exists",
    );
    return;
  }

  const { error } = await supabaseAdmin.from("notifications").insert({
    user_id: input.userId,
    type: input.type,
    message: input.body,         // back-compat with old `message` column
    title: input.title,
    body: input.body,
    auction_id: input.auctionId ?? null,
    actor_id: input.actorId ?? null,
    metadata: input.metadata ?? null,
    read: false,
  });

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01") {
      logger.info({ userId: input.userId, type: input.type }, "notifications: table not found — run migrations");
    } else if (code === "PGRST204") {
      logger.error(
        { err: error.message, code, type: input.type },
        "notifications: column mismatch — apply migration 026_notifications_full_taxonomy.sql",
      );
    } else if (code === "23514") {
      logger.error(
        { err: error.message, code, type: input.type },
        "notifications: type rejected by CHECK — apply migration 026_notifications_full_taxonomy.sql",
      );
    } else {
      logger.error({ err: error.message, code, type: input.type }, "notifications: insert failed unexpectedly");
    }
    return;
  }

  logger.info(
    { userId: input.userId, type: input.type, auctionId: input.auctionId, actorId: input.actorId },
    "push-chain[3]: notifications row inserted",
  );

  // Push?
  if (!PUSH_ENABLED.has(input.type)) {
    logger.info(
      { userId: input.userId, type: input.type },
      "push-chain[4]: type NOT push-enabled — in-app only, no FCM send",
    );
    return;
  }
  logger.info(
    { userId: input.userId, type: input.type },
    "push-chain[4]: type IS push-enabled — entering FCM fanout",
  );

  const tokens = await getUserFcmTokens(input.userId);
  if (tokens.length === 0) {
    logger.warn(
      { userId: input.userId, type: input.type },
      "push-chain[6.E]: NO TOKENS for recipient — early return, no push will be sent",
    );
    return;
  }

  const data: Record<string, string> = { type: input.type };
  if (input.auctionId) data["auctionId"] = input.auctionId;
  if (input.actorId) data["actorId"] = input.actorId;
  if (input.metadata) {
    for (const [k, v] of Object.entries(input.metadata)) {
      if (v !== undefined && v !== null) data[k] = String(v);
    }
  }

  logger.info(
    { userId: input.userId, type: input.type, tokenCount: tokens.length },
    "push-chain[7]: sendFcmPush fanout START",
  );
  await Promise.all(
    tokens.map(token =>
      sendFcmPush(token, { title: input.title, body: input.body, data }),
    ),
  );
  logger.info(
    { userId: input.userId, type: input.type, tokenCount: tokens.length },
    "push-chain[10]: sendFcmPush fanout COMPLETE",
  );
}

// =============================================================================
// ── HELPERS — one per spec event ─────────────────────────────────────────────
// =============================================================================

const fmtMoney = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

// ── Follow ────────────────────────────────────────────────────────────────────

/** A started following B → notify B. PUSH. */
export async function notifyFollowedYou(
  followedUserId: string,
  followerUserId: string,
  followerName: string,
): Promise<void> {
  if (followedUserId === followerUserId) return;
  logger.info({ followedUserId, followerUserId }, "notifications: followed_you");
  await createNotification({
    userId: followedUserId,
    type: "followed_you",
    title: "New follower 🎉",
    body: `${followerName} started following you`,
    actorId: followerUserId,
    metadata: { actorId: followerUserId },
  });
}

/** Legacy alias — keep for any caller still using the old name. */
export const notifyNewFollower = notifyFollowedYou;

// ── Like (in-app only, deduped) ──────────────────────────────────────────────

export async function notifyLikedYourAuction(
  sellerId: string,
  likerId: string,
  likerName: string,
  auctionId: string,
  auctionTitle: string,
): Promise<void> {
  if (sellerId === likerId) return;
  logger.info({ sellerId, likerId, auctionId }, "notifications: liked_your_auction");
  await createNotification({
    userId: sellerId,
    type: "liked_your_auction",
    title: "New like ❤️",
    body: `${likerName} liked your auction "${auctionTitle}"`,
    auctionId,
    actorId: likerId,
    metadata: { auctionId, actorId: likerId },
  });
}

// ── Save (in-app only, deduped) ──────────────────────────────────────────────

export async function notifySavedYourAuction(
  sellerId: string,
  saverId: string,
  saverName: string,
  auctionId: string,
  auctionTitle: string,
): Promise<void> {
  if (sellerId === saverId) return;
  logger.info({ sellerId, saverId, auctionId }, "notifications: saved_your_auction");
  await createNotification({
    userId: sellerId,
    type: "saved_your_auction",
    title: "Saved 🔖",
    body: `${saverName} saved your auction "${auctionTitle}"`,
    auctionId,
    actorId: saverId,
    metadata: { auctionId, actorId: saverId },
  });
}

// ── Comment / reply / mention (in-app only) ──────────────────────────────────
// Wired once a comments feature ships. Schema + helpers ready.

export async function notifyCommentedOnYourAuction(
  sellerId: string,
  commenterId: string,
  commenterName: string,
  auctionId: string,
  auctionTitle: string,
  commentId: string,
  excerpt: string,
): Promise<void> {
  if (sellerId === commenterId) return;
  await createNotification({
    userId: sellerId,
    type: "commented_on_your_auction",
    title: `${commenterName} commented`,
    body: `On "${auctionTitle}": ${excerpt}`,
    auctionId,
    actorId: commenterId,
    metadata: { auctionId, actorId: commenterId, commentId },
  });
}

export async function notifyRepliedToYourComment(
  parentAuthorId: string,
  replierId: string,
  replierName: string,
  auctionId: string,
  parentCommentId: string,
  replyId: string,
  excerpt: string,
): Promise<void> {
  if (parentAuthorId === replierId) return;
  await createNotification({
    userId: parentAuthorId,
    type: "replied_to_your_comment",
    title: `${replierName} replied`,
    body: excerpt,
    auctionId,
    actorId: replierId,
    metadata: { auctionId, actorId: replierId, commentId: replyId, parentCommentId },
  });
}

export async function notifyMentionedYou(
  mentionedUserId: string,
  mentionerId: string,
  mentionerName: string,
  auctionId: string,
  commentId: string,
  excerpt: string,
): Promise<void> {
  if (mentionedUserId === mentionerId) return;
  await createNotification({
    userId: mentionedUserId,
    type: "mentioned_you",
    title: `${mentionerName} mentioned you`,
    body: excerpt,
    auctionId,
    actorId: mentionerId,
    metadata: { auctionId, actorId: mentionerId, commentId },
  });
}

// ── Bidding (NEVER deduped) ──────────────────────────────────────────────────

/** Bidder placed a bid → notify seller. PUSH. */
export async function notifyBidReceived(
  sellerId: string,
  bidderId: string,
  bidderName: string | null,
  auctionId: string,
  auctionTitle: string,
  newAmount: number,
): Promise<void> {
  logger.info(
    { sellerId, bidderId, auctionId, newAmount, hasBidderName: bidderName != null },
    "push-chain[2.A]: notifyBidReceived ENTER",
  );
  if (sellerId === bidderId) {
    logger.warn(
      { sellerId, bidderId, auctionId },
      "push-chain[2.A]: notifyBidReceived SKIP — self-notification (sellerId === bidderId)",
    );
    return;
  }
  try {
    const who = bidderName?.trim() || "Someone";
    const dollars = fmtMoney(newAmount);
    logger.info(
      { sellerId, auctionId, type: "bid_received" },
      "push-chain[2.B]: notifyBidReceived → about to call createNotification",
    );
    await createNotification({
      userId: sellerId,
      type: "bid_received",
      title: "New bid on your auction 💰",
      body: `${who} placed a bid of ${dollars} on "${auctionTitle}"`,
      auctionId,
      actorId: bidderId,
      metadata: { auctionId, actorId: bidderId, bidAmountCents: newAmount },
    });
    logger.info(
      { sellerId, auctionId },
      "push-chain[2.C]: notifyBidReceived → createNotification returned",
    );
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), sellerId, auctionId },
      "push-chain[2.X]: notifyBidReceived THREW",
    );
    throw err;
  }
}

/** Legacy alias preserved. */
export const notifyNewBidReceived = (
  sellerId: string,
  auctionId: string,
  auctionTitle: string,
  newAmount: number,
  bidderName?: string | null,
) => notifyBidReceived(sellerId, "00000000-0000-0000-0000-000000000000", bidderName ?? null, auctionId, auctionTitle, newAmount);

/** Previous high-bidder got beaten → notify them. PUSH. */
export async function notifyOutbid(
  prevBidderId: string,
  newBidderId: string | null,
  auctionId: string,
  auctionTitle: string,
  newAmount: number,
): Promise<void> {
  if (newBidderId && prevBidderId === newBidderId) return;
  const dollars = fmtMoney(newAmount);
  logger.info({ prevBidderId, auctionId }, "notifications: outbid");
  await createNotification({
    userId: prevBidderId,
    type: "outbid",
    title: "You've been outbid 🔴",
    body: `New high bid is ${dollars} on "${auctionTitle}" — bid again now!`,
    auctionId,
    actorId: newBidderId ?? undefined,
    metadata: { auctionId, bidAmountCents: newAmount },
  });
}

// ── Auction completion ───────────────────────────────────────────────────────

/**
 * Winner notification. PUSH.
 *
 * Behavior change (per spec):
 *   - Looks up the seller's phone from profiles.phone
 *   - Builds a localized message in the winner's selected language
 *     (en, ar, tr, es, fr, ru — fallback en) that includes a 🎉 congrats,
 *     the explicit 48-hour deadline, and the seller's phone number embedded
 *     directly in the body so the winner can copy/paste into WhatsApp.
 *   - SKIPS the notification entirely when the seller has no phone on file —
 *     a winner-notification without a contact number is useless and the
 *     spec mandates "Do not send if phone is missing".
 *
 * Profile language is read defensively: if the column doesn't exist on this
 * deployment the lookup falls back to English without erroring.
 */
export async function notifyAuctionWon(
  winnerId: string,
  auctionId: string,
  auctionTitle: string,
  finalAmount: number,
  sellerId: string,
): Promise<void> {
  // 1. Seller phone — required. Without it we cannot meet the spec, so skip.
  const { data: sellerRow, error: sellerErr } = await supabaseAdmin
    .from("profiles")
    .select("phone")
    .eq("id", sellerId)
    .maybeSingle();

  if (sellerErr) {
    logger.warn(
      { err: sellerErr, sellerId, auctionId },
      "notifications: auction_won — seller phone lookup failed; skipping",
    );
    return;
  }

  const sellerPhone = (sellerRow?.phone ?? "").trim();
  if (!sellerPhone) {
    logger.info(
      { winnerId, sellerId, auctionId },
      "notifications: auction_won SKIPPED — seller has no phone on file",
    );
    return;
  }

  // 2. Winner language + phone — read defensively. The `language` column may
  //    not exist on every deployment; treat any error or missing value as
  //    English. Phone is needed for the WhatsApp side-channel below.
  let winnerLang = "en";
  let winnerPhone = "";
  try {
    const { data: winnerRow } = await supabaseAdmin
      .from("profiles")
      .select("language, phone")
      .eq("id", winnerId)
      .maybeSingle();
    if (winnerRow && typeof (winnerRow as { language?: unknown }).language === "string") {
      winnerLang = (winnerRow as { language: string }).language;
    }
    if (winnerRow && typeof (winnerRow as { phone?: unknown }).phone === "string") {
      winnerPhone = (winnerRow as { phone: string }).phone.trim();
    }
  } catch {
    // column missing or other read issue — fall through to defaults
    try {
      const { data: winnerPhoneRow } = await supabaseAdmin
        .from("profiles")
        .select("phone")
        .eq("id", winnerId)
        .maybeSingle();
      if (winnerPhoneRow && typeof (winnerPhoneRow as { phone?: unknown }).phone === "string") {
        winnerPhone = (winnerPhoneRow as { phone: string }).phone.trim();
      }
    } catch {
      /* leave defaults */
    }
  }

  const lang = normalizeWonLang(winnerLang);
  const title = buildAuctionWonTitle(lang);
  const body = buildAuctionWonMessage(lang, sellerPhone);

  // 3. Stamp the 48-hour purchase deadline on the auction (idempotent — only
  //    sets it the first time so re-running expireAuctions is safe). This is
  //    the single source of truth for the reminder/expired schedulers.
  const deadline = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const { error: deadlineErr } = await supabaseAdmin
    .from("auctions")
    .update({ purchase_deadline: deadline })
    .eq("id", auctionId)
    .is("purchase_deadline", null);
  if (deadlineErr) {
    logger.warn({ err: deadlineErr, auctionId }, "notifications: auction_won — purchase_deadline stamp failed");
  }

  logger.info(
    { winnerId, auctionId, finalAmount, lang, phoneIncluded: true, deadline },
    "notifications: auction_won",
  );
  await createNotification({
    userId: winnerId,
    type: "auction_won",
    title,
    body,
    auctionId,
    metadata: {
      auctionId,
      finalAmountCents: finalAmount,
      auctionTitle,
      sellerPhone,
      deadlineHours: 48,
      purchaseDeadline: deadline,
      language: lang,
    },
  });

  // 4. WhatsApp side-channel — winner gets the same body via WA. Best effort.
  //    If the winner has no phone we just skip the WA leg; the in-app
  //    notification has already been recorded above so they will still see it.
  if (winnerPhone) {
    void sendWhatsApp({
      phone: winnerPhone,
      body,
      lang,
      kind: "auction_won",
      meta: { auctionId, winnerId },
    }).catch(err => logger.warn({ err: String(err), auctionId }, "notifications: auction_won — WA dispatch failed"));
  } else {
    logger.info({ winnerId, auctionId }, "notifications: auction_won — winner has no phone, skipping WA leg");
  }
}

/** Seller-side: auction finished with a winner. PUSH. */
export async function notifyAuctionEnded(
  sellerId: string,
  auctionId: string,
  auctionTitle: string,
  finalAmount: number,
): Promise<void> {
  const dollars = fmtMoney(finalAmount);
  logger.info({ sellerId, auctionId }, "notifications: auction_ended");
  await createNotification({
    userId: sellerId,
    type: "auction_ended",
    title: "Auction ended ✅",
    body: `"${auctionTitle}" sold for ${dollars}. The winner has been notified.`,
    auctionId,
    metadata: { auctionId, finalAmountCents: finalAmount },
  });
}

/** Seller-side: auction finished with no bids. PUSH. */
export async function notifyAuctionUnsold(
  sellerId: string,
  auctionId: string,
  auctionTitle: string,
): Promise<void> {
  logger.info({ sellerId, auctionId }, "notifications: auction_unsold");
  await createNotification({
    userId: sellerId,
    type: "auction_unsold",
    title: "Auction ended — no bids",
    body: `"${auctionTitle}" ended without any bids. You can relist it from your profile.`,
    auctionId,
    metadata: { auctionId },
  });
}

/** Ending-soon ping (deduped). PUSH. */
export async function notifyAuctionEndingSoon(
  userId: string,
  auctionId: string,
  auctionTitle: string,
  minutesLeft: number,
): Promise<void> {
  const timeLabel = minutesLeft >= 60
    ? `${Math.round(minutesLeft / 60)} hour${minutesLeft >= 120 ? "s" : ""}`
    : `${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""}`;
  await createNotification({
    userId,
    type: "auction_ending_soon",
    title: "⏳ Auction ending soon",
    body: `"${auctionTitle}" ends in ${timeLabel}`,
    auctionId,
    metadata: { auctionId, minutesLeft },
  });
}

// ── Admin → user ─────────────────────────────────────────────────────────────

/** Admin broadcast / direct message to a user. PUSH. */
export async function notifyAdminMessage(
  userId: string,
  title: string,
  body: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  logger.info({ userId }, "notifications: admin_message");
  await createNotification({
    userId,
    type: "admin_message",
    title,
    body,
    metadata,
  });
}

/** Account warning (e.g. policy violation, before any ban action). PUSH. */
export async function notifyAccountWarning(
  userId: string,
  reason: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  logger.info({ userId }, "notifications: account_warning");
  await createNotification({
    userId,
    type: "account_warning",
    title: "Account warning ⚠️",
    body: reason,
    metadata,
  });
}

// =============================================================================
// ── LEGACY auction_started — kept for back-compat with routes/auctions.ts ────
// =============================================================================

export async function notifyAuctionStarted(
  watcherUserIds: string[],
  auctionId: string,
  auctionTitle: string,
): Promise<void> {
  if (watcherUserIds.length === 0) return;
  logger.info({ auctionId, watcherCount: watcherUserIds.length }, "notifications: auction_started");
  await Promise.all(
    watcherUserIds.map(userId =>
      createNotification({
        userId,
        type: "auction_started",
        title: "🟢 Auction is live!",
        body: `${auctionTitle} just started — place your bid now!`,
        auctionId,
        metadata: { auctionId },
      }),
    ),
  );
}
