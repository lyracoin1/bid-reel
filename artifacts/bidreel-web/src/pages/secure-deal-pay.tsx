import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, ShieldCheck, Package, FileText, DollarSign,
  Truck, StickyNote, Clock, CheckCircle2, Lock,
  AlertTriangle, Image, Video,
} from "lucide-react";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { useLang } from "@/contexts/LanguageContext";

// ── Placeholder deal data seeded from the deal ID ──────────────────────────
// In production this would be fetched from the API using the dealId.
// The seed lets each ID produce consistent-looking placeholder data.
function seedFromId(id: string) {
  const n = id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const items = [
    { name: "Authentic Rolex Watch", nameAr: "ساعة رولكس أصلية", price: 2800, currency: "USD", delivery: "In-person handover", deliveryAr: "تسليم شخصي", desc: "Genuine Rolex Submariner, 2019, box & papers included. Minor scratches on bracelet.", descAr: "رولكس سوبمارينر أصلية 2019 مع الصندوق والأوراق. خدوش بسيطة على السوار.", terms: "No returns after physical inspection.", termsAr: "لا إرجاع بعد الفحص المادي." },
    { name: "iPhone 15 Pro Max", nameAr: "آيفون 15 برو ماكس", price: 1200, currency: "USD", delivery: "Shipping (seller arranges)", deliveryAr: "شحن (البائع يرتب)", desc: "256GB, Natural Titanium. Used 3 months, excellent condition, no scratches.", descAr: "256 جيجا، تيتانيوم طبيعي. استخدام 3 أشهر، حالة ممتازة.", terms: "Shipped within 48 hours of payment.", termsAr: "شحن خلال 48 ساعة من الدفع." },
    { name: "Vintage Camera Collection", nameAr: "مجموعة كاميرات كلاسيكية", price: 450, currency: "EUR", delivery: "Courier (agreed by both)", deliveryAr: "مندوب (باتفاق الطرفين)", desc: "Lot of 4 film cameras: Leica M3, Olympus OM-1, Nikon F2, Canon AE-1. All functional.", descAr: "مجموعة من 4 كاميرات فيلمية: ليكا، أوليمبوس، نيكون، كانون. كلها تعمل.", terms: "As-is, tested and confirmed working.", termsAr: "كما هي، تم التأكد من عملها." },
  ];
  return items[n % items.length];
}

type PayStatus = "awaiting" | "secured";

const STATUS_CONFIG = {
  awaiting: {
    icon: Clock,
    colorClass: "text-amber-400",
    bgClass: "bg-amber-500/10 border-amber-500/25",
    en: "Awaiting Payment",
    ar: "بانتظار الدفع",
    dotClass: "bg-amber-400",
  },
  secured: {
    icon: CheckCircle2,
    colorClass: "text-emerald-400",
    bgClass: "bg-emerald-500/10 border-emerald-500/25",
    en: "Payment Secured",
    ar: "تم تأمين الدفع",
    dotClass: "bg-emerald-400",
  },
};

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
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

export default function SecureDealPayPage() {
  const [, setLocation] = useLocation();
  const { dealId } = useParams<{ dealId: string }>();
  const { lang } = useLang();
  const ar = lang === "ar";

  const deal = seedFromId(dealId ?? "BD-DEFAULT");
  const [status, setStatus] = useState<PayStatus>("awaiting");
  const [paying, setPaying] = useState(false);

  const statusCfg = STATUS_CONFIG[status];
  const StatusIcon = statusCfg.icon;

  function handlePayNow() {
    if (paying || status === "secured") return;
    setPaying(true);
    console.log("[SecureDeal] Pay Now tapped — placeholder. Deal:", dealId, deal);
    setTimeout(() => {
      setStatus("secured");
      setPaying(false);
      console.log("[SecureDeal] Status updated to: Payment Secured (placeholder)");
    }, 1400);
  }

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
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
            <h1 className="text-base font-bold text-white truncate">
              {ar ? "تفاصيل الصفقة الآمنة" : "Secure Deal"}
            </h1>
          </div>
          {/* Deal ID badge */}
          <span className="text-[10px] font-bold text-white/30 bg-white/5 border border-white/8 rounded-lg px-2 py-1 shrink-0 font-mono">
            {dealId}
          </span>
        </div>

        <div className="px-4 py-5 max-w-lg mx-auto space-y-4 pb-14">

          {/* Status banner */}
          <motion.div
            key={status}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className={`rounded-2xl border px-4 py-3.5 flex items-center gap-3 ${statusCfg.bgClass}`}
          >
            <div className="relative shrink-0">
              <StatusIcon size={18} className={statusCfg.colorClass} />
              {status === "awaiting" && (
                <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${statusCfg.dotClass} animate-ping`} />
              )}
            </div>
            <div>
              <p className={`text-sm font-bold ${statusCfg.colorClass}`}>
                {ar ? statusCfg.ar : statusCfg.en}
              </p>
              <p className="text-[11px] text-white/40 mt-0.5">
                {status === "awaiting"
                  ? (ar ? "في انتظار إتمام الدفع من المشتري." : "Waiting for buyer to complete payment.")
                  : (ar ? "تم تأمين مدفوعاتك بنجاح. بانتظار تأكيد التسليم." : "Your payment is secured. Awaiting delivery confirmation.")}
              </p>
            </div>
          </motion.div>

          {/* Media preview placeholder */}
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
              <p className="text-base font-bold text-white">
                {ar ? deal.nameAr : deal.name}
              </p>
              <p className="text-xs text-white/40 mt-0.5">
                {ar ? deal.deliveryAr : deal.delivery}
              </p>
            </div>
          </motion.div>

          {/* Deal details card */}
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
              <DetailRow icon={Package}   label={ar ? "المنتج"         : "Product"}      value={ar ? deal.nameAr     : deal.name} />
              <DetailRow icon={FileText}  label={ar ? "الوصف"          : "Description"}  value={ar ? deal.descAr     : deal.desc} />
              <DetailRow icon={Truck}     label={ar ? "طريقة التسليم"  : "Delivery"}     value={ar ? deal.deliveryAr : deal.delivery} />
              {(ar ? deal.termsAr : deal.terms) && (
                <DetailRow icon={StickyNote} label={ar ? "شروط إضافية" : "Terms"} value={ar ? deal.termsAr : deal.terms} />
              )}
            </div>
          </motion.div>

          {/* Payment card */}
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

              {/* Pay Now button */}
              <AnimatePresence mode="wait">
                {status === "awaiting" ? (
                  <motion.button
                    key="pay-btn"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
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
                ) : (
                  <motion.div
                    key="paid-state"
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-full py-4 rounded-2xl bg-emerald-600/15 border border-emerald-500/30 text-emerald-300 font-bold text-base flex items-center justify-center gap-2.5"
                  >
                    <CheckCircle2 size={17} />
                    {ar ? "تم تأمين الدفع بنجاح" : "Payment Secured"}
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

          {/* Dispute / safety note */}
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
