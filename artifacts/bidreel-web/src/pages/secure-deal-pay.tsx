import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, ShieldCheck, Package, FileText, DollarSign,
  Truck, StickyNote, Lock, Image, Video,
  CheckCircle2, Bell, PartyPopper, AlertCircle,
  Loader2, UserX, RefreshCw, User, UserCheck, PencilLine,
  ScrollText, Send, Star, Upload, X, Link2, Scale,
} from "lucide-react";
import {
  isPlayBillingAvailable,
  purchaseDealProduct,
  acknowledgeDealPurchase,
  SECURE_DEAL_PRODUCT_ID,
} from "@/lib/google-play-billing";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { useLang } from "@/contexts/LanguageContext";
import { useCurrentUser } from "@/hooks/use-current-user";
import {
  getTransaction, updatePaymentStatus, sendPaymentNotification,
  submitDealConditions, getDealConditions,
  submitSellerConditions, getSellerConditions,
  submitDealRating, getDealRatings,
  uploadPaymentProof, getPaymentProof,
  uploadShipmentProof, getShipmentProof,
  uploadDeliveryProof, getDeliveryProof,
  confirmReceipt,
  createShippingFeeDispute, getShippingFeeDisputes,
  getMyPenalties,
  getEscrow, openEscrowDispute,
  Transaction, DealCondition, SellerCondition, DealRating, PaymentProof, ShipmentProof, DeliveryProof, ShippingFeeDispute, SellerPenalty, EscrowRow,
} from "@/lib/transactions";

// ── Deal UI status (derived from DB payment_status + shipment_status) ──────

type DealStatus = "awaiting_payment" | "payment_secured" | "shipment_verified" | "delivered";

function deriveDealStatus(tx: Transaction): DealStatus {
  if (tx.payment_status === "pending")                                        return "awaiting_payment";
  if (tx.payment_status === "secured" && tx.shipment_status === "pending")   return "payment_secured";
  if (tx.payment_status === "secured" && tx.shipment_status === "verified")  return "shipment_verified";
  if (tx.payment_status === "secured" && tx.shipment_status === "delivered") return "delivered";
  return "awaiting_payment";
}

// ── Progress Stepper ────────────────────────────────────────────────────────
//
// Four stages shown left-to-right:
//   Payment Pending → Payment Secured → Shipment Verified → Delivered

const ALL_STEPS: { key: DealStatus; en: string; ar: string }[] = [
  { key: "awaiting_payment",  en: "Payment Pending",   ar: "في انتظار الدفع"      },
  { key: "payment_secured",   en: "Payment Secured",   ar: "تم تأمين الدفع"       },
  { key: "shipment_verified", en: "Shipment Verified", ar: "تم التحقق من الشحن"   },
  { key: "delivered",         en: "Delivered",         ar: "تم الاستلام"           },
];

function stepIndex(status: DealStatus): number {
  return ALL_STEPS.findIndex(s => s.key === status);
}

// ─── EscrowPanel ──────────────────────────────────────────────────────────────
// Shown at the bottom of the secure deal page when payment is secured.
// Displays escrow status and lets buyer/seller open a dispute.

function EscrowPanel({
  dealId,
  paymentStatus,
  ar,
}: {
  dealId: string;
  paymentStatus: string;
  ar: boolean;
}) {
  const [escrow,    setEscrow]    = useState<EscrowRow | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  useEffect(() => {
    if (paymentStatus !== "secured") return;
    setLoading(true);
    getEscrow(dealId)
      .then(row => setEscrow(row))
      .catch(() => {/* silent — show fallback */})
      .finally(() => setLoading(false));
  }, [dealId, paymentStatus]);

  async function handleDispute() {
    if (disputing || !escrow || escrow.status !== "pending") return;
    setDisputing(true);
    setError(null);
    try {
      const updated = await openEscrowDispute(dealId);
      setEscrow(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : (ar ? "حدث خطأ" : "Something went wrong"));
    } finally {
      setDisputing(false);
    }
  }

  // Before payment is secured just show the static safety note
  if (paymentStatus !== "secured") {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.2 }}
        className="rounded-2xl bg-white/3 border border-white/6 px-4 py-3.5 flex items-start gap-3"
      >
        <ShieldCheck size={13} className="text-white/20 shrink-0 mt-0.5" />
        <p className="text-[11px] text-white/30 leading-relaxed">
          {ar
            ? "ستُحفظ أموالك في الضمان وتُحرَّر للبائع فقط بعد تأكيد الاستلام."
            : "Your funds will be held in escrow and only released to the seller after you confirm receipt."}
        </p>
      </motion.div>
    );
  }

  const statusLabel = escrow?.status === "released"
    ? (ar ? "تم تحرير الأموال" : "Funds Released")
    : escrow?.status === "disputed"
    ? (ar ? "نزاع مفتوح — جارٍ المراجعة" : "Dispute Open — Under Review")
    : (ar ? "الأموال محفوظة في الضمان" : "Funds Held in Escrow");

  const statusColour = escrow?.status === "released"
    ? "text-emerald-400"
    : escrow?.status === "disputed"
    ? "text-orange-400"
    : "text-sky-400";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, delay: 0.2 }}
      className="rounded-2xl bg-white/3 border border-white/6 px-4 py-3.5 space-y-3"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <ShieldCheck size={13} className={loading ? "text-white/20" : statusColour} />
        <span className={`text-[11px] font-semibold ${loading ? "text-white/30" : statusColour}`}>
          {loading ? (ar ? "جارٍ التحقق…" : "Checking escrow…") : statusLabel}
        </span>
        {escrow && (
          <span className="ms-auto text-[10px] text-white/30">
            {escrow.amount.toLocaleString()} {/* currency shown at deal level */}
          </span>
        )}
      </div>

      {/* Dispute button — only when status is pending */}
      {escrow?.status === "pending" && (
        <div className="space-y-1.5">
          <button
            onClick={handleDispute}
            disabled={disputing}
            className="w-full py-2 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 bg-orange-500/15 border border-orange-500/25 text-orange-400 hover:brightness-110 transition disabled:opacity-50"
          >
            {disputing
              ? <><Loader2 size={11} className="animate-spin" />{ar ? "جارٍ الإرسال…" : "Submitting…"}</>
              : <><AlertCircle size={11} />{ar ? "فتح نزاع" : "Open Dispute"}</>}
          </button>
          {error && <p className="text-[10px] text-red-400 text-center">{error}</p>}
          <p className="text-[10px] text-white/25 text-center leading-relaxed">
            {ar
              ? "سيراجع فريق بيدريل النزاع ويتخذ القرار المناسب."
              : "BidReel team will review your dispute and arbitrate."}
          </p>
        </div>
      )}

      {/* Released confirmation */}
      {escrow?.status === "released" && (
        <p className="text-[10px] text-emerald-400/70 text-center">
          {ar ? "تم تحرير الأموال للبائع بنجاح." : "Funds have been released to the seller."}
        </p>
      )}

      {/* Disputed confirmation */}
      {escrow?.status === "disputed" && (
        <p className="text-[10px] text-orange-400/70 text-center">
          {ar ? "نزاعك قيد المراجعة. سيتواصل معك الفريق قريباً." : "Your dispute is under review. Our team will reach out soon."}
        </p>
      )}
    </motion.div>
  );
}

