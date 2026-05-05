import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImageSliderProps {
  images: string[];
  alt?: string;
  className?: string;
}

/**
 * Image carousel that renders one slide at a time and swaps `src` on
 * index change. No CSS sliding track, no translateX, no percentage-of-
 * percentage width math.
 *
 * This matches the approach that was confirmed working in the original
 * FeedCard implementation (commit 05843f5). The previous "sliding track"
 * rewrite (commit 2442332) introduced two bugs:
 *
 *   1. An adjacency guard (`Math.abs(i - current) <= 1`) that rendered a
 *      solid black <div> for non-adjacent slides. When the user navigated
 *      to those slides the <img> was created for the first time at that
 *      moment — no pre-load — so they saw blank/black while the network
 *      request was in flight, which looked like broken images.
 *
 *   2. A CSS percentage-of-percentage chain (`width: (100/N)%` of a
 *      `width: N*100%` flex container) that can misbehave on older
 *      Android WebViews.
 *
 * The fix is minimal: one <img> in the DOM, `key={src}` so React remounts
 * it on every index change (ensuring onLoad/onError fire correctly), and
 * the same swipe + arrow + dot controls as before.
 */
export function ImageSlider({ images, alt = "", className }: ImageSliderProps) {
  const [current, setCurrent] = useState(0);
  const startX = useRef<number | null>(null);

  if (images.length === 0) return null;

  const prev = () => setCurrent(c => Math.max(0, c - 1));
  const next = () => setCurrent(c => Math.min(images.length - 1, c + 1));

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (startX.current === null) return;
    const dx = e.changedTouches[0].clientX - startX.current;
    if (Math.abs(dx) > 40) { dx < 0 ? next() : prev(); }
    startX.current = null;
  };

  const src = images[current];

  return (
    <div
      className={cn("relative w-full overflow-hidden bg-black", className)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Single image — src and key both change on index change.
          key forces React to unmount/remount the img so onLoad fires
          reliably for every slide, not just the first. */}
      <div className="w-full h-full flex items-center justify-center">
        <img
          key={src}
          src={src}
          alt={`${alt} ${current + 1}`}
          loading="eager"
          decoding="async"
          className="max-w-full max-h-full w-auto h-auto object-contain"
          onError={() => console.error("[ImageSlider] failed to load:", src)}
        />
      </div>

      {/* Left arrow */}
      {current > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); prev(); }}
          aria-label="Previous image"
          className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-black/55 backdrop-blur-sm border border-white/20 flex items-center justify-center active:scale-90 transition-transform"
        >
          <ChevronLeft size={18} className="text-white" />
        </button>
      )}

      {/* Right arrow */}
      {current < images.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); next(); }}
          aria-label="Next image"
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-black/55 backdrop-blur-sm border border-white/20 flex items-center justify-center active:scale-90 transition-transform"
        >
          <ChevronRight size={18} className="text-white" />
        </button>
      )}

      {/* Dot indicators — stopPropagation prevents the FeedCard parent's
          onClick (navigate-to-detail) from firing when a dot is tapped. */}
      <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-1.5 z-10">
        {images.map((_, i) => (
          <motion.button
            key={i}
            onClick={(e) => { e.stopPropagation(); setCurrent(i); }}
            className={cn(
              "rounded-full transition-all duration-200",
              i === current ? "w-5 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/40"
            )}
          />
        ))}
      </div>

      {/* Count badge */}
      <div className="absolute top-4 right-4 z-10 bg-black/50 backdrop-blur-sm rounded-full px-2.5 py-1 text-xs font-bold text-white pointer-events-none">
        {current + 1} / {images.length}
      </div>
    </div>
  );
}
