import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Gavel, Bell, MapPin, Volume2, VolumeX, Bookmark, ThumbsUp, ThumbsDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { type Auction } from "@/lib/mock-data";
import { getWhatsAppUrl, cn, getPublicBaseUrl } from "@/lib/utils";
import { useToggleLike } from "@/hooks/use-auctions";
import { useFollow } from "@/hooks/use-follow";
import { useWatchAuction } from "@/hooks/use-watch";
import { useSaveAuction } from "@/hooks/use-save-auction";
import { useLang } from "@/contexts/LanguageContext";
import { useLiveAuctionStatus } from "@/hooks/use-countdown";
import { toast } from "@/hooks/use-toast";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useCurrentUser } from "@/hooks/use-current-user";
import { AuctionMenu } from "@/components/AuctionMenu";
import type { AuctionState } from "@/lib/utils";
import { useViewerLocation } from "@/hooks/use-viewer-location";
import { haversineDistance, formatDistance, formatAuctionPrice } from "@/lib/geo";
import { sendSignalApi, removeSignalApi, type ContentSignal } from "@/lib/api-client";

function AlbumIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="2" y="2" width="14" height="14" rx="2" fill="none" />
    </svg>
  );
}

function HeartIcon({ liked }: { liked: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      fill={liked ? "#ef4444" : "none"}
      stroke={liked ? "#ef4444" : "rgba(255,255,255,0.95)"}
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="#25D366">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
      <path d="M12 0C5.373 0 0 5.373 0 12c0 2.09.54 4.054 1.485 5.762L0 24l6.435-1.687A11.943 11.943 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.003-1.369l-.359-.214-3.72.975.994-3.631-.234-.373A9.77 9.77 0 012.182 12C2.182 6.58 6.58 2.182 12 2.182S21.818 6.58 21.818 12 17.42 21.818 12 21.818z"/>
    </svg>
  );
}

function TikTokShareIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.95)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

interface FeedCardProps {
  auction: Auction;
  isActive: boolean;
  /** True when this card is the active card or immediately adjacent (±1 position).
   *  When false, the video src is removed and buffers are released. */
  isNear: boolean;
}

// Module-level mute preference — single source of truth shared across all
// FeedCard instances.  Using a module variable avoids prop-drilling and Context
// while still giving every card the same mute state when it becomes active.
// Initialised to `true` because browser autoplay policy always starts muted.
let globalMuted = true;

