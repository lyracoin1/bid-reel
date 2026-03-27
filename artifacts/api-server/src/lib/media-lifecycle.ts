/**
 * Media Lifecycle — Cleanup Service
 *
 * Strategy (MVP):
 *   Phase 1 — Videos:  Delete video files 7 days after auction end.
 *                       Videos are large (tens of MB) so they're targeted first.
 *   Phase 2 — Images:  Delete image files 14 days after auction end.
 *                       Images are smaller; keeping them longer preserves
 *                       winner/history context cheaply.
 *
 * The auction row carries three nullable timestamps that track progress:
 *   videos_deleted_at — set when Phase 1 completes
 *   images_deleted_at — set when Phase 2 completes
 *   media_deleted_at  — set when BOTH phases are done (convenience flag)
 *
 * All Supabase Storage operations use the service_role admin client so they
 * bypass RLS.  The bucket name is "auction-media".
 *
 * Invocation:
 *   • Automatic: setInterval every 6 hours, started in index.ts
 *   • Manual:    POST /api/admin/cleanup-media  (secured with ADMIN_SECRET)
 */

import { supabaseAdmin } from "./supabase";
import { logger } from "./logger";

// ─── Config ──────────────────────────────────────────────────────────────────

const BUCKET = "auction-media";

/** Days after auction end before videos are deleted */
const VIDEO_RETENTION_DAYS = 7;

/** Days after auction end before images are deleted (longer grace period) */
const IMAGE_RETENTION_DAYS = 14;

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"]);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CleanupResult {
  /** Total files removed across all phases */
  filesDeleted: number;
  /** Approximate bytes freed (sum of file sizes from storage metadata) */
  bytesFreed: number;
  /** Auctions whose videos were cleaned in this run */
  auctionsVideosCleaned: string[];
  /** Auctions whose images were cleaned in this run */
  auctionsImagesCleaned: string[];
  /** Any per-auction errors (non-fatal — cleanup continues) */
  errors: Array<{ auctionId: string; error: string }>;
  ranAt: Date;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns true when the file path looks like a video */
function isVideo(path: string): boolean {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

/**
 * Lists ALL objects under a prefix in the bucket.
 * Supabase Storage paginates at 100 items; this fetches all pages.
 */
async function listAllObjects(prefix: string): Promise<Array<{ name: string; metadata?: { size?: number } }>> {
  const all: Array<{ name: string; metadata?: { size?: number } }> = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .list(prefix, { limit, offset });

    if (error) throw new Error(`Storage list error at "${prefix}": ${error.message}`);
    if (!data || data.length === 0) break;

    all.push(...data);
    if (data.length < limit) break;
    offset += limit;
  }

  return all;
}

/**
 * Deletes a batch of full storage paths (relative to bucket root).
 * Returns the number of bytes freed (best-effort from metadata).
 */
async function deletePaths(paths: string[]): Promise<{ count: number; bytes: number }> {
  if (paths.length === 0) return { count: 0, bytes: 0 };

  const { error } = await supabaseAdmin.storage.from(BUCKET).remove(paths);
  if (error) throw new Error(`Storage remove error: ${error.message}`);

  return { count: paths.length, bytes: 0 };
}

// ─── Per-auction cleanup ─────────────────────────────────────────────────────

interface AuctionMediaRow {
  id: string;
  ends_at: string;
  storage_path: string | null;
  image_paths: string[] | null;
  videos_deleted_at: string | null;
  images_deleted_at: string | null;
}

async function cleanAuctionVideos(
  row: AuctionMediaRow,
): Promise<{ filesDeleted: number; bytesFreed: number }> {
  const prefix = `auctions/${row.id}/`;
  const objects = await listAllObjects(prefix);

  // Gather video paths only
  const videoPaths = objects
    .filter(o => isVideo(`${prefix}${o.name}`))
    .map(o => `${prefix}${o.name}`);

  // Also delete any explicit storage_path if it is a video (covers edge cases)
  if (row.storage_path && isVideo(row.storage_path) && !videoPaths.includes(row.storage_path)) {
    videoPaths.push(row.storage_path);
  }

  if (videoPaths.length === 0) return { filesDeleted: 0, bytesFreed: 0 };

  const result = await deletePaths(videoPaths);

  // Mark video phase complete
  await supabaseAdmin
    .from("auctions")
    .update({ videos_deleted_at: new Date().toISOString() })
    .eq("id", row.id);

  return result;
}

