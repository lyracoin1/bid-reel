import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft, ArrowRight, Camera, Upload, CheckCircle2, Clock,
  Play, Image as ImageIcon, X, AlertCircle, Loader2, Trash2,
  MapPin, RefreshCw, DollarSign, ShieldAlert, Music, Mic,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { useCreateAuction } from "@/hooks/use-auctions";
import { useLang } from "@/contexts/LanguageContext";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useOverlayBack } from "@/hooks/use-overlay-back";
import { cn } from "@/lib/utils";
import { reverseGeocodeCountry, getCurrencyForCountry, type CurrencyInfo } from "@/lib/geo";
import {
  uploadMedia,
  compressListingImage,
  compressListingThumbnail,
  PresignedUploadError,
} from "@/lib/media-upload";
import {
  pickVideoNative,
  compressVideoNative,
  readCompressedFile,
  isVideoCompressionSupported,
  getUnsupportedPlatformMessage,
  MAX_RAW_VIDEO_INPUT_BYTES,
  NativeVideoError,
  type PickVideoResult,
} from "@/lib/native-video-compressor";

type PostType = "video" | "photos" | "audio";

// ─── First-listing rules gate ─────────────────────────────────────────────────
// localStorage key — set to "1" when the user accepts the rules and publishes
// their first auction. Once set the modal never shows again.
const LISTING_RULES_KEY = "bidreel_listing_rules_accepted";

const LISTING_RULES = [
  { icon: "🤝", titleKey: "rule_1_title", bodyKey: "rule_1_body" },
  { icon: "👥", titleKey: "rule_2_title", bodyKey: "rule_2_body" },
  { icon: "🔍", titleKey: "rule_3_title", bodyKey: "rule_3_body" },
  { icon: "⚠️", titleKey: "rule_4_title", bodyKey: "rule_4_body" },
  { icon: "🚫", titleKey: "rule_5_title", bodyKey: "rule_5_body" },
] as const;

// ─── File size limits (client-side enforcement) ───────────────────────────────
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;  // 20 MB — pre-compression raw limit
const MAX_AUDIO_BYTES_CLIENT = 30 * 1024 * 1024; // 30 MB — matches server cap
// Videos are compressed natively (Android Media3 Transformer) before upload,
// so we accept large raw inputs (up to MAX_RAW_VIDEO_INPUT_BYTES) and let the
// compressor shrink them to the 30 MB server cap. There is NO raw-video
// fallback: if compression fails, the upload fails.
const MAX_VIDEO_INPUT_BYTES = MAX_RAW_VIDEO_INPUT_BYTES;

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

