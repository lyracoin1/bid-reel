/**
 * Profile Cleanup — Incomplete Account Expiry
 *
 * Strategy:
 *   An account is considered "incomplete" if the user never finished onboarding
 *   (i.e. username IS NULL). Incomplete accounts older than 24 hours are deleted.
 *
 * Why 24 hours:
 *   Users may start the sign-up flow and abandon it mid-way (network drop, tab
 *   closed, etc.). Keeping orphaned auth accounts indefinitely wastes storage
 *   and inflates user counts. 24 h gives enough time to resume, even across
 *   time zones and sleep cycles.
 *
 * Safety contract:
 *   1. NEVER deletes a user whose username IS NOT NULL.
 *   2. NEVER deletes a user younger than 24 hours.
 *   3. Skips any user who has existing auctions or bids (ON DELETE RESTRICT FKs
 *      would block the delete anyway — we fail fast and log instead of crashing).
 *   4. Deletion goes through supabaseAdmin.auth.admin.deleteUser() which:
 *        - Removes the row from auth.users
 *        - Cascades to public.profiles (ON DELETE CASCADE FK)
 *        - Cascades further to device_tokens, user_follows, saved_auctions
 *
 * Scheduling:
 *   Runs every CLEANUP_INTERVAL_MS milliseconds.
 *   First run is INITIAL_DELAY_MS after server start (avoids startup noise).
 */

import { supabaseAdmin } from "./supabase";
import { logger } from "./logger";

// ─── Config ──────────────────────────────────────────────────────────────────

const EXPIRY_HOURS        = 24;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;   // 1 hour
const INITIAL_DELAY_MS    = 60 * 1_000;          // 1 minute after startup

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProfileCleanupResult {
  checkedCount:  number;
  deletedCount:  number;
  skippedCount:  number;
  errors:        Array<{ userId: string; error: string }>;
  ranAt:         Date;
}

// ─── Core cleanup ────────────────────────────────────────────────────────────

/**
 * Find and delete incomplete profiles older than EXPIRY_HOURS.
 *
 * "Incomplete" = username IS NULL (user never finished onboarding).
 * The function is intentionally conservative: it fetches a small batch
 * per run (max 200) so a backlog of orphaned accounts doesn't cause a
 * spike that times out the Supabase client.
 */
export async function runProfileCleanup(): Promise<ProfileCleanupResult> {
  const ranAt     = new Date();
  const expiryTs  = new Date(Date.now() - EXPIRY_HOURS * 60 * 60 * 1_000).toISOString();

  logger.info(
    { expiryHours: EXPIRY_HOURS, expiryTs },
    "profile-cleanup: starting run",
  );

  // ── Fetch expired incomplete profiles ────────────────────────────────────
  const { data: rows, error: fetchErr } = await supabaseAdmin
    .from("profiles")
    .select("id, created_at")
    .is("username", null)           // username never set → onboarding incomplete
    .lt("created_at", expiryTs)     // older than 24 hours
    .order("created_at", { ascending: true })
    .limit(200);                    // batch cap — avoids thundering herd

  if (fetchErr) {
    logger.error({ err: fetchErr.message }, "profile-cleanup: failed to fetch expired profiles");
    return { checkedCount: 0, deletedCount: 0, skippedCount: 0, errors: [{ userId: "query", error: fetchErr.message }], ranAt };
  }

  if (!rows || rows.length === 0) {
    logger.info("profile-cleanup: no expired incomplete profiles found");
    return { checkedCount: 0, deletedCount: 0, skippedCount: 0, errors: [], ranAt };
  }

  logger.info({ count: rows.length }, "profile-cleanup: expired incomplete profiles found");

  let deletedCount  = 0;
  let skippedCount  = 0;
  const errors: ProfileCleanupResult["errors"] = [];

  // ── Delete each expired account ──────────────────────────────────────────
  for (const row of rows) {
    const userId = row.id as string;

    try {
      // Guard: re-check that username is still null right before deletion.
      // Protects against a race where the user completed onboarding between
      // the batch fetch and this delete.
      const { data: fresh, error: guardErr } = await supabaseAdmin
        .from("profiles")
        .select("username")
        .eq("id", userId)
        .maybeSingle();

      if (guardErr) {
        logger.warn({ userId, err: guardErr.message }, "profile-cleanup: guard check failed — skipping");
        skippedCount++;
        continue;
      }

      if (!fresh) {
        // Profile was already deleted (by user, by another cleanup run, etc.)
        skippedCount++;
        continue;
      }

      if (fresh.username !== null) {
        // User completed onboarding between the batch query and now — SAFE, skip.
        logger.info({ userId }, "profile-cleanup: user completed onboarding between fetch and delete — skipping");
        skippedCount++;
        continue;
      }

      // Delete the auth user — cascades to profiles, device_tokens, follows, saves.
      const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(userId);

      if (deleteErr) {
        // ON DELETE RESTRICT (auctions.seller_id, bids.bidder_id) will surface here.
        // This is safe — the user has real data; don't delete them.
        const msg = deleteErr.message ?? "unknown error";
        logger.warn({ userId, err: msg }, "profile-cleanup: could not delete user — skipping (likely has FK-protected rows)");
        skippedCount++;
        errors.push({ userId, error: msg });
        continue;
      }

      deletedCount++;
      logger.info({ userId }, "profile-cleanup: deleted expired incomplete account");

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ userId, err: msg }, "profile-cleanup: unexpected error — skipping user");
      skippedCount++;
      errors.push({ userId, error: msg });
    }
  }

  logger.info(
    { checkedCount: rows.length, deletedCount, skippedCount, errorCount: errors.length },
    "profile-cleanup: run complete",
  );

  return {
    checkedCount: rows.length,
    deletedCount,
    skippedCount,
    errors,
    ranAt,
  };
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the background profile cleanup scheduler.
 * Safe to call multiple times — only one interval will ever run.
 */
export function startProfileCleanupScheduler(): void {
  if (cleanupTimer !== null) return;

  logger.info(
    { intervalHours: CLEANUP_INTERVAL_MS / 1_000 / 60 / 60, expiryHours: EXPIRY_HOURS },
    "profile-cleanup: scheduler started",
  );

  // First run: wait for server to fully initialise before touching the DB.
  setTimeout(() => {
    runProfileCleanup().catch((err) =>
      logger.error({ err }, "profile-cleanup: initial run failed"),
    );
  }, INITIAL_DELAY_MS);

  // Recurring runs every hour.
  cleanupTimer = setInterval(() => {
    runProfileCleanup().catch((err) =>
      logger.error({ err }, "profile-cleanup: scheduled run failed"),
    );
  }, CLEANUP_INTERVAL_MS);
}
