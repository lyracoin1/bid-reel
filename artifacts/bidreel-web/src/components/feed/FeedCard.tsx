import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { useLocation } from "wouter";
import { Gavel, Bell, MapPin, Volume2, VolumeX, Bookmark, ThumbsUp, ThumbsDown, Eye, ShoppingBag, CheckCircle2, Users, X, Link2, ChevronLeft, ChevronRight, Music } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { type Auction } from "@/lib/mock-data";
import { cn, getPublicBaseUrl } from "@/lib/utils";
import { useToggleLike } from "@/hooks/use-auctions";
import { useFollow } from "@/hooks/use-follow";
import { useWatchAuction } from "@/hooks/use-watch";
import { useSaveAuction } from "@/hooks/use-save-auction";
import { useLang } from "@/contexts/LanguageContext";
import { useLiveAuctionStatus } from "@/hooks/use-countdown";
import { toast } from "@/hooks/use-toast";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useCurrentUser } from "@/hooks/use-current-user";
import { AuctionMenu } from "@/components/AuctionMenu";
import type { AuctionState } from "@/lib/utils";
import { useViewerLocation } from "@/hooks/use-viewer-location";
import { haversineDistance, formatDistance, formatAuctionPrice } from "@/lib/geo";
import { sendSignalApi, removeSignalApi, shareToFollowersApi, type ContentSignal } from "@/lib/api-client";
import { useViewTracker } from "@/hooks/use-view-tracker";
import { useGlobalMute, getGlobalMuted } from "@/lib/global-mute";
import { TrustBadge } from "@/components/trust/TrustBadge";
import { useUserTrust } from "@/hooks/use-user-trust";
import { ImageSlider } from "@/components/feed/ImageSlider";

function SellerTrust({ sellerId }: { sellerId: string }) {
  const { trust } = useUserTrust(sellerId);
  if (!trust) return null;
  return (
    <TrustBadge
      score={trust.final_seller_score}
      color={trust.final_seller_color}
      size="xs"
      className="shrink-0"
    />
  );
}

