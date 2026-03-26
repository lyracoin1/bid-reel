import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Share2, Heart, Clock, ShieldCheck, TrendingUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { useAuction, usePlaceBid } from "@/hooks/use-auctions";
import { formatCurrency, getTimeRemaining, cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

export default function AuctionDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { data: auction } = useAuction(id || "");
  const { mutate: placeBid, isPending: isBidding } = usePlaceBid();
  
  const [showBidSheet, setShowBidSheet] = useState(false);
  const [bidAmount, setBidAmount] = useState<number>(0);

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
  const nextMinimumBid = auction.currentBid + (auction.currentBid * 0.05 > 50 ? 50 : 10); // Simple 5% or $10 increment rule

  const handleOpenBid = () => {
    setBidAmount(nextMinimumBid);
    setShowBidSheet(true);
  };

  const submitBid = async () => {
    try {
      await placeBid(auction.id, bidAmount);
      setShowBidSheet(false);
    } catch (e) {
      console.error(e);
      // In real app, show toast
    }
  };

  return (
    <MobileLayout showNav={!showBidSheet} noPadding>
      <div className="relative w-full min-h-[100dvh] bg-background pb-32">
        
        {/* Top Nav Bar */}
        <div className="fixed top-0 left-0 right-0 z-50 px-4 py-4 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent max-w-md mx-auto">
          <button 
            onClick={() => setLocation("/feed")}
            className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md border border-white/10 flex items-center justify-center text-white"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex gap-2">
            <button className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md border border-white/10 flex items-center justify-center text-white">
              <Share2 size={20} />
            </button>
          </div>
        </div>

        {/* Media Hero */}
        <div className="w-full h-[55vh] relative bg-black">
          <img 
            src={auction.mediaUrl} 
            alt={auction.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
        </div>

        {/* Content Details */}
        <div className="px-6 -mt-8 relative z-10">
          
          <div className="flex justify-between items-start mb-4">
            <div className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold",
              timeInfo.isEnded ? "bg-secondary text-muted-foreground" :
              timeInfo.isUrgent ? "bg-destructive/20 text-destructive border border-destructive/30" : 
              "bg-secondary/80 text-foreground border border-white/5"
            )}>
              <Clock size={14} />
              {timeInfo.text}
            </div>
            <div className="flex items-center gap-1 text-muted-foreground text-sm font-medium">
              <TrendingUp size={16} className="text-primary" />
              {auction.bidCount} bids
            </div>
          </div>

          <h1 className="text-3xl font-display font-bold text-white leading-tight mb-2">
            {auction.title}
          </h1>

          <div className="flex items-baseline gap-2 mb-6">
            <span className="text-5xl font-display font-bold text-primary text-glow">
              {formatCurrency(auction.currentBid)}
            </span>
            <span className="text-sm font-medium text-muted-foreground">
              Current Bid
            </span>
          </div>

          <div className="p-4 rounded-2xl bg-secondary/50 border border-white/5 mb-8 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={auction.seller.avatar} alt={auction.seller.name} className="w-12 h-12 rounded-full object-cover" />
              <div>
                <p className="font-semibold text-white">{auction.seller.name}</p>
                <p className="text-xs text-muted-foreground">{auction.seller.handle}</p>
              </div>
            </div>
            <button className="px-4 py-2 rounded-full bg-white/10 text-sm font-semibold hover:bg-white/20 transition">
              Contact
            </button>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold mb-3">Description</h3>
            <p className="text-muted-foreground leading-relaxed">
              {auction.description}
            </p>
          </div>

          {/* Bid History */}
          <div className="mb-12">
            <h3 className="text-lg font-bold mb-4">Recent Bids</h3>
            {auction.bids.length > 0 ? (
              <div className="space-y-4">
                {auction.bids.slice(0, 5).map((bid, i) => (
                  <div key={bid.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <img src={bid.user.avatar} className="w-8 h-8 rounded-full" />
                      <div>
                        <p className="text-sm font-medium text-white">{bid.user.name}</p>
                        <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(bid.timestamp))} ago</p>
                      </div>
                    </div>
                    <span className="font-bold text-white">{formatCurrency(bid.amount)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 rounded-2xl border border-dashed border-white/10 text-center">
                <p className="text-muted-foreground text-sm">No bids yet. Be the first!</p>
              </div>
            )}
          </div>
        </div>

        {/* Sticky Bottom CTA */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 backdrop-blur-xl border-t border-white/5 max-w-md mx-auto z-40">
          <motion.button 
            whileTap={{ scale: 0.98 }}
            onClick={handleOpenBid}
            disabled={timeInfo.isEnded}
            className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-lg box-glow disabled:opacity-50 disabled:shadow-none"
          >
            {timeInfo.isEnded ? "Auction Closed" : "Place Bid"}
          </motion.button>
        </div>

        {/* Bid Sheet Overlay */}
        <AnimatePresence>
          {showBidSheet && (
            <>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowBidSheet(false)}
                className="fixed inset-0 bg-black/80 z-50 max-w-md mx-auto"
              />
              <motion.div 
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className="fixed bottom-0 left-0 right-0 bg-card rounded-t-3xl p-6 z-50 max-w-md mx-auto border-t border-white/10"
              >
                <h3 className="text-xl font-bold mb-6 text-center">Place your bid</h3>
                
                <div className="flex justify-center items-center gap-4 mb-8">
                  <button 
                    onClick={() => setBidAmount(b => Math.max(nextMinimumBid, b - 10))}
                    className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-xl font-bold"
                  >-</button>
                  <div className="text-4xl font-display font-bold text-primary w-40 text-center">
                    {formatCurrency(bidAmount)}
                  </div>
                  <button 
                    onClick={() => setBidAmount(b => b + 10)}
                    className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-xl font-bold"
                  >+</button>
                </div>

                <div className="flex gap-2 mb-8">
                  {[10, 50, 100].map(inc => (
                    <button 
                      key={inc}
                      onClick={() => setBidAmount(b => b + inc)}
                      className="flex-1 py-2 rounded-xl bg-secondary/50 border border-white/5 text-sm font-semibold hover:bg-secondary transition"
                    >
                      +${inc}
                    </button>
                  ))}
                </div>

                <motion.button 
                  whileTap={{ scale: 0.98 }}
                  onClick={submitBid}
                  disabled={isBidding}
                  className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-lg box-glow relative overflow-hidden"
                >
                  {isBidding ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      Processing...
                    </span>
                  ) : "Confirm Bid"}
                </motion.button>
              </motion.div>
            </>
          )}
        </AnimatePresence>

      </div>
    </MobileLayout>
  );
}
