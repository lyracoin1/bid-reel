import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

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
    return <img src={images[0]} alt={alt} className={cn("w-full h-full object-cover", className)} />;
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

  return (
    <div className={cn("relative overflow-hidden", className)} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* Slides */}
      <div className="flex h-full transition-transform duration-300 ease-in-out" style={{ transform: `translateX(-${current * 100}%)` }}>
        {images.map((src, i) => (
          <div key={i} className="w-full h-full shrink-0">
            <img src={src} alt={`${alt} ${i + 1}`} className="w-full h-full object-cover" />
          </div>
        ))}
      </div>

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
      <div className="absolute top-4 right-4 z-10 bg-black/50 backdrop-blur-sm rounded-full px-2.5 py-1 text-xs font-bold text-white">
        {current + 1}/{images.length}
      </div>
    </div>
  );
}
