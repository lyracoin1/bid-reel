/**
 * server-clock.ts — server-aligned wall clock for the client.
 *
 * Why this exists
 * ───────────────
 * Auction `ends_at` is stored as a UTC instant chosen by the SERVER
 * (`server_now + duration_hours`). The countdown shown in the UI is
 * `endsAt - clientNow`. If the device clock is wrong (very common on
 * Android — battery-pull, manual change, OS time-update lag) then
 * `clientNow` ≠ `serverNow` and the countdown can be off by hours OR
 * even days, even though the row in the database is correct.
 *
 * Fix: every API response carries an `X-Server-Time` header (UTC ISO).
 * On every response we record `(serverEpochMs, clientEpochMs)` and
 * derive `offsetMs = serverEpochMs - clientEpochMs`. We keep the
 * **median of the last 8 samples** so a single jittery request can't
 * skew the offset.
 *
 *   serverNow()       → Date corrected against server time
 *   serverNowMs()     → epoch ms corrected against server time
 *   recordServerTime(headerValue) → push a sample
 *
 * Until at least one sample lands the helpers return raw client time —
 * which is the same behavior as before this file existed, so nothing
 * regresses on first paint.
 */

const MAX_SAMPLES = 8;
const samples: number[] = [];
let cachedOffsetMs = 0;

function recomputeMedian(): void {
  if (samples.length === 0) {
    cachedOffsetMs = 0;
    return;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  cachedOffsetMs = sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

/**
 * Push one server-time sample. Accepts either:
 *   - an ISO 8601 timestamp (the X-Server-Time header value), or
 *   - null/undefined/empty (header missing → no-op).
 *
 * Robust against malformed values — anything unparseable is dropped.
 */
export function recordServerTime(headerValue: string | null | undefined): void {
  if (!headerValue) return;
  const serverMs = Date.parse(headerValue);
  if (!Number.isFinite(serverMs)) return;
  // Sanity bound: server clock should be within ~5 years of "now". Anything
  // outside that window is a malformed header (e.g. an HTML error page being
  // sniffed as a date), not a real device clock — even devices with
  // factory-default clocks (1970/2010) are recoverable inside this range.
  const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;
  const nowApprox = Date.now();
  if (Math.abs(serverMs - nowApprox) > FIVE_YEARS_MS &&
      // …unless the device clock itself is the wildly-wrong one, in which
      // case the absolute server timestamp is still sane (post-2020, pre-2050).
      (serverMs < Date.UTC(2020, 0, 1) || serverMs > Date.UTC(2050, 0, 1))) {
    return;
  }
  const offset = serverMs - nowApprox;
  samples.push(offset);
  if (samples.length > MAX_SAMPLES) samples.shift();
  recomputeMedian();
}

/** Convenience: read X-Server-Time off a fetch Response and feed it in. */
export function recordServerTimeFromResponse(res: Response): void {
  recordServerTime(res.headers.get("x-server-time"));
}

/** Server-aligned epoch ms. Falls back to client clock until first sync. */
export function serverNowMs(): number {
  return Date.now() + cachedOffsetMs;
}

/** Server-aligned Date instance. Use for all countdown math. */
export function serverNow(): Date {
  return new Date(serverNowMs());
}

/** For diagnostics / tests. */
export function getClockOffsetMs(): number {
  return cachedOffsetMs;
}

export function getClockSampleCount(): number {
  return samples.length;
}
