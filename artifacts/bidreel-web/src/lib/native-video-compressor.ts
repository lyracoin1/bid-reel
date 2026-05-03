/**
 * Native pre-upload video compression bridge.
 *
 * The actual implementation lives in the Capacitor `VideoCompressor` plugin:
 *   • Android: artifacts/bidreel-web/android/app/src/main/java/com/bidreel/app/
 *              VideoCompressorPlugin.java  (Media3 Transformer)
 *   • iOS:     not yet implemented — `isVideoCompressionSupported()` returns
 *              false on iOS so the UI surfaces an explicit "not yet enabled"
 *              message instead of silently falling back to a different path.
 *   • Web:     unsupported — see `isVideoCompressionSupported()`.
 *
 * Strict contract enforced by callers (create-auction.tsx → media-upload.ts):
 *   1. select video         (pickVideo)
 *   2. compress             (compressVideo)
 *   3. validate output      (size > 0, ≤ MAX_COMPRESSED_VIDEO_BYTES)
 *   4. upload compressed    (existing R2 presigned-PUT pipeline)
 *
 * Compression is REQUIRED. There is no raw-video fallback. If any step
 * fails the upload aborts and the error message points at the failing step.
 */

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

// ─── Plugin contract (mirrors VideoCompressorPlugin.java) ─────────────────

export interface PickVideoResult {
  /** Absolute file:// path to the picked video copied into app cache. */
  inputPath: string;
  /** Web-fetchable URL for the picked video (Capacitor.convertFileSrc(inputPath))
   *  — used for the in-page <video> preview only. Convenience field added by
   *  the JS layer, not returned by the native plugin. */
  inputWebPath: string;
  /** Path to a JPEG poster frame extracted from the first GOP-aligned frame.
   *  Undefined if the codec didn't yield a decodable frame. */
  thumbnailPath?: string;
  /** Web-fetchable URL for the JPEG thumbnail (Capacitor.convertFileSrc).
   *  Convenience field added by the JS layer. */
  thumbnailWebPath?: string;
  sizeBytes: number;
  durationMs: number;
  width: number;
  height: number;
}

export interface CompressVideoOptions {
  inputPath: string;
  /** Long-edge cap in pixels. Source is downscaled to this height (no upscale). */
  maxHeight?: number;
  /** H.264 target bitrate in bits-per-second. Default 2_000_000 (≈2 Mbps). */
  videoBitrateBps?: number;
}

export interface CompressVideoResult {
  outputPath: string;
  /** Web-fetchable URL for the compressed file (Capacitor.convertFileSrc).
   *  Convenience field added by the JS layer. */
  outputWebPath: string;
  sizeBytes: number;
  durationMs: number;
}

export interface CompressProgressEvent {
  /** Encoder progress, 0–100. */
  progress: number;
}

/** Native-plugin shape — these are the methods declared on the Java side.
 *  All path-like return values from the plugin are absolute file:// paths;
 *  web-fetchable URLs are computed in JS via Capacitor.convertFileSrc. */
interface VideoCompressorPlugin {
  isAvailable(): Promise<{ available: boolean; platform: string }>;
  pickVideo(): Promise<Omit<PickVideoResult, "inputWebPath" | "thumbnailWebPath">>;
  compressVideo(
    options: CompressVideoOptions,
  ): Promise<Omit<CompressVideoResult, "outputWebPath">>;
  readFileAsBase64(options: { path: string }): Promise<{ base64: string; sizeBytes: number }>;
  addListener(
    eventName: "compressProgress",
    listenerFunc: (ev: CompressProgressEvent) => void,
  ): Promise<PluginListenerHandle>;
}

const VideoCompressor = registerPlugin<VideoCompressorPlugin>("VideoCompressor");

// ─── Public API ───────────────────────────────────────────────────────────

/** Server-enforced cap on uploaded video size. Hardcoded to match the
 *  30 MB limit checked by the api-server and presigned-URL signer. */
export const MAX_COMPRESSED_VIDEO_BYTES = 30 * 1024 * 1024;

/** Hard ceiling on raw input — protects against pathological 4K source files
 *  that would take several minutes to compress on low-end devices. */
export const MAX_RAW_VIDEO_INPUT_BYTES = 200 * 1024 * 1024;

/**
 * True when this device can compress videos natively before upload.
 *
 * Returns false on iOS (architecture is in place but the native plugin
 * implementation is pending) and on web (browser ffmpeg.wasm is intentionally
 * disabled — we will not ship a path that uploads raw user videos).
 */
export function isVideoCompressionSupported(): boolean {
  return Capacitor.getPlatform() === "android" && Capacitor.isNativePlatform();
}

/** Human-readable explanation for why posting is blocked on this platform.
 *  Accepts any language code; non-Arabic codes fall back to English. */
export function getUnsupportedPlatformMessage(lang: string): string {
  const isAr = lang === "ar";
  const platform = Capacitor.getPlatform();
  if (platform === "ios") {
    return isAr
      ? "نشر الفيديو على iOS غير متاح بعد. سيتم تفعيله في تحديث قادم."
      : "Posting videos on iOS is not yet enabled. It will arrive in a future update.";
  }
  // web (and any other unknown platform)
  return isAr
    ? "نشر الفيديو متاح حالياً فقط على تطبيق BidReel للأندرويد. يرجى تثبيت التطبيق من متجر Play."
    : "Posting videos is currently only supported on the BidReel Android app. Please install it from the Play Store.";
}

