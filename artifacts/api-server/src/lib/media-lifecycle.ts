/**
 * Media Lifecycle — Cleanup Service
 *
 * Strategy:
 *   Phase 1 — Videos:     Delete 7 days after auction end  (media_purge_after <= now)
 *   Phase 2 — Thumbnails: Delete 14 days after auction end (media_purge_after + 7d <= now)
 *
 * The auction row carries two nullable timestamps tracking completion:
 *   video_deleted_at     — set when the video file is deleted from Storage
 *   thumbnail_deleted_at — set when the thumbnail is deleted from Storage
 *
 * Media URLs are stored in auctions.video_url and auctions.thumbnail_url.
 * The storage path is extracted from the URL so we know exactly which file to delete.
 *
 * All Storage operations use the service_role admin client (bypasses RLS).
 * Bucket: "auction-media"
 */

import { supabaseAdmin } from "./supabase";
import { logger } from "./logger";

const BUCKET = "auction-media";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CleanupResult {
  filesDeleted: number;
  auctionsVideosCleaned: string[];
  auctionsThumbnailsCleaned: string[];
  errors: Array<{ auctionId: string; error: string }>;
  ranAt: Date;
}

interface AuctionMediaRow {
  id: string;
  video_url: string | null;
  thumbnail_url: string | null;
  video_deleted_at: string | null;
  thumbnail_deleted_at: string | null;
  media_purge_after: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the storage object path from a Supabase Storage public URL.
 * URL format: {SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}
 *
 * Returns null if the URL doesn't match the expected format.
 */
function extractStoragePath(url: string, bucket: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

/**
 * Delete a single object from the auction-media bucket.
 * Returns true on success, false if the path was invalid or deletion failed.
 */
async function deleteMediaFile(url: string | null): Promise<boolean> {
  if (!url) return false;

  const path = extractStoragePath(url, BUCKET);
  if (!path) {
    logger.warn({ url }, "media-lifecycle: could not extract storage path from URL — skipping");
    return false;
  }

  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([path]);
  if (error) {
    throw new Error(`Storage remove failed for "${path}": ${error.message}`);
  }

  return true;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runMediaCleanup(): Promise<CleanupResult> {
  const result: CleanupResult = {
    filesDeleted: 0,
    auctionsVideosCleaned: [],
    auctionsThumbnailsCleaned: [],
    errors: [],
    ranAt: new Date(),
  };

  logger.info("media-lifecycle: starting cleanup run");

  const now = new Date();

  // ── Phase 1: Videos — purge after media_purge_after ──────────────────────
  // media_purge_after = ends_at + 7 days (set at auction creation time)
  const { data: videoRows, error: videoErr } = await supabaseAdmin
    .from("auctions")
    .select("id, video_url, thumbnail_url, video_deleted_at, thumbnail_deleted_at, media_purge_after")
    .lte("media_purge_after", now.toISOString())
    .is("video_deleted_at", null)
    .not("video_url", "is", null);

  if (videoErr) {
    logger.error({ err: videoErr }, "media-lifecycle: failed to query auctions for video cleanup");
  } else if (videoRows && videoRows.length > 0) {
    logger.info({ count: videoRows.length }, "media-lifecycle: auctions eligible for video cleanup");

    for (const row of videoRows as AuctionMediaRow[]) {
      try {
        const deleted = await deleteMediaFile(row.video_url);

        await supabaseAdmin
          .from("auctions")
          .update({ video_deleted_at: new Date().toISOString() })
          .eq("id", row.id);

        if (deleted) {
          result.filesDeleted += 1;
          result.auctionsVideosCleaned.push(row.id);
        }

        logger.info({ auctionId: row.id, deleted }, "media-lifecycle: video cleaned");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({ auctionId: row.id, error: msg });
        logger.error({ auctionId: row.id, err: msg }, "media-lifecycle: video cleanup failed");
      }
    }
  }

  // ── Phase 2: Thumbnails — purge 7 days after the video purge threshold ────
  // i.e. ends_at + 14 days total. We compute: media_purge_after + 7d <= now
  const thumbnailThreshold = new Date(now);
  thumbnailThreshold.setDate(thumbnailThreshold.getDate() - 7);

  const { data: thumbRows, error: thumbErr } = await supabaseAdmin
    .from("auctions")
    .select("id, video_url, thumbnail_url, video_deleted_at, thumbnail_deleted_at, media_purge_after")
    .lte("media_purge_after", thumbnailThreshold.toISOString())
    .is("thumbnail_deleted_at", null)
    .not("thumbnail_url", "is", null);

  if (thumbErr) {
    logger.error({ err: thumbErr }, "media-lifecycle: failed to query auctions for thumbnail cleanup");
  } else if (thumbRows && thumbRows.length > 0) {
    logger.info({ count: thumbRows.length }, "media-lifecycle: auctions eligible for thumbnail cleanup");

    for (const row of thumbRows as AuctionMediaRow[]) {
      try {
        const deleted = await deleteMediaFile(row.thumbnail_url);

        await supabaseAdmin
          .from("auctions")
          .update({ thumbnail_deleted_at: new Date().toISOString() })
          .eq("id", row.id);

        if (deleted) {
          result.filesDeleted += 1;
          result.auctionsThumbnailsCleaned.push(row.id);
        }

        logger.info({ auctionId: row.id, deleted }, "media-lifecycle: thumbnail cleaned");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({ auctionId: row.id, error: msg });
        logger.error({ auctionId: row.id, err: msg }, "media-lifecycle: thumbnail cleanup failed");
      }
    }
  }

  logger.info(
    {
      filesDeleted: result.filesDeleted,
      videosPhase: result.auctionsVideosCleaned.length,
      thumbnailsPhase: result.auctionsThumbnailsCleaned.length,
      errors: result.errors.length,
    },
    "media-lifecycle: cleanup run complete",
  );

  return result;
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the background cleanup scheduler.
 * Safe to call multiple times — only one interval will run.
 */
export function startMediaCleanupScheduler(): void {
  if (cleanupTimer !== null) return;

  logger.info(
    { intervalHours: CLEANUP_INTERVAL_MS / 1000 / 60 / 60 },
    "media-lifecycle: scheduler started",
  );

  // Run once shortly after startup
  setTimeout(() => {
    runMediaCleanup().catch((err) =>
      logger.error({ err }, "media-lifecycle: initial cleanup run failed"),
    );
  }, 30_000);

  cleanupTimer = setInterval(() => {
    runMediaCleanup().catch((err) =>
      logger.error({ err }, "media-lifecycle: scheduled cleanup run failed"),
    );
  }, CLEANUP_INTERVAL_MS);
}
