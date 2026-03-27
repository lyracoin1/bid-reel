import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Globe, DollarSign, Check, Menu } from "lucide-react";
import { useLang } from "@/contexts/LanguageContext";
import { type Language, type CurrencyMode, LANGUAGE_NAMES, CURRENCY_MAP } from "@/lib/i18n";

const LANGUAGES: Language[] = ["en", "ar", "ru", "es", "fr"];

interface HamburgerMenuProps {
  /** Additional className for the trigger button */
  className?: string;
}

export function HamburgerMenu({ className = "" }: HamburgerMenuProps) {
  const [open, setOpen] = useState(false);
  const { lang, setLang, currencyMode, setCurrencyMode, t } = useLang();

  return (
    <>
      {/* Trigger button */}
      <motion.button
        whileTap={{ scale: 0.88 }}
        onClick={() => setOpen(true)}
        aria-label="Open settings"
        className={[
          "w-10 h-10 rounded-full bg-black/50 backdrop-blur-md border border-white/12",
          "flex items-center justify-center text-white",
          className,
        ].join(" ")}
      >
        <Menu size={18} />
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              key="hm-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70]"
            />

            {/* Drawer */}
            <motion.div
              key="hm-drawer"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 240 }}
              className="fixed top-0 right-0 bottom-0 w-72 max-w-[85vw] z-[80] bg-[#0c0c14] border-l border-white/8 flex flex-col overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-14 pb-5 border-b border-white/6">
                <h2 className="text-base font-bold text-white">Settings</h2>
                <motion.button
                  whileTap={{ scale: 0.88 }}
                  onClick={() => setOpen(false)}
                  className="w-8 h-8 rounded-full bg-white/8 border border-white/10 flex items-center justify-center text-white/60"
                >
                  <X size={15} />
                </motion.button>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto px-4 py-5 space-y-6">

                {/* Language section */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Globe size={14} className="text-white/40" />
                    <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
                      {t("language")}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white/4 border border-white/8 overflow-hidden divide-y divide-white/6">
                    {LANGUAGES.map((l) => {
                      const active = lang === l;
                      return (
                        <motion.button
                          key={l}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => { setLang(l); setOpen(false); }}
                          className="w-full flex items-center justify-between px-4 py-3.5 text-left transition-colors hover:bg-white/5"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-lg leading-none">{CURRENCY_MAP[l].flag}</span>
                            <span className={`text-sm font-semibold ${active ? "text-white" : "text-white/60"}`}>
                              {LANGUAGE_NAMES[l]}
                            </span>
                          </div>
                          {active && (
                            <motion.div
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              className="w-5 h-5 rounded-full bg-primary flex items-center justify-center"
                            >
                              <Check size={11} className="text-white" />
                            </motion.div>
                          )}
                        </motion.button>
                      );
                    })}
                  </div>
                </div>

                {/* Currency section */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <DollarSign size={14} className="text-white/40" />
                    <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
                      {t("currency_mode")}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white/4 border border-white/8 overflow-hidden divide-y divide-white/6">
                    {(["usd", "local"] as CurrencyMode[]).map((mode) => {
                      const active = currencyMode === mode;
                      const label =
                        mode === "usd"
                          ? `$ ${t("currency_usd")}`
                          : `${CURRENCY_MAP[lang].flag} ${t("currency_local")} · ${CURRENCY_MAP[lang].symbol}`;
                      return (
                        <motion.button
                          key={mode}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => { setCurrencyMode(mode); setOpen(false); }}
                          className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-white/5 transition-colors"
                        >
                          <span className={`text-sm font-semibold ${active ? "text-white" : "text-white/60"}`}>
                            {label}
                          </span>
                          {active && (
                            <motion.div
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              className="w-5 h-5 rounded-full bg-primary flex items-center justify-center"
                            >
                              <Check size={11} className="text-white" />
                            </motion.div>
                          )}
                        </motion.button>
                      );
                    })}
                  </div>
                </div>

              </div>

              {/* Footer — connection status */}
              <div className="px-5 pb-8 pt-2 border-t border-white/6">
                <p className="text-[10px] text-white/20 text-center font-medium">BidReel MVP · v0.1</p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
