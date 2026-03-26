import { useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { Heart, Share2, Gavel, MoreVertical, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { type Auction } from "@/lib/mock-data";
import { formatCurrency, getTimeRemaining, cn } from "@/lib/utils";
import { useToggleLike } from "@/hooks/use-auctions";

interface FeedCardProps {
  auction: Auction;
  isActive: boolean;
}

export function FeedCard({ auction, isActive }: FeedCardProps) {
  const [, setLocation] = useLocation();
  const { mutate: toggleLike } = useToggleLike();
  const timeInfo = getTimeRemaining(auction.endsAt);

  const handleBidClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setLocation(`/auction/${auction.id}`);
  };

  return (
    <div className="relative w-full h-[100dvh] snap-always bg-black flex flex-col justify-center overflow-hidden group">
      
      {/* Media Background */}
      <div 
        className="absolute inset-0 cursor-pointer"
        onClick={() => setLocation(`/auction/${auction.id}`)}
      >
        <img 
          src={auction.mediaUrl} 
          alt={auction.title}
          className={cn(
            "w-full h-full object-cover transition-transform duration-1000",
            isActive ? "scale-100" : "scale-105"
          )}
        />
        {/* Gradients for text readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/90 pointer-events-none" />
      </div>

      {/* Top Header (Seller) */}
      <div className="absolute top-12 left-4 right-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-3 bg-black/30 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 cursor-pointer hover:bg-black/50 transition">
          <img src={auction.seller.avatar} alt={auction.seller.name} className="w-8 h-8 rounded-full object-cover" />
          <div className="flex flex-col">
            <span className="text-sm font-semibold leading-tight text-white">{auction.seller.handle}</span>
          </div>
        </div>
        <button className="w-10 h-10 rounded-full bg-black/30 backdrop-blur-md border border-white/10 flex items-center justify-center text-white">
          <MoreVertical size={20} />
        </button>
      </div>

      {/* Right Action Bar */}
      <div className="absolute right-4 bottom-32 flex flex-col items-center gap-6 z-20">
        
        <button className="flex flex-col items-center gap-1 group" onClick={() => toggleLike(auction.id)}>
          <motion.div 
            whileTap={{ scale: 0.8 }}
            className={cn(
              "w-12 h-12 rounded-full flex items-center justify-center glass-panel transition-colors",
              auction.isLikedByMe ? "bg-primary/20 border-primary/50 text-primary" : "text-white"
            )}
          >
            <Heart size={24} className={cn(auction.isLikedByMe ? "fill-primary" : "")} />
          </motion.div>
          <span className="text-xs font-medium text-white/90">{auction.likes}</span>
        </button>

        <button className="flex flex-col items-center gap-1">
          <motion.div 
            whileTap={{ scale: 0.8 }}
            className="w-12 h-12 rounded-full flex items-center justify-center glass-panel text-white"
          >
            <Share2 size={24} />
          </motion.div>
          <span className="text-xs font-medium text-white/90">Share</span>
        </button>

        <motion.button 
          whileTap={{ scale: 0.9 }}
          onClick={handleBidClick}
          className="w-14 h-14 mt-2 rounded-full bg-primary flex items-center justify-center text-white box-glow relative"
        >
          <div className="absolute -inset-1 bg-primary rounded-full animate-ping opacity-20" />
          <Gavel size={28} />
        </motion.button>

      </div>

      {/* Bottom Content Area */}
      <div 
        className="absolute bottom-28 left-4 right-20 flex flex-col gap-3 z-10 cursor-pointer"
        onClick={() => setLocation(`/auction/${auction.id}`)}
      >
        
        {/* Timer Badge */}
        <div className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold w-fit",
          timeInfo.isEnded ? "bg-secondary text-muted-foreground" :
          timeInfo.isUrgent ? "bg-destructive/20 text-destructive border border-destructive/30" : 
          "bg-white/10 text-white backdrop-blur-md border border-white/20"
        )}>
          <div className={cn("w-1.5 h-1.5 rounded-full", timeInfo.isUrgent ? "bg-destructive animate-pulse" : "bg-green-400")} />
          {timeInfo.text}
        </div>

        <h2 className="text-2xl sm:text-3xl font-display font-bold text-white leading-tight line-clamp-2 text-shadow-sm">
          {auction.title}
        </h2>
        
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-display font-bold text-white">
            {formatCurrency(auction.currentBid)}
          </span>
          <span className="text-sm font-medium text-white/60">
            {auction.bidCount} bids
          </span>
        </div>

        <div className="flex items-center gap-2 mt-1">
          <ShieldCheck size={14} className="text-green-400" />
          <span className="text-xs font-medium text-white/70">Verified Authentic</span>
        </div>

      </div>

    </div>
  );
}
