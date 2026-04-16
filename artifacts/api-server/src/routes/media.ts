/**
 * Media upload routes — Cloudflare R2 backend.
 *
 * POST /api/media/upload          — server-side proxy upload (raw binary body).
 *                                    Used as a fallback for small files when
 *                                    the presigned direct-to-R2 path fails.
 * POST /api/media/presign-upload  — issue a short-lived presigned PUT URL so
 *                                    the client can bypass Vercel's ~4.5 MB
 *                                    serverless body cap.
 *
 * Files land in R2 under:
 *   pending/{userId}/{uuid}.{ext}
 *
 * The video-processing worker re-encodes them to:
 *   processed/{userId}/{jobId}_video_720.mp4
 *   processed/{userId}/{jobId}_thumb.jpg
 *
 * Lifecycle: media-lifecycle scheduler deletes pending+processed media
 * 7–14 days after the auction ends.
 */

import express, { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { r2Upload, r2PresignUpload } from "../lib/r2";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

// ─── Allowed types and size limits ───────────────────────────────────────────

const ALLOWED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",   // .mov
  "video/webm",
  "video/x-msvideo",  // .avi
]);

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

// Post-compression upload caps. Clients run ffmpeg.wasm on videos before upload
// and Canvas-WebP on images, so we expect compressed payloads here.
const MAX_VIDEO_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB

const MIME_TO_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-msvideo": "avi",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Sanitize a generated filename — only alphanumerics, dash, dot. */
function safeFilename(uuid: string, ext: string): string {
  const cleanUuid = uuid.replace(/[^a-zA-Z0-9-]/g, "");
  const cleanExt = ext.replace(/[^a-zA-Z0-9]/g, "").slice(0, 5).toLowerCase();
  return `${cleanUuid}.${cleanExt}`;
}

// ─── POST /api/media/upload ───────────────────────────────────────────────────
// Server-side upload proxy.  The client POSTs the raw file binary directly to
// this endpoint and the server uploads to R2 using the service-role
// credentials — no cross-origin PUT to R2 ever leaves the client.  Eliminates
// the CORS preflight that fails on Capacitor Android WebViews.
//
// Query params (required): fileType=video|image  mimeType=<mime>
// Body: raw binary file bytes
// Returns: { publicUrl, path }

router.post(
  "/media/upload",
  requireAuth,
  // express.raw() parses the raw binary body into req.body: Buffer
  express.raw({ limit: "25mb", type: "*/*" }),
  async (req, res) => {
    const fileType = req.query["fileType"] as string | undefined;
    const rawMime  = req.query["mimeType"] as string | undefined;
    // Strip charset suffix (e.g. "video/mp4; codecs=…" → "video/mp4")
    const mimeType = rawMime?.split(";")[0]?.trim() ?? "";

    if (!fileType || !["video", "image"].includes(fileType)) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "fileType must be 'video' or 'image'" });
      return;
    }

    if (fileType === "video" && !ALLOWED_VIDEO_TYPES.has(mimeType)) {
      res.status(400).json({
        error: "INVALID_MIME_TYPE",
        message: `Unsupported video type "${mimeType}". Allowed: mp4, mov, webm.`,
        allowed: [...ALLOWED_VIDEO_TYPES],
      });
      return;
    }

    if (fileType === "image" && !ALLOWED_IMAGE_TYPES.has(mimeType)) {
      res.status(400).json({
        error: "INVALID_MIME_TYPE",
        message: `Unsupported image type "${mimeType}". Allowed: jpeg, png, webp.`,
        allowed: [...ALLOWED_IMAGE_TYPES],
      });
      return;
    }

    const body = req.body as Buffer;

    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "EMPTY_BODY", message: "Request body is empty" });
      return;
    }

    const maxBytes = fileType === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (body.length > maxBytes) {
      const maxMb = maxBytes / (1024 * 1024);
      res.status(400).json({
        error: "FILE_TOO_LARGE",
        message: `${fileType === "video" ? "Video" : "Image"} must be smaller than ${maxMb} MB.`,
        maxBytes,
      });
      return;
    }

    const userId = req.user!.id;
    const ext = MIME_TO_EXT[mimeType] ?? (fileType === "video" ? "mp4" : "jpg");
    const filename = safeFilename(randomUUID(), ext);
    const key = `pending/${userId}/${filename}`;

    try {
      const { publicUrl } = await r2Upload(key, body, mimeType);
      req.log.info({ userId, key, fileType, sizeBytes: body.length }, "POST /media/upload → file stored on R2");
      res.status(201).json({ publicUrl, path: key });
    } catch (err) {
      // Surface the REAL underlying failure instead of a generic message so the
      // client can show (and the operator can log) why R2 rejected the upload.
      // Common causes: missing R2_* env vars on Vercel, bucket CORS, wrong key.
      const detail = err instanceof Error ? err.message : String(err);
      req.log.error({ err: detail, key }, "Server-side upload to R2 failed");
      res.status(500).json({
        error: "UPLOAD_FAILED",
        message: `Upload failed: ${detail}`,
        detail,
      });
    }
  },
);

