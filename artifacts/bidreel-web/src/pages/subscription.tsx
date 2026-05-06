import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Crown, Check, Zap, MessageCircle, ShieldCheck,
  TrendingDown, HeadphonesIcon, Sparkles, RotateCcw, FileText,
  Loader2, AlertCircle, CheckCircle2, Smartphone,
} from "lucide-react";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { useLang } from "@/contexts/LanguageContext";
import { useCurrentUser, refreshCurrentUser } from "@/hooks/use-current-user";
import {
  startSubscription, restoreSubscription, isSubscriptionAvailable,
} from "@/lib/subscription-billing";

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

const ERROR_LABELS: Record<string, { en: string; ar: string }> = {
  // Auth errors
  not_authenticated: {
    en: "Please sign in to subscribe.",
    ar: "سجّل الدخول أولاً للاشتراك.",
  },
  no_auth_token: {
    en: "Your session has expired. Please sign in again.",
    ar: "انتهت جلستك. سجّل الدخول مجدداً.",
  },

  // Purchase flow errors
  no_purchase_token: {
    en: "Purchase was not completed. Please try again.",
    ar: "لم يكتمل الشراء. حاول مرة أخرى.",
  },
  no_offer_token: {
    en: "BidReel Plus is temporarily unavailable. Please try again later.",
    ar: "بيدريل برو غير متاح مؤقتاً. حاول مرة أخرى لاحقاً.",
  },

  // Google Play Billing response codes
  play_billing_unavailable: {
    en: "Google Play Billing is unavailable. Please check your payment method is set up in Google Play, then try again.",
    ar: "خدمة الدفع عبر Google Play غير متاحة. تأكد من إعداد طريقة دفع في Google Play ثم أعد المحاولة.",
  },
  play_item_unavailable: {
    en: "BidReel Plus is not available in your region.",
    ar: "بيدريل برو غير متاح في منطقتك.",
  },
  play_service_unavailable: {
    en: "Google Play is temporarily unavailable. Please try again in a few minutes.",
    ar: "Google Play غير متاح مؤقتاً. حاول مرة أخرى بعد دقائق.",
  },
  play_item_already_owned: {
    en: "You already have an active subscription. Try restoring it below.",
    ar: "لديك اشتراك نشط بالفعل. جرّب استعادته أدناه.",
  },
  play_developer_error: {
    en: "A configuration error occurred with the subscription. Please contact support.",
    ar: "حدث خطأ في إعداد الاشتراك. تواصل مع الدعم.",
  },
  play_error: {
    en: "Google Play returned an error. Please try again.",
    ar: "أعاد Google Play خطأً. حاول مرة أخرى.",
  },

  // Backend errors
  BILLING_NOT_CONFIGURED: {
    en: "Subscription service is not yet configured on the server. Please contact support.",
    ar: "خدمة الاشتراك غير مهيأة على الخادم. تواصل مع الدعم.",
  },
  PURCHASE_INVALID: {
    en: "Subscription is not active or has expired. Please subscribe again.",
    ar: "الاشتراك غير نشط أو منتهي الصلاحية. اشترك مجدداً.",
  },
  GOOGLE_API_ERROR: {
    en: "Could not verify your subscription with Google. Please try again.",
    ar: "تعذر التحقق من اشتراكك مع Google. حاول مرة أخرى.",
  },
  DB_ERROR: {
    en: "Subscription verified but your account could not be updated. Please contact support.",
    ar: "تم التحقق من الاشتراك لكن تعذر تحديث حسابك. تواصل مع الدعم.",
  },

  // Restore errors
  no_active_subscription: {
    en: "No active subscription found. If you already subscribed, tap Subscribe — Google Play will not charge you again.",
    ar: "لا يوجد اشتراك نشط. إن كنت قد اشتركت سابقاً، اضغط اشترك — لن يتم خصم أي مبلغ إضافي.",
  },
};

function goBack() {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    window.location.replace("/");
  }
}

