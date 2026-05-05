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

// ─── Constants ────────────────────────────────────────────────────────────────

/** Absolute path to the BidReel logo used as a cover fallback for audio reels. */
const LOGO_FALLBACK_PATH = path.resolve(process.cwd(), "src/assets/logo-fallback.png");

/** Maximum audio duration allowed for audio-reel conversion (10 minutes). */
const MAX_AUDIO_DURATION_S = 600;

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
      .update({ video_url: vidUpload.publicUrl, thumbnail_url: thumbUpload.publicUrl, media_type: "video" })
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
    logger.error(
      { auctionId, jobId, err: String(err) },
      "video-processing: ❌ failed — original URL preserved in DB",
    );
    try {
      await supabaseAdmin.from("auctions").update({ media_type: "failed" }).eq("id", auctionId);
    } catch { /* non-fatal */ }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── Audio → MP4 reel ────────────────────────────────────────────────────────

/** Probe the duration (seconds) of a local media file via ffprobe. */
async function probeDuration(filePath: string): Promise<number> {
  try {
    const out = await shell(
      `ffprobe -v quiet -show_entries format=duration ` +
      `-of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
    );
    const d = parseFloat(out.trim());
    return Number.isFinite(d) && d > 0 ? d : 0;
  } catch {
    return 0;
  }
}

/** Max generated MP4 size — 30 MB. Checked after generation; job fails if exceeded. */
const MAX_OUTPUT_SIZE_BYTES = 30 * 1024 * 1024;

/**
 * Convert an uploaded audio file + cover image(s) into a mobile-optimised MP4 reel.
 *
 * coverImageUrls behaviour:
 *   • []  or null → use the BidReel logo as a static background frame
 *   • [url]       → static frame for the full audio duration
 *   • [u1, u2, …] → slideshow: each image shown for audioDuration/N seconds,
 *                   looping smoothly via the FFmpeg concat demuxer
 *
 * The generated MP4 replaces video_url / thumbnail_url in the auctions row so
 * the feed and detail player (type="video") render it without any schema changes.
 *
 * Storage path: audio-videos/{userId}/{jobId}.mp4
 *
 * Call fire-and-forget after inserting the auction row.
 */
export async function processAudioReelAsync(
  auctionId: string,
  audioUrl: string,
  coverImageUrls: string[],
  userId: string,
): Promise<void> {
  const jobId  = randomUUID().slice(0, 8);
  const tmpDir = path.join(tmpdir(), `bidreel-audio-${jobId}`);
  logger.info({ auctionId, jobId, imageCount: coverImageUrls.length }, "audio-reel: job started");

  try {
    await fs.mkdir(tmpDir, { recursive: true });

    const audioPath = path.join(tmpDir, "audio.tmp");
    const outPath   = path.join(tmpDir, "reel_720.mp4");
    const thumbPath = path.join(tmpDir, "thumb.jpg");

    // ── 1. Download audio ─────────────────────────────────────────────────
    const audioBytes = await downloadMedia(audioUrl);
    await fs.writeFile(audioPath, audioBytes);
    logger.info({ auctionId, jobId, kb: Math.round(audioBytes.length / 1024) }, "audio-reel: audio downloaded");

    // ── 2. Duration safety guard ──────────────────────────────────────────
    const dur = await probeDuration(audioPath);
    if (dur > MAX_AUDIO_DURATION_S) {
      throw new Error(`Audio too long: ${Math.round(dur)}s exceeds ${MAX_AUDIO_DURATION_S}s limit`);
    }

    // ── 3. Download / prepare cover image(s) ──────────────────────────────
    const coverPaths: string[] = [];

    if (coverImageUrls.length === 0) {
      // No cover — use BidReel logo as a static frame
      const logoPath = path.join(tmpDir, "cover_0.jpg");
      await fs.copyFile(LOGO_FALLBACK_PATH, logoPath);
      coverPaths.push(logoPath);
      logger.info({ auctionId, jobId }, "audio-reel: using BidReel logo fallback");
    } else {
      for (let i = 0; i < coverImageUrls.length; i++) {
        const imgPath = path.join(tmpDir, `cover_${i}.jpg`);
        const imgBytes = await downloadMedia(coverImageUrls[i]);
        await fs.writeFile(imgPath, imgBytes);
        coverPaths.push(imgPath);
      }
      logger.info({ auctionId, jobId, count: coverPaths.length }, "audio-reel: cover image(s) downloaded");
    }

    // ── 4. Generate MP4 ───────────────────────────────────────────────────
    // Common video filter: letterbox/pillarbox to 720×720, black bars, no stretch.
    // fps=5: enough for smooth still/slide transitions, keeps file size small.
    const scaleFilter =
      `scale=720:720:force_original_aspect_ratio=decrease,` +
      `pad=720:720:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=5`;

    if (coverPaths.length === 1) {
      // ── Single image: static frame over audio ─────────────────────────
      // -loop 1         : hold the image for the full audio duration
      // -tune stillimage: optimise libx264 for a static background
      // -shortest       : cut video stream when audio ends
      await shell(
        `ffmpeg -y -loop 1 -i "${coverPaths[0]}" -i "${audioPath}" ` +
        `-vf "${scaleFilter}" ` +
        `-c:v libx264 -tune stillimage -crf 28 -preset veryfast ` +
        `-c:a aac -b:a 128k ` +
        `-shortest -movflags +faststart ` +
        `"${outPath}"`,
      );
    } else {
      // ── Multiple images: slideshow ─────────────────────────────────────
      // Each image is shown for an equal slice of the audio duration
      // (minimum 2 s per slide so fast content isn't invisible).
      // The concat demuxer feeds images as a video stream; audio is mixed in.
      const safeDur  = dur > 0 ? dur : 30; // fallback 30 s if probe failed
      const slideDur = Math.max(2, safeDur / coverPaths.length);

      // Build the concat file list.  The last entry is duplicated with a tiny
      // duration to work around the concat demuxer's last-frame truncation bug.
      const listLines: string[] = [];
      for (const p of coverPaths) {
        listLines.push(`file '${p.replace(/'/g, "'\\''")}'`);
        listLines.push(`duration ${slideDur.toFixed(3)}`);
      }
      // Duplicate last frame to avoid black tail
      listLines.push(`file '${coverPaths[coverPaths.length - 1].replace(/'/g, "'\\''")}'`);
      listLines.push(`duration 0.1`);

      const listPath = path.join(tmpDir, "slide_list.txt");
      await fs.writeFile(listPath, listLines.join("\n"));

      await shell(
        `ffmpeg -y -f concat -safe 0 -i "${listPath}" -i "${audioPath}" ` +
        `-vf "${scaleFilter}" ` +
        `-c:v libx264 -crf 28 -preset veryfast ` +
        `-c:a aac -b:a 128k ` +
        `-shortest -movflags +faststart ` +
        `"${outPath}"`,
      );
    }

    const outStat = await fs.stat(outPath);
    logger.info(
      { auctionId, jobId, kb: Math.round(outStat.size / 1024), slides: coverPaths.length },
      "audio-reel: MP4 generated",
    );

    // ── 5. File-size guard (30 MB) ─────────────────────────────────────────
    if (outStat.size > MAX_OUTPUT_SIZE_BYTES) {
      throw new Error(
        `Generated video too large: ${Math.round(outStat.size / 1024 / 1024)}MB exceeds 30 MB limit`,
      );
    }

    // ── 6. Extract thumbnail (first frame of generated MP4) ───────────────
    await shell(
      `ffmpeg -y -i "${outPath}" -vframes 1 -vf "scale=640:-2" "${thumbPath}"`,
    );

    // ── 7. Upload MP4 + thumbnail to R2 ────────────────────────────────────
    const [outBytes, thumbBytes] = await Promise.all([
      fs.readFile(outPath),
      fs.readFile(thumbPath),
    ]);

    const videoKey = `audio-videos/${userId}/${jobId}.mp4`;
    const thumbKey = `audio-videos/${userId}/${jobId}_thumb.jpg`;

    const [vidUpload, thumbUpload] = await Promise.all([
      r2Upload(videoKey, outBytes, "video/mp4"),
      r2Upload(thumbKey, thumbBytes, "image/jpeg"),
    ]);

    // ── 8. Update auction row with generated MP4 URLs ─────────────────────
    // Clear image_urls: the original cover images are deleted from R2 below,
    // so keeping stale URLs in the DB would cause 404s on any cache miss.
    const { error: updateErr } = await supabaseAdmin
      .from("auctions")
      .update({
        video_url: vidUpload.publicUrl,
        thumbnail_url: thumbUpload.publicUrl,
        media_type: "video",
        image_urls: null,
      })
      .eq("id", auctionId);
    if (updateErr) throw new Error(`DB update: ${updateErr.message}`);

    logger.info({ auctionId, jobId }, "audio-reel: ✅ complete");

    // ── 9. Remove originals from R2 (non-fatal) ───────────────────────────
    try {
      await deleteOriginal(audioUrl);
      for (const imgUrl of coverImageUrls) {
        await deleteOriginal(imgUrl);
      }
    } catch (delErr) {
      logger.warn({ auctionId, jobId, err: String(delErr) }, "audio-reel: cleanup failed (non-fatal)");
    }
  } catch (err) {
    logger.error({ auctionId, jobId, err: String(err) }, "audio-reel: ❌ failed — original URL preserved");
    try {
      await supabaseAdmin.from("auctions").update({ media_type: "failed" }).eq("id", auctionId);
    } catch { /* non-fatal */ }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
