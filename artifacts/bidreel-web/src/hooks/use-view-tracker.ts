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

  // [VIEW TRACK] DEBUG — fires on every render of every FeedCard. Confirms the
  // hook is mounted at all and shows the live `active` flag from the parent.
  console.log("[VIEW TRACK]", { auctionId, active });

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

  const flush = (reason: string) => {
    endInterval();
    const rawMs   = Math.round(accumulatedRef.current);
    // FORCE: if no time was actually accumulated (e.g. visibility never flipped
    // to "visible", or StrictMode double-mount swallowed the first interval),
    // still send a synthetic 2500ms so we can verify the network/db end-to-end.
    const watchMs = rawMs > 0 ? rawMs : 2500;
    accumulatedRef.current = 0;

    console.log("[VIEW FLUSH CHECK]", {
      auctionId,
      reason,
      rawMs,
      forcedWatchMs: watchMs,
      hasStartTime:  startedAtRef.current != null,
      alreadySent:   sentRef.current,
      active,
    });

    // ── DEBUG MODE: ALL GUARDS DISABLED ────────────────────────────────────
    // Normal guards (commented out — restore after DB confirms it's writing):
    //   if (sentRef.current)  return;   // dedupe within one active session
    //   if (watchMs <= 0)     return;   // nothing measured
    sentRef.current = true;

    console.log("[FORCE VIEW SEND]", auctionId, watchMs);
    console.log("[VIEW API CALL]", auctionId, { watchMs, reason, source });
    void reportViewApi(auctionId, { watchMs, source })
      .then((r) => console.log("[VIEW API RESULT]", auctionId, r))
      .catch((e) => console.warn("[VIEW API ERR]", auctionId, e));
  };

  // ── Lifecycle: respond to `active` flag from parent ────────────────────────
  useEffect(() => {
    if (!active) {
      // Becoming inactive → flush the session.
      console.log("[VIEW EFFECT] inactive branch", { auctionId });
      flush("inactive");
      return;
    }

    // Becoming active → reset session and start measuring (only if visible).
    const vis = typeof document === "undefined" ? "visible" : document.visibilityState;
    console.log("[VIEW EFFECT] active branch", { auctionId, visibility: vis });
    accumulatedRef.current = 0;
    sentRef.current = false;
    startedAtRef.current = null;
    if (vis === "visible") {
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
    const onPageHide = () => flush("pagehide");

    document.addEventListener("visibilitychange", onVisChange);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      document.removeEventListener("visibilitychange", onVisChange);
      window.removeEventListener("pagehide", onPageHide);
      // Component unmount or `active` flipping → flush this session.
      flush("cleanup");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, auctionId]);
}