/** Compact view-count formatter. 1234 → "1.2K", 1_234_567 → "1.2M". */
function formatViewCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0).replace(/\.0$/, "")}M`;
}

/** Single image with a visible placeholder on load error. */
function MediaImageWithFallback({ src, alt, className }: { src: string; alt: string; className: string }) {
  const [error, setError] = useState(false);
  if (error || !src) {
    return (
      <div className={cn("flex items-center justify-center bg-zinc-900", className)}>
        <span className="text-xs text-white/30">Media unavailable</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => setError(true)}
    />
  );
}

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

// Global mute is owned by `@/lib/global-mute` (persisted to localStorage,
// shared with auction-detail). Each FeedCard subscribes via `useGlobalMute()`.

function FeedCard({ auction, isActive, isNear }: FeedCardProps) {
  const [, setLocation] = useLocation();
  const { mutate: toggleLike } = useToggleLike();
  const { isFollowing, toggle: toggleFollow } = useFollow();
  const { isWatching, toggle: toggleWatch } = useWatchAuction();
  const { isSaved, toggle: toggleSave } = useSaveAuction();
  const { t, lang } = useLang();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [videoError, setVideoError] = useState(false);

  // Reset video-error state whenever this card displays a different auction.
  // Guards against stale error state if the component is reused without remounting.
  useEffect(() => {
    setVideoError(false);
  }, [auction.id]);

  const { user: currentUser } = useCurrentUser();
  const isOwner = !!currentUser && auction.seller.id === currentUser.id;
  const viewerLoc = useViewerLocation();

  // ── WhatsApp visibility logic ─────────────────────────────────────────────
  // Free users are limited to 5 bids per month. Hide the WhatsApp contact
  // button once they hit that limit to encourage upgrading to Premium.
  // Logic:
  //   - If Premium → show
  //   - If Free AND remaining bids > 0 → show
  //   - Else → hide
  const canSeeWhatsApp = useMemo(() => {
    if (!currentUser) return true; // Show for guest (they'll be prompted to login/premium anyway)
    if (currentUser.isPremium) return true;
    const usedBids = currentUser.bidsPlacedCount ?? 0;
    const remainingFreeBids = Math.max(0, 5 - usedBids);
    return remainingFreeBids > 0;
  }, [currentUser]);

  const distanceText = useMemo(() => {
    if (!viewerLoc || !auction.lat || !auction.lng) return null;
    const metres = haversineDistance(viewerLoc.lat, viewerLoc.lng, auction.lat, auction.lng);
    return formatDistance(metres, lang);
  }, [viewerLoc, auction.lat, auction.lng, lang]);

  const fmtPrice = useMemo(
    () => (amount: number) => formatAuctionPrice(amount, auction.currencyCode ?? "USD"),
    [auction.currencyCode],
  );

  const onStateChange = useCallback((newState: AuctionState) => {
    if (newState === "active") {
      toast({ title: "🟢 Bidding is now open!", description: `"${auction.title}" just went live — place your bid!` });
    } else if (newState === "ended") {
      toast({ title: "🏁 Auction ended", description: `"${auction.title}" has closed.` });
    }
  }, [auction.title]);

  const { state, timeInfo, countdownToStart } = useLiveAuctionStatus(auction, onStateChange);

  // ── Sale-type / availability ──────────────────────────────────────────────
  // Fixed-price listings replace the bid CTA with a Buy Now button. Once a
  // listing's status is sold/reserved we lock the card regardless of state.
  const saleType = auction.saleType ?? "auction";
  const isFixedPrice = saleType === "fixed";
  const isSold = auction.status === "sold";
  const isReserved = auction.status === "reserved";
  const displayPrice = isFixedPrice
    ? (auction.fixedPrice ?? auction.startingBid)
    : auction.currentBid;
  const following = isFollowing(auction.seller.id);
  const watching = isWatching(auction.id);
  const saved = isSaved(auction.id);
  const isVideo = auction.type === "video";
  const isProcessing = auction.type === "processing";
  const isAudio = auction.type === "audio" || isProcessing;

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

  // ── View tracking ─────────────────────────────────────────────────────────
  // Measures real on-screen watch time only while this card is the active
  // (centred) one in the feed AND the tab is visible. Reports raw ms to the
  // server on every transition out of active / on tab hide / on page unload.
  // The server decides what counts as a qualified view (≥2s + 30-min dedupe).
  useViewTracker({ auctionId: auction.id, active: isActive, source: "feed" });

  // Global mute — shared across all videos, persisted to localStorage.
  const [isMuted, setMuted] = useGlobalMute();

  // Keep the video/audio element's muted property in sync with global state.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = isMuted;
    if (audioRef.current) audioRef.current.muted = isMuted;
  }, [isMuted]);

  // Play / pause based on active state. Read latest mute via `getGlobalMuted()`
  // so the very first play() uses the up-to-date preference even if the
  // subscriber hasn't flushed yet (avoids a one-frame mismatch).
  useEffect(() => {
    const el = videoRef.current;
    if (!isVideo || !el) return;
    if (isActive) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [isActive, isVideo]);

  // IntersectionObserver to pause/play based on visibility
  useEffect(() => {
    const el = videoRef.current;
    if (!isVideo || !el || !isActive) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.play().catch(() => {});
        } else {
          el.pause();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
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

  // Audio — play/pause based on active state.
  useEffect(() => {
    const el = audioRef.current;
    if (!isAudio || !el) return;
    if (isActive) {
      el.muted = getGlobalMuted();
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [isActive, isAudio]);

  // Audio — release buffer when card is far from viewport.
  useEffect(() => {
    const el = audioRef.current;
    if (!isAudio || !el) return;
    if (!isNear) {
      el.pause();
      el.load();
    }
  }, [isNear, isAudio]);

  const handleShare = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const shareUrl = `${getPublicBaseUrl()}/auction/${auction.id}`;
    const isAr = lang === "ar";
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({ title: auction.title, text: auction.title, url: shareUrl, dialogTitle: isAr ? "مشاركة المزاد" : "Share auction" });
        return;
      }
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title: auction.title, text: auction.title, url: shareUrl });
        return;
      }
      // Desktop fallback: copy link
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const ta = document.createElement("textarea");
        ta.value = shareUrl;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      toast({ title: isAr ? "تم نسخ الرابط" : "Link copied" });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      toast({ title: isAr ? "تعذّر المشاركة" : "Could not share", variant: "destructive" });
    }
  }, [auction.id, auction.title, lang]);

  const [sharingToFollowers, setSharingToFollowers] = useState(false);
  const [showShareSheet, setShowShareSheet] = useState(false);

  const handleShareToFollowers = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (sharingToFollowers) return;
    const isAr = lang === "ar";
    setSharingToFollowers(true);
    try {
      await shareToFollowersApi(auction.id);
      toast({ title: isAr ? "تمت المشاركة مع متابعيك" : "Shared with your followers" });
    } catch {
      toast({ title: isAr ? "تعذّر المشاركة" : "Could not share", variant: "destructive" });
    } finally {
      setSharingToFollowers(false);
    }
  }, [sharingToFollowers, auction.id, lang]);

  // Copy-link only — used as the tertiary fallback option inside the share sheet.
  const handleCopyLink = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowShareSheet(false);
    const shareUrl = `${getPublicBaseUrl()}/auction/${auction.id}`;
    const isAr = lang === "ar";
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const ta = document.createElement("textarea");
        ta.value = shareUrl;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      toast({ title: isAr ? "تم نسخ الرابط" : "Link copied" });
    } catch {
      toast({ title: isAr ? "تعذّر النسخ" : "Could not copy", variant: "destructive" });
    }
  }, [auction.id, lang]);

  const handleOpenProfile = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setLocation(`/users/${auction.seller.id}`);
  }, [setLocation, auction.seller.id]);

  const handleWhatsApp = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!auction.seller.phone) return;
    const digits = auction.seller.phone.replace(/\D/g, "");
    if (!digits) return;
    const text = `Hi, I'm interested in your BidReel auction: "${auction.title}"`;
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }, [auction.seller.phone, auction.title]);

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
          {/* Thumbnail rendered as a separate img so CSS object-cover applies
              correctly while the video is loading. The browser's native
              <video poster> does not honour object-fit in most engines, which
              causes the poster to appear letterboxed or stretched instead of
              filling the card. This img is hidden once the video has data. */}
          {auction.thumbnailUrl && (
            <img
              src={auction.thumbnailUrl}
              aria-hidden
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}
          {videoError ? (
            /* Graceful fallback: video failed to load — show cover image(s) */
            (auction.images?.length ?? 0) > 0 ? (
              <ImageSlider images={auction.images!} alt={auction.title} className="absolute inset-0 w-full h-full" />
            ) : auction.thumbnailUrl ? (
              <img src={auction.thumbnailUrl} alt={auction.title} className="absolute inset-0 w-full h-full object-cover" />
            ) : null
          ) : (
            <video
              ref={videoRef}
              src={isNear ? auction.mediaUrl : undefined}
              className={cn("absolute inset-0 w-full h-full object-cover transition-transform duration-700", isActive ? "scale-100" : "scale-105")}
              playsInline
              preload="metadata"
              loop
              muted
              onError={() => setVideoError(true)}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent via-35% to-black/90 pointer-events-none" />
          {state !== "active" && <div className="absolute inset-0 bg-black/25 pointer-events-none" />}
        </div>
      ) : isAudio ? (
        /* ── Audio auction ────────────────────────────────────────────────── */
        /* Show cover image(s) with ImageSlider; play audio separately.       */
        <div className="absolute inset-0" onClick={() => setLocation(`/auction/${auction.id}`)}>
          <div className={cn("absolute inset-0 transition-transform duration-700", isActive ? "scale-100" : "scale-105")}>
            {(auction.images?.length ?? 0) > 0 ? (
              <ImageSlider images={auction.images!} alt={auction.title} className="w-full h-full" />
            ) : (
              /* No cover image — dark placeholder with music note */
              <div className="w-full h-full bg-gradient-to-br from-purple-950/80 via-background to-background flex items-center justify-center">
                <Music size={72} className="text-primary/30" />
              </div>
            )}
          </div>
          {/* Hidden audio element — controlled by play/pause effects above */}
          <audio
            ref={audioRef}
            src={isNear ? (auction.audioUrl ?? auction.mediaUrl) : undefined}
            loop
            playsInline
            preload="none"
          />
          {isProcessing && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none">
              <div className="flex items-center gap-2 bg-black/70 backdrop-blur-sm rounded-full px-3 py-1.5 border border-white/15">
                <div className="w-3 h-3 rounded-full border-2 border-white/50 border-t-transparent animate-spin" />
                <span className="text-[11px] font-semibold text-white/60">Processing…</span>
              </div>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent via-35% to-black/90 pointer-events-none" />
          {state !== "active" && <div className="absolute inset-0 bg-black/25 pointer-events-none" />}
        </div>
      ) : auction.type === "album" && (auction.images?.length ?? 0) > 1 ? (
        <div className="absolute inset-0" onClick={() => setLocation(`/auction/${auction.id}`)}>
          <div className={cn("absolute inset-0 transition-transform duration-700", isActive ? "scale-100" : "scale-105")}>
            <ImageSlider images={auction.images!} alt={auction.title} className="w-full h-full" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent via-35% to-black/90 pointer-events-none" />
          {state !== "active" && <div className="absolute inset-0 bg-black/25 pointer-events-none" />}
        </div>
      ) : (
        /* ── Single image / image / failed ────────────────────────────────── */
        <div className="absolute inset-0 cursor-pointer" onClick={() => setLocation(`/auction/${auction.id}`)}>
          {auction.type === "failed" ? (
            <div className="w-full h-full bg-zinc-950 flex flex-col items-center justify-center gap-3">
              <span className="text-3xl select-none">⚠️</span>
              <span className="text-xs text-white/40">Media unavailable</span>
            </div>
          ) : (
            <MediaImageWithFallback
              src={auction.mediaUrl}
              alt={auction.title}
              className={cn("w-full h-full object-cover transition-transform duration-700", isActive ? "scale-100" : "scale-105")}
            />
          )}
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
        {/* Album badge: show only for single-image albums (multi-image gets an
            inline count badge from the carousel, making this icon redundant). */}
        {!isVideo && !isAudio && auction.type === "album" && (auction.images?.length ?? 0) === 1 && (
          <div className="w-8 h-8 rounded-lg bg-black/50 backdrop-blur-sm border border-white/15 flex items-center justify-center text-white pointer-events-none">
            <AlbumIcon size={16} />
          </div>
        )}
        {/* Music badge — identifies audio auctions that have no cover image count */}
        {isAudio && (auction.images?.length ?? 0) <= 1 && (
          <div className="w-8 h-8 rounded-lg bg-black/50 backdrop-blur-sm border border-white/15 flex items-center justify-center text-primary/90 pointer-events-none">
            <Music size={15} />
          </div>
        )}
        {(isVideo || isAudio) && (
          /* Mute — 44dp touch target, 18dp icon */
          <button
            onClick={(e) => { e.stopPropagation(); setMuted(!isMuted); }}
            className="w-11 h-11 rounded-full bg-black/50 backdrop-blur-sm border border-white/15 flex items-center justify-center text-white active:scale-90 transition-transform"
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        )}
        {/* 3-dot menu — 44dp touch target */}
        <AuctionMenu
          auctionId={auction.id}
          auctionTitle={auction.title}
          isOwner={isOwner}
          currentSignal={localSignal}
          onSignal={handleSignal}
        />
      </div>

      {/* ── LEFT action stack ─────────────────────────────────────────────── */}
      {/*   LTR direction is explicit so it never mirrors on Arabic / RTL.    */}
      {/*   Order (top → bottom):                                             */}
      {/*     Avatar (+follow) → Like → WhatsApp → Save → Share → Bid        */}
      {/*   The primary Bid CTA is at the bottom — closest to the thumb.      */}
      {/*   bottom uses env(safe-area-inset-bottom) so the stack always clears */}
      {/*   the signal strip (96px base) + strip height (44px) + 36px margin. */}
      <div
        className="absolute left-3 z-20 flex flex-col items-center gap-4"
        style={{ direction: "ltr", bottom: "calc(11rem + env(safe-area-inset-bottom, 0px))" }}
      >

        {/* 1. Avatar — tap navigates to profile. "+" badge toggles follow. */}
        <div className="relative flex flex-col items-center gap-1" style={{ minWidth: 44 }}>
          <motion.button
            whileTap={{ scale: 0.88 }}
            onClick={handleOpenProfile}
            aria-label={`Open ${auction.seller.name}'s profile`}
            className="relative"
            style={{ minWidth: 44, minHeight: 44 }}
          >
            <div className={cn(
              "w-12 h-12 rounded-full overflow-hidden border-2 transition-all duration-200",
              following ? "border-[#0ea5e9]" : "border-white/60"
            )}>
              <UserAvatar src={auction.seller.avatar || null} name={auction.seller.name} size={48} />
            </div>
          </motion.button>
          {!isOwner && (
            <AnimatePresence>
              {!following && (
                <motion.button
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  whileTap={{ scale: 0.85 }}
                  transition={{ duration: 0.15 }}
                  onClick={(e) => { e.stopPropagation(); toggleFollow(auction.seller.id); }}
                  aria-label={t("aria_follow_seller")}
                  className="absolute top-9 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-[#fe2c55] border-2 border-black flex items-center justify-center z-10"
                >
                  <span className="text-white font-bold leading-none" style={{ fontSize: 12 }}>+</span>
                </motion.button>
              )}
            </AnimatePresence>
          )}
          {!isOwner && following && (
            <button
              onClick={(e) => { e.stopPropagation(); toggleFollow(auction.seller.id); }}
              className="text-[11px] font-semibold text-[#0ea5e9] mt-0.5"
            >
              ✓
            </button>
          )}
        </div>

        {/* 2. Like */}
        <motion.button
          whileTap={{ scale: 0.75 }}
          className="flex flex-col items-center gap-1"
          style={{ minWidth: 44, minHeight: 44 }}
          aria-label={auction.isLikedByMe ? t("aria_unlike") : t("aria_like")}
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

        {/* 3. WhatsApp / Contact — visible whenever seller has a phone number */}
        {auction.seller.phone && canSeeWhatsApp && (
          <motion.button
            whileTap={{ scale: 0.8 }}
            className="flex flex-col items-center gap-1"
            style={{ minWidth: 44, minHeight: 44 }}
            aria-label={t("aria_contact_whatsapp")}
            onClick={handleWhatsApp}
          >
            <div className="w-12 h-12 rounded-full bg-[#25D366]/15 backdrop-blur-md border border-[#25D366]/50 flex items-center justify-center shadow-[0_0_14px_rgba(37,211,102,0.3)]">
              <WhatsAppIcon />
            </div>
            <span className="text-[11px] font-semibold text-[#25D366]/90">WhatsApp</span>
          </motion.button>
        )}

        {/* 4. Save / Bookmark */}
        <motion.button
          whileTap={{ scale: 0.8 }}
          className="flex flex-col items-center gap-1"
          style={{ minWidth: 44, minHeight: 44 }}
          aria-label={saved ? t("aria_unsave_auction") : t("aria_save_auction")}
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

        {/* 5. Share — opens in-app share sheet */}
        <motion.button
          whileTap={{ scale: 0.8 }}
          className="flex flex-col items-center gap-1"
          style={{ minWidth: 44, minHeight: 44 }}
          aria-label={t("aria_share_auction")}
          onClick={(e) => { e.stopPropagation(); setShowShareSheet(true); }}
        >
          <div className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-md border border-white/15 flex items-center justify-center text-white">
            <TikTokShareIcon />
          </div>
          <span className="text-[11px] font-semibold text-white/80">{t("share")}</span>
        </motion.button>

        {/* 6. Primary CTA — Bell (upcoming) · Bid (active) · Ended indicator */}
        {/*    Bid / Bell is always at the bottom — closest to the thumb.      */}
        {state === "upcoming" ? (
          <motion.button
            whileTap={{ scale: 0.88 }}
            className="flex flex-col items-center gap-1 mt-1"
            style={{ minWidth: 44, minHeight: 44 }}
            aria-label={watching ? t("aria_remove_reminder") : t("aria_remind_me")}
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
        ) : isSold || isReserved ? (
          /* Sold / Reserved badge replaces the action button — listing is locked. */
          <motion.button
            whileTap={{ scale: 0.88 }}
            className="flex flex-col items-center gap-1 mt-1"
            style={{ minWidth: 44, minHeight: 44 }}
            aria-label={isSold ? t("sold") : t("reserved")}
            onClick={(e) => { e.stopPropagation(); setLocation(`/auction/${auction.id}`); }}
          >
            <div className={cn(
              "w-14 h-14 rounded-full flex items-center justify-center shadow-none border transition-all duration-200",
              isSold
                ? "bg-white/8 border-white/15 text-white/40"
                : "bg-amber-500/15 border-amber-500/35 text-amber-300",
            )}>
              {isSold ? <CheckCircle2 size={24} /> : <Bell size={22} />}
            </div>
            <span className={cn(
              "text-[11px] font-bold uppercase tracking-wide",
              isSold ? "text-white/40" : "text-amber-300",
            )}>
              {isSold ? t("sold") : t("reserved")}
            </span>
          </motion.button>
        ) : isFixedPrice ? (
          /* Fixed-price listing → Buy Now CTA. Tap navigates to detail to confirm. */
          <motion.button
            whileTap={{ scale: 0.88 }}
            className="flex flex-col items-center gap-1 mt-1"
            style={{ minWidth: 44, minHeight: 44 }}
            aria-label={t("aria_buy_now")}
            onClick={(e) => { e.stopPropagation(); setLocation(`/auction/${auction.id}`); }}
          >
            <div className={cn(
              "w-14 h-14 rounded-full flex items-center justify-center text-white shadow-lg relative transition-all duration-200",
              state === "active"
                ? "bg-emerald-500 shadow-emerald-500/40"
                : "bg-white/8 border border-white/15 shadow-none",
            )}>
              {state === "active" && <div className="absolute -inset-1 bg-emerald-500/25 rounded-full animate-ping" />}
              <ShoppingBag size={24} className={state === "active" ? "" : "opacity-40"} />
            </div>
            <span className={cn(
              "text-[11px] font-bold",
              state === "active" ? "text-emerald-400" : "text-white/35",
            )}>
              {state === "active" ? t("buy_now") : t("ended")}
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
      {/* bottom mirrors action stack so title/price always align with stack.  */}
      <div
        className="absolute left-[76px] right-4 z-10 flex flex-col gap-1.5 cursor-pointer"
        style={{ bottom: "calc(11rem + env(safe-area-inset-bottom, 0px))" }}
        onClick={() => setLocation(`/auction/${auction.id}`)}
      >
        {/* Seller name + trust badge — tap navigates to seller's profile */}
        <div className="flex items-center gap-1.5 max-w-full">
          <button
            onClick={handleOpenProfile}
            className="text-[12px] font-semibold text-white/70 leading-none truncate text-left hover:text-white transition-colors min-w-0"
            aria-label={`View ${auction.seller.name}'s profile`}
          >
            {auction.seller.name}
            {auction.seller.handle ? (
              <span className="font-normal text-white/40"> {auction.seller.handle}</span>
            ) : null}
          </button>
          <SellerTrust sellerId={auction.seller.id} />
        </div>

        <h2 className="text-[21px] font-bold text-white leading-snug line-clamp-2 drop-shadow-sm">
          {auction.title}
        </h2>

        {isFixedPrice ? (
          /* Fixed-price listings always show the flat price + Buy Now label,
             plus a Sold/Reserved suffix if applicable. */
          <div className="flex flex-col gap-0.5 mt-0.5">
            <span className={cn(
              "text-[10px] font-bold uppercase tracking-widest",
              isSold ? "text-white/35" : isReserved ? "text-amber-400/80" : "text-emerald-400/80",
            )}>
              {isSold ? t("sold") : isReserved ? t("reserved") : t("buy_now")}
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-white tracking-tight">{fmtPrice(displayPrice)}</span>
            </div>
          </div>
        ) : state === "upcoming" ? (
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

        <div className="flex items-center gap-3 mt-0.5">
          {distanceText && (
            <div className="flex items-center gap-1">
              <MapPin size={11} className="text-white/40 shrink-0" />
              <span className="text-[11px] font-medium text-white/40">{distanceText}</span>
            </div>
          )}
          {/* Public views (qualified). Hidden for ≤0 to avoid showing "0 views"
              on brand-new auctions that haven't been seen yet. */}
          {(auction.views ?? 0) > 0 && (
            <div className="flex items-center gap-1" aria-label={`${auction.views} views`}>
              <Eye size={11} className="text-white/40 shrink-0" />
              <span className="text-[11px] font-medium text-white/40 tabular-nums">
                {formatViewCount(auction.views!)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Signal strip: Interested / Not Interested ─────────────────────── */}
      {/* env(safe-area-inset-bottom, 0px): returns 0px on standard devices   */}
      {/* (the 0px fallback only applies to browsers not supporting env()).    */}
      {/* Standard: 96px (4px above 92px nav). iPhone: 130px (24px above nav) */}
      {/* Action stack sits at calc(11rem + safe-area) = 176-210px, giving    */}
      {/* 36px of clearance above this strip's top edge (140-174px) on all    */}
      {/* devices — signal strip never overlaps the nav or the action stack.  */}
      <div
        className="absolute left-0 right-0 z-20 flex gap-2.5 px-4"
        style={{ bottom: "calc(96px + env(safe-area-inset-bottom, 0px))" }}
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

      {/* ── Share sheet ──────────────────────────────────────────────────── */}
      {/* Opens when the Share button is tapped. Backdrop closes it.        */}
      <AnimatePresence>
        {showShareSheet && (
          <>
            {/* Backdrop */}
            <motion.div
              key="share-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 z-40 bg-black/50"
              onClick={(e) => { e.stopPropagation(); setShowShareSheet(false); }}
            />

            {/* Sheet */}
            <motion.div
              key="share-sheet"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="absolute bottom-0 left-0 right-0 z-50 bg-[#111] border-t border-white/10 rounded-t-2xl overflow-hidden"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/8">
                <span className="text-sm font-semibold text-white/80">
                  {lang === "ar" ? "مشاركة" : "Share"}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowShareSheet(false); }}
                  className="w-7 h-7 flex items-center justify-center rounded-full bg-white/10 text-white/60 active:bg-white/20"
                  aria-label="Close share menu"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Option 1 — Share via device apps (native sheet) */}
              <button
                className="w-full flex items-center gap-4 px-5 py-4 text-white active:bg-white/5"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowShareSheet(false);
                  void handleShare(e);
                }}
              >
                <div className="w-10 h-10 rounded-full bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
                  <TikTokShareIcon />
                </div>
                <span className="text-sm font-medium">
                  {lang === "ar" ? "مشاركة عبر التطبيقات" : "Share via apps"}
                </span>
              </button>

              {/* Option 2 — Share to followers */}
              <button
                className="w-full flex items-center gap-4 px-5 py-4 text-white active:bg-white/5 disabled:opacity-50"
                disabled={sharingToFollowers}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowShareSheet(false);
                  void handleShareToFollowers(e);
                }}
              >
                <div className="w-10 h-10 rounded-full bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
                  {sharingToFollowers
                    ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    : <Users size={18} />
                  }
                </div>
                <span className="text-sm font-medium">
                  {lang === "ar" ? "متابعيني" : "Share to my followers"}
                </span>
              </button>

              {/* Option 3 — Copy link (fallback) */}
              <button
                className="w-full flex items-center gap-4 px-5 py-4 pb-6 text-white active:bg-white/5"
                onClick={handleCopyLink}
              >
                <div className="w-10 h-10 rounded-full bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
                  <Link2 size={18} />
                </div>
                <span className="text-sm font-medium">
                  {lang === "ar" ? "نسخ الرابط" : "Copy link"}
                </span>
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export default memo(FeedCard);
