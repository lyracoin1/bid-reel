import { useEffect, useRef, useState } from "react";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { FeedCard } from "@/components/feed/FeedCard";
import { useAuctions } from "@/hooks/use-auctions";

export default function Feed() {
  const { data: auctions } = useAuctions();
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Intersection Observer to detect which card is active for autoplay/animations
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = Number(entry.target.getAttribute("data-index"));
            setActiveIndex(index);
          }
        });
      },
      { threshold: 0.6 }
    );

    const cards = container.querySelectorAll(".feed-card");
    cards.forEach((card) => observer.observe(card));

    return () => observer.disconnect();
  }, [auctions]);

  return (
    <MobileLayout noPadding>
      <div 
        ref={containerRef}
        className="w-full h-[100dvh] overflow-y-scroll snap-y-mandatory hide-scrollbar bg-black"
      >
        {auctions.map((auction, index) => (
          <div key={auction.id} data-index={index} className="feed-card w-full h-[100dvh]">
            <FeedCard auction={auction} isActive={activeIndex === index} />
          </div>
        ))}
        
        {/* End of feed message */}
        <div className="w-full h-[100dvh] snap-always flex flex-col items-center justify-center bg-background px-6 text-center">
          <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-6">
            <span className="text-2xl">🎉</span>
          </div>
          <h3 className="text-2xl font-bold mb-2">You're all caught up!</h3>
          <p className="text-muted-foreground">Check back later for new exclusive drops.</p>
        </div>
      </div>
    </MobileLayout>
  );
}
