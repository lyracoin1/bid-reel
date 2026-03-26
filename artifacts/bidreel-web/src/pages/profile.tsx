import { useState } from "react";
import { Settings, Grid, Gavel, Award } from "lucide-react";
import { motion } from "framer-motion";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { currentUser, mockAuctions } from "@/lib/mock-data";
import { formatCurrency } from "@/lib/utils";
import { useLocation } from "wouter";

export default function Profile() {
  const [activeTab, setActiveTab] = useState<"listings" | "bids">("listings");
  const [, setLocation] = useLocation();

  // Mock derived data
  const myListings = mockAuctions.filter(a => a.seller.id === currentUser.id);
  const myBids = mockAuctions.filter(a => a.bids.some(b => b.user.id === currentUser.id));

  const tabs = [
    { id: "listings", label: "Listings", icon: Grid, count: myListings.length },
    { id: "bids", label: "My Bids", icon: Gavel, count: myBids.length },
  ] as const;

  return (
    <MobileLayout>
      <div className="min-h-full bg-background">
        
        {/* Header Section */}
        <div className="pt-12 pb-6 px-6 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-32 bg-primary/10 blur-3xl rounded-full -translate-y-1/2" />
          
          <div className="flex justify-between items-start relative z-10">
            <div className="w-24 h-24 rounded-full border-4 border-background overflow-hidden shadow-xl bg-secondary relative">
              <img src={currentUser.avatar} alt={currentUser.name} className="w-full h-full object-cover" />
            </div>
            <button className="w-10 h-10 rounded-full bg-secondary/80 flex items-center justify-center text-white hover:bg-secondary transition">
              <Settings size={20} />
            </button>
          </div>

          <div className="mt-4 relative z-10">
            <h1 className="text-2xl font-display font-bold text-white">{currentUser.name}</h1>
            <p className="text-muted-foreground">{currentUser.handle}</p>
          </div>

          <div className="flex gap-6 mt-6 relative z-10">
            <div>
              <p className="text-xl font-bold text-white">{myListings.length}</p>
              <p className="text-xs text-muted-foreground">Listings</p>
            </div>
            <div>
              <p className="text-xl font-bold text-white">4</p>
              <p className="text-xs text-muted-foreground">Won</p>
            </div>
            <div>
              <p className="text-xl font-bold text-white">4.9</p>
              <p className="text-xs text-muted-foreground">Rating</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex px-6 border-b border-white/5 relative">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 pb-4 flex justify-center items-center gap-2 relative transition-colors ${
                  isActive ? "text-primary font-bold" : "text-muted-foreground font-medium"
                }`}
              >
                <Icon size={18} />
                {tab.label}
                {isActive && (
                  <motion.div 
                    layoutId="profile-tab"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Grid Content */}
        <div className="p-1 min-h-[300px]">
          {activeTab === "listings" && (
            <div className="grid grid-cols-3 gap-1">
              {myListings.map(auction => (
                <div 
                  key={auction.id} 
                  onClick={() => setLocation(`/auction/${auction.id}`)}
                  className="aspect-[3/4] bg-secondary relative overflow-hidden cursor-pointer group"
                >
                  <img src={auction.mediaUrl} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="text-white font-bold text-sm text-glow">{formatCurrency(auction.currentBid)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === "bids" && (
            <div className="flex flex-col gap-1">
              {myBids.map(auction => (
                <div 
                  key={auction.id}
                  onClick={() => setLocation(`/auction/${auction.id}`)}
                  className="flex items-center gap-4 p-3 bg-secondary/20 hover:bg-secondary/40 transition cursor-pointer"
                >
                  <div className="w-16 h-20 bg-black rounded-lg overflow-hidden shrink-0">
                    <img src={auction.mediaUrl} className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-white truncate">{auction.title}</h4>
                    <p className="text-sm text-muted-foreground mt-1">Current: {formatCurrency(auction.currentBid)}</p>
                  </div>
                  <div className="shrink-0 flex flex-col items-end">
                    <span className="text-xs bg-primary/20 text-primary px-2 py-1 rounded">Active</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </MobileLayout>
  );
}
