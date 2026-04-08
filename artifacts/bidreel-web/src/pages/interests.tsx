import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useLang } from "@/contexts/LanguageContext";
import { Camera, CheckCircle2, XCircle, Loader2, ArrowRight } from "lucide-react";
import {
  updateProfileApi,
  checkUsernameApi,
  UsernameTakenError,
  getUploadUrlApi,
  uploadFileToStorage,
} from "@/lib/api-client";

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
  const { t } = useLang();

  // ── Step state ──
  const [step, setStep] = useState<0 | 1>(0);

  // ── Profile setup state (step 0) ──
  const [username, setUsername] = useState("");
  const [usernameState, setUsernameState] = useState<UsernameState>("idle");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Interests state (step 1) ──
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Cleanup avatar object URL on unmount ──
  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

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
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(null);
    setAvatarPreview(null);
    setAvatarError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [avatarPreview]);

  // ── Submit profile setup ──
  const submitProfile = useCallback(async () => {
    if (isSubmitting) return;
    setSubmitError(null);

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
        const { uploadUrl, publicUrl } = await getUploadUrlApi(
          "image",
          avatarFile.type,
          avatarFile.size,
        );
        await uploadFileToStorage(uploadUrl, avatarFile);
        avatarUrl = publicUrl;
      }

      await updateProfileApi({
        username: trimmed,
        ...(avatarUrl ? { avatarUrl } : {}),
      });

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
  }, [isSubmitting, username, usernameState, avatarFile]);

  // ── Interests helpers ──
  const toggleInterest = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const finish = () => {
    localStorage.setItem("hasSeenInterests", "1");
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

  const canSubmitProfile =
    username.length >= 3 &&
    USERNAME_REGEX.test(username) &&
    usernameState !== "taken" &&
    usernameState !== "checking" &&
    !isSubmitting;

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full min-h-[100dvh] bg-background flex flex-col overflow-hidden">

      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-primary/15 rounded-full blur-[120px]" />
      </div>

      <AnimatePresence mode="wait">
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
                  <p className="text-xs text-white/30">
                    Profile photo · optional · JPG, PNG, WebP
                  </p>
                )}
                {avatarError && (
                  <p className="text-xs text-red-400 text-center">{avatarError}</p>
                )}
              </div>
            </motion.div>

            {/* Username input */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.18 }}
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
                onClick={finish}
                className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-base shadow-lg shadow-primary/30"
              >
                {selected.size > 0
                  ? `${t("interests_done")} · ${selected.size} selected`
                  : t("interests_done")}
              </motion.button>
              <button
                onClick={finish}
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
