import { useState, useEffect, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, ShieldCheck, Package, FileText, DollarSign,
  Truck, StickyNote, Lock, Image, Video,
  CheckCircle2, Clock, Bell, PartyPopper, AlertCircle,
  Loader2, UserX, RefreshCw, User,
} from "lucide-react";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { useLang } from "@/contexts/LanguageContext";
import { useCurrentUser } from "@/hooks/use-current-user";
import {
  getTransaction, updatePaymentStatus, sendPaymentNotification,
  Transaction, PaymentStatus, ShipmentStatus,
} from "@/lib/transactions";

// ── Deal UI status (derived from DB payment_status + shipment_status) ─────────

type DealStatus = "awaiting_payment" | "payment_secured" | "shipment_verified" | "delivered";

function deriveDealStatus(tx: Transaction): DealStatus {
  if (tx.payment_status === "pending")                              return "awaiting_payment";
  if (tx.payment_status === "secured" && tx.shipment_status === "pending")   return "payment_secured";
  if (tx.payment_status === "secured" && tx.shipment_status === "verified")  return "shipment_verified";
  if (tx.payment_status === "secured" && tx.shipment_status === "delivered") return "delivered";
  return "awaiting_payment";
}

// ── Stepper ───────────────────────────────────────────────────────────────────

const STEPS: { key: DealStatus; en: string; ar: string }[] = [
  { key: "payment_secured",   en: "Payment Secured",     ar: "تم تأمين الدفع"      },
  { key: "shipment_verified", en: "Shipment Verified",   ar: "تم التحقق من الشحن"  },
  { key: "delivered",         en: "Delivered",           ar: "تم الاستلام"          },
];

function stepIndex(status: DealStatus) {
  if (status === "awaiting_payment")  return -1;
  if (status === "payment_secured")   return 0;
  if (status === "shipment_verified") return 1;
  return 2;
}

