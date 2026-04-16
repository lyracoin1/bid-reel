/**
 * One-time migration: copy all existing auction videos + thumbnails from
 * Supabase Storage to Cloudflare R2, then update the DB rows to point at the
 * new R2 public URLs.
 *
 * Idempotent: skips auctions whose URLs already point at R2.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run migrate:r2
 *
 * Or, dry-run:
 *   pnpm --filter @workspace/api-server run migrate:r2 -- --dry-run
 *
 * Safety:
 *   • The original Supabase file is NOT deleted by this script.  Once you've
 *     verified all auctions play back from R2, run with `--delete-source` to
 *     reclaim Supabase storage.
 */

import { supabaseAdmin } from "../src/lib/supabase";
import { r2Upload, r2PublicUrl, parseMediaUrl, isR2Url } from "../src/lib/r2";
import { logger } from "../src/lib/logger";

const DRY_RUN       = process.argv.includes("--dry-run");
const DELETE_SOURCE = process.argv.includes("--delete-source");

interface AuctionRow {
  id: string;
  video_url: string | null;
  thumbnail_url: string | null;
}

interface MigrationStats {
  scanned: number;
  alreadyOnR2: number;
  videosMigrated: number;
  thumbnailsMigrated: number;
  rowsUpdated: number;
  sourcesDeleted: number;
  errors: number;
}

const MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  avi: "video/x-msvideo",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function guessMime(key: string, fallback: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? fallback;
}

async function migrateOne(
  url: string,
  fallbackMime: string,
): Promise<{ newUrl: string; sourceBucket: string; sourceKey: string } | null> {
  const parsed = parseMediaUrl(url);
  if (!parsed)               throw new Error(`Unrecognised URL: ${url}`);
  if (parsed.backend === "r2") return null; // already migrated
  // Supabase → R2
  const { data: blob, error: dlErr } = await supabaseAdmin.storage
    .from(parsed.bucket)
    .download(parsed.key);
  if (dlErr || !blob) throw new Error(`Supabase download failed: ${dlErr?.message ?? "no data"}`);

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mime = guessMime(parsed.key, fallbackMime);

  if (DRY_RUN) {
    return {
      newUrl: `(dry-run would upload to R2 key=${parsed.key} mime=${mime} bytes=${bytes.byteLength})`,
      sourceBucket: parsed.bucket,
      sourceKey: parsed.key,
    };
  }

  // Re-use the same key on R2 so URLs stay structurally similar.
  // r2Upload throws "object already exists" if a previous run uploaded the
  // file but failed before updating the DB.  Treat that as success and
  // fall through to the DB pointer update — that's the whole point of the
  // script being idempotent.
  let publicUrl: string;
  try {
    ({ publicUrl } = await r2Upload(parsed.key, bytes, mime));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already exists")) {
      publicUrl = r2PublicUrl(parsed.key);
      logger.info({ key: parsed.key }, "migration: object already on R2 — skipping upload, fixing DB pointer");
    } else {
      throw err;
    }
  }
  return { newUrl: publicUrl, sourceBucket: parsed.bucket, sourceKey: parsed.key };
}

async function main(): Promise<void> {
  const stats: MigrationStats = {
    scanned: 0,
    alreadyOnR2: 0,
    videosMigrated: 0,
    thumbnailsMigrated: 0,
    rowsUpdated: 0,
    sourcesDeleted: 0,
    errors: 0,
  };

  logger.info({ dryRun: DRY_RUN, deleteSource: DELETE_SOURCE }, "migration: starting");

  // Page through all auctions to keep memory bounded.
  const PAGE = 500;
  let from = 0;

  for (;;) {
    const { data: rows, error } = await supabaseAdmin
      .from("auctions")
      .select("id, video_url, thumbnail_url")
      .range(from, from + PAGE - 1);

    if (error) throw new Error(`Failed to list auctions: ${error.message}`);
    if (!rows || rows.length === 0) break;

    for (const row of rows as AuctionRow[]) {
      stats.scanned++;
      const updates: { video_url?: string; thumbnail_url?: string } = {};
      const sourcesToDelete: Array<{ bucket: string; key: string }> = [];

      try {
        if (row.video_url) {
          if (isR2Url(row.video_url)) {
            stats.alreadyOnR2++;
          } else {
            const r = await migrateOne(row.video_url, "video/mp4");
            if (r) {
              updates.video_url = r.newUrl;
              stats.videosMigrated++;
              sourcesToDelete.push({ bucket: r.sourceBucket, key: r.sourceKey });
            }
          }
        }

        if (row.thumbnail_url) {
          if (isR2Url(row.thumbnail_url)) {
            stats.alreadyOnR2++;
          } else {
            const r = await migrateOne(row.thumbnail_url, "image/jpeg");
            if (r) {
              updates.thumbnail_url = r.newUrl;
              stats.thumbnailsMigrated++;
              sourcesToDelete.push({ bucket: r.sourceBucket, key: r.sourceKey });
            }
          }
        }

        if (Object.keys(updates).length > 0 && !DRY_RUN) {
          const { error: updErr } = await supabaseAdmin
            .from("auctions")
            .update(updates)
            .eq("id", row.id);
          if (updErr) throw new Error(`DB update failed: ${updErr.message}`);
          stats.rowsUpdated++;
          logger.info({ auctionId: row.id, ...updates }, "migration: row updated");
        }

        if (DELETE_SOURCE && !DRY_RUN) {
          for (const src of sourcesToDelete) {
            const { error: delErr } = await supabaseAdmin.storage
              .from(src.bucket)
              .remove([src.key]);
            if (delErr) {
              logger.warn(
                { auctionId: row.id, key: src.key, err: delErr.message },
                "migration: source delete failed (non-fatal)",
              );
            } else {
              stats.sourcesDeleted++;
            }
          }
        }
      } catch (err) {
        stats.errors++;
        logger.error(
          { auctionId: row.id, err: String(err) },
          "migration: row failed — left untouched, original URL still valid",
        );
      }
    }

    if (rows.length < PAGE) break;
    from += PAGE;
  }

  logger.info({ ...stats }, "migration: ✅ complete");
  // Force exit because the supabase client keeps an HTTP keep-alive socket open
  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  logger.error({ err: String(err) }, "migration: ❌ fatal error");
  process.exit(1);
});
