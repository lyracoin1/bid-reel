import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, ShieldCheck, Package, FileText, DollarSign,
  Truck, StickyNote, ImagePlus, Video, Link2, Copy, Check,
  ChevronDown, AlertCircle, Loader2, UserX, UserCheck,
} from "lucide-react";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { useLang } from "@/contexts/LanguageContext";
import { useCurrentUser } from "@/hooks/use-current-user";
import {
  generateDealId, buildPaymentLink, createTransaction,
} from "@/lib/transactions";

// ── Constants ─────────────────────────────────────────────────────────────────

const DELIVERY_OPTIONS_EN = [
  "In-person handover",
  "Shipping (seller arranges)",
  "Shipping (buyer arranges)",
  "Digital delivery",
  "Courier (agreed by both)",
  "Other",
];
const DELIVERY_OPTIONS_AR = [
  "تسليم شخصي",
  "شحن (البائع يرتب)",
  "شحن (المشتري يرتب)",
  "تسليم رقمي",
  "مندوب (باتفاق الطرفين)",
  "أخرى",
];

const INPUT_CLS =
  "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-primary/50 focus:bg-white/7 transition";

// ── Profile completeness check ────────────────────────────────────────────────

interface ProfileGate {
  ready: boolean;
  missingEn: string[];
  missingAr: string[];
}