/** Errors thrown by this module. The `step` field tells the UI exactly which
 *  hop in the strict pipeline failed so the message can be precise. */
export class NativeVideoError extends Error {
  readonly code = "NATIVE_VIDEO_ERROR";
  constructor(
    public readonly step: "unsupported" | "pick" | "compress" | "validate",
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "NativeVideoError";
  }
}

/**
 * Open the native video picker. Resolves only when the user selects a video.
 * Throws `NativeVideoError({ step: "pick" })` on cancel or any IO failure.
 */
export async function pickVideoNative(): Promise<PickVideoResult> {
  if (!isVideoCompressionSupported()) {
    throw new NativeVideoError("unsupported",
      "Native video pick is unavailable on this platform.");
  }
  try {
    const result = await VideoCompressor.pickVideo();
    if (result.sizeBytes > MAX_RAW_VIDEO_INPUT_BYTES) {
      const mb = (result.sizeBytes / 1024 / 1024).toFixed(0);
      throw new NativeVideoError("pick",
        `Selected video is too large (${mb} MB). Maximum input is ${MAX_RAW_VIDEO_INPUT_BYTES / 1024 / 1024} MB.`);
    }
    return {
      ...result,
      inputWebPath: Capacitor.convertFileSrc(result.inputPath),
      thumbnailWebPath: result.thumbnailPath
        ? Capacitor.convertFileSrc(result.thumbnailPath)
        : undefined,
    };
  } catch (err) {
    if (err instanceof NativeVideoError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("USER_CANCELLED")) {
      throw new NativeVideoError("pick", "USER_CANCELLED", err);
    }
    throw new NativeVideoError("pick", msg, err);
  }
}

/**
 * Compress a previously-picked video. Subscribe to progress via `onProgress`.
 *
 * Strict — throws `NativeVideoError` on any failure or if the produced file
 * fails validation (zero-byte / over the server cap). The caller MUST NOT
 * fall back to uploading the original file.
 */
export async function compressVideoNative(
  inputPath: string,
  opts: { maxHeight?: number; videoBitrateBps?: number; onProgress?: (pct: number) => void } = {},
): Promise<CompressVideoResult> {
  if (!isVideoCompressionSupported()) {
    throw new NativeVideoError("unsupported",
      "Native video compression is unavailable on this platform.");
  }

  let progressHandle: PluginListenerHandle | undefined;
  if (opts.onProgress) {
    const cb = opts.onProgress;
    progressHandle = await VideoCompressor.addListener("compressProgress", (ev) => {
      cb(Math.max(0, Math.min(100, Math.round(ev.progress))));
    });
  }

  try {
    const result = await VideoCompressor.compressVideo({
      inputPath,
      maxHeight: opts.maxHeight ?? 720,
      videoBitrateBps: opts.videoBitrateBps ?? 2_000_000,
    });

    // Validation rules (post-compression).
    if (!result.outputPath || result.sizeBytes <= 0) {
      throw new NativeVideoError("validate",
        "Compressor returned an empty file.");
    }
    if (result.sizeBytes > MAX_COMPRESSED_VIDEO_BYTES) {
      const mb = (result.sizeBytes / 1024 / 1024).toFixed(1);
      const cap = (MAX_COMPRESSED_VIDEO_BYTES / 1024 / 1024).toFixed(0);
      throw new NativeVideoError("validate",
        `Compressed file is ${mb} MB which exceeds the ${cap} MB limit. ` +
        `Try a shorter video.`);
    }

    return {
      ...result,
      outputWebPath: Capacitor.convertFileSrc(result.outputPath),
    };
  } catch (err) {
    if (err instanceof NativeVideoError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new NativeVideoError("compress", msg, err);
  } finally {
    if (progressHandle) await progressHandle.remove();
  }
}

/**
 * Read a compressed file back into a JS File for the existing upload pipeline.
 *
 * This goes through the native plugin's `readFileAsBase64` method instead of
 * `fetch(convertFileSrc(...))` because this app loads its page from
 * `server.url` (https://www.bid-reel.com), which makes any fetch to the
 * Capacitor local file server (https://localhost) cross-origin. The local
 * server does emit `Access-Control-Allow-Origin: *`, but WebView versions
 * and CSP behavior in the wild are inconsistent enough that we don't want
 * the upload pipeline depending on it. The bridge channel always works.
 */
export async function readCompressedFile(
  inputPath: string,
  fileName: string,
  mimeType = "video/mp4",
): Promise<File> {
  if (!isVideoCompressionSupported()) {
    throw new NativeVideoError("unsupported",
      "Cannot read native files on this platform.");
  }
  let payload: { base64: string; sizeBytes: number };
  try {
    payload = await VideoCompressor.readFileAsBase64({ path: inputPath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new NativeVideoError("validate",
      `Could not read compressed file: ${msg}`, err);
  }
  if (!payload.base64 || payload.sizeBytes <= 0) {
    throw new NativeVideoError("validate",
      "Native file readback returned empty payload.");
  }
  const binary = atob(payload.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, { type: mimeType });
}
