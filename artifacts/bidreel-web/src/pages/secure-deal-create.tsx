import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, ShieldCheck, Package, FileText, DollarSign,
  Truck, StickyNote, ImagePlus, Video, Link2, Copy, Check,
  ChevronDown, AlertCircle, Loader2, UserX, UserCheck, Upload,
} from "lucide-react";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { useLang } from "@/contexts/LanguageContext";
import { useCurrentUser } from "@/hooks/use-current-user";
import {
  generateDealId, buildPaymentLink, createTransaction, uploadProductMedia,
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

// ── Media validation ──────────────────────────────────────────────────────────

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4"]);
const ALLOWED_MEDIA_TYPES = new Set([...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES]);
const MAX_IMAGE_BYTES      = 10 * 1024 * 1024;  // 10 MB
const MAX_VIDEO_BYTES      = 50 * 1024 * 1024;  // 50 MB

function validateMediaFile(file: File): string | null {
  if (!ALLOWED_MEDIA_TYPES.has(file.type)) {
    return "Only JPEG, PNG, WebP images or MP4 videos are accepted.";
  }
  const isVideo = ALLOWED_VIDEO_TYPES.has(file.type);
  if (isVideo && file.size > MAX_VIDEO_BYTES) {
    return `Video must be smaller than ${MAX_VIDEO_BYTES / (1024 * 1024)} MB.`;
  }
  if (!isVideo && file.size > MAX_IMAGE_BYTES) {
    return `Image must be smaller than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`;
  }
  return null;
}

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
  const [mediaError, setMediaError]       = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Submit state
  const [errors, setErrors]               = useState<Record<string, string>>({});
  const [submitting, setSubmitting]       = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
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
    if (!user || !gate.ready || submitting || uploadingMedia) return;

    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    if (mediaError) return;

    setErrors({});
    setSubmitError(null);
    setSubmitting(true);

    try {
      let id   = generateDealId();
      const link = buildPaymentLink(id);

      // Attempt deal creation; auto-retry once on DUPLICATE_DEAL_ID
      let created = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await createTransaction({
            deal_id:         id,
            seller_id:       user.id,
            product_name:    itemName.trim(),
            price:           Number(price),
            currency,
            description:     description.trim() || undefined,
            delivery_method: delivery,
            media_urls:      [],
            terms:           terms.trim() || undefined,
          });
          created = true;
          break;
        } catch (err: any) {
          if (err?.code === "DUPLICATE_DEAL_ID" && attempt === 0) {
            // Generate a fresh ID and retry once
            id = generateDealId();
            continue;
          }
          // SELLER_PROFILE_INCOMPLETE — surface as profile gate
          if (err?.code === "SELLER_PROFILE_INCOMPLETE") {
            setSubmitError(
              ar
                ? "ملفك الشخصي غير مكتمل. يرجى إضافة اسم المستخدم والاسم الظاهر ورقم الهاتف."
                : "Your profile is incomplete. Please add your username, display name, and phone number.",
            );
            setSubmitting(false);
            return;
          }
          throw err;
        }
      }
      if (!created) {
        throw new Error(ar ? "فشل إنشاء الصفقة. حاول مجدداً." : "Could not create deal. Please try again.");
      }

      // Upload media file if one was chosen
      if (mediaFile) {
        setSubmitting(false);
        setUploadingMedia(true);
        try {
          await uploadProductMedia(id, mediaFile);
          console.log("[SecureDeal] Media uploaded for deal:", id);
        } catch (uploadErr) {
          const msg = uploadErr instanceof Error ? uploadErr.message : "Unknown upload error";
          console.warn("[SecureDeal] Media upload failed (non-fatal):", msg);
          // Non-fatal — deal is already created; buyer can still see it without the photo
        } finally {
          setUploadingMedia(false);
        }
      }

      console.log("[SecureDeal] Deal saved:", { id, link, sellerId: user.id });
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
      setUploadingMedia(false);
    }
  }

  function handleCopy() {
    if (!generatedLink) return;
    navigator.clipboard?.writeText(generatedLink).catch(() => {
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

    const validationError = validateMediaFile(file);
    if (validationError) {
      setMediaError(ar
        ? validationError
            .replace("Only JPEG, PNG, WebP images or MP4 videos are accepted.", "يُقبل فقط JPEG أو PNG أو WebP (صور) أو MP4 (فيديو).")
            .replace(/must be smaller than (\d+) MB\./, "يجب أن يكون الحجم أقل من $1 ميجابايت.")
        : validationError);
      // Don't clear the existing preview
      e.target.value = "";
      return;
    }

    setMediaError(null);
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    const url = URL.createObjectURL(file);
    setMediaFile(file);
    setMediaPreview(url);
    setMediaType(file.type.startsWith("video") ? "video" : "image");
  }

  // ── Derived submit label ──
  const submitLabel = (() => {
    if (uploadingMedia) return ar ? "جارٍ رفع الصورة..." : "Uploading media…";
    if (submitting)     return ar ? "جارٍ الحفظ..." : "Saving…";
    return ar ? "إنشاء رابط الدفع" : "Generate Payment Link";
  })();

  const isWorking = submitting || uploadingMedia;

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
