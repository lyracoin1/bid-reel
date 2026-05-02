import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import {
  ArrowLeft, ArrowDown, Clock, TrendingUp, Gavel,
  Bell, Trophy, RefreshCw, ChevronDown, MapPin, Volume2, VolumeX, Eye,
  ShieldAlert, CheckCircle2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { ImageSlider } from "@/components/feed/ImageSlider";
import { UserAvatar } from "@/components/ui/user-avatar";
import { AuctionMenu } from "@/components/AuctionMenu";
import { useAuction, usePlaceBid, useBuyAuction, useMarkSold } from "@/hooks/use-auctions";
import { useFollow } from "@/hooks/use-follow";
import { useWatchAuction } from "@/hooks/use-watch";
import { useBidPolling, getUserBidStatus } from "@/hooks/use-bid-polling";
import { useRealtimeBids } from "@/hooks/use-realtime-bids";
import { useCurrentUser } from "@/hooks/use-current-user";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { useOverlayBack } from "@/hooks/use-overlay-back";
import { getWhatsAppUrl, cn } from "@/lib/utils";
import { useLang } from "@/contexts/LanguageContext";
import { useLiveAuctionStatus } from "@/hooks/use-countdown";
import { toast } from "@/hooks/use-toast";
import type { AuctionState } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useViewerLocation } from "@/hooks/use-viewer-location";
import { haversineDistance, formatDistance, formatAuctionPrice } from "@/lib/geo";
import { useGlobalMute, getGlobalMuted } from "@/lib/global-mute";
import { BillingPlugin } from "capacitor-billing";
import { API_BASE, getToken } from "@/lib/api-client";
// ─── Google Play subscription purchase flow ───────────────────────────────────
// Triggered when the user taps "Subscribe now" after hitting the premium gate.
// Flow: querySkuDetails → launchBillingFlow → sendAck → backend verify.
async function startSubscription(userId: string): Promise<void> {
  // Guard: user must be authenticated before any billing call.
  if (!userId) {
    console.error("Billing: cannot start purchase — user is not authenticated");
    return;
  }

  try {
    // 1. Confirm the product is available in the Play Store.
    await BillingPlugin.querySkuDetails({ product: "bidreel_plus", type: "SUBS" });

    // 2. Launch the native Google Play purchase dialog.
    const result = await BillingPlugin.launchBillingFlow({ product: "bidreel_plus", type: "SUBS" });

    const purchaseToken = result.value;
    if (!purchaseToken) {
      console.error("Billing: no purchase token returned");
      return;
    }

    // 3. Verify with backend FIRST — never acknowledge before server confirms.
const token = await getToken();
if (!token) {
  console.error("Billing: cannot verify purchase — missing auth token");
  return;
}

const response = await fetch(`${API_BASE}/billing/verify`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ userId, productId: "bidreel_plus", purchaseToken }),
});

let json: { success?: boolean } = {};
try { json = await response.json() as { success?: boolean }; } catch { /* non-JSON body */ }

if (!response.ok || !json.success) {
  // Do NOT acknowledge — token remains pending and can be retried.
  console.error("Billing: backend verification failed", response.status);
  return;
}

    // 4. Only acknowledge after backend has confirmed and granted premium.
    await BillingPlugin.sendAck({ purchaseToken });
  } catch (err) {
    // Never log purchaseToken in the error — it is bearer-equivalent.
    console.error("Billing error", (err as Error).message);
  }
}

// Minimum bid increment is read per-auction from `auction.minIncrement`,
// which is mapped from the server's `min_increment` column in
// `backendToAuction`. The server validates again (routes/auctions.ts
// → executePlaceBid) so this stays a UI floor only.

// ─── First-bid rules gate ─────────────────────────────────────────────────────
// localStorage key — set to "1" when the user accepts the bidding rules and
// confirms their first bid. Once set, the modal never shows again. Skip
// dismisses without setting the flag, so it re-prompts next time.
const BIDDING_RULES_KEY = "bidreel_bidding_rules_accepted";

const BIDDING_RULES = [
  { icon: "🤝", titleKey: "rule_1_title", bodyKey: "rule_1_body" },
  { icon: "👥", titleKey: "rule_2_title", bodyKey: "rule_2_body" },
  { icon: "🔍", titleKey: "rule_3_title", bodyKey: "rule_3_body" },
  { icon: "⚠️", titleKey: "rule_4_title", bodyKey: "rule_4_body" },
  { icon: "🚫", titleKey: "rule_5_title", bodyKey: "rule_5_body" },
] as const;

