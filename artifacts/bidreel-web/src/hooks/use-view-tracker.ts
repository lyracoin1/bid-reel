/**
 * use-view-tracker — measures real on-screen watch time and reports it to
 * the server when the card stops being active (scrolled away, navigated
 * away, tab hidden, app backgrounded, page unload).
 *
 * Design notes:
 *   - The server is the only place that decides what counts as a view —
 *     this hook just times accurately and POSTs raw ms.
 *   - Watch time only accumulates while document.visibilityState === 'visible'
 *     AND the caller's `active` flag is true. Tab-hidden / phone-locked
 *     periods do NOT count, even if the card stays mounted.
 *   - We flush on every transition out of active and on tab hide / page
 *     unload (using the keepalive fetch flag baked into reportViewApi).
 *   - One report per active session — re-activating the same card later
 *     starts a new measurement and produces a new POST.
 */

import { useEffect, useRef } from "react";
import { reportViewApi } from "@/lib/api-client";

type Source = "feed" | "profile" | "search" | "saved" | "direct";

export function useViewTracker(args: {
  auctionId: string;
  active:    boolean;
  source?:   Source;
}) {
  const { auctionId, active, source = "feed" } = args;

  // Mutable timing state (ref so re-renders don't reset it).
  const startedAtRef    = useRef<number | null>(null); // perf-clock when active+visible
  const accumulatedRef  = useRef<number>(0);           // ms collected this session
  const sentRef         = useRef<boolean>(false);      // did we already POST this session?

  // ── Helpers ────────────────────────────────────────────────────────────────
  const beginInterval = () => {
    if (startedAtRef.current == null) {
      startedAtRef.current = performance.now();
    }
  };

  const endInterval = () => {
    if (startedAtRef.current != null) {
      accumulatedRef.current += performance.now() - startedAtRef.current;
      startedAtRef.current = null;
    }
  };

  const flush = () => {
    endInterval();
    const watchMs = Math.round(accumulatedRef.current);
    accumulatedRef.current = 0;
    if (sentRef.current) return;          // never POST twice for one session
    if (watchMs <= 0)     return;         // nothing to report
    sentRef.current = true;
    console.log("[VIEW API CALL]", auctionId, watchMs);
    void reportViewApi(auctionId, { watchMs, source }).catch(() => { /* swallow */ });
  };

  // ── Lifecycle: respond to `active` flag from parent ────────────────────────
  // Single source of truth for "session ended": the effect's cleanup function.
  // It fires on `active` flipping, on `auctionId` changing, and on unmount —
  // so we never need an explicit !active branch (which would double-flush).
  useEffect(() => {
    if (!active) {
      // Idle. Cleanup of the previous active-run already flushed.
      return;
    }

    // Becoming active → reset session and start measuring (only if visible).
    accumulatedRef.current = 0;
    sentRef.current = false;
    startedAtRef.current = null;
    if (typeof document === "undefined" || document.visibilityState === "visible") {
      beginInterval();
    }

    const onVisChange = () => {
      if (document.visibilityState === "visible") {
        beginInterval();
      } else {
        endInterval();
      }
    };

    // App-going-away events — flush so we never lose a session.
    // pagehide is the only event guaranteed to fire on iOS Safari and on
    // Capacitor app-suspend, hence preferred over beforeunload.
    const onPageHide = () => flush();

    document.addEventListener("visibilitychange", onVisChange);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      document.removeEventListener("visibilitychange", onVisChange);
      window.removeEventListener("pagehide", onPageHide);
      // Component unmount or `active` flipping → flush this session.
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, auctionId]);
}