function DealStepper({ status, ar }: { status: DealStatus; ar: boolean }) {
  const current = stepIndex(status);
  return (
    <div className="flex items-start gap-0 w-full" dir="ltr">
      {STEPS.map((step, i) => {
        const done   = i <= current;
        const active = i === current;
        return (
          <div key={step.key} className="flex-1 flex items-start">
            <div className="flex flex-col items-center shrink-0 w-full">
              <div className="flex items-center w-full">
                {/* Left connector */}
                <div className={`flex-1 h-0.5 rounded-full transition-colors ${i === 0 ? "invisible" : (i <= current ? "bg-emerald-500/60" : "bg-white/10")}`} />
                <motion.div
                  animate={active ? { scale: [1, 1.15, 1] } : {}}
                  transition={{ duration: 1.6, repeat: Infinity }}
                  className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition-colors ${
                    done ? "bg-emerald-500 border-emerald-500" : "bg-white/5 border-white/15"
                  }`}
                >
                  {done
                    ? <CheckCircle2 size={13} className="text-white" />
                    : <span className="text-[10px] font-bold text-white/30">{i + 1}</span>
                  }
                </motion.div>
                {/* Right connector */}
                <div className={`flex-1 h-0.5 rounded-full transition-colors ${i === STEPS.length - 1 ? "invisible" : (i < current ? "bg-emerald-500/60" : "bg-white/10")}`} />
              </div>
              <span className={`mt-1.5 text-[9px] font-bold text-center leading-tight max-w-[64px] px-1 ${done ? "text-emerald-400" : "text-white/25"}`}>
                {ar ? step.ar : step.en}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DetailRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-3.5 border-b border-white/6 last:border-0">
      <div className="w-7 h-7 rounded-lg bg-white/6 border border-white/10 flex items-center justify-center shrink-0 mt-0.5">
        <Icon size={13} className="text-white/40" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-0.5">{label}</p>
        <p className="text-sm text-white/85 leading-snug">{value}</p>
      </div>
    </div>
  );
}

function ShipmentBanner({ ar }: { ar: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0,   scale: 1 }}
      transition={{ duration: 0.35, type: "spring", stiffness: 200 }}
      className="rounded-2xl bg-blue-500/10 border border-blue-500/25 px-4 py-4 flex items-start gap-3"
    >
      <div className="relative shrink-0 mt-0.5">
        <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center">
          <Truck size={16} className="text-blue-400" />
        </div>
        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-background flex items-center justify-center">
          <Bell size={7} className="text-white" />
        </span>
      </div>
      <div className="flex-1">
        <p className="text-sm font-bold text-blue-300 leading-tight">
          {ar ? "🚚 طلبك في الطريق إليك!" : "🚚 Your item is on the way!"}
        </p>
        <p className="text-[11px] text-white/45 mt-1 leading-relaxed">
          {ar
            ? "قام البائع بتأكيد شحن المنتج. بمجرد استلامه، أكّد الاستلام لتحرير الأموال."
            : "The seller has verified shipment. Once received, confirm delivery to release funds to the seller."}
        </p>
      </div>
    </motion.div>
  );
}

function DeliveredBanner({ ar }: { ar: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, type: "spring" }}
      className="rounded-2xl bg-emerald-500/10 border border-emerald-500/25 px-4 py-4 flex items-center gap-3"
    >
      <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0">
        <PartyPopper size={16} className="text-emerald-400" />
      </div>
      <div>
        <p className="text-sm font-bold text-emerald-300">
          {ar ? "🎉 تمت الصفقة بنجاح!" : "🎉 Deal completed successfully!"}
        </p>
        <p className="text-[11px] text-white/40 mt-0.5">
          {ar ? "تم تحرير الأموال للبائع. شكراً لاستخدامك بيدريل." : "Funds released to the seller. Thank you for using BidReel."}
        </p>
      </div>
    </motion.div>
  );
}

// ── Auth / Profile gate screens ───────────────────────────────────────────────

function GateScreen({
  icon: Icon, iconColor, title, body, btnLabel, onBtn,
}: {
  icon: React.ElementType; iconColor: string; title: string;
  body: string; btnLabel: string; onBtn: () => void;
}) {
  return (
    <div className="min-h-full bg-background flex flex-col items-center justify-center gap-4 px-6 text-center">
      <div className={`w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center`}>
        <Icon size={24} className={iconColor} />
      </div>
      <div>
        <p className="text-base font-bold text-white">{title}</p>
        <p className="text-sm text-white/40 mt-1 leading-relaxed">{body}</p>
      </div>
      <button
        onClick={onBtn}
        className="mt-2 px-6 py-3 rounded-2xl bg-primary text-white font-bold text-sm hover:brightness-110 transition"
      >
        {btnLabel}
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SecureDealPayPage() {
  const [, setLocation] = useLocation();
  const { dealId }      = useParams<{ dealId: string }>();
  const { lang }        = useLang();
  const ar              = lang === "ar";

  const { user, isLoading: authLoading } = useCurrentUser();

  // Transaction state
  const [tx, setTx]             = useState<Transaction | null>(null);
  const [txLoading, setTxLoading] = useState(true);
  const [txError, setTxError]   = useState<string | null>(null);

  // UI status (derived from TX once loaded; updated optimistically on pay)
  const [dealStatus, setDealStatus] = useState<DealStatus>("awaiting_payment");

  // Action state
  const [paying, setPaying]         = useState(false);
  const [payError, setPayError]     = useState<string | null>(null);
  const [paySuccess, setPaySuccess] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // ── Load transaction ──
  const loadTx = useCallback(async () => {
    if (!dealId) return;
    setTxLoading(true);
    setTxError(null);
    try {
      const data = await getTransaction(dealId);
      if (!data) {
        setTxError(ar ? "لم يتم العثور على الصفقة." : "Deal not found.");
      } else {
        setTx(data);
        setDealStatus(deriveDealStatus(data));
        if (data.payment_status === "secured") setPaySuccess(true);
      }
    } catch {
      setTxError(ar ? "فشل تحميل الصفقة." : "Failed to load deal.");
    } finally {
      setTxLoading(false);
    }
  }, [dealId, ar]);

  useEffect(() => { loadTx(); }, [loadTx]);

  // ── Pay Now ──────────────────────────────────────────────────────────────────
  // PAYMENT GATEWAY INTEGRATION POINT:
  //   Replace the simulated delay below with your real charge call:
  //     Android: Google Play Billing (via Capacitor plugin)
  //     Web: Stripe / PayPal / etc.
  //   Call updatePaymentStatus() ONLY after the gateway confirms success.
  async function handlePayNow() {
    if (!user || !tx || paying || dealStatus !== "awaiting_payment") return;
    setPaying(true);
    setPayError(null);

    try {
      // ── PLACEHOLDER: simulate gateway latency ─────────────────────────────
      // Replace this block with the real gateway charge call.
      await new Promise<void>(resolve => setTimeout(resolve, 1600));
      // ─────────────────────────────────────────────────────────────────────

      // Record payment in Supabase
      await updatePaymentStatus(tx.deal_id, user.id, tx.price, tx.currency);

      // Placeholder notification (logs to console; wire real FCM/Email here)
      sendPaymentNotification(tx.deal_id, user.id, tx.price, tx.currency);

      // Optimistic UI update
      setDealStatus("payment_secured");
      setPaySuccess(true);
      setTx(prev => prev ? { ...prev, payment_status: "secured", buyer_id: user.id } : prev);

      console.log("[SecureDeal] ✓ Payment secured:", {
        dealId: tx.deal_id, buyerId: user.id,
        amount: tx.price, currency: tx.currency,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[SecureDeal] Payment failed:", msg);
      setPayError(ar ? `فشل الدفع: ${msg}` : `Payment failed: ${msg}`);
    } finally {
      setPaying(false);
    }
  }

  // Demo only: simulate seller verifying shipment (dev/testing convenience)
  function handleSimulateShipment() {
    if (dealStatus !== "payment_secured") return;
    setDealStatus("shipment_verified");
    console.log("[SecureDeal] Demo: status → shipment_verified (simulating seller action)");
  }

  function handleConfirmReceipt() {
    if (confirming || dealStatus !== "shipment_verified") return;
    setConfirming(true);
    setTimeout(() => {
      setDealStatus("delivered");
      setConfirming(false);
      console.log("[SecureDeal] Demo: status → delivered (placeholder)");
    }, 1200);
  }

  // ── Auth loading ──
  if (authLoading || txLoading) {
    return (
      <MobileLayout>
        <div className="min-h-full bg-background flex items-center justify-center">
          <Loader2 size={28} className="text-primary animate-spin" />
        </div>
      </MobileLayout>
    );
  }

  // ── Not logged in ──
  if (!user) {
    return (
      <MobileLayout>
        <GateScreen
          icon={UserX}
          iconColor="text-red-400"
          title={ar ? "يجب تسجيل الدخول أولاً" : "Sign in required"}
          body={ar
            ? "يجب أن تكون مسجلاً للدفع عبر الصفقات الآمنة."
            : "You must be signed in to pay via Secure Deals."}
          btnLabel={ar ? "تسجيل الدخول" : "Sign In"}
          onBtn={() => setLocation("/login")}
        />
      </MobileLayout>
    );
  }

  // ── Deal not found / error ──
  if (txError || !tx) {
    return (
      <MobileLayout>
        <div className="min-h-full bg-background flex flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <AlertCircle size={24} className="text-red-400" />
          </div>
          <div>
            <p className="text-base font-bold text-white">
              {ar ? "تعذّر تحميل الصفقة" : "Could not load deal"}
            </p>
            <p className="text-sm text-white/40 mt-1">{txError ?? (ar ? "صفقة غير موجودة" : "Deal not found")}</p>
          </div>
          <button
            onClick={loadTx}
            className="mt-2 flex items-center gap-2 px-5 py-3 rounded-2xl bg-white/8 text-white/70 font-medium text-sm hover:bg-white/12 hover:text-white transition"
          >
            <RefreshCw size={14} /> {ar ? "إعادة المحاولة" : "Retry"}
          </button>
        </div>
      </MobileLayout>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────────
  const priceFormatted = tx.price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const alreadyPaid    = tx.payment_status !== "pending";

  return (
    <MobileLayout>
      <div className="min-h-full bg-background" dir={ar ? "rtl" : "ltr"}>

        {/* ── Header ── */}
        <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md border-b border-white/6 px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => setLocation(-1 as any)}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/8 text-white/70 hover:text-white hover:bg-white/12 transition shrink-0"
            aria-label="Back"
          >
            <ArrowLeft size={18} className={ar ? "rotate-180" : ""} />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
            <h1 className="text-base font-bold text-white truncate">
              {ar ? "صفقة آمنة" : "Secure Deal"}
            </h1>
          </div>
          <span className="text-[10px] font-bold text-white/30 bg-white/5 border border-white/8 rounded-lg px-2 py-1 shrink-0 font-mono">
            {tx.deal_id}
          </span>
        </div>

        <div className="px-4 py-5 max-w-lg mx-auto space-y-4 pb-14">

          {/* ── Notification banners ── */}
          <AnimatePresence mode="wait">
            {dealStatus === "shipment_verified" && (
              <motion.div key="ship" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <ShipmentBanner ar={ar} />
              </motion.div>
            )}
            {dealStatus === "delivered" && (
              <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <DeliveredBanner ar={ar} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Payment-secured confirmation banner ── */}
          <AnimatePresence>
            {paySuccess && dealStatus === "payment_secured" && (
              <motion.div
                key="pay-ok"
                initial={{ opacity: 0, y: -8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 200 }}
                className="rounded-2xl bg-emerald-600/15 border border-emerald-500/30 px-4 py-3.5 flex items-start gap-3"
              >
                <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-emerald-300">
                    {ar ? "✓ تم تأمين الدفع (وضع تجريبي)" : "✓ Payment secured (placeholder)"}
                  </p>
                  <p className="text-[11px] text-white/40 mt-0.5 leading-snug">
                    {ar
                      ? `تم حفظ الدفع في قاعدة البيانات — الصفقة: ${tx.deal_id}`
                      : `Payment recorded in database — Deal: ${tx.deal_id}`}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Progress stepper (always visible, dims when pending) ── */}
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="rounded-2xl bg-white/4 border border-white/8 px-5 py-4"
          >
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-4 text-center">
              {ar ? "مراحل الصفقة" : "Deal Progress"}
            </p>

            {/* Awaiting payment row above stepper */}
            {dealStatus === "awaiting_payment" && (
              <div className="flex items-center gap-2 mb-4 justify-center">
                <div className="relative shrink-0">
                  <Clock size={14} className="text-amber-400" />
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                </div>
                <p className="text-xs font-semibold text-amber-300">
                  {ar ? "في انتظار الدفع" : "Awaiting Payment"}
                </p>
              </div>
            )}

            <DealStepper status={dealStatus} ar={ar} />
          </motion.div>

          {/* ── Media / Product header card ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.04 }}
            className="rounded-2xl bg-white/4 border border-white/8 overflow-hidden"
          >
            {tx.media_urls.length > 0 ? (
              tx.media_urls[0].match(/\.(mp4|mov|webm)$/i)
                ? <video src={tx.media_urls[0]} className="w-full max-h-56 object-cover" controls />
                : <img src={tx.media_urls[0]} alt={tx.product_name} className="w-full max-h-56 object-cover" />
            ) : (
              <div className="aspect-video bg-gradient-to-br from-white/5 to-transparent flex flex-col items-center justify-center gap-2 border-b border-white/6">
                <div className="flex gap-3 text-white/15">
                  <Image size={22} />
                  <Video size={22} />
                </div>
                <p className="text-[10px] text-white/20">
                  {ar ? "لا توجد وسائط مرفقة" : "No media attached"}
                </p>
              </div>
            )}
            <div className="px-4 py-3">
              <p className="text-base font-bold text-white">{tx.product_name}</p>
              <p className="text-xs text-white/40 mt-0.5">{tx.delivery_method}</p>
            </div>
          </motion.div>

          {/* ── Deal details card ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.07 }}
            className="rounded-3xl bg-white/4 border border-white/8 overflow-hidden"
          >
            <div className="bg-gradient-to-r from-white/5 to-transparent px-5 pt-4 pb-3 border-b border-white/6">
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
                {ar ? "تفاصيل الصفقة" : "Deal Details"}
              </p>
            </div>
            <div className="px-4">
              <DetailRow icon={Package}  label={ar ? "المنتج"        : "Product"}     value={tx.product_name} />
              {tx.description && (
                <DetailRow icon={FileText} label={ar ? "الوصف"        : "Description"} value={tx.description} />
              )}
              <DetailRow icon={Truck}    label={ar ? "طريقة التسليم" : "Delivery"}    value={tx.delivery_method} />
              <DetailRow
                icon={User}
                label={ar ? "البائع" : "Seller"}
                value={tx.seller_id.slice(0, 8).toUpperCase() + "…"}
              />
              {tx.terms && (
                <DetailRow icon={StickyNote} label={ar ? "الشروط" : "Terms"} value={tx.terms} />
              )}
            </div>
          </motion.div>

          {/* ── Payment card ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.11 }}
            className="rounded-3xl bg-gradient-to-b from-white/6 to-white/3 border border-white/10 overflow-hidden"
          >
            <div className="bg-gradient-to-r from-emerald-600/15 to-transparent px-5 pt-4 pb-3 border-b border-white/6">
              <div className="flex items-center gap-2">
                <Lock size={12} className="text-emerald-400" />
                <p className="text-[10px] font-bold text-emerald-400/80 uppercase tracking-widest">
                  {ar ? "ملخص الدفع" : "Payment Summary"}
                </p>
              </div>
            </div>

            <div className="px-5 py-5 space-y-4">

              {/* Amount */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-white/50">
                  <DollarSign size={14} />
                  <span className="text-sm">{ar ? "المبلغ الإجمالي" : "Total Amount"}</span>
                </div>
                <p className="text-2xl font-black text-white">
                  {priceFormatted}
                  <span className="text-base font-semibold text-white/50 ms-1.5">{tx.currency}</span>
                </p>
              </div>

              {/* Escrow note */}
              <div className="rounded-xl bg-emerald-900/20 border border-emerald-500/20 px-3.5 py-3 flex items-start gap-2.5">
                <ShieldCheck size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-white/50 leading-relaxed">
                  {ar
                    ? "ستُحتجز أموالك بأمان في حساب ضمان (إسكرو) ولن تُرسل للبائع حتى تأكيد الاستلام."
                    : "Your funds will be held in escrow and only released to the seller after you confirm receipt."}
                </p>
              </div>

              {/* Pay error */}
              <AnimatePresence>
                {payError && (
                  <motion.div
                    key="pay-err"
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="rounded-xl bg-red-500/10 border border-red-500/20 px-3.5 py-3 flex items-start gap-2"
                  >
                    <AlertCircle size={13} className="text-red-400 shrink-0 mt-0.5" />
                    <p className="text-[12px] text-red-300 leading-snug">{payError}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Action buttons ── */}
              <AnimatePresence mode="wait">

                {/* ① Awaiting payment → Pay Now */}
                {dealStatus === "awaiting_payment" && (
                  <motion.button
                    key="pay-btn"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    whileTap={{ scale: paying ? 1 : 0.97 }}
                    onClick={handlePayNow}
                    disabled={paying}
                    className="w-full py-4 rounded-2xl bg-emerald-600 text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-700/30 hover:brightness-110 transition disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {paying ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        {ar ? "جارٍ المعالجة..." : "Processing..."}
                      </>
                    ) : (
                      <>
                        <Lock size={16} />
                        {ar
                          ? `ادفع الآن — ${priceFormatted} ${tx.currency}`
                          : `Pay Now — ${priceFormatted} ${tx.currency}`}
                      </>
                    )}
                  </motion.button>
                )}

                {/* ② Payment secured → waiting for seller */}
                {dealStatus === "payment_secured" && (
                  <motion.div
                    key="secured-state"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="space-y-2.5"
                  >
                    <div className="w-full py-3.5 rounded-2xl bg-emerald-600/15 border border-emerald-500/30 text-emerald-300 font-bold text-sm flex items-center justify-center gap-2">
                      <CheckCircle2 size={15} />
                      {ar ? "تم تأمين الدفع — بانتظار الشحن" : "Payment Secured — Awaiting Shipment"}
                    </div>
                    <button
                      onClick={handleSimulateShipment}
                      className="w-full py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/35 text-[11px] font-medium hover:text-white/50 hover:bg-white/8 transition"
                    >
                      {ar ? "محاكاة (اختبار): البائع يؤكد الشحن ←" : "← Demo: Simulate seller verifying shipment"}
                    </button>
                  </motion.div>
                )}

                {/* ③ Shipment verified → Confirm Receipt */}
                {dealStatus === "shipment_verified" && (
                  <motion.button
                    key="confirm-btn"
                    initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                    whileTap={{ scale: confirming ? 1 : 0.97 }}
                    onClick={handleConfirmReceipt}
                    disabled={confirming}
                    className="w-full py-4 rounded-2xl bg-blue-600 text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-lg shadow-blue-700/30 hover:brightness-110 transition disabled:opacity-70"
                  >
                    {confirming ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        {ar ? "جارٍ التأكيد..." : "Confirming..."}
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={16} />
                        {ar ? "تأكيد الاستلام — تحرير الأموال" : "Confirm Receipt — Release Funds"}
                      </>
                    )}
                  </motion.button>
                )}

                {/* ④ Delivered */}
                {dealStatus === "delivered" && (
                  <motion.div
                    key="delivered-state"
                    initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
                    className="w-full py-4 rounded-2xl bg-emerald-600/15 border border-emerald-500/25 text-emerald-300 font-bold text-base flex items-center justify-center gap-2.5"
                  >
                    <CheckCircle2 size={17} />
                    {ar ? "اكتملت الصفقة — تم تحرير الأموال" : "Deal Complete — Funds Released"}
                  </motion.div>
                )}

              </AnimatePresence>

              <p className="text-[10px] text-white/20 text-center">
                {ar
                  ? "الدفع الحقيقي غير مفعّل حالياً — جاهز للربط بـ Google Play Billing أو أي بوابة دفع."
                  : "Real payment not active — ready for Google Play Billing or any payment gateway integration."}
              </p>
            </div>
          </motion.div>

          {/* ── Dispute / safety note ── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.18 }}
            className="rounded-2xl bg-white/3 border border-white/6 px-4 py-3.5 flex items-start gap-3"
          >
            <ShieldCheck size={13} className="text-white/20 shrink-0 mt-0.5" />
            <p className="text-[11px] text-white/30 leading-relaxed">
              {ar
                ? "هل لديك مشكلة؟ يمكنك فتح نزاع خلال 7 أيام من تاريخ الدفع. ستقوم إدارة بيدريل بمراجعة الصفقة والفصل بها."
                : "Having an issue? You can open a dispute within 7 days of payment. BidReel admin will review and arbitrate."}
            </p>
          </motion.div>

        </div>
      </div>
    </MobileLayout>
  );
}
