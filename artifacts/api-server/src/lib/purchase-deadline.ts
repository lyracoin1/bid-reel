/**
 * purchase-deadline.ts — 24h reminder + 48h expiry pipeline for the
 * winner's purchase deadline.
 *
 * Lifecycle (per auction with a winner / Buy-Now buyer):
 *
 *   t=0        purchase_deadline stamped to t+48h
 *   t≈24h      runReminderPass() — if deal not completed AND
 *              reminder_24h_sent_at IS NULL, send "24h left" message
 *              and stamp reminder_24h_sent_at.
 *   t≥48h      runExpiredPass()  — if deal not completed AND
 *              expired_notified_at IS NULL, send "deadline expired"
 *              message and stamp expired_notified_at. The stamp doubles
 *              as the marker the future strike pipeline will read.
 *
 * Dedup: reminder_24h_sent_at and expired_notified_at are the ONLY
 * idempotency primitives. Concurrent runs are safe because the UPDATE
 * is gated with `.is(<col>, null)` — the second writer sees 0 rows.
 *
 * Completion check: an auction is "completed" when its corresponding
 * auction_deals row has status='completed' (both parties confirmed) OR
 * buyer_confirmation='completed' (buyer alone confirmed receipt). For
 * Buy Now listings the row is created by POST /:id/buy.
 */

import { supabaseAdmin } from "./supabase";
import { logger } from "./logger";
import { sendWhatsApp } from "./whatsapp";
import {
  buildPurchaseReminderMessage,
  buildPurchaseReminderTitle,
  buildPurchaseExpiredMessage,
  buildPurchaseExpiredTitle,
  normalizeWonLang,
} from "./auction-won-message";
import { createNotification } from "./notifications";

const REMINDER_AHEAD_HOURS = 24; // fire when deadline is ≤ 24h away
const RUN_INTERVAL_MS = 15 * 60 * 1000; // every 15 min
const INITIAL_DELAY_MS = 30_000;

// Defensive read of profile language+phone — `language` column may not exist.
async function readProfile(userId: string): Promise<{ phone: string; lang: string }> {
  let phone = "";
  let lang = "en";
  try {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("phone, language")
      .eq("id", userId)
      .maybeSingle();
    if (data) {
      const row = data as { phone?: unknown; language?: unknown };
      if (typeof row.phone === "string") phone = row.phone.trim();
      if (typeof row.language === "string") lang = row.language;
    }
  } catch {
    try {
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("phone")
        .eq("id", userId)
        .maybeSingle();
      const row = data as { phone?: unknown } | null;
      if (row && typeof row.phone === "string") phone = row.phone.trim();
    } catch {
      /* leave defaults */
    }
  }
  return { phone, lang };
}

// Is the deal for `auctionId` already completed?
async function isDealCompleted(auctionId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("auction_deals")
    .select("status, buyer_confirmation")
    .eq("auction_id", auctionId)
    .maybeSingle();
  if (!data) return false;
  const row = data as { status?: string | null; buyer_confirmation?: string | null };
  return row.status === "completed" || row.buyer_confirmation === "completed";
}

// ── Reminder pass ───────────────────────────────────────────────────────────
export async function runReminderPass(): Promise<void> {
  const now = new Date();
  const reminderHorizon = new Date(now.getTime() + REMINDER_AHEAD_HOURS * 60 * 60 * 1000).toISOString();

  // Auctions with a winner whose deadline is within 24h, never reminded yet,
  // and not yet past the deadline (the expired pass handles those).
  const { data: rows, error } = await supabaseAdmin
    .from("auctions")
    .select("id, winner_id, buyer_id, seller_id, purchase_deadline")
    .not("purchase_deadline", "is", null)
    .lte("purchase_deadline", reminderHorizon)
    .gte("purchase_deadline", now.toISOString())
    .is("reminder_24h_sent_at", null)
    .limit(200);

  if (error) {
    logger.warn({ err: error.message }, "purchase-deadline: reminder fetch failed");
    return;
  }
  if (!rows || rows.length === 0) return;

  for (const r of rows as Array<{
    id: string;
    winner_id: string | null;
    buyer_id: string | null;
    seller_id: string | null;
    purchase_deadline: string;
  }>) {
    const recipientId = r.buyer_id ?? r.winner_id;
    if (!recipientId || !r.seller_id) continue;

    if (await isDealCompleted(r.id)) {
      // Already completed — stamp the column to suppress future scans, then move on.
      await supabaseAdmin
        .from("auctions")
        .update({ reminder_24h_sent_at: new Date().toISOString() })
        .eq("id", r.id)
        .is("reminder_24h_sent_at", null);
      continue;
    }

    // ATOMIC claim — the .is("reminder_24h_sent_at", null) gate prevents two
    // concurrent runs from both sending the reminder.
    const stampedAt = new Date().toISOString();
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("auctions")
      .update({ reminder_24h_sent_at: stampedAt })
      .eq("id", r.id)
      .is("reminder_24h_sent_at", null)
      .select("id")
      .maybeSingle();
    if (claimErr || !claimed) continue;

    const seller = await readProfile(r.seller_id);
    const winner = await readProfile(recipientId);
    const lang = normalizeWonLang(winner.lang);
    const title = buildPurchaseReminderTitle(lang);
    const body = buildPurchaseReminderMessage(lang, seller.phone || "—");

    try {
      await createNotification({
        userId: recipientId,
        type: "auction_won",
        title,
        body,
        auctionId: r.id,
        metadata: { auctionId: r.id, kind: "purchase_reminder_24h", language: lang },
      });
    } catch (err) {
      logger.warn({ err: String(err), auctionId: r.id }, "purchase-deadline: reminder notif insert failed");
    }

    if (winner.phone && seller.phone) {
      void sendWhatsApp({
        phone: winner.phone,
        body,
        lang,
        kind: "purchase_reminder_24h",
        meta: { auctionId: r.id, recipientId },
      });
    } else {
      logger.info(
        { auctionId: r.id, hasWinnerPhone: !!winner.phone, hasSellerPhone: !!seller.phone },
        "purchase-deadline: reminder WA leg skipped (missing phone)",
      );
    }
  }

  logger.info({ scanned: rows.length }, "purchase-deadline: reminder pass done");
}

