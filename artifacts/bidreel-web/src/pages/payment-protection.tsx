import { useLocation } from "wouter";
import { ArrowLeft, Crown, ShieldCheck, Check, Zap, MessageCircle, Lock, TrendingDown, HeadphonesIcon, Handshake, BadgeCheck, Users, AlertTriangle, Sparkles } from "lucide-react";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { motion } from "framer-motion";
import { useLang } from "@/contexts/LanguageContext";

const PRO_FEATURES = [
  { icon: Zap,              en: "Extended & unlimited bidding",     ar: "مزايدة ممتدة وغير محدودة" },
  { icon: MessageCircle,    en: "Permanent WhatsApp access",        ar: "وصول دائم عبر واتساب" },
  { icon: ShieldCheck,      en: "Secure Deals access",              ar: "الوصول إلى الصفقات الآمنة" },
  { icon: TrendingDown,     en: "Lower marketplace fees",           ar: "رسوم منصة أقل" },
  { icon: HeadphonesIcon,   en: "Priority support",                 ar: "دعم ذو أولوية" },
  { icon: Sparkles,         en: "Early access to premium tools",    ar: "وصول مبكر للأدوات المميزة" },
];

const DEAL_FEATURES = [
  { icon: Lock,             en: "Protected payments",               ar: "مدفوعات محمية" },
  { icon: Handshake,        en: "Manual escrow",                    ar: "ضمان يدوي (إسكرو)" },
  { icon: BadgeCheck,       en: "Buyer & seller safety",            ar: "حماية المشتري والبائع" },
  { icon: Users,            en: "Dispute support",                  ar: "دعم النزاعات" },
  { icon: AlertTriangle,    en: "Fraud prevention",                 ar: "منع الاحتيال" },
];

export default function PaymentProtectionPage() {
  const [, setLocation] = useLocation();
  const { lang } = useLang();
  const ar = lang === "ar";

  return (
    <MobileLayout>
      <div className="min-h-full bg-background" dir={ar ? "rtl" : "ltr"}>

        {/* Header */}
        <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md border-b border-white/6 px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => setLocation(-1 as any)}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/8 text-white/70 hover:text-white hover:bg-white/12 transition shrink-0"
            aria-label="Back"
          >
            <ArrowLeft size={18} className={ar ? "rotate-180" : ""} />
          </button>
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-primary" />
            <h1 className="text-base font-bold text-white">
              {ar ? "الدفع والحماية" : "Payment & Protection"}
            </h1>
          </div>
        </div>

        {/* Body */}
        <div className="px-4 py-6 space-y-5 max-w-lg mx-auto pb-12">

          <p className="text-xs text-white/40 leading-relaxed text-center px-2">
            {ar
              ? "اختر الخطة المناسبة لك للاستمتاع بتجربة مزادات آمنة وغير محدودة."
              : "Choose the plan that works for you and enjoy safe, unlimited auction experiences."}
          </p>

          {/* Card 1 — BidReel Pro */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="rounded-3xl bg-gradient-to-b from-white/8 to-white/3 border border-white/10 overflow-hidden"
          >
            {/* Card header band */}
            <div className="bg-gradient-to-r from-primary/30 to-violet-600/20 px-5 pt-5 pb-4 border-b border-white/8">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center">
                  <Crown size={14} className="text-primary" />
                </div>
                <span className="text-xs font-bold text-primary uppercase tracking-widest">
                  {ar ? "بريدريل برو" : "BidReel Pro"}
                </span>
              </div>
              <p className="text-sm text-white/60 leading-snug mt-1">
                {ar
                  ? "احصل على أفضل تجربة مزادات مع وصول كامل غير محدود."
                  : "Get the best auction experience with full unlimited access."}
              </p>
            </div>

            {/* Pricing */}
            <div className="px-5 pt-4 pb-3 border-b border-white/6">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-3xl font-black text-white">$10</span>
                <span className="text-sm font-semibold text-white/50">USD / {ar ? "شهر" : "month"}</span>
              </div>
              <p className="text-xs text-white/35 mt-0.5">
                ≈ 37.50 SAR / {ar ? "شهرياً" : "month"} &nbsp;·&nbsp; ≈ 9.20 EUR
              </p>
            </div>

            {/* Features */}
            <ul className="px-5 py-4 space-y-3">
              {PRO_FEATURES.map(({ icon: Icon, en, ar: arText }) => (
                <li key={en} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
                    <Icon size={12} className="text-primary" />
                  </div>
                  <span className="text-sm text-white/80 font-medium">{ar ? arText : en}</span>
                  <Check size={13} className="text-primary ms-auto shrink-0" />
                </li>
              ))}
            </ul>

            {/* CTA */}
            <div className="px-5 pb-5">
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => setLocation("/subscription")}
                className="w-full py-3.5 rounded-2xl bg-primary text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-primary/30 hover:brightness-110 transition"
              >
                <Crown size={15} />
                {ar ? "ترقية الآن" : "Upgrade Now"}
              </motion.button>
            </div>
          </motion.div>

          {/* Card 2 — Secure Deal */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.08 }}
            className="rounded-3xl bg-gradient-to-b from-white/8 to-white/3 border border-white/10 overflow-hidden"
          >
            {/* Card header band */}
            <div className="bg-gradient-to-r from-emerald-600/20 to-teal-600/10 px-5 pt-5 pb-4 border-b border-white/8">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                  <ShieldCheck size={14} className="text-emerald-400" />
                </div>
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-widest">
                  {ar ? "الصفقة الآمنة" : "Secure Deal"}
                </span>
              </div>
              <p className="text-sm text-white/60 leading-snug mt-1">
                {ar
                  ? "بيع وشراء محمي داخل المزادات وخارجها."
                  : "Protected buying and selling inside or outside auctions."}
              </p>
            </div>

            {/* Features */}
            <ul className="px-5 py-4 space-y-3">
              {DEAL_FEATURES.map(({ icon: Icon, en, ar: arText }) => (
                <li key={en} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0">
                    <Icon size={12} className="text-emerald-400" />
                  </div>
                  <span className="text-sm text-white/80 font-medium">{ar ? arText : en}</span>
                  <Check size={13} className="text-emerald-400 ms-auto shrink-0" />
                </li>
              ))}
            </ul>

            {/* CTA */}
            <div className="px-5 pb-5">
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => setLocation("/secure-deals/create")}
                className="w-full py-3.5 rounded-2xl bg-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 hover:brightness-110 transition"
              >
                <ShieldCheck size={15} />
                {ar ? "إنشاء صفقة آمنة" : "Create Secure Deal"}
              </motion.button>
            </div>
          </motion.div>

          <p className="text-[10px] text-white/20 text-center leading-relaxed px-4">
            {ar
              ? "الأسعار المحلية تقريبية وقد تختلف حسب طريقة الدفع."
              : "Local currency prices are approximate and may vary by payment method."}
          </p>

        </div>
      </div>
    </MobileLayout>
  );
}
