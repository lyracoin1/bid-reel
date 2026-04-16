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
export { compressVideo, preloadFFmpeg, MAX_RAW_INPUT_BYTES } from "@/lib/video-compressor";

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
