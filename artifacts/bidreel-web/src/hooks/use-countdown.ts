/**
 * useLiveAuctionStatus
 *
 * Ticks every second so timer chips always display the real remaining time.
 * Also fires `onStateChange(newState)` when state transitions, enabling
 * in-app toasts for "Bidding opened!" and "Auction ended" events without
 * any WebSocket or polling calls.
 *
 * FCM upgrade path:
 *   Replace the subscribeToTick call with a foreground FCM handler that calls
 *   the same `onStateChange` callback — the UI layer stays identical.
 *
 * ── Shared global ticker ───────────────────────────────────────────────────
 * Performance fix: instead of each useLiveAuctionStatus instance creating its
 * own setInterval, all instances share a single module-level interval.
 *
 * Before: N mounted FeedCards → N setInterval timers → N setState calls/sec
 * After:  any number of mounted cards → exactly 1 setInterval → each listener
 *         called once per second from the shared tick.
 *
 * The interval is started on first subscriber and never stopped (safe — the
 * listeners Set is the only memory held; cleanup just removes the function).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { getAuctionState, getTimeRemaining, getCountdownToStart } from "@/lib/utils";
import type { AuctionState } from "@/lib/utils";

// ─── Shared global ticker ─────────────────────────────────────────────────────

type TickFn = () => void;
const _tickListeners = new Set<TickFn>();
let _tickIntervalId: ReturnType<typeof setInterval> | null = null;

/** Start the shared interval (idempotent — only one interval ever runs). */
function _startSharedTick(): void {
  if (_tickIntervalId !== null) return;
  _tickIntervalId = setInterval(() => {
    _tickListeners.forEach(fn => fn());
  }, 1_000);
}

/**
 * Subscribe `fn` to the shared 1-second tick.
 * Returns an unsubscribe function for use in useEffect cleanup.
 */
function _subscribeToTick(fn: TickFn): () => void {
  _tickListeners.add(fn);
  _startSharedTick();
  return () => { _tickListeners.delete(fn); };
}

// ─── Public hook ─────────────────────────────────────────────────────────────

export interface LiveAuctionStatus {
  state: AuctionState;
  timeInfo: ReturnType<typeof getTimeRemaining>;
  countdownToStart: string | null;
}

function computeStatus(
  startsAt: string | null | undefined,
  endsAt: string,
): LiveAuctionStatus {
  return {
    state: getAuctionState({ startsAt, endsAt }),
    timeInfo: getTimeRemaining(endsAt),
    countdownToStart: startsAt ? getCountdownToStart(startsAt) : null,
  };
}

/**
 * @param auction  Needs only `startsAt` and `endsAt` — safe to pass a full Auction object.
 * @param onStateChange  Optional callback fired once per state transition.
 *                       Stable ref pattern: safe to use inline lambdas.
 */
export function useLiveAuctionStatus(
  auction: { startsAt?: string | null; endsAt: string },
  onStateChange?: (newState: AuctionState) => void,
): LiveAuctionStatus {
  const { startsAt, endsAt } = auction;

  const [status, setStatus] = useState<LiveAuctionStatus>(() =>
    computeStatus(startsAt, endsAt)
  );

  // Keep latest callback ref so the shared tick doesn't go stale
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  // Track previous state to detect transitions
  const prevStateRef = useRef<AuctionState>(status.state);

  const tick = useCallback(() => {
    const next = computeStatus(startsAt, endsAt);
    setStatus(prev => {
      // Bail out if the computed text strings are identical — avoids a
      // setState call (and therefore a re-render) every second when the
      // countdown string hasn't actually changed (e.g. ended auctions).
      if (
        prev.state            === next.state &&
        prev.timeInfo.text    === next.timeInfo.text &&
        prev.timeInfo.isUrgent === next.timeInfo.isUrgent &&
        prev.countdownToStart  === next.countdownToStart
      ) {
        return prev; // same reference — React skips the re-render
      }
      return next;
    });
    if (next.state !== prevStateRef.current) {
      prevStateRef.current = next.state;
      onStateChangeRef.current?.(next.state);
    }
  }, [startsAt, endsAt]);

  useEffect(() => {
    // Run immediately so the first render shows correct values.
    tick();
    // Subscribe to the shared global tick instead of creating a new interval.
    return _subscribeToTick(tick);
  }, [tick]);

  return status;
}
