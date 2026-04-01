/**
 * useLiveAuctionStatus
 *
 * Ticks every second so timer chips always display the real remaining time.
 * Also fires `onStateChange(newState)` when state transitions, enabling
 * in-app toasts for "Bidding opened!" and "Auction ended" events without
 * any WebSocket or polling calls.
 *
 * FCM upgrade path:
 *   Replace the setInterval with a foreground FCM handler that calls
 *   the same `onStateChange` callback — the UI layer stays identical.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { getAuctionState, getTimeRemaining, getCountdownToStart } from "@/lib/utils";
import type { AuctionState } from "@/lib/utils";

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

  // Keep latest callback ref so the interval doesn't go stale
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  // Track previous state to detect transitions
  const prevStateRef = useRef<AuctionState>(status.state);

  const tick = useCallback(() => {
    const next = computeStatus(startsAt, endsAt);
    setStatus(next);
    if (next.state !== prevStateRef.current) {
      prevStateRef.current = next.state;
      onStateChangeRef.current?.(next.state);
    }
  }, [startsAt, endsAt]);

  useEffect(() => {
    // Run immediately in case we're already in a transition
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [tick]);

  return status;
}
