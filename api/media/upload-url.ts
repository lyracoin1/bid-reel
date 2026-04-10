import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  S3Client,
  PutObjectCommand,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";
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

const R2_ACCOUNT_ID  = process.env["R2_ACCOUNT_ID"]     ?? "d4b5c54d01b6cf375012d7b9d1331ead";
const R2_PUBLIC_BASE = process.env["R2_PUBLIC_BASE_URL"] ?? "https://pub-8b8e7f8f594241f09d4af25fd307f2e4.r2.dev";

/**
 * Sanitize the R2 bucket name.
 * If someone accidentally pastes a full Cloudflare dashboard URL as the env
 * var value (e.g. https://dash.cloudflare.com/<account>/r2/default/buckets/media)
 * this extracts just the final path segment so the S3 client never receives
 * a value containing '/'.
 *
 * Correct env var value should be just the bucket name, e.g.: bidreel-media
 */
function sanitizeBucketName(raw: string): string {
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    const segment = raw.split("/").filter(Boolean).pop();
    return segment ?? raw;
  }
  return raw;
}

const R2_BUCKET  = sanitizeBucketName(process.env["R2_BUCKET"] ?? "bidreel-media");
const R2_ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const EXPIRY_SECONDS = 3600;

const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_VIDEO_BYTES = 20 * 1024 * 1024; // 20 MB

const ALLOWED_MIME: Record<"image" | "video", string[]> = {
  image: ["image/jpeg", "image/png", "image/webp"],
  video: ["video/mp4", "video/quicktime", "video/webm"],
};

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg":      "jpg",
  "image/png":       "png",
  "image/webp":      "webp",
  "video/mp4":       "mp4",
  "video/quicktime": "mov",
  "video/webm":      "webm",
};

const bodySchema = z.object({
  fileType:  z.enum(["image", "video"]),
  mimeType:  z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// CORS — origins that are allowed to call this endpoint and upload to R2.
//
// https://localhost  — Capacitor Android/iOS bridge origin (APK/IPA builds).
//                      The WebView serves bundled assets from this origin even
//                      though it is not a real network server.
// https://www.bid-reel.com / https://bid-reel.com — production web.
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = [
  "https://localhost",
  "https://www.bid-reel.com",
  "https://bid-reel.com",
];

function setCorsHeaders(req: VercelRequest, res: VercelResponse): void {
  const origin = req.headers["origin"] as string | undefined;
  // Reflect the request origin if it is in the allow-list, otherwise use *.
  // Reflecting is required when credentials (Authorization header) are sent.
  const allowOrigin =
    origin && ALLOWED_ORIGINS.includes(origin) ? origin : "*";

  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

// ---------------------------------------------------------------------------
// R2 CORS — automatically applied to the bucket on the first request after a
// cold start.  This ensures the browser/WebView can PUT files directly to R2
// from any of the allowed origins without a CORS preflight failure.
// ---------------------------------------------------------------------------
let r2CorsConfigured = false;

async function ensureR2Cors(r2: S3Client): Promise<void> {
  if (r2CorsConfigured) return;
  try {
    await r2.send(
      new PutBucketCorsCommand({
        Bucket: R2_BUCKET,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: ALLOWED_ORIGINS,
              AllowedMethods: ["GET", "PUT"],
              AllowedHeaders: ["*"],
              MaxAgeSeconds: 86400,
            },
          ],
        },
      }),
    );
    r2CorsConfigured = true;
    logger.info("R2 CORS policy applied", { bucket: R2_BUCKET });
  } catch (err) {
    // Non-fatal: log and continue. The upload may still succeed if the policy
    // was already set correctly in the Cloudflare dashboard.
    logger.error("Failed to apply R2 CORS policy (non-fatal)", err);
  }
}

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
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // Always set CORS headers — needed for both OPTIONS preflight and the actual POST.
  setCorsHeaders(req, res);

  // Handle CORS preflight.
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

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

    // Ensure the R2 bucket CORS policy allows uploads from the mobile WebView.
    await ensureR2Cors(r2);

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key:    path,
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
