import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useLang } from "@/contexts/LanguageContext";
import { type Language, LANGUAGE_NAMES } from "@/lib/i18n";
import { Camera, CheckCircle2, XCircle, Loader2, ArrowRight, Phone, User, MapPin, Navigation, Check, ShieldAlert } from "lucide-react";
import {
  updateProfileApi,
  checkUsernameApi,
  UsernameTakenError,
} from "@/lib/api-client";
import { uploadMedia, compressAvatar } from "@/lib/media-upload";
import { reverseGeocodeCity } from "@/lib/geo";
import { clearCurrentUserCache, getCachedCurrentUser } from "@/hooks/use-current-user";

/** Normalize raw phone input to E.164 format */
function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[\s\-\(\)\.]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("00")) return "+" + cleaned.slice(2);
  return cleaned;
}

const E164_REGEX = /^\+[1-9]\d{7,14}$/;

// ─── Constants ────────────────────────────────────────────────────────────────

const INTERESTS = [
  { id: "fishing",      emoji: "🎣", en: "Fishing" },
  { id: "cars",         emoji: "🚗", en: "Cars" },
  { id: "phones",       emoji: "📱", en: "Phones" },
  { id: "fashion",      emoji: "👗", en: "Fashion" },
  { id: "electronics",  emoji: "⚡", en: "Electronics" },
  { id: "furniture",    emoji: "🪑", en: "Furniture" },
  { id: "watches",      emoji: "⌚", en: "Watches" },
  { id: "gaming",       emoji: "🎮", en: "Gaming" },
  { id: "sports",       emoji: "⚽", en: "Sports" },
  { id: "collectibles", emoji: "🏆", en: "Collectibles" },
  { id: "art",          emoji: "🎨", en: "Art" },
  { id: "jewelry",      emoji: "💎", en: "Jewelry" },
];

const USERNAME_REGEX = /^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$|^[a-z0-9]{3}$/;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const DEBOUNCE_MS = 600;

type UsernameState = "idle" | "checking" | "available" | "taken" | "invalid";

// ─── Component ────────────────────────────────────────────────────────────────