function DealStepper({ status, ar }: { status: DealStatus; ar: boolean }) {
  const current = stepIndex(status);
  return (
    <div className="flex items-start w-full" dir="ltr">
      {ALL_STEPS.map((step, i) => {
        const done   = i <= current;
        const active = i === current;
        return (
          <div key={step.key} className="flex-1 flex items-start">
            <div className="flex flex-col items-center w-full">
              <div className="flex items-center w-full">
                {/* Left connector */}
                <div className={`flex-1 h-0.5 rounded-full transition-colors duration-300 ${
                  i === 0 ? "invisible" : (i <= current ? "bg-emerald-500/60" : "bg-white/10")
                }`} />
                <motion.div
                  animate={active ? { scale: [1, 1.18, 1] } : {}}
                  transition={{ duration: 1.8, repeat: Infinity }}
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors duration-300 ${
                    done ? "bg-emerald-500 border-emerald-500" : "bg-white/5 border-white/15"
                  }`}
                >
                  {done
                    ? <CheckCircle2 size={11} className="text-white" />
                    : <span className="text-[9px] font-bold text-white/25">{i + 1}</span>
                  }
                </motion.div>
                {/* Right connector */}
                <div className={`flex-1 h-0.5 rounded-full transition-colors duration-300 ${
                  i === ALL_STEPS.length - 1 ? "invisible" : (i < current ? "bg-emerald-500/60" : "bg-white/10")
                }`} />
              </div>
              <span className={`mt-1.5 text-[8px] font-bold text-center leading-tight max-w-[56px] px-0.5 transition-colors duration-300 ${
                done ? "text-emerald-400" : "text-white/20"
              }`}>
                {ar ? step.ar : step.en}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function DetailRow({
  icon: Icon, label, value,
}: {
  icon: React.ElementType; label: string; value: string;
}) {
  return (
    <div className="flex items-start gap-3 py-3.5 border-b border-white/6 last:border-0">
      <div className="w-7 h-7 rounded-lg bg-white/6 border border-white/10 flex items-center justify-center shrink-0 mt-0.5">
        <Icon size={13} className="text-white/40" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-0.5">{label}</p>
        <p className="text-sm text-white/85 leading-snug break-words">{value}</p>
      </div>
    </div>
  );
}

function ShipmentBanner({ ar }: { ar: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
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
            : "The seller has verified shipment. Once received, confirm delivery to release funds."}
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
          {ar
            ? "تم تحرير الأموال للبائع. شكراً لاستخدامك بيدريل."
            : "Funds released to the seller. Thank you for using BidReel."}
        </p>
      </div>
    </motion.div>
  );
}

// ── Full-screen gate screens (sign-in required / profile incomplete) ────────

function GateScreen({
  icon: Icon, iconBg, iconColor, title, body, btnLabel, onBtn,
}: {
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  title: string;
  body: string;
  btnLabel: string;
  onBtn: () => void;
}) {
  return (
    <div className="min-h-full bg-background flex flex-col items-center justify-center gap-5 px-6 text-center">
      <div className={`w-16 h-16 rounded-2xl ${iconBg} border border-white/10 flex items-center justify-center`}>
        <Icon size={28} className={iconColor} />
      </div>
      <div className="space-y-1.5">
        <p className="text-base font-bold text-white">{title}</p>
        <p className="text-sm text-white/40 leading-relaxed max-w-xs mx-auto">{body}</p>
      </div>
      <button
        onClick={onBtn}
        className="mt-1 px-7 py-3.5 rounded-2xl bg-primary text-white font-bold text-sm hover:brightness-110 active:scale-95 transition"
      >
        {btnLabel}
      </button>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function SecureDealPayPage() {
  const [, setLocation] = useLocation();
  const { dealId }      = useParams<{ dealId: string }>();
  const { lang }        = useLang();
  const ar              = lang === "ar";

  const { user, isLoading: authLoading } = useCurrentUser();

  // Transaction state
  const [tx, setTx]              = useState<Transaction | null>(null);
  const [txLoading, setTxLoading] = useState(true);
  const [txError, setTxError]    = useState<string | null>(null);

  // Derived deal status (kept in sync with tx, updated optimistically on pay)
  const [dealStatus, setDealStatus] = useState<DealStatus>("awaiting_payment");

  // Buyer-chosen open-price amount (string so the input stays editable)
  const [buyerAmountStr, setBuyerAmountStr] = useState<string>("");
  const [amountTouched, setAmountTouched]   = useState(false);

  // Payment action state
  const [paying, setPaying]         = useState(false);
  const [payError, setPayError]     = useState<string | null>(null);
  const [paySuccess, setPaySuccess] = useState(false);
  const [paidAmount, setPaidAmount] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);

  // ── Receipt confirmation modal state (Part #7) ────────────────────────────
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [receiptError,     setReceiptError]     = useState<string | null>(null);

  // Buyer conditions state
  const [conditionsText, setConditionsText]         = useState("");
  const [conditionsSubmitting, setConditionsSubmitting] = useState(false);
  const [conditionsError, setConditionsError]       = useState<string | null>(null);
  const [conditionsSuccess, setConditionsSuccess]   = useState(false);
  const [existingCondition, setExistingCondition]   = useState<DealCondition | null>(null);
  const [conditionsEditMode, setConditionsEditMode] = useState(false);

  // Seller conditions state
  const [sellerCondText, setSellerCondText]               = useState("");
  const [sellerCondSubmitting, setSellerCondSubmitting]   = useState(false);
  const [sellerCondError, setSellerCondError]             = useState<string | null>(null);
  const [sellerCondSuccess, setSellerCondSuccess]         = useState(false);
  const [existingSellerCond, setExistingSellerCond]       = useState<SellerCondition | null>(null);
  const [sellerCondEditMode, setSellerCondEditMode]       = useState(false);

  // Rating state
  const [allRatings, setAllRatings]             = useState<DealRating[]>([]);
  const [ratingStars, setRatingStars]           = useState(0);
  const [ratingHover, setRatingHover]           = useState(0);
  const [ratingComment, setRatingComment]       = useState("");
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [ratingError, setRatingError]           = useState<string | null>(null);
  const [ratingSuccess, setRatingSuccess]       = useState(false);

  // Payment proof state
  const proofFileRef                              = useRef<HTMLInputElement>(null);
  const [proofFile, setProofFile]               = useState<File | null>(null);
  const [proofUploading, setProofUploading]     = useState(false);
  const [proofError, setProofError]             = useState<string | null>(null);
  const [proofSuccess, setProofSuccess]         = useState(false);
  const [existingProof, setExistingProof]       = useState<PaymentProof | null>(null);

  // ── Shipment Proof state (Part #5) ──────────────────────────────────────────
  const shipFileRef                                           = useRef<HTMLInputElement>(null);
  const [shipFile,        setShipFile]                       = useState<File | null>(null);
  const [shipUploading,   setShipUploading]                  = useState(false);
  const [shipError,       setShipError]                      = useState<string | null>(null);
  const [shipSuccess,     setShipSuccess]                    = useState(false);
  const [shipTrackingLink, setShipTrackingLink]              = useState("");
  const [existingShipmentProof, setExistingShipmentProof]   = useState<ShipmentProof | null>(null);

  // ── Delivery Proof state (Part #8) ───────────────────────────────────────────
  const delivFileRef                                            = useRef<HTMLInputElement>(null);
  const [delivFile,        setDelivFile]                       = useState<File | null>(null);
  const [delivUploading,   setDelivUploading]                  = useState(false);
  const [delivError,       setDelivError]                      = useState<string | null>(null);
  const [delivSuccess,     setDelivSuccess]                    = useState(false);
  const [existingDeliveryProof, setExistingDeliveryProof]      = useState<DeliveryProof | null>(null);

  // ── Shipping Fee Dispute state (Part #9) ─────────────────────────────────────
  const [disputes,           setDisputes]           = useState<ShippingFeeDispute[]>([]);
  const [disputeParty,       setDisputeParty]       = useState<"buyer" | "seller">("seller");
  const [disputeComment,     setDisputeComment]     = useState("");
  const [disputeProofUrl,    setDisputeProofUrl]    = useState("");
  const [disputeSubmitting,  setDisputeSubmitting]  = useState(false);
  const [disputeError,       setDisputeError]       = useState<string | null>(null);
  const [disputeSuccess,     setDisputeSuccess]     = useState(false);

  // ── Seller Penalty state (Part #10) ──────────────────────────────────────────
  const [penalties,          setPenalties]          = useState<SellerPenalty[]>([]);

  // ── Load transaction ─────────────────────────────────────────────────────
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
        // Pre-fill buyer amount with the deal's listed price
        setBuyerAmountStr(String(data.price));
        if (data.payment_status === "secured") {
          setPaySuccess(true);
          setPaidAmount(data.paid_amount ?? data.price);
        }
      }
    } catch {
      setTxError(ar ? "فشل تحميل الصفقة." : "Failed to load deal.");
    } finally {
      setTxLoading(false);
    }
  }, [dealId, ar]);

  useEffect(() => { loadTx(); }, [loadTx]);

  // ── Load previously-submitted conditions (buyer only, best-effort) ────────
  const loadConditions = useCallback(async () => {
    if (!dealId || !user) return;
    try {
      const row = await getDealConditions(dealId);
      if (row) {
        setExistingCondition(row);
        setConditionsText(row.conditions);
      }
    } catch {
      // Non-fatal — conditions section degrades gracefully
    }
  }, [dealId, user]);

  useEffect(() => { loadConditions(); }, [loadConditions]);

  // ── Load seller conditions (both seller + buyer need these) ──────────────
  const loadSellerConditions = useCallback(async () => {
    if (!dealId || !user) return;
    try {
      const row = await getSellerConditions(dealId);
      if (row) {
        setExistingSellerCond(row);
        // Pre-fill textarea only for the seller
        setSellerCondText(row.conditions);
      }
    } catch {
      // Non-fatal
    }
  }, [dealId, user]);

  useEffect(() => { loadSellerConditions(); }, [loadSellerConditions]);

  // ── Submit seller conditions ──────────────────────────────────────────────
  async function handleSubmitSellerConditions() {
    if (!user || !tx || sellerCondSubmitting) return;
    const trimmed = sellerCondText.trim();
    if (!trimmed) return;

    setSellerCondSubmitting(true);
    setSellerCondError(null);
    setSellerCondSuccess(false);

    try {
      const saved = await submitSellerConditions(tx.deal_id, trimmed);
      setExistingSellerCond(saved);
      setSellerCondText(saved.conditions);
      setSellerCondSuccess(true);
      setSellerCondEditMode(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setSellerCondError(ar ? `فشل الإرسال: ${msg}` : `Submission failed: ${msg}`);
    } finally {
      setSellerCondSubmitting(false);
    }
  }

  // ── Submit buyer conditions ───────────────────────────────────────────────
  async function handleSubmitConditions() {
    if (!user || !tx || conditionsSubmitting) return;
    const trimmed = conditionsText.trim();
    if (!trimmed) return;

    setConditionsSubmitting(true);
    setConditionsError(null);
    setConditionsSuccess(false);

    try {
      const saved = await submitDealConditions(tx.deal_id, trimmed);
      setExistingCondition(saved);
      setConditionsText(saved.conditions);
      setConditionsSuccess(true);
      setConditionsEditMode(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setConditionsError(ar ? `فشل الإرسال: ${msg}` : `Submission failed: ${msg}`);
    } finally {
      setConditionsSubmitting(false);
    }
  }

  // ── Load deal ratings (only after deal is delivered) ─────────────────────
  const loadRatings = useCallback(async () => {
    if (!dealId || !user || dealStatus !== "delivered") return;
    try {
      const rows = await getDealRatings(dealId);
      setAllRatings(rows);
    } catch {
      // Non-fatal
    }
  }, [dealId, user, dealStatus]);

  useEffect(() => { loadRatings(); }, [loadRatings]);

  // ── Load existing payment proof (buyer + seller, best-effort) ─────────────
  const loadProof = useCallback(async () => {
    if (!dealId || !user) return;
    try {
      const found = await getPaymentProof(dealId);
      if (found) setExistingProof(found);
    } catch {
      // Non-fatal
    }
  }, [dealId, user]);

  useEffect(() => { loadProof(); }, [loadProof]);

  // ── Submit rating ─────────────────────────────────────────────────────────
  async function handleSubmitRating() {
    if (!user || !tx || ratingStars < 1 || ratingSubmitting) return;
    // Derive ratee at call time — avoids dependency on render-time derived vars
    const isSellerNow = user.id === tx.seller_id;
    const rateeId     = isSellerNow ? (tx.buyer_id ?? null) : tx.seller_id;
    if (!rateeId) return;

    setRatingSubmitting(true);
    setRatingError(null);
    setRatingSuccess(false);

    try {
      const saved = await submitDealRating(
        tx.deal_id, rateeId, ratingStars,
        ratingComment.trim() || undefined,
      );
      setAllRatings(prev => [...prev.filter(r => r.rater_id !== user.id), saved]);
      setRatingSuccess(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setRatingError(ar ? `فشل الإرسال: ${msg}` : `Submission failed: ${msg}`);
    } finally {
      setRatingSubmitting(false);
    }
  }

  // ── Upload payment proof ──────────────────────────────────────────────────
  async function handleUploadProof() {
    if (!user || !tx || !proofFile || proofUploading) return;
    setProofUploading(true);
    setProofError(null);
    setProofSuccess(false);
    try {
      const saved = await uploadPaymentProof(tx.deal_id, proofFile);
      setExistingProof(saved);
      setProofFile(null);
      setProofSuccess(true);
      if (proofFileRef.current) proofFileRef.current.value = "";
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setProofError(ar ? `فشل الرفع: ${msg}` : `Upload failed: ${msg}`);
    } finally {
      setProofUploading(false);
    }
  }

  // ── Shipment Proof load + submit (Part #5) ───────────────────────────────

  const loadShipmentProof = useCallback(async () => {
    if (!dealId || !user) return;
    try {
      const found = await getShipmentProof(dealId);
      if (found) {
        setExistingShipmentProof(found);
        setShipTrackingLink(found.tracking_link ?? "");
      }
    } catch {
      // non-fatal — proof just won't appear
    }
  }, [dealId, user]);

  useEffect(() => { loadShipmentProof(); }, [loadShipmentProof]);

  // ── Delivery Proof load + submit (Part #8) ───────────────────────────────

  const loadDeliveryProof = useCallback(async () => {
    if (!dealId || !user) return;
    try {
      const found = await getDeliveryProof(dealId);
      if (found) setExistingDeliveryProof(found);
    } catch {
      // non-fatal — proof just won't appear
    }
  }, [dealId, user]);

  useEffect(() => { loadDeliveryProof(); }, [loadDeliveryProof]);

  // ── Shipping Fee Dispute load + submit (Part #9) ──────────────────────────

  const loadDisputes = useCallback(async () => {
    if (!dealId || !user) return;
    try {
      const found = await getShippingFeeDisputes(dealId);
      setDisputes(found);
    } catch {
      // non-fatal
    }
  }, [dealId, user]);

  useEffect(() => { loadDisputes(); }, [loadDisputes]);

  // ── Seller Penalties load (Part #10) — seller-only, best-effort ───────────

  const loadPenalties = useCallback(async () => {
    if (!tx || !user) return;
    if (tx.seller_id !== user.id) return;
    try {
      const found = await getMyPenalties(tx.seller_id, tx.deal_id);
      setPenalties(found);
    } catch {
      // non-fatal — penalty card just shows empty
    }
  }, [tx, user]);

  useEffect(() => { loadPenalties(); }, [loadPenalties]);

  async function handleSubmitDispute() {
    if (!user || !tx || disputeSubmitting) return;
    setDisputeSubmitting(true);
    setDisputeError(null);
    setDisputeSuccess(false);
    try {
      const saved = await createShippingFeeDispute(
        tx.deal_id,
        disputeParty,
        disputeComment.trim() || undefined,
        disputeProofUrl.trim() || undefined,
      );
      setDisputes(prev => [
        ...prev.filter(d => d.submitted_by !== user.id),
        saved,
      ]);
      setDisputeSuccess(true);
      setDisputeComment("");
      setDisputeProofUrl("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setDisputeError(ar ? `فشل: ${msg}` : `Failed: ${msg}`);
    } finally {
      setDisputeSubmitting(false);
    }
  }

  async function handleUploadDeliveryProof() {
    if (!user || !tx || !delivFile || delivUploading) return;
    setDelivUploading(true);
    setDelivError(null);
    setDelivSuccess(false);
    try {
      const saved = await uploadDeliveryProof(tx.deal_id, delivFile);
      setExistingDeliveryProof(saved);
      setDelivFile(null);
      setDelivSuccess(true);
      if (delivFileRef.current) delivFileRef.current.value = "";
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setDelivError(ar ? `فشل الرفع: ${msg}` : `Upload failed: ${msg}`);
    } finally {
      setDelivUploading(false);
    }
  }

  async function handleUploadShipmentProof() {
    if (!user || !tx || !shipFile || shipUploading) return;
    setShipUploading(true);
    setShipError(null);
    setShipSuccess(false);
    try {
      const saved = await uploadShipmentProof(tx.deal_id, shipFile, shipTrackingLink);
      setExistingShipmentProof(saved);
      setShipFile(null);
      setShipSuccess(true);
      if (shipFileRef.current) shipFileRef.current.value = "";
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setShipError(ar ? `فشل الرفع: ${msg}` : `Upload failed: ${msg}`);
    } finally {
      setShipUploading(false);
    }
  }

  // ── Pay Now ──────────────────────────────────────────────────────────────
  //
  // PAYMENT GATEWAY INTEGRATION POINT (client side):
  //   1. Add your real gateway charge call here (Google Play Billing,
  //      Stripe Elements, etc.) BEFORE calling updatePaymentStatus().
  //   2. Only call updatePaymentStatus() after the gateway confirms success.
  //   3. The server-side gateway block lives in:
  //        api-server/src/routes/secure-deals.ts → POST /transactions/pay-now
  //
  // Derived numeric amount from the input string — NaN means invalid
  const buyerAmount = parseFloat(buyerAmountStr);
  const amountValid = !Number.isNaN(buyerAmount) && buyerAmount > 0;
  const showAmountError = amountTouched && !amountValid;

  async function handlePayNow() {
    if (!user || !tx || paying || dealStatus !== "awaiting_payment" || !amountValid) return;
    setPaying(true);
    setPayError(null);

    // Will be set to the purchase returned by Google Play on native Android
    let playPurchase: { purchase_token: string; product_id: string } | undefined;

    try {
      if (isPlayBillingAvailable()) {
        // ── MODE A: Real Google Play Billing (native Android) ─────────────
        //
        // 1. query   — confirm product is active in Play Console
        // 2. launch  — show native payment sheet to user
        // 3. receive — purchaseToken returned immediately (not yet acknowledged)
        // 4. verify  — backend confirms token + records paid_amount from Google
        // 5. ack     — only after backend confirms (see below, after DB update)
        //
        // The product ID "secure_deal_payment" must be created as a consumable
        // INAPP product in Play Console → Monetise → In-app products.
        playPurchase = await purchaseDealProduct(SECURE_DEAL_PRODUCT_ID);

      } else {
        // ── MODE B: Placeholder (web / development only) ──────────────────
        // The backend will reject this in production (NODE_ENV=production).
        await new Promise<void>(resolve => setTimeout(resolve, 1400));
      }

      // POST /api/transactions/pay-now
      //   Native: sends { deal_id, buyer_id, amount, currency, purchase_token, product_id }
      //           → backend verifies with Play API → paid_amount = priceAmountMicros / 1e6
      //   Web dev: sends { deal_id, buyer_id, amount, currency }
      //           → backend uses buyer-entered amount
      const { paid_amount: verifiedAmount } = await updatePaymentStatus(
        tx.deal_id, user.id, buyerAmount, tx.currency, playPurchase,
      );

      // Acknowledge AFTER backend confirms — Google requires ack within 3 days
      // or the purchase is auto-refunded.
      if (playPurchase) {
        await acknowledgeDealPurchase(playPurchase.purchase_token).catch(err => {
          // Log but don't fail — DB already updated; ack can be retried
          console.warn("[SecureDeal] sendAck failed (non-fatal):", (err as Error).message);
        });
      }

      // Client-side notification log (real FCM fires server-side)
      sendPaymentNotification(tx.deal_id, user.id, verifiedAmount, tx.currency);

      // Update UI — use the amount Google actually charged (verifiedAmount),
      // not the buyer-entered buyerAmount
      setPaidAmount(verifiedAmount);
      setDealStatus("payment_secured");
      setPaySuccess(true);
      setTx(prev =>
        prev
          ? { ...prev, payment_status: "secured", buyer_id: user.id, paid_amount: verifiedAmount }
          : prev,
      );

      console.log("[SecureDeal] ✓ Payment secured:", {
        dealId: tx.deal_id, buyerId: user.id,
        amount: verifiedAmount, currency: tx.currency,
        via: playPurchase ? "Google Play Billing" : "placeholder",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[SecureDeal] Payment failed:", msg);
      setPayError(ar ? `فشل الدفع: ${msg}` : `Payment failed: ${msg}`);
      // payment_status stays 'pending' — buyer can retry
      // If Play token was obtained but backend failed, the purchase is un-acked
      // and will appear in the next session for retry/refund.
    } finally {
      setPaying(false);
    }
  }

  function handleSimulateShipment() {
    if (dealStatus !== "payment_secured") return;
    setDealStatus("shipment_verified");
    console.log("[SecureDeal] Demo: status → shipment_verified");
  }

  function handleConfirmReceipt() {
    if (confirming || dealStatus !== "shipment_verified") return;
    setReceiptError(null);
    setReceiptModalOpen(true);
  }

  async function executeConfirmReceipt() {
    if (!user || !tx || confirming) return;
    setConfirming(true);
    setReceiptError(null);
    try {
      await confirmReceipt(tx.deal_id);
      setReceiptModalOpen(false);
      setDealStatus("delivered");
      setTx(prev => prev ? { ...prev, shipment_status: "delivered" as const } : prev);
      console.log("[SecureDeal] ✓ Receipt confirmed for deal:", tx.deal_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setReceiptError(ar ? `فشل التأكيد: ${msg}` : `Confirmation failed: ${msg}`);
    } finally {
      setConfirming(false);
    }
  }

  // ── Loading state ────────────────────────────────────────────────────────
  if (authLoading || txLoading) {
    return (
      <MobileLayout>
        <div className="min-h-full bg-background flex items-center justify-center">
          <Loader2 size={28} className="text-primary animate-spin" />
        </div>
      </MobileLayout>
    );
  }

  // ── Gate: not logged in ──────────────────────────────────────────────────
  if (!user) {
    return (
      <MobileLayout>
        <GateScreen
          icon={UserX}
          iconBg="bg-red-500/10"
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

  // ── Gate: profile incomplete (no username set) ───────────────────────────
  if (!user.isCompleted) {
    return (
      <MobileLayout>
        <GateScreen
          icon={UserCheck}
          iconBg="bg-amber-500/10"
          iconColor="text-amber-400"
          title={ar ? "أكمل ملفك الشخصي أولاً" : "Complete your profile first"}
          body={ar
            ? "يجب إضافة اسم مستخدم لملفك الشخصي قبل إتمام عملية الدفع."
            : "You need to set a username on your profile before you can pay."}
          btnLabel={ar ? "إكمال الملف الشخصي" : "Complete Profile"}
          onBtn={() => setLocation("/profile/edit")}
        />
      </MobileLayout>
    );
  }

  // ── Deal not found / load error ──────────────────────────────────────────
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
            <p className="text-sm text-white/40 mt-1">
              {txError ?? (ar ? "صفقة غير موجودة" : "Deal not found")}
            </p>
          </div>
          <button
            onClick={loadTx}
            className="mt-2 flex items-center gap-2 px-5 py-3 rounded-2xl bg-white/8 text-white/70 font-medium text-sm hover:bg-white/12 hover:text-white transition"
          >
            <RefreshCw size={14} />
            {ar ? "إعادة المحاولة" : "Retry"}
          </button>
        </div>
      </MobileLayout>
    );
  }

  // ── Derived display values ───────────────────────────────────────────────
  const priceFormatted = tx.price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const sellerDisplay  = tx.seller_name ?? tx.seller_id.slice(0, 8).toUpperCase() + "…";
  const isSeller       = !!user && user.id === tx.seller_id;
  const rateeId        = isSeller ? (tx.buyer_id ?? null) : tx.seller_id;
  const myRating       = allRatings.find(r => r.rater_id === user?.id) ?? null;
  const theirRating    = allRatings.find(r => r.ratee_id === user?.id) ?? null;
  const starLabels     = ar
    ? ["سيء جداً", "سيء", "مقبول", "جيد", "ممتاز"]
    : ["Terrible",  "Poor",  "Okay",  "Good", "Excellent"];

  return (
    <MobileLayout>
      <div className="min-h-full bg-background" dir={ar ? "rtl" : "ltr"}>

        {/* ── Receipt Confirmation Modal (Part #7) ─────────────────────────── */}
        <AnimatePresence>
          {receiptModalOpen && (
            <motion.div
              key="receipt-modal-bg"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center px-4 pb-8 sm:pb-0"
              onClick={() => !confirming && setReceiptModalOpen(false)}
            >
              <motion.div
                key="receipt-modal"
                initial={{ opacity: 0, y: 48 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 48 }}
                transition={{ type: "spring", stiffness: 300, damping: 28 }}
                className="w-full max-w-sm rounded-3xl bg-[#141420] border border-white/12 p-6 space-y-5 shadow-2xl"
                onClick={e => e.stopPropagation()}
                dir={ar ? "rtl" : "ltr"}
              >
                {/* Icon + heading */}
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center">
                    <CheckCircle2 size={26} className="text-blue-400" />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-base font-bold text-white">
                      {ar ? "تأكيد استلام المنتج" : "Confirm Receipt"}
                    </p>
                    <p className="text-[12px] text-white/45 leading-relaxed max-w-[260px] mx-auto">
                      {ar
                        ? "هل تؤكد أنك استلمت المنتج بشكل صحيح؟ سيتم تحرير الأموال للبائع فور التأكيد ولا يمكن التراجع."
                        : "Are you sure you received the item in good condition? Funds will be released to the seller immediately and this cannot be undone."}
                    </p>
                  </div>
                </div>

                {/* Error banner */}
                <AnimatePresence>
                  {receiptError && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex items-start gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2.5 text-red-400 text-xs"
                    >
                      <AlertCircle size={13} className="shrink-0 mt-0.5" />
                      <span>{receiptError}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Action buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={() => { if (!confirming) { setReceiptModalOpen(false); setReceiptError(null); } }}
                    disabled={confirming}
                    className="flex-1 py-3.5 rounded-2xl bg-white/6 border border-white/10 text-white/70 font-bold text-sm hover:bg-white/10 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {ar ? "إلغاء" : "Cancel"}
                  </button>
                  <button
                    onClick={executeConfirmReceipt}
                    disabled={confirming}
                    className="flex-1 py-3.5 rounded-2xl bg-blue-600 text-white font-bold text-sm flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition disabled:opacity-70 disabled:cursor-not-allowed shadow-lg shadow-blue-700/25"
                  >
                    {confirming ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        {ar ? "جارٍ التأكيد…" : "Confirming…"}
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={14} />
                        {ar ? "نعم، تأكيد الاستلام" : "Yes, Confirm Receipt"}
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Sticky header ── */}
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
          <span className="text-[10px] font-bold text-white/30 bg-white/5 border border-white/8 rounded-lg px-2 py-1 shrink-0 font-mono tracking-wide">
            {tx.deal_id}
          </span>
        </div>

        <div className="px-4 py-5 max-w-lg mx-auto space-y-4 pb-16">

          {/* ── Status banners (shipment / delivered) ── */}
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
                    {ar ? "✓ تم تأمين الدفع بنجاح" : "✓ Payment secured successfully"}
                  </p>
                  <p className="text-[11px] text-white/40 mt-0.5 leading-snug">
                    {ar
                      ? `المبلغ المدفوع: ${paidAmount?.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${tx.currency} — رقم الصفقة: ${tx.deal_id}`
                      : `Paid: ${paidAmount?.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${tx.currency} — Deal: ${tx.deal_id}`}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ═══ 1. MEDIA / PRODUCT CARD ════════════════════════════════════════ */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.04 }}
            className="rounded-2xl bg-white/4 border border-white/8 overflow-hidden"
          >
            {tx.media_urls.length > 0 ? (
              tx.media_urls[0].match(/\.(mp4|mov|webm)$/i) ? (
                <video
                  src={tx.media_urls[0]}
                  className="w-full max-h-56 object-cover"
                  controls
                  playsInline
                />
              ) : (
                <img
                  src={tx.media_urls[0]}
                  alt={tx.product_name}
                  className="w-full max-h-56 object-cover"
                />
              )
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

          {/* ═══ 2. TRANSACTION DETAILS CARD ════════════════════════════════════ */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.08 }}
            className="rounded-3xl bg-white/4 border border-white/8 overflow-hidden"
          >
            <div className="bg-gradient-to-r from-white/5 to-transparent px-5 pt-4 pb-3 border-b border-white/6">
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
                {ar ? "تفاصيل الصفقة" : "Transaction Details"}
              </p>
            </div>
            <div className="px-4">
              <DetailRow
                icon={Package}
                label={ar ? "المنتج"        : "Product"}
                value={tx.product_name}
              />
              {tx.description && (
                <DetailRow
                  icon={FileText}
                  label={ar ? "الوصف"        : "Description"}
                  value={tx.description}
                />
              )}
              <DetailRow
                icon={DollarSign}
                label={ar ? "السعر"         : "Price"}
                value={`${priceFormatted} ${tx.currency}`}
              />
              <DetailRow
                icon={User}
                label={ar ? "البائع"        : "Seller"}
                value={sellerDisplay}
              />
              <DetailRow
                icon={Truck}
                label={ar ? "طريقة التسليم" : "Delivery"}
                value={tx.delivery_method}
              />
              {tx.terms && (
                <DetailRow
                  icon={StickyNote}
                  label={ar ? "الشروط"      : "Terms"}
                  value={tx.terms}
                />
              )}
            </div>
          </motion.div>

          {/* ═══ 3. SELLER CONDITIONS CARD ══════════════════════════════════════
               • isSeller = true  → editable form; seller submits their terms
               • isSeller = false → read-only; buyer sees what seller submitted
               Hidden entirely when: caller is buyer AND seller submitted nothing */}
          {(isSeller || existingSellerCond) && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.09 }}
              className="rounded-3xl bg-white/4 border border-white/8 overflow-hidden"
            >
              {/* Card header */}
              <div className="bg-gradient-to-r from-amber-600/15 to-transparent px-5 pt-4 pb-3 border-b border-white/6">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ScrollText size={12} className="text-amber-400" />
                    <p className="text-[10px] font-bold text-amber-400/80 uppercase tracking-widest">
                      {isSeller
                        ? (ar ? "شروطك الخاصة" : "Your Conditions")
                        : (ar ? "شروط البائع" : "Seller's Conditions")}
                    </p>
                  </div>
                  {/* Edit toggle — seller only, while payment is still pending */}
                  {isSeller && existingSellerCond && dealStatus === "awaiting_payment" && !sellerCondEditMode && (
                    <button
                      onClick={() => { setSellerCondEditMode(true); setSellerCondSuccess(false); }}
                      className="text-[10px] font-bold text-amber-400/60 hover:text-amber-300 transition"
                    >
                      {ar ? "تعديل" : "Edit"}
                    </button>
                  )}
                </div>
              </div>

              <div className="px-5 py-4 space-y-3">

                {/* Helper text — seller only */}
                {isSeller && (
                  <p className="text-[11px] text-white/35 leading-relaxed">
                    {ar
                      ? "أضف شروطك أو ملاحظاتك الخاصة للمشتري قبل إتمام الدفع. سيتلقى المشتري إشعاراً فورياً."
                      : "Add your own conditions or notes for the buyer before payment. The buyer will be notified immediately."}
                  </p>
                )}

                {/* ── Read-only view (submitted, not editing) ── */}
                {existingSellerCond && !sellerCondEditMode && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="rounded-2xl bg-amber-600/8 border border-amber-500/20 px-4 py-3.5 space-y-2"
                  >
                    {!isSeller && (
                      <p className="text-[10px] font-bold text-amber-400/60 uppercase tracking-widest">
                        {ar ? "تم الإرسال" : "Submitted"}
                      </p>
                    )}
                    <p className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap break-words">
                      {existingSellerCond.conditions}
                    </p>
                    <p className="text-[10px] text-white/25">
                      {new Date(existingSellerCond.updated_at).toLocaleString(ar ? "ar-SA" : "en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  </motion.div>
                )}

                {/* ── Textarea: seller entering new / edited conditions ── */}
                {isSeller && dealStatus === "awaiting_payment" && (!existingSellerCond || sellerCondEditMode) && (
                  <textarea
                    value={sellerCondText}
                    onChange={e => {
                      setSellerCondText(e.target.value);
                      setSellerCondError(null);
                      setSellerCondSuccess(false);
                    }}
                    placeholder={
                      ar
                        ? "مثال: يجب التحويل خلال 24 ساعة، أو لن يتم قبول الإرجاع…"
                        : "e.g. Payment must be confirmed within 24 hours, no returns accepted…"
                    }
                    maxLength={2000}
                    rows={4}
                    dir={ar ? "rtl" : "ltr"}
                    className="w-full rounded-2xl bg-white/6 border border-white/12 focus:border-amber-500/50 focus:bg-white/8 px-4 py-3 text-sm text-white placeholder-white/20 outline-none resize-none leading-relaxed transition-colors"
                  />
                )}

                {/* Character count */}
                {isSeller && dealStatus === "awaiting_payment" && (!existingSellerCond || sellerCondEditMode) && (
                  <p className="text-[10px] text-white/20 text-end">
                    {sellerCondText.length} / 2000
                  </p>
                )}

                {/* Success banner */}
                <AnimatePresence>
                  {sellerCondSuccess && (
                    <motion.div
                      key="scond-ok"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="rounded-xl bg-amber-600/12 border border-amber-500/25 px-3.5 py-2.5 flex items-center gap-2"
                    >
                      <CheckCircle2 size={13} className="text-amber-400 shrink-0" />
                      <p className="text-[12px] text-amber-300 font-medium">
                        {ar
                          ? "✓ تم إرسال شروطك — سيتلقى المشتري إشعاراً."
                          : "✓ Conditions sent — the buyer has been notified."}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Error banner */}
                <AnimatePresence>
                  {sellerCondError && (
                    <motion.div
                      key="scond-err"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="rounded-xl bg-red-500/10 border border-red-500/20 px-3.5 py-2.5 flex items-start gap-2"
                    >
                      <AlertCircle size={13} className="text-red-400 shrink-0 mt-0.5" />
                      <p className="text-[12px] text-red-300 leading-snug">{sellerCondError}</p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Submit / Update button — seller only, deal still pending */}
                {isSeller && dealStatus === "awaiting_payment" && (!existingSellerCond || sellerCondEditMode) && (
                  <motion.button
                    whileTap={{ scale: sellerCondSubmitting || !sellerCondText.trim() ? 1 : 0.97 }}
                    onClick={handleSubmitSellerConditions}
                    disabled={sellerCondSubmitting || !sellerCondText.trim()}
                    className="w-full py-3.5 rounded-2xl bg-amber-600 text-white font-bold text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-amber-700/25 hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {sellerCondSubmitting ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        {ar ? "جارٍ الإرسال…" : "Sending…"}
                      </>
                    ) : (
                      <>
                        <Send size={14} />
                        {existingSellerCond
                          ? (ar ? "تحديث الشروط" : "Update Conditions")
                          : (ar ? "إرسال الشروط للمشتري" : "Send Conditions to Buyer")}
                      </>
                    )}
                  </motion.button>
                )}

                {/* Cancel edit */}
                {isSeller && sellerCondEditMode && (
                  <button
                    onClick={() => {
                      setSellerCondEditMode(false);
                      setSellerCondText(existingSellerCond?.conditions ?? "");
                      setSellerCondError(null);
                    }}
                    className="w-full py-2.5 rounded-xl bg-white/4 border border-white/8 text-white/35 text-[11px] font-medium hover:text-white/55 hover:bg-white/7 transition"
                  >
                    {ar ? "إلغاء" : "Cancel"}
                  </button>
                )}

              </div>
            </motion.div>
          )}

          {/* ═══ 4. BUYER TERMS CARD ═════════════════════════════════════════════
               Visible only while awaiting payment OR when conditions were
               already submitted (read-only view after payment).              */}
          {(dealStatus === "awaiting_payment" || existingCondition) && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="rounded-3xl bg-white/4 border border-white/8 overflow-hidden"
            >
              {/* Card header */}
              <div className="bg-gradient-to-r from-violet-600/15 to-transparent px-5 pt-4 pb-3 border-b border-white/6">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ScrollText size={12} className="text-violet-400" />
                    <p className="text-[10px] font-bold text-violet-400/80 uppercase tracking-widest">
                      {ar ? "شروط المشتري" : "Buyer Terms"}
                    </p>
                  </div>
                  {/* Edit toggle — only when conditions exist and payment is still pending */}
                  {existingCondition && dealStatus === "awaiting_payment" && !conditionsEditMode && (
                    <button
                      onClick={() => { setConditionsEditMode(true); setConditionsSuccess(false); }}
                      className="text-[10px] font-bold text-violet-400/60 hover:text-violet-300 transition"
                    >
                      {ar ? "تعديل" : "Edit"}
                    </button>
                  )}
                </div>
              </div>

              <div className="px-5 py-4 space-y-3">

                {/* Helper text */}
                <p className="text-[11px] text-white/35 leading-relaxed">
                  {ar
                    ? "يمكنك إضافة أي شروط أو ملاحظات خاصة تريد إبلاغ البائع بها قبل إتمام الدفع. سيتلقى البائع إشعاراً فورياً."
                    : "Add any special conditions or notes for the seller before paying. The seller will be notified immediately."}
                </p>

                {/* ── Read-only view: submitted & not editing ── */}
                {existingCondition && !conditionsEditMode && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="rounded-2xl bg-violet-600/8 border border-violet-500/20 px-4 py-3.5 space-y-2"
                  >
                    <p className="text-[10px] font-bold text-violet-400/60 uppercase tracking-widest">
                      {ar ? "تم الإرسال" : "Submitted"}
                    </p>
                    <p className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap break-words">
                      {existingCondition.conditions}
                    </p>
                    <p className="text-[10px] text-white/25">
                      {new Date(existingCondition.updated_at).toLocaleString(ar ? "ar-SA" : "en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  </motion.div>
                )}

                {/* ── Textarea: new submission or editing ── */}
                {(dealStatus === "awaiting_payment" && (!existingCondition || conditionsEditMode)) && (
                  <textarea
                    value={conditionsText}
                    onChange={e => {
                      setConditionsText(e.target.value);
                      setConditionsError(null);
                      setConditionsSuccess(false);
                    }}
                    placeholder={
                      ar
                        ? "مثال: أريد فاتورة ضريبية، أو التسليم خلال 3 أيام…"
                        : "e.g. I need a tax invoice, or delivery within 3 days…"
                    }
                    maxLength={2000}
                    rows={4}
                    dir={ar ? "rtl" : "ltr"}
                    className="w-full rounded-2xl bg-white/6 border border-white/12 focus:border-violet-500/50 focus:bg-white/8 px-4 py-3 text-sm text-white placeholder-white/20 outline-none resize-none leading-relaxed transition-colors"
                  />
                )}

                {/* Character count */}
                {(dealStatus === "awaiting_payment" && (!existingCondition || conditionsEditMode)) && (
                  <p className="text-[10px] text-white/20 text-end">
                    {conditionsText.length} / 2000
                  </p>
                )}

                {/* Success banner */}
                <AnimatePresence>
                  {conditionsSuccess && (
                    <motion.div
                      key="cond-ok"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="rounded-xl bg-violet-600/12 border border-violet-500/25 px-3.5 py-2.5 flex items-center gap-2"
                    >
                      <CheckCircle2 size={13} className="text-violet-400 shrink-0" />
                      <p className="text-[12px] text-violet-300 font-medium">
                        {ar
                          ? "✓ تم إرسال شروطك — سيتلقى البائع إشعاراً."
                          : "✓ Conditions sent — the seller has been notified."}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Error banner */}
                <AnimatePresence>
                  {conditionsError && (
                    <motion.div
                      key="cond-err"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="rounded-xl bg-red-500/10 border border-red-500/20 px-3.5 py-2.5 flex items-start gap-2"
                    >
                      <AlertCircle size={13} className="text-red-400 shrink-0 mt-0.5" />
                      <p className="text-[12px] text-red-300 leading-snug">{conditionsError}</p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Submit button */}
                {dealStatus === "awaiting_payment" && (!existingCondition || conditionsEditMode) && (
                  <motion.button
                    whileTap={{ scale: conditionsSubmitting || !conditionsText.trim() ? 1 : 0.97 }}
                    onClick={handleSubmitConditions}
                    disabled={conditionsSubmitting || !conditionsText.trim()}
                    className="w-full py-3.5 rounded-2xl bg-violet-600 text-white font-bold text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-violet-700/25 hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {conditionsSubmitting ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        {ar ? "جارٍ الإرسال…" : "Sending…"}
                      </>
                    ) : (
                      <>
                        <Send size={14} />
                        {existingCondition
                          ? (ar ? "تحديث الشروط" : "Update Conditions")
                          : (ar ? "إرسال الشروط للبائع" : "Send Conditions to Seller")}
                      </>
                    )}
                  </motion.button>
                )}

                {/* Cancel edit */}
                {conditionsEditMode && (
                  <button
                    onClick={() => {
                      setConditionsEditMode(false);
                      setConditionsText(existingCondition?.conditions ?? "");
                      setConditionsError(null);
                    }}
                    className="w-full py-2.5 rounded-xl bg-white/4 border border-white/8 text-white/35 text-[11px] font-medium hover:text-white/55 hover:bg-white/7 transition"
                  >
                    {ar ? "إلغاء" : "Cancel"}
                  </button>
                )}

              </div>
            </motion.div>
          )}

          {/* ═══ 4. PROGRESS STEPPER (below transaction details) ════════════════ */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.12 }}
            className="rounded-2xl bg-white/4 border border-white/8 px-5 py-5"
          >
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-5 text-center">
              {ar ? "مراحل الصفقة" : "Deal Progress"}
            </p>
            <DealStepper status={dealStatus} ar={ar} />
          </motion.div>

          {/* ═══ 5. PAYMENT PROOF CARD ════════════════════════════════════════════
               Buyer uploads an external payment receipt / screenshot.
               Buyer sees editable upload form; seller sees read-only view.    */}
          {(dealStatus === "awaiting_payment" || !!existingProof) && (!isSeller || !!existingProof) && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.13 }}
              className="rounded-3xl bg-white/4 border border-white/8 overflow-hidden"
            >
              <div className="bg-gradient-to-r from-sky-600/15 to-transparent px-5 pt-4 pb-3 border-b border-white/6">
                <div className="flex items-center gap-2">
                  <Upload size={12} className="text-sky-400" />
                  <p className="text-[10px] font-bold text-sky-400/80 uppercase tracking-widest">
                    {ar ? "إثبات الدفع" : "Payment Proof"}
                  </p>
                </div>
              </div>

              <div className="px-5 py-4 space-y-3">

                {/* Helper text — buyer only, no proof uploaded yet */}
                {!isSeller && !existingProof && dealStatus === "awaiting_payment" && (
                  <p className="text-[11px] text-white/35 leading-relaxed">
                    {ar
                      ? "إذا أجريت التحويل خارج المنصة (تحويل بنكي مثلاً)، ارفع إيصال الدفع هنا. سيتلقى البائع إشعاراً فورياً."
                      : "If you paid outside the platform (e.g. bank transfer), upload your receipt here. The seller will be notified immediately."}
                  </p>
                )}

                {/* Existing proof — visible to both buyer and seller */}
                {existingProof && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="rounded-2xl bg-sky-600/8 border border-sky-500/20 px-4 py-3.5"
                  >
                    <div className="flex items-start gap-3">
                      <FileText size={16} className="text-sky-400 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="text-sm font-medium text-white/80 truncate">
                          {existingProof.file_name}
                        </p>
                        <p className="text-[10px] text-white/30">
                          {new Date(existingProof.uploaded_at).toLocaleString(
                            ar ? "ar-SA" : "en-US",
                            { dateStyle: "medium", timeStyle: "short" },
                          )}
                        </p>
                      </div>
                      <a
                        href={existingProof.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 px-3 py-1.5 rounded-xl bg-sky-600/20 border border-sky-500/25 text-sky-300 text-[11px] font-bold hover:brightness-110 transition"
                      >
                        {ar ? "عرض" : "View"}
                      </a>
                    </div>
                  </motion.div>
                )}

                {/* File picker + upload controls — buyer only + awaiting payment */}
                {!isSeller && dealStatus === "awaiting_payment" && (
                  <>
                    <input
                      ref={proofFileRef}
                      type="file"
                      accept="application/pdf,image/jpeg,image/jpg,image/png,image/webp"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0] ?? null;
                        setProofFile(f);
                        setProofError(null);
                        setProofSuccess(false);
                      }}
                    />

                    {/* Selected file preview */}
                    {proofFile && (
                      <div className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3.5 py-2.5">
                        <FileText size={13} className="text-white/50 shrink-0" />
                        <span className="text-[12px] text-white/70 flex-1 truncate">{proofFile.name}</span>
                        <span className="text-[10px] text-white/30 shrink-0">
                          {(proofFile.size / 1024).toFixed(0)} KB
                        </span>
                        <button
                          onClick={() => {
                            setProofFile(null);
                            if (proofFileRef.current) proofFileRef.current.value = "";
                          }}
                          className="text-white/20 hover:text-white/50 transition shrink-0"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    )}

                    {/* Choose / Upload buttons */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => proofFileRef.current?.click()}
                        className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white/6 border border-white/10 text-white/50 text-[12px] font-medium hover:bg-white/10 hover:text-white/70 transition"
                      >
                        <Upload size={12} />
                        {existingProof
                          ? (ar ? "تغيير الملف" : "Replace")
                          : (ar ? "اختر ملفاً" : "Choose File")}
                      </button>

                      {proofFile && (
                        <motion.button
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          whileTap={{ scale: proofUploading ? 1 : 0.97 }}
                          onClick={handleUploadProof}
                          disabled={proofUploading}
                          className="flex-1 py-2.5 rounded-xl bg-sky-600 text-white font-bold text-[12px] flex items-center justify-center gap-1.5 shadow-md shadow-sky-700/20 hover:brightness-110 transition disabled:opacity-50"
                        >
                          {proofUploading ? (
                            <>
                              <Loader2 size={12} className="animate-spin" />
                              {ar ? "جارٍ الرفع…" : "Uploading…"}
                            </>
                          ) : (
                            <>
                              <Upload size={12} />
                              {ar ? "رفع الإثبات" : "Upload Proof"}
                            </>
                          )}
                        </motion.button>
                      )}
                    </div>

                    {/* Format hint */}
                    <p className="text-[10px] text-white/20">
                      {ar
                        ? "الصيغ المقبولة: PDF، JPEG، PNG، WebP — الحد الأقصى 10 ميجابايت"
                        : "Accepted: PDF, JPEG, PNG, WebP — max 10 MB"}
                    </p>
                  </>
                )}

                {/* Success banner */}
                <AnimatePresence>
                  {proofSuccess && (
                    <motion.div
                      key="proof-ok"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="rounded-xl bg-sky-600/12 border border-sky-500/25 px-3.5 py-2.5 flex items-center gap-2"
                    >
                      <CheckCircle2 size={13} className="text-sky-400 shrink-0" />
                      <p className="text-[12px] text-sky-300 font-medium">
                        {ar
                          ? "✓ تم رفع الإثبات — سيتلقى البائع إشعاراً."
                          : "✓ Proof uploaded — the seller has been notified."}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Error banner */}
                <AnimatePresence>
                  {proofError && (
                    <motion.div
                      key="proof-err"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="rounded-xl bg-red-500/10 border border-red-500/20 px-3.5 py-2.5 flex items-start gap-2"
                    >
                      <AlertCircle size={13} className="text-red-400 shrink-0 mt-0.5" />
                      <p className="text-[12px] text-red-300 leading-snug">{proofError}</p>
                    </motion.div>
                  )}
                </AnimatePresence>

              </div>
            </motion.div>
          )}

          {/* ═══ 4. PAYMENT CARD + PAY NOW BUTTON ═══════════════════════════════ */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.16 }}
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

              {/* ── Open-price amount input (buyer chooses the amount) ── */}
              {dealStatus === "awaiting_payment" && (
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-[10px] font-bold text-white/40 uppercase tracking-widest">
                    <PencilLine size={10} />
                    {ar ? "المبلغ الذي تريد دفعه" : "Amount you wish to pay"}
                  </label>

                  {/* Suggested price hint */}
                  <p className="text-[10px] text-white/25">
                    {ar
                      ? `السعر المقترح: ${priceFormatted} ${tx.currency}`
                      : `Suggested price: ${priceFormatted} ${tx.currency}`}
                  </p>

                  {/* Input row */}
                  <div className={`flex items-center gap-0 rounded-2xl border overflow-hidden transition-colors ${
                    showAmountError
                      ? "border-red-500/60 bg-red-500/8"
                      : "border-white/12 bg-white/6 focus-within:border-emerald-500/50 focus-within:bg-white/8"
                  }`}>
                    <span className="px-4 py-3.5 text-sm font-bold text-white/40 shrink-0 select-none border-r border-white/8">
                      {tx.currency}
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      placeholder={String(tx.price)}
                      value={buyerAmountStr}
                      onChange={e => {
                        setBuyerAmountStr(e.target.value);
                        setAmountTouched(true);
                        setPayError(null);
                      }}
                      onBlur={() => setAmountTouched(true)}
                      className="flex-1 bg-transparent px-4 py-3.5 text-base font-bold text-white placeholder-white/20 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      dir="ltr"
                    />
                  </div>

                  {/* Validation error */}
                  <AnimatePresence>
                    {showAmountError && (
                      <motion.p
                        key="amt-err"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="flex items-center gap-1.5 text-[11px] text-red-400"
                      >
                        <AlertCircle size={11} />
                        {ar ? "أدخل مبلغاً أكبر من صفر." : "Enter an amount greater than 0."}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Secured — show actual paid amount */}
              {dealStatus !== "awaiting_payment" && paidAmount !== null && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-white/50">
                    <DollarSign size={14} />
                    <span className="text-sm">{ar ? "المبلغ المدفوع" : "Amount Paid"}</span>
                  </div>
                  <p className="text-2xl font-black text-white">
                    {paidAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    <span className="text-base font-semibold text-white/50 ms-1.5">{tx.currency}</span>
                  </p>
                </div>
              )}

              {/* Escrow note */}
              <div className="rounded-xl bg-emerald-900/20 border border-emerald-500/20 px-3.5 py-3 flex items-start gap-2.5">
                <ShieldCheck size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-white/50 leading-relaxed">
                  {ar
                    ? "ستُحتجز أموالك بأمان في حساب ضمان (إسكرو) ولن تُرسل للبائع حتى تأكيد الاستلام."
                    : "Your funds will be held in escrow and only released to the seller after you confirm receipt."}
                </p>
              </div>

              {/* Payment error */}
              <AnimatePresence>
                {payError && (
                  <motion.div
                    key="pay-err"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="rounded-xl bg-red-500/10 border border-red-500/20 px-3.5 py-3 flex items-start gap-2"
                  >
                    <AlertCircle size={13} className="text-red-400 shrink-0 mt-0.5" />
                    <p className="text-[12px] text-red-300 leading-snug">{payError}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Action buttons (state machine) ── */}
              <AnimatePresence mode="wait">

                {/* ① Awaiting payment → amount input + Pay Now */}
                {dealStatus === "awaiting_payment" && (
                  <motion.button
                    key="pay-btn"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    whileTap={{ scale: (paying || !amountValid) ? 1 : 0.97 }}
                    onClick={handlePayNow}
                    disabled={paying || !amountValid}
                    className="w-full py-4 rounded-2xl bg-emerald-600 text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-700/30 hover:brightness-110 transition disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {paying ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        {ar ? "جارٍ المعالجة…" : "Processing…"}
                      </>
                    ) : (
                      <>
                        <Lock size={16} />
                        {amountValid
                          ? (ar
                              ? `ادفع الآن — ${buyerAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${tx.currency}`
                              : `Pay Now — ${buyerAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${tx.currency}`)
                          : (ar ? "أدخل المبلغ أولاً" : "Enter amount to pay")}
                      </>
                    )}
                  </motion.button>
                )}

                {/* ② Payment secured → waiting for seller to ship */}
                {dealStatus === "payment_secured" && (
                  <motion.div
                    key="secured-state"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-2.5"
                  >
                    <div className="w-full py-3.5 rounded-2xl bg-emerald-600/15 border border-emerald-500/30 text-emerald-300 font-bold text-sm flex items-center justify-center gap-2">
                      <CheckCircle2 size={15} />
                      {ar ? "تم تأمين الدفع — بانتظار الشحن" : "Payment Secured — Awaiting Shipment"}
                    </div>
                    <button
                      onClick={handleSimulateShipment}
                      className="w-full py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/30 text-[11px] font-medium hover:text-white/50 hover:bg-white/8 transition"
                    >
                      {ar
                        ? "← محاكاة (تجريبي): البائع يؤكد الشحن"
                        : "← Demo: Simulate seller verifying shipment"}
                    </button>
                  </motion.div>
                )}

                {/* ③ Shipment verified → buyer confirms receipt */}
                {dealStatus === "shipment_verified" && (
                  <motion.button
                    key="confirm-btn"
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    whileTap={{ scale: confirming ? 1 : 0.97 }}
                    onClick={handleConfirmReceipt}
                    disabled={confirming}
                    className="w-full py-4 rounded-2xl bg-blue-600 text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-lg shadow-blue-700/30 hover:brightness-110 transition disabled:opacity-70"
                  >
                    {confirming ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        {ar ? "جارٍ التأكيد…" : "Confirming…"}
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={16} />
                        {ar ? "تأكيد الاستلام — تحرير الأموال" : "Confirm Receipt — Release Funds"}
                      </>
                    )}
                  </motion.button>
                )}

                {/* ④ Delivered — deal complete */}
                {dealStatus === "delivered" && (
                  <motion.div
                    key="delivered-state"
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-full py-4 rounded-2xl bg-emerald-600/15 border border-emerald-500/25 text-emerald-300 font-bold text-base flex items-center justify-center gap-2.5"
                  >
                    <CheckCircle2 size={17} />
                    {ar ? "اكتملت الصفقة — تم تحرير الأموال" : "Deal Complete — Funds Released"}
                  </motion.div>
                )}

              </AnimatePresence>

              {/* Gateway note */}
              <p className="text-[10px] text-white/20 text-center">
                {ar
                  ? "الدفع الحقيقي غير مفعّل حالياً — جاهز للربط بـ Google Play Billing أو أي بوابة دفع."
                  : "Real payment not active — ready for Google Play Billing or any gateway integration."}
              </p>
            </div>
          </motion.div>

          {/* ═══ 6. SHIPMENT PROOF CARD ════════════════════════════════════
               Seller uploads a shipping receipt + optional tracking link.
               • Visible to seller during payment_secured (upload form).
               • Visible to both parties once a proof has been uploaded (read-only for buyer).
               • Seller can re-upload at any time while deal is payment_secured.  */}
          {((isSeller && dealStatus === "payment_secured") || !!existingShipmentProof) && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="rounded-3xl bg-white/4 border border-white/8 overflow-hidden"
            >
              {/* Card header */}
              <div className="bg-gradient-to-r from-indigo-600/15 to-transparent px-5 pt-4 pb-3 border-b border-white/6">
                <div className="flex items-center gap-2">
                  <Truck size={12} className="text-indigo-400" />
                  <p className="text-[10px] font-bold text-indigo-400/80 uppercase tracking-widest">
                    {ar ? "إثبات الشحن" : "Shipment Proof"}
                  </p>
                </div>
              </div>

              <div className="px-5 py-5 space-y-4">

                {/* ── Existing proof (both roles) ── */}
                {existingShipmentProof && (
                  <div className="rounded-2xl bg-indigo-600/8 border border-indigo-500/20 px-4 py-3.5 space-y-3">
                    <p className="text-[11px] font-bold text-white/50">
                      {ar ? "آخر إثبات شحن مرفوع" : "Last uploaded shipment proof"}
                    </p>

                    {/* File link */}
                    <a
                      href={existingShipmentProof.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-indigo-300 text-sm hover:underline break-all"
                    >
                      <FileText size={14} className="shrink-0" />
                      <span>
                        {existingShipmentProof.file_url.split("/").pop() ?? ar ? "ملف الشحن" : "Shipment file"}
                      </span>
                    </a>

                    {/* Tracking link */}
                    {existingShipmentProof.tracking_link ? (
                      <div className="flex items-start gap-2">
                        <Link2 size={13} className="text-white/30 shrink-0 mt-0.5" />
                        <a
                          href={existingShipmentProof.tracking_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-300 text-[12px] hover:underline break-all"
                        >
                          {existingShipmentProof.tracking_link}
                        </a>
                      </div>
                    ) : (
                      <p className="text-[11px] text-white/25 flex items-center gap-1.5">
                        <Link2 size={11} />
                        {ar ? "لا يوجد رابط تتبع" : "No tracking link provided"}
                      </p>
                    )}

                    {/* Upload date */}
                    <p className="text-[10px] text-white/25">
                      {ar ? "رُفع في: " : "Uploaded: "}
                      {new Date(existingShipmentProof.uploaded_at).toLocaleString(
                        ar ? "ar-SA" : "en-US",
                        { dateStyle: "medium", timeStyle: "short" },
                      )}
                    </p>
                  </div>
                )}

                {/* ── Upload form (seller, payment_secured only) ── */}
                {isSeller && dealStatus === "payment_secured" && (
                  <div className="space-y-3.5">

                    {/* Help text */}
                    {!existingShipmentProof && (
                      <p className="text-[12px] text-white/50 leading-relaxed">
                        {ar
                          ? "ارفع صورة وصل الشحن أو أي وثيقة تثبت إرسال المنتج للمشتري، مع رابط تتبع الشحنة إن وُجد."
                          : "Upload your shipping receipt or any document proving the item was shipped. Include a tracking link if available."}
                      </p>
                    )}

                    {/* Tracking link input */}
                    <div className="space-y-1.5">
                      <label className="flex items-center gap-1.5 text-[10px] font-bold text-white/40 uppercase tracking-widest">
                        <Link2 size={10} />
                        {ar ? "رابط تتبع الشحنة (اختياري)" : "Tracking link (optional)"}
                      </label>
                      <input
                        type="url"
                        dir="ltr"
                        placeholder="https://track.dhl.com/..."
                        value={shipTrackingLink}
                        onChange={e => setShipTrackingLink(e.target.value)}
                        className="w-full bg-white/5 border border-white/12 rounded-2xl px-4 py-3 text-sm text-white placeholder-white/20 outline-none focus:border-indigo-500/50 focus:bg-white/7 transition-colors"
                      />
                    </div>

                    {/* File picker */}
                    <div className="space-y-1.5">
                      <label className="flex items-center gap-1.5 text-[10px] font-bold text-white/40 uppercase tracking-widest">
                        <Upload size={10} />
                        {ar ? "ملف الشحن" : "Shipment file"}
                      </label>
                      <input
                        ref={shipFileRef}
                        type="file"
                        accept="application/pdf,image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={e => {
                          const f = e.target.files?.[0] ?? null;
                          setShipFile(f);
                          setShipError(null);
                          setShipSuccess(false);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => shipFileRef.current?.click()}
                        className="w-full rounded-2xl border-2 border-dashed border-white/12 hover:border-indigo-500/40 bg-white/3 hover:bg-indigo-600/5 transition-colors px-4 py-4 flex flex-col items-center gap-2"
                      >
                        {shipFile ? (
                          <div className="flex items-center gap-2 text-indigo-300 text-sm font-medium">
                            <FileText size={16} />
                            <span className="truncate max-w-[200px]">{shipFile.name}</span>
                            <span className="text-white/30 text-[11px]">
                              ({(shipFile.size / 1024).toFixed(0)} KB)
                            </span>
                          </div>
                        ) : (
                          <>
                            <Upload size={18} className="text-white/20" />
                            <span className="text-[12px] text-white/35">
                              {ar
                                ? "اضغط لاختيار ملف (PDF / صورة — حتى 10 MB)"
                                : "Tap to choose file (PDF / Image — up to 10 MB)"}
                            </span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Upload button */}
                    <motion.button
                      type="button"
                      onClick={handleUploadShipmentProof}
                      disabled={!shipFile || shipUploading}
                      whileTap={{ scale: 0.97 }}
                      className={`w-full py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                        !shipFile || shipUploading
                          ? "bg-white/6 text-white/25 cursor-not-allowed border border-white/8"
                          : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/30"
                      }`}
                    >
                      {shipUploading ? (
                        <>
                          <Loader2 size={15} className="animate-spin" />
                          {ar ? "جارٍ الرفع…" : "Uploading…"}
                        </>
                      ) : (
                        <>
                          <Truck size={15} />
                          {ar
                            ? (existingShipmentProof ? "تحديث إثبات الشحن" : "رفع إثبات الشحن")
                            : (existingShipmentProof ? "Update Shipment Proof" : "Upload Shipment Proof")}
                        </>
                      )}
                    </motion.button>

                    {/* Success banner */}
                    <AnimatePresence>
                      {shipSuccess && (
                        <motion.div
                          key="ship-ok"
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className="rounded-xl bg-indigo-600/12 border border-indigo-500/25 px-3.5 py-2.5 flex items-center gap-2"
                        >
                          <CheckCircle2 size={13} className="text-indigo-400 shrink-0" />
                          <p className="text-[12px] text-indigo-300 font-medium">
                            {ar
                              ? "✓ تم رفع إثبات الشحن — أُبلغ المشتري."
                              : "✓ Shipment proof uploaded — buyer has been notified."}
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Error banner */}
                    <AnimatePresence>
                      {shipError && (
                        <motion.div
                          key="ship-err"
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className="rounded-xl bg-red-500/10 border border-red-500/25 px-3.5 py-2.5 flex items-center gap-2"
                        >
                          <AlertCircle size={13} className="text-red-400 shrink-0" />
                          <p className="text-[12px] text-red-300 font-medium">{shipError}</p>
                        </motion.div>
                      )}
                    </AnimatePresence>

                  </div>
                )}

                {/* ── Buyer read-only message when seller hasn't uploaded yet ── */}
                {!isSeller && !existingShipmentProof && dealStatus === "payment_secured" && (
                  <p className="text-[12px] text-white/40 text-center py-2">
                    {ar
                      ? "في انتظار رفع البائع لإثبات الشحن…"
                      : "Waiting for the seller to upload shipment proof…"}
                  </p>
                )}

              </div>
            </motion.div>
          )}

          {/* ═══ 7. DELIVERY PROOF CARD (Part #8) ════════════════════════════
               Buyer uploads a photo/receipt proving they received the item.
               • Visible to buyer when deal is 'delivered' (upload form + read-only).
               • Visible to seller when proof has been uploaded (read-only).
               • Historical reference once proof exists for either party. */}
          {((!isSeller && dealStatus === "delivered") || !!existingDeliveryProof) && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.12 }}
              className="rounded-3xl bg-white/4 border border-white/8 overflow-hidden"
            >
              {/* Card header */}
              <div className="bg-gradient-to-r from-teal-600/15 to-transparent px-5 pt-4 pb-3 border-b border-white/6">
                <div className="flex items-center gap-2">
                  <Package size={12} className="text-teal-400" />
                  <p className="text-[10px] font-bold text-teal-400/80 uppercase tracking-widest">
                    {ar ? "إثبات الاستلام" : "Delivery Proof"}
                  </p>
                </div>
              </div>

              <div className="px-5 py-5 space-y-4">

                {/* ── Existing proof (both roles, historical) ── */}
                {existingDeliveryProof && (
                  <div className="rounded-2xl bg-teal-600/8 border border-teal-500/20 px-4 py-3.5 space-y-3">
                    <p className="text-[11px] font-bold text-white/50">
                      {ar ? "آخر إثبات استلام مرفوع" : "Last uploaded delivery proof"}
                    </p>

                    {/* File link */}
                    <a
                      href={existingDeliveryProof.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-teal-300 text-sm hover:underline break-all"
                    >
                      <FileText size={14} className="shrink-0" />
                      <span>
                        {existingDeliveryProof.file_url.split("/").pop() || (ar ? "ملف الاستلام" : "Delivery file")}
                      </span>
                    </a>

                    {/* Upload date */}
                    <p className="text-[10px] text-white/25">
                      {ar ? "رُفع في: " : "Uploaded: "}
                      {new Date(existingDeliveryProof.uploaded_at).toLocaleString(
                        ar ? "ar-SA" : "en-US",
                        { dateStyle: "medium", timeStyle: "short" },
                      )}
                    </p>
                  </div>
                )}

                {/* ── Upload form (buyer, delivered state only) ── */}
                {!isSeller && dealStatus === "delivered" && (
                  <div className="space-y-3.5">

                    {/* Help text — only shown before first upload */}
                    {!existingDeliveryProof && (
                      <p className="text-[12px] text-white/50 leading-relaxed">
                        {ar
                          ? "ارفع صورة أو وثيقة تثبت استلامك للمنتج. يمكنك تحديثها في أي وقت."
                          : "Upload a photo or document confirming you received the item. You can update it any time."}
                      </p>
                    )}

                    {/* File picker */}
                    <div className="space-y-1.5">
                      <label className="flex items-center gap-1.5 text-[10px] font-bold text-white/40 uppercase tracking-widest">
                        <Upload size={10} />
                        {ar ? "ملف الاستلام" : "Delivery file"}
                      </label>
                      <input
                        ref={delivFileRef}
                        type="file"
                        accept="application/pdf,image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={e => {
                          const f = e.target.files?.[0] ?? null;
                          setDelivFile(f);
                          setDelivError(null);
                          setDelivSuccess(false);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => delivFileRef.current?.click()}
                        className="w-full rounded-2xl border-2 border-dashed border-white/12 hover:border-teal-500/40 bg-white/3 hover:bg-teal-600/5 transition-colors px-4 py-4 flex flex-col items-center gap-2"
                      >
                        {delivFile ? (
                          <div className="flex items-center gap-2 text-teal-300 text-sm font-medium">
                            <FileText size={16} />
                            <span className="truncate max-w-[200px]">{delivFile.name}</span>
                            <span className="text-white/30 text-[11px]">
                              ({(delivFile.size / 1024).toFixed(0)} KB)
                            </span>
                          </div>
                        ) : (
                          <>
                            <Upload size={18} className="text-white/20" />
                            <span className="text-[12px] text-white/35">
                              {ar
                                ? "اضغط لاختيار ملف (PDF / صورة — حتى 10 MB)"
                                : "Tap to choose file (PDF / Image — up to 10 MB)"}
                            </span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Upload button */}
                    <motion.button
                      type="button"
                      onClick={handleUploadDeliveryProof}
                      disabled={!delivFile || delivUploading}
                      whileTap={{ scale: 0.97 }}
                      className={`w-full py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                        !delivFile || delivUploading
                          ? "bg-white/6 text-white/25 cursor-not-allowed border border-white/8"
                          : "bg-teal-600 hover:bg-teal-500 text-white shadow-lg shadow-teal-900/30"
                      }`}
                    >
                      {delivUploading ? (
                        <>
                          <Loader2 size={15} className="animate-spin" />
                          {ar ? "جارٍ الرفع…" : "Uploading…"}
                        </>
                      ) : (
                        <>
                          <Package size={15} />
                          {ar
                            ? (existingDeliveryProof ? "تحديث إثبات الاستلام" : "رفع إثبات الاستلام")
                            : (existingDeliveryProof ? "Update Delivery Proof" : "Upload Delivery Proof")}
                        </>
                      )}
                    </motion.button>

                    {/* Success banner */}
                    <AnimatePresence>
                      {delivSuccess && (
                        <motion.div
                          key="deliv-ok"
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className="rounded-xl bg-teal-600/12 border border-teal-500/25 px-3.5 py-2.5 flex items-center gap-2"
                        >
                          <CheckCircle2 size={13} className="text-teal-400 shrink-0" />
                          <p className="text-[12px] text-teal-300 font-medium">
                            {ar
                              ? "✓ تم رفع إثبات الاستلام — أُبلغ البائع."
                              : "✓ Delivery proof uploaded — seller has been notified."}
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Error banner */}
                    <AnimatePresence>
                      {delivError && (
                        <motion.div
                          key="deliv-err"
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className="rounded-xl bg-red-500/10 border border-red-500/25 px-3.5 py-2.5 flex items-center gap-2"
                        >
                          <AlertCircle size={13} className="text-red-400 shrink-0" />
                          <p className="text-[12px] text-red-300 font-medium">{delivError}</p>
                        </motion.div>
                      )}
                    </AnimatePresence>

                  </div>
                )}

                {/* ── Seller read-only placeholder when no proof yet ── */}
                {isSeller && !existingDeliveryProof && (
                  <p className="text-[12px] text-white/40 text-center py-2">
                    {ar
                      ? "لم يرفع المشتري إثبات الاستلام بعد."
                      : "The buyer has not uploaded a delivery proof yet."}
                  </p>
                )}

              </div>
            </motion.div>
          )}

          {/* ═══ 9. SHIPPING FEE DISPUTE CARD ═════════════════════════════════
               Visible to both parties once payment is secured.
               Either party can open a dispute about who should pay shipping.
               Re-submitting updates the previous dispute row (upsert). */}
          {dealStatus !== "awaiting_payment" && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.16 }}
              className="rounded-3xl bg-white/4 border border-white/8 overflow-hidden"
            >
              {/* Card header */}
              <div className="bg-gradient-to-r from-orange-600/15 to-transparent px-5 pt-4 pb-3 border-b border-white/6">
                <div className="flex items-center gap-2">
                  <Scale size={12} className="text-orange-400" />
                  <p className="text-[10px] font-bold text-orange-400/80 uppercase tracking-widest">
                    {ar ? "نزاع رسوم الشحن" : "Shipping Fee Dispute"}
                  </p>
                </div>
                <p className="text-[11px] text-white/40 mt-1 leading-snug">
                  {ar
                    ? "إذا كان هناك خلاف حول من يتحمل رسوم الشحن، يمكن لكلٍّ من المشتري والبائع تقديم موقفه هنا."
                    : "If there is a disagreement about who covers the shipping fee, either party can submit their position here."}
                </p>
              </div>

              <div className="px-5 py-4 space-y-4">

                {/* ── Existing disputes (read-only list for both parties) ── */}
                {disputes.length > 0 && (
                  <div className="space-y-2.5">
                    <p className="text-[10px] font-bold text-white/35 uppercase tracking-widest">
                      {ar ? "النزاعات المقدَّمة" : "Submitted Disputes"}
                    </p>
                    {disputes.map(d => {
                      const isMe = d.submitted_by === user?.id;
                      const partyLabel = ar
                        ? (d.party === "buyer" ? "المشتري" : "البائع")
                        : (d.party === "buyer" ? "Buyer"   : "Seller");
                      return (
                        <div
                          key={d.id}
                          className={`rounded-2xl border px-3.5 py-3 space-y-1.5 ${
                            isMe
                              ? "bg-orange-600/8 border-orange-500/25"
                              : "bg-white/3 border-white/8"
                          }`}
                        >
                          <div className="flex items-center justify-between flex-wrap gap-1">
                            <span className="text-[10px] font-bold text-white/40">
                              {isMe
                                ? (ar ? "موقفك" : "Your position")
                                : (isSeller
                                    ? (ar ? "موقف المشتري" : "Buyer's position")
                                    : (ar ? "موقف البائع"  : "Seller's position"))}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${
                              d.party === "buyer"
                                ? "bg-sky-500/12 text-sky-300 border-sky-500/25"
                                : "bg-violet-500/12 text-violet-300 border-violet-500/25"
                            }`}>
                              {ar ? "المسؤول: " : "Responsible: "}{partyLabel}
                            </span>
                          </div>
                          {d.comment && (
                            <p className="text-[12px] text-white/65 leading-relaxed">
                              {d.comment}
                            </p>
                          )}
                          {d.proof_url && (
                            <a
                              href={d.proof_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 text-[11px] text-orange-300 hover:text-orange-200 transition truncate"
                            >
                              <Link2 size={10} className="shrink-0" />
                              <span className="truncate">{d.proof_url}</span>
                            </a>
                          )}
                          <p className="text-[10px] text-white/20">
                            {new Date(d.created_at).toLocaleDateString(ar ? "ar-SA" : "en-US", { dateStyle: "medium" })}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ── Submit / update dispute form ── */}
                <div className="space-y-3">
                  <p className="text-[11px] font-bold text-white/50">
                    {disputes.some(d => d.submitted_by === user?.id)
                      ? (ar ? "تحديث موقفك" : "Update your position")
                      : (ar ? "تقديم نزاع" : "Submit a dispute")}
                  </p>

                  {/* Party selector */}
                  <div className="space-y-1.5">
                    <p className="text-[10px] text-white/35">
                      {ar ? "من يجب أن يدفع رسوم الشحن؟" : "Who should pay the shipping fee?"}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {(["buyer", "seller"] as const).map(opt => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setDisputeParty(opt)}
                          className={`py-2.5 rounded-xl text-[12px] font-bold border transition-all ${
                            disputeParty === opt
                              ? opt === "buyer"
                                ? "bg-sky-600/20 border-sky-500/50 text-sky-300"
                                : "bg-violet-600/20 border-violet-500/50 text-violet-300"
                              : "bg-white/4 border-white/10 text-white/40 hover:bg-white/8"
                          }`}
                        >
                          {ar
                            ? (opt === "buyer" ? "المشتري" : "البائع")
                            : (opt === "buyer" ? "Buyer"   : "Seller")}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Comment */}
                  <textarea
                    value={disputeComment}
                    onChange={e => setDisputeComment(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    placeholder={ar ? "شرح موقفك (اختياري)…" : "Explain your position (optional)…"}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-3.5 py-2.5 text-sm text-white/80 placeholder-white/20 focus:outline-none focus:border-orange-500/40 resize-none transition"
                    dir={ar ? "rtl" : "ltr"}
                  />

                  {/* Optional proof URL */}
                  <div className="relative">
                    <Link2 size={12} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/20 pointer-events-none" />
                    <input
                      type="url"
                      value={disputeProofUrl}
                      onChange={e => setDisputeProofUrl(e.target.value)}
                      placeholder={ar ? "رابط الإثبات (اختياري)…" : "Proof URL (optional)…"}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl pr-9 pl-3.5 py-2.5 text-[13px] text-white/70 placeholder-white/20 focus:outline-none focus:border-orange-500/40 transition"
                      dir="ltr"
                    />
                  </div>

                  {/* Submit button */}
                  <motion.button
                    type="button"
                    onClick={handleSubmitDispute}
                    disabled={disputeSubmitting}
                    whileTap={{ scale: 0.97 }}
                    className={`w-full py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                      disputeSubmitting
                        ? "bg-white/6 text-white/25 cursor-not-allowed border border-white/8"
                        : "bg-orange-600 hover:bg-orange-500 text-white shadow-lg shadow-orange-900/30"
                    }`}
                  >
                    {disputeSubmitting ? (
                      <>
                        <Loader2 size={15} className="animate-spin" />
                        {ar ? "جارٍ الإرسال…" : "Submitting…"}
                      </>
                    ) : (
                      <>
                        <Scale size={15} />
                        {disputes.some(d => d.submitted_by === user?.id)
                          ? (ar ? "تحديث النزاع" : "Update Dispute")
                          : (ar ? "تقديم النزاع" : "Submit Dispute")}
                      </>
                    )}
                  </motion.button>

                  {/* Success banner */}
                  <AnimatePresence>
                    {disputeSuccess && (
                      <motion.div
                        key="dispute-ok"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="rounded-xl bg-orange-600/12 border border-orange-500/25 px-3.5 py-2.5 flex items-center gap-2"
                      >
                        <CheckCircle2 size={13} className="text-orange-400 shrink-0" />
                        <p className="text-[12px] text-orange-300 font-medium">
                          {ar
                            ? "✓ تم تقديم النزاع — أُبلغ الطرف الآخر."
                            : "✓ Dispute submitted — the other party has been notified."}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Error banner */}
                  <AnimatePresence>
                    {disputeError && (
                      <motion.div
                        key="dispute-err"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="rounded-xl bg-red-500/10 border border-red-500/25 px-3.5 py-2.5 flex items-center gap-2"
                      >
                        <AlertCircle size={13} className="text-red-400 shrink-0" />
                        <p className="text-[12px] text-red-300 font-medium">{disputeError}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                </div>
              </div>
            </motion.div>
          )}

          {/* ═══ 10. SELLER PENALTY CARD ════════════════════════════════════
               Visible only to the seller (tx.seller_id === user.id).
               Read-only warning panel that lists all admin-imposed penalties
               for this deal. Fetched via GET /api/seller-penalties/:sellerId
               with ?dealId= query param.  Non-fatal — empty if no penalties. */}
          {tx && user && tx.seller_id === user.id && penalties.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.17 }}
              className="rounded-3xl bg-white/4 border border-red-500/20 overflow-hidden"
            >
              {/* Card header */}
              <div className="bg-gradient-to-r from-red-600/15 to-transparent px-5 pt-4 pb-3 border-b border-white/6">
                <div className="flex items-center gap-2">
                  <AlertCircle size={12} className="text-red-400" />
                  <p className="text-[10px] font-bold text-red-400/90 uppercase tracking-widest">
                    {ar ? "عقوبات الصفقة" : "Deal Penalties"}
                  </p>
                </div>
                <p className="text-[11px] text-white/40 mt-1 leading-relaxed" dir={ar ? "rtl" : "ltr"}>
                  {ar
                    ? "تم تطبيق هذه العقوبات على صفقتك من قِبل الإدارة."
                    : "The following penalties were applied to your deal by administration."}
                </p>
              </div>

              <div className="px-5 py-4 space-y-3">
                {penalties.map(p => {
                  const typeLabel: Record<string, { ar: string; en: string }> = {
                    warning:    { ar: "تحذير",  en: "Warning" },
                    fee:        { ar: "غرامة",  en: "Fee" },
                    suspension: { ar: "إيقاف",  en: "Suspension" },
                    other:      { ar: "أخرى",   en: "Other" },
                  };
                  const typeColor: Record<string, string> = {
                    warning:    "bg-amber-500/12 text-amber-300 border-amber-500/25",
                    fee:        "bg-red-500/12 text-red-300 border-red-500/25",
                    suspension: "bg-orange-500/12 text-orange-300 border-orange-500/25",
                    other:      "bg-white/8 text-white/50 border-white/12",
                  };
                  const label = typeLabel[p.penalty_type] ?? { ar: p.penalty_type, en: p.penalty_type };
                  return (
                    <div
                      key={p.id}
                      className={`rounded-2xl border px-4 py-3 space-y-2 ${p.resolved ? "bg-white/3 border-white/8 opacity-60" : "bg-red-600/8 border-red-500/18"}`}
                      dir={ar ? "rtl" : "ltr"}
                    >
                      {/* Header row */}
                      <div className="flex items-center justify-between flex-wrap gap-1.5">
                        <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-lg border ${typeColor[p.penalty_type] ?? typeColor.other}`}>
                          {ar ? label.ar : label.en}
                        </span>
                        <div className="flex items-center gap-2">
                          {p.amount != null && (
                            <span className="text-[11px] font-bold text-amber-300">
                              {ar ? "المبلغ:" : "Amount:"} {Number(p.amount).toLocaleString()}
                            </span>
                          )}
                          <span className={`text-[10px] font-medium ${p.resolved ? "text-emerald-400" : "text-red-400"}`}>
                            {p.resolved
                              ? (ar ? "✓ محلول" : "✓ Resolved")
                              : (ar ? "● نشط"   : "● Active")}
                          </span>
                        </div>
                      </div>

                      {/* Reason */}
                      <p className="text-[12px] text-white/65 leading-relaxed">{p.reason}</p>

                      {/* Date */}
                      <p className="text-[10px] text-white/25">
                        {new Date(p.created_at).toLocaleDateString(ar ? "ar-SA" : "en-US", { dateStyle: "medium" })}
                      </p>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* ═══ 8. DEAL RATING CARD ══════════════════════════════════════════
               Visible only once the deal reaches the 'delivered' terminal state.
               Both buyer and seller can each rate the other party exactly once.
               • myRating exists    → read-only star panel
               • myRating is null   → interactive star picker + optional comment
               • theirRating exists → read-only panel for the other party's rating */}
          {dealStatus === "delivered" && rateeId && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.18 }}
              className="rounded-3xl bg-white/4 border border-white/8 overflow-hidden"
            >
              {/* Card header */}
              <div className="bg-gradient-to-r from-emerald-600/15 to-transparent px-5 pt-4 pb-3 border-b border-white/6">
                <div className="flex items-center gap-2">
                  <Star size={12} className="text-amber-400" fill="currentColor" />
                  <p className="text-[10px] font-bold text-emerald-400/80 uppercase tracking-widest">
                    {ar ? "تقييم الصفقة" : "Rate this Deal"}
                  </p>
                </div>
              </div>

              <div className="px-5 py-4 space-y-4">

                {/* ── USER'S OWN RATING ──────────────────────────────────────── */}
                <div className="space-y-3">
                  <p className="text-[11px] font-bold text-white/50">
                    {myRating
                      ? (ar ? "تقييمك" : "Your Rating")
                      : (ar
                          ? `قيّم ${isSeller ? "المشتري" : "البائع"}`
                          : `Rate the ${isSeller ? "Buyer" : "Seller"}`)}
                  </p>

                  {/* Already rated — read-only panel */}
                  {myRating && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="rounded-2xl bg-amber-600/8 border border-amber-500/20 px-4 py-3.5 space-y-2.5"
                    >
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {[1,2,3,4,5].map(n => (
                          <Star key={n} size={18}
                            fill={n <= myRating.stars ? "currentColor" : "none"}
                            strokeWidth={1.5}
                            className={n <= myRating.stars ? "text-amber-400" : "text-white/15"}
                          />
                        ))}
                        <span className="text-xs font-bold text-amber-300 ml-1">
                          {starLabels[myRating.stars - 1]}
                        </span>
                      </div>
                      {myRating.comment && (
                        <p className="text-sm text-white/75 leading-relaxed whitespace-pre-wrap break-words">
                          {myRating.comment}
                        </p>
                      )}
                      <p className="text-[10px] text-white/25">
                        {new Date(myRating.created_at).toLocaleString(
                          ar ? "ar-SA" : "en-US",
                          { dateStyle: "medium", timeStyle: "short" }
                        )}
                      </p>
                    </motion.div>
                  )}

                  {/* Success banner — shown immediately after submission */}
                  <AnimatePresence>
                    {ratingSuccess && (
                      <motion.div
                        key="rating-ok"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="rounded-xl bg-emerald-600/12 border border-emerald-500/25 px-3.5 py-2.5 flex items-center gap-2"
                      >
                        <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                        <p className="text-[12px] text-emerald-300 font-medium">
                          {ar
                            ? "✓ تم إرسال تقييمك — تلقّى الطرف الآخر إشعاراً."
                            : "✓ Rating submitted — the other party has been notified."}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Interactive star picker — shown when not yet rated */}
                  {!myRating && (
                    <div className="space-y-3">

                      {/* Star row */}
                      <div className="flex gap-2 justify-center py-1">
                        {[1,2,3,4,5].map(n => (
                          <button
                            key={n}
                            onClick={() => { setRatingStars(n); setRatingError(null); }}
                            onMouseEnter={() => setRatingHover(n)}
                            onMouseLeave={() => setRatingHover(0)}
                            className="transition-all duration-100 hover:scale-110 focus:outline-none"
                            aria-label={`${n} star${n !== 1 ? "s" : ""}`}
                          >
                            <Star
                              size={32}
                              strokeWidth={1.5}
                              fill={n <= (ratingHover || ratingStars) ? "currentColor" : "none"}
                              className={n <= (ratingHover || ratingStars)
                                ? "text-amber-400"
                                : "text-white/15"}
                            />
                          </button>
                        ))}
                      </div>

                      {/* Animated label below stars */}
                      <AnimatePresence mode="wait">
                        {(ratingHover || ratingStars) > 0 && (
                          <motion.p
                            key={ratingHover || ratingStars}
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="text-center text-sm font-bold text-amber-300"
                          >
                            {starLabels[(ratingHover || ratingStars) - 1]}
                          </motion.p>
                        )}
                      </AnimatePresence>

                      {/* Optional comment — only shown after a star is chosen */}
                      <AnimatePresence>
                        {ratingStars > 0 && (
                          <motion.div
                            key="comment-area"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden space-y-1"
                          >
                            <textarea
                              value={ratingComment}
                              onChange={e => {
                                setRatingComment(e.target.value);
                                setRatingError(null);
                              }}
                              placeholder={ar
                                ? "أضف تعليقاً (اختياري)…"
                                : "Add a comment (optional)…"}
                              maxLength={500}
                              rows={3}
                              dir={ar ? "rtl" : "ltr"}
                              className="w-full rounded-2xl bg-white/6 border border-white/12 focus:border-amber-500/50 focus:bg-white/8 px-4 py-3 text-sm text-white placeholder-white/20 outline-none resize-none leading-relaxed transition-colors"
                            />
                            <p className="text-[10px] text-white/20 text-end">
                              {ratingComment.length} / 500
                            </p>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Error banner */}
                      <AnimatePresence>
                        {ratingError && (
                          <motion.div
                            key="rating-err"
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="rounded-xl bg-red-500/10 border border-red-500/20 px-3.5 py-2.5 flex items-start gap-2"
                          >
                            <AlertCircle size={13} className="text-red-400 shrink-0 mt-0.5" />
                            <p className="text-[12px] text-red-300 leading-snug">{ratingError}</p>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Submit button */}
                      <motion.button
                        whileTap={{ scale: (ratingSubmitting || ratingStars < 1) ? 1 : 0.97 }}
                        onClick={handleSubmitRating}
                        disabled={ratingStars < 1 || ratingSubmitting}
                        className="w-full py-3.5 rounded-2xl bg-amber-500 text-white font-bold text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-amber-700/20 hover:brightness-110 transition disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {ratingSubmitting ? (
                          <>
                            <Loader2 size={14} className="animate-spin" />
                            {ar ? "جارٍ الإرسال…" : "Submitting…"}
                          </>
                        ) : (
                          <>
                            <Star size={14} fill="currentColor" />
                            {ar ? "إرسال التقييم" : "Submit Rating"}
                          </>
                        )}
                      </motion.button>

                    </div>
                  )}
                </div>

                {/* ── OTHER PARTY'S RATING OF THE USER ───────────────────────── */}
                {theirRating && (
                  <>
                    <div className="border-t border-white/6" />
                    <div className="space-y-2">
                      <p className="text-[11px] font-bold text-white/30">
                        {ar
                          ? `تقييم ${isSeller ? "المشتري" : "البائع"} لك`
                          : `${isSeller ? "Buyer" : "Seller"}'s Rating of You`}
                      </p>
                      <div className="rounded-2xl bg-white/5 border border-white/10 px-4 py-3.5 space-y-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {[1,2,3,4,5].map(n => (
                            <Star key={n} size={16}
                              fill={n <= theirRating.stars ? "currentColor" : "none"}
                              strokeWidth={1.5}
                              className={n <= theirRating.stars ? "text-amber-400" : "text-white/15"}
                            />
                          ))}
                          <span className="text-[11px] font-bold text-white/40 ml-1">
                            {starLabels[theirRating.stars - 1]}
                          </span>
                        </div>
                        {theirRating.comment && (
                          <p className="text-sm text-white/60 leading-relaxed whitespace-pre-wrap break-words">
                            {theirRating.comment}
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                )}

              </div>
            </motion.div>
          )}

          {/* ── Escrow Panel ── */}
          <EscrowPanel dealId={tx.deal_id} paymentStatus={tx.payment_status} ar={ar} />

        </div>
      </div>
    </MobileLayout>
  );
}
