import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Search, X, Play, Clock, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { useAuctions } from "@/hooks/use-auctions";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuctionState } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { formatAuctionPrice } from "@/lib/geo";
import type { Auction } from "@/lib/mock-data";

// ─── Icons ────────────────────────────────────────────────────────────────────

function AlbumIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="2" y="2" width="14" height="14" rx="2" fill="none" />
    </svg>
  );
}

// ─── Recent searches ──────────────────────────────────────────────────────────

const STORAGE_KEY = "bidreel_recent_searches";
const MAX_RECENT = 5;

function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); }
  catch { return []; }
}

function saveRecent(terms: string[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(terms.slice(0, MAX_RECENT))); }
  catch {}
}

function pushRecent(term: string, prev: string[]): string[] {
  const deduped = [term, ...prev.filter(t => t.toLowerCase() !== term.toLowerCase())];
  return deduped.slice(0, MAX_RECENT);
}

// ─── Ranking ──────────────────────────────────────────────────────────────────

function rankAuctions(auctions: Auction[], query: string): Auction[] {
  const q = query.toLowerCase();
  const now = Date.now();

  return auctions
    .map(a => {
      const titleMatch = a.title.toLowerCase().includes(q);
      const descMatch = a.description.toLowerCase().includes(q);
      if (!titleMatch && !descMatch) return null;

      let score = 0;
      if (titleMatch) score += 10;           // title match is primary signal
      if (descMatch) score += 1;             // description match is secondary
      if (new Date(a.endsAt).getTime() > now) score += 6;  // active > ended
      score += Math.min(a.bidCount * 0.15, 3);              // popularity bonus (capped)
      return { auction: a, score };
    })
    .filter(Boolean)
    .sort((a, b) => b!.score - a!.score)
    .map(s => s!.auction);
}

// ─── Skeleton card ────────────────────────────────────────────────────────────

function SearchSkeleton() {
  return (
    <div className="rounded-2xl overflow-hidden bg-white/4 border border-white/8">
      <Skeleton className="w-full aspect-[3/4] rounded-none" />
      <div className="p-3 space-y-2">
        <Skeleton className="h-3 w-4/5 rounded-md" />
        <Skeleton className="h-3 w-3/5 rounded-md" />
        <Skeleton className="h-4 w-2/5 rounded-md mt-1" />
      </div>
    </div>
  );
}

// ─── Result card ──────────────────────────────────────────────────────────────

