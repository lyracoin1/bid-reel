import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Share2, Clock, TrendingUp, MessageCircle, Gavel, Play } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { ImageSlider } from "@/components/feed/ImageSlider";
import { useAuction, usePlaceBid } from "@/hooks/use-auctions";
import { useFollow } from "@/hooks/use-follow";
import { getTimeRemaining, getWhatsAppUrl, cn } from "@/lib/utils";
import { useLang } from "@/contexts/LanguageContext";
import { formatDistanceToNow } from "date-fns";

export default function AuctionDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { data: auction } = useAuction(id || "");
  const { mutate: placeBid, isPending: isBidding } = usePlaceBid();
  const { isFollowing, toggle: toggleFollow } = useFollow();
  const { t, formatPrice } = useLang();

  const [showBidSheet, setShowBidSheet] = useState(false);
  const [bidAmount, setBidAmount] = useState(0);

  if (!auction) {
    return (
      <MobileLayout>
        <div className="flex h-full items-center justify-center">
          <p className="text-muted-foreground">Auction not found</p>
        </div>
      </MobileLayout>
    );
  }

  const timeInfo = getTimeRemaining(auction.endsAt);
  const minBid = auction.currentBid + 10;
  const whatsappUrl = getWhatsAppUrl(auction.seller.phone, auction.title);

  const isAlbum = auction.type === "album" && (auction.images?.length ?? 0) > 1;
  const isVideo = auction.type === "video";

  const handleOpenBid = () => { setBidAmount(minBid); setShowBidSheet(true); };
  const submitBid = () => { placeBid(auction.id, bidAmount); setShowBidSheet(false); };
  const handleShare = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: auction.title, url: window.location.href }); }
      catch (_) {}
    }
  };

  return (
    <MobileLayout showNav={!showBidSheet} noPadding>
      <div className="relative w-full min-h-[100dvh] bg-background pb-36">

        {/* ── Floating top bar ── */}
        <div className="fixed top-0 left-0 right-0 z-50 max-w-md mx-auto px-4 pt-12 pb-3 flex justify-between items-center bg-gradient-to-b from-black/80 via-black/30 to-transparent">
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => setLocation("/feed")}
            className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md border border-white/12 flex items-center justify-center text-white">
            <ArrowLeft size={18} />
          </motion.button>
          <motion.button whileTap={{ scale: 0.9 }} onClick={handleShare}
            className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md border border-white/12 flex items-center justify-center text-white">
            <Share2 size={18} />
          </motion.button>
        </div>

        {/* ── Hero media ── */}
        <div className="w-full h-[58vh] relative bg-black">
          {isAlbum ? (
            <ImageSlider images={auction.images!} alt={auction.title} className="w-full h-full" />
          ) : (
            <div className="relative w-full h-full">
              <img src={auction.mediaUrl} alt={auction.title} className="w-full h-full object-cover" />
              {isVideo && (
                <div className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-black/50 backdrop-blur-sm border border-white/15 flex items-center justify-center text-white z-10">
                  <Play size={14} fill="white" />
                </div>
              )}
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/10 to-transparent pointer-events-none" />
        </div>

        {/* ── Content ── */}
        <div className="px-5 -mt-6 relative z-10 space-y-5">

          {/* Timer + bids row */}
          <div className="flex items-center justify-between">
            <div className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border",
              timeInfo.isEnded
                ? "bg-white/8 text-white/40 border-white/8"
                : timeInfo.isUrgent
                ? "bg-red-500/15 text-red-400 border-red-500/25"
                : "bg-emerald-500/12 text-emerald-400 border-emerald-500/20"
            )}>
              <Clock size={12} />
              {timeInfo.isEnded ? t("time_ended") : timeInfo.text}
            </div>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground font-medium">
              <TrendingUp size={15} className="text-primary" />
              {auction.bidCount} {t("bids_count")}
            </div>
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-white leading-tight">{auction.title}</h1>

          {/* Price */}
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold text-white tracking-tight">{formatPrice(auction.currentBid)}</span>
            <span className="text-sm text-muted-foreground font-medium">{t("current_bid")}</span>
          </div>

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
              className="flex items-center justify-center gap-2.5 w-full py-3.5 border-t border-white/8 bg-[#25D366]/12 hover:bg-[#25D366]/20 transition-colors active:scale-[0.98]"
            >
              <MessageCircle size={18} className="text-[#25D366]" />
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
                      {i === 0 && <span className="text-[10px] font-bold text-primary uppercase tracking-wide">{t("leading")}</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 rounded-2xl border border-dashed border-white/10 text-center">
                <p className="text-muted-foreground text-sm">{t("no_bids")}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Sticky bid bar ── */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto z-40 px-4 pb-6 pt-3 bg-gradient-to-t from-background via-background/90 to-transparent">
        <motion.button
          whileTap={{ scale: 0.97 }} onClick={handleOpenBid} disabled={timeInfo.isEnded}
          className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-lg shadow-primary/30 disabled:opacity-40 disabled:shadow-none"
        >
          <Gavel size={20} />
          {timeInfo.isEnded ? t("auction_closed") : t("place_bid")}
        </motion.button>
      </div>

      {/* ── Bid sheet ── */}
      <AnimatePresence>
        {showBidSheet && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowBidSheet(false)} className="fixed inset-0 bg-black/70 z-50" />
            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 220 }}
              className="fixed bottom-0 left-0 right-0 max-w-md mx-auto z-50 bg-[#111118] rounded-t-3xl border-t border-white/8 px-6 pt-5 pb-10"
            >
              <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-6" />
              <h3 className="text-lg font-bold text-white text-center mb-1">{t("place_bid")}</h3>
              <p className="text-sm text-muted-foreground text-center mb-7">
                {t("min_bid")}: <span className="text-white font-semibold">{formatPrice(minBid)}</span>
              </p>

              <div className="flex justify-center items-center gap-5 mb-6">
                <motion.button whileTap={{ scale: 0.88 }} onClick={() => setBidAmount(b => Math.max(minBid, b - 10))}
                  className="w-12 h-12 rounded-full bg-white/8 border border-white/10 flex items-center justify-center text-xl font-bold text-white">−</motion.button>
                <div className="text-4xl font-bold text-white w-40 text-center tracking-tight">{formatPrice(bidAmount)}</div>
                <motion.button whileTap={{ scale: 0.88 }} onClick={() => setBidAmount(b => b + 10)}
                  className="w-12 h-12 rounded-full bg-white/8 border border-white/10 flex items-center justify-center text-xl font-bold text-white">+</motion.button>
              </div>

              <div className="flex gap-2 mb-7">
                {[10, 25, 50, 100].map(inc => (
                  <motion.button key={inc} whileTap={{ scale: 0.92 }} onClick={() => setBidAmount(b => b + inc)}
                    className="flex-1 py-2.5 rounded-xl bg-white/6 border border-white/10 text-sm font-semibold text-white/80 hover:bg-white/10 transition">
                    +${inc}
                  </motion.button>
                ))}
              </div>

              <motion.button
                whileTap={{ scale: 0.97 }} onClick={submitBid} disabled={isBidding || bidAmount < minBid}
                className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-base shadow-lg shadow-primary/30 disabled:opacity-40 disabled:shadow-none"
              >
                {isBidding ? t("processing") : `${t("confirm_bid")} — ${formatPrice(bidAmount)}`}
              </motion.button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </MobileLayout>
  );
}
