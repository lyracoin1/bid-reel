/**
 * Async video processing pipeline — Cloudflare R2 backend.
 *
 * Triggered fire-and-forget after a video auction is created.
 * The original URL in the DB remains valid throughout — processing only updates
 * the DB on full success, so a partial failure leaves the auction playable.
 *
 * Pipeline:
 *   1. Download original from R2 (or legacy Supabase Storage if URL matches)
 *   2. Probe video height
 *   3. Re-encode to H.264 MP4 at min(720, srcHeight)p, CRF 28, veryfast preset
 *   4. Extract JPEG thumbnail at 1 s from the compressed version
 *   5. Upload both to processed/{userId}/{jobId}_*.* on R2
 *   6. Update auctions.video_url + .thumbnail_url
 *   7. Delete the original file from its source backend
 *   8. Clean up all /tmp files in finally block
 *
 * Requirements: ffmpeg and ffprobe must be on PATH (bundled in Replit & Linux VMs).
 * Most clients now run ffmpeg.wasm pre-upload, so this server pass is a defence-
 * in-depth normalisation step (re-encodes anything that slipped through).
 */

import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabase.js";
import { logger } from "./logger.js";
import { r2Upload, r2Download, r2Delete, parseMediaUrl } from "./r2.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Run a shell command; resolves with stdout, rejects with stderr on failure. */
function shell(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout);
    });
  });
}

/** Probe the height (in pixels) of the first video stream in a file. */
async function probeHeight(filePath: string): Promise<number> {
  try {
    const out = await shell(
      `ffprobe -v quiet -select_streams v:0 ` +
      `-show_entries stream=height ` +
      `-of default=noprint_wrappers=1:nokey=1 ` +
      `"${filePath}"`,
    );
    const h = parseInt(out.trim(), 10);
    return Number.isFinite(h) && h > 0 ? h : 1080;
  } catch {
    return 1080; // safe fallback — will cap at 720
  }
}

/**
 * Download a media URL into a Buffer, regardless of backend.
 * R2 → uses the SDK directly.  Supabase (legacy) → uses the supabase client.
 */
async function downloadMedia(url: string): Promise<Buffer> {
  const parsed = parseMediaUrl(url);
  if (!parsed) throw new Error(`Unrecognised media URL: "${url}"`);

  if (parsed.backend === "r2") {
    return r2Download(parsed.key);
  }

  // Legacy Supabase
  const { data: blob, error } = await supabaseAdmin.storage
    .from(parsed.bucket)
    .download(parsed.key);
  if (error || !blob) throw new Error(`Supabase download failed: ${error?.message ?? "no data"}`);
  return Buffer.from(await blob.arrayBuffer());
}

