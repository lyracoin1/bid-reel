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

// Self-hosted ffmpeg core — copied from node_modules into public/ffmpeg/ by
// the package.json `copy:ffmpeg` script (runs automatically before `dev` and
// `build`). Served from the SAME ORIGIN as the app, which eliminates every
// class of CDN failure we previously hit:
//   • unpkg / jsdelivr unreachable on MENA mobile carriers (Saudi STC,
//     Vodafone Egypt, Etisalat) — the BidReel target market.
//   • Cross-origin Blob conversion blocked in older Android System WebViews.
//   • CORS preflight failing under Capacitor's `https://localhost` origin.
//   • Generic CDN outages / latency.
//
// BASE_URL handles both the standalone deploy ("/") and any sub-path mount
// (e.g. Replit's "/bidreel-web/"). Capacitor builds set BASE_PATH=/ at build
// time, so the file resolves to a relative path inside the WebView bundle.
const ffmpegBase = `${import.meta.env.BASE_URL}ffmpeg/`;
const coreURLLocal = `${ffmpegBase}ffmpeg-core.js`;
const wasmURLLocal = `${ffmpegBase}ffmpeg-core.wasm`;

// CDN fallbacks — only consulted if the self-hosted asset somehow fails
// (e.g. the build pipeline didn't copy it). Pinned to the same version we
// bundle locally so the UMD JS and the WASM binary always match.
const FFMPEG_CORE_VERSION = "0.12.6";
const CORE_CDNS = [
  `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`,
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`,
];

// Hard ceiling on a single core+wasm load attempt. Without this, a stalled
// fetch on a flaky mobile network hangs forever and the user sees only a
// generic "Preparing video…" spinner. With it, we surface a clear error and
// fall through to raw upload after at most 20 s.
const LOAD_ATTEMPT_TIMEOUT_MS = 20_000;

// Global wall-clock budget across the whole load (all sources combined).
// Prevents a worst case of self-hosted-fail (20s) + unpkg-fail (40s) +
// jsdelivr-fail (40s) ≈ 100s, which still feels like a hang to the user.
// We bail out and let the raw-upload fallback kick in instead.
const LOAD_GLOBAL_BUDGET_MS = 35_000;

/** Reject a promise after `ms` if it hasn't settled. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

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

    // Build the source list: self-hosted asset URLs first (same-origin,
    // hashed by Vite, no CORS, no third-party reachability concerns), then
    // CDN fallbacks if the local URLs unexpectedly 404 (e.g. asset stripped
    // by a misconfigured deploy pipeline).
    const sources: Array<{ label: string; coreSrc: string; wasmSrc: string }> = [
      { label: "self-hosted", coreSrc: coreURLLocal, wasmSrc: wasmURLLocal },
      ...CORE_CDNS.map((base) => ({
        label: base,
        coreSrc: `${base}/ffmpeg-core.js`,
        wasmSrc: `${base}/ffmpeg-core.wasm`,
      })),
    ];

    let lastErr: unknown = null;
    const globalDeadline = performance.now() + LOAD_GLOBAL_BUDGET_MS;
    for (const { label, coreSrc, wasmSrc } of sources) {
      const remaining = globalDeadline - performance.now();
      if (remaining <= 0) {
        console.warn(
          `[video-compressor] ⏱ global ${LOAD_GLOBAL_BUDGET_MS}ms budget exhausted, skipping remaining sources`,
        );
        break;
      }
      // Cap this attempt at min(per-attempt timeout, remaining global budget)
      // so a slow source can't burn the entire budget on its own.
      const attemptTimeoutMs = Math.min(LOAD_ATTEMPT_TIMEOUT_MS, remaining);
      const startedAt = performance.now();
      try {
        // Mirror the core + wasm into Blob URLs so the worker can
        // `importScripts` them under the page's own origin. Wrap in a hard
        // timeout so a stalled fetch on a flaky mobile network never traps
        // the user behind an infinite spinner.
        const [coreURL, wasmURL] = await withTimeout(
          Promise.all([
            toBlobURL(coreSrc, "text/javascript"),
            toBlobURL(wasmSrc, "application/wasm"),
          ]),
          attemptTimeoutMs,
          `ffmpeg core fetch from ${label}`,
        );
        const remainingForInit = Math.max(
          1_000,
          globalDeadline - performance.now(),
        );
        await withTimeout(
          ff.load({ coreURL, wasmURL }),
          Math.min(LOAD_ATTEMPT_TIMEOUT_MS, remainingForInit),
          `ffmpeg worker init (${label})`,
        );
        ffmpegInstance = ff;
        const ms = Math.round(performance.now() - startedAt);
        console.log(`[video-compressor] ✅ ffmpeg core loaded from ${label} in ${ms}ms`);
        return ff;
      } catch (err) {
        const ms = Math.round(performance.now() - startedAt);
        console.warn(
          `[video-compressor] ⚠️ ffmpeg core load failed from ${label} after ${ms}ms:`,
          err,
        );
        lastErr = err;
      }
    }
    throw new FFmpegLoadError(
      `Failed to load ffmpeg core from any source (self-hosted + ${CORE_CDNS.length} CDN fallbacks)`,
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
