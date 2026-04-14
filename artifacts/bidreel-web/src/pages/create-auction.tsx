import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft, ArrowRight, Camera, Upload, CheckCircle2, Clock,
  Play, Image as ImageIcon, X, AlertCircle, Loader2, Trash2,
  MapPin, RefreshCw, DollarSign,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { useCreateAuction } from "@/hooks/use-auctions";
import { getUploadUrlApi, uploadFileToStorage } from "@/lib/api-client";
import { useLang } from "@/contexts/LanguageContext";
import { useCurrentUser } from "@/hooks/use-current-user";
import { cn } from "@/lib/utils";
import { reverseGeocodeCountry, getCurrencyForCountry, type CurrencyInfo } from "@/lib/geo";

type PostType = "video" | "photos";

// ─── File size limits (client-side enforcement) ───────────────────────────────
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB — pre-compression raw limit
const MAX_VIDEO_BYTES = 20 * 1024 * 1024; // 20 MB

// ─── Client-side image compression ───────────────────────────────────────────
// Uses the browser's Canvas API (zero dependencies) to:
//   • Resize to maxPx on the longest side (maintaining aspect ratio)
//   • Convert to WebP at the given quality (0.0–1.0)
// Returns a new File in image/webp format. Falls back to the original on error.
async function compressImage(
  file: File,
  opts: { maxPx: number; quality: number },
): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;
      // Scale down if either dimension exceeds maxPx — never upscale
      if (width > opts.maxPx || height > opts.maxPx) {
        const scale = opts.maxPx / Math.max(width, height);
        width  = Math.round(width  * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement("canvas");
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(file); return; } // canvas unavailable — use original

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; } // compression failed — use original
          const baseName = file.name.replace(/\.[^.]+$/, "");
          const compressed = new File([blob], `${baseName}.webp`, { type: "image/webp" });
          // Only use the compressed version if it's actually smaller
          resolve(compressed.size < file.size ? compressed : file);
        },
        "image/webp",
        opts.quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file); // fall back to original if load fails
    };

    img.src = objectUrl;
  });
}

// ─── Allowed categories ───────────────────────────────────────────────────────
const CATEGORIES = [
  { value: "other",           label: "Other" },
  { value: "electronics",     label: "Electronics" },
  { value: "fashion",         label: "Fashion" },
  { value: "collectibles",    label: "Collectibles" },
  { value: "jewelry",         label: "Jewelry" },
  { value: "art",             label: "Art" },
  { value: "sports",          label: "Sports" },
  { value: "home_and_garden", label: "Home & Garden" },
  { value: "vehicles",        label: "Vehicles" },
] as const;

type Category = (typeof CATEGORIES)[number]["value"];

// ─── Geolocation state ────────────────────────────────────────────────────────
type GeoStatus = "idle" | "requesting" | "granted" | "denied" | "unavailable";

interface GeoCoords {
  lat: number;
  lng: number;
}

