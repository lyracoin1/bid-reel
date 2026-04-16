/**
 * Client-side video compression using ffmpeg.wasm.
 *
 * Produces TikTok-grade output:
 *   • Codec     : H.264 (libx264)
 *   • Container : MP4 with +faststart for progressive streaming
 *   • Resolution: max 720p on the long edge (never upscale)
 *   • CRF       : 28 (good quality at small file size)
 *   • Audio     : AAC 96 kbps mono
 *
 * The ffmpeg WASM core (~25 MB) is **lazily** loaded from a CDN the first time
 * the user picks a video — so there is zero impact on the initial page bundle.
 *
 * Single-threaded build is used so the page does NOT need
 * Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy headers
 * (which would otherwise break Supabase OAuth popups, embeds, etc.).
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

// CDN base for the single-threaded UMD core. Pinned to a known-good version.
// unpkg is the primary; jsDelivr is a fallback in case unpkg is blocked on the
// user's network (e.g. mobile WebView on restrictive carriers).
const FFMPEG_CORE_VERSION = "0.12.6";
const CORE_CDNS = [
  `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`,
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`,
];

/** Thrown when ffmpeg.wasm fails to load from every CDN. Callers can catch
 *  this to fall back to raw upload without compression. */
export class FFmpegLoadError extends Error {
  readonly code = "FFMPEG_LOAD_FAILED";
  constructor(message: string, public readonly lastCause?: unknown) {
    super(message);
    this.name = "FFmpegLoadError";
  }
}

// ─── Singleton FFmpeg instance — load once, reuse across uploads ─────────────

let ffmpegInstance: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const ff = new FFmpeg();

    // Mirror the core + wasm into Blob URLs so the worker can `importScripts`
    // them under the page's own origin (works around any cross-origin worker
    // restrictions in mobile WebViews). Try each CDN in order — if one is
    // blocked / down, move to the next.
    let lastErr: unknown = null;
    for (const base of CORE_CDNS) {
      try {
        const [coreURL, wasmURL] = await Promise.all([
          toBlobURL(`${base}/ffmpeg-core.js`,   "text/javascript"),
          toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
        ]);
        await ff.load({ coreURL, wasmURL });
        ffmpegInstance = ff;
        console.log(`[video-compressor] ✅ ffmpeg core loaded from ${base}`);
        return ff;
      } catch (err) {
        console.warn(`[video-compressor] ⚠️ ffmpeg core load failed from ${base}:`, err);
        lastErr = err;
      }
    }
    throw new FFmpegLoadError(
      `Failed to load ffmpeg core from any CDN (${CORE_CDNS.join(", ")})`,
      lastErr,
    );
  })();

  try {
    return await loadingPromise;
  } catch (err) {
    loadingPromise = null; // allow retry on next call
    if (err instanceof FFmpegLoadError) throw err;
    throw new FFmpegLoadError(
      err instanceof Error ? err.message : "ffmpeg core initialisation failed",
      err,
    );
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface CompressVideoOptions {
  /** Called with a 0–100 progress percentage during transcoding. */
  onProgress?: (pct: number) => void;
  /** Max long-edge resolution. Default 720. */
  maxHeight?: number;
  /** H.264 CRF (lower = higher quality, larger file). Default 28. */
  crf?: number;
  /** Audio bitrate. Default "96k". */
  audioBitrate?: string;
}

export interface CompressVideoResult {
  /** Compressed MP4 file ready to upload. */
  file: File;
  /** Original size in bytes. */
  originalBytes: number;
  /** Compressed size in bytes. */
  compressedBytes: number;
  /** Wall-clock time spent transcoding, in milliseconds. */
  durationMs: number;
}

/** Maximum input size accepted before compression. Larger files are rejected. */
export const MAX_RAW_INPUT_BYTES = 100 * 1024 * 1024; // 100 MB

/** Maximum acceptable size *after* compression (matches server enforcement). */
export const MAX_COMPRESSED_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Compress a video file in the browser.
 *
 * Throws if:
 *   • file > MAX_RAW_INPUT_BYTES
 *   • ffmpeg fails to load (network) or transcode (corrupt input)
 *   • output is still > MAX_COMPRESSED_BYTES (bumped CRF can't shrink it enough)
 */
export async function compressVideo(
  file: File,
  opts: CompressVideoOptions = {},
): Promise<CompressVideoResult> {
  if (file.size > MAX_RAW_INPUT_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    throw new Error(`Video too large: ${mb} MB. Maximum input is 100 MB.`);
  }

  const maxHeight = opts.maxHeight ?? 720;
  const crf = opts.crf ?? 28;
  const audioBitrate = opts.audioBitrate ?? "96k";
  const startedAt = performance.now();

  const ff = await getFFmpeg();

  // Wire progress events
  let progressHandler: ((p: { progress: number }) => void) | null = null;
  if (opts.onProgress) {
    progressHandler = ({ progress }) => {
      // ffmpeg.wasm reports 0..1, sometimes spuriously >1 near the end
      const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
      opts.onProgress!(pct);
    };
    ff.on("progress", progressHandler);
  }

  // Pick a sensible source extension so demuxer is happy
  const inputName = "input" + (file.name.match(/\.[a-zA-Z0-9]{1,5}$/)?.[0] ?? ".mp4");
  const outputName = "output.mp4";

  try {
    await ff.writeFile(inputName, await fetchFile(file));

    // Scale: keep aspect ratio, even-dimension pad. -vf only kicks in if source
    // is taller than maxHeight; otherwise the source is preserved.
    // Using "min(ih,720)" keeps videos already < 720p untouched (no upscale).
    await ff.exec([
      "-i", inputName,
      "-vf", `scale=-2:'min(ih,${maxHeight})'`,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", String(crf),
      "-c:a", "aac",
      "-b:a", audioBitrate,
      "-ac", "2",
      "-movflags", "+faststart",
      "-y",
      outputName,
    ]);

    const data = await ff.readFile(outputName);
    const u8 = data instanceof Uint8Array ? data : new TextEncoder().encode(data as string);
    const compressedBytes = u8.byteLength;

    if (compressedBytes > MAX_COMPRESSED_BYTES) {
      const mb = (compressedBytes / 1024 / 1024).toFixed(1);
      throw new Error(`Compressed video is still too large: ${mb} MB. Try a shorter clip.`);
    }

    // Copy into a fresh ArrayBuffer so the File is detached from the WASM
    // heap (which gets freed/reused on the next ffmpeg invocation) and so the
    // type matches BlobPart (rules out SharedArrayBuffer-backed views).
    const ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);

    // Build a File for upload. Strip the original extension and force .mp4.
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const compressed = new File([ab], `${baseName}.mp4`, { type: "video/mp4" });

    return {
      file: compressed,
      originalBytes: file.size,
      compressedBytes,
      durationMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    // Clean up the in-memory FS so repeated uploads don't accumulate
    if (progressHandler) ff.off("progress", progressHandler);
    try { await ff.deleteFile(inputName); } catch { /* ignore */ }
    try { await ff.deleteFile(outputName); } catch { /* ignore */ }
  }
}

/** Eagerly preload the ffmpeg core in the background — call from create-auction
 *  page mount so the WASM is warm by the time the user picks a file. */
export function preloadFFmpeg(): void {
  // Fire-and-forget; swallow errors (will retry on first real use).
  getFFmpeg().catch(() => { /* ignore */ });
}
