import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft, ArrowRight, Camera, Upload, CheckCircle2, Clock,
  Play, Image as ImageIcon, X, AlertCircle, Loader2, Trash2,
  MapPin, RefreshCw,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { useCreateAuction } from "@/hooks/use-auctions";
import { getUploadUrlApi, uploadFileToStorage } from "@/lib/api-client";
import { useLang } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

type PostType = "video" | "photos";

// ─── File size limits (client-side enforcement) ───────────────────────────────
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;   // 2 MB
const MAX_VIDEO_BYTES = 10 * 1024 * 1024;  // 10 MB

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

  // ── Geolocation state ────────────────────────────────────────────────────────
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("idle");
  const [coords, setCoords] = useState<GeoCoords | null>(null);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoStatus("unavailable");
      return;
    }
    setGeoStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoStatus("granted");
        console.log("[create-auction] Location granted:", pos.coords.latitude, pos.coords.longitude);
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
        ? `الفيديو كبير جداً: ${(file.size / 1024 / 1024).toFixed(1)} ميغابايت. الحد الأقصى 10 ميغابايت.`
        : `Video too large: ${(file.size / 1024 / 1024).toFixed(1)} MB. Maximum is 10 MB.`);
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
        errors.push(`${file.name}: ${(file.size / 1024 / 1024).toFixed(1)} MB exceeds 2 MB limit`);
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
        for (let i = 0; i < photoFiles.length; i++) {
          setUploadProgress(lang === "ar"
            ? `جارٍ رفع الصورة ${i + 1} من ${photoFiles.length}…`
            : `Uploading photo ${i + 1} of ${photoFiles.length}…`);
          const url = await uploadFile(photoFiles[i], "image");
          uploadedUrls.push(url);
        }
        videoUrl = uploadedUrls[0];
        thumbnailUrl = uploadedUrls[0];
      }

      setUploadProgress(lang === "ar" ? "جارٍ نشر المزاد…" : "Publishing your auction…");

      const id = await create({
        title: form.title,
        description: form.description || undefined,
        category: form.category,
        startPrice: parseInt(form.startingBid, 10),
        videoUrl,
        thumbnailUrl,
        lat: coords.lat,
        lng: coords.lng,
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
                      ? "اختر مقطع فيديو من جهازك. الحد الأقصى 10 ميغابايت — MP4 أو MOV أو WebM."
                      : "Select a video from your device. Max 10 MB — MP4, MOV, or WebM."}
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
                      <p className="text-xs text-muted-foreground">MP4, MOV, WebM — max 10 MB</p>
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
                      ? "أضف حتى 6 صور. الحد الأقصى 2 ميغابايت لكل صورة. الصورة الأولى هي الغلاف."
                      : "Add up to 6 photos. Max 2 MB each. The first photo is the cover shown in the feed."}
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

                {/* Starting bid */}
                <div>
                  <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-2">{t("starting_bid")} *</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 text-lg font-bold">$</span>
                    <input type="number" min="1" value={form.startingBid} onChange={set("startingBid")}
                      placeholder="0"
                      className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-3.5 text-white text-xl font-bold placeholder:text-white/25 focus:outline-none focus:border-primary/60 focus:bg-white/8 transition-all" />
                  </div>
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