async function cleanAuctionImages(
  row: AuctionMediaRow,
): Promise<{ filesDeleted: number; bytesFreed: number }> {
  const prefix = `auctions/${row.id}/`;
  const objects = await listAllObjects(prefix);

  // All remaining objects after videos were already cleaned
  const imagePaths = objects
    .filter(o => !isVideo(`${prefix}${o.name}`))
    .map(o => `${prefix}${o.name}`);

  // Also cover any explicit imagePaths entries
  if (row.image_paths) {
    for (const p of row.image_paths) {
      if (!imagePaths.includes(p)) imagePaths.push(p);
    }
  }

  if (imagePaths.length === 0) return { filesDeleted: 0, bytesFreed: 0 };

  const result = await deletePaths(imagePaths);

  // Mark image phase complete + set the convenience full-cleanup flag
  await supabaseAdmin
    .from("auctions")
    .update({
      images_deleted_at: new Date().toISOString(),
      media_deleted_at:  new Date().toISOString(),
    })
    .eq("id", row.id);

  return result;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runMediaCleanup(): Promise<CleanupResult> {
  const result: CleanupResult = {
    filesDeleted: 0,
    bytesFreed: 0,
    auctionsVideosCleaned: [],
    auctionsImagesCleaned: [],
    errors: [],
    ranAt: new Date(),
  };

  logger.info("media-lifecycle: starting cleanup run");

  const now = new Date();

  // ── Phase 1: Videos (expired > VIDEO_RETENTION_DAYS ago) ─────────────────
  const videoThreshold = new Date(now);
  videoThreshold.setDate(videoThreshold.getDate() - VIDEO_RETENTION_DAYS);

  const { data: videoRows, error: videoErr } = await supabaseAdmin
    .from("auctions")
    .select("id, ends_at, storage_path, image_paths, videos_deleted_at, images_deleted_at")
    .lte("ends_at", videoThreshold.toISOString())
    .is("videos_deleted_at", null)
    .is("deleted_at", null);

  if (videoErr) {
    logger.error({ err: videoErr }, "media-lifecycle: failed to query auctions for video cleanup");
  } else if (videoRows && videoRows.length > 0) {
    logger.info({ count: videoRows.length }, "media-lifecycle: auctions eligible for video cleanup");

    for (const row of videoRows as AuctionMediaRow[]) {
      try {
        const { filesDeleted, bytesFreed } = await cleanAuctionVideos(row);
        result.filesDeleted += filesDeleted;
        result.bytesFreed += bytesFreed;
        if (filesDeleted > 0) result.auctionsVideosCleaned.push(row.id);
        logger.info({ auctionId: row.id, filesDeleted }, "media-lifecycle: videos cleaned");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({ auctionId: row.id, error: msg });
        logger.error({ auctionId: row.id, err }, "media-lifecycle: video cleanup failed");
      }
    }
  }

  // ── Phase 2: Images (expired > IMAGE_RETENTION_DAYS ago) ─────────────────
  const imageThreshold = new Date(now);
  imageThreshold.setDate(imageThreshold.getDate() - IMAGE_RETENTION_DAYS);

  const { data: imageRows, error: imageErr } = await supabaseAdmin
    .from("auctions")
    .select("id, ends_at, storage_path, image_paths, videos_deleted_at, images_deleted_at")
    .lte("ends_at", imageThreshold.toISOString())
    .is("images_deleted_at", null)
    .is("deleted_at", null);

  if (imageErr) {
    logger.error({ err: imageErr }, "media-lifecycle: failed to query auctions for image cleanup");
  } else if (imageRows && imageRows.length > 0) {
    logger.info({ count: imageRows.length }, "media-lifecycle: auctions eligible for image cleanup");

    for (const row of imageRows as AuctionMediaRow[]) {
      try {
        const { filesDeleted, bytesFreed } = await cleanAuctionImages(row);
        result.filesDeleted += filesDeleted;
        result.bytesFreed += bytesFreed;
        if (filesDeleted > 0) result.auctionsImagesCleaned.push(row.id);
        logger.info({ auctionId: row.id, filesDeleted }, "media-lifecycle: images cleaned");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({ auctionId: row.id, error: msg });
        logger.error({ auctionId: row.id, err }, "media-lifecycle: image cleanup failed");
      }
    }
  }

  logger.info(
    {
      filesDeleted: result.filesDeleted,
      videosPhase: result.auctionsVideosCleaned.length,
      imagesPhase: result.auctionsImagesCleaned.length,
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

  // Run once shortly after startup (30-second delay to let the server warm up)
  setTimeout(() => {
    runMediaCleanup().catch(err =>
      logger.error({ err }, "media-lifecycle: initial cleanup run failed"),
    );
  }, 30_000);

  cleanupTimer = setInterval(() => {
    runMediaCleanup().catch(err =>
      logger.error({ err }, "media-lifecycle: scheduled cleanup run failed"),
    );
  }, CLEANUP_INTERVAL_MS);
}
