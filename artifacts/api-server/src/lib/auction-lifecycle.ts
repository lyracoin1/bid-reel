/**
 * auction-lifecycle.ts — Auction expiration, winner assignment, and archival
 *
 * expireAuctions()
 *   Scans for active auctions whose ends_at has passed, marks them
 *   as 'ended', records the winner (highest bid holder), and fires
 *   the auction_won notification to the winner.
 *
 * archiveAuctions()
 *   Scans for ended auctions whose ends_at was more than 7 days ago
 *   and moves them to 'archived'. Archived auctions are hidden from
 *   public feeds but remain in the database for history/admin use.
 *
 * runAuctionLifecycle()
 *   Convenience wrapper that calls expireAuctions() then archiveAuctions()
 *   in sequence. Use this at call sites that already trigger lifecycle work.
 *
 * Execution model: all functions are triggered on-demand (no cron).
 * Idempotency: every UPDATE is guarded by a status equality check so
 * concurrent or duplicate calls never double-process any auction.
 * Batch cap: 50 auctions per call to avoid unbounded latency.
 */

import { supabaseAdmin } from "./supabase";
import { logger } from "./logger";
import { getBidderCol, getBidderUserId, hasWinnerBidIdCol } from "./dbSchema";
import { notifyAuctionWon, notifyAuctionEnded, notifyAuctionUnsold } from "./notifications";
import { sendWhatsAppMessage } from "./whatsapp";
import {
  buildAuctionEndedSellerMessage,
  buildAuctionActionRequiredMessage,
} from "./whatsappTemplates";

/**
 * Best-effort lookup of a profile's phone. Never throws. Returns null when
 * the row, the column, or the value is missing — callers must treat null as
 * "no WhatsApp dispatch possible" and move on quietly.
 */
async function lookupProfilePhone(profileId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("phone")
      .eq("id", profileId)
      .maybeSingle();
    if (error) {
      logger.warn({ err: error.message, profileId }, "auction-lifecycle: phone lookup failed");
      return null;
    }
    const phone = (data as { phone?: string | null } | null)?.phone ?? null;
    return phone && phone.trim() ? phone.trim() : null;
  } catch (err) {
    logger.warn({ err: String(err), profileId }, "auction-lifecycle: phone lookup threw");
    return null;
  }
}

/**
 * Expire all active auctions whose ends_at is in the past.
 *
 * For each expired auction:
 *   - status → 'ended'
 *   - winner_id → ID of the user who placed the highest bid (or null if no bids)
 *   - winner_bid_id → ID of the highest bid row (if migration 021 is applied)
 *
 * Safe to call concurrently and repeatedly — the UPDATE is guarded so only
 * auctions still in 'active' status are ever modified.
 */
