import { useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Crown, Check, Zap, MessageCircle, ShieldCheck,
  TrendingDown, HeadphonesIcon, Sparkles, RotateCcw, FileText,
<<<<<<< HEAD
  Loader2, AlertCircle, CheckCircle2, Smartphone,
} from "lucide-react";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { useLang } from "@/contexts/LanguageContext";
import { useCurrentUser, refreshCurrentUser } from "@/hooks/use-current-user";
import {
  startSubscription, restoreSubscription, isSubscriptionAvailable,
=======
  Loader2, AlertCircle, CheckCircle2,
} from "lucide-react";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { useLang } from "@/contexts/LanguageContext";
import { useCurrentUser } from "@/hooks/use-current-user";
import {
  startSubscription,
  restoreSubscription,
  isSubscriptionAvailable,
>>>>>>> 72e2340 (Add subscription functionality and fix translation and hook issues)
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

export default function SubscriptionPage() {
  const [, setLocation] = useLocation();
<<<<<<< HEAD
  const { lang }        = useLang();
  const ar              = lang === "ar";

  const { user, isLoading: userLoading } = useCurrentUser();
  const isPremium   = user?.isPremium ?? false;
  const isNative    = isSubscriptionAvailable();

  // Subscribe button state
  const [subscribing,    setSubscribing]    = useState(false);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);
  const [subscribeOk,    setSubscribeOk]    = useState(false);

  // Restore button state
  const [restoring,    setRestoring]    = useState(false);
  const [restoreMsg,   setRestoreMsg]   = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  async function handleSubscribe() {
    if (!user || isPremium || subscribing) return;
    setSubscribeError(null);
    setSubscribing(true);

    try {
      const result = await startSubscription(user.id);

      if (result === "web") {
        setSubscribeError(
          ar
            ? "الاشتراك متاح فقط عبر تطبيق BidReel على Android. حمّل التطبيق من Google Play."
            : "Subscription is only available in the BidReel Android app. Download it from Google Play.",
        );
        return;
      }

      if (result === "cancelled") {
        // User dismissed — no error needed, just stop loading
        return;
      }

      // success — refresh user profile so isPremium updates
      setSubscribeOk(true);
      await refreshCurrentUser();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[Subscription] subscribe failed:", msg);
      setSubscribeError(
        ar
          ? `فشل الاشتراك: ${msg}`
          : `Subscription failed: ${msg}`,
      );
=======
  const { lang } = useLang();
  const ar = lang === "ar";
  const { user: currentUser } = useCurrentUser();

  const [subscribing, setSubscribing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const nativeAvailable = isSubscriptionAvailable();

  async function handleSubscribe() {
    if (subscribing) return;
    setFeedback(null);
    setSubscribing(true);
    try {
      const result = await startSubscription(currentUser?.id ?? "");
      if (result.success) {
        setFeedback({
          type: "success",
          msg: ar ? "تم تفعيل اشتراكك بنجاح! 🎉" : "Subscription activated successfully! 🎉",
        });
      } else {
        const errorMap: Record<string, { en: string; ar: string }> = {
          not_authenticated: { en: "Please sign in to subscribe.", ar: "سجّل الدخول أولاً للاشتراك." },
          no_purchase_token: { en: "Purchase was not completed. Please try again.", ar: "لم يكتمل الشراء. حاول مرة أخرى." },
          no_auth_token: { en: "Session expired. Please sign in again.", ar: "انتهت الجلسة. سجّل الدخول مجدداً." },
        };
        const mapped = result.error ? errorMap[result.error] : null;
        setFeedback({
          type: "error",
          msg: mapped ? (ar ? mapped.ar : mapped.en)
            : (ar ? "فشل الاشتراك. حاول مرة أخرى." : "Subscription failed. Please try again."),
        });
      }
>>>>>>> 72e2340 (Add subscription functionality and fix translation and hook issues)
    } finally {
      setSubscribing(false);
    }
  }

  async function handleRestore() {
<<<<<<< HEAD
    if (!user || restoring) return;
    setRestoreMsg(null);
    setRestoreError(null);
    setRestoring(true);

    try {
      if (!isNative) {
        setRestoreMsg(
          ar
            ? "استعادة الاشتراك متاحة فقط عبر تطبيق Android. Google Play يستعيد اشتراكك تلقائياً عند تثبيت التطبيق."
            : "Restore is only available in the Android app. Google Play automatically restores your subscription on install.",
        );
        return;
      }

      const restored = await restoreSubscription(user.id);
      if (restored) {
        setRestoreMsg(ar ? "✓ تم استعادة الاشتراك بنجاح." : "✓ Subscription restored successfully.");
        await refreshCurrentUser();
      } else {
        setRestoreMsg(
          ar
            ? "لم يتم العثور على اشتراك نشط. إذا اشتركت مسبقاً، يتولى Google Play استعادته تلقائياً."
            : "No active subscription found. If you subscribed before, Google Play restores it automatically.",
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setRestoreError(ar ? `فشل الاستعادة: ${msg}` : `Restore failed: ${msg}`);
=======
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
      } else if (result.error === "no_active_subscription") {
        setFeedback({
          type: "error",
          msg: ar ? "لم يتم العثور على اشتراك نشط لهذا الحساب." : "No active subscription found for this account.",
        });
      } else {
        setFeedback({
          type: "error",
          msg: ar ? "فشل استعادة الاشتراك. حاول مرة أخرى." : "Could not restore subscription. Please try again.",
        });
      }
>>>>>>> 72e2340 (Add subscription functionality and fix translation and hook issues)
    } finally {
      setRestoring(false);
    }
  }
<<<<<<< HEAD

  // Derive button label & state
  const btnDisabled = subscribing || isPremium || userLoading;
  const btnLabel = (() => {
    if (userLoading) return ar ? "..." : "...";
    if (isPremium)   return ar ? "مشترك بالفعل ✓" : "Already Subscribed ✓";
    if (subscribing) return ar ? "جارٍ الاشتراك..." : "Subscribing…";
    return ar ? "اشترك الآن" : "Subscribe Now";
  })();
=======
>>>>>>> 72e2340 (Add subscription functionality and fix translation and hook issues)

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
<<<<<<< HEAD
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg ${
                isPremium
                  ? "bg-primary/30 border border-primary/50 shadow-primary/30"
                  : "bg-primary/20 border border-primary/30 shadow-primary/20"
              }`}>
=======
              <div className="w-16 h-16 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/20">
>>>>>>> 72e2340 (Add subscription functionality and fix translation and hook issues)
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

              {/* Pricing */}
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

          {/* Web-only notice (non-Android) */}
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
          {feedback && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
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

          {/* Web fallback notice */}
          {!nativeAvailable && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-2xl bg-amber-500/8 border border-amber-500/20 px-4 py-3 flex items-start gap-2.5"
            >
              <AlertCircle size={13} className="text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-300/80 leading-relaxed">
                {ar
                  ? "الاشتراك متاح فقط عبر تطبيق BidReel للأندرويد. يرجى تثبيت التطبيق من متجر Play."
                  : "Subscriptions are available only on the BidReel Android app. Please install it from the Play Store."}
              </p>
            </motion.div>
          )}

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.18 }}
            className="space-y-3"
          >
            {/* Subscribe error */}
            <AnimatePresence>
              {subscribeError && (
                <motion.div
                  key="sub-err"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="rounded-xl bg-red-500/10 border border-red-500/20 px-3.5 py-3 flex items-start gap-2.5"
                >
                  <AlertCircle size={13} className="text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-300 leading-snug">{subscribeError}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Subscribe success */}
            <AnimatePresence>
              {subscribeOk && !subscribeError && (
                <motion.div
                  key="sub-ok"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3.5 py-3 flex items-center gap-2.5"
                >
                  <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                  <p className="text-xs text-emerald-300 font-semibold">
                    {ar ? "تم الاشتراك بنجاح! أنت الآن عضو مميز." : "Subscribed! You're now a Pro member."}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Main CTA button */}
            <motion.button
<<<<<<< HEAD
              whileTap={{ scale: btnDisabled ? 1 : 0.97 }}
              onClick={handleSubscribe}
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

            {/* Restore button — only for free users */}
            {!isPremium && (
              <>
                <motion.button
                  whileTap={{ scale: restoring ? 1 : 0.97 }}
                  onClick={handleRestore}
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

                {/* Restore feedback */}
                <AnimatePresence>
                  {(restoreMsg || restoreError) && (
                    <motion.div
                      key="restore-msg"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className={`rounded-xl px-3.5 py-3 flex items-start gap-2.5 border ${
                        restoreError
                          ? "bg-red-500/10 border-red-500/20"
                          : "bg-white/5 border-white/10"
                      }`}
                    >
                      {restoreError
                        ? <AlertCircle size={13} className="text-red-400 shrink-0 mt-0.5" />
                        : <CheckCircle2 size={13} className="text-white/40 shrink-0 mt-0.5" />
                      }
                      <p className={`text-xs leading-snug ${restoreError ? "text-red-300" : "text-white/50"}`}>
                        {restoreError ?? restoreMsg}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
=======
              whileTap={{ scale: 0.97 }}
              onClick={() => { void handleSubscribe(); }}
              disabled={subscribing || !nativeAvailable}
              className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-xl shadow-primary/30 hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {subscribing
                ? <Loader2 size={17} className="animate-spin" />
                : <Crown size={17} />
              }
              {subscribing
                ? (ar ? "جارٍ الاشتراك..." : "Subscribing...")
                : (ar ? "اشترك الآن" : "Subscribe Now")}
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => { void handleRestore(); }}
              disabled={restoring || !nativeAvailable}
              className="w-full py-3 rounded-2xl bg-white/5 border border-white/10 text-white/50 font-semibold text-sm flex items-center justify-center gap-2 hover:bg-white/8 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {restoring
                ? <Loader2 size={14} className="animate-spin" />
                : <RotateCcw size={14} />
              }
              {restoring
                ? (ar ? "جارٍ الاستعادة..." : "Restoring...")
                : (ar ? "استعادة الاشتراك" : "Restore Subscription")}
            </motion.button>
>>>>>>> 72e2340 (Add subscription functionality and fix translation and hook issues)
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
