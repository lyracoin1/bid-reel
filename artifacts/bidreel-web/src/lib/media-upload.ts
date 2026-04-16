/**
 * Unified media-upload pipeline.
 *
 * This module is the ONLY place in the app that uploads files to the backend.
 * Every caller (create-auction, profile/interests avatar, future features) must
 * go through `uploadMedia()`.
 *
 * ─── Transport strategy (hidden from callers) ────────────────────────────────
 * 1. The client first asks the API for a short-lived presigned PUT URL
 *    (`POST /api/media/presign-upload`) and PUTs the file body DIRECTLY to
 *    Cloudflare R2. This bypasses Vercel's ~4.5 MB serverless body cap.
 * 2. If the presigned step fails (network / CORS / signing) AND the file is
 *    small enough to fit through the proxy, we fall back to
 *    `POST /api/media/upload` which streams the body through our API.
 *    Larger files cannot use the proxy fallback — attempting to would trade
 *    a clear R2 error for an opaque Vercel 413 HTML response, so those just
 *    rethrow the original error for the UI to display.
 *
 * ─── Error shape ─────────────────────────────────────────────────────────────
 * Every failure throws either:
 *   • `PresignedUploadError`  — direct R2 path, carries { step, httpStatus,
 *                               url, responseBody } so the UI can pinpoint the
 *                               exact failing hop (presign_http, presign_parse,
 *                               put_network, put_http).
 *   • `Error`                 — proxy path, carries a descriptive message.
 *
 * ─── Compression ─────────────────────────────────────────────────────────────
 * Images and avatars are compressed to WebP in-browser via Canvas before
 * upload. Videos are transcoded with ffmpeg.wasm via `@/lib/video-compressor`
 * before being handed to `uploadMedia()`.
 */

import {
  uploadMediaApi,
  uploadMediaPresignedApi,
  PresignedUploadError,
} from "@/lib/api-client";

// Re-exports so callers only need to import from this module.
export { PresignedUploadError };
export {
  compressVideo,
  preloadFFmpeg,
  FFmpegLoadError,
  MAX_RAW_INPUT_BYTES,
  MAX_COMPRESSED_BYTES,
} from "@/lib/video-compressor";
import {
  compressVideo as _compressVideo,
  FFmpegLoadError as _FFmpegLoadError,
  MAX_COMPRESSED_BYTES as _MAX_COMPRESSED_BYTES,
  type CompressVideoOptions,
  type CompressVideoResult,
} from "@/lib/video-compressor";

/** Max file size that the proxy fallback path can handle (Vercel body cap). */
const PROXY_FALLBACK_CAP_BYTES = 4 * 1024 * 1024;

/** Post-compression size cap enforced by both backend routes. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// ─── Canvas-based image compression ─────────────────────────────────────────

export interface CompressImageOptions {
  /** Max pixels on the longest side. Image is NEVER upscaled. */
  maxPx: number;
  /** WebP quality 0.0–1.0. */
  quality: number;
}

/**
 * Resize + re-encode an image to WebP. Returns the original file unchanged if
 * the "compressed" version ends up bigger, or if the browser can't decode it.
 */
export async function compressImage(
  file: File,
  opts: CompressImageOptions,
): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;
      if (width > opts.maxPx || height > opts.maxPx) {
        const scale = opts.maxPx / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(file); return; }

      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          const baseName = file.name.replace(/\.[^.]+$/, "");
          const compressed = new File([blob], `${baseName}.webp`, { type: "image/webp" });
          resolve(compressed.size < file.size ? compressed : file);
        },
        "image/webp",
        opts.quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
}

/** Preset for profile avatars — 512 px square-ish, quality 0.85. */
export async function compressAvatar(file: File): Promise<File> {
  return compressImage(file, { maxPx: 512, quality: 0.85 });
}

/** Preset for listing display images — 1920 px long edge, quality 0.85. */
export async function compressListingImage(file: File): Promise<File> {
  return compressImage(file, { maxPx: 1920, quality: 0.85 });
}

/** Preset for auction cover thumbnails — 640 px long edge, quality 0.80. */
export async function compressListingThumbnail(file: File): Promise<File> {
  return compressImage(file, { maxPx: 640, quality: 0.80 });
}