// ── Expired pass ────────────────────────────────────────────────────────────
export async function runExpiredPass(): Promise<void> {
  const nowIso = new Date().toISOString();

  const { data: rows, error } = await supabaseAdmin
    .from("auctions")
    .select("id, winner_id, buyer_id, seller_id, purchase_deadline")
    .not("purchase_deadline", "is", null)
    .lt("purchase_deadline", nowIso)
    .is("expired_notified_at", null)
    .limit(200);

  if (error) {
    logger.warn({ err: error.message }, "purchase-deadline: expired fetch failed");
    return;
  }
  if (!rows || rows.length === 0) return;

  for (const r of rows as Array<{
    id: string;
    winner_id: string | null;
    buyer_id: string | null;
    seller_id: string | null;
    purchase_deadline: string;
  }>) {
    const recipientId = r.buyer_id ?? r.winner_id;
    if (!recipientId) continue;

    if (await isDealCompleted(r.id)) {
      // Completed — stamp expired_notified_at as a tombstone so we never re-scan.
      await supabaseAdmin
        .from("auctions")
        .update({ expired_notified_at: new Date().toISOString() })
        .eq("id", r.id)
        .is("expired_notified_at", null);
      continue;
    }

    // ATOMIC claim.
    const stampedAt = new Date().toISOString();
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("auctions")
      .update({ expired_notified_at: stampedAt })
      .eq("id", r.id)
      .is("expired_notified_at", null)
      .select("id")
      .maybeSingle();
    if (claimErr || !claimed) continue;

    const recipient = await readProfile(recipientId);
    const lang = normalizeWonLang(recipient.lang);
    const title = buildPurchaseExpiredTitle(lang);
    const body = buildPurchaseExpiredMessage(lang);

    try {
      await createNotification({
        userId: recipientId,
        type: "auction_won",
        title,
        body,
        auctionId: r.id,
        metadata: { auctionId: r.id, kind: "purchase_expired", language: lang },
      });
    } catch (err) {
      logger.warn({ err: String(err), auctionId: r.id }, "purchase-deadline: expired notif insert failed");
    }

    if (recipient.phone) {
      void sendWhatsApp({
        phone: recipient.phone,
        body,
        lang,
        kind: "purchase_expired",
        meta: { auctionId: r.id, recipientId },
      });
    }

    // Optional symmetric notice to the seller (in-app only, no WA spam).
    if (r.seller_id) {
      try {
        await createNotification({
          userId: r.seller_id,
          type: "auction_won",
          title,
          body,
          auctionId: r.id,
          metadata: { auctionId: r.id, kind: "purchase_expired_seller_view", language: lang },
        });
      } catch {
        /* best-effort */
      }
    }
  }

  logger.info({ scanned: rows.length }, "purchase-deadline: expired pass done");
}

// ── Scheduler ───────────────────────────────────────────────────────────────
let timer: ReturnType<typeof setInterval> | null = null;

export function startPurchaseDeadlineScheduler(): void {
  if (timer !== null) return;
  logger.info({ intervalMinutes: RUN_INTERVAL_MS / 60_000 }, "purchase-deadline: scheduler started");

  setTimeout(() => {
    Promise.all([runReminderPass(), runExpiredPass()]).catch(err =>
      logger.warn({ err: String(err) }, "purchase-deadline: initial run failed"),
    );
  }, INITIAL_DELAY_MS);

  timer = setInterval(() => {
    Promise.all([runReminderPass(), runExpiredPass()]).catch(err =>
      logger.warn({ err: String(err) }, "purchase-deadline: scheduled run failed"),
    );
  }, RUN_INTERVAL_MS);
}
