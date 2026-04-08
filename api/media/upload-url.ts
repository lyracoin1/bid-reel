import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "crypto";
import { z } from "zod";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireAuth } from "../_lib/requireAuth";
import { ApiError } from "../_lib/errors";
import { logger } from "../_lib/logger";

// ---------------------------------------------------------------------------
// POST /api/media/upload-url
// ---------------------------------------------------------------------------
// Returns a presigned PUT URL for uploading directly to Cloudflare R2,
// plus the final public URL the client should save after a successful upload.
//
// Request:  { fileType: "image"|"video", mimeType: string, sizeBytes: number }
// Response: { uploadUrl, path, publicUrl, fileType, expiresInSeconds }
// ---------------------------------------------------------------------------

const R2_ACCOUNT_ID   = "d4b5c54d01b6cf375012d7b9d1331ead";
const R2_BUCKET       = "bidreel-media";
const R2_PUBLIC_BASE  = "https://pub-8b8e7f8f594241f09d4af25fd307f2e4.r2.dev";
const R2_ENDPOINT     = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const EXPIRY_SECONDS  = 3600;

const MAX_IMAGE_BYTES = 10  * 1024 * 1024; // 10 MB
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB

const ALLOWED_MIME: Record<"image" | "video", string[]> = {
  image: ["image/jpeg", "image/png", "image/webp"],
  video: ["video/mp4", "video/quicktime", "video/webm"],
};

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg":    "jpg",
  "image/png":     "png",
  "image/webp":    "webp",
  "video/mp4":     "mp4",
  "video/quicktime": "mov",
  "video/webm":    "webm",
};

const bodySchema = z.object({
  fileType:  z.enum(["image", "video"]),
  mimeType:  z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

function getR2Client(): S3Client {
  const accessKeyId     = process.env["R2_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["R2_SECRET_ACCESS_KEY"];
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("R2_ACCESS_KEY_ID or R2_SECRET_ACCESS_KEY is not set");
  }
  return new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
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

    const ext  = MIME_TO_EXT[mimeType] ?? "bin";
    const path = `${fileType}s/${user.id}/${randomUUID()}.${ext}`;

    const r2 = getR2Client();

    const command = new PutObjectCommand({
      Bucket:      R2_BUCKET,
      Key:         path,
      ContentType: mimeType,
    });

    const uploadUrl = await getSignedUrl(r2, command, { expiresIn: EXPIRY_SECONDS });
    const publicUrl = `${R2_PUBLIC_BASE}/${path}`;

    logger.info("POST /api/media/upload-url: R2 presigned URL created", { path });

    res.status(200).json({
      uploadUrl,
      path,
      publicUrl,
      fileType,
      expiresInSeconds: EXPIRY_SECONDS,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }
    logger.error("POST /api/media/upload-url failed", err);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
