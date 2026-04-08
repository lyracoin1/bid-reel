import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "../_lib/supabase";
import { requireAuth } from "../_lib/requireAuth";
import { ApiError } from "../_lib/errors";
import { logger } from "../_lib/logger";

// ---------------------------------------------------------------------------
// POST /api/media/upload-url
// ---------------------------------------------------------------------------
// Returns a presigned PUT URL for uploading directly to Supabase Storage,
// plus the final public URL the client should save after a successful upload.
//
// Request:  { fileType: "image"|"video", mimeType: string, sizeBytes: number }
// Response: { uploadUrl, path, publicUrl, fileType, expiresInSeconds }
// ---------------------------------------------------------------------------

const BUCKET = "media";
const EXPIRY_SECONDS = 3600;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;  // 10 MB
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB

const ALLOWED_MIME: Record<"image" | "video", string[]> = {
  image: ["image/jpeg", "image/png", "image/webp"],
  video: ["video/mp4", "video/quicktime", "video/webm"],
};

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

const bodySchema = z.object({
  fileType: z.enum(["image", "video"]),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

const BUCKET_OPTIONS = {
  public: true,
  fileSizeLimit: MAX_VIDEO_BYTES,
  allowedMimeTypes: [
    ...ALLOWED_MIME.image,
    ...ALLOWED_MIME.video,
  ],
};

// Ensure the bucket exists with the correct settings.
// createBucket only applies settings on first creation — if the bucket already
// exists, its fileSizeLimit is whatever Supabase defaulted to.  We must call
// updateBucket in that case so the limit is always in effect.
async function ensureBucket(): Promise<void> {
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, BUCKET_OPTIONS);

  if (!error) return; // Freshly created with correct settings.

  if (!error.message.toLowerCase().includes("already exists")) {
    throw error; // Unexpected creation error.
  }

  // Bucket existed before — enforce our fileSizeLimit.
  const { error: updateError } = await supabaseAdmin.storage.updateBucket(
    BUCKET,
    BUCKET_OPTIONS,
  );
  if (updateError) {
    throw updateError;
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "METHOD_NOT_ALLOWED", message: "POST required" });
    return;
  }

  try {
    const user = await requireAuth(req.headers["authorization"]);

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid request body",
      });
      return;
    }

    const { fileType, mimeType, sizeBytes } = parsed.data;

    if (!ALLOWED_MIME[fileType].includes(mimeType)) {
      res.status(400).json({
        error: "INVALID_MIME",
        message: `MIME type "${mimeType}" is not allowed for ${fileType} uploads.`,
      });
      return;
    }

    const maxBytes = fileType === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (sizeBytes > maxBytes) {
      const limitMb = maxBytes / (1024 * 1024);
      res.status(400).json({
        error: "FILE_TOO_LARGE",
        message: `${fileType === "image" ? "Images" : "Videos"} must be under ${limitMb} MB.`,
      });
      return;
    }

    const ext = MIME_TO_EXT[mimeType] ?? "bin";
    const path = `${fileType}s/${user.id}/${randomUUID()}.${ext}`;

    await ensureBucket();

    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);

    if (error || !data) {
      logger.error("POST /api/media/upload-url: signed URL creation failed", { error });
      res.status(500).json({
        error: "STORAGE_ERROR",
        message: "Could not create upload URL. Please try again.",
      });
      return;
    }

    const { data: publicData } = supabaseAdmin.storage
      .from(BUCKET)
      .getPublicUrl(path);

    res.status(200).json({
      uploadUrl: data.signedUrl,
      path,
      publicUrl: publicData.publicUrl,
      fileType,
      expiresInSeconds: EXPIRY_SECONDS,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }
    console.error("UPLOAD_URL_ERROR:", err);

    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }
}