export default function Interests() {
  const [, setLocation] = useLocation();
  const { t, lang, setLang } = useLang();

  // ── Step state ──
  // "lang"  → language selection (new users only, skipped for returning editors)
  // 0       → profile setup
  // 1       → interests selection
  // "rules" → safety rules (new users only, shown once)
  const [step, setStep] = useState<"lang" | 0 | 1 | "rules">(() =>
    localStorage.getItem("hasSeenInterests") ? 0 : "lang"
  );

  // ── Language step helpers ──
  const LANG_FLAG: Record<Language, string> = { en: "🇺🇸", ar: "🇸🇦", ru: "🇷🇺", es: "🇪🇸", fr: "🇫🇷" };
  const LANGUAGES: Language[] = ["ar", "en", "ru", "es", "fr"];

  // ── Profile setup state (step 0) ──
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone]             = useState("");
  const [location, setLocation2]      = useState("");
  const [username, setUsername]       = useState("");
  const [usernameState, setUsernameState] = useState<UsernameState>("idle");
  const [avatarFile, setAvatarFile]   = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  // Tracks an already-uploaded avatar URL so returning users don't need to re-upload
  const [existingAvatarUrl, setExistingAvatarUrl] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Geolocation auto-fill for location field ──
  type GeoLocStatus = "idle" | "requesting" | "resolved" | "denied" | "unavailable";
  const [geoLocStatus, setGeoLocStatus] = useState<GeoLocStatus>("idle");
  const autoRequestedRef = useRef(false);

  // ── Interests state (step 1) ──
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Cleanup avatar object URL on unmount (only for blob: URLs, not external URLs) ──
  useEffect(() => {
    return () => {
      if (avatarPreview && avatarPreview.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

  // ── Pre-populate form from cached user (returning users editing their profile) ──
  useEffect(() => {
    const cached = getCachedCurrentUser();
    if (!cached) return;
    if (cached.displayName) setDisplayName(cached.displayName);
    if (cached.location)    setLocation2(cached.location);
    if (cached.username)    setUsername(cached.username);
    if (cached.avatarUrl) {
      setExistingAvatarUrl(cached.avatarUrl);
      setAvatarPreview(cached.avatarUrl);
    }
    if (cached.phone) setPhone(cached.phone);
  }, []);

  // ── Geolocation — request city name and auto-fill location field ──
  const requestGeoLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoLocStatus("unavailable");
      return;
    }
    setGeoLocStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setGeoLocStatus("resolved");
        try {
          const city = await reverseGeocodeCity(pos.coords.latitude, pos.coords.longitude);
          if (city) {
            setLocation2(city);
            setSubmitError(null);
          }
        } catch {
          // Nominatim failed — user can still type manually
        }
      },
      () => {
        setGeoLocStatus("denied");
      },
      { timeout: 8000, maximumAge: 300_000 },
    );
  }, []);

  // Auto-request once on mount if the location field is empty
  useEffect(() => {
    if (autoRequestedRef.current) return;
    autoRequestedRef.current = true;
    if (location.trim().length >= 2) return; // already filled
    requestGeoLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Username validation + debounced availability check ──
  const handleUsernameChange = useCallback((raw: string) => {
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30);
    setUsername(cleaned);
    setSubmitError(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (cleaned.length === 0) {
      setUsernameState("idle");
      return;
    }

    if (!USERNAME_REGEX.test(cleaned)) {
      setUsernameState("invalid");
      return;
    }

    setUsernameState("checking");
    debounceRef.current = setTimeout(async () => {
      try {
        const available = await checkUsernameApi(cleaned);
        setUsernameState(available ? "available" : "taken");
      } catch {
        setUsernameState("idle");
      }
    }, DEBOUNCE_MS);
  }, []);

  // ── Avatar file selection ──
  const handleAvatarChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setAvatarError(null);

    if (!file) {
      setAvatarFile(null);
      setAvatarPreview(null);
      return;
    }

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setAvatarError("Only JPG, PNG, or WebP images are allowed.");
      e.target.value = "";
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      setAvatarError("Image must be smaller than 20 MB.");
      e.target.value = "";
      return;
    }

    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }, [avatarPreview]);

  const removeAvatar = useCallback(() => {
    if (avatarPreview && avatarPreview.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(null);
    setAvatarPreview(null);
    setExistingAvatarUrl(null);
    setAvatarError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [avatarPreview]);

  // ── Submit profile setup ──
  const submitProfile = useCallback(async () => {
    if (isSubmitting) return;
    setSubmitError(null);

    // Validate display name
    const trimmedName = displayName.trim();
    if (trimmedName.length < 2) {
      setSubmitError("Display name must be at least 2 characters.");
      return;
    }

    // Validate + normalize phone
    const normalizedPhone = normalizePhone(phone.trim());
    if (!E164_REGEX.test(normalizedPhone)) {
      setSubmitError("Enter a valid international phone number starting with + and country code (e.g. +966500000000 or +201060000000).");
      return;
    }

    // Validate location (required)
    const trimmedLocation = location.trim();
    if (trimmedLocation.length < 2) {
      setSubmitError("Location must be at least 2 characters (e.g. Riyadh, Cairo, Dubai).");
      return;
    }

    // Validate avatar (required, but existing server URL is acceptable)
    if (!avatarFile && !existingAvatarUrl) {
      setSubmitError("Profile photo is required. Please upload a photo.");
      return;
    }

    // Validate username
    const trimmed = username.trim();

    if (trimmed.length < 3) {
      setSubmitError("Username must be at least 3 characters.");
      return;
    }

    if (!USERNAME_REGEX.test(trimmed)) {
      setSubmitError("Username may only contain lowercase letters, numbers, and underscores.");
      return;
    }

    if (usernameState === "taken") {
      setSubmitError("That username is already taken. Please choose another one.");
      return;
    }

    if (usernameState === "checking") {
      setSubmitError("Still checking username availability — please wait a moment.");
      return;
    }

    setIsSubmitting(true);

    try {
      let avatarUrl: string | undefined;

      if (avatarFile) {
        const compressed = await compressAvatar(avatarFile);
        avatarUrl = await uploadMedia(compressed, "image");
      }

      await updateProfileApi({
        username: trimmed,
        displayName: trimmedName,
        phone: normalizedPhone,
        location: trimmedLocation,
        ...(avatarUrl ? { avatarUrl } : {}),
      });

      // Clear the stale cached user so the next useCurrentUser() call re-fetches
      // from the server and returns isCompleted: true. Without this the create-auction
      // gate reads the old cached isCompleted: false and loops forever.
      clearCurrentUserCache();

      setStep(1);
    } catch (err) {
      if (err instanceof UsernameTakenError) {
        setUsernameState("taken");
        setSubmitError(err.message);
      } else {
        setSubmitError(
          err instanceof Error ? err.message : "Something went wrong. Please try again.",
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, displayName, phone, location, username, usernameState, avatarFile]);

  // ── Interests helpers ──
  const toggleInterest = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const finishInterests = () => {
    const wasFirstTime = !localStorage.getItem("hasSeenInterests");
    localStorage.setItem("hasSeenInterests", "1");
    clearCurrentUserCache();
    // First-time users who haven't seen safety rules yet → show rules step.
    // Returning users editing their profile → go straight to feed.
    if (wasFirstTime && !localStorage.getItem("bidreel_rules_seen")) {
      setStep("rules");
    } else {
      setLocation("/feed");
    }
  };

  const finishRules = () => {
    localStorage.setItem("bidreel_rules_seen", "1");
    setLocation("/feed");
  };

  // ── Username status icon ──
  const UsernameIcon = () => {
    if (usernameState === "checking") return <Loader2 size={16} className="animate-spin text-white/40" />;
    if (usernameState === "available") return <CheckCircle2 size={16} className="text-green-400" />;
    if (usernameState === "taken") return <XCircle size={16} className="text-red-400" />;
    if (usernameState === "invalid" && username.length > 0) return <XCircle size={16} className="text-red-400" />;
    return null;
  };

  const usernameHint = () => {
    if (usernameState === "available") return { text: "Username is available!", color: "text-green-400" };
    if (usernameState === "taken") return { text: "Username is already taken.", color: "text-red-400" };
    if (usernameState === "invalid" && username.length > 0)
      return { text: "Only lowercase letters, numbers, and underscores.", color: "text-red-400" };
    return { text: "3–30 chars · lowercase letters, numbers, underscores only", color: "text-white/30" };
  };

  const hasAvatar = avatarFile !== null || existingAvatarUrl !== null;
  const canSubmitProfile =
    displayName.trim().length >= 2 &&
    phone.trim().length >= 7 &&
    location.trim().length >= 2 &&
    username.length >= 3 &&
    USERNAME_REGEX.test(username) &&
    usernameState !== "taken" &&
    usernameState !== "checking" &&
    hasAvatar &&
    !isSubmitting;

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full min-h-[100dvh] bg-background flex flex-col overflow-hidden">

      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-primary/15 rounded-full blur-[120px]" />
      </div>

      <AnimatePresence mode="wait">

        {/* ── STEP LANG: Language Selection (new users only) ── */}
        {step === "lang" && (
          <motion.div
            key="lang-step"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -24 }}
            transition={{ duration: 0.3 }}
            className="relative z-10 flex flex-col flex-1 px-5 pt-16 pb-10"
          >
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="mb-10 text-center"
            >
              <img
                src={`${import.meta.env.BASE_URL}images/logo-icon.png`}
                alt="BidReel"
                className="w-16 h-16 rounded-2xl mx-auto mb-6 box-glow"
              />
              <h1 className="text-3xl font-bold text-white leading-tight mb-3">
                {t("lang_step_title")}
              </h1>
              <p className="text-sm text-white/50 leading-relaxed max-w-xs mx-auto">
                {t("lang_step_subtitle")}
              </p>
            </motion.div>

            <div className="rounded-2xl bg-white/4 border border-white/8 overflow-hidden divide-y divide-white/6 mb-8">
              {LANGUAGES.map((l, i) => {
                const isActive = lang === l;
                return (
                  <motion.button
                    key={l}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25, delay: 0.06 * i }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setLang(l)}
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/5 active:bg-white/8 transition-colors"
                  >
                    <div className="flex items-center gap-3.5">
                      <span className="text-2xl leading-none">{LANG_FLAG[l]}</span>
                      <span className={`text-base font-semibold ${isActive ? "text-white" : "text-white/60"}`}>
                        {LANGUAGE_NAMES[l]}
                      </span>
                    </div>
                    {isActive && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0"
                      >
                        <Check size={13} className="text-white" />
                      </motion.div>
                    )}
                  </motion.button>
                );
              })}
            </div>

            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.35 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setStep(0)}
              className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-base shadow-lg shadow-primary/30 flex items-center justify-center gap-2"
            >
              {t("continue")}
              <ArrowRight size={18} />
            </motion.button>
          </motion.div>
        )}

        {/* ── STEP 0: Profile Setup ── */}
        {step === 0 && (
          <motion.div
            key="profile-setup"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.3 }}
            className="relative z-10 flex flex-col flex-1 px-5 pt-14 pb-10"
          >
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="mb-8"
            >
              <p className="text-xs font-semibold tracking-widest text-primary/70 uppercase mb-1">Step 1 of 2</p>
              <h1 className="text-3xl font-bold text-white leading-tight mb-2">Set up your profile</h1>
              <p className="text-sm text-white/40 leading-snug">
                Choose a username so other bidders can find you.
              </p>
            </motion.div>

            {/* Avatar picker */}
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35, delay: 0.1 }}
              className="flex flex-col items-center mb-8"
            >
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="relative w-24 h-24 rounded-full overflow-hidden border-2 border-primary/40 bg-white/5 flex items-center justify-center group hover:border-primary transition-colors"
                aria-label="Upload profile photo"
              >
                {avatarPreview ? (
                  <img
                    src={avatarPreview}
                    alt="Avatar preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Camera size={28} className="text-white/30 group-hover:text-white/60 transition-colors" />
                )}
                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Camera size={22} className="text-white" />
                </div>
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={handleAvatarChange}
                aria-label="Profile photo upload"
              />

              <div className="mt-2 flex flex-col items-center gap-1">
                {avatarPreview ? (
                  <button
                    type="button"
                    onClick={removeAvatar}
                    className="text-xs text-red-400/70 hover:text-red-400 transition-colors"
                  >
                    Remove photo
                  </button>
                ) : (
                  <p className="text-xs text-white/50">
                    Profile photo <span className="text-primary">*</span> · JPG, PNG, WebP
                  </p>
                )}
                {avatarError && (
                  <p className="text-xs text-red-400 text-center">{avatarError}</p>
                )}
              </div>
            </motion.div>

            {/* Display name input */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.14 }}
              className="mb-4"
            >
              <label className="block text-xs font-semibold text-white/50 mb-2 tracking-wide uppercase">
                Display name <span className="text-primary">*</span>
              </label>
              <div className="relative">
                <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="name"
                  maxLength={50}
                  value={displayName}
                  onChange={e => { setDisplayName(e.target.value); setSubmitError(null); }}
                  placeholder="Your full name"
                  className="w-full bg-white/5 border border-white/10 focus:border-primary/60 rounded-2xl pl-10 pr-4 py-4 text-white text-base font-medium placeholder:text-white/20 focus:outline-none transition-colors"
                />
              </div>
            </motion.div>

            {/* Phone input */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.16 }}
              className="mb-4"
            >
              <label className="block text-xs font-semibold text-white/50 mb-2 tracking-wide uppercase">
                WhatsApp / Phone <span className="text-primary">*</span>
              </label>
              <div className="relative">
                <Phone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={e => { setPhone(e.target.value); setSubmitError(null); }}
                  placeholder="+966 ••• ••• ••• or +963 ••• ••• •••"
                  dir="ltr"
                  className="w-full bg-white/5 border border-white/10 focus:border-primary/60 rounded-2xl pl-10 pr-4 py-4 text-white text-base font-medium placeholder:text-white/20 focus:outline-none transition-colors"
                />
              </div>
              <p className="mt-1.5 text-xs text-white/30">
                Used for seller/buyer contact via WhatsApp · include country code (e.g. +966, +963, +20)
              </p>
            </motion.div>

            {/* Location input */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.18 }}
              className="mb-4"
            >
              <label className="block text-xs font-semibold text-white/50 mb-2 tracking-wide uppercase">
                Location <span className="text-primary">*</span>
              </label>
              <div className="relative">
                <MapPin size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="address-level2"
                  maxLength={100}
                  value={location}
                  onChange={e => { setLocation2(e.target.value); setSubmitError(null); }}
                  placeholder="Riyadh, Cairo, Dubai…"
                  className={`w-full bg-white/5 border border-white/10 focus:border-primary/60 rounded-2xl pl-10 py-4 text-white text-base font-medium placeholder:text-white/20 focus:outline-none transition-colors ${location.trim().length < 2 ? "pr-12" : "pr-4"}`}
                />
                {/* Inline geo button — visible when the location field is empty */}
                {location.trim().length < 2 && (
                  <button
                    type="button"
                    onClick={requestGeoLocation}
                    disabled={geoLocStatus === "requesting"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/10 transition-colors disabled:opacity-40"
                    aria-label="Detect my location"
                  >
                    {geoLocStatus === "requesting"
                      ? <Loader2 size={16} className="animate-spin" />
                      : <Navigation size={16} />
                    }
                  </button>
                )}
              </div>
              {geoLocStatus === "denied" || geoLocStatus === "unavailable" ? (
                <p className="mt-1.5 text-xs text-white/40">
                  Location access was denied — type your city manually, or enable location in your browser settings.
                </p>
              ) : (
                <p className="mt-1.5 text-xs text-white/30">
                  Your city or region · helps buyers and sellers find nearby items
                </p>
              )}
            </motion.div>

            {/* Username input */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.2 }}
              className="mb-2"
            >
              <label className="block text-xs font-semibold text-white/50 mb-2 tracking-wide uppercase">
                Username <span className="text-primary">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 text-base font-medium select-none">@</span>
                <input
                  type="text"
                  inputMode="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="username"
                  spellCheck={false}
                  maxLength={30}
                  value={username}
                  onChange={e => handleUsernameChange(e.target.value)}
                  placeholder="your_username"
                  className={[
                    "w-full bg-white/5 border rounded-2xl pl-8 pr-10 py-4 text-white text-base font-medium",
                    "placeholder:text-white/20 focus:outline-none transition-colors",
                    usernameState === "available"
                      ? "border-green-400/50 focus:border-green-400"
                      : usernameState === "taken" || usernameState === "invalid"
                        ? "border-red-400/50 focus:border-red-400"
                        : "border-white/10 focus:border-primary/60",
                  ].join(" ")}
                  aria-label="Username"
                  aria-describedby="username-hint"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2">
                  <UsernameIcon />
                </span>
              </div>
              <p
                id="username-hint"
                className={`mt-1.5 text-xs transition-colors ${usernameHint().color}`}
              >
                {usernameHint().text}
              </p>
            </motion.div>

            {/* Submit error */}
            <AnimatePresence>
              {submitError && (
                <motion.div
                  key="submit-error"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20"
                >
                  <p className="text-xs text-red-400 text-center">{submitError}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Continue button */}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.28 }}
              className="mt-auto pt-8"
            >
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={submitProfile}
                disabled={!canSubmitProfile}
                className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-base shadow-lg shadow-primary/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-opacity"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight size={18} />
                  </>
                )}
              </motion.button>
            </motion.div>
          </motion.div>
        )}

        {/* ── STEP 1: Interests ── */}
        {step === 1 && (
          <motion.div
            key="interests"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.3 }}
            className="relative z-10 flex flex-col flex-1 px-5 pt-14 pb-10"
          >
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mb-8"
            >
              <p className="text-xs font-semibold tracking-widest text-primary/70 uppercase mb-1">Step 2 of 2</p>
              <h1 className="text-3xl font-bold text-white leading-tight mb-2">
                {t("interests_title")}
              </h1>
              <p className="text-base text-muted-foreground leading-snug">
                {t("interests_subtitle")}
              </p>
            </motion.div>

            {/* Chips grid */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.15 }}
              className="flex flex-wrap gap-3 flex-1"
            >
              {INTERESTS.map((item, i) => {
                const isOn = selected.has(item.id);
                return (
                  <motion.button
                    key={item.id}
                    initial={{ opacity: 0, scale: 0.88 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3, delay: 0.05 * i }}
                    whileTap={{ scale: 0.93 }}
                    onClick={() => toggleInterest(item.id)}
                    className={[
                      "flex items-center gap-2 px-4 py-3 rounded-2xl border text-sm font-semibold transition-all duration-200",
                      isOn
                        ? "bg-primary/20 border-primary text-white shadow-md shadow-primary/20"
                        : "bg-white/5 border-white/10 text-white/60 hover:bg-white/8",
                    ].join(" ")}
                  >
                    <span className="text-base leading-none">{item.emoji}</span>
                    <span>{item.en}</span>
                    <AnimatePresence>
                      {isOn && (
                        <motion.span
                          key="check"
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0, opacity: 0 }}
                          transition={{ duration: 0.18 }}
                          className="text-primary text-xs leading-none"
                        >
                          ✓
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.button>
                );
              })}
            </motion.div>

            {/* Bottom actions */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.4 }}
              className="mt-8 flex flex-col gap-3"
            >
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={finishInterests}
                className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-base shadow-lg shadow-primary/30"
              >
                {selected.size > 0
                  ? `${t("interests_done")} · ${selected.size} selected`
                  : t("interests_done")}
              </motion.button>
              <button
                onClick={finishInterests}
                className="w-full py-3 text-sm text-white/40 font-medium hover:text-white/70 transition-colors"
              >
                {t("interests_skip")}
              </button>
            </motion.div>
          </motion.div>
        )}

        {/* ── STEP RULES: Safety Onboarding (shown once, first-time users only) ── */}
        {step === "rules" && (
          <motion.div
            key="rules-step"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.3 }}
            className="relative z-10 flex flex-col flex-1 px-5 pt-14 pb-10 overflow-y-auto"
          >
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="mb-8"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
                  <ShieldAlert size={20} className="text-amber-400" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-white leading-tight">{t("rules_step_title")}</h1>
                  <p className="text-sm text-white/45">{t("rules_step_subtitle")}</p>
                </div>
              </div>
            </motion.div>

            <div className="flex flex-col gap-3 flex-1">
              {([
                { icon: "🤝", titleKey: "rule_1_title", bodyKey: "rule_1_body" },
                { icon: "👥", titleKey: "rule_2_title", bodyKey: "rule_2_body" },
                { icon: "🔍", titleKey: "rule_3_title", bodyKey: "rule_3_body" },
                { icon: "⚠️", titleKey: "rule_4_title", bodyKey: "rule_4_body" },
                { icon: "🚫", titleKey: "rule_5_title", bodyKey: "rule_5_body" },
              ] as const).map((rule, i) => (
                <motion.div
                  key={rule.titleKey}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.06 * i }}
                  className="flex items-start gap-4 p-4 rounded-2xl bg-white/4 border border-white/8"
                >
                  <span className="text-2xl leading-none mt-0.5 shrink-0">{rule.icon}</span>
                  <div>
                    <p className="text-sm font-bold text-white mb-1">{t(rule.titleKey)}</p>
                    <p className="text-xs text-white/50 leading-relaxed">{t(rule.bodyKey)}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.38 }}
              className="mt-8 flex flex-col gap-3"
            >
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={finishRules}
                className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-base shadow-lg shadow-primary/30"
              >
                {t("rules_done")}
              </motion.button>
              <button
                onClick={finishRules}
                className="w-full py-3 text-sm text-white/40 font-medium hover:text-white/70 transition-colors"
              >
                {t("interests_skip")}
              </button>
            </motion.div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
