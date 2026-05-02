import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, ShieldCheck, Package, FileText, DollarSign,
  Truck, StickyNote, Lock, AlertTriangle, Image, Video,
  CheckCircle2, Clock, Bell, PartyPopper,
} from "lucide-react";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { useLang } from "@/contexts/LanguageContext";

// ── Placeholder deal data seeded from deal ID ────────────────────────────────

function seedFromId(id: string) {
  const n = id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const items = [
    { name: "Authentic Rolex Watch", nameAr: "ساعة رولكس أصلية", price: 2800, currency: "USD", delivery: "In-person handover", deliveryAr: "تسليم شخصي", desc: "Genuine Rolex Submariner, 2019, box & papers included. Minor scratches on bracelet.", descAr: "رولكس سوبمارينر أصلية 2019 مع الصندوق والأوراق. خدوش بسيطة على السوار.", terms: "No returns after physical inspection.", termsAr: "لا إرجاع بعد الفحص المادي." },
    { name: "iPhone 15 Pro Max", nameAr: "آيفون 15 برو ماكس", price: 1200, currency: "USD", delivery: "Shipping (seller arranges)", deliveryAr: "شحن (البائع يرتب)", desc: "256GB, Natural Titanium. Used 3 months, excellent condition, no scratches.", descAr: "256 جيجا، تيتانيوم طبيعي. استخدام 3 أشهر، حالة ممتازة.", terms: "Shipped within 48 hours of payment.", termsAr: "شحن خلال 48 ساعة من الدفع." },
    { name: "Vintage Camera Collection", nameAr: "مجموعة كاميرات كلاسيكية", price: 450, currency: "EUR", delivery: "Courier (agreed by both)", deliveryAr: "مندوب (باتفاق الطرفين)", desc: "Lot of 4 film cameras: Leica M3, Olympus OM-1, Nikon F2, Canon AE-1. All functional.", descAr: "مجموعة من 4 كاميرات فيلمية: ليكا، أوليمبوس، نيكون، كانون. كلها تعمل.", terms: "As-is, tested and confirmed working.", termsAr: "كما هي، تم التأكد من عملها." },
  ];
  return items[n % items.length];
}

// ── Status type ───────────────────────────────────────────────────────────────

type DealStatus = "awaiting_payment" | "payment_secured" | "shipment_verified" | "delivered";

const STATUS_STEPS: { key: DealStatus; en: string; ar: string }[] = [
  { key: "payment_secured",    en: "Payment Secured",    ar: "تم تأمين الدفع"   },
  { key: "shipment_verified",  en: "Shipment Verified",  ar: "تم التحقق من الشحن" },
  { key: "delivered",          en: "Delivered",          ar: "تم الاستلام"       },
];