// Translate any caught error into a human-readable message that points at the
// exact step that broke. Returned string is rendered directly in the red
// submitError box — no more generic "Something went wrong".
function describeSubmitError(
  err: unknown,
  step: "pick_video" | "compress" | "upload_video" | "upload_image" | "upload_audio" | "create_db",
  lang: string, // accepts the full Language union; only "ar" is special-cased.
): string {
  // Preserve full details in console for remote debugging via the user.
  console.error(`[create-auction] step=${step} failed:`, err);

  const isAr = lang === "ar";
  const stepLabel = isAr
    ? { pick_video: "اختيار الفيديو", compress: "ضغط الفيديو", upload_video: "رفع الفيديو", upload_image: "رفع الصورة", upload_audio: "رفع الملف الصوتي", create_db: "نشر المزاد" }[step]
    : { pick_video: "Video selection", compress: "Video compression", upload_video: "Video upload", upload_image: "Image upload", upload_audio: "Audio upload", create_db: "Publishing auction" }[step];

  // ── create_db: map backend error codes → localized messages ─────────────────
  // Never concatenate a raw English backend message with an Arabic step label.
  if (step === "create_db") {
    const code = (err as { code?: string }).code;
    if (code === "SELLER_PROFILE_INCOMPLETE" || code === "PHONE_REQUIRED") {
      return isAr
        ? "أكمل بيانات ملفك الشخصي أولاً لتتمكن من نشر مزاد."
        : "Complete your profile first to create an auction.";
    }
    // All other create_db errors: generic localized message — never raw English in Arabic UI.
    return isAr
      ? "تعذر نشر المزاد. حاول مرة أخرى."
      : "Could not create auction. Please try again.";
  }

  // Friendly message for native compression failures — does NOT fall back to
  // raw-video upload (product rule).
  if (err instanceof NativeVideoError) {
    if (err.step === "compress" || err.step === "validate") {
      return isAr
        ? `${stepLabel}: تعذّر ضغط الفيديو. حاول مقطعاً أقصر ثم أعد المحاولة. (${err.message})`
        : `${stepLabel}: Could not compress this video. Try a shorter clip and try again. (${err.message})`;
    }
    if (err.step === "unsupported") {
      return getUnsupportedPlatformMessage(lang);
    }
    return `${stepLabel}: ${err.message}`;
  }

  if (err instanceof PresignedUploadError) {
    const statusPart = err.httpStatus ? ` [HTTP ${err.httpStatus}]` : "";
    const bodyPart = err.responseBody ? ` — ${err.responseBody.slice(0, 140)}` : "";
    return `${stepLabel} → ${err.step}${statusPart}: ${err.message}${bodyPart}`;
  }

  const raw = err instanceof Error
    ? (err.message || err.name || "Error")
    : typeof err === "string" ? err : JSON.stringify(err);

  return `${stepLabel}: ${raw}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

// ─── Audio recording helpers ──────────────────────────────────────────────────

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ];
  return types.find(t => MediaRecorder.isTypeSupported(t)) ?? "";
}

function formatRecordingDuration(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function CreateAuction() {
  const [, setLocation] = useLocation();
  const { mutate: create, isPending: isCreating } = useCreateAuction();
  const { t, lang } = useLang();
  const { user, isLoading: userLoading } = useCurrentUser();

  const photoInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(1);
  const [postType, setPostType] = useState<PostType>("video");

  // ── Video state (native pre-upload compression flow) ────────────────────────
  // pickedVideo holds the result of the native picker — both the cache file
  // path (for the compressor) and a WebView-fetchable URL (for preview).
  // There is no longer a JS File here; the bytes only enter the JS heap once,
  // briefly, after compression, just before being handed to uploadMedia().
  const [pickedVideo, setPickedVideo] = useState<PickVideoResult | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const videoSupported = isVideoCompressionSupported();

  // ── Photos state ────────────────────────────────────────────────────────────
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
  const [photoErrors, setPhotoErrors] = useState<string[]>([]);

  // ── Audio state ──────────────────────────────────────────────────────────────
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // ── Recording state ──────────────────────────────────────────────────────────
  const [audioSource, setAudioSource] = useState<"upload" | "record">("upload");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [micPermission, setMicPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordedBlobUrlRef = useRef<string | null>(null);

  // ── Form state ──────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    title: "",
    description: "",
    startingBid: "",
    fixedPrice: "",
    category: "other" as Category,
  });

  // ── Sale type — auction (default) or fixed-price Buy Now ──────────────────
  // Toggling this swaps the price input below: auctions ask for a starting
  // bid (bidding ladder), fixed-price asks for a single flat price routed
  // through POST /:id/buy on the server. Both use the same POST /auctions
  // creation endpoint, distinguished by `saleType` in the payload.
  const [saleType, setSaleType] = useState<"auction" | "fixed">("auction");

  // ── Duration — 1 to 48 hours ────────────────────────────────────────────────
  // Users pick any whole number of hours from 1 to 48. Sent to the server as
  // `durationHours` and used to compute the auction's ends_at.
  const [durationHours, setDurationHours] = useState<number>(24);

  // ── Upload / submit state ────────────────────────────────────────────────────
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── First-listing rules gate ─────────────────────────────────────────────────
  const [showRulesModal, setShowRulesModal] = useState(false);

  // Android hardware back closes the rules modal first.
  useOverlayBack(showRulesModal, () => setShowRulesModal(false));

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

  // ── Mic permission via getUserMedia — always the source of truth ─────────────
  // navigator.permissions.query() returns stale/wrong state on Android WebView
  // (Capacitor) even when the OS has granted mic access.  getUserMedia is the
  // only reliable check on that platform, so it is always used to verify.
  const recheckMicPermission = useCallback(() => {
    if (!navigator.mediaDevices) return;
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((stream) => {
        stream.getTracks().forEach(t => t.stop());
        setMicPermission("granted");
        setMicError(null);
      })
      .catch((err) => {
        // Only show the denied banner when the OS truly refused access.
        // Other errors (NotFoundError, device busy) leave permission state
        // unchanged so we don't falsely block the user.
        const isActualDenial = err instanceof DOMException &&
          (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");
        if (isActualDenial) setMicPermission("denied");
      });
  }, []);

  // ── Proactive microphone permission check on mount ───────────────────────────
  useEffect(() => {
    let permStatus: PermissionStatus | null = null;

    // Always verify via getUserMedia — never trust the Permissions API alone.
    // This fires the native prompt on first visit (when state is "prompt") and
    // correctly reports "granted" on Android even when the Permissions API
    // returns a stale "denied".
    recheckMicPermission();

    if (navigator.permissions) {
      navigator.permissions
        .query({ name: "microphone" as PermissionName })
        .then((status) => {
          permStatus = status;
          // Re-verify via getUserMedia whenever the OS-level permission changes.
          status.onchange = () => recheckMicPermission();
        })
        .catch(() => {}); // Permissions API unsupported — getUserMedia already ran above
    }

    return () => { if (permStatus) permStatus.onchange = null; };
  }, [recheckMicPermission]);

  // ── Recording cleanup on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (recordedBlobUrlRef.current) URL.revokeObjectURL(recordedBlobUrlRef.current);
    };
  }, []);

  // ── Profile completeness gate ─────────────────────────────────────────────────
  // All hooks must be called BEFORE this conditional return (React rules).
  if (!userLoading && user && !user.isCompleted) {
    const missing: string[] = [];
    if (!user.username)    missing.push("Username (@handle)");
    if (!user.displayName) missing.push("Display name");
    if (!user.avatarUrl)   missing.push("Profile photo");
    if (!user.location)    missing.push("Location");
    if (!user.phone)       missing.push("WhatsApp phone number");

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

  const handlePickVideo = async () => {
    setVideoError(null);
    if (!videoSupported) {
      setVideoError(getUnsupportedPlatformMessage(lang));
      return;
    }
    try {
      const picked = await pickVideoNative();
      const maxMb = MAX_VIDEO_INPUT_BYTES / 1024 / 1024;
      if (picked.sizeBytes > MAX_VIDEO_INPUT_BYTES) {
        setVideoError(lang === "ar"
          ? `الفيديو كبير جداً: ${(picked.sizeBytes / 1024 / 1024).toFixed(1)} ميغابايت. الحد الأقصى ${maxMb} ميغابايت.`
          : `Video too large: ${(picked.sizeBytes / 1024 / 1024).toFixed(1)} MB. Maximum is ${maxMb} MB.`);
        return;
      }
      setPickedVideo(picked);
      console.log(
        `[create-auction] Video picked natively: ${picked.inputPath} ` +
        `(${(picked.sizeBytes / 1024 / 1024).toFixed(1)} MB, ${picked.width}x${picked.height}, ` +
        `${(picked.durationMs / 1000).toFixed(1)}s)`,
      );
    } catch (err) {
      // Silently ignore explicit user-cancel; surface real errors.
      if (err instanceof NativeVideoError && err.message === "USER_CANCELLED") {
        console.log("[create-auction] Video pick cancelled by user");
        return;
      }
      console.error("[create-auction] pickVideoNative failed:", err);
      setVideoError(describeSubmitError(err, "pick_video", lang));
    }
  };

  const clearVideo = () => {
    setPickedVideo(null);
    setVideoError(null);
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
        errors.push(`${file.name}: ${(file.size / 1024 / 1024).toFixed(1)} MB exceeds 30 MB limit`);
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

  // ── Audio handlers ───────────────────────────────────────────────────────────

  const handleAudioSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_AUDIO_BYTES_CLIENT) {
      setAudioError(lang === "ar"
        ? `${file.name}: ${(file.size / 1024 / 1024).toFixed(1)} ميغابايت تتجاوز الحد (30 ميغابايت)`
        : `${file.name}: ${(file.size / 1024 / 1024).toFixed(1)} MB exceeds the 30 MB limit`);
      return;
    }
    setAudioError(null);
    setAudioFile(file);
  };

  const clearAudio = () => {
    setAudioFile(null);
    setAudioError(null);
    // Stop any active stream / timer and discard recorded blob
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (recordedBlobUrlRef.current) { URL.revokeObjectURL(recordedBlobUrlRef.current); recordedBlobUrlRef.current = null; }
    setIsRecording(false);
    setRecordingDuration(0);
    setRecordedBlob(null);
    setRecordedBlobUrl(null);
    setMicError(null);
  };

  // ── Recording handlers ────────────────────────────────────────────────────────

  const startRecording = async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      setMicPermission("granted");
      streamRef.current = stream;
      recordingChunksRef.current = [];
      const mimeType = getSupportedMimeType();
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordingChunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const finalMime = mr.mimeType || mimeType || "audio/webm";
        const blob = new Blob(recordingChunksRef.current, { type: finalMime });
        const url = URL.createObjectURL(blob);
        if (recordedBlobUrlRef.current) URL.revokeObjectURL(recordedBlobUrlRef.current);
        recordedBlobUrlRef.current = url;
        setRecordedBlob(blob);
        setRecordedBlobUrl(url);
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      };

      mr.start(250);
      mediaRecorderRef.current = mr;
      setIsRecording(true);
      setRecordingDuration(0);
      setRecordedBlob(null);
      if (recordedBlobUrlRef.current) {
        URL.revokeObjectURL(recordedBlobUrlRef.current);
        recordedBlobUrlRef.current = null;
        setRecordedBlobUrl(null);
      }
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (err) {
      // Classify the error precisely so the user gets an actionable message.
      // NotAllowedError / PermissionDeniedError → OS or WebView denied the grant.
      // NotFoundError → microphone hardware not found or track is busy (not a permission issue).
      // Anything else → generic device error.
      const errName = err instanceof DOMException ? err.name : "";
      const isPermissionDenied = errName === "NotAllowedError" || errName === "PermissionDeniedError";
      const isNotFound        = errName === "NotFoundError";

      console.warn("[BidReel] getUserMedia failed:", errName, err);

      if (isPermissionDenied) {
        setMicError(lang === "ar"
          ? "لم يُسمح بالوصول إلى الميكروفون. تحقق من إذن التطبيق في الإعدادات."
          : "Microphone access denied. Check app permissions in device settings.");
      } else if (isNotFound) {
        setMicError(lang === "ar"
          ? "لم يتم العثور على الميكروفون أو أنه مشغول. أعد المحاولة."
          : "Microphone not found or is in use by another app. Please try again.");
      } else {
        setMicError(lang === "ar"
          ? "تعذّر الوصول إلى الميكروفون."
          : "Could not access the microphone.");
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    setIsRecording(false);
  };

  const discardRecording = () => {
    if (recordedBlobUrlRef.current) { URL.revokeObjectURL(recordedBlobUrlRef.current); recordedBlobUrlRef.current = null; }
    setRecordedBlob(null);
    setRecordedBlobUrl(null);
    setRecordingDuration(0);
    setIsRecording(false);
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
  };

  const useRecording = () => {
    if (!recordedBlob) return;
    const mime = recordedBlob.type || "audio/webm";
    const ext = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm";
    const file = new File([recordedBlob], `voice_${Date.now()}.${ext}`, { type: mime });
    if (file.size > MAX_AUDIO_BYTES_CLIENT) {
      setAudioError(lang === "ar"
        ? `التسجيل (${(file.size / 1024 / 1024).toFixed(1)} ميغابايت) يتجاوز الحد (30 ميغابايت).`
        : `Recording (${(file.size / 1024 / 1024).toFixed(1)} MB) exceeds the 30 MB limit.`);
      discardRecording();
      return;
    }
    if (recordedBlobUrlRef.current) { URL.revokeObjectURL(recordedBlobUrlRef.current); recordedBlobUrlRef.current = null; }
    setRecordedBlob(null);
    setRecordedBlobUrl(null);
    setRecordingDuration(0);
    setAudioFile(file);
    setAudioError(null);
  };

  const handleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) return;
    if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    setCoverFile(file);
    setCoverPreviewUrl(URL.createObjectURL(file));
  };

  const clearCover = () => {
    if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    setCoverFile(null);
    setCoverPreviewUrl(null);
  };

  // ── Submit ───────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!form.title) return;
    if (saleType === "auction" && !form.startingBid) return;
    if (saleType === "fixed" && !form.fixedPrice) return;

    const duration = Number(durationHours);
    if (!Number.isFinite(duration) || duration < 1 || duration > 48) {
      setSubmitError(lang === "ar"
        ? "يجب أن تكون مدة المزاد بين 1 و 48 ساعة."
        : "Auction duration must be between 1 and 48 hours.");
      return;
    }
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
      let allImageUrls: string[] | undefined;

      if (postType === "video") {
        if (!videoSupported) {
          setSubmitError(getUnsupportedPlatformMessage(lang));
          return;
        }
        if (!pickedVideo) {
          setSubmitError(lang === "ar" ? "يرجى اختيار ملف فيديو." : "Please select a video file.");
          return;
        }

        // ── 1. Native pre-upload compression (Android Media3 Transformer).
        //      STRICT: if compression fails, the upload fails. There is no
        //      raw-video fallback (product rule).
        setUploadProgress(lang === "ar"
          ? "جارٍ ضغط الفيديو… 0%"
          : "Optimizing video… 0%");
        let compressed: Awaited<ReturnType<typeof compressVideoNative>>;
        try {
          compressed = await compressVideoNative(pickedVideo.inputPath, {
            maxHeight: 720,
            videoBitrateBps: 2_000_000,
            onProgress: (pct) => {
              setUploadProgress(lang === "ar"
                ? `جارٍ ضغط الفيديو… ${pct}%`
                : `Optimizing video… ${pct}%`);
            },
          });
        } catch (err) {
          setUploadProgress(null);
          setSubmitError(describeSubmitError(err, "compress", lang));
          return;
        }

        const origMb = (pickedVideo.sizeBytes  / 1024 / 1024).toFixed(1);
        const outMb  = (compressed.sizeBytes   / 1024 / 1024).toFixed(1);
        console.log(
          `[create-auction] ✅ Native compressed: ${origMb} MB → ${outMb} MB ` +
          `in ${(compressed.durationMs / 1000).toFixed(1)}s`,
        );

        // ── 2. Read the compressed file back into a JS Blob and upload it ─
        const uploadLabel = lang === "ar" ? "جارٍ رفع الفيديو…" : "Uploading video…";
        setUploadProgress(uploadLabel);
        try {
          const compressedFile = await readCompressedFile(
            compressed.outputPath,
            `bidreel_${Date.now()}.mp4`,
            "video/mp4",
          );
          videoUrl = await uploadMedia(compressedFile, "video", pct => {
            setUploadProgress(`${uploadLabel} ${pct}%`);
          });
        } catch (err) {
          setUploadProgress(null);
          setSubmitError(describeSubmitError(err, "upload_video", lang));
          return;
        }

        // ── 3. Upload the extracted poster frame as the auction thumbnail ─
        //      Falls back to the video URL if extraction failed at pick time.
        if (pickedVideo.thumbnailPath) {
          try {
            const thumbFile = await readCompressedFile(
              pickedVideo.thumbnailPath,
              `bidreel_thumb_${Date.now()}.jpg`,
              "image/jpeg",
            );
            const compressedThumb = await compressListingThumbnail(thumbFile);
            thumbnailUrl = await uploadMedia(compressedThumb, "image");
          } catch (err) {
            console.warn("[create-auction] Thumbnail upload failed; falling back to video URL:", err);
            thumbnailUrl = videoUrl;
          }
        } else {
          thumbnailUrl = videoUrl;
        }
      } else if (postType === "audio") {
        if (!audioFile) {
          setSubmitError(lang === "ar" ? "يرجى اختيار ملف صوتي." : "Please select an audio file.");
          return;
        }

        // ── 1. Upload audio file ─────────────────────────────────────────────
        const audioLabel = lang === "ar" ? "جارٍ رفع الملف الصوتي…" : "Uploading audio…";
        setUploadProgress(audioLabel);
        try {
          videoUrl = await uploadMedia(audioFile, "audio", pct => {
            setUploadProgress(`${audioLabel} ${pct}%`);
          });
        } catch (err) {
          setUploadProgress(null);
          setSubmitError(describeSubmitError(err, "upload_audio", lang));
          return;
        }

        // ── 2. Upload cover image, or signal "no cover" to the backend ───────
        // When thumbnailUrl === videoUrl, the backend uses the BidReel logo fallback.
        if (coverFile) {
          setUploadProgress(lang === "ar" ? "جارٍ رفع صورة الغلاف…" : "Uploading cover image…");
          try {
            const compressedCover = await compressListingThumbnail(coverFile);
            thumbnailUrl = await uploadMedia(compressedCover, "image");
          } catch (err) {
            setUploadProgress(null);
            setSubmitError(describeSubmitError(err, "upload_image", lang));
            return;
          }
        } else {
          thumbnailUrl = videoUrl; // backend detects equality → uses logo fallback
        }
      } else {
        if (photoFiles.length === 0) {
          setSubmitError(lang === "ar" ? "يرجى إضافة صورة واحدة على الأقل." : "Please add at least one photo.");
          return;
        }

        const uploadedUrls: string[] = [];
        let coverThumbnailUrl = "";

        try {
          for (let i = 0; i < photoFiles.length; i++) {
            setUploadProgress(lang === "ar"
              ? `جارٍ ضغط الصورة ${i + 1} من ${photoFiles.length}…`
              : `Optimizing photo ${i + 1} of ${photoFiles.length}…`);
            const displayFile = await compressListingImage(photoFiles[i]);

            setUploadProgress(lang === "ar"
              ? `جارٍ رفع الصورة ${i + 1} من ${photoFiles.length}…`
              : `Uploading photo ${i + 1} of ${photoFiles.length}…`);
            const url = await uploadMedia(displayFile, "image");
            uploadedUrls.push(url);

            if (i === 0) {
              const thumbFile = await compressListingThumbnail(photoFiles[i]);
              setUploadProgress(lang === "ar" ? "جارٍ رفع الصورة المصغرة…" : "Uploading cover thumbnail…");
              coverThumbnailUrl = await uploadMedia(thumbFile, "image");
            }
          }
        } catch (err) {
          setUploadProgress(null);
          setSubmitError(describeSubmitError(err, "upload_image", lang));
          return;
        }
        videoUrl     = uploadedUrls[0];
        thumbnailUrl = coverThumbnailUrl || uploadedUrls[0];
        allImageUrls = uploadedUrls;
      }

      setUploadProgress(lang === "ar" ? "جارٍ نشر المزاد…" : "Publishing your auction…");

      const effectiveCurrency =
        selectedCurrency === "local" && localCurrency
          ? localCurrency
          : { code: "USD", label: "US Dollar", labelAr: "الدولار الأمريكي" };

      try {
        const id = await create({
          title: form.title,
          description: form.description || undefined,
          category: form.category,
          saleType,
          ...(saleType === "auction"
            ? { startPrice: parseInt(form.startingBid, 10) }
            : { fixedPrice: parseInt(form.fixedPrice, 10) }),
          videoUrl,
          thumbnailUrl,
          ...(allImageUrls && allImageUrls.length > 0 ? { imageUrls: allImageUrls } : {}),
          lat: coords.lat,
          lng: coords.lng,
          currencyCode: effectiveCurrency.code,
          currencyLabel: effectiveCurrency.label,
          durationHours: duration,
        });
        setUploadProgress(null);
        // REPLACE — publish is terminal; back from the new auction detail
        // must return to /feed, NOT to a half-cleared create form.
        setLocation(`/auction/${id}`, { replace: true });
      } catch (err) {
        setUploadProgress(null);
        setSubmitError(describeSubmitError(err, "create_db", lang));
        return;
      }
    } catch (err: unknown) {
      // Defensive: anything that escaped the per-step try/catch above.
      setUploadProgress(null);
      setSubmitError(describeSubmitError(err, "create_db", lang));
    }
  };

  // ── First-listing gate: intercept Publish click ────────────────────────────
  // If the user has never accepted the rules, show the modal.
  // If they have (flag set), go straight to handleSubmit.
  const handlePublish = () => {
    if (localStorage.getItem(LISTING_RULES_KEY)) {
      handleSubmit();
      return;
    }
    setShowRulesModal(true);
  };

  // Called when the user taps "Got it — publish now" inside the modal.
  const acceptRulesAndPublish = () => {
    localStorage.setItem(LISTING_RULES_KEY, "1");
    setShowRulesModal(false);
    handleSubmit();
  };

  const isUploading = !!uploadProgress && !isCreating;
  const isSubmitting = isUploading || isCreating;

  const canProceedFromStep1 =
    postType === "video" ? !!pickedVideo :
    postType === "audio" ? !!audioFile :
    photoFiles.length > 0;

  const canPublish =
    !!form.title &&
    (saleType === "auction" ? !!form.startingBid : !!form.fixedPrice) &&
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
    <>
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
                {(["video", "photos", "audio"] as PostType[]).map((pt) => (
                  <button key={pt} onClick={() => setPostType(pt)}
                    className="relative flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-colors">
                    {postType === pt && (
                      <motion.div layoutId="type-tab" className="absolute inset-0 bg-primary/20 border border-primary/30 rounded-xl" />
                    )}
                    {pt === "video"
                      ? <Play size={14} className={cn("relative z-10", postType === pt ? "text-primary" : "text-white/40")} />
                      : pt === "photos"
                      ? <ImageIcon size={14} className={cn("relative z-10", postType === pt ? "text-primary" : "text-white/40")} />
                      : <Music size={14} className={cn("relative z-10", postType === pt ? "text-primary" : "text-white/40")} />
                    }
                    <span className={cn("relative z-10 capitalize", postType === pt ? "text-white" : "text-white/40")}>
                      {pt === "video" ? t("video") : pt === "photos" ? t("photos") : (lang === "ar" ? "صوت" : "Audio")}
                    </span>
                  </button>
                ))}
              </div>

              {/* Hidden inputs — photos & audio use file pickers; video uses the native picker */}
              <input ref={photoInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp"
                multiple className="hidden" onChange={handlePhotosSelect} />
              <input ref={audioInputRef} type="file"
                accept="audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/webm,audio/x-m4a,.mp3,.m4a,.aac,.ogg"
                className="hidden" onChange={handleAudioSelect} />
              <input ref={coverInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp"
                className="hidden" onChange={handleCoverSelect} />

              {/* ── VIDEO MODE ── */}
              {postType === "video" ? (
                <>
                  <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                    {lang === "ar"
                      ? "اختر مقطع فيديو من جهازك. يتم ضغطه تلقائياً قبل الرفع — الحد الأقصى 100 ميغابايت خام (MP4 / MOV / WebM)."
                      : "Select a video from your device. We auto-compress before upload — up to 100 MB raw (MP4, MOV, or WebM)."}
                  </p>

                  {pickedVideo ? (
                    /* Video preview with clear video controls */
                    <div className="flex-1 min-h-56 rounded-3xl overflow-hidden bg-black border border-emerald-500/30 relative">
                      <video
                        src={pickedVideo.inputWebPath}
                        controls
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-contain max-h-72"
                        onError={(e) => console.error("[create-auction] Preview error:", (e.target as HTMLVideoElement).error)}
                      />
                      {/* Action buttons overlay */}
                      <div className="absolute top-2 right-2 flex gap-1.5">
                        <button
                          onClick={handlePickVideo}
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
                        <span className="text-xs text-emerald-300 font-medium truncate max-w-[180px]">
                          {(pickedVideo.sizeBytes / 1024 / 1024).toFixed(1)} MB · {pickedVideo.width}×{pickedVideo.height}
                        </span>
                      </div>
                    </div>
                  ) : (
                    /* Upload CTA */
                    <button
                      onClick={handlePickVideo}
                      disabled={!videoSupported}
                      className="flex-1 min-h-56 border-2 border-dashed border-white/12 rounded-3xl bg-white/3 flex flex-col items-center justify-center p-8 text-center cursor-pointer transition-all active:scale-[0.98] hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <div className="w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center mb-4">
                        <Upload size={28} className="text-primary" />
                      </div>
                      <h3 className="font-bold text-white text-lg mb-1">{t("tap_to_select_video")}</h3>
                      <p className="text-xs text-muted-foreground">
                        {videoSupported
                          ? "MP4, MOV, WebM — up to 200 MB (compressed natively before upload)"
                          : getUnsupportedPlatformMessage(lang)}
                      </p>
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
                      onClick={handlePickVideo}
                      disabled={!videoSupported}
                      className="py-4 rounded-2xl bg-white/6 border border-white/10 text-white font-semibold flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed">
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
              ) : postType === "audio" ? (

                /* ── AUDIO MODE ── */
                <>
                  {/* ── Source selector: Upload | Record ─────────────────────── */}
                  <div className="flex bg-white/5 border border-white/8 rounded-2xl p-1 mb-5">
                    {(["upload", "record"] as const).map((src) => (
                      <button
                        key={src}
                        onClick={() => {
                          if (src !== "record" && isRecording) stopRecording();
                          setAudioSource(src);
                          // Always re-verify via getUserMedia when switching to
                          // Record tab — clears false-denied state on Android
                          // WebView after the user grants access in OS settings.
                          if (src === "record") recheckMicPermission();
                        }}
                        className="relative flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-colors"
                      >
                        {audioSource === src && (
                          <motion.div layoutId="audio-src-tab" className="absolute inset-0 bg-primary/20 border border-primary/30 rounded-xl" />
                        )}
                        {src === "upload"
                          ? <Upload size={13} className={cn("relative z-10", audioSource === src ? "text-primary" : "text-white/40")} />
                          : <Mic size={13} className={cn("relative z-10", audioSource === src ? "text-primary" : "text-white/40")} />
                        }
                        <span className={cn("relative z-10", audioSource === src ? "text-white" : "text-white/40")}>
                          {src === "upload" ? (lang === "ar" ? "رفع ملف" : "Upload") : (lang === "ar" ? "تسجيل" : "Record")}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* ── Audio file card — shared for both upload and recording result ── */}
                  {audioFile ? (
                    <div className="rounded-2xl bg-white/5 border border-emerald-500/30 p-4 flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                        {audioSource === "record" ? <Mic size={20} className="text-primary" /> : <Music size={20} className="text-primary" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{audioFile.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />
                          <p className="text-xs text-emerald-400">{(audioFile.size / 1024 / 1024).toFixed(1)} MB</p>
                        </div>
                      </div>
                      <button onClick={clearAudio} className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center active:scale-95">
                        <X size={14} className="text-red-400" />
                      </button>
                    </div>
                  ) : audioSource === "upload" ? (

                    /* ── Upload: file picker ─────────────────────────────────── */
                    <button
                      onClick={() => audioInputRef.current?.click()}
                      className="w-full min-h-40 border-2 border-dashed border-white/12 rounded-3xl bg-white/3 flex flex-col items-center justify-center p-8 text-center cursor-pointer transition-all active:scale-[0.98] hover:border-primary/50 hover:bg-primary/5 mb-4"
                    >
                      <div className="w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center mb-4">
                        <Music size={28} className="text-primary" />
                      </div>
                      <h3 className="font-bold text-white text-lg mb-1">
                        {lang === "ar" ? "اضغط لاختيار ملف صوتي" : "Tap to select audio file"}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {lang === "ar" ? "MP3، AAC، M4A، OGG — حتى 30 ميغابايت" : "MP3, AAC, M4A, OGG — up to 30 MB"}
                      </p>
                    </button>

                  ) : (

                    /* ── Record: animated logo + timer + record button ────────── */
                    <div className="flex flex-col items-center mb-4">

                      {/* Animated cover / BidReel logo */}
                      <div style={{ perspective: "600px" }} className="mb-2">
                        <motion.div
                          animate={isRecording
                            ? {
                                rotateY: [0, 360],
                                boxShadow: [
                                  "0 0 0px 0px rgba(139,92,246,0.5)",
                                  "0 0 28px 10px rgba(139,92,246,0.3)",
                                  "0 0 0px 0px rgba(139,92,246,0.5)",
                                ],
                              }
                            : { rotateY: 0, boxShadow: "0 0 0px 0px rgba(139,92,246,0)" }}
                          transition={isRecording
                            ? {
                                rotateY: { duration: 4, repeat: Infinity, ease: "linear" },
                                boxShadow: { duration: 2, repeat: Infinity, ease: "easeInOut" },
                              }
                            : { duration: 0.4, ease: "easeOut" }}
                          className="w-24 h-24 rounded-full overflow-hidden border-2 border-primary/40"
                          style={{ transformStyle: "preserve-3d" }}
                        >
                          {coverFile
                            ? <img src={coverPreviewUrl!} alt="Cover" className="w-full h-full object-cover" />
                            : <img src="/images/logo-icon.png" alt="BidReel" className="w-full h-full object-cover bg-[#0e0e1a]" />
                          }
                        </motion.div>
                      </div>

                      {/* Timer */}
                      <div className={cn(
                        "font-mono text-3xl font-bold tabular-nums mb-5 transition-colors",
                        isRecording ? "text-red-400" : recordedBlob ? "text-white" : "text-white/25",
                      )}>
                        {formatRecordingDuration(recordingDuration)}
                      </div>

                      {/* Preview player + Use / Discard — shown after recording finishes */}
                      {recordedBlob && !isRecording ? (
                        <div className="w-full flex flex-col gap-3 mb-2">
                          <audio
                            ref={previewAudioRef}
                            src={recordedBlobUrl!}
                            controls
                            className="w-full rounded-xl"
                            style={{ colorScheme: "dark" }}
                          />
                          <div className="flex gap-3">
                            <button
                              onClick={discardRecording}
                              className="flex-1 py-3 rounded-2xl bg-white/6 border border-white/10 text-white/60 font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.97]"
                            >
                              <RefreshCw size={14} />
                              {lang === "ar" ? "إعادة التسجيل" : "Record Again"}
                            </button>
                            <motion.button whileTap={{ scale: 0.97 }}
                              onClick={useRecording}
                              className="flex-1 py-3 rounded-2xl bg-primary text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md shadow-primary/30"
                            >
                              <CheckCircle2 size={14} />
                              {lang === "ar" ? "استخدام التسجيل" : "Use Recording"}
                            </motion.button>
                          </div>
                        </div>
                      ) : (
                        /* Big record button */
                        <motion.button
                          whileTap={{ scale: 0.92 }}
                          onClick={isRecording ? stopRecording : startRecording}
                          className={cn(
                            "w-20 h-20 rounded-full flex items-center justify-center border-4 shadow-xl transition-colors",
                            isRecording
                              ? "bg-red-500 border-red-300/30 shadow-red-500/40"
                              : "bg-primary border-primary/30 shadow-primary/30",
                          )}
                        >
                          {isRecording
                            ? <div className="w-7 h-7 rounded-md bg-white" />
                            : <Mic size={28} className="text-white" />
                          }
                        </motion.button>
                      )}

                      {/* Hint text */}
                      {isRecording && (
                        <p className="mt-3 text-xs text-red-400/80 font-medium">
                          {lang === "ar" ? "جارٍ التسجيل — اضغط للإيقاف" : "Recording — tap to stop"}
                        </p>
                      )}
                      {!isRecording && !recordedBlob && (
                        <p className="mt-3 text-xs text-white/30">
                          {lang === "ar" ? "اضغط للبدء" : "Tap to start recording"}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Errors */}
                  {(audioError || micError) && (
                    <div className="mb-3 flex items-center gap-2 text-red-400 text-xs font-medium">
                      <AlertCircle size={13} className="shrink-0" />
                      {audioError ?? micError}
                    </div>
                  )}

                  {/* Optional cover image */}
                  <div className="mb-5">
                    <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-2">
                      {lang === "ar" ? "صورة الغلاف (اختياري)" : "Cover Image (optional)"}
                    </label>
                    {!coverFile ? (
                      <button
                        onClick={() => coverInputRef.current?.click()}
                        className="w-full py-3.5 border border-dashed border-white/12 rounded-2xl bg-white/3 flex items-center justify-center gap-2 text-white/40 hover:border-primary/40 hover:text-primary/60 transition-all active:scale-[0.98]"
                      >
                        <ImageIcon size={16} />
                        <span className="text-sm font-medium">
                          {lang === "ar" ? "اختر صورة — الافتراضي: شعار BidReel" : "Pick image — default: BidReel logo"}
                        </span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-3 rounded-2xl bg-white/5 border border-white/10 p-3">
                        <div className="w-14 h-14 rounded-xl overflow-hidden border border-white/15 shrink-0">
                          <img src={coverPreviewUrl!} alt="Cover" className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{coverFile.name}</p>
                          <p className="text-xs text-white/40 mt-0.5">{(coverFile.size / 1024 / 1024).toFixed(1)} MB</p>
                        </div>
                        <button onClick={clearCover} className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center active:scale-95">
                          <X size={14} className="text-red-400" />
                        </button>
                      </div>
                    )}
                  </div>

                  <motion.button whileTap={{ scale: 0.97 }}
                    onClick={() => canProceedFromStep1 && setStep(2)}
                    disabled={!canProceedFromStep1}
                    className="w-full py-4 rounded-2xl bg-primary text-white font-bold flex items-center justify-center gap-2 shadow-md shadow-primary/30 disabled:opacity-40">
                    {t("continue")}<ArrowRight size={18} />
                  </motion.button>
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

                {/* Sale type — Auction vs Buy Now (fixed price) */}
                <div>
                  <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-2">
                    {t("sale_type_label")} *
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSaleType("auction")}
                      className={cn(
                        "flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all",
                        saleType === "auction"
                          ? "bg-primary/20 border-primary/50 text-primary"
                          : "bg-white/5 border-white/10 text-white/50",
                      )}
                    >
                      {t("sale_type_auction")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSaleType("fixed")}
                      className={cn(
                        "flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all",
                        saleType === "fixed"
                          ? "bg-primary/20 border-primary/50 text-primary"
                          : "bg-white/5 border-white/10 text-white/50",
                      )}
                    >
                      {t("sale_type_fixed")}
                    </button>
                  </div>
                </div>

                {/* Starting bid / Fixed price + Currency */}
                <div>
                  <label className="block text-xs font-bold text-white/50 uppercase tracking-widest mb-2">
                    {saleType === "fixed" ? t("fixed_price_label") : t("starting_bid")} *
                  </label>

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
                    <input
                      type="number"
                      min="1"
                      value={saleType === "fixed" ? form.fixedPrice : form.startingBid}
                      onChange={saleType === "fixed" ? set("fixedPrice") : set("startingBid")}
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

                {/* Duration selector — 1 to 48 hours */}
                <div className="p-4 rounded-xl bg-primary/8 border border-primary/18">
                  <div className="flex items-start gap-3 mb-3">
                    <Clock size={18} className="text-primary shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-primary mb-0.5">
                        {lang === "ar" ? "مدة المزاد" : "Auction duration"}
                      </p>
                      <p className="text-xs text-white/50 leading-relaxed">
                        {lang === "ar"
                          ? "اختر مدة بين ساعة واحدة و48 ساعة"
                          : "Choose a duration between 1 and 48 hours"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-baseline justify-between mb-2" dir="ltr">
                    <span className="text-xs text-white/50 uppercase tracking-wider">
                      {lang === "ar" ? "المدة المختارة" : "Selected"}
                    </span>
                    <span className="text-2xl font-bold text-white tabular-nums">
                      {durationHours}{" "}
                      <span className="text-sm font-medium text-white/60">
                        {lang === "ar"
                          ? (durationHours === 1 ? "ساعة" : durationHours === 2 ? "ساعتان" : "ساعة")
                          : (durationHours === 1 ? "hour" : "hours")}
                      </span>
                    </span>
                  </div>

                  <input
                    type="range"
                    min={1}
                    max={48}
                    step={1}
                    value={durationHours}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) {
                        setDurationHours(Math.min(48, Math.max(1, Math.round(v))));
                      }
                    }}
                    className="w-full accent-primary"
                    dir="ltr"
                  />

                  <div className="flex justify-between text-[10px] text-white/40 mt-1" dir="ltr">
                    <span>1h</span>
                    <span>12h</span>
                    <span>24h</span>
                    <span>36h</span>
                    <span>48h</span>
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
              <motion.button whileTap={{ scale: 0.97 }} onClick={handlePublish}
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

    {/* ── First-listing rules gate modal ── */}
    <AnimatePresence>
      {showRulesModal && (
        <>
          {/* Backdrop */}
          <motion.div
            key="lr-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setShowRulesModal(false)}
            className="fixed inset-0 z-[9000] bg-black/75 backdrop-blur-sm"
          />

          {/* Bottom sheet */}
          <motion.div
            key="lr-sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 220 }}
            className="fixed bottom-0 left-0 right-0 z-[9001] bg-[#0e0e1a] border-t border-white/10 rounded-t-3xl max-h-[92dvh] overflow-y-auto"
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            {/* Header */}
            <div className="px-5 pt-4 pb-5 border-b border-white/8">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
                  <ShieldAlert size={22} className="text-amber-400" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white leading-tight mb-0.5">
                    {t("listing_rules_title")}
                  </h2>
                  <p className="text-xs text-white/45">{t("listing_rules_subtitle")}</p>
                </div>
              </div>
            </div>

            {/* Rules list */}
            <div className="px-5 py-4 space-y-2.5">
              {LISTING_RULES.map((rule, i) => (
                <motion.div
                  key={rule.titleKey}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: 0.05 * i }}
                  className="flex items-start gap-3.5 p-4 rounded-2xl bg-white/4 border border-white/8"
                >
                  <span className="text-xl leading-none mt-0.5 shrink-0">{rule.icon}</span>
                  <div>
                    <p className="text-sm font-bold text-white mb-1">{t(rule.titleKey)}</p>
                    <p className="text-[13px] text-white/55 leading-relaxed">{t(rule.bodyKey)}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Action buttons */}
            <div className="px-5 pb-10 pt-3 space-y-3">
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={acceptRulesAndPublish}
                className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-base shadow-lg shadow-primary/30 flex items-center justify-center gap-2"
              >
                <CheckCircle2 size={18} />
                {t("listing_rules_confirm")}
              </motion.button>
              <button
                onClick={() => setShowRulesModal(false)}
                className="w-full py-3 text-sm text-white/45 hover:text-white/70 transition-colors"
                data-testid="button-listing-rules-skip"
              >
                {t("rules_skip")}
              </button>
              {/* No "view full rules" link here — the modal already shows all
                  five rules above. Routing away to /safety-rules would unmount
                  the create-auction page and discard the in-progress draft
                  (video/photos/title/category/etc). The full page is still
                  reachable any time from Hamburger menu → Safety & Rules. */}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
    </>
  );
}
