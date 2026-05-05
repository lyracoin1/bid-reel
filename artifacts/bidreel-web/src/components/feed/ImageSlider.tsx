import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Per-slide image with a visible placeholder on load error. */
function SlideImage({ src, alt, loading }: { src: string; alt: string; loading: "lazy" | "eager" }) {
  const [error, setError] = useState(false);
  if (error) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-zinc-900/60">
        <span className="text-xs text-white/30">Image unavailable</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      decoding="async"
      className="max-w-full max-h-full w-auto h-auto object-contain"
      onError={() => setError(true)}
    />
  );
}

interface ImageSliderProps {
  images: string[];
  alt?: string;
  className?: string;
}

export function ImageSlider({ images, alt = "", className }: ImageSliderProps) {
  const [current, setCurrent] = useState(0);
  const startX = useRef<number | null>(null);

  if (images.length === 0) return null;
  if (images.length === 1) {
    return (
      <div className={cn("flex items-center justify-center bg-black overflow-hidden", className)}>
        <SlideImage src={images[0]} alt={alt} loading="eager" />
      </div>
    );
  }

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

  // The sliding track is made explicitly wide (N × container width) so that
  // Android WebView's flex implementation never collapses it. Each slide is
  // 1/N of the track width = exactly one container width. Translating by
  // -(current / N × 100%) moves by exactly one container width per step,
  // with no black/empty frames between slides.
  const slideWidthPct = 100 / images.length;
  const translatePct  = current * slideWidthPct;

  return (
    <div
      className={cn("relative w-full overflow-hidden bg-black", className)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div
        className="flex h-full transition-transform duration-300 ease-in-out"
        style={{
          width: `${images.length * 100}%`,
          transform: `translateX(-${translatePct}%)`,
        }}
      >
        {images.map((src, i) => (
          <div
            key={i}
            className="h-full flex items-center justify-center"
            style={{ width: `${slideWidthPct}%` }}
          >
            {Math.abs(i - current) <= 1 ? (
              <SlideImage src={src} alt={`${alt} ${i + 1}`} loading="eager" />
            ) : (
              <div className="w-full h-full bg-black" />
            )}
          </div>
        ))}
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

      {/* Dot indicators */}
      <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-1.5 z-10">
        {images.map((_, i) => (
          <motion.button
            key={i}
            onClick={() => setCurrent(i)}
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
