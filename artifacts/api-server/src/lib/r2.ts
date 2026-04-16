/**
 * Cloudflare R2 storage client.
 *
 * R2 is fully S3-compatible, so we use the AWS SDK with R2's endpoint.
 * Endpoint format: https://{ACCOUNT_ID}.r2.cloudflarestorage.com
 *
 * All uploads land in the bucket under the same scheme used previously:
 *   pending/{userId}/{uuid}.{ext}            — raw uploads from clients
 *   processed/{userId}/{jobId}_video_720.mp4 — server-transcoded outputs
 *   processed/{userId}/{jobId}_thumb.jpg     — server-extracted thumbnails
 *
 * Backwards compatibility:
 *   Some auctions still carry Supabase Storage public URLs (pre-R2 migration).
 *   `parseMediaUrl()` recognises both formats so the lifecycle / cleanup code
 *   can route deletions to the correct backend.
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { logger } from "./logger.js";

// ─── Required environment variables ──────────────────────────────────────────

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v || v.length === 0) {
    throw new Error(
      `Missing required environment variable "${key}". ` +
      `Set it in Replit Secrets before starting the server.`,
    );
  }
  return v;
}

const R2_ACCOUNT_ID       = requireEnv("R2_ACCOUNT_ID");
const R2_ACCESS_KEY_ID    = requireEnv("R2_ACCESS_KEY_ID");
const R2_SECRET_KEY       = requireEnv("R2_SECRET_ACCESS_KEY");
export const R2_BUCKET    = requireEnv("R2_BUCKET");
const R2_PUBLIC_URL_RAW   = requireEnv("R2_PUBLIC_URL");

/** Public base URL with any trailing slash stripped. */
export const R2_PUBLIC_URL = R2_PUBLIC_URL_RAW.replace(/\/+$/, "");

// ─── Client (singleton) ──────────────────────────────────────────────────────

const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

export const r2Client: S3Client = new S3Client({
  region: "auto", // R2 ignores region but the SDK requires one
  endpoint,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_KEY,
  },
});

logger.info({ endpoint, bucket: R2_BUCKET, publicUrl: R2_PUBLIC_URL }, "r2: client initialised");

// ─── Public URL helpers ──────────────────────────────────────────────────────

/** Build the public URL for an object key in our R2 bucket. */
export function r2PublicUrl(key: string): string {
  // Encode each path segment but keep the slashes between them.
  const safeKey = key.split("/").map(encodeURIComponent).join("/");
  return `${R2_PUBLIC_URL}/${safeKey}`;
}

/** Returns true if the URL is one of our R2 public URLs. */
export function isR2Url(url: string): boolean {
  return url.startsWith(`${R2_PUBLIC_URL}/`);
}

// Legacy Supabase Storage host + bucket — only ever used for backwards-
// compatible reads/deletes against rows written before the R2 migration.
const SUPABASE_HOST = (() => {
  try { return new URL(process.env["SUPABASE_URL"] ?? "").host; }
  catch { return ""; }
})();
const LEGACY_SUPABASE_BUCKET = "auction-media";

/** Returns true if the URL is a Supabase Storage public URL (legacy)
 *  served from OUR Supabase project (not an arbitrary attacker-controlled host). */
export function isSupabaseUrl(url: string): boolean {
  if (!SUPABASE_HOST) return false;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  return parsed.host === SUPABASE_HOST
      && parsed.pathname.startsWith(`/storage/v1/object/public/${LEGACY_SUPABASE_BUCKET}/`);
}

/**
 * Extract the storage object key (path inside the bucket) from a URL.
 * Works for both R2 public URLs and legacy Supabase Storage URLs.
 * Returns `{ backend, key }` or null if the URL is not recognised.
 */
export function parseMediaUrl(
  url: string,
): { backend: "r2"; key: string } | { backend: "supabase"; key: string; bucket: string } | null {
  if (isR2Url(url)) {
    const key = decodeURIComponent(url.slice(R2_PUBLIC_URL.length + 1));
    return { backend: "r2", key };
  }
  // Only recognise Supabase URLs that come from OUR project + OUR bucket.
  // This prevents attacker-controlled URLs from steering server-side deletes
  // / downloads at unintended objects when we route them through this parser.
  if (isSupabaseUrl(url)) {
    const marker = `/storage/v1/object/public/${LEGACY_SUPABASE_BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    const key = decodeURIComponent(url.slice(idx + marker.length));
    return { backend: "supabase", key, bucket: LEGACY_SUPABASE_BUCKET };
  }
  return null;
}

/**
 * Validate a media URL submitted by a client at auction-creation time.
 *
 * Enforces:
 *   • origin is one of our trusted hosts (R2 public URL, or our Supabase project)
 *   • R2 key is under `pending/{userId}/` or `processed/{userId}/`
 *   • Legacy Supabase key is under `{userId}/` (matches old upload prefix)
 *
 * Returns the canonical URL on success; throws Error on rejection.
 * Centralises the logic so auction routes never trust raw input URLs.
 */
export function assertOwnedMediaUrl(url: string, userId: string): void {
  const parsed = parseMediaUrl(url);
  if (!parsed) {
    throw new Error("Media URL is not from a recognised storage backend.");
  }

  if (parsed.backend === "r2") {
    const ok =
      parsed.key.startsWith(`pending/${userId}/`) ||
      parsed.key.startsWith(`processed/${userId}/`);
    if (!ok) {
      throw new Error("Media URL does not belong to the requesting user.");
    }
    return;
  }

  // Legacy Supabase: previous upload code wrote keys as "{userId}/{filename}"
  // inside the auction-media bucket. Be permissive but still ownership-scoped.
  if (!parsed.key.startsWith(`${userId}/`)) {
    throw new Error("Media URL does not belong to the requesting user.");
  }
}

// ─── Upload / download / delete ──────────────────────────────────────────────

/**
 * Upload a buffer to R2 under `key`. Fails if the object already exists
 * (no-overwrite semantics, matching the previous Supabase behaviour).
 */
export async function r2Upload(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<{ publicUrl: string; key: string }> {
  // Enforce no-overwrite: HEAD first; only proceed if 404.
  try {
    await r2Client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    throw new Error(`R2 object already exists: "${key}"`);
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    const status = e?.$metadata?.httpStatusCode;
    const name = e?.name;
    // NotFound / NoSuchKey / 404 → safe to write
    if (name !== "NotFound" && name !== "NoSuchKey" && status !== 404) {
      throw err;
    }
  }

  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Cache videos/images aggressively at the edge — content is immutable
      // (we never overwrite an object at the same key).
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  return { publicUrl: r2PublicUrl(key), key };
}

/** Download an R2 object to a Buffer. */
export async function r2Download(key: string): Promise<Buffer> {
  const out = await r2Client.send(
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }),
  );
  if (!out.Body) throw new Error(`R2 download returned empty body for key "${key}"`);
  // Body is a Readable stream — collect into a single Buffer.
  const chunks: Uint8Array[] = [];
  // @ts-expect-error — Node Readable is async-iterable
  for await (const chunk of out.Body) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/** Delete a single object from R2.  Resolves true on success, false on missing object. */
export async function r2Delete(key: string): Promise<boolean> {
  try {
    await r2Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}
