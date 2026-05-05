import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Per-slide image with a shimmer loading state and a visible error fallback. */
function SlideImage({ src, alt }: { src: string; alt: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  if (status === "error") {
    return (
      <div className="flex items-center justify-center w-full h-full bg-zinc-900/60">
        <span className="text-xs text-white/30">Image unavailable</span>
      </div>
    );
  }
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      {/* Shimmer shown while the image is still downloading */}
      {status === "loading" && (
        <div className="absolute inset-0 bg-zinc-800/60 animate-pulse" />
      )}
      <img
        src={src}
        alt={alt}
        loading="eager"
        decoding="async"
        className="max-w-full max-h-full w-auto h-auto object-contain"
        onLoad={() => setStatus("loaded")}
        onError={() => {
          console.error("[ImageSlider] Failed to load image:", src);
          setStatus("error");
        }}
      />
    </div>
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
        <SlideImage src={images[0]} alt={alt} />
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

  // ── Layout maths ────────────────────────────────────────────────────────────
  // The track is N × container-width wide. Each slide is exactly 1/N of the
  // track (= one container-width). Translating by -(current/N × 100%) of the
  // track always moves by exactly one container-width per step.
  //
  // height: "100%" is applied as an inline style (not just a Tailwind class) on
  // both the track and each slide. Inline styles are resolved before any CSS
  // class lookups, which avoids an older Android-WebView bug where height:100%
  // on a flex item inside a percentage-height flex container computes to zero.
  //
  // All slides always render <SlideImage> (no adjacency guard). This ensures
  // every image starts fetching from the CDN the moment the slider mounts, so
  // navigating to any slide shows a loading shimmer instead of a blank frame.
  const slideWidthPct = 100 / images.length;
  const translatePct  = current * slideWidthPct;

  return (
    <div
      className={cn("relative w-full overflow-hidden bg-black", className)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Track — always N × container-width wide */}
      <div
        className="flex transition-transform duration-300 ease-in-out"
        style={{
          width: `${images.length * 100}%`,
          height: "100%",
          transform: `translateX(-${translatePct}%)`,
        }}
      >
        {images.map((src, i) => (
          <div
            key={i}
            className="flex items-center justify-center"
            style={{ width: `${slideWidthPct}%`, height: "100%" }}
          >
            <SlideImage src={src} alt={`${alt} ${i + 1}`} />
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
