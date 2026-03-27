import { useEffect, useRef, useState, useCallback } from "react";

const THRESHOLD = 64;    // px to pull before triggering refresh
const MAX_PULL   = 96;   // maximum visual overscroll (px)

export interface PullToRefreshResult {
  /** 0 → no pull, THRESHOLD → triggers, clamped to MAX_PULL */
  pullDistance: number;
  /** 0.0 – 1.0 fraction of threshold reached */
  pullProgress: number;
  /** True while the async onRefresh() is running */
  isRefreshing: boolean;
}

/**
 * Attach to a scrollable container (via ref) to get native-feeling
 * pull-to-refresh on mobile web. Uses non-passive touchmove so we
 * can call preventDefault() and suppress the browser's overscroll glow.
 *
 * Usage:
 *   const { pullDistance, pullProgress, isRefreshing } =
 *     usePullToRefresh(containerRef, async () => { await reload(); });
 */
export function usePullToRefresh(
  containerRef: React.RefObject<HTMLElement | null>,
  onRefresh: () => Promise<void>
): PullToRefreshResult {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const startY      = useRef(0);
  const pulling     = useRef(false);
  const refreshing  = useRef(false);
  const pullDist    = useRef(0); // mirror state inside event handlers

  const doRefresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    setIsRefreshing(true);
    setPullDistance(THRESHOLD); // hold indicator at threshold while loading
    await onRefresh();
    setIsRefreshing(false);
    setPullDistance(0);
    refreshing.current = false;
  }, [onRefresh]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing.current) return;
      startY.current = e.touches[0].clientY;
      pulling.current = false;
      pullDist.current = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (refreshing.current) return;
      if (el.scrollTop > 2) return; // only pull when scrolled to top

      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) return;

      pulling.current = true;
      e.preventDefault(); // suppress browser overscroll / bounce
      const clamped = Math.min(delta * 0.55, MAX_PULL); // dampen drag
      pullDist.current = clamped;
      setPullDistance(clamped);
    };

    const onTouchEnd = () => {
      if (!pulling.current) return;
      pulling.current = false;

      if (pullDist.current >= THRESHOLD) {
        doRefresh();
      } else {
        setPullDistance(0);
        pullDist.current = 0;
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove",  onTouchMove,  { passive: false }); // must be non-passive
    el.addEventListener("touchend",   onTouchEnd,   { passive: true });
    el.addEventListener("touchcancel", onTouchEnd,  { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove",  onTouchMove);
      el.removeEventListener("touchend",   onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [containerRef, doRefresh]);

  return {
    pullDistance,
    pullProgress: Math.min(pullDistance / THRESHOLD, 1),
    isRefreshing,
  };
}