// ─── POST /api/media/presign-upload ───────────────────────────────────────────
// Generates a short-lived presigned PUT URL so the client can upload the file
// body DIRECTLY to R2. This bypasses Vercel's serverless request body limit
// (~4.5 MB) which otherwise kills all non-trivial video uploads in production.
//
// Body: { fileType: "video"|"image", mimeType: string, sizeBytes: number }
// Returns: { uploadUrl, publicUrl, path }
//
// We require the client to declare sizeBytes up front and refuse to sign if
// it exceeds the per-type cap. The presigned URL itself cannot enforce a size
// limit, so this client-declared check is best-effort — but combined with the
// short 15 min TTL and per-user key scoping it keeps R2 usage bounded.
//
// The client must PUT the raw file body to `uploadUrl` with the same
// Content-Type string that was sent here — R2 validates the signature against
// the Content-Type header. On success the file is live at `publicUrl`.

router.post("/media/presign-upload", requireAuth, express.json(), async (req, res) => {
  const fileType = (req.body?.fileType ?? "") as string;
  const rawMime  = (req.body?.mimeType ?? "") as string;
  const mimeType = rawMime.split(";")[0]?.trim() ?? "";
  const sizeBytes = Number(req.body?.sizeBytes);

  if (!["video", "image"].includes(fileType)) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "fileType must be 'video' or 'image'" });
    return;
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "sizeBytes must be a positive number",
    });
    return;
  }

  const maxBytes = fileType === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (sizeBytes > maxBytes) {
    const maxMb = maxBytes / (1024 * 1024);
    res.status(400).json({
      error: "FILE_TOO_LARGE",
      message: `${fileType === "video" ? "Video" : "Image"} must be smaller than ${maxMb} MB.`,
      maxBytes,
    });
    return;
  }

  if (fileType === "video" && !ALLOWED_VIDEO_TYPES.has(mimeType)) {
    res.status(400).json({
      error: "INVALID_MIME_TYPE",
      message: `Unsupported video type "${mimeType}". Allowed: mp4, mov, webm.`,
      allowed: [...ALLOWED_VIDEO_TYPES],
    });
    return;
  }

  if (fileType === "image" && !ALLOWED_IMAGE_TYPES.has(mimeType)) {
    res.status(400).json({
      error: "INVALID_MIME_TYPE",
      message: `Unsupported image type "${mimeType}". Allowed: jpeg, png, webp.`,
      allowed: [...ALLOWED_IMAGE_TYPES],
    });
    return;
  }

  const userId = req.user!.id;
  const ext = MIME_TO_EXT[mimeType] ?? (fileType === "video" ? "mp4" : "jpg");
  const filename = safeFilename(randomUUID(), ext);
  const key = `pending/${userId}/${filename}`;

  try {
    const signed = await r2PresignUpload(key, mimeType);
    req.log.info({ userId, key, fileType }, "POST /media/presign-upload → signed URL issued");
    res.status(200).json(signed);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    req.log.error({ err: detail, key }, "Presign for R2 upload failed");
    res.status(500).json({
      error: "PRESIGN_FAILED",
      message: `Could not prepare upload: ${detail}`,
      detail,
    });
  }
});

export default router;