export function FeedCard({ auction, isActive, isNear }: FeedCardProps) {
  const [, setLocation] = useLocation();
  const { mutate: toggleLike } = useToggleLike();
  const { isFollowing, toggle: toggleFollow } = useFollow();
  const { isWatching, toggle: toggleWatch } = useWatchAuction();
  const { isSaved, toggle: toggleSave } = useSaveAuction();
  const { t, lang } = useLang();
  const videoRef = useRef<HTMLVideoElement>(null);
  const { user: currentUser } = useCurrentUser();
  const isOwner = !!currentUser && auction.seller.id === currentUser.id;
  const viewerLoc = useViewerLocation();

  const distanceText = useMemo(() => {
    if (!viewerLoc || !auction.lat || !auction.lng) return null;
    const metres = haversineDistance(viewerLoc.lat, viewerLoc.lng, auction.lat, auction.lng);
    return formatDistance(metres, lang);
  }, [viewerLoc, auction.lat, auction.lng, lang]);

  const fmtPrice = (amount: number) =>
    formatAuctionPrice(amount, auction.currencyCode ?? "USD");

  const onStateChange = useCallback((newState: AuctionState) => {
    if (newState === "active") {
      toast({ title: "🟢 Bidding is now open!", description: `"${auction.title}" just went live — place your bid!` });
    } else if (newState === "ended") {
      toast({ title: "🏁 Auction ended", description: `"${auction.title}" has closed.` });
    }
  }, [auction.title]);

  const { state, timeInfo, countdownToStart } = useLiveAuctionStatus(auction, onStateChange);
  const whatsappUrl = getWhatsAppUrl(auction.seller.phone, auction.title);
  const following = isFollowing(auction.seller.id);
  const watching = isWatching(auction.id);
  const saved = isSaved(auction.id);
  const isVideo = auction.type === "video";

  // ── Content signal (Interested / Not Interested) ──────────────────────────
  // Initialise from the server-returned userSignal so the button state is
  // accurate on first render without a separate API round-trip.
  const [localSignal, setLocalSignal] = useState<ContentSignal | null>(
    (auction.userSignal as ContentSignal | null | undefined) ?? null,
  );

  const handleSignal = useCallback((s: ContentSignal) => {
    if (localSignal === s) {
      setLocalSignal(null);
      void removeSignalApi(auction.id);
    } else {
      setLocalSignal(s);
      void sendSignalApi(auction.id, s);
    }
  }, [localSignal, auction.id]);

  // Local state mirrors globalMuted so React re-renders the icon correctly.
  // Initialise from globalMuted so cards that mount after the user has already
  // changed the preference pick up the right value immediately.
  const [isMuted, setIsMuted] = useState(() => globalMuted);

  // When THIS card becomes active, sync to the current global preference.
  // This handles the "swipe to next/previous reel" case where the card was
  // already mounted with a now-stale local state.
  useEffect(() => {
    if (!isActive) return;
    setIsMuted(globalMuted);
  }, [isActive]);

  // Keep the video element's muted property in sync with React state.
  // This is the single place that writes to the DOM — no other effect touches it.
  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = isMuted;
  }, [isMuted]);

  // Play / pause based on active state.
  // Set el.muted from globalMuted directly here (in addition to the isMuted
  // effect above) so that when play() is called the video element already has
  // the correct muted state — avoids a one-frame window where sound state could
  // briefly mismatch while waiting for the isMuted state update to flush.
  // Reset currentTime to 0 on deactivation so swiping back always starts
  // from the beginning rather than mid-video.
  useEffect(() => {
    const el = videoRef.current;
    if (!isVideo || !el) return;
    if (isActive) {
      el.muted = globalMuted;
      el.play().catch(() => {});
    } else {
      el.pause();
      el.currentTime = 0;
    }
  }, [isActive, isVideo]);

  // Resource release: when this card is no longer near the viewport (more than
  // one card away), call el.load() to tell the browser to abort any in-flight
  // network request and release the decoded video buffer from memory.
  // React already removed the `src` attribute (src={undefined} renders no attr),
  // but load() is needed to flush the buffered data and abort the connection.
  // Safe to call even when src is not set — behaves as a no-op in that case.
  useEffect(() => {
    const el = videoRef.current;
    if (!isVideo || !el) return;
    if (!isNear) {
      el.pause();
      el.load();
    }
  }, [isNear, isVideo]);

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator.share) {
      try { await navigator.share({ title: auction.title, url: `${getPublicBaseUrl()}/auction/${auction.id}` }); }
      catch (_) {}
    }
  };

  const timerPill = (() => {
    if (state === "upcoming") {
      return { className: "bg-amber-500/20 text-amber-400 border-amber-500/30", dot: "bg-amber-400 animate-pulse", label: `${t("starts_in")} ${countdownToStart}` };
    }
    if (state === "ended") {
      return { className: "bg-white/10 text-white/50 border-white/10", dot: "bg-white/30", label: t("time_ended") };
    }
    // Active — urgent: just the countdown (colour conveys urgency).
    // Active — normal: prefix with "Active ·" so the status is explicit.
    return {
      className: timeInfo.isUrgent ? "bg-red-500/20 text-red-400 border-red-500/30" : "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
      dot: timeInfo.isUrgent ? "bg-red-400 animate-pulse" : "bg-emerald-400 animate-pulse",
      label: timeInfo.isUrgent ? timeInfo.text : `Active · ${timeInfo.text}`,
    };
  })();

  return (
    <div className="relative w-full h-[100dvh] snap-always bg-black flex flex-col overflow-hidden">

      {/* ── Full-bleed media ─────────────────────────────────────────────── */}
      {isVideo ? (
        <div className="absolute inset-0">
          <video
            ref={videoRef}
            src={isNear ? auction.mediaUrl : undefined}
            poster={auction.thumbnailUrl ?? undefined}
            className={cn("w-full h-full object-cover transition-transform duration-700", isActive ? "scale-100" : "scale-105")}
            playsInline
            preload={isActive ? "auto" : "metadata"}
            loop
            muted
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent via-35% to-black/90 pointer-events-none" />
          {state !== "active" && <div className="absolute inset-0 bg-black/25 pointer-events-none" />}
        </div>
      ) : (
        <div className="absolute inset-0 cursor-pointer" onClick={() => setLocation(`/auction/${auction.id}`)}>
          <img
            src={auction.mediaUrl} alt={auction.title}
            className={cn("w-full h-full object-cover transition-transform duration-700", isActive ? "scale-100" : "scale-105")}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent via-35% to-black/90 pointer-events-none" />
          {state !== "active" && <div className="absolute inset-0 bg-black/25 pointer-events-none" />}
        </div>
      )}

      {/* ── Top bar: timer pill (right only) ────────────────────────────── */}
      {/* Seller avatar has moved to the left action stack below. */}
      {/* paddingTop respects Android status bar / notch via safe-area-inset-top */}
      <div
        className="absolute top-0 left-0 right-0 z-20 px-4 flex items-center justify-end"
        style={{ paddingTop: "max(48px, calc(env(safe-area-inset-top, 0px) + 12px))" }}
      >
        {/* Timer pill */}
        <div className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold backdrop-blur-md border shrink-0", timerPill.className)}>
          <span className={cn("w-1.5 h-1.5 rounded-full", timerPill.dot)} />
          {timerPill.label}
        </div>
      </div>

      {/* ── Top-right utility row: album badge / mute / menu ──────────────── */}
      {/* Minimum 44dp (w-11 h-11) touch targets on all interactive controls. */}
      <div
        className="absolute right-3 z-20 flex flex-col items-end gap-2"
        style={{ top: "max(104px, calc(env(safe-area-inset-top, 0px) + 68px))" }}
      >
        {!isVideo && auction.type === "album" && (auction.images?.length ?? 0) > 1 && (
          /* Album badge — non-interactive, 32dp visual size is fine */
          <div className="w-8 h-8 rounded-lg bg-black/50 backdrop-blur-sm border border-white/15 flex items-center justify-center text-white pointer-events-none">
            <AlbumIcon size={16} />
          </div>
        )}
        {isVideo && (
          /* Mute — 44dp touch target, 18dp icon */
          <button
            onClick={(e) => { e.stopPropagation(); const next = !isMuted; globalMuted = next; setIsMuted(next); }}
            className="w-11 h-11 rounded-full bg-black/50 backdrop-blur-sm border border-white/15 flex items-center justify-center text-white active:scale-90 transition-transform"
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        )}
        {/* 3-dot menu — 44dp touch target */}
        <AuctionMenu auctionId={auction.id} auctionTitle={auction.title} mediaUrl={auction.mediaUrl} isOwner={isOwner} />
      </div>

      {/* ── LEFT action stack ─────────────────────────────────────────────── */}
      {/*   LTR direction is explicit so it never mirrors on Arabic / RTL.    */}
      {/*   Order (top → bottom = low → high product priority):               */}
      {/*     Share → Like → Follow → Save → WhatsApp → Bid                  */}
      {/*   The primary Bid CTA is at the bottom — closest to the thumb.      */}
      <div
        className="absolute left-3 bottom-36 z-20 flex flex-col items-center gap-4"
        style={{ direction: "ltr" }}
      >

        {/* 1. Share — TikTok paper-plane arrow (lowest priority, furthest from thumb) */}
        <motion.button
          whileTap={{ scale: 0.8 }}
          className="flex flex-col items-center gap-1"
          style={{ minWidth: 44, minHeight: 44 }}
          aria-label="Share this auction"
          onClick={handleShare}
        >
          <div className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-md border border-white/15 flex items-center justify-center text-white">
            <TikTokShareIcon />
          </div>
          <span className="text-[11px] font-semibold text-white/80">{t("share")}</span>
        </motion.button>

        {/* 2. Like */}
        <motion.button
          whileTap={{ scale: 0.75 }}
          className="flex flex-col items-center gap-1"
          style={{ minWidth: 44, minHeight: 44 }}
          aria-label={auction.isLikedByMe ? "Unlike" : "Like"}
          onClick={(e) => { e.stopPropagation(); toggleLike(auction.id); }}
        >
          <motion.div
            animate={auction.isLikedByMe ? { scale: [1, 1.35, 1] } : { scale: 1 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className={cn(
              "w-12 h-12 rounded-full flex items-center justify-center border backdrop-blur-md transition-colors",
              auction.isLikedByMe ? "bg-red-500/20 border-red-500/40" : "bg-black/40 border-white/15"
            )}
          >
            <HeartIcon liked={!!auction.isLikedByMe} />
          </motion.div>
          <span className="text-[11px] font-semibold text-white/80">{auction.likes}</span>
        </motion.button>

        {/* 3. Avatar + Follow ("+" badge) — hidden when viewer is owner */}
        {!isOwner && (
          <motion.button
            whileTap={{ scale: 0.88 }}
            className="relative flex flex-col items-center gap-1"
            style={{ minWidth: 44, minHeight: 44 }}
            onClick={(e) => { e.stopPropagation(); toggleFollow(auction.seller.id); }}
            aria-label={following ? "Unfollow seller" : "Follow seller"}
          >
            <div className={cn(
              "w-12 h-12 rounded-full overflow-hidden border-2 transition-all duration-200",
              following ? "border-[#0ea5e9]" : "border-white/60"
            )}>
              <UserAvatar src={auction.seller.avatar || null} name={auction.seller.name} size={48} />
            </div>
            <AnimatePresence>
              {!following && (
                <motion.div
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-[#fe2c55] border-2 border-black flex items-center justify-center z-10"
                >
                  <span className="text-white font-bold leading-none" style={{ fontSize: 12 }}>+</span>
                </motion.div>
              )}
            </AnimatePresence>
            <span className="text-[11px] font-semibold text-white/80 mt-0.5">
              {following ? "✓" : t("follow")}
            </span>
          </motion.button>
        )}

        {/* 4. Save / Bookmark */}
        <motion.button
          whileTap={{ scale: 0.8 }}
          className="flex flex-col items-center gap-1"
          style={{ minWidth: 44, minHeight: 44 }}
          aria-label={saved ? "Unsave auction" : "Save auction"}
          onClick={(e) => { e.stopPropagation(); toggleSave(auction.id); }}
        >
          <motion.div
            animate={saved ? { scale: [1, 1.2, 1] } : { scale: 1 }}
            transition={{ duration: 0.25 }}
            className={cn(
              "w-12 h-12 rounded-full flex items-center justify-center border backdrop-blur-md transition-colors",
              saved ? "bg-amber-500/20 border-amber-500/40" : "bg-black/40 border-white/15"
            )}
          >
            <Bookmark size={24} fill={saved ? "#f59e0b" : "none"} stroke={saved ? "#f59e0b" : "rgba(255,255,255,0.95)"} />
          </motion.div>
          <span className={cn("text-[11px] font-semibold", saved ? "text-amber-400" : "text-white/80")}>
            {saved ? t("saved") : t("save")}
          </span>
        </motion.button>

        {/* 5. WhatsApp / Contact — active or ended only, only when seller phone exists */}
        {(state === "active" || state === "ended") && auction.seller.phone && (
          <motion.a
            href={whatsappUrl} target="_self"
            whileTap={{ scale: 0.8 }}
            className="flex flex-col items-center gap-1"
            style={{ minWidth: 44, minHeight: 44 }}
            aria-label="Contact seller on WhatsApp"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 rounded-full bg-[#25D366]/15 backdrop-blur-md border border-[#25D366]/50 flex items-center justify-center shadow-[0_0_14px_rgba(37,211,102,0.3)]">
              <WhatsAppIcon />
            </div>
            <span className="text-[11px] font-semibold text-[#25D366]/90">WhatsApp</span>
          </motion.a>
        )}

        {/* 6. Primary CTA — Bell (upcoming) · Bid (active) · Ended indicator */}
        {/*    Bid / Bell is always at the bottom — closest to the thumb.      */}
        {state === "upcoming" ? (
          <motion.button
            whileTap={{ scale: 0.88 }}
            className="flex flex-col items-center gap-1 mt-1"
            style={{ minWidth: 44, minHeight: 44 }}
            aria-label={watching ? "Remove reminder" : "Remind me when live"}
            onClick={(e) => { e.stopPropagation(); toggleWatch(auction.id); }}
          >
            <div className={cn(
              "w-14 h-14 rounded-full flex items-center justify-center shadow-lg relative transition-all duration-200",
              watching
                ? "bg-amber-500/30 border-2 border-amber-500/60 text-amber-300 shadow-amber-500/30"
                : "bg-amber-500/20 border border-amber-500/40 text-amber-400 shadow-amber-500/20"
            )}>
              {watching && <div className="absolute -inset-1 bg-amber-500/15 rounded-full animate-ping" />}
              <Bell size={24} fill={watching ? "currentColor" : "none"} />
            </div>
            <span className={cn("text-[11px] font-bold", watching ? "text-amber-300" : "text-amber-400")}>
              {watching ? t("reminded") : t("remind_me")}
            </span>
          </motion.button>
        ) : (
          <motion.button
            whileTap={{ scale: 0.88 }}
            className="flex flex-col items-center gap-1 mt-1"
            style={{ minWidth: 44, minHeight: 44 }}
            aria-label={state === "active" ? "Place a bid" : "View ended auction"}
            onClick={(e) => { e.stopPropagation(); setLocation(`/auction/${auction.id}`); }}
          >
            <div className={cn(
              "w-14 h-14 rounded-full flex items-center justify-center text-white shadow-lg relative transition-all duration-200",
              state === "active"
                ? "bg-primary shadow-primary/40"
                : "bg-white/8 border border-white/15 shadow-none"
            )}>
              {state === "active" && <div className="absolute -inset-1 bg-primary/25 rounded-full animate-ping" />}
              <Gavel size={26} className={state === "active" ? "" : "opacity-40"} />
            </div>
            <span className={cn(
              "text-[11px] font-bold",
              state === "active" ? "text-primary" : "text-white/35"
            )}>
              {state === "active" ? t("bid") : t("ended")}
            </span>
          </motion.button>
        )}
      </div>

      {/* ── Bottom info area ───────────────────────────────────────────────── */}
      {/* left-[76px] leaves room for the 48px action stack at left-3 + gap   */}
      <div
        className="absolute bottom-36 left-[76px] right-4 z-10 flex flex-col gap-1.5 cursor-pointer"
        onClick={() => setLocation(`/auction/${auction.id}`)}
      >
        {/* Seller name — compact, above the title */}
        <span className="text-[12px] font-semibold text-white/55 leading-none truncate">
          {auction.seller.name}
          {auction.seller.handle ? (
            <span className="font-normal text-white/35"> {auction.seller.handle}</span>
          ) : null}
        </span>

        <h2 className="text-[21px] font-bold text-white leading-snug line-clamp-2 drop-shadow-sm">
          {auction.title}
        </h2>

        {state === "upcoming" ? (
          <div className="flex flex-col gap-0.5 mt-0.5">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-white tracking-tight">{fmtPrice(auction.startingBid)}</span>
              <span className="text-xs font-medium text-white/50 uppercase tracking-wide">{t("starting_at")}</span>
            </div>
            <span className="text-xs font-semibold text-amber-400">{t("bid_opens_soon")}</span>
          </div>
        ) : state === "ended" ? (
          <div className="flex flex-col gap-0.5 mt-0.5">
            <span className="text-[10px] font-bold text-white/35 uppercase tracking-widest">{t("final_price")}</span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-white tracking-tight">{fmtPrice(auction.currentBid)}</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 mt-0.5">
            <span className="text-[10px] font-bold text-emerald-400/80 uppercase tracking-widest">{t("current_bid")}</span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-white tracking-tight">{fmtPrice(auction.currentBid)}</span>
              <span className="text-xs font-medium text-white/50">{auction.bidCount} {t("bids_count")}</span>
            </div>
          </div>
        )}

        {distanceText && (
          <div className="flex items-center gap-1 mt-0.5">
            <MapPin size={11} className="text-white/40 shrink-0" />
            <span className="text-[11px] font-medium text-white/40">{distanceText}</span>
          </div>
        )}
      </div>

      {/* ── Signal strip: Interested / Not Interested ─────────────────────── */}
      {/* Uses calc() with env(safe-area-inset-bottom) so it always clears the  */}
      {/* BottomNav (~92px standard, ~106px on iPhone with home indicator).     */}
      <div
        className="absolute left-0 right-0 z-20 flex gap-2.5 px-4"
        style={{ bottom: "calc(76px + env(safe-area-inset-bottom, 20px))" }}
      >
        <motion.button
          whileTap={{ scale: 0.93 }}
          onClick={(e) => { e.stopPropagation(); handleSignal("not_interested"); }}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-2xl border text-xs font-semibold backdrop-blur-md transition-colors",
            localSignal === "not_interested"
              ? "bg-red-500/25 border-red-500/50 text-red-300"
              : "bg-black/40 border-white/15 text-white/55"
          )}
        >
          <ThumbsDown size={13} />
          {lang === "ar" ? "غير مهتم" : "Not Interested"}
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.93 }}
          onClick={(e) => { e.stopPropagation(); handleSignal("interested"); }}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-2xl border text-xs font-semibold backdrop-blur-md transition-colors",
            localSignal === "interested"
              ? "bg-emerald-500/25 border-emerald-500/50 text-emerald-300"
              : "bg-black/40 border-white/15 text-white/55"
          )}
        >
          <ThumbsUp size={13} />
          {lang === "ar" ? "مهتم" : "Interested"}
        </motion.button>
      </div>
    </div>
  );
}