function stepIndex(status: DealStatus) {
  if (status === "awaiting_payment")  return -1;
  if (status === "payment_secured")   return 0;
  if (status === "shipment_verified") return 1;
  return 2;
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

// Progress stepper
function DealStepper({ status, ar }: { status: DealStatus; ar: boolean }) {
  const current = stepIndex(status);
  return (
    <div className="flex items-center gap-0 w-full" dir="ltr">
      {STATUS_STEPS.map((step, i) => {
        const done    = i <= current;
        const active  = i === current;
        return (
          <div key={step.key} className="flex-1 flex items-center">
            {/* Circle */}
            <div className="flex flex-col items-center shrink-0">
              <motion.div
                animate={active ? { scale: [1, 1.12, 1] } : {}}
                transition={{ duration: 1.6, repeat: Infinity }}
                className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition-colors ${
                  done
                    ? "bg-emerald-500 border-emerald-500"
                    : "bg-white/5 border-white/15"
                }`}
              >
                {done
                  ? <CheckCircle2 size={13} className="text-white" />
                  : <span className="text-[10px] font-bold text-white/30">{i + 1}</span>
                }
              </motion.div>
              <span className={`mt-1.5 text-[9px] font-bold text-center leading-tight max-w-[64px] ${done ? "text-emerald-400" : "text-white/25"}`}>
                {ar ? step.ar : step.en}
              </span>
            </div>
            {/* Connector */}
            {i < STATUS_STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 mt-[-18px] rounded-full transition-colors ${i < current ? "bg-emerald-500/60" : "bg-white/8"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Shipment notification banner
function ShipmentNotificationBanner({ ar }: { ar: boolean }) {
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

// Delivery confirmed banner
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SecureDealPayPage() {
  const [, setLocation] = useLocation();
  const { dealId } = useParams<{ dealId: string }>();
  const { lang } = useLang();
  const ar = lang === "ar";

  const deal = seedFromId(dealId ?? "BD-DEFAULT");

  // Unified deal status
  const [status, setStatus]   = useState<DealStatus>("awaiting_payment");
  const [paying, setPaying]   = useState(false);
  const [confirming, setConfirming] = useState(false);

  function handlePayNow() {
    if (paying || status !== "awaiting_payment") return;
    setPaying(true);
    console.log("[SecureDeal] Pay Now — placeholder. Deal:", dealId);
    setTimeout(() => {
      setStatus("payment_secured");
      setPaying(false);
      console.log("[SecureDeal] Status → payment_secured (placeholder)");
    }, 1400);
  }

  // Demo only: simulate seller verifying shipment
  function handleSimulateShipment() {
    if (status !== "payment_secured") return;
    setStatus("shipment_verified");
    console.log("[SecureDeal] Status → shipment_verified (placeholder — simulating seller action)");
  }

  function handleConfirmReceipt() {
    if (confirming || status !== "shipment_verified") return;
    setConfirming(true);
    console.log("[SecureDeal] Confirm Receipt — placeholder. Deal:", dealId);
    setTimeout(() => {
      setStatus("delivered");
      setConfirming(false);
      console.log("[SecureDeal] Status → delivered (placeholder)");
    }, 1200);
  }

  const currentStep = stepIndex(status);

  return (
    <MobileLayout>
      <div className="min-h-full bg-background" dir={ar ? "rtl" : "ltr"}>

        {/* Header */}
        <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md border-b border-white/6 px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => setLocation(-1 as any)}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/8 text-white/70 hover:text-white hover:bg-white/12 transition shrink-0"
          >
            <ArrowLeft size={18} className={ar ? "rotate-180" : ""} />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
            <h1 className="text-base font-bold text-white truncate">
              {ar ? "تفاصيل الصفقة الآمنة" : "Secure Deal"}
            </h1>
          </div>
          <span className="text-[10px] font-bold text-white/30 bg-white/5 border border-white/8 rounded-lg px-2 py-1 shrink-0 font-mono">
            {dealId}
          </span>
        </div>

        <div className="px-4 py-5 max-w-lg mx-auto space-y-4 pb-14">

          {/* ── Notification banners (shipment / delivered) ── */}
          <AnimatePresence mode="wait">
            {status === "shipment_verified" && (
              <motion.div key="ship-notif" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <ShipmentNotificationBanner ar={ar} />
              </motion.div>
            )}
            {status === "delivered" && (
              <motion.div key="done-notif" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <DeliveredBanner ar={ar} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Progress stepper (shown after payment secured) ── */}
          <AnimatePresence>
            {status !== "awaiting_payment" && (
              <motion.div
                key="stepper"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="rounded-2xl bg-white/4 border border-white/8 px-5 py-4"
              >
                <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-4 text-center">
                  {ar ? "مراحل الصفقة" : "Deal Progress"}
                </p>
                <DealStepper status={status} ar={ar} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Awaiting payment status banner ── */}
          <AnimatePresence>
            {status === "awaiting_payment" && (
              <motion.div
                key="awaiting-banner"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-2xl border bg-amber-500/10 border-amber-500/25 px-4 py-3.5 flex items-center gap-3"
              >
                <div className="relative shrink-0">
                  <Clock size={18} className="text-amber-400" />
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                </div>
                <div>
                  <p className="text-sm font-bold text-amber-300">
                    {ar ? "بانتظار الدفع" : "Awaiting Payment"}
                  </p>
                  <p className="text-[11px] text-white/40 mt-0.5">
                    {ar ? "في انتظار إتمام الدفع من المشتري." : "Waiting for buyer to complete payment."}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Media preview placeholder ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="rounded-2xl bg-white/4 border border-white/8 overflow-hidden"
          >
            <div className="aspect-video bg-gradient-to-br from-white/5 to-transparent flex flex-col items-center justify-center gap-2 border-b border-white/6">
              <div className="flex gap-3 text-white/15">
                <Image size={22} />
                <Video size={22} />
              </div>
              <p className="text-[10px] text-white/20">
                {ar ? "لا توجد وسائط مرفقة" : "No media attached"}
              </p>
            </div>
            <div className="px-4 py-3">
              <p className="text-base font-bold text-white">{ar ? deal.nameAr : deal.name}</p>
              <p className="text-xs text-white/40 mt-0.5">{ar ? deal.deliveryAr : deal.delivery}</p>
            </div>
          </motion.div>

          {/* ── Deal details card ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.06 }}
            className="rounded-3xl bg-white/4 border border-white/8 overflow-hidden"
          >
            <div className="bg-gradient-to-r from-white/5 to-transparent px-5 pt-4 pb-3 border-b border-white/6">
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
                {ar ? "تفاصيل الصفقة" : "Deal Details"}
              </p>
            </div>
            <div className="px-4">
              <DetailRow icon={Package}    label={ar ? "المنتج"        : "Product"}     value={ar ? deal.nameAr     : deal.name} />
              <DetailRow icon={FileText}   label={ar ? "الوصف"         : "Description"} value={ar ? deal.descAr     : deal.desc} />
              <DetailRow icon={Truck}      label={ar ? "طريقة التسليم" : "Delivery"}    value={ar ? deal.deliveryAr : deal.delivery} />
              {(ar ? deal.termsAr : deal.terms) && (
                <DetailRow icon={StickyNote} label={ar ? "شروط إضافية" : "Terms"} value={ar ? deal.termsAr : deal.terms} />
              )}
            </div>
          </motion.div>

          {/* ── Payment card ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
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
                <div className="text-end">
                  <p className="text-2xl font-black text-white">
                    {deal.price.toLocaleString()}
                    <span className="text-base font-semibold text-white/50 ms-1.5">{deal.currency}</span>
                  </p>
                </div>
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

              {/* Action buttons — switched by status */}
              <AnimatePresence mode="wait">

                {/* ① Awaiting payment → Pay Now */}
                {status === "awaiting_payment" && (
                  <motion.button
                    key="pay-btn"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    whileTap={{ scale: paying ? 1 : 0.97 }}
                    onClick={handlePayNow}
                    disabled={paying}
                    className="w-full py-4 rounded-2xl bg-emerald-600 text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-700/30 hover:brightness-110 transition disabled:opacity-70"
                  >
                    {paying ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        {ar ? "جارٍ المعالجة..." : "Processing..."}
                      </>
                    ) : (
                      <>
                        <Lock size={16} />
                        {ar
                          ? `ادفع الآن — ${deal.price.toLocaleString()} ${deal.currency}`
                          : `Pay Now — ${deal.price.toLocaleString()} ${deal.currency}`}
                      </>
                    )}
                  </motion.button>
                )}

                {/* ② Payment secured → waiting for seller to ship */}
                {status === "payment_secured" && (
                  <motion.div key="secured-state" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2.5">
                    <div className="w-full py-3.5 rounded-2xl bg-emerald-600/15 border border-emerald-500/30 text-emerald-300 font-bold text-sm flex items-center justify-center gap-2">
                      <CheckCircle2 size={15} />
                      {ar ? "تم تأمين الدفع — بانتظار الشحن" : "Payment Secured — Awaiting Shipment"}
                    </div>
                    {/* Demo button — simulates seller action */}
                    <button
                      onClick={handleSimulateShipment}
                      className="w-full py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/35 text-[11px] font-medium hover:text-white/50 hover:bg-white/8 transition"
                    >
                      {ar ? "محاكاة: تأكيد الشحن من البائع ←" : "← Demo: Simulate seller verifying shipment"}
                    </button>
                  </motion.div>
                )}

                {/* ③ Shipment verified → Confirm Receipt */}
                {status === "shipment_verified" && (
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
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
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
                {status === "delivered" && (
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
                  ? "الدفع الحقيقي غير مفعّل حالياً — هذه نسخة تجريبية."
                  : "Real payment not active yet — this is a placeholder build."}
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
            <AlertTriangle size={14} className="text-amber-400/60 shrink-0 mt-0.5" />
            <p className="text-[11px] text-white/30 leading-relaxed">
              {ar
                ? "في حال وجود خلاف، يمكنك فتح نزاع وسيتولى فريق بيدريل المراجعة وحماية حقوقك."
                : "If there's a dispute, you can open a claim and BidReel's team will review and protect your rights."}
            </p>
          </motion.div>

        </div>
      </div>
    </MobileLayout>
  );
}
