import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { X, Globe, Check, Menu, ShieldAlert, Lock } from "lucide-react";
import { useLocation } from "wouter";
import { useLang } from "@/contexts/LanguageContext";
import { type Language, LANGUAGE_NAMES } from "@/lib/i18n";

const LANGUAGES: Language[] = ["en", "ar", "ru", "es", "fr"];

const LANG_FLAG: Record<Language, string> = {
  en: "🇺🇸",
  ar: "🇸🇦",
  ru: "🇷🇺",
  es: "🇪🇸",
  fr: "🇫🇷",
};

interface HamburgerMenuProps {
  className?: string;
  /** Controlled mode: pass open state from the parent. When omitted the component is self-controlled. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function HamburgerMenu({ className = "", open: controlledOpen, onOpenChange }: HamburgerMenuProps) {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen! : internalOpen;
  const setOpen = (v: boolean) => {
    if (isControlled) { onOpenChange?.(v); }
    else { setInternalOpen(v); }
  };
  const { lang, setLang, t } = useLang();
  const [, navigate] = useLocation();

  const navigateTo = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  const drawer = (
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
            style={{ position: "fixed", inset: 0, zIndex: 8000, background: "rgba(0,0,0,0.60)", backdropFilter: "blur(4px)" }}
          />

          {/* Drawer */}
          <motion.div
            key="hm-drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 240 }}
            style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 288, maxWidth: "85vw", zIndex: 8001 }}
            className="bg-[#0c0c14] border-l border-white/8 flex flex-col overflow-hidden"
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
                          <span className="text-lg leading-none">{LANG_FLAG[l]}</span>
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

              {/* Navigation section */}
              <div>
                <div className="rounded-2xl bg-white/4 border border-white/8 overflow-hidden divide-y divide-white/6">
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => navigateTo("/safety-rules")}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/5"
                  >
                    <ShieldAlert size={16} className="text-amber-400 shrink-0" />
                    <span className="text-sm font-semibold text-white/70">{t("safety_rules")}</span>
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => navigateTo("/change-password")}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/5"
                  >
                    <Lock size={16} className="text-white/50 shrink-0" />
                    <span className="text-sm font-semibold text-white/70">{t("change_password")}</span>
                  </motion.button>
                </div>
              </div>

            </div>

            {/* Footer */}
            <div className="px-5 pb-8 pt-2 border-t border-white/6">
              <p className="text-[10px] text-white/20 text-center font-medium">BidReel MVP · v0.1</p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  // Controlled mode: caller manages open state — render only the drawer portal (no button).
  if (isControlled) {
    return typeof document !== "undefined" ? createPortal(drawer, document.body) : null;
  }

  return (
    <>
      {/* Trigger button — self-controlled mode only */}
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

      {typeof document !== "undefined" && createPortal(drawer, document.body)}
    </>
  );
}