export default function AuctionDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { data: auction, refetch: refetchAuction } = useAuction(id || "");

  // ── Bid state ──────────────────────────────────────────────────────────────
  // The user enters ONLY the increment (e.g. "1", "50", "100").
  // Server computes new_price = current_price + increment.
  const [incInput, setIncInput] = useState<string>("");
  const [bidError, setBidError] = useState<string | null>(null);
  const [premiumRequired, setPremiumRequired] = useState(false);
  const [bidSuccess, setBidSuccess] = useState(false);
  const [showBiddingRulesModal, setShowBiddingRulesModal] = useState(false);
  const bidPanelRef = useRef<HTMLDivElement>(null);

  // Android hardware back closes the bidding-rules modal first.
  useOverlayBack(showBiddingRulesModal, () => setShowBiddingRulesModal(false));

  const { mutate: placeBid, isPending: isBidding } = usePlaceBid({
    onSuccess: () => {
      setBidSuccess(true);
      setBidError(null);
      setPremiumRequired(false);
      // Reset after 2.5 s so panel is ready for the next bid. Re-seed the
      // input with the per-auction minimum so the default value always
      // equals min_increment (requirement: input default = min_increment).
      setTimeout(() => {
        setBidSuccess(false);
        if (auction) setIncInput(String(auction.minIncrement));
      }, 2500);
    },
    onError: (code, message) => {
      if (code === "PREMIUM_REQUIRED") {
        setPremiumRequired(true);
        setBidError(lang === "ar" ? "اشترك لتتمكن من المزايدة" : "Subscribe to place bids");
        return;
      }
      setPremiumRequired(false);
      setBidError(message);
      // BID_CONFLICT = someone else bid between the time we fetched the page
      // and the time we clicked Submit. The server rolled back our bid row;
      // refetch the auction so the UI shows the new highest price + bids,
      // and clear the typed increment so the user re-enters with fresh context.
      if (code === "BID_CONFLICT") {
        // Re-seed with the per-auction minimum (not blank) so the default
        // value invariant holds after a conflict-driven reset.
        if (auction) setIncInput(String(auction.minIncrement));
        void refetchAuction();
        // The inline bid panel is now the only place the error is shown
        // (we removed the duplicate in the sticky bar). If the user submitted
        // from the sticky confirm CTA while scrolled to the bottom, the error
        // would be off-screen — scroll the panel into view so the message is
        // always discoverable.
        requestAnimationFrame(() => {
          bidPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    },
  });

  // ── Other hooks (must be unconditional — Rules of Hooks) ──────────────────
  const { user: currentUser } = useCurrentUser();
  const { isFollowing, toggle: toggleFollow } = useFollow();
  const { isWatching, toggle: toggleWatch } = useWatchAuction();
  const { t, lang, dir } = useLang();
  const viewerLoc = useViewerLocation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // True once the video element fires onLoadedData — used to hide the
  // thumbnail overlay. Reset to false whenever the auction changes so
  // the thumbnail shows again while the new video is fetching its first frame.
  const [videoHasData, setVideoHasData] = useState(false);
  const { isRefreshing, refresh } = useBidPolling();
  const { pullDistance, pullProgress, isRefreshing: isPulling } =
    usePullToRefresh(scrollRef, refresh);
  const showPullIndicator = pullDistance > 4 || isPulling;
  const { realtimeCurrentBid, realtimeBidCount, isConnected } =
    useRealtimeBids(id ?? "", auction?.bidCount ?? 0);

  // ── Video: GLOBAL mute state + autoplay on mount ─────────────────────────
  // Shared with feed via `@/lib/global-mute` (persisted to localStorage).
  const [isMuted, setMuted] = useGlobalMute();

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = isMuted;
  }, [isMuted]);

  useEffect(() => {
    if (!auction || auction.type !== "video") return;
    const el = videoRef.current;
    if (!el) return;
    // Reset thumbnail overlay whenever we switch to a different auction.
    setVideoHasData(false);
    // Use latest global value at play() time to avoid one-frame mismatch.
    el.muted = getGlobalMuted();
    el.play().catch(() => {});

    const handleError = () =>
      console.error(`[AuctionDetail] Video error for "${auction.id}":`, el.error);
    el.addEventListener("error", handleError);
    return () => el.removeEventListener("error", handleError);
  }, [auction?.id, auction?.type]);

  // Pause video when the media stage scrolls off-screen; resume when it
  // returns. Prevents audio + network buffering from continuing while the
  // user reads the bid history at the bottom of the page.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || auction?.type !== "video") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          el.play().catch(() => {});
        } else {
          el.pause();
        }
      },
      { threshold: 0.25 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [auction?.id, auction?.type]);

  // ── Seed the bid-increment input with the per-auction floor ──────────────
  // Once the auction loads we pre-fill the input with `min_increment` (from
  // the backend) so the user can submit immediately at the smallest valid
  // step. We only seed while the input is still empty so we never clobber
  // what the user has typed, and we re-seed when navigating to a different
  // auction (different `auction.id`).
  useEffect(() => {
    if (!auction) return;
    setIncInput((prev) => (prev === "" ? String(auction.minIncrement) : prev));
  }, [auction?.id, auction?.minIncrement]);

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

  // ── Distance (unconditional — Rules of Hooks) ──────────────────────────
  const distanceText = useMemo(() => {
    if (!viewerLoc || !auction?.lat || !auction?.lng) return null;
    const metres = haversineDistance(viewerLoc.lat, viewerLoc.lng, auction.lat!, auction.lng!);
    return formatDistance(metres, lang);
  }, [viewerLoc, auction?.lat, auction?.lng, lang]);

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
  // Bids arrive from the server in chronological order (created_at ASC).
  // The "highest" bid is the one with max amount — derived independently so
  // it stays correct regardless of list position. Ties broken by latest index.
  const highestBidIndex = auction.bids.length === 0
    ? -1
    : auction.bids.reduce(
        (bestIdx, b, i, arr) => (b.amount >= arr[bestIdx].amount ? i : bestIdx),
        0,
      );
  const highestBid = highestBidIndex >= 0 ? auction.bids[highestBidIndex] : null;
  const winner = state === "ended" && highestBid ? highestBid : null;
  const isAlbum = auction.type === "album" && (auction.images?.length ?? 0) > 1;
  const isVideo = auction.type === "video";
  const isSeller = !!currentUser && auction.seller.id === currentUser.id;
  const topBidUserId = highestBid?.user.id;
  const bidStatus = getUserBidStatus(auction.id, topBidUserId);

  // ── WhatsApp visibility logic ─────────────────────────────────────────────
  const canSeeWhatsApp = useMemo(() => {
    if (!currentUser) return true;
    if (currentUser.isPremium) return true;
    const usedBids = currentUser.bidsPlacedCount ?? 0;
    const remainingFreeBids = Math.max(0, 5 - usedBids);
    return remainingFreeBids > 0;
  }, [currentUser]);

  // Reconcile realtime override with the latest server state.
  // Using `Math.max` guarantees that *whichever source is fresher* wins —
  // critical after a BID_CONFLICT refetch, because `realtimeCurrentBid` is
  // sticky in `useRealtimeBids` and would otherwise shadow the fresh value
  // from `refetchAuction()` if the realtime channel is disconnected.
  const displayedBid = Math.max(realtimeCurrentBid ?? 0, auction.currentBid);
  const displayedBidCount = Math.max(realtimeBidCount ?? 0, auction.bidCount);

  const fmtPrice = (amount: number) =>
    formatAuctionPrice(amount, auction.currencyCode ?? "USD");

  // Per-auction floor sourced from the backend (`min_increment` column,
  // default 1 server-side). Never hardcode a number here.
  const minIncrement = auction.minIncrement;

  // Parse the user's increment input. Returns null when invalid.
  const parsedInc = (() => {
    const trimmed = incInput.trim();
    if (!trimmed) return null;
    if (!/^\d+$/.test(trimmed)) return null;   // integers only
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < minIncrement) return null;
    return n;
  })();

  // Live preview of resulting price (current + increment).
  const previewAmount = parsedInc !== null ? displayedBid + parsedInc : null;

  const handleScrollToBid = () => {
    bidPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // Submit handler — validates input, then either opens the first-bid rules
  // modal or sends the bid straight to the server. Once the user has accepted
  // the rules once on this device, the modal never re-prompts (Skip preserves
  // the modal next time so the user is given another chance).
  const submitBid = () => {
    setBidError(null);
    setPremiumRequired(false);
    if (parsedInc === null) {
      setBidError(`Please enter a whole number ≥ ${minIncrement}`);
      return;
    }
    if (!localStorage.getItem(BIDDING_RULES_KEY)) {
      setShowBiddingRulesModal(true);
      return;
    }
    // Send the increment — the server computes the new price itself.
    placeBid(auction.id, parsedInc);
  };

  // Confirms the rules and submits the queued bid in one step.
  const acceptBiddingRulesAndSubmit = () => {
    if (parsedInc === null) {
      setShowBiddingRulesModal(false);
      return;
    }
    localStorage.setItem(BIDDING_RULES_KEY, "1");
    setShowBiddingRulesModal(false);
    placeBid(auction.id, parsedInc);
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

  // ── Sale-type / availability ──────────────────────────────────────────────
  // saleType defaults to "auction" so legacy rows (no sale_type) keep working.
  const saleType = auction.saleType ?? "auction";
  const isFixedPrice = saleType === "fixed";
  const isSold = auction.status === "sold";
  const isReserved = auction.status === "reserved";

  // ── Can the current user bid? ─────────────────────────────────────────────
  // Bidding only applies to live auctions; fixed-price uses Buy Now instead.
  const canBid = state === "active" && !isSeller && !isFixedPrice && !isSold && !isReserved;

  // ── Buy Now (fixed-price) hook ────────────────────────────────────────────
  const { mutate: buyNow, isPending: isBuying } = useBuyAuction(auction.id);

  // ── Mark-as-sold (seller-only, fixed-price) hook ──────────────────────────
  // Sellers often close fixed-price listings out-of-band (e.g. WhatsApp DM).
  // The CTA flips status='active'→'sold' so the listing stops accepting Buy
  // Now from other viewers. Server enforces seller-only + fixed-only.
  const { mutate: markSold, isPending: isMarkingSold } = useMarkSold(auction.id);
  const handleMarkSold = useCallback(() => {
    const msg =
      lang === "ar"
        ? "هل أنت متأكد أنك تريد وضع علامة 'مباع' على هذا الإعلان؟ لن يتمكن المشترون من شرائه بعد ذلك."
        : "Mark this listing as sold? Buyers will no longer be able to purchase it.";
    if (!window.confirm(msg)) return;
    markSold({
      onSuccess: () => {
        toast({ title: lang === "ar" ? "تم وضع علامة مباع." : "Marked as sold." });
      },
      onError: (_code, message) => {
        toast({ title: message, variant: "destructive" });
      },
    });
  }, [markSold, lang]);

  const handleBuyNow = useCallback(() => {
    if (!window.confirm(t("buy_now_confirm"))) return;
    buyNow({
      onSuccess: () => {
        toast({ title: t("buy_now_success") });
        void refetchAuction();
      },
      onError: (_code, message) => {
        toast({ title: message, variant: "destructive" });
        void refetchAuction();
      },
    });
  }, [buyNow, t, refetchAuction]);

  return (
    <MobileLayout showNav noPadding>
      <div
        ref={scrollRef}
        className="relative w-full min-h-[100dvh] bg-background pb-[200px] overflow-y-auto"
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
            <AuctionMenu
              auctionId={auction.id}
              auctionTitle={auction.title}
              isOwner={isSeller}
              onDeleted={() => setLocation("/feed")}
            />
          </div>
        </div>

        {/* ── Hero media ──
            Container is a fixed-height (55vh) black letterbox stage. Media
            uses `object-contain` so the real aspect ratio of the video/image
            is preserved — never cropped, never stretched. The `bg-black`
            background fills the unused area on either axis (top/bottom for
            landscape media in a portrait stage, sides for portrait media in
            a wider stage). Works in mobile Safari, Chrome and Capacitor's
            Android WebView (object-fit is supported back to WebView 53+).

            Note: feed cards intentionally use `object-cover` for the
            TikTok-style full-bleed fill — that is a different surface and
            stays as-is. */}
        <div className="w-full h-[55vh] relative bg-black flex items-center justify-center overflow-hidden">
          {isAlbum ? (
            <ImageSlider images={auction.images!} alt={auction.title} className="w-full h-full" />
          ) : isVideo ? (
            <>
              {/* Thumbnail overlay — visible until the video fires onLoadedData.
                  Prevents a flash of black while preload="metadata" fetches the
                  first frame. Uses object-contain to match the video's letterbox
                  treatment. The video sits above (relative z-10) and replaces it
                  visually once its data is ready. */}
              {auction.thumbnailUrl && !videoHasData && (
                <img
                  src={auction.thumbnailUrl}
                  aria-hidden
                  className="absolute inset-0 w-full h-full object-contain"
                />
              )}
              <video
                ref={videoRef}
                src={auction.mediaUrl}
                // max-w-full max-h-full: constrain to the flex stage without
                // relying on `object-fit`, which is silently ignored for
                // <video> in some Capacitor / Android WebView versions.
                // The flex parent (`items-center justify-center`) centres the
                // element; `bg-black` on the container provides letterbox bars.
                // relative z-10: stack above the absolute thumbnail overlay.
                className={cn(
                  "max-w-full max-h-full relative z-10",
                  state !== "active" && "opacity-80",
                )}
                playsInline
                preload="metadata"
                loop
                muted
                onLoadedData={() => setVideoHasData(true)}
              />
              {/* Mute / unmute control */}
              <button
                onClick={() => setMuted(!isMuted)}
                className="absolute bottom-4 right-4 z-30 w-10 h-10 rounded-full bg-black/55 backdrop-blur-sm border border-white/15 flex items-center justify-center text-white active:scale-90 transition-transform"
                aria-label={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
            </>
          ) : (
            <img
              src={auction.mediaUrl} alt={auction.title}
              className={cn(
                "max-w-full max-h-full",
                state !== "active" && "opacity-80",
              )}
            />
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
        <div className="px-5 -mt-6 relative z-10 space-y-6">

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

          {/* Title · Price · Distance — grouped as one tight block */}
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-white leading-tight">{auction.title}</h1>

            {state === "upcoming" ? (
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold text-white tracking-tight">{fmtPrice(auction.startingBid)}</span>
                <span className="text-sm text-muted-foreground font-medium">{t("starting_at")}</span>
              </div>
            ) : state === "ended" ? (
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold text-white tracking-tight">{fmtPrice(displayedBid)}</span>
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
                  {fmtPrice(displayedBid)}
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

            <div className="flex items-center gap-4 pt-0.5">
              {distanceText && (
                <div className="flex items-center gap-1.5">
                  <MapPin size={13} className="text-white/35 shrink-0" />
                  <span className="text-[13px] font-medium text-white/40">{distanceText}</span>
                </div>
              )}
              {(auction.views ?? 0) > 0 && (
                <div className="flex items-center gap-1.5" aria-label={`${auction.views} views`}>
                  <Eye size={13} className="text-white/35 shrink-0" />
                  <span className="text-[13px] font-medium text-white/40 tabular-nums">
                    {auction.views!.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>

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
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide mb-0.5">How much to add?</p>
                  <p className="text-base font-bold text-white">
                    Now <span className="text-white/60">{fmtPrice(displayedBid)}</span>
                    {previewAmount !== null ? (
                      <> → <span className="text-primary">{fmtPrice(previewAmount)}</span></>
                    ) : null}
                  </p>
                </div>
                {/* Quick-action chip: tap to pre-fill the input with the
                    per-auction minimum increment from the backend. */}
                <button
                  type="button"
                  onClick={() => { setIncInput(String(minIncrement)); setBidError(null); setPremiumRequired(false); }}
                  disabled={isBidding}
                  className="flex items-center gap-1.5 bg-primary/12 hover:bg-primary/20 active:bg-primary/25 border border-primary/25 rounded-full px-3 py-1.5 transition-colors disabled:opacity-50"
                  aria-label={`Set increment to minimum ${minIncrement} ${auction.currencyCode ?? ""}`}
                >
                  <TrendingUp size={11} className="text-primary" />
                  <span className="text-xs font-bold text-primary">
                    +{minIncrement} {auction.currencyCode ?? ""}
                  </span>
                </button>
              </div>

              {/* Numeric increment input */}
              <div className="px-4 pt-4 pb-2">
                <label htmlFor="bid-increment" className="block text-[11px] font-medium text-white/50 uppercase tracking-wide mb-2">
                  Increment amount
                </label>
                <div className="flex items-stretch gap-2">
                  <div className="flex-1 flex items-center bg-white/6 border border-white/15 rounded-xl px-3 focus-within:border-primary/60 transition-colors">
                    <span className="text-white/40 font-bold text-base shrink-0 select-none">+</span>
                    <input
                      id="bid-increment"
                      type="number"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      min={minIncrement}
                      step={minIncrement}
                      value={incInput}
                      onChange={(e) => {
                        // Allow only digits; empty string is allowed for clearing.
                        const v = e.target.value.replace(/[^\d]/g, "");
                        setIncInput(v);
                        setBidError(null);
                        setPremiumRequired(false);
                        setBidSuccess(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitBid();
                      }}
                      placeholder={String(minIncrement)}
                      disabled={isBidding}
                      className="flex-1 bg-transparent py-3.5 px-2 text-white text-lg font-bold outline-none placeholder:text-white/25 disabled:opacity-50"
                      aria-label="Bid increment"
                    />
                    <span className="text-xs font-medium text-white/35 shrink-0 select-none">
                      {auction.currencyCode ?? "USD"}
                    </span>
                  </div>
                </div>
                {/* Live preview */}
                <div className="mt-2 min-h-[18px] text-xs">
                  {previewAmount !== null ? (
                    <span className="text-white/55">
                      New price → <span className="text-primary font-bold">{fmtPrice(previewAmount)}</span>
                    </span>
                  ) : incInput.trim() ? (
                    <span className="text-red-400/80">Enter a whole number ≥ {minIncrement}</span>
                  ) : (
                    <span className="text-white/30">Type how much to add to the current price</span>
                  )}
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
                      <span className="text-sm font-bold text-emerald-400">{t("you_are_highest_bidder")}</span>
                    </motion.div>
                  ) : (
                    <motion.button
                      key="submit"
                      whileTap={{ scale: 0.97 }}
                      onClick={submitBid}
                      disabled={parsedInc === null || isBidding}
                      className={cn(
                        "w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all duration-150",
                        parsedInc !== null
                          ? "bg-primary text-white shadow-lg shadow-primary/35"
                          : "bg-white/6 text-white/30 border border-white/8"
                      )}
                    >
                      {isBidding ? (
                        <>
                          <RefreshCw size={15} className="animate-spin" />
                          Processing…
                        </>
                      ) : parsedInc !== null && previewAmount !== null ? (
                        <>
                          <Gavel size={15} />
                          Raise +{fmtPrice(parsedInc)} → {fmtPrice(previewAmount)}
                        </>
                      ) : (
                        <>
                          <ChevronDown size={15} />
                          Enter an amount to bid
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
                {/* Subscribe button — shown only for PREMIUM_REQUIRED errors */}
                {premiumRequired && bidError && (
                  <div className="flex justify-center pt-1">
                    <button
                      onClick={() => { void startSubscription(currentUser?.id ?? ""); }}
                      className="text-xs font-semibold text-blue-400 border border-blue-400/40 rounded-full px-3 py-1 hover:bg-blue-400/10 transition-colors"
                    >
                      {lang === "ar" ? "اشترك الآن" : "Subscribe now"}
                    </button>
                  </div>
                )}
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

          {/* Winner banner — tap to view winner's profile */}
          {winner && (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => setLocation(`/users/${winner.user.id}`)}
              className="w-full text-left flex items-center gap-3 rounded-2xl bg-amber-500/10 border border-amber-500/25 px-4 py-3 active:scale-[0.99] transition-transform"
              aria-label={`View ${winner.user.name}'s profile`}
            >
              <Trophy size={20} className="text-amber-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-amber-400/70 uppercase tracking-widest">{t("winner")}</p>
                <p className="text-sm font-bold text-white leading-tight">{winner.user.name}</p>
              </div>
              <UserAvatar src={winner.user.avatar || null} name={winner.user.name} size={36} className="ring-2 ring-amber-500/40 shrink-0" />
            </motion.button>
          )}

          {/* Seller card + WhatsApp */}
          <div className="rounded-2xl bg-white/5 border border-white/8 overflow-hidden">
            <div className="flex items-center gap-3 p-4">
              <button
                type="button"
                onClick={() => setLocation(`/users/${auction.seller.id}`)}
                className="flex items-center gap-3 flex-1 min-w-0 text-left active:scale-[0.99] transition-transform"
                aria-label={`View ${auction.seller.name}'s profile`}
              >
                <UserAvatar src={auction.seller.avatar || null} name={auction.seller.name} size={44} className="ring-2 ring-white/10 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white text-sm leading-none truncate">{auction.seller.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{auction.seller.handle}</p>
                </div>
              </button>
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
            {/* WhatsApp contact — active or ended only, not upcoming */}
            {(state === "active" || state === "ended") && auction.seller.phone && canSeeWhatsApp && (
              <a
                href={whatsappUrl} target="_self"
                className="flex flex-col items-center gap-0.5 w-full py-3.5 border-t border-white/8 bg-[#25D366]/12 hover:bg-[#25D366]/20 transition-colors active:scale-[0.98]"
              >
                <div className="flex items-center justify-center gap-2.5">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#25D366" className="shrink-0 drop-shadow-[0_0_6px_#25D36680]">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                  </svg>
                  <span className="text-sm font-bold text-[#25D366]">{t("whatsapp_cta")}</span>
                </div>
                {state === "ended" && (
                  <span className="text-[10px] text-[#25D366]/50 font-medium">
                    {t("contact_seller_ended_hint")}
                  </span>
                )}
              </a>
            )}
          </div>

          {/* Description */}
          <div>
            <h3 className="text-sm font-bold text-white/60 uppercase tracking-widest mb-2">{t("about")}</h3>
            <p className="text-[15px] text-muted-foreground leading-relaxed">{auction.description}</p>
          </div>

          {/* Bid history — server returns bids in chronological order
              (created_at ASC). Render newest-first for scannability, but
              compute the rank from the chronological position so #1 is
              always the very first bid placed on this auction. */}
          <div>
            <h3 className="text-sm font-bold text-white/60 uppercase tracking-widest mb-3">{t("bid_history")}</h3>
            {auction.bids.length > 0 ? (
              <div className="space-y-1">
                {auction.bids.map((bid, chronoIdx) => {
                  const rank = chronoIdx + 1;
                  const isHighest = chronoIdx === highestBidIndex;
                  const isMe = !!currentUser && bid.user.id === currentUser.id;
                  return { bid, chronoIdx, rank, isHighest, isMe };
                })
                  .slice()
                  .reverse()
                  .map(({ bid, rank, isHighest, isMe }) => (
                    <button
                      type="button"
                      key={bid.id}
                      onClick={() => setLocation(`/users/${bid.user.id}`)}
                      className="w-full flex items-center gap-3 py-2 px-1 -mx-1 rounded-xl text-left active:bg-white/5 active:scale-[0.99] transition"
                      aria-label={`View ${bid.user.name}'s profile`}
                    >
                      <span className="w-7 text-xs font-bold text-white/40 tabular-nums shrink-0 text-center">
                        #{rank}
                      </span>
                      <UserAvatar src={bid.user.avatar || null} name={bid.user.name} size={36} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white leading-none truncate">
                          {isMe ? t("you") : bid.user.name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {bid.timestamp && new Date(bid.timestamp).getFullYear() > 2000
                            ? `${formatDistanceToNow(new Date(bid.timestamp))} ago`
                            : "recently"}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        <span className="text-sm font-bold text-white">{fmtPrice(bid.amount)}</span>
                        {isHighest && state === "active" && (
                          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wide">{t("leading")}</span>
                        )}
                        {isHighest && state === "ended" && (
                          <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wide">{t("winner")}</span>
                        )}
                      </div>
                    </button>
                  ))}
              </div>
            ) : (
              <div className="py-8 rounded-2xl border border-dashed border-white/10 text-center">
                <p className="text-muted-foreground text-sm">
                  {state === "upcoming"
                    ? t("bid_opens_soon")
                    : state === "ended"
                    ? "No bids were placed"
                    : t("no_bids")}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Sticky bottom action bar ──
          pointer-events-none on the outer gradient wrapper so the transparent
          top portion does NOT intercept vertical swipes on the scroll container
          below. pointer-events-auto on the inner div restores interaction for
          all the buttons/inputs. This is the fix for "can't scroll back up". */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto z-[60] px-4 pb-[88px] pt-4 bg-gradient-to-t from-background via-background/96 to-transparent pointer-events-none">
        <div className="pointer-events-auto">
        {/* Sold / Reserved take precedence over every other state — once the
            listing is claimed it cannot be acted on, regardless of sale type. */}
        {isSold ? (
          <div className="w-full py-4 rounded-2xl bg-white/6 border border-white/10 flex items-center justify-center text-white/40 font-bold text-base gap-2">
            <CheckCircle2 size={18} className="text-white/40" />
            {t("sold")}
          </div>
        ) : isReserved ? (
          <div className="w-full py-4 rounded-2xl bg-amber-500/12 border border-amber-500/30 flex items-center justify-center text-amber-300 font-bold text-base gap-2">
            <Clock size={18} />
            {t("reserved")}
          </div>
        ) : isFixedPrice && state === "active" && !isSeller ? (
          /* Fixed-price listings: single Buy Now button replaces the bidding UI. */
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleBuyNow}
            disabled={isBuying}
            className="w-full py-4 rounded-2xl bg-emerald-500 text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-500/35 disabled:opacity-60"
          >
            {isBuying ? (
              <><RefreshCw size={17} className="animate-spin" /> {t("buy_now")}…</>
            ) : (
              <>
                {t("buy_now")} · {fmtPrice(auction.fixedPrice ?? auction.startingBid)}
              </>
            )}
          </motion.button>
        ) : state === "upcoming" ? (
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
          /* Seller view of their own listing. For active fixed-price
             listings we expose a "Mark as Sold" CTA so the seller can
             close the listing manually after handing the item off via
             WhatsApp. Auctions close themselves on the timer, so the
             non-fixed branch shows the read-only "Your Listing" pill. */
          isFixedPrice && state === "active" && !isSold ? (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleMarkSold}
              disabled={isMarkingSold}
              className="w-full py-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 font-bold text-base flex items-center justify-center gap-2.5 disabled:opacity-60"
            >
              {isMarkingSold ? (
                <><RefreshCw size={17} className="animate-spin" /> {lang === "ar" ? "جارٍ..." : "Working…"}</>
              ) : (
                <>{lang === "ar" ? "وضع علامة كمباع" : "Mark as Sold"}</>
              )}
            </motion.button>
          ) : (
            <div className="w-full py-4 rounded-2xl bg-white/6 border border-white/10 flex items-center justify-center text-white/40 font-bold text-base gap-2">
              <span>🏷️</span>
              {isSold ? (lang === "ar" ? "تم البيع" : "Sold") : "Your Listing"}
            </div>
          )
        ) : (
          /* ── Active + can bid: sticky CTA → scrolls to numeric input panel ── */
          <AnimatePresence mode="wait">
            {bidSuccess ? (
              <motion.div
                key="sticky-success"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="w-full py-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center gap-2"
              >
                <Trophy size={18} className="text-emerald-400" />
                <span className="text-sm font-bold text-emerald-400">{t("you_are_highest_bidder")}</span>
              </motion.div>
            ) : parsedInc !== null && previewAmount !== null ? (
              /* Valid amount typed → confirm bid right from sticky bar */
              <motion.div
                key="sticky-confirm"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex gap-2.5"
              >
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  onClick={() => { setIncInput(""); setBidError(null); }}
                  className="flex-shrink-0 px-4 py-4 rounded-2xl bg-white/8 border border-white/12 text-white/60 font-bold text-sm"
                  aria-label="Clear amount"
                >
                  ✕
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={submitBid}
                  disabled={isBidding}
                  className="flex-1 py-4 rounded-2xl bg-primary text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-lg shadow-primary/35 disabled:opacity-60"
                >
                  {isBidding ? (
                    <><RefreshCw size={17} className="animate-spin" /> Processing…</>
                  ) : (
                    <><Gavel size={18} /> Bid +{fmtPrice(parsedInc)} → {fmtPrice(previewAmount)}</>
                  )}
                </motion.button>
              </motion.div>
            ) : (
              /* Nothing typed → CTA scrolls to numeric input above */
              <motion.div
                key="sticky-cta"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {/* Bid error is rendered inline in the numeric input panel
                    above (search for bidError near the input) — do NOT also
                    render it here, or the user sees two identical banners. */}
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleScrollToBid}
                  className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-lg shadow-primary/35"
                >
                  <Gavel size={18} />
                  {t("place_bid") || "Place a bid"}
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        )}
        </div>
      </div>

      {/* ── First-bid rules gate modal ────────────────────────────────────── */}
      <AnimatePresence>
        {showBiddingRulesModal && (
          <>
            <motion.div
              key="br-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setShowBiddingRulesModal(false)}
              className="fixed inset-0 z-[9000] bg-black/75 backdrop-blur-sm"
            />
            <motion.div
              key="br-sheet"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 220 }}
              className="fixed bottom-0 left-0 right-0 z-[9001] bg-[#0e0e1a] border-t border-white/10 rounded-t-3xl max-h-[92dvh] overflow-y-auto"
              dir={dir}
            >
              <div className="flex justify-center pt-3 pb-1 shrink-0">
                <div className="w-10 h-1 rounded-full bg-white/20" />
              </div>
              <div className="px-5 pt-4 pb-5 border-b border-white/8">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
                    <ShieldAlert size={22} className="text-amber-400" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white leading-tight mb-0.5">
                      {t("bidding_rules_title")}
                    </h2>
                    <p className="text-xs text-white/45">{t("bidding_rules_subtitle")}</p>
                  </div>
                </div>
              </div>
              <div className="px-5 py-4 space-y-2.5">
                {BIDDING_RULES.map((rule, i) => (
                  <motion.div
                    key={rule.titleKey}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: 0.05 * i }}
                    className="flex items-start gap-3.5 p-4 rounded-2xl bg-white/4 border border-white/8"
                  >
                    <span className="text-xl leading-none mt-0.5 shrink-0">{rule.icon}</span>
                    <div>
                      <p className="text-sm font-bold text-white mb-1">{t(rule.titleKey)}</p>
                      <p className="text-[13px] text-white/55 leading-relaxed">{t(rule.bodyKey)}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
              <div className="px-5 pb-10 pt-3 space-y-2">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={acceptBiddingRulesAndSubmit}
                  className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-base shadow-lg shadow-primary/30 flex items-center justify-center gap-2"
                  data-testid="button-bidding-rules-confirm"
                >
                  <CheckCircle2 size={18} />
                  {t("bidding_rules_confirm")}
                </motion.button>
                <button
                  onClick={() => setShowBiddingRulesModal(false)}
                  className="w-full py-3 text-sm text-white/45 hover:text-white/70 transition-colors"
                  data-testid="button-bidding-rules-skip"
                >
                  {t("rules_skip")}
                </button>
                {/* No "view full rules" link here — the modal already shows
                    all five rules above. Routing away to /safety-rules would
                    unmount the auction-detail page and lose the user's typed
                    bid increment. The full page is still reachable any time
                    from Hamburger menu → Safety & Rules. */}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </MobileLayout>
  );
}
