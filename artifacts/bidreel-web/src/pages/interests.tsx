import { useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useLang } from "@/contexts/LanguageContext";

const INTERESTS = [
  { id: "fishing",     emoji: "🎣", en: "Fishing" },
  { id: "cars",        emoji: "🚗", en: "Cars" },
  { id: "phones",      emoji: "📱", en: "Phones" },
  { id: "fashion",     emoji: "👗", en: "Fashion" },
  { id: "electronics", emoji: "⚡", en: "Electronics" },
  { id: "furniture",   emoji: "🪑", en: "Furniture" },
  { id: "watches",     emoji: "⌚", en: "Watches" },
  { id: "gaming",      emoji: "🎮", en: "Gaming" },
  { id: "sports",      emoji: "⚽", en: "Sports" },
  { id: "collectibles",emoji: "🏆", en: "Collectibles" },
  { id: "art",         emoji: "🎨", en: "Art" },
  { id: "jewelry",     emoji: "💎", en: "Jewelry" },
];

export default function Interests() {
  const [, setLocation] = useLocation();
  const { t } = useLang();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const proceed = () => {
    localStorage.setItem("hasSeenInterests", "1");
    setLocation("/feed");
  };

  return (
    <div className="relative w-full min-h-[100dvh] bg-background flex flex-col overflow-hidden">

      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-primary/15 rounded-full blur-[120px]" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col flex-1 px-5 pt-16 pb-10">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <h1 className="text-3xl font-bold text-white leading-tight mb-2">
            {t("interests_title")}
          </h1>
          <p className="text-base text-muted-foreground leading-snug">
            {t("interests_subtitle")}
          </p>
        </motion.div>

        {/* Chips grid */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="flex flex-wrap gap-3 flex-1"
        >
          {INTERESTS.map((item, i) => {
            const isOn = selected.has(item.id);
            return (
              <motion.button
                key={item.id}
                initial={{ opacity: 0, scale: 0.88 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: 0.05 * i }}
                whileTap={{ scale: 0.93 }}
                onClick={() => toggle(item.id)}
                className={[
                  "flex items-center gap-2 px-4 py-3 rounded-2xl border text-sm font-semibold transition-all duration-200",
                  isOn
                    ? "bg-primary/20 border-primary text-white shadow-md shadow-primary/20"
                    : "bg-white/5 border-white/10 text-white/60 hover:bg-white/8",
                ].join(" ")}
              >
                <span className="text-base leading-none">{item.emoji}</span>
                <span>{item.en}</span>
                <AnimatePresence>
                  {isOn && (
                    <motion.span
                      key="check"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="text-primary text-xs leading-none"
                    >
                      ✓
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            );
          })}
        </motion.div>

        {/* Bottom actions */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.4 }}
          className="mt-8 flex flex-col gap-3"
        >
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={proceed}
            className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-base shadow-lg shadow-primary/30 disabled:opacity-40"
          >
            {selected.size > 0
              ? `${t("interests_done")} · ${selected.size} selected`
              : t("interests_done")}
          </motion.button>
          <button
            onClick={proceed}
            className="w-full py-3 text-sm text-white/40 font-medium hover:text-white/70 transition-colors"
          >
            {t("interests_skip")}
          </button>
        </motion.div>
      </div>
    </div>
  );
}
