import { useState, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import {
  ArrowLeft, ArrowDown, Share2, Clock, TrendingUp, Gavel,
  Play, Bell, Trophy, RefreshCw, ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { ImageSlider } from "@/components/feed/ImageSlider";
import { useAuction, usePlaceBid } from "@/hooks/use-auctions";
import { useFollow } from "@/hooks/use-follow";
import { useWatchAuction } from "@/hooks/use-watch";
import { useBidPolling, getUserBidStatus } from "@/hooks/use-bid-polling";
import { useRealtimeBids } from "@/hooks/use-realtime-bids";
import { currentUser } from "@/lib/mock-data";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { getWhatsAppUrl, cn } from "@/lib/utils";
import { useLang } from "@/contexts/LanguageContext";
import { useLiveAuctionStatus } from "@/hooks/use-countdown";
import { toast } from "@/hooks/use-toast";
import type { AuctionState } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

// ─── Adaptive bid increments based on current price ───────────────────────────
function getIncrements(currentBid: number): number[] {
  if (currentBid >= 50_000) return [2_500, 5_000, 10_000];
  if (currentBid >= 10_000) return [500, 1_000, 2_500];
  if (currentBid >= 2_500)  return [100, 250, 500];
  if (currentBid >= 500)    return [25, 50, 100];
  if (currentBid >= 100)    return [10, 20, 50];
  return [5, 10, 20];
}

export default function AuctionDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { data: auction } = useAuction(id || "");

  // ── Bid state ──────────────────────────────────────────────────────────────
  const [selectedInc, setSelectedInc] = useState<number | null>(null);
  const [bidError, setBidError] = useState<string | null>(null);
  const [bidSuccess, setBidSuccess] = useState(false);
  const bidPanelRef = useRef<HTMLDivElement>(null);

  const { mutate: placeBid, isPending: isBidding } = usePlaceBid({
    onSuccess: () => {
      setBidSuccess(true);
      setBidError(null);
      // Reset after 2.5 s so panel is ready for the next bid
      setTimeout(() => { setBidSuccess(false); setSelectedInc(null); }, 2500);
    },
    onError: (_code, message) => {
      setBidError(message);
    },
  });

  // ── Other hooks (must be unconditional — Rules of Hooks) ──────────────────
  const { isFollowing, toggle: toggleFollow } = useFollow();
  const { isWatching, toggle: toggleWatch } = useWatchAuction();
  const { t, formatPrice } = useLang();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { isRefreshing, refresh } = useBidPolling();
  const { pullDistance, pullProgress, isRefreshing: isPulling } =
    usePullToRefresh(scrollRef, refresh);
  const showPullIndicator = pullDistance > 4 || isPulling;
  const { realtimeCurrentBid, realtimeBidCount, isConnected } =
    useRealtimeBids(id ?? "", auction?.bidCount ?? 0);

  // ── Live state + countdown (must be unconditional) ────────────────────────
  // Fallback to epoch when auction is null so the hook always receives valid strings
  const EPOCH = new Date(0).toISOString();
  const onStateChange = useCallback((newState: AuctionState) => {
    if (!auction) return;
    if (newState === "active") {
      toast({ title: "🟢 Bidding is now open!", description: `"${auction.title}" just went live!` });
    } else if (newState === "ended") {
      toast({ title: "🏁 Auction has ended", description: `"${auction.title}" is now closed.` });
    }
  }, [auction?.title]);  // eslint-disable-line react-hooks/exhaustive-deps

  const { state, timeInfo, countdownToStart } = useLiveAuctionStatus(
    { startsAt: auction?.startsAt, endsAt: auction?.endsAt ?? EPOCH },
    auction ? onStateChange : undefined,
  );

  // ── Guard ─────────────────────────────────────────────────────────────────
  if (!auction) {
    return (
      <MobileLayout>
        <div className="flex h-full items-center justify-center">
          <p className="text-muted-foreground">Auction not found</p>
        </div>
      </MobileLayout>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const whatsappUrl = getWhatsAppUrl(auction.seller.phone, auction.title);
  const watching = isWatching(auction.id);
  const winner = state === "ended" && auction.bids.length > 0 ? auction.bids[0] : null;
  const isAlbum = auction.type === "album" && (auction.images?.length ?? 0) > 1;
  const isVideo = auction.type === "video";
  const isSeller = auction.seller.id === currentUser.id;
  const topBidUserId = auction.bids[0]?.user.id;
  const bidStatus = getUserBidStatus(auction.id, topBidUserId);

  const displayedBid = realtimeCurrentBid ?? auction.currentBid;
  const displayedBidCount = realtimeBidCount ?? auction.bidCount;
  const INCREMENTS = getIncrements(displayedBid);
  const minIncrement = INCREMENTS[0];
  const minBid = displayedBid + minIncrement;

  // Bid amount from the selected increment
  const bidAmount = selectedInc !== null ? displayedBid + selectedInc : 0;

  const handleShare = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: auction.title, url: window.location.href }); }
      catch (_) {}
    }
  };

  const handleScrollToBid = () => {
    bidPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const submitBid = () => {
    if (!selectedInc) return;
    setBidError(null);
    placeBid(auction.id, bidAmount);
  };

  // ── Timer chip ────────────────────────────────────────────────────────────
  const timerChip = (() => {
    if (state === "upcoming") return {
      className: "bg-amber-500/15 text-amber-400 border-amber-500/25",
      label: `${t("starts_in")} ${countdownToStart}`,
    };
    if (state === "ended") return {
      className: "bg-white/8 text-white/40 border-white/8",
      label: t("time_ended"),
    };
    return {
      className: timeInfo.isUrgent
        ? "bg-red-500/15 text-red-400 border-red-500/25"
        : "bg-emerald-500/12 text-emerald-400 border-emerald-500/20",
      label: timeInfo.text,
    };
  })();

  // ── Can the current user bid? ─────────────────────────────────────────────
  const canBid = state === "active" && !isSeller;

  return (
    <MobileLayout showNav noPadding>
      <div
        ref={scrollRef}
        className="relative w-full min-h-[100dvh] bg-background pb-32 overflow-y-auto"
      >

        {/* ── Pull-to-refresh indicator ── */}
        <AnimatePresence>
          {showPullIndicator && (
            <motion.div
              key="ptr-detail"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed top-24 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 bg-black/85 backdrop-blur-md border border-white/12 rounded-full px-4 py-2 pointer-events-none"
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

        {/* ── Floating top bar ── */}
        <div className="fixed top-0 left-0 right-0 z-50 max-w-md mx-auto px-4 pt-12 pb-3 flex justify-between items-center bg-gradient-to-b from-black/80 via-black/30 to-transparent">
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => setLocation("/feed")}
            className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md border border-white/12 flex items-center justify-center text-white">
            <ArrowLeft size={18} />
          </motion.button>
          <div className="flex items-center gap-2">
            <motion.button
              whileTap={{ scale: 0.9 }} onClick={refresh} disabled={isRefreshing}
              className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md border border-white/12 flex items-center justify-center text-white disabled:opacity-50"
            >
              <RefreshCw size={16} className={isRefreshing ? "animate-spin text-primary" : ""} />
            </motion.button>
            <motion.button whileTap={{ scale: 0.9 }} onClick={handleShare}
              className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md border border-white/12 flex items-center justify-center text-white">
              <Share2 size={18} />
            </motion.button>
          </div>
        </div>

        {/* ── Hero media ── */}
        <div className="w-full h-[55vh] relative bg-black">
          {isAlbum ? (
            <ImageSlider images={auction.images!} alt={auction.title} className="w-full h-full" />
          ) : (
            <div className="relative w-full h-full">
              <img
                src={auction.mediaUrl} alt={auction.title}
                className={cn("w-full h-full object-cover", state !== "active" && "opacity-80")}
              />
              {isVideo && (
                <div className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-black/50 backdrop-blur-sm border border-white/15 flex items-center justify-center text-white z-10">
                  <Play size={14} fill="white" />
                </div>
              )}
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/10 to-transparent pointer-events-none" />

          {state === "upcoming" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
              <div className="bg-black/60 backdrop-blur-md border border-amber-500/30 rounded-2xl px-6 py-4 text-center">
                <p className="text-amber-400 text-xs font-bold uppercase tracking-widest mb-1">{t("upcoming_badge")}</p>
                <p className="text-white text-2xl font-bold">{t("starts_in")} {countdownToStart}</p>
                <p className="text-white/50 text-xs mt-1">{t("bid_opens_soon")}</p>
              </div>
            </div>
          )}

          {state === "ended" && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="bg-black/60 backdrop-blur-md border border-white/15 rounded-2xl px-6 py-4 text-center">
                <p className="text-white/40 text-xs font-bold uppercase tracking-widest">{t("time_ended")}</p>
              </div>
            </div>
          )}
        </div>

        {/* ── Content ── */}
        <div className="px-5 -mt-6 relative z-10 space-y-5">

          {/* Timer + bids row */}
          <div className="flex items-center justify-between">
            <div className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border",
              timerChip.className
            )}>
              <Clock size={12} />
              {timerChip.label}
            </div>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground font-medium">
              <TrendingUp size={15} className={state === "active" ? "text-primary" : "text-white/30"} />
              {displayedBidCount} {t("bids_count")}
            </div>
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-white leading-tight">{auction.title}</h1>

          {/* Price */}
          {state === "upcoming" ? (
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-white tracking-tight">{formatPrice(auction.startingBid)}</span>
              <span className="text-sm text-muted-foreground font-medium">{t("starting_at")}</span>
            </div>
          ) : state === "ended" ? (
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-white tracking-tight">{formatPrice(displayedBid)}</span>
              <span className="text-sm text-muted-foreground font-medium">{t("final_price")}</span>
            </div>
          ) : (
            <div className="flex items-baseline gap-2 flex-wrap">
              <motion.span
                key={displayedBid}
                initial={{ scale: 1.08, color: "#a855f7" }}
                animate={{ scale: 1, color: "#ffffff" }}
                transition={{ duration: 0.4 }}
                className="text-4xl font-bold tracking-tight"
              >
                {formatPrice(displayedBid)}
              </motion.span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground font-medium">{t("current_bid")}</span>
                {isConnected && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 uppercase tracking-wide">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                    LIVE
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ── INLINE BID PANEL ─────────────────────────────────────────────── */}
          {canBid && (
            <motion.div
              ref={bidPanelRef}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="rounded-2xl bg-white/4 border border-white/10 overflow-hidden"
            >
              {/* Panel header */}
              <div className="px-4 pt-4 pb-3 flex items-center justify-between border-b border-white/8">
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide mb-0.5">Place your bid</p>
                  <p className="text-base font-bold text-white">
                    Min <span className="text-primary">{formatPrice(minBid)}</span>
                  </p>
                </div>
                <div className="flex items-center gap-1.5 bg-primary/12 border border-primary/25 rounded-full px-3 py-1.5">
                  <TrendingUp size={11} className="text-primary" />
                  <span className="text-xs font-bold text-primary">+{formatPrice(minIncrement)} min</span>
                </div>
              </div>

              {/* Quick-bid buttons grid */}
              <div className="px-4 pt-4 pb-2">
                <div className="grid grid-cols-3 gap-2.5">
                  {INCREMENTS.map((inc) => {
                    const amount = displayedBid + inc;
                    const isSelected = selectedInc === inc;
                    return (
                      <motion.button
                        key={inc}
                        whileTap={{ scale: 0.93 }}
                        onClick={() => {
                          setSelectedInc(isSelected ? null : inc);
                          setBidError(null);
                          setBidSuccess(false);
                        }}
                        className={cn(
                          "flex flex-col items-center py-3.5 rounded-xl border font-bold transition-all duration-150",
                          isSelected
                            ? "bg-primary/20 border-primary/55 text-primary shadow-[0_0_14px_-3px] shadow-primary/40"
                            : "bg-white/6 border-white/12 text-white/80 active:bg-white/10"
                        )}
                      >
                        <span className={cn(
                          "text-xs font-bold mb-1",
                          isSelected ? "text-primary/80" : "text-white/40"
                        )}>
                          +{formatPrice(inc)}
                        </span>
                        <span className="text-sm font-bold">{formatPrice(amount)}</span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {/* Confirm button + feedback */}
              <div className="px-4 pb-4 pt-2 space-y-2.5">
                <AnimatePresence mode="wait">
                  {bidSuccess ? (
                    <motion.div
                      key="success"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="w-full py-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center gap-2"
                    >
                      <Trophy size={16} className="text-emerald-400" />
                      <span className="text-sm font-bold text-emerald-400">You're the highest bidder!</span>
                    </motion.div>
                  ) : (
                    <motion.button
                      key="submit"
                      whileTap={{ scale: 0.97 }}
                      onClick={submitBid}
                      disabled={!selectedInc || isBidding}
                      className={cn(
                        "w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all duration-150",
                        selectedInc
                          ? "bg-primary text-white shadow-lg shadow-primary/35"
                          : "bg-white/6 text-white/30 border border-white/8"
                      )}
                    >
                      {isBidding ? (
                        <>
                          <RefreshCw size={15} className="animate-spin" />
                          Processing…
                        </>
                      ) : selectedInc ? (
                        <>
                          <Gavel size={15} />
                          Bid {formatPrice(bidAmount)}
                        </>
                      ) : (
                        <>
                          <ChevronDown size={15} />
                          Select an amount above
                        </>
                      )}
                    </motion.button>
                  )}
                </AnimatePresence>

                {/* Error feedback */}
                <AnimatePresence>
                  {bidError && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="text-xs text-red-400 text-center font-medium py-1"
                    >
                      ⚠ {bidError}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {/* Bidding status pill (leading / outbid) */}
          <AnimatePresence>
            {state === "active" && !isSeller && bidStatus !== "not_bidding" && (
              <motion.div
                key={bidStatus}
                initial={{ opacity: 0, y: -6, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className={cn(
                  "inline-flex items-center gap-2 self-start px-4 py-2 rounded-full border text-sm font-bold",
                  bidStatus === "leading"
                    ? "bg-emerald-500/15 border-emerald-500/35 text-emerald-400"
                    : "bg-red-500/15 border-red-500/35 text-red-400"
                )}
              >
                <span>{bidStatus === "leading" ? "🏆" : "🔴"}</span>
                <span>{bidStatus === "leading" ? `You're ${t("leading")}` : `You've been ${t("outbid").toLowerCase()}`}</span>
              </motion.div>
            )}
            {state === "active" && isSeller && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="inline-flex items-center gap-2 self-start px-4 py-2 rounded-full border border-white/12 bg-white/6 text-sm font-semibold text-white/50"
              >
                <span>🏷️</span>
                <span>Your listing</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Winner banner */}
          {winner && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 rounded-2xl bg-amber-500/10 border border-amber-500/25 px-4 py-3"
            >
              <Trophy size={20} className="text-amber-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-amber-400/70 uppercase tracking-widest">{t("winner")}</p>
                <p className="text-sm font-bold text-white leading-tight">{winner.user.name}</p>
              </div>
              <img src={winner.user.avatar} alt={winner.user.name} className="w-9 h-9 rounded-full object-cover ring-2 ring-amber-500/40 shrink-0" />
            </motion.div>
          )}

          {/* Seller card + WhatsApp */}
          <div className="rounded-2xl bg-white/5 border border-white/8 overflow-hidden">
            <div className="flex items-center gap-3 p-4">
              <img src={auction.seller.avatar} alt={auction.seller.name} className="w-11 h-11 rounded-full object-cover ring-2 ring-white/10" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white text-sm leading-none">{auction.seller.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{auction.seller.handle}</p>
              </div>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => toggleFollow(auction.seller.id)}
                className={[
                  "px-4 py-2 rounded-xl text-xs font-bold border transition-all duration-200",
                  isFollowing(auction.seller.id)
                    ? "bg-[#0ea5e9]/15 border-[#0ea5e9]/45 text-[#7dd3fc] shadow-sm shadow-[#0ea5e9]/20"
                    : "bg-white/8 border-white/15 text-white",
                ].join(" ")}
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={isFollowing(auction.seller.id) ? "on" : "off"}
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 5 }}
                    transition={{ duration: 0.14 }}
                    className="block"
                  >
                    {isFollowing(auction.seller.id) ? `✓ ${t("following")}` : `+ ${t("follow")}`}
                  </motion.span>
                </AnimatePresence>
              </motion.button>
            </div>
            <a
              href={whatsappUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2.5 w-full py-3.5 border-t border-white/8 bg-[#25D366]/12 hover:bg-[#25D366]/20 transition-colors active:scale-[0.98] group"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#25D366" className="shrink-0 drop-shadow-[0_0_6px_#25D36680]">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              <span className="text-sm font-bold text-[#25D366]">{t("whatsapp_cta")}</span>
            </a>
          </div>

          {/* Description */}
          <div>
            <h3 className="text-sm font-bold text-white/60 uppercase tracking-widest mb-2">{t("about")}</h3>
            <p className="text-[15px] text-muted-foreground leading-relaxed">{auction.description}</p>
          </div>

          {/* Bid history */}
          <div>
            <h3 className="text-sm font-bold text-white/60 uppercase tracking-widest mb-3">{t("bid_history")}</h3>
            {auction.bids.length > 0 ? (
              <div className="space-y-3">
                {auction.bids.map((bid, i) => (
                  <div key={bid.id} className="flex items-center gap-3">
                    <img src={bid.user.avatar} alt={bid.user.name} className="w-9 h-9 rounded-full object-cover" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white leading-none">{bid.user.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{formatDistanceToNow(new Date(bid.timestamp))} ago</p>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="text-sm font-bold text-white">{formatPrice(bid.amount)}</span>
                      {i === 0 && state === "active" && (
                        <span className="text-[10px] font-bold text-primary uppercase tracking-wide">{t("leading")}</span>
                      )}
                      {i === 0 && state === "ended" && (
                        <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wide">{t("winner")}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 rounded-2xl border border-dashed border-white/10 text-center">
                <p className="text-muted-foreground text-sm">
                  {state === "upcoming" ? t("bid_opens_soon") : t("no_bids")}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Sticky bottom action bar ── */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto z-40 px-4 pb-6 pt-3 bg-gradient-to-t from-background via-background/90 to-transparent">
        {state === "upcoming" ? (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => toggleWatch(auction.id)}
            className={cn(
              "w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2.5 shadow-lg transition-all duration-200",
              watching
                ? "bg-amber-500/25 border border-amber-500/50 text-amber-300 shadow-amber-500/20"
                : "bg-amber-500/20 border border-amber-500/40 text-amber-400 shadow-amber-500/15"
            )}
          >
            <Bell size={20} fill={watching ? "currentColor" : "none"} />
            {watching ? t("reminded") : t("remind_me")}
          </motion.button>
        ) : state === "ended" ? (
          <div className="w-full py-4 rounded-2xl bg-white/6 border border-white/10 flex items-center justify-center text-white/40 font-bold text-base gap-2">
            <Gavel size={20} />
            {t("auction_closed")}
          </div>
        ) : isSeller ? (
          <div className="w-full py-4 rounded-2xl bg-white/6 border border-white/10 flex items-center justify-center text-white/40 font-bold text-base gap-2">
            <span>🏷️</span>
            Your Listing
          </div>
        ) : (
          /* Scroll-to-bid shortcut — the bid panel is already visible above */
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleScrollToBid}
            className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-lg shadow-primary/30"
          >
            <Gavel size={20} />
            {selectedInc ? `Bid ${formatPrice(bidAmount)}` : t("place_bid")}
          </motion.button>
        )}
      </div>
    </MobileLayout>
  );
}
