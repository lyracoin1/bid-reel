import { useLocation } from "wouter";
import { Heart, Share2, MessageCircle, Gavel } from "lucide-react";
import { motion } from "framer-motion";
import { type Auction } from "@/lib/mock-data";
import { formatCurrency, getTimeRemaining, getWhatsAppUrl, cn } from "@/lib/utils";
import { useToggleLike } from "@/hooks/use-auctions";

interface FeedCardProps {
  auction: Auction;
  isActive: boolean;
}

export function FeedCard({ auction, isActive }: FeedCardProps) {
  const [, setLocation] = useLocation();
  const { mutate: toggleLike } = useToggleLike();
  const timeInfo = getTimeRemaining(auction.endsAt);
  const whatsappUrl = getWhatsAppUrl(auction.seller.phone, auction.title);

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator.share) {
      try {
        await navigator.share({ title: auction.title, text: `Check out this auction: ${auction.title}`, url: window.location.href });
      } catch (_) {}
    }
  };

  return (
    <div className="relative w-full h-[100dvh] snap-always bg-black flex flex-col overflow-hidden">

      {/* Full-bleed background image */}
      <div
        className="absolute inset-0 cursor-pointer"
        onClick={() => setLocation(`/auction/${auction.id}`)}
      >
        <img
          src={auction.mediaUrl}
          alt={auction.title}
          className={cn(
            "w-full h-full object-cover transition-transform duration-700",
            isActive ? "scale-100" : "scale-105"
          )}
        />
        {/* Layered gradients for depth */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent via-40% to-black/95 pointer-events-none" />
      </div>

      {/* ── Top bar: seller pill + timer ── */}
      <div className="absolute top-0 left-0 right-0 z-10 pt-12 px-4 flex items-center justify-between">
        <button
          className="flex items-center gap-2.5 bg-black/40 backdrop-blur-md border border-white/10 rounded-full pl-1 pr-3 py-1 active:scale-95 transition-transform"
          onClick={() => setLocation(`/auction/${auction.id}`)}
        >
          <img
            src={auction.seller.avatar}
            alt={auction.seller.name}
            className="w-7 h-7 rounded-full object-cover"
          />
          <span className="text-sm font-semibold text-white leading-none">{auction.seller.handle}</span>
        </button>

        <div className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold backdrop-blur-md border",
          timeInfo.isEnded
            ? "bg-white/10 text-white/50 border-white/10"
            : timeInfo.isUrgent
            ? "bg-red-500/20 text-red-400 border-red-500/30"
            : "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
        )}>
          <span className={cn(
            "w-1.5 h-1.5 rounded-full",
            timeInfo.isEnded ? "bg-white/30" : timeInfo.isUrgent ? "bg-red-400 animate-pulse" : "bg-emerald-400"
          )} />
          {timeInfo.text}
        </div>
      </div>

      {/* ── Right action bar ── */}
      <div className="absolute right-3 bottom-36 z-20 flex flex-col items-center gap-5">

        {/* Like */}
        <motion.button
          whileTap={{ scale: 0.8 }}
          className="flex flex-col items-center gap-1.5"
          onClick={(e) => { e.stopPropagation(); toggleLike(auction.id); }}
        >
          <div className={cn(
            "w-12 h-12 rounded-full flex items-center justify-center border backdrop-blur-md transition-colors",
            auction.isLikedByMe
              ? "bg-primary/25 border-primary/50 text-primary"
              : "bg-black/40 border-white/15 text-white"
          )}>
            <Heart size={22} className={cn(auction.isLikedByMe ? "fill-primary" : "")} />
          </div>
          <span className="text-[11px] font-semibold text-white/80">{auction.likes}</span>
        </motion.button>

        {/* Share */}
        <motion.button
          whileTap={{ scale: 0.8 }}
          className="flex flex-col items-center gap-1.5"
          onClick={handleShare}
        >
          <div className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-md border border-white/15 flex items-center justify-center text-white">
            <Share2 size={20} />
          </div>
          <span className="text-[11px] font-semibold text-white/80">Share</span>
        </motion.button>

        {/* WhatsApp */}
        <motion.a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          whileTap={{ scale: 0.8 }}
          className="flex flex-col items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-12 h-12 rounded-full bg-[#25D366]/20 backdrop-blur-md border border-[#25D366]/40 flex items-center justify-center text-[#25D366]">
            <MessageCircle size={22} />
          </div>
          <span className="text-[11px] font-semibold text-white/80">Chat</span>
        </motion.a>

        {/* Bid — primary CTA */}
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={(e) => { e.stopPropagation(); setLocation(`/auction/${auction.id}`); }}
          className="flex flex-col items-center gap-1.5 mt-1"
        >
          <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/40 relative">
            <div className="absolute -inset-1 bg-primary/25 rounded-full animate-ping" />
            <Gavel size={26} />
          </div>
          <span className="text-[11px] font-bold text-primary">Bid</span>
        </motion.button>
      </div>

      {/* ── Bottom info ── */}
      <div
        className="absolute bottom-28 left-4 right-20 z-10 flex flex-col gap-2 cursor-pointer"
        onClick={() => setLocation(`/auction/${auction.id}`)}
      >
        <h2 className="text-[22px] font-bold text-white leading-snug line-clamp-2 drop-shadow-sm">
          {auction.title}
        </h2>

        <div className="flex items-baseline gap-2.5">
          <span className="text-3xl font-bold text-white tracking-tight">
            {formatCurrency(auction.currentBid)}
          </span>
          <span className="text-xs font-medium text-white/50 uppercase tracking-wide">
            {auction.bidCount} bids
          </span>
        </div>
      </div>
    </div>
  );
}