// ─── Unified uploadMedia() ──────────────────────────────────────────────────

export type MediaKind = "video" | "image";

// ─── Video compression with graceful fallback ──────────────────────────────
//
// ffmpeg.wasm loads its ~25 MB core from a public CDN on first use. On
// restrictive mobile networks / Capacitor Android WebViews that fetch can
// fail, which historically meant the entire upload died with a cryptic
// "failed to import ffmpeg-core.js". This helper catches ffmpeg load failures
// and — if the raw file already fits the server cap (MAX_COMPRESSED_BYTES) —
// returns the original file so the upload can still proceed.
//
// Callers receive a result flagged with `compressed: boolean` so the UI can
// show an explicit "uploading original (compression unavailable)" message
// instead of silently skipping the optimization.

export interface MaybeCompressedVideo {
  /** The file to upload (compressed if compression succeeded, else the original). */
  file: File;
  /** True if ffmpeg successfully compressed the file; false if we fell back. */
  compressed: boolean;
  originalBytes: number;
  outputBytes: number;
  /** Wall-clock time spent attempting compression, in ms. */
  durationMs: number;
  /** When `compressed === false`, the reason ffmpeg was skipped. */
  fallbackReason?: "ffmpeg_load_failed" | "ffmpeg_exec_failed";
}

/**
 * Compress a video with ffmpeg.wasm. If ffmpeg cannot load OR the transcode
 * fails, fall back to returning the original file **only if** it already fits
 * under the server's 20 MB cap. If the raw file is over the cap and ffmpeg
 * is unavailable, throws the ffmpeg error to surface clearly in the UI.
 */
export async function compressVideoWithFallback(
  file: File,
  opts: CompressVideoOptions = {},
): Promise<MaybeCompressedVideo> {
  const startedAt = performance.now();
  try {
    const result: CompressVideoResult = await _compressVideo(file, opts);
    return {
      file: result.file,
      compressed: true,
      originalBytes: result.originalBytes,
      outputBytes: result.compressedBytes,
      durationMs: result.durationMs,
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - startedAt);
    const isLoadFailure = err instanceof _FFmpegLoadError;
    if (file.size <= _MAX_COMPRESSED_BYTES) {
      console.warn(
        `[media-upload] Video compression unavailable (${isLoadFailure ? "ffmpeg load failed" : "ffmpeg exec failed"}) ` +
        `— falling back to raw upload (${(file.size / 1024 / 1024).toFixed(1)} MB ≤ 20 MB cap):`,
        err,
      );
      return {
        file,
        compressed: false,
        originalBytes: file.size,
        outputBytes: file.size,
        durationMs,
        fallbackReason: isLoadFailure ? "ffmpeg_load_failed" : "ffmpeg_exec_failed",
      };
    }
    console.error(
      `[media-upload] Video compression failed AND raw file (${(file.size / 1024 / 1024).toFixed(1)} MB) ` +
      `exceeds 20 MB cap — cannot fall back:`, err,
    );
    throw err;
  }
}

/**
 * Upload a media file. Always attempts the presigned (direct-to-R2) path
 * first, and only falls back to the proxy when (a) the presigned step failed
 * AND (b) the file is small enough to fit through the proxy's body limit.
 *
 * Returns the public URL of the uploaded file.
 */
export async function uploadMedia(
  file: File,
  kind: MediaKind,
  onProgress?: (pct: number) => void,
): Promise<string> {
  try {
    return await uploadMediaPresignedApi(file, kind, onProgress);
  } catch (err) {
    if (file.size > PROXY_FALLBACK_CAP_BYTES) {
      // Too large for the proxy — rethrow the clear R2 error instead of
      // trading it for an opaque Vercel 413 HTML response.
      console.error(
        `[media-upload] Presigned ${kind} upload failed and file is too ` +
        `large (${file.size} bytes) for proxy fallback — rethrowing.`, err,
      );
      throw err;
    }
    console.warn(
      `[media-upload] Presigned ${kind} upload failed — falling back to ` +
      `proxy (${file.size} bytes ≤ ${PROXY_FALLBACK_CAP_BYTES} bytes cap):`, err,
    );
    return uploadMediaApi(file, kind, onProgress);
  }
}
