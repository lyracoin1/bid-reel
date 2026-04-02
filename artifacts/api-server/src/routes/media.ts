/**
 * Media upload routes
 *
 * POST /api/media/upload-url  — generate a presigned URL for direct-to-Supabase upload
 *
 * Upload flow:
 *   1. Client calls POST /api/media/upload-url with file metadata
 *   2. Server validates type/size and returns a short-lived presigned PUT URL
 *   3. Client uploads the file directly to Supabase Storage (no server proxying)
 *   4. Client gets back the public URL from the response and passes it to POST /api/auctions
 *
 * Files land in the "auction-media" bucket under:
 *   pending/{userId}/{uuid}.{ext}
 *
 * They stay at that path for the lifetime of the auction.
 * The media-lifecycle scheduler deletes them 7–14 days after the auction ends.
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "../lib/supabase";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

const BUCKET = "auction-media";

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

const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;  // 20 MB

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

// ─── Schema ──────────────────────────────────────────────────────────────────

const uploadUrlSchema = z.object({
  fileType: z.enum(["video", "image"], {
    errorMap: () => ({ message: 'fileType must be "video" or "image"' }),
  }),
  mimeType: z.string().min(1, "mimeType is required"),
  sizeBytes: z
    .number()
    .int("sizeBytes must be an integer")
    .positive("sizeBytes must be positive"),
});

// ─── POST /api/media/upload-url ───────────────────────────────────────────────

router.post("/media/upload-url", requireAuth, async (req, res) => {
  const parsed = uploadUrlSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "Invalid request body",
    });
    return;
  }

  const { fileType, mimeType, sizeBytes } = parsed.data;
  const userId = req.user!.id;

  // ── Validate mime type ──────────────────────────────────────────────────────

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

  // ── Validate size ───────────────────────────────────────────────────────────

  const maxBytes = fileType === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

  if (sizeBytes > maxBytes) {
    const maxMb = maxBytes / (1024 * 1024);
    res.status(400).json({
      error: "FILE_TOO_LARGE",
      message: `${fileType === "video" ? "Video" : "Image"} must be smaller than ${maxMb} MB. Received ${(sizeBytes / (1024 * 1024)).toFixed(1)} MB.`,
      maxBytes,
    });
    return;
  }

  // ── Generate storage path ───────────────────────────────────────────────────
  // pending/{userId}/{uuid}.{ext}
  // The auction creation endpoint does not need to rename or move the file.

  const ext = MIME_TO_EXT[mimeType] ?? (fileType === "video" ? "mp4" : "jpg");
  const filename = `${randomUUID()}.${ext}`;
  const path = `pending/${userId}/${filename}`;

  // ── Create presigned upload URL (60-minute expiry) ──────────────────────────

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: false });

  if (error || !data) {
    req.log.error({ err: error?.message, path }, "Failed to create presigned upload URL");
    res.status(500).json({
      error: "UPLOAD_URL_FAILED",
      message: "Could not generate an upload URL. Please try again.",
    });
    return;
  }

  // ── Build the public URL the client will use after uploading ────────────────
  const { data: { publicUrl } } = supabaseAdmin.storage
    .from(BUCKET)
    .getPublicUrl(path);

  res.status(201).json({
    uploadUrl: data.signedUrl,   // PUT to this URL with the file as the body
    path,                         // storage path (for reference)
    publicUrl,                    // use this as video_url or thumbnail_url in POST /auctions
    fileType,
    expiresInSeconds: 3600,       // presigned URL is valid for 60 minutes
  });
});

export default router;