function ResultCard({
  auction,
  index,
  onClick,
}: {
  auction: Auction;
  index: number;
  onClick: () => void;
}) {
  const state = getAuctionState(auction);
  const isActive = state === "active";

  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay: Math.min(index * 0.03, 0.18) }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="text-left rounded-2xl overflow-hidden bg-white/4 border border-white/8 hover:bg-white/6 transition-colors"
    >
      <div className="relative w-full aspect-[3/4] bg-black overflow-hidden">
        <img
          src={auction.mediaUrl}
          alt={auction.title}
          className={cn("w-full h-full object-cover", !isActive && "opacity-60")}
          loading="lazy"
        />

        {/* Media type badge */}
        <div className="absolute top-2 right-2 w-6 h-6 rounded-md bg-black/55 backdrop-blur-sm border border-white/15 flex items-center justify-center text-white">
          {auction.type === "video" ? <Play size={11} fill="white" /> : <AlbumIcon size={11} />}
        </div>

        {/* Status pill */}
        {!isActive && (
          <div className={cn(
            "absolute top-2 left-2 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide border",
            state === "ended"
              ? "bg-black/60 text-white/40 border-white/10"
              : "bg-amber-500/20 text-amber-400 border-amber-500/30"
          )}>
            {state === "ended" ? "Ended" : "Soon"}
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent pointer-events-none" />
      </div>

      <div className="p-3">
        <p className="text-xs font-semibold text-white leading-snug line-clamp-2 mb-1.5">
          {auction.title}
        </p>
        <p className="text-sm font-bold text-white tracking-tight">
          {formatAuctionPrice(auction.currentBid || auction.startingBid, auction.currencyCode ?? "USD")}
        </p>
        <p className="text-[10px] text-white/35 font-medium mt-0.5">
          {auction.bidCount} bids
        </p>
      </div>
    </motion.button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;
const SUGGESTIONS = ["Watch", "Camera", "Jordan", "Rolex", "Guitar", "Ferrari"];

export default function Explore() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>(loadRecent);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [, setLocation] = useLocation();
  const { data: auctions } = useAuctions();
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  // 350ms debounce — also saves to recent when a real term commits
  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = query.trim().toLowerCase();
      setDebouncedQuery(trimmed);
      if (trimmed.length >= 2) {
        setRecentSearches(prev => {
          const updated = pushRecent(trimmed, prev);
          saveRecent(updated);
          return updated;
        });
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  // Reset pagination on new search
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [debouncedQuery]);

  const hasQuery = debouncedQuery.length > 0;
  const isDebouncing = query.trim() !== "" && query.trim().toLowerCase() !== debouncedQuery;

  const ranked = hasQuery ? rankAuctions(auctions, debouncedQuery) : [];
  const visible = ranked.slice(0, visibleCount);
  const hasMore = ranked.length > visibleCount;
  const noResults = hasQuery && ranked.length === 0;

  const handleTagClick = (tag: string) => setQuery(tag);

  const removeRecent = (term: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRecentSearches(prev => {
      const updated = prev.filter(t => t !== term);
      saveRecent(updated);
      return updated;
    });
  };

  const clearAll = () => {
    setRecentSearches([]);
    saveRecent([]);
  };

  return (
    <MobileLayout>
      <div className="flex flex-col h-full">

        {/* ── Search bar ── */}
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
              placeholder="Search auctions…"
              dir="auto"
              className={[
                "w-full bg-white/6 border border-white/10 rounded-2xl",
                "pl-12 pr-11 py-4 text-white text-base font-medium",
                "placeholder:text-white/30 focus:outline-none focus:border-white/25 focus:bg-white/8",
                "transition-all duration-200",
              ].join(" ")}
            />
            <AnimatePresence>
              {query.length > 0 && (
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

          {/* Result count line */}
          {hasQuery && !noResults && !isDebouncing && (
            <p className="text-xs text-white/30 mt-3 font-medium">
              {ranked.length} result{ranked.length === 1 ? "" : "s"}
              {hasMore && ` · showing ${visibleCount}`}
            </p>
          )}
          {isDebouncing && (
            <p className="text-xs text-white/25 mt-3 font-medium">Searching…</p>
          )}
        </div>

        {/* ── Main content ── */}
        <div className="flex-1 overflow-y-auto pb-6 px-4">
          <AnimatePresence mode="wait">

            {/* Loading skeletons — shown during debounce delay */}
            {isDebouncing ? (
              <motion.div
                key="skeleton"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="grid grid-cols-2 gap-3"
              >
                {Array.from({ length: 6 }).map((_, i) => (
                  <SearchSkeleton key={i} />
                ))}
              </motion.div>

            ) : !hasQuery ? (
              /* ── Idle state: recent searches + discover ── */
              <motion.div
                key="idle"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col pt-4 gap-6"
              >
                {/* Recent searches */}
                {recentSearches.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-bold text-white/40 uppercase tracking-widest">Recent</p>
                      <button
                        onClick={clearAll}
                        className="text-[11px] text-white/30 hover:text-white/55 font-medium transition"
                      >
                        Clear all
                      </button>
                    </div>
                    <div className="space-y-1">
                      {recentSearches.map(term => (
                        <motion.button
                          key={term}
                          layout
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -8 }}
                          onClick={() => handleTagClick(term)}
                          className="flex items-center justify-between w-full px-4 py-3 rounded-xl bg-white/5 border border-white/8 hover:bg-white/8 transition-colors group"
                        >
                          <div className="flex items-center gap-3">
                            <Clock size={13} className="text-white/30 shrink-0" />
                            <span className="text-sm text-white/70 font-medium capitalize">{term}</span>
                          </div>
                          <button
                            onClick={(e) => removeRecent(term, e)}
                            className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-white/15 transition opacity-0 group-hover:opacity-100 shrink-0"
                          >
                            <X size={10} className="text-white/50" />
                          </button>
                        </motion.button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Discover section */}
                <div className="flex flex-col items-center text-center gap-5">
                  <div className="w-20 h-20 rounded-full bg-white/5 border border-white/8 flex items-center justify-center text-3xl">
                    🛍️
                  </div>
                  <div>
                    <p className="text-base font-bold text-white mb-1">Find great auctions</p>
                    <p className="text-sm text-white/35">Search by title, category, or keyword</p>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {SUGGESTIONS.map(tag => (
                      <button
                        key={tag}
                        onClick={() => handleTagClick(tag)}
                        className="px-4 py-1.5 rounded-full bg-white/6 border border-white/10 text-sm text-white/60 font-medium hover:bg-white/10 hover:text-white/80 transition"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>

            ) : noResults ? (
              /* ── No results ── */
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
                  <p className="text-lg font-bold text-white mb-1">No results for "{debouncedQuery}"</p>
                  <p className="text-sm text-white/35">Try a different keyword or category</p>
                </div>
                <div className="flex flex-wrap gap-2 justify-center mt-2">
                  {SUGGESTIONS.slice(0, 4).map(tag => (
                    <button
                      key={tag}
                      onClick={() => handleTagClick(tag)}
                      className="px-4 py-1.5 rounded-full bg-white/6 border border-white/10 text-sm text-white/60 font-medium hover:bg-white/10 transition"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </motion.div>

            ) : (
              /* ── Results grid ── */
              <motion.div
                key={`grid-${debouncedQuery}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="grid grid-cols-2 gap-3"
              >
                {visible.map((auction, i) => (
                  <ResultCard
                    key={auction.id}
                    auction={auction}
                    index={i}
                    onClick={() => setLocation(`/auction/${auction.id}`)}
                  />
                ))}

                {/* Load more */}
                {hasMore && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="col-span-2 mt-1"
                  >
                    <button
                      onClick={() => setVisibleCount(v => v + PAGE_SIZE)}
                      className="w-full py-3.5 rounded-2xl border border-white/10 bg-white/4 text-sm font-semibold text-white/55 hover:bg-white/7 flex items-center justify-center gap-2 transition-colors active:scale-[0.98]"
                    >
                      <ChevronDown size={15} />
                      Load {Math.min(PAGE_SIZE, ranked.length - visibleCount)} more
                    </button>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </MobileLayout>
  );
}
