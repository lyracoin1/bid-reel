import { useLocation } from "wouter";
import { Share2, MessageCircle, Gavel, Play } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { type Auction } from "@/lib/mock-data";
import { getTimeRemaining, getWhatsAppUrl, cn } from "@/lib/utils";
import { useToggleLike } from "@/hooks/use-auctions";
import { useFollow } from "@/hooks/use-follow";
import { useLang } from "@/contexts/LanguageContext";

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
    <svg width="22" height="22" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      fill={liked ? "#ef4444" : "none"}
      stroke={liked ? "#ef4444" : "rgba(255,255,255,0.95)"}
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

interface FeedCardProps {
  auction: Auction;
  isActive: boolean;
}

export function FeedCard({ auction, isActive }: FeedCardProps) {
  const [, setLocation] = useLocation();
  const { mutate: toggleLike } = useToggleLike();
  const { isFollowing, toggle: toggleFollow } = useFollow();
  const { t, formatPrice } = useLang();
  const timeInfo = getTimeRemaining(auction.endsAt);
  const whatsappUrl = getWhatsAppUrl(auction.seller.phone, auction.title);
  const following = isFollowing(auction.seller.id);

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator.share) {
      try { await navigator.share({ title: auction.title, url: window.location.href }); }
      catch (_) {}
    }
  };

  return (
    <div className="relative w-full h-[100dvh] snap-always bg-black flex flex-col overflow-hidden">

      {/* Full-bleed image */}
      <div className="absolute inset-0 cursor-pointer" onClick={() => setLocation(`/auction/${auction.id}`)}>
        <img
          src={auction.mediaUrl}
          alt={auction.title}
          className={cn("w-full h-full object-cover transition-transform duration-700", isActive ? "scale-100" : "scale-105")}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent via-40% to-black/95 pointer-events-none" />
      </div>

      {/* ── Post type indicator (top-right corner of image) ── */}
      <div className="absolute top-14 right-3 z-20">
        {auction.type === "video" ? (
          <div className="w-8 h-8 rounded-lg bg-black/50 backdrop-blur-sm border border-white/15 flex items-center justify-center text-white">
            <Play size={14} fill="white" />
          </div>
        ) : auction.type === "album" && (auction.images?.length ?? 0) > 1 ? (
          <div className="w-8 h-8 rounded-lg bg-black/50 backdrop-blur-sm border border-white/15 flex items-center justify-center text-white">
            <AlbumIcon size={16} />
          </div>
        ) : null}
      </div>

      {/* ── Top bar: seller pill + Follow + timer ── */}
      <div className="absolute top-0 left-0 right-0 z-10 pt-12 px-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            className="flex items-center gap-2.5 bg-black/40 backdrop-blur-md border border-white/10 rounded-full pl-1 pr-3 py-1 active:scale-95 transition-transform shrink-0"
            onClick={(e) => { e.stopPropagation(); setLocation(`/auction/${auction.id}`); }}
          >
            <img src={auction.seller.avatar} alt={auction.seller.name} className="w-7 h-7 rounded-full object-cover" />
            <span className="text-sm font-semibold text-white leading-none">{auction.seller.handle}</span>
          </button>

          {/* Follow button */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={(e) => { e.stopPropagation(); toggleFollow(auction.seller.id); }}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-bold border backdrop-blur-md transition-all duration-200 shrink-0",
              following
                ? "bg-[#0ea5e9]/15 border-[#0ea5e9]/45 text-[#7dd3fc] shadow-sm shadow-[#0ea5e9]/20"
                : "bg-black/40 border-white/20 text-white"
            )}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={following ? "following" : "follow"}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.15 }}
                className="block"
              >
                {following ? `✓ ${t("following")}` : `+ ${t("follow")}`}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        </div>

        <div className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold backdrop-blur-md border shrink-0",
          timeInfo.isEnded
            ? "bg-white/10 text-white/50 border-white/10"
            : timeInfo.isUrgent
            ? "bg-red-500/20 text-red-400 border-red-500/30"
            : "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
        )}>
          <span className={cn("w-1.5 h-1.5 rounded-full",
            timeInfo.isEnded ? "bg-white/30" : timeInfo.isUrgent ? "bg-red-400 animate-pulse" : "bg-emerald-400"
          )} />
          {timeInfo.isEnded ? t("time_ended") : timeInfo.text}
        </div>
      </div>

      {/* ── Right action bar ── */}
      <div className="absolute right-3 bottom-36 z-20 flex flex-col items-center gap-5">

        {/* Like */}
        <motion.button
          whileTap={{ scale: 0.75 }}
          className="flex flex-col items-center gap-1.5"
          onClick={(e) => { e.stopPropagation(); toggleLike(auction.id); }}
        >
          <motion.div
            animate={auction.isLikedByMe ? { scale: [1, 1.3, 1] } : { scale: 1 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className={cn(
              "w-12 h-12 rounded-full flex items-center justify-center border backdrop-blur-md transition-colors",
              auction.isLikedByMe
                ? "bg-red-500/20 border-red-500/40"
                : "bg-black/40 border-white/15"
            )}
          >
            <HeartIcon liked={!!auction.isLikedByMe} />
          </motion.div>
          <span className="text-[11px] font-semibold text-white/80">{auction.likes}</span>
        </motion.button>

        {/* Share */}
        <motion.button whileTap={{ scale: 0.8 }} className="flex flex-col items-center gap-1.5" onClick={handleShare}>
          <div className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-md border border-white/15 flex items-center justify-center text-white">
            <Share2 size={20} />
          </div>
          <span className="text-[11px] font-semibold text-white/80">{t("share")}</span>
        </motion.button>

        {/* WhatsApp */}
        <motion.a
          href={whatsappUrl} target="_blank" rel="noopener noreferrer"
          whileTap={{ scale: 0.8 }} className="flex flex-col items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-12 h-12 rounded-full bg-[#25D366]/20 backdrop-blur-md border border-[#25D366]/40 flex items-center justify-center text-[#25D366]">
            <MessageCircle size={22} />
          </div>
          <span className="text-[11px] font-semibold text-white/80">{t("chat")}</span>
        </motion.a>

        {/* Bid */}
        <motion.button whileTap={{ scale: 0.88 }} className="flex flex-col items-center gap-1.5 mt-1"
          onClick={(e) => { e.stopPropagation(); setLocation(`/auction/${auction.id}`); }}>
          <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/40 relative">
            <div className="absolute -inset-1 bg-primary/25 rounded-full animate-ping" />
            <Gavel size={26} />
          </div>
          <span className="text-[11px] font-bold text-primary">{t("bid")}</span>
        </motion.button>
      </div>

      {/* ── Bottom info ── */}
      <div
        className="absolute bottom-28 left-4 right-20 z-10 flex flex-col gap-2 cursor-pointer"
        onClick={() => setLocation(`/auction/${auction.id}`)}
      >
        <h2 className="text-[22px] font-bold text-white leading-snug line-clamp-2 drop-shadow-sm">{auction.title}</h2>
        <div className="flex items-baseline gap-2.5">
          <span className="text-3xl font-bold text-white tracking-tight">{formatPrice(auction.currentBid)}</span>
          <span className="text-xs font-medium text-white/50 uppercase tracking-wide">{auction.bidCount} {t("bids_count")}</span>
        </div>
      </div>
    </div>
  );
}
