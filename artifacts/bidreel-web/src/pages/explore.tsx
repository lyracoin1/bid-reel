import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Search, X, Play } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { useAuctions } from "@/hooks/use-auctions";
import { useLang } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

function AlbumIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="2" y="2" width="14" height="14" rx="2" fill="none" />
    </svg>
  );
}

const MAX_RESULTS = 12;

export default function Explore() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [, setLocation] = useLocation();
  const { data: auctions } = useAuctions();
  const { t, formatPrice } = useLang();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, []);

  // 350ms debounce on the actual search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 350);
    return () => clearTimeout(timer);
  }, [query]);

  const hasQuery = debouncedQuery.length > 0;
  const allResults = hasQuery
    ? auctions.filter(a =>
        a.title.toLowerCase().includes(debouncedQuery) ||
        a.description.toLowerCase().includes(debouncedQuery)
      )
    : [];
  const results = allResults.slice(0, MAX_RESULTS);
  const hasMore = allResults.length > MAX_RESULTS;
  const noResults = hasQuery && results.length === 0;

  return (
    <MobileLayout>
      <div className="flex flex-col h-full">

        {/* Search bar */}
        <div className="px-4 pt-14 pb-4">
          <div className="relative">
            <Search
              size={20}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white/35 pointer-events-none"
            />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t("search_placeholder")}
              dir="auto"
              className={[
                "w-full bg-white/6 border border-white/10 rounded-2xl",
                "pl-12 pr-11 py-4 text-white text-base font-medium",
                "placeholder:text-white/30 focus:outline-none focus:border-white/25 focus:bg-white/8",
                "transition-all duration-200",
              ].join(" ")}
            />
            <AnimatePresence>
              {hasQuery && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.7 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => setQuery("")}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/15 flex items-center justify-center"
                >
                  <X size={13} className="text-white" />
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {/* Hint line */}
          {!hasQuery && (
            <p className="text-xs text-white/25 text-center mt-3 font-medium">{t("search_hint")}</p>
          )}
          {hasQuery && !noResults && (
            <p className="text-xs text-white/30 mt-3 font-medium">
              {allResults.length} {allResults.length === 1 ? "result" : "results"}
              {hasMore && ` · showing first ${MAX_RESULTS}`}
            </p>
          )}
        </div>

        {/* Results / empty state */}
        <div className="flex-1 overflow-y-auto pb-4 px-4">
          <AnimatePresence mode="wait">
            {!hasQuery ? (
              <motion.div
                key="idle"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col items-center justify-center pt-20 text-center gap-5"
              >
                <div className="w-20 h-20 rounded-full bg-white/5 border border-white/8 flex items-center justify-center text-3xl">
                  🛍️
                </div>
                <div>
                  <p className="text-base font-bold text-white mb-1">Find great auctions</p>
                  <p className="text-sm text-white/35">Search by title, category, or keyword</p>
                </div>
                <div className="flex flex-wrap gap-2 justify-center mt-1">
                  {["Watch", "Camera", "Car", "Rolex"].map(tag => (
                    <button
                      key={tag}
                      onClick={() => setQuery(tag)}
                      className="px-4 py-1.5 rounded-full bg-white/6 border border-white/10 text-sm text-white/60 font-medium hover:bg-white/10 transition"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </motion.div>
            ) : noResults ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col items-center justify-center pt-24 text-center gap-4"
              >
                <div className="w-20 h-20 rounded-full bg-white/5 border border-white/8 flex items-center justify-center text-3xl">
                  🔍
                </div>
                <div>
                  <p className="text-lg font-bold text-white mb-1">{t("no_results")}</p>
                  <p className="text-sm text-white/35">{t("search_hint")}</p>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="grid"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="grid grid-cols-2 gap-3"
              >
                {results.map((auction, i) => (
                  <motion.button
                    key={auction.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: i * 0.04 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setLocation(`/auction/${auction.id}`)}
                    className="text-left rounded-2xl overflow-hidden bg-white/4 border border-white/8 hover:bg-white/6 transition-colors"
                  >
                    {/* Thumbnail */}
                    <div className="relative w-full aspect-[3/4] bg-black overflow-hidden">
                      <img
                        src={auction.mediaUrl}
                        alt={auction.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      {/* Type badge */}
                      <div className="absolute top-2 right-2 w-6 h-6 rounded-md bg-black/55 backdrop-blur-sm border border-white/15 flex items-center justify-center text-white">
                        {auction.type === "video"
                          ? <Play size={11} fill="white" />
                          : <AlbumIcon size={11} />}
                      </div>
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
                    </div>

                    {/* Info */}
                    <div className="p-3">
                      <p className="text-xs font-semibold text-white leading-snug line-clamp-2 mb-1.5">
                        {auction.title}
                      </p>
                      <p className="text-sm font-bold text-white tracking-tight">
                        {formatPrice(auction.currentBid)}
                      </p>
                      <p className="text-[10px] text-white/35 font-medium mt-0.5">
                        {auction.bidCount} {t("bids_count")}
                      </p>
                    </div>
                  </motion.button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </MobileLayout>
  );
}