/** Delete a media URL from its source backend. */
async function deleteOriginal(url: string): Promise<void> {
  const parsed = parseMediaUrl(url);
  if (!parsed) return;

  if (parsed.backend === "r2") {
    await r2Delete(parsed.key);
    return;
  }
  await supabaseAdmin.storage.from(parsed.bucket).remove([parsed.key]);
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Call this after a video auction is written to the DB.
 * Safe to fire-and-forget — failures are logged, never thrown.
 */
export async function processVideoAsync(
  auctionId: string,
  videoUrl: string,
  userId: string,
): Promise<void> {
  const jobId = randomUUID().slice(0, 8);
  const tmpDir = path.join(tmpdir(), `bidreel-${jobId}`);

  logger.info({ auctionId, jobId }, "video-processing: job started");

  try {
    await fs.mkdir(tmpDir, { recursive: true });

    // Derive source extension from URL pathname (e.g. .mp4, .mov)
    let ext = "mp4";
    try {
      const urlPath = new URL(videoUrl).pathname;
      ext = urlPath.split(".").pop()?.toLowerCase() ?? "mp4";
    } catch { /* keep default */ }

    const origPath  = path.join(tmpDir, `original.${ext}`);
    const compPath  = path.join(tmpDir, "video_720.mp4");
    const thumbPath = path.join(tmpDir, "thumb.jpg");

    // ── 1. Download original from its backend ─────────────────────────────
    const origBytes = await downloadMedia(videoUrl);
    await fs.writeFile(origPath, origBytes);
    const origStat = await fs.stat(origPath);
    logger.info(
      { auctionId, jobId, origKb: Math.round(origStat.size / 1024) },
      "video-processing: original downloaded",
    );

    // ── 2. Determine target height (cap at 720, never upscale) ────────────
    const srcHeight = await probeHeight(origPath);
    const targetHeight = Math.min(srcHeight, 720);
    // Ensure height is divisible by 2 (libx264 requirement)
    const safeHeight = targetHeight % 2 === 0 ? targetHeight : targetHeight - 1;

    // ── 3. Compress video ─────────────────────────────────────────────────
    // -movflags +faststart: move MOOV atom to file start for progressive streaming
    await shell(
      `ffmpeg -y -i "${origPath}" ` +
      `-vf "scale=-2:${safeHeight}" ` +
      `-c:v libx264 -crf 28 -preset veryfast ` +
      `-c:a aac -b:a 96k ` +
      `-movflags +faststart ` +
      `"${compPath}"`,
    );

    const compStat = await fs.stat(compPath);
    const reductionPct = Math.round((1 - compStat.size / origStat.size) * 100);
    logger.info(
      { auctionId, jobId, compKb: Math.round(compStat.size / 1024), reductionPct },
      "video-processing: compressed",
    );

    // ── 4. Extract thumbnail (at 1 s; fall back to frame 0 for short clips) ─
    try {
      await shell(
        `ffmpeg -y -ss 00:00:01 -i "${compPath}" ` +
        `-vframes 1 -vf "scale=640:-2" ` +
        `"${thumbPath}"`,
      );
    } catch {
      // Clip shorter than 1 s — grab very first frame instead
      await shell(
        `ffmpeg -y -i "${compPath}" ` +
        `-vframes 1 -vf "scale=640:-2" ` +
        `"${thumbPath}"`,
      );
    }
    logger.info({ auctionId, jobId }, "video-processing: thumbnail extracted");

    // ── 5. Upload processed files to R2 ───────────────────────────────────
    const [compressedBytes, thumbBytes] = await Promise.all([
      fs.readFile(compPath),
      fs.readFile(thumbPath),
    ]);

    const compressedKey = `processed/${userId}/${jobId}_video_720.mp4`;
    const thumbKey      = `processed/${userId}/${jobId}_thumb.jpg`;

    const [vidUpload, thumbUpload] = await Promise.all([
      r2Upload(compressedKey, compressedBytes, "video/mp4"),
      r2Upload(thumbKey,      thumbBytes,      "image/jpeg"),
    ]);

    // ── 6. Update auction row with optimized URLs ─────────────────────────
    const { error: updateErr } = await supabaseAdmin
      .from("auctions")
      .update({ video_url: vidUpload.publicUrl, thumbnail_url: thumbUpload.publicUrl })
      .eq("id", auctionId);
    if (updateErr) throw new Error(`DB update: ${updateErr.message}`);

    logger.info(
      { auctionId, jobId, origKb: Math.round(origStat.size / 1024), compKb: Math.round(compStat.size / 1024), reductionPct },
      "video-processing: ✅ complete",
    );

    // ── 7. Delete original from its source backend (no longer needed) ─────
    try {
      await deleteOriginal(videoUrl);
    } catch (delErr) {
      logger.warn(
        { auctionId, jobId, err: String(delErr) },
        "video-processing: could not delete original (non-fatal)",
      );
    }
  } catch (err) {
    // Log only — original video_url is still valid and playable
    logger.error(
      { auctionId, jobId, err: String(err) },
      "video-processing: ❌ failed — original URL preserved in DB",
    );
  } finally {
    // Always clean up temp files regardless of success or failure
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