function checkProfileComplete(user: { username: string | null; displayName: string | null; phone: string | null } | null): ProfileGate {
  if (!user) return { ready: false, missingEn: [], missingAr: [] };
  const missing: { en: string; ar: string }[] = [];
  if (!user.username)    missing.push({ en: "Username",     ar: "اسم المستخدم" });
  if (!user.displayName) missing.push({ en: "Display name", ar: "الاسم الظاهر"  });
  if (!user.phone)       missing.push({ en: "Phone number", ar: "رقم الهاتف"   });
  return {
    ready:     missing.length === 0,
    missingEn: missing.map(m => m.en),
    missingAr: missing.map(m => m.ar),
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Field({ label, required, children, hint, error }: {
  label: string; required?: boolean; children: React.ReactNode; hint?: string; error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1 text-[11px] font-bold text-white/40 uppercase tracking-widest">
        {label}
        {required && <span className="text-primary">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-[10px] text-white/25 leading-snug">{hint}</p>}
      {error && (
        <p className="flex items-center gap-1 text-[11px] text-red-400">
          <AlertCircle size={10} />
          {error}
        </p>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SecureDealCreatePage() {
  const [, setLocation] = useLocation();
  const { lang } = useLang();
  const ar = lang === "ar";

  const { user, isLoading: authLoading } = useCurrentUser();
  const gate = checkProfileComplete(user);

  // Form state
  const [itemName, setItemName]           = useState("");
  const [description, setDescription]     = useState("");
  const [price, setPrice]                 = useState("");
  const [currency, setCurrency]           = useState("USD");
  const [delivery, setDelivery]           = useState("");
  const [deliveryOpen, setDeliveryOpen]   = useState(false);
  const [terms, setTerms]                 = useState("");
  const [mediaFile, setMediaFile]         = useState<File | null>(null);
  const [mediaPreview, setMediaPreview]   = useState<string | null>(null);
  const [mediaType, setMediaType]         = useState<"image" | "video" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Submit state
  const [errors, setErrors]               = useState<Record<string, string>>({});
  const [submitting, setSubmitting]       = useState(false);
  const [submitError, setSubmitError]     = useState<string | null>(null);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [dealId, setDealId]               = useState<string | null>(null);
  const [copied, setCopied]               = useState(false);

  const deliveryOptions   = ar ? DELIVERY_OPTIONS_AR : DELIVERY_OPTIONS_EN;
  const deliveryOptionsEn = DELIVERY_OPTIONS_EN;

  function validate() {
    const e: Record<string, string> = {};
    if (!itemName.trim())
      e.itemName = ar ? "اسم المنتج مطلوب" : "Item name is required";
    if (!price.trim() || isNaN(Number(price)) || Number(price) <= 0)
      e.price = ar ? "أدخل سعراً صحيحاً" : "Enter a valid price";
    if (!delivery)
      e.delivery = ar ? "اختر طريقة التسليم" : "Select a delivery method";
    return e;
  }

  async function handleGenerate() {
    if (!user || !gate.ready || submitting) return;

    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({});
    setSubmitError(null);
    setSubmitting(true);

    try {
      const id   = generateDealId();
      const link = buildPaymentLink(id);

      await createTransaction({
        deal_id:         id,
        seller_id:       user.id,
        product_name:    itemName.trim(),
        price:           Number(price),
        currency,
        description:     description.trim() || undefined,
        delivery_method: delivery,
        media_urls:      [],           // media upload (R2) wired in next milestone
        terms:           terms.trim() || undefined,
      });

      console.log("[SecureDeal] Deal saved to Supabase:", { id, link, sellerId: user.id });
      setDealId(id);
      setGeneratedLink(link);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[SecureDeal] Failed to save deal:", msg);
      setSubmitError(ar
        ? `فشل حفظ الصفقة: ${msg}`
        : `Failed to save deal: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  function handleCopy() {
    if (!generatedLink) return;
    navigator.clipboard?.writeText(generatedLink).catch(() => {
      // Fallback for browsers without clipboard API
      const el = document.createElement("textarea");
      el.value = generatedLink;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    });
    setCopied(true);
    console.log("[SecureDeal] Copied link:", generatedLink);
    setTimeout(() => setCopied(false), 2500);
  }

  function handleMediaPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    const url = URL.createObjectURL(file);
    setMediaFile(file);
    setMediaPreview(url);
    setMediaType(file.type.startsWith("video") ? "video" : "image");
  }

  // ── Auth loading state ──
  if (authLoading) {
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
        <div className="min-h-full bg-background flex flex-col items-center justify-center gap-4 px-6 text-center" dir={ar ? "rtl" : "ltr"}>
          <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <UserX size={24} className="text-red-400" />
          </div>
          <div>
            <p className="text-base font-bold text-white">
              {ar ? "يجب تسجيل الدخول أولاً" : "Sign in required"}
            </p>
            <p className="text-sm text-white/40 mt-1">
              {ar ? "إنشاء الصفقات الآمنة متاح للمستخدمين المسجّلين فقط." : "Secure Deals are only available to registered users."}
            </p>
          </div>
          <button
            onClick={() => setLocation("/login")}
            className="mt-2 px-6 py-3 rounded-2xl bg-primary text-white font-bold text-sm hover:brightness-110 transition"
          >
            {ar ? "تسجيل الدخول" : "Sign In"}
          </button>
        </div>
      </MobileLayout>
    );
  }

  // ── Profile incomplete ──
  if (!gate.ready) {
    const missing = ar ? gate.missingAr : gate.missingEn;
    return (
      <MobileLayout>
        <div className="min-h-full bg-background flex flex-col items-center justify-center gap-4 px-6 text-center" dir={ar ? "rtl" : "ltr"}>
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <UserCheck size={24} className="text-amber-400" />
          </div>
          <div>
            <p className="text-base font-bold text-white">
              {ar ? "الملف الشخصي غير مكتمل" : "Complete your profile first"}
            </p>
            <p className="text-sm text-white/40 mt-1 leading-relaxed">
              {ar
                ? "يجب إكمال ملفك الشخصي قبل إنشاء صفقات آمنة."
                : "You need a complete profile to create Secure Deals."}
            </p>
            <div className="mt-3 space-y-1.5">
              {missing.map(field => (
                <div key={field} className="flex items-center justify-center gap-2 text-sm text-amber-400">
                  <AlertCircle size={13} />
                  <span>{ar ? `مطلوب: ${field}` : `Required: ${field}`}</span>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={() => setLocation("/profile")}
            className="mt-2 px-6 py-3 rounded-2xl bg-amber-500/80 text-white font-bold text-sm hover:brightness-110 transition"
          >
            {ar ? "إكمال الملف الشخصي" : "Complete Profile"}
          </button>
        </div>
      </MobileLayout>
    );
  }

  // ── Main form ──
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
              {ar ? "إنشاء صفقة آمنة" : "Create Secure Deal"}
            </h1>
          </div>
          {/* Seller badge */}
          <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-1 shrink-0">
            <UserCheck size={11} className="text-emerald-400" />
            <span className="text-[10px] font-bold text-emerald-400 truncate max-w-[80px]">
              {user.displayName ?? user.username ?? "Seller"}
            </span>
          </div>
        </div>

        <div className="px-4 py-5 max-w-lg mx-auto space-y-5 pb-14">

          {/* Hero band */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="rounded-2xl bg-gradient-to-r from-emerald-600/20 to-teal-600/10 border border-emerald-500/20 px-4 py-3.5 flex items-start gap-3"
          >
            <ShieldCheck size={18} className="text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-emerald-300">
                {ar ? "حماية كاملة للمشتري والبائع" : "Full buyer & seller protection"}
              </p>
              <p className="text-xs text-white/45 mt-0.5 leading-snug">
                {ar
                  ? "أنشئ رابط دفع آمن وأرسله للمشتري. الأموال محمية حتى اكتمال الصفقة."
                  : "Generate a secure payment link and send it to your buyer. Funds are held safely until the deal is complete."}
              </p>
            </div>
          </motion.div>

          {/* Form card */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.06 }}
            className="rounded-3xl bg-white/4 border border-white/8 overflow-hidden"
          >
            <div className="bg-gradient-to-r from-white/5 to-transparent px-5 pt-5 pb-4 border-b border-white/6">
              <p className="text-xs font-bold text-white/50 uppercase tracking-widest">
                {ar ? "تفاصيل الصفقة" : "Deal Details"}
              </p>
            </div>

            <div className="px-5 py-5 space-y-5">

              {/* Item name */}
              <Field label={ar ? "اسم المنتج / السلعة" : "Product / Item Name"} required error={errors.itemName}>
                <div className="relative">
                  <Package size={14} className={`absolute top-1/2 -translate-y-1/2 text-white/25 pointer-events-none ${ar ? "right-4" : "left-4"}`} />
                  <input
                    type="text"
                    value={itemName}
                    onChange={e => { setItemName(e.target.value); setErrors(prev => ({ ...prev, itemName: "" })); }}
                    placeholder={ar ? "مثال: ساعة رولكس أصلية" : "e.g. Authentic Rolex Watch"}
                    className={`${INPUT_CLS} ${ar ? "pr-10" : "pl-10"} ${errors.itemName ? "border-red-500/40" : ""}`}
                  />
                </div>
              </Field>

              {/* Description */}
              <Field
                label={ar ? "الوصف" : "Description"}
                hint={ar ? "صف المنتج بشكل واضح — الحالة، المواصفات، أي عيوب" : "Describe the item clearly — condition, specs, any defects"}
              >
                <div className="relative">
                  <FileText size={14} className={`absolute top-3.5 text-white/25 pointer-events-none ${ar ? "right-4" : "left-4"}`} />
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder={ar ? "وصف تفصيلي للمنتج..." : "Detailed description of the item..."}
                    rows={3}
                    className={`${INPUT_CLS} ${ar ? "pr-10" : "pl-10"} resize-none`}
                  />
                </div>
              </Field>

              {/* Price + currency */}
              <Field
                label={ar ? "السعر" : "Price"}
                required
                error={errors.price}
                hint={ar ? "حدد السعر بالعملة التي تفضلها" : "Set the price in your preferred currency"}
              >
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <DollarSign size={14} className={`absolute top-1/2 -translate-y-1/2 text-white/25 pointer-events-none ${ar ? "right-4" : "left-4"}`} />
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={price}
                      onChange={e => { setPrice(e.target.value); setErrors(prev => ({ ...prev, price: "" })); }}
                      placeholder="0.00"
                      className={`${INPUT_CLS} ${ar ? "pr-10" : "pl-10"} ${errors.price ? "border-red-500/40" : ""}`}
                    />
                  </div>
                  <select
                    value={currency}
                    onChange={e => setCurrency(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-sm text-white focus:outline-none focus:border-primary/50 transition appearance-none cursor-pointer min-w-[80px] text-center"
                  >
                    {["USD", "SAR", "AED", "EUR", "GBP", "TRY", "RUB"].map(c => (
                      <option key={c} value={c} className="bg-[#0c0c14]">{c}</option>
                    ))}
                  </select>
                </div>
              </Field>

              {/* Media upload */}
              <Field
                label={ar ? "صورة أو فيديو (اختياري)" : "Photo or Video (optional)"}
                hint={ar ? "أضف مرئياً يساعد المشتري على الثقة بالمنتج" : "Add a visual to help the buyer trust the item"}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={handleMediaPick}
                />
                {mediaPreview ? (
                  <div className="relative rounded-xl overflow-hidden border border-white/10">
                    {mediaType === "video"
                      ? <video src={mediaPreview} className="w-full max-h-48 object-cover" controls />
                      : <img src={mediaPreview} alt="Preview" className="w-full max-h-48 object-cover" />
                    }
                    <button
                      type="button"
                      onClick={() => { setMediaFile(null); setMediaPreview(null); setMediaType(null); }}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white/70 flex items-center justify-center text-xs font-bold hover:bg-black/80 transition"
                    >✕</button>
                  </div>
                ) : (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-6 rounded-xl border border-dashed border-white/15 text-white/30 flex flex-col items-center gap-2 hover:border-white/25 hover:text-white/50 transition"
                  >
                    <div className="flex gap-3">
                      <ImagePlus size={18} />
                      <Video size={18} />
                    </div>
                    <span className="text-xs font-medium">
                      {ar ? "اضغط لإضافة صورة أو فيديو" : "Tap to add photo or video"}
                    </span>
                  </motion.button>
                )}
              </Field>

              {/* Delivery method */}
              <Field label={ar ? "طريقة التسليم" : "Delivery Method"} required error={errors.delivery}>
                <div className="relative">
                  <Truck size={14} className={`absolute top-1/2 -translate-y-1/2 text-white/25 pointer-events-none ${ar ? "right-4" : "left-4"}`} />
                  <button
                    type="button"
                    onClick={() => setDeliveryOpen(v => !v)}
                    className={`${INPUT_CLS} ${ar ? "pr-10 text-right" : "pl-10 text-left"} flex items-center justify-between ${errors.delivery ? "border-red-500/40" : ""} ${!delivery ? "text-white/20" : "text-white"}`}
                  >
                    <span className="flex-1 truncate">
                      {delivery || (ar ? "اختر طريقة التسليم..." : "Select delivery method...")}
                    </span>
                    <ChevronDown size={14} className={`shrink-0 text-white/30 transition-transform ${deliveryOpen ? "rotate-180" : ""} ${ar ? "mr-2" : "ml-2"}`} />
                  </button>
                  <AnimatePresence>
                    {deliveryOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute left-0 right-0 top-full mt-1.5 z-30 rounded-xl bg-[#16161f] border border-white/10 overflow-hidden shadow-xl"
                      >
                        {deliveryOptions.map((opt, i) => (
                          <button
                            key={deliveryOptionsEn[i]}
                            type="button"
                            onClick={() => {
                              setDelivery(opt);
                              setDeliveryOpen(false);
                              setErrors(prev => ({ ...prev, delivery: "" }));
                            }}
                            className={`w-full px-4 py-3 text-sm hover:bg-white/5 transition ${ar ? "text-right" : "text-left"} ${delivery === opt ? "text-emerald-400 font-semibold" : "text-white/70"}`}
                          >
                            {opt}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </Field>

              {/* Terms */}
              <Field
                label={ar ? "شروط إضافية / ملاحظات" : "Additional Terms / Notes"}
                hint={ar ? "أي شروط خاصة بهذه الصفقة (اختياري)" : "Any special conditions for this deal (optional)"}
              >
                <div className="relative">
                  <StickyNote size={14} className={`absolute top-3.5 text-white/25 pointer-events-none ${ar ? "right-4" : "left-4"}`} />
                  <textarea
                    value={terms}
                    onChange={e => setTerms(e.target.value)}
                    placeholder={ar ? "مثال: السلعة بدون ضمان، التسليم خلال ٣ أيام..." : "e.g. Item has no warranty, delivery within 3 days..."}
                    rows={3}
                    className={`${INPUT_CLS} ${ar ? "pr-10" : "pl-10"} resize-none`}
                  />
                </div>
              </Field>

            </div>
          </motion.div>

          {/* Submit error */}
          <AnimatePresence>
            {submitError && (
              <motion.div
                key="submit-err"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 flex items-start gap-2.5"
              >
                <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
                <p className="text-sm text-red-300 leading-snug">{submitError}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Generate button */}
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.12 }}
            whileTap={{ scale: submitting ? 1 : 0.97 }}
            type="button"
            onClick={handleGenerate}
            disabled={submitting || !!generatedLink}
            className="w-full py-4 rounded-2xl bg-emerald-600 text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-700/30 hover:brightness-110 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 size={17} className="animate-spin" />
                {ar ? "جارٍ الحفظ..." : "Saving..."}
              </>
            ) : (
              <>
                <Link2 size={17} />
                {ar ? "إنشاء رابط الدفع" : "Generate Payment Link"}
              </>
            )}
          </motion.button>

          {/* Generated link result */}
          <AnimatePresence>
            {generatedLink && (
              <motion.div
                key="link-result"
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.28 }}
                className="rounded-3xl bg-emerald-900/20 border border-emerald-500/25 overflow-hidden"
              >
                <div className="px-5 pt-4 pb-3 border-b border-emerald-500/15">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={14} className="text-emerald-400" />
                    <p className="text-xs font-bold text-emerald-300 uppercase tracking-widest">
                      {ar ? "رابط الدفع جاهز" : "Payment Link Ready"}
                    </p>
                  </div>
                  <p className="text-[10px] text-white/35 mt-1">
                    {ar ? `رقم الصفقة: ${dealId}` : `Deal ID: ${dealId}`}
                  </p>
                  <p className="text-[10px] text-emerald-400/60 mt-0.5">
                    {ar ? "✓ تم حفظ الصفقة في قاعدة البيانات" : "✓ Deal saved to database"}
                  </p>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <div className="flex items-center gap-2 bg-black/30 rounded-xl px-3 py-2.5 border border-white/8">
                    <Link2 size={12} className="text-white/30 shrink-0" />
                    <span className="text-xs text-white/60 flex-1 truncate font-mono">{generatedLink}</span>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    type="button"
                    onClick={handleCopy}
                    className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition ${
                      copied
                        ? "bg-emerald-600/30 text-emerald-300 border border-emerald-500/30"
                        : "bg-emerald-600 text-white shadow-md shadow-emerald-700/25 hover:brightness-110"
                    }`}
                  >
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                    {copied
                      ? (ar ? "تم النسخ!" : "Copied!")
                      : (ar ? "نسخ الرابط" : "Copy Link")}
                  </motion.button>
                  <p className="text-[10px] text-white/25 text-center leading-relaxed">
                    {ar
                      ? "أرسل هذا الرابط للمشتري. ستُحتجز الأموال بأمان حتى تأكيد الاستلام."
                      : "Send this link to your buyer. Funds will be held securely until delivery is confirmed."}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </div>
    </MobileLayout>
  );
}
