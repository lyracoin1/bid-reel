import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowLeft, Crown, Check, Zap, MessageCircle, ShieldCheck,
  TrendingDown, HeadphonesIcon, Sparkles, RotateCcw, FileText,
} from "lucide-react";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { useLang } from "@/contexts/LanguageContext";

const FEATURES = [
  {
    icon: Zap,
    en: "Unlimited monthly bidding",
    ar: "مزايدة شهرية غير محدودة",
    sub_en: "Bid as many times as you want each month",
    sub_ar: "زايد بلا حدود كل شهر",
  },
  {
    icon: MessageCircle,
    en: "Permanent WhatsApp seller access",
    ar: "وصول دائم لواتساب البائعين",
    sub_en: "Contact any seller directly, always",
    sub_ar: "تواصل مع أي بائع مباشرة في أي وقت",
  },
  {
    icon: ShieldCheck,
    en: "Secure Deals eligibility",
    ar: "أهلية الصفقات الآمنة",
    sub_en: "Buy and sell with full escrow protection",
    sub_ar: "تداول بحماية إسكرو كاملة",
  },
  {
    icon: TrendingDown,
    en: "Lower protected transaction fees",
    ar: "رسوم معاملات محمية أقل",
    sub_en: "Keep more of what you earn",
    sub_ar: "احتفظ بمزيد من أرباحك",
  },
  {
    icon: HeadphonesIcon,
    en: "Priority customer support",
    ar: "دعم عملاء ذو أولوية",
    sub_en: "Jump the queue with faster responses",
    sub_ar: "استجابة أسرع وخدمة مميزة",
  },
  {
    icon: Sparkles,
    en: "Early access to premium tools",
    ar: "وصول مبكر للأدوات المميزة",
    sub_en: "Be first to try new BidReel features",
    sub_ar: "كن أول من يجرب مميزات بيدريل الجديدة",
  },
];

export default function SubscriptionPage() {
  const [, setLocation] = useLocation();
  const { lang } = useLang();
  const ar = lang === "ar";

  return (
    <MobileLayout>
      <div className="min-h-full bg-background" dir={ar ? "rtl" : "ltr"}>

        {/* Sticky header */}
        <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md border-b border-white/6 px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => setLocation(-1 as any)}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/8 text-white/70 hover:text-white hover:bg-white/12 transition shrink-0"
            aria-label="Back"
          >
            <ArrowLeft size={18} className={ar ? "rotate-180" : ""} />
          </button>
          <div className="flex items-center gap-2">
            <Crown size={16} className="text-primary" />
            <h1 className="text-base font-bold text-white">
              {ar ? "بيدريل برو" : "BidReel Pro"}
            </h1>
          </div>
        </div>

        <div className="px-4 py-6 max-w-lg mx-auto space-y-6 pb-14">

          {/* Hero */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="rounded-3xl overflow-hidden bg-gradient-to-b from-primary/25 via-violet-900/15 to-transparent border border-primary/20"
          >
            <div className="px-6 pt-8 pb-6 text-center">
              {/* Logo mark */}
              <div className="w-16 h-16 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/20">
                <Crown size={30} className="text-primary" />
              </div>

              <h2 className="text-2xl font-black text-white tracking-tight">
                {ar ? "بيدريل برو" : "BidReel Pro"}
              </h2>
              <p className="text-sm text-white/55 mt-1.5 leading-snug">
                {ar
                  ? "أطلق العنان لقوة السوق المميزة"
                  : "Unlock premium marketplace power"}
              </p>

              {/* Pricing */}
              <div className="mt-5 inline-flex flex-col items-center gap-0.5">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-4xl font-black text-white">$10</span>
                  <span className="text-base font-semibold text-white/50">
                    USD / {ar ? "شهر" : "month"}
                  </span>
                </div>
                <p className="text-xs text-white/35">
                  ≈ 37.50 SAR &nbsp;·&nbsp; ≈ 9.20 EUR &nbsp;·&nbsp; ≈ 36.80 AED
                </p>
                <span className="mt-2 text-[10px] font-semibold text-primary/80 bg-primary/10 border border-primary/20 rounded-full px-3 py-0.5 tracking-wide uppercase">
                  {ar ? "اشتراك شهري" : "Monthly subscription"}
                </span>
              </div>
            </div>
          </motion.div>

          {/* Features */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.07 }}
          >
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3 px-1">
              {ar ? "ما تحصل عليه" : "What you get"}
            </p>
            <div className="rounded-3xl bg-white/4 border border-white/8 overflow-hidden divide-y divide-white/6">
              {FEATURES.map(({ icon: Icon, en, ar: arText, sub_en, sub_ar }, i) => (
                <motion.div
                  key={en}
                  initial={{ opacity: 0, x: ar ? 10 : -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, delay: 0.1 + i * 0.04 }}
                  className="flex items-start gap-3.5 px-4 py-3.5"
                >
                  <div className="w-8 h-8 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                    <Icon size={14} className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white/90">{ar ? arText : en}</p>
                    <p className="text-xs text-white/40 mt-0.5 leading-snug">{ar ? sub_ar : sub_en}</p>
                  </div>
                  <Check size={14} className="text-primary shrink-0 mt-1" />
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.18 }}
            className="space-y-3"
          >
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                // Placeholder — billing integration goes here
                console.log("[Subscription] Subscribe Now tapped — billing not yet connected");
              }}
              className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-xl shadow-primary/30 hover:brightness-110 transition"
            >
              <Crown size={17} />
              {ar ? "اشترك الآن" : "Subscribe Now"}
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                // Placeholder — restore logic goes here
                console.log("[Subscription] Restore tapped — not yet connected");
              }}
              className="w-full py-3 rounded-2xl bg-white/5 border border-white/10 text-white/50 font-semibold text-sm flex items-center justify-center gap-2 hover:bg-white/8 transition"
            >
              <RotateCcw size={14} />
              {ar ? "استعادة الاشتراك" : "Restore Subscription"}
            </motion.button>
          </motion.div>

          {/* Legal */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.28 }}
            className="rounded-2xl bg-white/3 border border-white/6 px-4 py-4 space-y-2"
          >
            <div className="flex items-start gap-2.5">
              <FileText size={12} className="text-white/25 mt-0.5 shrink-0" />
              <p className="text-[11px] text-white/30 leading-relaxed">
                {ar
                  ? "يتجدد الاشتراك تلقائياً بمبلغ 10 دولار شهرياً حتى يتم الإلغاء."
                  : "Subscription auto-renews at $10 USD/month until cancelled."}
              </p>
            </div>
            <div className="flex items-start gap-2.5">
              <FileText size={12} className="text-white/25 mt-0.5 shrink-0" />
              <p className="text-[11px] text-white/30 leading-relaxed">
                {ar
                  ? "يمكن الإلغاء في أي وقت من إعدادات حسابك. لا تُسترد المبالغ عن الفترات الجزئية."
                  : "Cancel anytime from your account settings. Partial periods are non-refundable."}
              </p>
            </div>
            <div className="flex items-start gap-2.5">
              <FileText size={12} className="text-white/25 mt-0.5 shrink-0" />
              <p className="text-[11px] text-white/30 leading-relaxed">
                {ar
                  ? "باشتراكك فإنك توافق على شروط الخدمة وسياسة الخصوصية الخاصة ببيدريل."
                  : "By subscribing you agree to BidReel's Terms of Service and Privacy Policy."}
              </p>
            </div>
          </motion.div>

        </div>
      </div>
    </MobileLayout>
  );
}
