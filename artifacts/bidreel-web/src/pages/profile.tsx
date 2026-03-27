import { useState } from "react";
import { Settings, Grid, Gavel, LogOut, Globe, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { currentUser, mockAuctions } from "@/lib/mock-data";
import { getTimeRemaining } from "@/lib/utils";
import { useLang } from "@/contexts/LanguageContext";
import { type Language, type CurrencyMode, LANGUAGE_NAMES, CURRENCY_MAP } from "@/lib/i18n";

type Tab = "listings" | "bids";

const LANGUAGES: Language[] = ["en", "ar", "ru", "es", "fr"];

export default function Profile() {
  const [activeTab, setActiveTab] = useState<Tab>("listings");
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [showCurrPicker, setShowCurrPicker] = useState(false);
  const [, setLocation] = useLocation();
  const { t, lang, setLang, currencyMode, setCurrencyMode, formatPrice } = useLang();

  const myListings = mockAuctions.filter(a => a.seller.id === currentUser.id);
  const myBids     = mockAuctions.filter(a => a.bids.some(b => b.user.id === currentUser.id));

  const tabs: { id: Tab; labelKey: "listings" | "my_bids"; icon: typeof Grid; count: number }[] = [
    { id: "listings", labelKey: "listings", icon: Grid,  count: myListings.length },
    { id: "bids",     labelKey: "my_bids",  icon: Gavel, count: myBids.length },
  ];

  return (
    <MobileLayout>
      <div className="min-h-full bg-background">

        {/* ── Hero header ── */}
        <div className="relative px-5 pt-14 pb-6 overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 bg-primary/12 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 flex items-start justify-between mb-5">
            <div className="flex items-center gap-4">
              <div className="relative">
                <img src={currentUser.avatar} alt={currentUser.name} className="w-20 h-20 rounded-2xl object-cover ring-2 ring-white/10" />
                <div className="absolute -bottom-1.5 -right-1.5 w-5 h-5 rounded-full bg-emerald-400 border-2 border-background" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white leading-none">{currentUser.name}</h1>
                <p className="text-sm text-muted-foreground mt-1">{currentUser.handle}</p>
              </div>
            </div>

            {/* Settings / Language */}
            <div className="flex gap-2">
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowLangPicker(v => !v)}
                className="w-10 h-10 rounded-xl bg-white/6 border border-white/10 flex items-center justify-center text-white relative"
              >
                <Globe size={18} />
                {/* Language badge */}
                <span className="absolute -top-1 -right-1 text-[8px] font-bold bg-primary text-white rounded-full px-1 uppercase leading-4">
                  {lang}
                </span>
              </motion.button>
              <button className="w-10 h-10 rounded-xl bg-white/6 border border-white/10 flex items-center justify-center text-white">
                <Settings size={18} />
              </button>
            </div>
          </div>

          {/* Language picker dropdown */}
          <AnimatePresence>
            {showLangPicker && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }}
                transition={{ duration: 0.15 }}
                className="relative z-20 mb-4 rounded-2xl bg-[#111118] border border-white/10 overflow-hidden shadow-xl"
              >
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest px-4 pt-3 pb-2">{t("language")}</p>
                {LANGUAGES.map(l => (
                  <button
                    key={l}
                    onClick={() => { setLang(l); setShowLangPicker(false); }}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-white/6 transition-colors"
                  >
                    <span className={lang === l ? "text-white font-semibold" : "text-white/60"}>{LANGUAGE_NAMES[l]}</span>
                    {lang === l && <Check size={14} className="text-primary" />}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Currency mode picker */}
          <div className="relative z-10 mb-5">
            <button
              onClick={() => { setShowCurrPicker(v => !v); setShowLangPicker(false); }}
              className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-white/5 border border-white/8 hover:bg-white/8 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <span className="text-base">💱</span>
                <div className="text-start">
                  <p className="text-xs font-bold text-white/40 uppercase tracking-widest leading-none">{t("currency_mode")}</p>
                  <p className="text-sm font-semibold text-white mt-0.5">
                    {currencyMode === "usd"
                      ? t("currency_usd")
                      : `${CURRENCY_MAP[lang].flag} ${t("currency_local")}`}
                  </p>
                </div>
              </div>
              <motion.div animate={{ rotate: showCurrPicker ? 180 : 0 }} transition={{ duration: 0.2 }}>
                <Check size={14} className={showCurrPicker ? "text-primary" : "text-white/20"} />
              </motion.div>
            </button>

            <AnimatePresence>
              {showCurrPicker && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full left-0 right-0 mt-1.5 rounded-2xl bg-[#111118] border border-white/10 overflow-hidden shadow-xl z-30"
                >
                  {(["usd", "local"] as CurrencyMode[]).map(mode => {
                    const isActive = currencyMode === mode;
                    const label = mode === "usd"
                      ? `$ ${t("currency_usd")}`
                      : `${CURRENCY_MAP[lang].flag} ${t("currency_local")} · ${CURRENCY_MAP[lang].flag} ${CURRENCY_MAP[lang].symbol}`;
                    return (
                      <button
                        key={mode}
                        onClick={() => { setCurrencyMode(mode); setShowCurrPicker(false); }}
                        className="w-full flex items-center justify-between px-4 py-3.5 text-sm hover:bg-white/6 transition-colors"
                      >
                        <span className={isActive ? "text-white font-semibold" : "text-white/55"}>{label}</span>
                        {isActive && <Check size={14} className="text-primary" />}
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 relative z-10">
            {[
              { labelKey: "listings" as const, value: myListings.length },
              { labelKey: "bids_won" as const, value: 4 },
              { labelKey: "rating" as const,   value: "4.9★" },
            ].map(stat => (
              <div key={stat.labelKey} className="bg-white/5 border border-white/8 rounded-2xl py-3 text-center">
                <p className="text-xl font-bold text-white leading-none">{stat.value}</p>
                <p className="text-[11px] text-muted-foreground mt-1 font-medium">{t(stat.labelKey)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="px-5 mb-1">
          <div className="flex bg-white/5 border border-white/8 rounded-2xl p-1">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className="relative flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-colors">
                  {isActive && <motion.div layoutId="profile-tab-bg" className="absolute inset-0 bg-white/10 rounded-xl" />}
                  <Icon size={15} className={isActive ? "text-primary relative z-10" : "text-white/35 relative z-10"} />
                  <span className={isActive ? "text-white relative z-10" : "text-white/35 relative z-10"}>{t(tab.labelKey)}</span>
                  {tab.count > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full relative z-10 ${isActive ? "bg-primary/25 text-primary" : "bg-white/8 text-white/40"}`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Tab content ── */}
        <div className="px-5 pt-3 pb-6">
          {activeTab === "listings" && (
            myListings.length > 0 ? (
              <div className="grid grid-cols-2 gap-3">
                {myListings.map(auction => {
                  const timeInfo = getTimeRemaining(auction.endsAt);
                  return (
                    <motion.div key={auction.id} whileTap={{ scale: 0.97 }}
                      onClick={() => setLocation(`/auction/${auction.id}`)}
                      className="rounded-2xl bg-white/5 border border-white/8 overflow-hidden cursor-pointer">
                      <div className="aspect-[3/4] relative">
                        <img src={auction.mediaUrl} className="w-full h-full object-cover" alt={auction.title} />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                        <div className="absolute bottom-0 left-0 right-0 p-3">
                          <p className="text-xs font-bold text-white line-clamp-1">{auction.title}</p>
                          <p className="text-sm font-bold text-white mt-0.5">{formatPrice(auction.currentBid)}</p>
                          <p className={`text-[10px] font-bold mt-1 ${timeInfo.isUrgent ? "text-red-400" : "text-emerald-400"}`}>{timeInfo.text}</p>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="py-16 text-center">
                <p className="text-muted-foreground text-sm">{t("no_listings")}</p>
                <button onClick={() => setLocation("/create")} className="mt-4 px-6 py-3 rounded-xl bg-primary text-white text-sm font-bold">
                  {t("create_first")}
                </button>
              </div>
            )
          )}

          {activeTab === "bids" && (
            <div className="space-y-3">
              {myBids.map(auction => {
                const timeInfo = getTimeRemaining(auction.endsAt);
                const myBid = auction.bids.find(b => b.user.id === currentUser.id);
                const isLeading = auction.bids[0]?.user.id === currentUser.id;
                return (
                  <motion.div key={auction.id} whileTap={{ scale: 0.98 }}
                    onClick={() => setLocation(`/auction/${auction.id}`)}
                    className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/8 cursor-pointer">
                    <div className="w-16 h-20 rounded-xl overflow-hidden shrink-0">
                      <img src={auction.mediaUrl} className="w-full h-full object-cover" alt={auction.title} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-white text-sm line-clamp-1">{auction.title}</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Current: <span className="text-white font-bold">{formatPrice(auction.currentBid)}</span>
                      </p>
                      {myBid && <p className="text-xs text-muted-foreground">Your bid: <span className="text-white">{formatPrice(myBid.amount)}</span></p>}
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isLeading ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
                          {isLeading ? t("leading") : t("outbid")}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{timeInfo.text}</span>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* Logout */}
        <div className="px-5 pb-8">
          <button onClick={() => setLocation("/")}
            className="w-full py-3.5 rounded-2xl border border-white/8 bg-white/3 flex items-center justify-center gap-2 text-sm font-semibold text-white/50 hover:text-white/80 hover:bg-white/6 transition">
            <LogOut size={16} />{t("log_out")}
          </button>
        </div>
      </div>
    </MobileLayout>
  );
}