export default function SubscriptionPage() {
  const { lang } = useLang();
  const ar              = lang === "ar";

  const { user: currentUser } = useCurrentUser();
  const isPremium = currentUser?.isPremium ?? false;
  const isNative  = isSubscriptionAvailable();

  const [subscribing, setSubscribing] = useState(false);
  const [restoring,   setRestoring]   = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  function mapError(errorKey: string | undefined, fallbackEn: string, fallbackAr: string): string {
    if (errorKey && ERROR_LABELS[errorKey]) {
      return ar ? ERROR_LABELS[errorKey].ar : ERROR_LABELS[errorKey].en;
    }
    return ar ? fallbackAr : fallbackEn;
  }

  async function handleSubscribe() {
    if (subscribing || isPremium) return;
    setFeedback(null);
    setSubscribing(true);
    try {
      const result = await startSubscription(currentUser?.id ?? "");
      if (result.success) {
        setFeedback({
          type: "success",
          msg: ar ? "تم تفعيل اشتراكك بنجاح! 🎉" : "Subscription activated successfully! 🎉",
        });
        await refreshCurrentUser();
      } else if (
        result.error === "Purchase canceled" ||
        result.error === "play_user_canceled" ||
        result.error === "no_purchase_token"
      ) {
        // User dismissed the Play sheet — no feedback needed
      } else {
        setFeedback({
          type: "error",
          msg: mapError(result.error, "Subscription failed. Please try again.", "فشل الاشتراك. حاول مرة أخرى."),
        });
      }
    } finally {
      setSubscribing(false);
    }
  }

  async function handleRestore() {
    if (restoring) return;
    setFeedback(null);
    setRestoring(true);
    try {
      const result = await restoreSubscription(currentUser?.id ?? "");
      if (result.success) {
        setFeedback({
          type: "success",
          msg: ar ? "تم استعادة الاشتراك بنجاح ✅" : "Subscription restored successfully ✅",
        });
        await refreshCurrentUser();
      } else {
        setFeedback({
          type: "error",
          msg: mapError(result.error, "Could not restore subscription. Please try again.", "فشل استعادة الاشتراك. حاول مرة أخرى."),
        });
      }
    } finally {
      setRestoring(false);
    }
  }

  const btnDisabled = subscribing || isPremium;
  const btnLabel = (() => {
    if (isPremium)   return ar ? "مشترك بالفعل ✓" : "Already Subscribed ✓";
    if (subscribing) return ar ? "جارٍ الاشتراك..." : "Subscribing…";
    return ar ? "اشترك الآن" : "Subscribe Now";
  })();

  return (
    <MobileLayout>
      <div className="min-h-full bg-background" dir={ar ? "rtl" : "ltr"}>

        {/* Sticky header */}
        <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md border-b border-white/6 px-4 py-4 flex items-center gap-3">
          <button
            onClick={goBack}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/8 text-white/70 hover:text-white hover:bg-white/12 transition shrink-0"
            aria-label="Back"
          >
            <ArrowLeft size={18} className={ar ? "rotate-180" : ""} />
          </button>
          <div className="flex items-center gap-2 flex-1">
            <Crown size={16} className="text-primary" />
            <h1 className="text-base font-bold text-white">
              {ar ? "بيدريل برو" : "BidReel Pro"}
            </h1>
          </div>
          {isPremium && (
            <div className="flex items-center gap-1.5 bg-primary/15 border border-primary/25 rounded-lg px-2.5 py-1">
              <CheckCircle2 size={11} className="text-primary" />
              <span className="text-[10px] font-bold text-primary">
                {ar ? "مشترك" : "Active"}
              </span>
            </div>
          )}
        </div>

        <div className="px-4 py-6 max-w-lg mx-auto space-y-6 pb-14">

          {/* Hero */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className={`rounded-3xl overflow-hidden border ${
              isPremium
                ? "bg-gradient-to-b from-primary/30 via-violet-900/20 to-transparent border-primary/30"
                : "bg-gradient-to-b from-primary/25 via-violet-900/15 to-transparent border-primary/20"
            }`}
          >
            <div className="px-6 pt-8 pb-6 text-center">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg ${
                isPremium
                  ? "bg-primary/30 border border-primary/50 shadow-primary/30"
                  : "bg-primary/20 border border-primary/30 shadow-primary/20"
              }`}>
                <Crown size={30} className="text-primary" />
              </div>

              <h2 className="text-2xl font-black text-white tracking-tight">
                {ar ? "بيدريل برو" : "BidReel Pro"}
              </h2>
              <p className="text-sm text-white/55 mt-1.5 leading-snug">
                {isPremium
                  ? (ar ? "أنت مشترك! استمتع بجميع المزايا المميزة." : "You're subscribed! Enjoy all premium features.")
                  : (ar ? "أطلق العنان لقوة السوق المميزة" : "Unlock premium marketplace power")}
              </p>

              {!isPremium && (
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
              )}

              {isPremium && (
                <div className="mt-4 flex items-center justify-center gap-2 text-emerald-400">
                  <CheckCircle2 size={18} />
                  <span className="text-sm font-bold">
                    {ar ? "اشتراك نشط" : "Active subscription"}
                  </span>
                </div>
              )}
            </div>
          </motion.div>

          {/* Web-only notice */}
          {!isNative && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="rounded-xl bg-amber-500/8 border border-amber-500/20 px-4 py-3 flex items-start gap-2.5"
            >
              <Smartphone size={14} className="text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300/80 leading-snug">
                {ar
                  ? "الاشتراك متاح عبر تطبيق BidReel على Android فقط. حمّل التطبيق من Google Play للاشتراك."
                  : "Subscription is available in the BidReel Android app. Download it from Google Play to subscribe."}
              </p>
            </motion.div>
          )}

          {/* Features list */}
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
                  <div className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${
                    isPremium
                      ? "bg-emerald-500/15 border-emerald-500/25"
                      : "bg-primary/15 border-primary/20"
                  }`}>
                    <Icon size={14} className={isPremium ? "text-emerald-400" : "text-primary"} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white/90">{ar ? arText : en}</p>
                    <p className="text-xs text-white/40 mt-0.5 leading-snug">{ar ? sub_ar : sub_en}</p>
                  </div>
                  <Check size={14} className={`shrink-0 mt-1 ${isPremium ? "text-emerald-400" : "text-primary"}`} />
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Feedback banner */}
          <AnimatePresence>
            {feedback && (
              <motion.div
                key="feedback"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`rounded-2xl border px-4 py-3 flex items-start gap-2.5 ${
                  feedback.type === "success"
                    ? "bg-emerald-500/10 border-emerald-500/25"
                    : "bg-red-500/10 border-red-500/20"
                }`}
              >
                {feedback.type === "success"
                  ? <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                  : <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
                }
                <p className={`text-[12px] font-medium leading-snug ${
                  feedback.type === "success" ? "text-emerald-300" : "text-red-300"
                }`}>
                  {feedback.msg}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* CTA buttons */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.18 }}
            className="space-y-3"
          >
            <motion.button
              whileTap={{ scale: btnDisabled ? 1 : 0.97 }}
              onClick={() => { void handleSubscribe(); }}
              disabled={btnDisabled}
              className={`w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2.5 shadow-xl transition ${
                isPremium
                  ? "bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 cursor-default shadow-none"
                  : "bg-primary text-white shadow-primary/30 hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed"
              }`}
            >
              {subscribing ? (
                <Loader2 size={17} className="animate-spin" />
              ) : isPremium ? (
                <CheckCircle2 size={17} />
              ) : (
                <Crown size={17} />
              )}
              {btnLabel}
            </motion.button>

            {!isPremium && (
              <motion.button
                whileTap={{ scale: restoring ? 1 : 0.97 }}
                onClick={() => { void handleRestore(); }}
                disabled={restoring}
                className="w-full py-3 rounded-2xl bg-white/5 border border-white/10 text-white/50 font-semibold text-sm flex items-center justify-center gap-2 hover:bg-white/8 transition disabled:opacity-60"
              >
                {restoring
                  ? <Loader2 size={14} className="animate-spin" />
                  : <RotateCcw size={14} />
                }
                {restoring
                  ? (ar ? "جارٍ الاستعادة..." : "Restoring…")
                  : (ar ? "استعادة الاشتراك" : "Restore Subscription")}
              </motion.button>
            )}
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
                  ? "يمكن الإلغاء في أي وقت من إعدادات حسابك في Google Play. لا تُسترد المبالغ عن الفترات الجزئية."
                  : "Cancel anytime from your Google Play account settings. Partial periods are non-refundable."}
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
