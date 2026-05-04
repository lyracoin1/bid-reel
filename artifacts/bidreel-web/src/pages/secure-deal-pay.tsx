import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, ShieldCheck, Package, FileText, DollarSign,
  Truck, StickyNote, Lock, Image, Video,
  CheckCircle2, Bell, PartyPopper, AlertCircle, AlertTriangle,
  Loader2, UserX, RefreshCw, User, UserCheck, PencilLine,
  ScrollText, Send, Star, Upload, X, Link2, Scale, ExternalLink,
  Eye, EyeOff, Phone, MapPin,
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
  reportExternalPayment,
  showBuyerInfo, getBuyerInfo,
  uploadProductMedia, getProductMedia,
  uploadDealReceipt, getDealReceipt,
  Transaction, DealCondition, SellerCondition, DealRating, PaymentProof, ShipmentProof, DeliveryProof, ShippingFeeDispute, SellerPenalty, EscrowRow, ProductMedia, BuyerRevealedInfo, DealReceipt,
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

// ─── BuyerInfoPanel ──────────────────────────────────────────────────────────
// Shown to the seller only.
// Seller reveals buyer contact info after payment is confirmed (secured).
// Locked display before payment; "Reveal" button when payment secured;
// full contact card after reveal.

function BuyerInfoPanel({
  dealId,
  paymentStatus,
  buyerInfoVisible: initialVisible,
  ar,
}: {
  dealId:           string;
  paymentStatus:    string;
  buyerInfoVisible: boolean;
  ar:               boolean;
}) {
  const [visible,   setVisible]   = useState(initialVisible);
  const [profile,   setProfile]   = useState<BuyerRevealedInfo | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealErr, setRevealErr] = useState<string | null>(null);

  // Auto-fetch if already revealed on mount
  useEffect(() => {
    if (!initialVisible) return;
    setLoading(true);
    getBuyerInfo(dealId)
      .then(p  => setProfile(p))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [dealId, initialVisible]);

  const canReveal = paymentStatus === "secured";

  async function handleReveal() {
    if (revealing || visible) return;
    setRevealing(true);
    setRevealErr(null);
    try {
      await showBuyerInfo(dealId);
      setVisible(true);
      const p = await getBuyerInfo(dealId);
      setProfile(p);
    } catch (err) {
      setRevealErr(
        err instanceof Error ? err.message : (ar ? "حدث خطأ" : "An error occurred"),
      );
    } finally {
      setRevealing(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.08 }}
      className="rounded-3xl bg-white/4 border border-white/8 overflow-hidden"
    >
      {/* ── Card header ── */}
      <div
        className={`bg-gradient-to-r ${
          visible ? "from-emerald-600/12" : "from-white/4"
        } to-transparent px-5 pt-4 pb-3 border-b border-white/6`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {visible ? (
              <Eye size={12} className="text-emerald-400" />
            ) : (
              <EyeOff size={12} className="text-white/25" />
            )}
            <p
              className={`text-[10px] font-bold uppercase tracking-widest ${
                visible ? "text-emerald-400/90" : "text-white/30"
              }`}
            >
              {ar ? "معلومات المشتري" : "Buyer Info"}
            </p>
            {visible && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 font-bold">
                {ar ? "مكشوفة" : "Revealed"}
              </span>
            )}
          </div>

          {/* Reveal button — seller only, payment confirmed, not yet revealed */}
          {!visible && canReveal && (
            <motion.button
              whileTap={{ scale: revealing ? 1 : 0.96 }}
              onClick={handleReveal}
              disabled={revealing}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 hover:brightness-110 transition disabled:opacity-50"
            >
              {revealing ? (
                <>
                  <Loader2 size={9} className="animate-spin" />
                  {ar ? "جارٍ الكشف…" : "Revealing…"}
                </>
              ) : (
                <>
                  <Eye size={9} />
                  {ar ? "كشف معلومات المشتري" : "Reveal Buyer Info"}
                </>
              )}
            </motion.button>
          )}
        </div>

        {/* Reveal error */}
        {revealErr && (
          <p className="text-[10px] text-red-400 mt-1.5 flex items-center gap-1">
            <AlertCircle size={9} />
            {revealErr}
          </p>
        )}
      </div>

      {/* ── Card body ── */}
      <div className="px-5 py-4">

        {/* Locked — payment not yet confirmed */}
        {!visible && !canReveal && (
          <div className="flex items-start gap-2.5 text-white/25">
            <Lock size={14} className="shrink-0 mt-0.5" />
            <p className="text-[11px] leading-relaxed">
              {ar
                ? "ستتمكن من الاطلاع على معلومات المشتري (الاسم والهاتف) بعد تأكيد الدفع."
                : "Buyer contact info (name & phone) will be unlocked after payment is confirmed."}
            </p>
          </div>
        )}

        {/* Locked — payment confirmed but not yet revealed */}
        {!visible && canReveal && (
          <div className="flex items-start gap-2.5 text-white/35">
            <Lock size={14} className="shrink-0 mt-0.5 text-amber-400/50" />
            <p className="text-[11px] leading-relaxed">
              {ar
                ? "تم تأكيد الدفع. اضغط على «كشف معلومات المشتري» للاطلاع على بيانات التواصل."
                : "Payment confirmed. Press \"Reveal Buyer Info\" to view the buyer's contact details."}
            </p>
          </div>
        )}

        {/* Loading spinner */}
        {visible && loading && (
          <div className="flex justify-center py-3">
            <Loader2 size={18} className="animate-spin text-white/20" />
          </div>
        )}

        {/* Profile not found */}
        {visible && !loading && !profile && (
          <p className="text-[11px] text-white/25 italic text-center py-2">
            {ar ? "لم يتم العثور على الملف الشخصي." : "Profile not found."}
          </p>
        )}

        {/* Revealed profile card */}
        {visible && !loading && profile && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            {/* Avatar + name */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 overflow-hidden">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <User size={16} className="text-emerald-400/60" />
                )}
              </div>
              <div>
                <p className="text-sm font-bold text-white/90 leading-tight">
                  {profile.display_name || profile.username || (ar ? "مستخدم" : "User")}
                </p>
                {profile.username && (
                  <p className="text-[11px] text-white/30">@{profile.username}</p>
                )}
              </div>
            </div>

            {/* Contact details */}
            <div className="space-y-1.5">
              {profile.phone ? (
                <div className="flex items-center gap-2 text-white/70">
                  <Phone size={11} className="text-emerald-400/60 shrink-0" />
                  <span className="text-sm font-mono tracking-wide" dir="ltr">{profile.phone}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-white/20">
                  <Phone size={11} className="shrink-0" />
                  <span className="text-[11px] italic">
                    {ar ? "لم يتم إدخال رقم هاتف" : "No phone number on file"}
                  </span>
                </div>
              )}

              {profile.location && (
                <div className="flex items-center gap-2 text-white/55">
                  <MapPin size={11} className="text-emerald-400/60 shrink-0" />
                  <span className="text-sm">{profile.location}</span>
                </div>
              )}
            </div>

            {/* Buyer UUID — for reference */}
            <p className="text-[9px] text-white/15 font-mono pt-1 truncate">{profile.id}</p>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

// ─── ProductMediaPanel ────────────────────────────────────────────────────────
// Shown on the deal page for both buyer and seller.
// Seller can upload product images/videos. Both parties see the gallery.

function ProductMediaPanel({
  dealId,
  isSeller,
  ar,
}: {
  dealId:   string;
  isSeller: boolean;
  ar:       boolean;
}) {
  const fileRef                                     = useRef<HTMLInputElement>(null);
  const [media,      setMedia]                      = useState<ProductMedia[]>([]);
  const [loading,    setLoading]                    = useState(true);
  const [uploading,  setUploading]                  = useState(false);
  const [uploadErr,  setUploadErr]                  = useState<string | null>(null);
  const [uploadOk,   setUploadOk]                   = useState(false);
  const [lightbox,   setLightbox]                   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getProductMedia(dealId)
      .then(items => setMedia(items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [dealId]);

  async function handleUpload(file: File) {
    if (uploading) return;
    setUploading(true);
    setUploadErr(null);
    setUploadOk(false);
    try {
      const saved = await uploadProductMedia(dealId, file);
      setMedia(prev => [saved, ...prev.filter(m => m.file_name !== saved.file_name)]);
      setUploadOk(true);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : (ar ? "فشل الرفع" : "Upload failed"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className="rounded-3xl bg-white/4 border border-white/8 overflow-hidden"
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-sky-600/12 to-transparent px-5 pt-4 pb-3 border-b border-white/6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Image size={12} className="text-sky-400" />
            <p className="text-[10px] font-bold text-sky-400/90 uppercase tracking-widest">
              {ar ? "وسائط المنتج" : "Product Media"}
            </p>
            {media.length > 0 && (
              <span className="text-[10px] text-white/30 font-medium">({media.length})</span>
            )}
          </div>
          {/* Seller upload button */}
          {isSeller && (
            <label
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold cursor-pointer transition ${
                uploading
                  ? "bg-white/5 text-white/25 pointer-events-none"
                  : "bg-sky-500/15 border border-sky-500/25 text-sky-300 hover:brightness-110"
              }`}
            >
              {uploading ? (
                <><Loader2 size={9} className="animate-spin" />{ar ? "جارٍ الرفع…" : "Uploading…"}</>
              ) : (
                <><Upload size={9} />{ar ? "رفع وسائط" : "Upload Media"}</>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,video/mp4"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                }}
              />
            </label>
          )}
        </div>
        {/* Error / success banners */}
        {uploadErr && (
          <p className="text-[10px] text-red-400 mt-1.5 flex items-center gap-1">
            <AlertCircle size={9} />{uploadErr}
          </p>
        )}
        {uploadOk && (
          <p className="text-[10px] text-emerald-400 mt-1.5 flex items-center gap-1">
            <CheckCircle2 size={9} />{ar ? "تم رفع الملف بنجاح." : "Uploaded successfully."}
          </p>
        )}
      </div>

      {/* Gallery */}
      <div className="px-5 py-4">
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 size={18} className="animate-spin text-white/20" />
          </div>
        ) : media.length === 0 ? (
          <p className="text-[11px] text-white/25 italic text-center py-2">
            {ar ? "لم يتم رفع وسائط بعد." : "No media uploaded yet."}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {media.map(m => (
              <div
                key={m.id}
                className="relative rounded-xl overflow-hidden aspect-square bg-white/5 border border-white/8 cursor-pointer hover:brightness-110 transition group"
                onClick={() => setLightbox(m.file_url)}
              >
                {m.media_type === "image" ? (
                  <img
                    src={m.file_url}
                    alt={m.file_name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                    <Video size={22} className="text-sky-400" />
                    <span className="text-[9px] text-white/30 text-center px-1 truncate max-w-full">
                      {m.file_name}
                    </span>
                  </div>
                )}
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <ExternalLink size={14} className="text-white/80" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            key="lb"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
            onClick={() => setLightbox(null)}
          >
            <button
              className="absolute top-4 end-4 text-white/60 hover:text-white transition"
              onClick={() => setLightbox(null)}
            >
              <X size={24} />
            </button>
            {lightbox.match(/\.mp4(\?|$)/i) ? (
              <video
                src={lightbox}
                controls
                autoPlay
                className="max-w-full max-h-full rounded-xl"
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <img
                src={lightbox}
                alt="preview"
                className="max-w-full max-h-full rounded-xl object-contain"
                onClick={e => e.stopPropagation()}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
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

      {/* Released confirmation with fee breakdown */}
      {escrow?.status === "released" && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-emerald-400/70 text-center">
            {ar ? "تم تحرير الأموال بنجاح. تبقى الأموال داخل المنصة." : "Funds released. Funds remain within the platform."}
          </p>
          {escrow.seller_receive_amount > 0 && (
            <div className="rounded-xl bg-emerald-500/6 border border-emerald-500/15 px-3 py-2 space-y-1">
              <div className="flex justify-between text-[10px] text-white/40">
                <span>{ar ? "المبلغ الإجمالي" : "Total Amount"}</span>
                <span>{escrow.amount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-[10px] text-amber-400/80">
                <span>{ar ? "عمولة المنصة (3%)" : "Platform Fee (3%)"}</span>
                <span>– {escrow.platform_fee.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-[10px] font-bold text-emerald-400 border-t border-white/8 pt-1">
                <span>{ar ? "يستلم البائع" : "Seller Receives"}</span>
                <span>{escrow.seller_receive_amount.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>
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

  // ── Receipt upload state (Part #17) ──────────────────────────────────────
  const receiptFileRef                                           = useRef<HTMLInputElement>(null);
  const [receiptFile,        setReceiptFile]                    = useState<File | null>(null);
  const [receiptOrderId,     setReceiptOrderId]                 = useState("");
  const [receiptUploading,   setReceiptUploading]               = useState(false);
  const [receiptUploadError, setReceiptUploadError]             = useState<string | null>(null);
  const [receiptUploadOk,    setReceiptUploadOk]                = useState(false);
  const [existingReceipt,    setExistingReceipt]                = useState<DealReceipt | null>(null);

  // ── External Payment Warning state (Part #13) ─────────────────────────────
  const [extReportExpanded,  setExtReportExpanded]  = useState(false);
  const [extReportReason,    setExtReportReason]    = useState("");
  const [extReporting,       setExtReporting]       = useState(false);
  const [extReportError,     setExtReportError]     = useState<string | null>(null);
  const [extReportSuccess,   setExtReportSuccess]   = useState(false);

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

  // ── Load existing receipt (buyer + seller, best-effort) ─────────────────
  const loadReceipt = useCallback(async () => {
    if (!dealId || !user) return;
    try {
      const found = await getDealReceipt(dealId);
      if (found) {
        setExistingReceipt(found);
        setReceiptOrderId(found.order_id ?? "");
      }
    } catch {
      // Non-fatal
    }
  }, [dealId, user]);

  useEffect(() => { loadReceipt(); }, [loadReceipt]);

  // ── Upload receipt ────────────────────────────────────────────────────────
  async function handleUploadReceipt() {
    if (!user || !tx || !receiptFile || receiptUploading) return;
    setReceiptUploading(true);
    setReceiptUploadError(null);
    setReceiptUploadOk(false);
    try {
      const saved = await uploadDealReceipt(tx.deal_id, receiptFile, receiptOrderId);
      setExistingReceipt(saved);
      setReceiptFile(null);
      if (receiptFileRef.current) receiptFileRef.current.value = "";
      setReceiptUploadOk(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setReceiptUploadError(ar ? `فشل الرفع: ${msg}` : `Upload failed: ${msg}`);
    } finally {
      setReceiptUploading(false);
    }
  }

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

  // ── Coming Soon gate — remove this block when the feature launches ──
  return (
    <MobileLayout>
      <div className="min-h-full bg-background flex flex-col" dir={ar ? "rtl" : "ltr"}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-14 pb-4">
          <button
            onClick={() => window.history.length > 1 ? window.history.back() : setLocation("/payment-protection")}
            className="w-10 h-10 rounded-xl bg-white/8 border border-white/10 flex items-center justify-center active:scale-90 transition-transform shrink-0"
            aria-label={ar ? "رجوع" : "Back"}
          >
            <ArrowLeft size={18} className={`text-white/70 ${ar ? "rotate-180" : ""}`} />
          </button>
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-emerald-400/70" />
            <h1 className="text-base font-bold text-white">
              {ar ? "الصفقات الآمنة" : "Secure Deals"}
            </h1>
          </div>
        </div>
        {/* Coming soon body */}
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-6 pb-16">
          <div className="w-24 h-24 rounded-3xl bg-emerald-500/8 border border-emerald-500/18 flex items-center justify-center">
            <ShieldCheck size={40} className="text-emerald-400/40" />
          </div>
          <div className="space-y-2.5">
            <p className="text-2xl font-bold text-white">
              {ar ? "قريباً" : "Coming Soon"}
            </p>
            <p className="text-sm text-white/45 leading-relaxed max-w-[260px] mx-auto">
              {ar
                ? "خدمة الدفع الآمن ستكون متاحة قريباً"
                : "Secure Deals will be available soon"}
            </p>
          </div>
          <button
            onClick={() => window.history.length > 1 ? window.history.back() : setLocation("/payment-protection")}
            className="mt-2 px-6 py-3 rounded-2xl bg-white/8 border border-white/10 text-sm font-semibold text-white/60 hover:text-white hover:bg-white/12 transition-colors active:scale-95"
          >
            {ar ? "رجوع" : "Go Back"}
          </button>
        </div>
      </div>
    </MobileLayout>
  );

}
