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
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logger } from "./logger.js";

// ─── Lazy environment loading ────────────────────────────────────────────────
//
// IMPORTANT: This module previously threw at import time when any R2_* env var
// was missing. That made the *entire* API server fail to boot — including
// routes that have nothing to do with R2 (e.g. /api/health, /api/auth/*,
// /api/admin/users). On Vercel that surfaced as a confusing 503 from the
// serverless wrapper which assumed Supabase was the missing config.
//
// We now defer validation until R2 is actually used. The exported constants
// (R2_BUCKET, R2_PUBLIC_URL) fall back to empty strings, and r2Client is built
// on first use via getR2Client(). Routes that do need R2 will throw a clear
// error at request time; routes that don't need R2 keep working.

function readEnv(key: string): string {
  return process.env[key] ?? "";
}

const R2_ACCOUNT_ID       = readEnv("R2_ACCOUNT_ID");
const R2_ACCESS_KEY_ID    = readEnv("R2_ACCESS_KEY_ID");
const R2_SECRET_KEY       = readEnv("R2_SECRET_ACCESS_KEY");
export const R2_BUCKET    = readEnv("R2_BUCKET");
const R2_PUBLIC_URL_RAW   = readEnv("R2_PUBLIC_URL");

/** Public base URL with any trailing slash stripped (empty when not configured). */
export const R2_PUBLIC_URL = R2_PUBLIC_URL_RAW.replace(/\/+$/, "");

/** True when every R2 env var is present and non-empty. */
function r2Configured(): boolean {
  return Boolean(
    R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_KEY && R2_BUCKET && R2_PUBLIC_URL,
  );
}

function assertR2Configured(): void {
  if (r2Configured()) return;
  const missing = [
    ["R2_ACCOUNT_ID", R2_ACCOUNT_ID],
    ["R2_ACCESS_KEY_ID", R2_ACCESS_KEY_ID],
    ["R2_SECRET_ACCESS_KEY", R2_SECRET_KEY],
    ["R2_BUCKET", R2_BUCKET],
    ["R2_PUBLIC_URL", R2_PUBLIC_URL],
  ].filter(([, v]) => !v).map(([k]) => k);
  throw new Error(
    `Cloudflare R2 is not configured. Missing environment variable(s): ${missing.join(", ")}. ` +
    `Set them in your hosting provider (Replit Secrets or Vercel Project → Environment Variables).`,
  );
}

// ─── Client (lazy singleton) ─────────────────────────────────────────────────

let _r2Client: S3Client | null = null;

function getR2Client(): S3Client {
  if (_r2Client) return _r2Client;
  assertR2Configured();
  const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  _r2Client = new S3Client({
    region: "auto", // R2 ignores region but the SDK requires one
    endpoint,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_KEY,
    },
  });
  logger.info({ endpoint, bucket: R2_BUCKET, publicUrl: R2_PUBLIC_URL }, "r2: client initialised");
  return _r2Client;
}

/**
 * Backwards-compatible export used by other modules that previously imported
 * `r2Client` directly. Implemented as a lazy proxy — the SDK is only built
 * (and env validated) the first time a method is invoked.
 */
export const r2Client: S3Client = new Proxy({} as S3Client, {
  get(_t, prop) {
    const client = getR2Client();
    const value = (client as unknown as Record<PropertyKey, unknown>)[prop as PropertyKey];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});

if (!r2Configured()) {
  logger.warn(
    "r2: not configured — R2-dependent routes (media uploads, video processing) will fail at request time. " +
    "Other routes (auth, users, admin) remain operational.",
  );
}

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

/**
 * Generate a presigned PUT URL so the client can upload directly to R2.
 * This bypasses our API server entirely — essential on Vercel because the
 * serverless function body limit (≈4.5 MB) kills larger video uploads.
 *
 * The URL expires after `expiresIn` seconds (default 15 min). The client must
 * PUT the file body with the same Content-Type used when signing, otherwise
 * R2 rejects the request.
 */
export async function r2PresignUpload(
  key: string,
  contentType: string,
  expiresIn = 900,
): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
  const client = getR2Client();
  // IMPORTANT: only sign headers we can guarantee the client will send back
  // verbatim on the PUT. Including CacheControl here would require the client
  // to echo the exact same Cache-Control header or R2 returns
  // SignatureDoesNotMatch. We therefore omit CacheControl from presigned PUTs
  // and only enforce it on server-side `r2Upload()` calls.
  const cmd = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  const uploadUrl = await getSignedUrl(client, cmd, { expiresIn });
  return { uploadUrl, publicUrl: r2PublicUrl(key), key };
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
