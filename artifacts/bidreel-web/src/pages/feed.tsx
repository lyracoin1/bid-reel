import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, ArrowDown, Gavel, Loader2 } from "lucide-react";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { FeedCard } from "@/components/feed/FeedCard";
import { useAuctions } from "@/hooks/use-auctions";
import { useBidPolling } from "@/hooks/use-bid-polling";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";

// Trigger a load-more fetch when the user is this many cards from the end.
const LOAD_MORE_THRESHOLD = 5;

export default function Feed() {
  const { data: auctions, isLoading, loadMore, hasMore, isLoadingMore } = useAuctions();
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const { isRefreshing, refresh } = useBidPolling();

  const { pullDistance, pullProgress, isRefreshing: isPulling } =
    usePullToRefresh(containerRef, refresh);

  const showPullIndicator = pullDistance > 4 || isPulling;

  // ── IntersectionObserver — tracks the active card for play/pause ───────────
  // Dep is auctions.length (not the full auctions array) so the observer only
  // re-registers when new cards are added, not on every bid-count update.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = Number(entry.target.getAttribute("data-index"));
            setActiveIndex(index);
          }
        });
      },
      { threshold: 0.6 }
    );

    const cards = container.querySelectorAll(".feed-card");
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auctions.length]);

  // ── Infinite scroll trigger ────────────────────────────────────────────────
  // When the user is within LOAD_MORE_THRESHOLD cards of the end, fetch the
  // next page. The check is a no-op if hasMore=false or already loading.
  useEffect(() => {
    if (
      auctions.length > 0 &&
      activeIndex >= auctions.length - LOAD_MORE_THRESHOLD &&
      hasMore &&
      !isLoadingMore
    ) {
      loadMore();
    }
  }, [activeIndex, auctions.length, hasMore, isLoadingMore, loadMore]);

  return (
    <MobileLayout noPadding>

      {/* ── Pull-to-refresh indicator ──────────────────────────────────────── */}
      <AnimatePresence>
        {showPullIndicator && (
          <motion.div
            key="ptr"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="fixed top-14 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 bg-black/85 backdrop-blur-md border border-white/12 rounded-full px-4 py-2 pointer-events-none"
          >
            {isPulling ? (
              <RefreshCw size={13} className="text-primary animate-spin" />
            ) : (
              <motion.div animate={{ rotate: pullProgress * 180 }} transition={{ duration: 0 }}>
                <ArrowDown size={13} className={pullProgress >= 1 ? "text-primary" : "text-white/60"} />
              </motion.div>
            )}
            <span className={`text-xs font-semibold ${pullProgress >= 1 || isPulling ? "text-primary" : "text-white/60"}`}>
              {isPulling ? "Refreshing…" : pullProgress >= 1 ? "Release to refresh" : "Pull to refresh"}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Background refresh indicator ────────────────────────────────────── */}
      <AnimatePresence>
        {isRefreshing && !showPullIndicator && (
          <motion.div
            key="bg-refresh"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="fixed top-14 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 bg-black/85 backdrop-blur-md border border-white/12 rounded-full px-4 py-2 pointer-events-none"
          >
            <RefreshCw size={13} className="text-primary animate-spin" />
            <span className="text-xs font-semibold text-primary">Refreshing…</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Feed scroll container ─────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="w-full h-[100dvh] overflow-y-scroll snap-y-mandatory hide-scrollbar bg-black"
        style={{
          transform: showPullIndicator ? `translateY(${Math.min(pullDistance * 0.28, 24)}px)` : undefined,
          transition: isPulling ? "none" : "transform 0.35s cubic-bezier(0.25,0.1,0.25,1)",
        }}
      >
        {/* ── Initial loading spinner ──────────────────────────────────────── */}
        {isLoading && auctions.length === 0 && (
          <div className="w-full h-[100dvh] snap-always flex items-center justify-center bg-black">
            <RefreshCw size={28} className="text-primary animate-spin" />
          </div>
        )}

        {/* ── Auction cards ─────────────────────────────────────────────────── */}
        {auctions.map((auction, index) => (
          <div key={auction.id} data-index={index} className="feed-card w-full h-[100dvh] snap-always">
            <FeedCard
              auction={auction}
              isActive={activeIndex === index}
              isNear={Math.abs(index - activeIndex) <= 1}
            />
          </div>
        ))}

        {/* ── Load-more in-progress indicator ──────────────────────────────── */}
        {isLoadingMore && (
          <div className="w-full h-[100dvh] snap-always flex items-center justify-center bg-black">
            <Loader2 size={28} className="text-primary animate-spin" />
          </div>
        )}

        {/* ── Empty state — DB has no active auctions ───────────────────────── */}
        {!isLoading && auctions.length === 0 && (
          <div className="w-full h-[100dvh] snap-always flex flex-col items-center justify-center bg-background px-6 text-center">
            <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-6">
              <Gavel size={32} className="text-primary/60" />
            </div>
            <h3 className="text-2xl font-bold mb-2">No auctions yet</h3>
            <p className="text-muted-foreground mb-8 max-w-xs">Be the first to list something — or check back shortly for new drops.</p>
            <motion.button
              whileTap={{ scale: 0.94 }}
              onClick={refresh}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-6 py-3 rounded-full bg-primary/15 border border-primary/30 text-primary text-sm font-bold disabled:opacity-50 transition-opacity"
            >
              <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
              {isRefreshing ? "Checking…" : "Refresh"}
            </motion.button>
          </div>
        )}

        {/* ── End-of-feed card — only shown when all pages are loaded ──────── */}
        {!isLoading && !isLoadingMore && !hasMore && auctions.length > 0 && (
          <div className="w-full h-[100dvh] snap-always flex flex-col items-center justify-center bg-background px-6 text-center">
            <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-6">
              <span className="text-2xl">🎉</span>
            </div>
            <h3 className="text-2xl font-bold mb-2">You're all caught up!</h3>
            <p className="text-muted-foreground mb-8">Check back later for new exclusive drops.</p>
            <motion.button
              whileTap={{ scale: 0.94 }}
              onClick={refresh}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-6 py-3 rounded-full bg-primary/15 border border-primary/30 text-primary text-sm font-bold disabled:opacity-50 transition-opacity"
            >
              <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
              {isRefreshing ? "Refreshing…" : "Refresh feed"}
            </motion.button>
          </div>
        )}
      </div>
    </MobileLayout>
  );
}