// ─── Upload a single file: get presigned URL → PUT to storage ─────────────────
async function uploadFile(
  file: File,
  fileType: "video" | "image",
  onProgress?: (pct: number) => void,
): Promise<string> {
  const { uploadUrl, publicUrl } = await getUploadUrlApi(
    fileType,
    file.type,
    file.size,
  );
  await uploadFileToStorage(uploadUrl, file, onProgress);
  return publicUrl;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CreateAuction() {
  const [, setLocation] = useLocation();
  const { mutate: create, isPending: isCreating } = useCreateAuction();
  const { t, lang } = useLang();
  const { user, isLoading: userLoading } = useCurrentUser();

  const videoInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(1);
  const [postType, setPostType] = useState<PostType>("video");

  // ── Video state ─────────────────────────────────────────────────────────────
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoPreviewUrl]);

  // ── Photos state ────────────────────────────────────────────────────────────
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
  const [photoErrors, setPhotoErrors] = useState<string[]>([]);

  // ── Form state ──────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    title: "",
    description: "",
    startingBid: "",
    category: "other" as Category,
  });

  // ── Upload / submit state ────────────────────────────────────────────────────
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Geolocation + currency detection ─────────────────────────────────────────
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle");
  const [coords, setCoords] = useState<GeoCoords | null>(null);
  const [localCurrency, setLocalCurrency] = useState<CurrencyInfo | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState<"usd" | "local">("usd");

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoStatus("unavailable");
      return;
    }
    setGeoStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCoords({ lat, lng });
        setGeoStatus("granted");
        console.log("[create-auction] Location granted:", lat, lng);
        try {
          const cc = await reverseGeocodeCountry(lat, lng);
          const info = getCurrencyForCountry(cc);
          setLocalCurrency(info);
          console.log("[create-auction] Detected local currency:", info.code, cc);
        } catch {
          console.warn("[create-auction] Could not detect local currency");
        }
      },
      (err) => {
        console.warn("[create-auction] Location denied:", err.message);
        setGeoStatus("denied");
      },
      { timeout: 12000, maximumAge: 300_000 },
    );
  }, []);

  // Request location immediately when the page loads
  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  // ── Profile completeness gate ─────────────────────────────────────────────────
  // All hooks must be called BEFORE this conditional return (React rules).
  if (!userLoading && user && !user.isCompleted) {
    const missing: string[] = [];
    if (!user.username)    missing.push("Username (@handle)");
    if (!user.displayName) missing.push("Display name");
    if (!user.avatarUrl)   missing.push("Profile photo");
    if (!user.location)    missing.push("Location");
    // Phone is not returned by the API for privacy; if all above are present but
    // isCompleted is still false, the missing field must be the phone number.
    if (missing.length === 0) missing.push("WhatsApp phone number");

    return (
      <MobileLayout>
        <div className="flex flex-col items-center justify-center min-h-[70dvh] px-6 text-center">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-5">
            <AlertCircle size={28} className="text-amber-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">
            {lang === "ar" ? "الملف الشخصي غير مكتمل" : "Profile Incomplete"}
          </h2>
          <p className="text-sm text-white/50 mb-5 max-w-xs">
            {lang === "ar"
              ? "يجب اكتمال ملفك الشخصي قبل نشر مزاد."
              : "You need to complete your profile before creating an auction."
            }
          </p>
          <ul className="text-sm text-white/60 mb-7 space-y-1 text-left w-full max-w-xs">
            {missing.map(field => (
              <li key={field} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                {field}
              </li>
            ))}
          </ul>
          <button
            onClick={() => setLocation("/interests")}
            className="w-full max-w-xs bg-primary text-white font-semibold py-3.5 rounded-2xl"
          >
            {lang === "ar" ? "أكمل ملفك الشخصي" : "Complete Profile"}
          </button>
          <button
            onClick={() => setLocation("/feed")}
            className="mt-3 text-sm text-white/40 hover:text-white/60 transition-colors"
          >
            {lang === "ar" ? "رجوع" : "Go back"}
          </button>
        </div>
      </MobileLayout>
    );
  }

  const set = (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [key]: e.target.value }));

  // ── File selection handlers ──────────────────────────────────────────────────

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setVideoError(null);
    if (file.size > MAX_VIDEO_BYTES) {
      setVideoError(lang === "ar"
        ? `الفيديو كبير جداً: ${(file.size / 1024 / 1024).toFixed(1)} ميغابايت. الحد الأقصى 20 ميغابايت.`
        : `Video too large: ${(file.size / 1024 / 1024).toFixed(1)} MB. Maximum is 20 MB.`);
      e.target.value = "";
      return;
    }
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    const objectUrl = URL.createObjectURL(file);
    setVideoFile(file);
    setVideoPreviewUrl(objectUrl);
    console.log(`[create-auction] Video selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
    e.target.value = "";
  };

  const clearVideo = () => {
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoFile(null);
    setVideoPreviewUrl(null);
    setVideoError(null);
    if (videoInputRef.current) videoInputRef.current.value = "";
    console.log("[create-auction] Video cleared by user");
  };

  const handlePhotosSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const errors: string[] = [];
    const validFiles: File[] = [];
    const newUrls: string[] = [];

    for (const file of files) {
      if (photoFiles.length + validFiles.length >= 6) {
        errors.push(`Max 6 photos — skipped ${file.name}`);
        break;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        errors.push(`${file.name}: ${(file.size / 1024 / 1024).toFixed(1)} MB exceeds 20 MB limit`);
        continue;
      }
      validFiles.push(file);
      newUrls.push(URL.createObjectURL(file));
    }

    setPhotoErrors(errors);
    setPhotoFiles(prev => [...prev, ...validFiles]);
    setPhotoPreviewUrls(prev => [...prev, ...newUrls]);
    e.target.value = "";
  };

  const removePhoto = (i: number) => {
    URL.revokeObjectURL(photoPreviewUrls[i]);
    setPhotoFiles(prev => prev.filter((_, idx) => idx !== i));
    setPhotoPreviewUrls(prev => prev.filter((_, idx) => idx !== i));
    setPhotoErrors([]);
  };

  // ── Submit ───────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!form.title || !form.startingBid) return;
    if (!coords) {
      setSubmitError(lang === "ar"
        ? "يجب تفعيل الموقع قبل نشر المزاد."
        : "Location is required to publish an auction.");
      return;
    }
    setSubmitError(null);

    try {
      let videoUrl: string;
      let thumbnailUrl: string;

      if (postType === "video") {
        if (!videoFile) {
          setSubmitError(lang === "ar" ? "يرجى اختيار ملف فيديو." : "Please select a video file.");
          return;
        }
        setUploadProgress(lang === "ar" ? "جارٍ رفع الفيديو…" : "Uploading video (this may take a moment)…");
        videoUrl = await uploadFile(videoFile, "video", pct => {
          setUploadProgress(lang === "ar" ? `جارٍ رفع الفيديو… ${pct}%` : `Uploading video… ${pct}%`);
        });
        thumbnailUrl = videoUrl;
      } else {
        if (photoFiles.length === 0) {
          setSubmitError(lang === "ar" ? "يرجى إضافة صورة واحدة على الأقل." : "Please add at least one photo.");
          return;
        }

        const uploadedUrls: string[] = [];
        let coverThumbnailUrl = "";

        for (let i = 0; i < photoFiles.length; i++) {
          // ── Compress to WebP before uploading (client-side, zero deps) ───
          setUploadProgress(lang === "ar"
            ? `جارٍ ضغط الصورة ${i + 1} من ${photoFiles.length}…`
            : `Optimizing photo ${i + 1} of ${photoFiles.length}…`);

          // Display version: max 1920 px on the longest side, 85 % quality
          const displayFile = await compressImage(photoFiles[i], { maxPx: 1920, quality: 0.85 });

          setUploadProgress(lang === "ar"
            ? `جارٍ رفع الصورة ${i + 1} من ${photoFiles.length}…`
            : `Uploading photo ${i + 1} of ${photoFiles.length}…`);
          const url = await uploadFile(displayFile, "image");
          uploadedUrls.push(url);

          // Cover photo: also upload a 640 px thumbnail for fast feed loading
          if (i === 0) {
            const thumbFile = await compressImage(photoFiles[i], { maxPx: 640, quality: 0.80 });
            setUploadProgress(lang === "ar" ? "جارٍ رفع الصورة المصغرة…" : "Uploading cover thumbnail…");
            coverThumbnailUrl = await uploadFile(thumbFile, "image");
          }
        }
        videoUrl     = uploadedUrls[0];
        thumbnailUrl = coverThumbnailUrl || uploadedUrls[0];
      }

      setUploadProgress(lang === "ar" ? "جارٍ نشر المزاد…" : "Publishing your auction…");

      const effectiveCurrency =
        selectedCurrency === "local" && localCurrency
          ? localCurrency
          : { code: "USD", label: "US Dollar", labelAr: "الدولار الأمريكي" };

      const id = await create({
        title: form.title,
        description: form.description || undefined,
        category: form.category,
        startPrice: parseInt(form.startingBid, 10),
        videoUrl,
        thumbnailUrl,
        lat: coords.lat,
        lng: coords.lng,
        currencyCode: effectiveCurrency.code,
        currencyLabel: effectiveCurrency.label,
      });

      setUploadProgress(null);
      setLocation(`/auction/${id}`);
    } catch (err: unknown) {
      setUploadProgress(null);
      const msg = (err as Error).message ?? (lang === "ar" ? "حدث خطأ، يرجى المحاولة مرة أخرى." : "Something went wrong. Please try again.");
      setSubmitError(msg);
      console.error("[create-auction] ❌ Submit failed:", err);
    }
  };

  const isUploading = !!uploadProgress && !isCreating;
  const isSubmitting = isUploading || isCreating;

  const canProceedFromStep1 =
    postType === "video" ? !!videoFile : photoFiles.length > 0;

  const canPublish =
    !!form.title &&
    !!form.startingBid &&
    geoStatus === "granted" &&
    !isSubmitting;

  // ── Geo status badge colors ───────────────────────────────────────────────────
  const geoBadge = {
    granted:     { bg: "bg-emerald-500/15 border-emerald-500/30", dot: "bg-emerald-400", text: "text-emerald-300", label: t("location_active") },
    denied:      { bg: "bg-red-500/15 border-red-500/30",         dot: "bg-red-400",     text: "text-red-300",     label: t("location_inactive") },
    requesting:  { bg: "bg-yellow-500/15 border-yellow-500/30",   dot: "bg-yellow-400",  text: "text-yellow-300",  label: t("location_detecting") },
    unavailable: { bg: "bg-white/8 border-white/15",              dot: "bg-white/40",    text: "text-white/50",    label: t("location_unavailable") },
    idle:        { bg: "bg-yellow-500/15 border-yellow-500/30",   dot: "bg-yellow-400",  text: "text-yellow-300",  label: t("location_detecting") },
  }[geoStatus];

  return (
    <MobileLayout showNav={false}>
      <div className="min-h-full bg-background flex flex-col px-5">

        {/* Header */}
        <div className="flex items-center gap-3 pt-14 pb-6">
          <motion.button whileTap={{ scale: 0.9 }}
            onClick={() => step === 1 ? setLocation("/feed") : setStep(1)}
            className="w-10 h-10 rounded-full bg-white/8 border border-white/10 flex items-center justify-center text-white shrink-0">
            <ArrowLeft size={18} />
          </motion.button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white">{t("new_listing")}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {lang === "ar" ? `الخطوة ${step} من 2` : `Step ${step} of 2`} — {step === 1 ? t("step_1_label") : t("step_2_label")}
            </p>
          </div>
          <div className="flex gap-1.5">
            {[1, 2].map(s => (
              <div key={s} className={`h-1 rounded-full transition-all duration-300 ${s <= step ? "w-8 bg-primary" : "w-4 bg-white/15"}`} />
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait">

          {/* ── STEP 1: Media ── */}
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2 }}
              className="flex-1 flex flex-col pb-8">

              {/* Type toggle */}
              <div className="flex bg-white/5 border border-white/8 rounded-2xl p-1 mb-5">
                {(["video", "photos"] as PostType[]).map((pt) => (
                  <button key={pt} onClick={() => setPostType(pt)}
                    className="relative flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-colors">
                    {postType === pt && (
                      <motion.div layoutId="type-tab" className="absolute inset-0 bg-primary/20 border border-primary/30 rounded-xl" />
                    )}
                    {pt === "video"
                      ? <Play size={14} className={cn("relative z-10", postType === pt ? "text-primary" : "text-white/40")} />
                      : <ImageIcon size={14} className={cn("relative z-10", postType === pt ? "text-primary" : "text-white/40")} />
                    }
                    <span className={cn("relative z-10 capitalize", postType === pt ? "text-white" : "text-white/40")}>
                      {t(pt === "video" ? "video" : "photos")}
                    </span>
                  </button>
                ))}
              </div>

              {/* Hidden inputs */}
              <input ref={videoInputRef} type="file" accept="video/mp4,video/quicktime,video/webm"
                className="hidden" onChange={handleVideoSelect} />
              <input ref={photoInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp"
                multiple className="hidden" onChange={handlePhotosSelect} />

              {/* ── VIDEO MODE ── */}
              {postType === "video" ? (
                <>
                  <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                    {lang === "ar"
                      ? "اختر مقطع فيديو من جهازك. الحد الأقصى 20 ميغابايت — MP4 أو MOV أو WebM."
                      : "Select a video from your device. Max 20 MB — MP4, MOV, or WebM."}
                  </p>

                  {videoPreviewUrl ? (
                    /* Video preview with clear video controls */
                    <div className="flex-1 min-h-56 rounded-3xl overflow-hidden bg-black border border-emerald-500/30 relative">
                      <video
                        src={videoPreviewUrl}
                        controls
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-contain max-h-72"
                        onError={(e) => console.error("[create-auction] Preview error:", (e.target as HTMLVideoElement).error)}
                      />
                      {/* Action buttons overlay */}
                      <div className="absolute top-2 right-2 flex gap-1.5">
                        <button
                          onClick={() => videoInputRef.current?.click()}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-black/70 text-white text-xs font-semibold border border-white/20 hover:bg-black/90 transition-colors"
                        >
                          <RefreshCw size={11} /> {t("change_video")}
                        </button>
                        <button
                          onClick={clearVideo}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-red-500/80 text-white text-xs font-semibold border border-red-400/40 hover:bg-red-500 transition-colors"
                        >
                          <Trash2 size={11} /> {t("delete_video")}
                        </button>
                      </div>
                      <div className="absolute bottom-2 left-2 bg-black/70 rounded-lg px-2.5 py-1 flex items-center gap-1.5">
                        <CheckCircle2 size={12} className="text-emerald-400" />
                        <span className="text-xs text-emerald-300 font-medium truncate max-w-[180px]">{videoFile?.name}</span>
                      </div>
                    </div>
                  ) : (
                    /* Upload CTA */
                    <button
                      onClick={() => videoInputRef.current?.click()}
                      className="flex-1 min-h-56 border-2 border-dashed border-white/12 rounded-3xl bg-white/3 flex flex-col items-center justify-center p-8 text-center cursor-pointer transition-all active:scale-[0.98] hover:border-primary/50 hover:bg-primary/5"
                    >
                      <div className="w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center mb-4">
                        <Upload size={28} className="text-primary" />
                      </div>
                      <h3 className="font-bold text-white text-lg mb-1">{t("tap_to_select_video")}</h3>
                      <p className="text-xs text-muted-foreground">MP4, MOV, WebM — max 20 MB</p>
                    </button>
                  )}

                  {videoError && (
                    <div className="mt-3 flex items-center gap-2 text-red-400 text-xs font-medium">
                      <AlertCircle size={13} className="shrink-0" />
                      {videoError}
                    </div>
                  )}

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <button
                      onClick={() => videoInputRef.current?.click()}
                      className="py-4 rounded-2xl bg-white/6 border border-white/10 text-white font-semibold flex items-center justify-center gap-2 active:scale-[0.98]">
                      <Camera size={18} />{t("record_now")}
                    </button>
                    <motion.button whileTap={{ scale: 0.97 }}
                      onClick={() => canProceedFromStep1 && setStep(2)}
                      disabled={!canProceedFromStep1}
                      className="py-4 rounded-2xl bg-primary text-white font-bold flex items-center justify-center gap-2 shadow-md shadow-primary/30 disabled:opacity-40">
                      {t("continue")}<ArrowRight size={18} />
                    </motion.button>
                  </div>
                </>
              ) : (

                /* ── PHOTOS MODE ── */
                <>
                  <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                    {lang === "ar"
                      ? "أضف حتى 6 صور. الحد الأقصى 20 ميغابايت لكل صورة. الصورة الأولى هي الغلاف."
                      : "Add up to 6 photos. Max 20 MB each. The first photo is the cover shown in the feed."}
                  </p>

                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {photoPreviewUrls.map((src, i) => (
                      <div key={i} className="relative aspect-square rounded-xl overflow-hidden">
                        <img src={src} className="w-full h-full object-cover" alt={`Photo ${i + 1}`} />
                        {i === 0 && (
                          <div className="absolute top-1 left-1 bg-primary/90 rounded px-1.5 py-0.5 text-[9px] font-bold text-white">
                            {lang === "ar" ? "غلاف" : "COVER"}
                          </div>
                        )}
                        <button onClick={() => removePhoto(i)}
                          className="absolute top-1 right-1 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center">
                          <X size={10} className="text-white" />
                        </button>
                      </div>
                    ))}
                    {photoPreviewUrls.length < 6 && (
                      <button onClick={() => photoInputRef.current?.click()}
                        className="aspect-square rounded-xl border-2 border-dashed border-white/15 flex flex-col items-center justify-center gap-1 text-white/30 hover:border-primary/50 hover:text-primary/60 transition-all active:scale-[0.97]">
                        <ImageIcon size={20} />
                        <span className="text-[10px] font-medium">{t("add_photos")}</span>
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground text-center mb-3">
                    {lang === "ar" ? `${photoFiles.length}/6 صور` : `${photoFiles.length}/6 photos added`}
                  </p>

                  {photoErrors.map((err, i) => (
                    <div key={i} className="mb-1 flex items-start gap-2 text-red-400 text-xs font-medium">
                      <AlertCircle size={13} className="shrink-0 mt-0.5" />
                      {err}
                    </div>
                  ))}

                  <motion.button whileTap={{ scale: 0.97 }}
                    onClick={() => canProceedFromStep1 && setStep(2)}
                    disabled={!canProceedFromStep1}
                    className="w-full py-4 rounded-2xl bg-primary text-white font-bold flex items-center justify-center gap-2 shadow-md shadow-primary/30 disabled:opacity-40 mt-2">
                    {t("continue")}<ArrowRight size={18} />
                  </motion.button>
                </>
              )}
            </motion.div>
          )}

          {/* ── STEP 2: Details ── */}
          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2 }}
              className="flex-1 flex flex-col pb-8">

              <div className="space-y-4 flex-1">

                {/* Title */}
                <div>
                  <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-2">{t("item_title")} *</label>
                  <input type="text" value={form.title} onChange={set("title")}
                    placeholder={t("item_title_placeholder")}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder:text-white/25 focus:outline-none focus:border-primary/60 focus:bg-white/8 transition-all text-[15px]" />
                </div>

                {/* Starting bid + Currency */}
                <div>
                  <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-2">{t("starting_bid")} *</label>

                  {/* Currency selector — two options */}
                  <div className="flex gap-2 mb-2.5">
                    <button
                      type="button"
                      onClick={() => setSelectedCurrency("usd")}
                      className={cn(
                        "flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all flex items-center justify-center gap-1.5",
                        selectedCurrency === "usd"
                          ? "bg-primary/20 border-primary/50 text-primary"
                          : "bg-white/5 border-white/10 text-white/50",
                      )}
                    >
                      <DollarSign size={14} />
                      USD
                    </button>

                    <button
                      type="button"
                      onClick={() => setSelectedCurrency("local")}
                      className={cn(
                        "flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all",
                        selectedCurrency === "local"
                          ? "bg-primary/20 border-primary/50 text-primary"
                          : "bg-white/5 border-white/10 text-white/50",
                        !localCurrency && "opacity-50",
                      )}
                    >
                      {localCurrency
                        ? `${localCurrency.code} — ${lang === "ar" ? localCurrency.labelAr : localCurrency.label}`
                        : lang === "ar" ? "العملة المحلية" : "Local Currency"}
                    </button>
                  </div>

                  {/* Price input — prefix changes by currency */}
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 text-sm font-bold">
                      {selectedCurrency === "usd"
                        ? "$"
                        : (localCurrency?.code ?? "?")}
                    </span>
                    <input type="number" min="1" value={form.startingBid} onChange={set("startingBid")}
                      placeholder="0"
                      className="w-full bg-white/5 border border-white/10 rounded-xl pl-12 pr-4 py-3.5 text-white text-xl font-bold placeholder:text-white/25 focus:outline-none focus:border-primary/60 focus:bg-white/8 transition-all" />
                  </div>

                  {/* Currency hint */}
                  {selectedCurrency === "local" && !localCurrency && geoStatus !== "granted" && (
                    <p className="mt-1.5 text-[11px] text-yellow-400/80">
                      {lang === "ar"
                        ? "فعّل الموقع أولاً لاكتشاف عملتك المحلية."
                        : "Enable location first to detect your local currency."}
                    </p>
                  )}
                  {selectedCurrency === "local" && localCurrency && (
                    <p className="mt-1.5 text-[11px] text-emerald-400/80">
                      {lang === "ar"
                        ? `السعر سيُحفظ بـ ${localCurrency.labelAr} (${localCurrency.code}) — بدون أي تحويل.`
                        : `Price stored in ${localCurrency.label} (${localCurrency.code}) — no conversion.`}
                    </p>
                  )}
                </div>

                {/* Category */}
                <div>
                  <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-2">
                    {lang === "ar" ? "الفئة *" : "Category *"}
                  </label>
                  <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
                    {CATEGORIES.map(cat => (
                      <button
                        key={cat.value}
                        onClick={() => setForm(prev => ({ ...prev, category: cat.value }))}
                        className={cn(
                          "shrink-0 px-3 py-2 rounded-xl text-xs font-bold border transition-all",
                          form.category === cat.value
                            ? "bg-primary/20 border-primary/50 text-primary"
                            : "bg-white/5 border-white/10 text-white/50",
                        )}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-2">{t("description")}</label>
                  <textarea value={form.description} onChange={set("description")}
                    placeholder={t("description_placeholder")} rows={3}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-white placeholder:text-white/25 focus:outline-none focus:border-primary/60 focus:bg-white/8 transition-all resize-none text-[15px] leading-relaxed" />
                </div>

                {/* ── Location status ── */}
                <div className={cn("rounded-xl border p-4", geoBadge.bg)}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className={cn("w-2 h-2 rounded-full shrink-0", geoBadge.dot,
                        (geoStatus === "requesting" || geoStatus === "idle") && "animate-pulse")} />
                      <MapPin size={15} className={geoBadge.text} />
                      <span className={cn("text-sm font-semibold", geoBadge.text)}>{geoBadge.label}</span>
                    </div>
                    {(geoStatus === "denied" || geoStatus === "unavailable") && (
                      <button
                        onClick={requestLocation}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white text-xs font-semibold hover:bg-white/15 transition-colors shrink-0">
                        <RefreshCw size={12} /> {t("location_retry")}
                      </button>
                    )}
                    {geoStatus === "granted" && coords && (
                      <span className="text-[10px] text-white/30 font-mono shrink-0">
                        {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
                      </span>
                    )}
                  </div>

                  {/* Location why / blocked hint */}
                  {geoStatus === "denied" && (
                    <p className="mt-2 text-xs text-red-300/80 leading-relaxed">
                      {t("location_settings_hint")}
                    </p>
                  )}
                  {geoStatus === "unavailable" && (
                    <p className="mt-2 text-xs text-white/50 leading-relaxed">
                      {t("location_unavailable")}
                    </p>
                  )}
                  {(geoStatus === "idle" || geoStatus === "requesting") && (
                    <p className="mt-2 text-xs text-yellow-300/70 leading-relaxed">
                      {t("location_why")}
                    </p>
                  )}
                </div>

                {/* Duration info */}
                <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/8 border border-primary/18">
                  <Clock size={18} className="text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-primary mb-0.5">{t("auction_duration_title")}</p>
                    <p className="text-xs text-white/50 leading-relaxed">{t("auction_duration_body")}</p>
                  </div>
                </div>

                {/* Authenticity note */}
                <div className="flex items-start gap-3 p-4 rounded-xl bg-white/4 border border-white/8">
                  <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-white/50 leading-relaxed">{t("authenticity_note")}</p>
                </div>

                {/* Submit error */}
                {submitError && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/25">
                    <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-400 leading-relaxed">{submitError}</p>
                  </div>
                )}
              </div>

              {/* Publish button */}
              <motion.button whileTap={{ scale: 0.97 }} onClick={handleSubmit}
                disabled={!canPublish}
                className="mt-6 w-full py-4 rounded-2xl bg-primary text-white font-bold text-base shadow-lg shadow-primary/30 disabled:opacity-40 disabled:shadow-none flex items-center justify-center gap-2">
                {isSubmitting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    {uploadProgress ?? t("publishing")}
                  </>
                ) : geoStatus !== "granted" ? (
                  <>
                    <MapPin size={18} />
                    {t("location_inactive")}
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={18} />
                    {t("publish")}
                  </>
                )}
              </motion.button>

              {/* Location blocking notice below the button */}
              {geoStatus === "denied" && !isSubmitting && (
                <p className="mt-3 text-center text-xs text-red-400/80">
                  {lang === "ar"
                    ? "لا يمكن نشر المزاد بدون تفعيل الموقع."
                    : "Location permission is required to publish an auction."}
                </p>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </MobileLayout>
  );
}