export async function expireAuctions(): Promise<void> {
  const now = new Date().toISOString();

  // 1. Find active auctions that have passed their end time.
  //    title is fetched here so notifyAuctionWon can include it in the message.
  const { data: expired, error: fetchErr } = await supabaseAdmin
    .from("auctions")
    .select("id, title, seller_id")
    .eq("status", "active")
    .lt("ends_at", now)
    .limit(50);

  if (fetchErr) {
    logger.warn({ err: fetchErr.message }, "expireAuctions: fetch failed");
    return;
  }

  if (!expired || expired.length === 0) return;

  logger.info({ count: expired.length }, "expireAuctions: processing expired auctions");

  const bCol = await getBidderCol();
  const wbidColExists = await hasWinnerBidIdCol();

  for (const { id, title, seller_id: sellerId } of expired as Array<{ id: string; title: string | null; seller_id: string | null }>) {
    // 2. Find the highest bid for this auction (winner determination).
    //    Ordering by amount desc, then by created_at desc as tiebreaker
    //    ensures we always pick a deterministic winner.
    const { data: topBid, error: bidErr } = await supabaseAdmin
      .from("bids")
      .select(`id, ${bCol}, amount, created_at`)
      .eq("auction_id", id)
      .order("amount", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (bidErr) {
      logger.warn({ err: bidErr.message, auctionId: id }, "expireAuctions: bid fetch failed — skipping");
      continue;
    }

    // 3. Build the update patch.
    const patch: Record<string, unknown> = { status: "ended" };
    let winnerId: string | null = null;
    let winnerBidAmount: number | null = null;

    if (topBid) {
      const resolvedWinnerId = getBidderUserId(topBid);
      if (resolvedWinnerId) {
        winnerId = resolvedWinnerId;
        winnerBidAmount = topBid.amount as number;
        patch["winner_id"] = winnerId;
        if (wbidColExists) patch["winner_bid_id"] = topBid.id;
      }
    }

    // 4. Atomic update — .eq("status", "active") makes this idempotent.
    //    count: "exact" lets us detect whether the row was actually updated
    //    (count === 1) or was already ended by a concurrent call (count === 0).
    //    The notification fires ONLY when count === 1, guaranteeing it triggers
    //    at most once per auction.
    const { error: updateErr, count: updatedCount } = await supabaseAdmin
      .from("auctions")
      .update(patch, { count: "exact" })
      .eq("id", id)
      .eq("status", "active");

    if (updateErr) {
      logger.warn(
        { err: updateErr.message, auctionId: id },
        "expireAuctions: update failed",
      );
      continue;
    }

    logger.info(
      {
        auctionId: id,
        winnerId,
        winnerBidId: patch["winner_bid_id"] ?? null,
        rowsUpdated: updatedCount,
      },
      "expireAuctions: auction ended",
    );

    // 5. Fire end-of-auction notifications — only when this call actually
    //    flipped the status (updatedCount === 1), guaranteeing once-per-auction
    //    delivery even with concurrent expiry calls.
    //
    //    Recipients:
    //      - winner       → auction_won           (if there was a winning bid)
    //      - seller       → auction_ended         (if there was a winning bid)
    //      - seller       → auction_unsold        (if no bids)
    //
    //    Fire-and-forget: never throws, never delays the loop.
    if (updatedCount === 1) {
      const auctionTitle = title ?? "Auction";

      if (winnerId !== null && winnerBidAmount !== null) {
        void (async () => {
          try {
            await notifyAuctionWon(winnerId!, id, auctionTitle, winnerBidAmount!, sellerId ?? "");
          } catch (err) {
            logger.warn({ err: String(err), auctionId: id }, "expireAuctions: notifyAuctionWon failed");
          }
        })();
        if (sellerId) {
          void (async () => {
            try {
              await notifyAuctionEnded(sellerId, id, auctionTitle, winnerBidAmount!);
            } catch (err) {
              logger.warn({ err: String(err), auctionId: id }, "expireAuctions: notifyAuctionEnded failed");
            }
          })();

          // WhatsApp side-channel — short "your auction ended" ping to the
          // seller. Best effort, gated on the seller having a phone, and
          // wrapped so any failure never disturbs the lifecycle loop.
          void (async () => {
            try {
              const sellerPhone = await lookupProfilePhone(sellerId);
              if (!sellerPhone) {
                logger.info(
                  { auctionId: id, sellerId },
                  "expireAuctions: seller has no phone — skipping ended-WA",
                );
                return;
              }
              await sendWhatsAppMessage({
                phone: sellerPhone,
                text: buildAuctionEndedSellerMessage(auctionTitle),
              });
            } catch (err) {
              logger.warn(
                { err: String(err), auctionId: id, sellerId },
                "expireAuctions: seller ended-WA dispatch failed — non-blocking",
              );
            }
          })();
        }
      } else if (sellerId) {
        void (async () => {
          try {
            await notifyAuctionUnsold(sellerId, id, auctionTitle);
          } catch (err) {
            logger.warn({ err: String(err), auctionId: id }, "expireAuctions: notifyAuctionUnsold failed");
          }
        })();

        // WhatsApp "action required" ping — auction ended without a winner,
        // so the deal cannot complete. The short message nudges the seller
        // to relist or follow up. Best effort, never blocks.
        void (async () => {
          try {
            const sellerPhone = await lookupProfilePhone(sellerId);
            if (!sellerPhone) {
              logger.info(
                { auctionId: id, sellerId },
                "expireAuctions: seller has no phone — skipping action-required-WA",
              );
              return;
            }
            await sendWhatsAppMessage({
              phone: sellerPhone,
              text: buildAuctionActionRequiredMessage(auctionTitle),
            });
          } catch (err) {
            logger.warn(
              { err: String(err), auctionId: id, sellerId },
              "expireAuctions: action-required-WA dispatch failed — non-blocking",
            );
          }
        })();
      }
    }
  }
}

/**
 * Archive ended auctions that have been in 'ended' state for more than 7 days.
 *
 * Uses ends_at as the reference timestamp — this is always in the past for ended
 * auctions and avoids adding an ended_at column.
 *
 * Idempotent: the UPDATE is guarded with .eq("status", "ended") so already-archived
 * auctions are never touched again. Concurrent calls are safe.
 *
 * Requires migration 022 (adds 'archived' to auction_status enum).
 * If the enum value does not exist yet, Supabase returns a type error; it is caught
 * and logged at warn level so the function never crashes the caller.
 */
export async function archiveAuctions(): Promise<void> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error, count } = await supabaseAdmin
    .from("auctions")
    .update({ status: "archived" }, { count: "exact" })
    .eq("status", "ended")
    .lt("ends_at", cutoff);

  if (error) {
    // 22P02 = invalid_text_representation (enum value not yet in DB → migration not applied)
    // Log at warn, never crash.
    logger.warn({ err: error.message, code: error.code }, "archiveAuctions: update failed");
    return;
  }

  if (count && count > 0) {
    logger.info({ count }, "archiveAuctions: archived ended auctions");
  }
}

/**
 * Run the full auction lifecycle in sequence:
 *   1. expireAuctions() — flip active → ended, assign winner, notify winner
 *   2. archiveAuctions() — flip ended → archived (7-day-old auctions)
 *
 * Use this wrapper at all call sites so both steps always run together.
 */
export async function runAuctionLifecycle(): Promise<void> {
  await expireAuctions();
  await archiveAuctions();
}
