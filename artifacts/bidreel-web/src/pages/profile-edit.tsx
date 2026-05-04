/**
 * profile-edit.tsx — clean, minimal profile-save flow.
 *
 * REPLACES the multi-step /interests wizard for editing existing profiles.
 *
 * Save sequence (the ONLY save sequence on this page):
 *   1. validate locally
 *   2. PATCH /users/me  with { username, displayName, phone, location }
 *   3. await full response
 *   4. assert returned profile.phone matches what we sent (else fail)
 *   5. setCachedCurrentUser(returned profile) — synchronous cache update
 *   6. navigate to /profile
 *
 * Avatar upload is a separate instant-save step — picking a photo immediately
 * compresses, uploads (R2 presigned), PATCHes avatarUrl, and refreshes the
 * cache without requiring the user to tap Save. Removal clears avatarUrl via
 * a separate PATCH.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, Phone, User, MapPin, AtSign, Loader2, CheckCircle2, XCircle, Camera, X } from "lucide-react";
import {
  updateProfileApi,
  checkUsernameApi,
  UsernameTakenError,
  getUserMeApi,
} from "@/lib/api-client";
import { uploadMedia, compressAvatar } from "@/lib/media-upload";
import { setCachedCurrentUser, getCachedCurrentUser } from "@/hooks/use-current-user";
import { useLang } from "@/contexts/LanguageContext";

const E164_REGEX = /^\+[1-9]\d{7,14}$/;
const USERNAME_REGEX = /^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$|^[a-z0-9]{3}$/;

function normalizePhone(raw: string, location?: string): string {
  const cleaned = raw.replace(/[\s\-\(\)\.]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("00")) return "+" + cleaned.slice(2);

  // Prepend prefix based on location if "+" is missing
  const loc = (location || "").toLowerCase();
  if (loc.includes("egypt") || loc.includes("eg") || loc.includes("مصر")) return "+20" + cleaned;
  if (loc.includes("saudi") || loc.includes("sa") || loc.includes("السعودية")) return "+966" + cleaned;
  if (loc.includes("japan") || loc.includes("jp") || loc.includes("اليابان")) return "+81" + cleaned;

  return "+1" + cleaned;
}

function maskPhone(p: string): string {
  return p.length >= 4 ? `***${p.slice(-4)}` : "(short)";
}

type UsernameState = "idle" | "checking" | "available" | "taken" | "invalid";

export default function ProfileEdit() {
  const [, setLocation] = useLocation();
  const { t } = useLang();
  // Local strings — using direct text avoids adding new keys to the i18n type
  // for an internal screen. Keys that already exist in i18n.ts use t() below.
  const STR = {
    displayNameMin: "Display name must be at least 2 characters.",
    usernameInvalid: "Username may only contain lowercase letters, numbers, and underscores.",
    usernameTaken: "That username is already taken.",
    usernameChecking: "Still checking username availability — please wait.",
    phoneInvalid: "Enter a valid international phone (e.g. +966500000000).",
    locationMin: "Location must be at least 2 characters.",
    savePhoneMismatch: "Save did not persist your phone. Please try again.",
    savePartial: "Save was incomplete. Please try again.",
    back: "Back",
    displayNamePh: "Your name",
    locationPh: "Riyadh, Cairo, Dubai…",
    saving: "Saving…",
  };

  // ── Bound to one state variable each. Pre-loaded from server in useEffect. ──
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation2] = useState("");
  const [username, setUsername] = useState("");
  const [isDetecting, setIsDetecting] = useState(false);
  const [originalUsername, setOriginalUsername] = useState("");

  const [usernameState, setUsernameState] = useState<UsernameState>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Avatar state ──
  // `committedAvatarUrl` = last URL persisted to the server (or loaded from it).
  // `avatarPreview`      = what the <img> shows (may be a temporary blob: URL).
  const [committedAvatarUrl, setCommittedAvatarUrl] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarRemoving, setAvatarRemoving] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Revoke any outstanding blob URL on unmount.
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  // ── Pre-load current profile from server (single source of truth). ──
  // We do NOT trust the cached user here because the user may have come from a
  // tab that mutated state elsewhere. Always GET /users/me on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Show cached values instantly so the form doesn't flash blank.
        const cached = getCachedCurrentUser();
        if (cached && !cancelled) {
          setDisplayName(cached.displayName ?? "");
          setPhone(cached.phone ?? "");
          setLocation2(cached.location ?? "");
          setUsername(cached.username ?? "");
          setOriginalUsername(cached.username ?? "");
          if (cached.avatarUrl) {
            setCommittedAvatarUrl(cached.avatarUrl);
            setAvatarPreview(cached.avatarUrl);
          }
        }

        // Then refresh from server to make sure we're authoritative.
        const fresh = await getUserMeApi();
        if (cancelled) return;
        setCachedCurrentUser(fresh);
        setDisplayName(fresh.displayName ?? "");
        setPhone(fresh.phone ?? "");
        setLocation2(fresh.location ?? "");
        setUsername(fresh.username ?? "");
        setOriginalUsername(fresh.username ?? "");
        setCommittedAvatarUrl(fresh.avatarUrl ?? null);
        setAvatarPreview(fresh.avatarUrl ?? null);
        console.log(
          `[profile-edit] preloaded: hasUsername=${!!fresh.username} hasName=${!!fresh.displayName} hasPhone=${!!fresh.phone} phoneLen=${fresh.phone?.length ?? 0} hasLocation=${!!fresh.location} hasAvatar=${!!fresh.avatarUrl}`,
        );
      } catch (err) {
        console.error("[profile-edit] preload failed:", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Username availability check (only if changed from original). ──
  const handleUsernameChange = useCallback((raw: string) => {
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30);
    setUsername(cleaned);
    setSubmitError(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (cleaned.length === 0 || cleaned === originalUsername) {
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
    }, 500);
  }, [originalUsername]);

  // ── Avatar: instant upload on file selection ──
  const handleAvatarChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;

    setAvatarError(null);

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setAvatarError("Only JPG, PNG, or WebP images are allowed.");
      e.target.value = "";
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setAvatarError("Image must be smaller than 20 MB.");
      e.target.value = "";
      return;
    }

    // Show a local blob preview immediately so the user sees their pick.
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    const localUrl = URL.createObjectURL(file);
    blobUrlRef.current = localUrl;
    setAvatarPreview(localUrl);
    setAvatarUploading(true);

    try {
      const compressed = await compressAvatar(file);
      const uploadedUrl = await uploadMedia(compressed, "image");
      const updated = await updateProfileApi({ avatarUrl: uploadedUrl });
      setCachedCurrentUser(updated);

      // Replace the temporary blob with the real CDN URL.
      URL.revokeObjectURL(localUrl);
      blobUrlRef.current = null;
      setCommittedAvatarUrl(uploadedUrl);
      setAvatarPreview(uploadedUrl);
      console.log("[profile-edit] avatar uploaded + linked OK");
    } catch (err) {
      // Revert to whatever was committed before.
      URL.revokeObjectURL(localUrl);
      blobUrlRef.current = null;
      setAvatarPreview(committedAvatarUrl);
      const msg = err instanceof Error ? err.message : "Photo upload failed.";
      setAvatarError(msg);
      console.warn("[profile-edit] avatar upload failed:", msg);
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [committedAvatarUrl]);

  // ── Avatar: remove (clears the photo on the server) ──
  const handleAvatarRemove = useCallback(async () => {
    if (avatarRemoving || avatarUploading) return;
    setAvatarError(null);
    setAvatarRemoving(true);
    try {
      const updated = await updateProfileApi({ avatarUrl: "" });
      setCachedCurrentUser(updated);
      setCommittedAvatarUrl(null);
      setAvatarPreview(null);
      console.log("[profile-edit] avatar removed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not remove photo.";
      setAvatarError(msg);
      console.warn("[profile-edit] avatar remove failed:", msg);
    } finally {
      setAvatarRemoving(false);
    }
  }, [avatarRemoving, avatarUploading]);

  // ── THE save handler. One PATCH. Awaited. Verified. Then navigate. ──
  const onSave = useCallback(async () => {
    if (isSubmitting) return;
    setSubmitError(null);

    // Local validation.
    const trimmedName = displayName.trim();
    if (trimmedName.length < 2) {
      setSubmitError(STR.displayNameMin);
      return;
    }
    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 3 || !USERNAME_REGEX.test(trimmedUsername)) {
      setSubmitError(STR.usernameInvalid);
      return;
    }
    if (usernameState === "taken") {
      setSubmitError(STR.usernameTaken);
      return;
    }
    if (usernameState === "checking") {
      setSubmitError(STR.usernameChecking);
      return;
    }
    const normalizedPhone = normalizePhone(phone.trim(), location.trim());
    if (!E164_REGEX.test(normalizedPhone)) {
      setSubmitError(STR.phoneInvalid);
      return;
    }
    const trimmedLocation = location.trim();
    if (trimmedLocation.length < 2) {
      setSubmitError(STR.locationMin);
      return;
    }

    const phoneTag = maskPhone(normalizedPhone);
    setIsSubmitting(true);

    try {
      console.log(`[profile-edit] PATCH /users/me phone=${phoneTag} phoneLen=${normalizedPhone.length}`);

      // ── THE single PATCH. ──
      const updated = await updateProfileApi({
        username: trimmedUsername,
        displayName: trimmedName,
        phone: normalizedPhone,
        location: trimmedLocation,
      });

      // ── Verify the server actually persisted what we sent. ──
      const serverPhone = updated.phone ?? "";
      const serverPhoneTag = maskPhone(serverPhone);
      if (serverPhone !== normalizedPhone) {
        console.error(
          `[profile-edit] PATCH succeeded but phone mismatch: sent=${phoneTag} got=${serverPhoneTag}`,
        );
        setSubmitError(STR.savePhoneMismatch);
        return; // STAY on this page. No navigation.
      }
      if (
        updated.displayName !== trimmedName ||
        updated.username !== trimmedUsername ||
        updated.location !== trimmedLocation
      ) {
        console.error(
          `[profile-edit] field mismatch — name=${updated.displayName} user=${updated.username} loc=${updated.location}`,
        );
        setSubmitError(STR.savePartial);
        return;
      }

      // ── Synchronously update cache so /profile re-renders with fresh data. ──
      setCachedCurrentUser(updated);
      console.log(
        `[profile-edit] PATCH OK — phone=${serverPhoneTag} isCompleted=${updated.isCompleted}; navigating to /profile`,
      );

      // ── ONLY now navigate. ──
      // REPLACE — after a successful save the edit screen must NOT remain in
      // the back stack (otherwise back from /profile would re-open the form).
      setLocation("/profile", { replace: true });
    } catch (err) {
      if (err instanceof UsernameTakenError) {
        setUsernameState("taken");
        setSubmitError(err.message);
      } else {
        const msg = err instanceof Error ? err.message : "Save failed. Please try again.";
        setSubmitError(msg);
        console.error(`[profile-edit] PATCH FAILED phone=${phoneTag}: ${msg}`);
      }
      // STAY on this page — no navigation on error.
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, displayName, phone, location, username, usernameState, setLocation, t]);

  // ── Username UI helpers ──
  const UsernameIcon = () => {
    if (username === originalUsername || username.length === 0) return null;
    if (usernameState === "checking") return <Loader2 size={16} className="animate-spin text-white/40" />;
    if (usernameState === "available") return <CheckCircle2 size={16} className="text-green-400" />;
    if (usernameState === "taken" || usernameState === "invalid") return <XCircle size={16} className="text-red-400" />;
    return null;
  };

  const onDetectLocation = useCallback(async () => {
    if (!navigator.geolocation) {
      setSubmitError("Geolocation not supported by this browser.");
      return;
    }
    setIsDetecting(true);
    setSubmitError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          // Reverse geocode via serverless function (proxy to Nominatim or similar)
          // For now, use a direct fetch to a free API for minimal logic change
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&accept-language=en`);
          const data = await res.json();
          const city = data.address.city || data.address.town || data.address.village || data.address.suburb || "";
          const country = data.address.country || "";
          const locStr = [city, country].filter(Boolean).join(", ");
          if (locStr) setLocation2(locStr);
        } catch (err) {
          console.error("Geocoding failed:", err);
          setSubmitError("Could not determine city name. Please enter manually.");
        } finally {
          setIsDetecting(false);
        }
      },
      (err) => {
        setIsDetecting(false);
        if (err.code === 1) {
          setSubmitError("Location permission denied. Please allow access or type manually.");
        } else {
          setSubmitError("Could not detect location. Please type manually.");
        }
      },
      { timeout: 10000 }
    );
  }, []);

  const canSave =
    !isLoading &&
    !isSubmitting &&
    displayName.trim().length >= 2 &&
    username.length >= 3 &&
    USERNAME_REGEX.test(username) &&
    usernameState !== "taken" &&
    usernameState !== "checking" &&
    phone.trim().length >= 7 &&
    location.trim().length >= 2;

  return (
    <div className="relative min-h-[100dvh] bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-14 pb-4">
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => setLocation("/profile")}
          aria-label={STR.back}
          className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center"
        >
          <ArrowLeft size={18} className="text-white/70" />
        </motion.button>
        <h1 className="text-xl font-bold text-white">{t("edit_profile")}</h1>
      </div>

      <div className="flex-1 px-5 pb-24 space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={22} className="animate-spin text-white/40" />
          </div>
        ) : (
          <>
            {/* ── Avatar picker (instant upload) ── */}
            <div className="flex flex-col items-center pt-2 pb-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => !avatarUploading && !avatarRemoving && fileInputRef.current?.click()}
                  disabled={avatarUploading || avatarRemoving}
                  aria-label={avatarPreview ? "Change profile photo" : "Add profile photo"}
                  className="relative w-24 h-24 rounded-2xl overflow-hidden border-2 border-primary/30 bg-white/5 flex items-center justify-center group transition-colors hover:border-primary/60 disabled:cursor-wait"
                >
                  {avatarPreview ? (
                    <img
                      src={avatarPreview}
                      alt="Profile photo"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Camera size={28} className="text-white/30 group-hover:text-white/60 transition-colors" />
                  )}
                  {/* Hover overlay with camera icon */}
                  {!avatarUploading && !avatarRemoving && (
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                      <Camera size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  )}
                  {/* Upload / remove spinner overlay */}
                  {(avatarUploading || avatarRemoving) && (
                    <div className="absolute inset-0 bg-black/55 flex items-center justify-center">
                      <Loader2 size={22} className="animate-spin text-white" />
                    </div>
                  )}
                </button>

                {/* Remove button — only shown when a photo is committed */}
                {committedAvatarUrl && !avatarUploading && !avatarRemoving && (
                  <button
                    type="button"
                    onClick={handleAvatarRemove}
                    aria-label="Remove profile photo"
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500/90 border border-background flex items-center justify-center shadow-sm hover:bg-red-500 transition-colors"
                  >
                    <X size={12} className="text-white" />
                  </button>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={handleAvatarChange}
                aria-label="Profile photo upload"
              />

              <button
                type="button"
                onClick={() => !avatarUploading && !avatarRemoving && fileInputRef.current?.click()}
                disabled={avatarUploading || avatarRemoving}
                className="mt-2.5 text-xs font-semibold text-primary/80 hover:text-primary transition-colors disabled:opacity-40"
              >
                {avatarUploading
                  ? "Uploading…"
                  : avatarRemoving
                  ? "Removing…"
                  : avatarPreview
                  ? "Change Photo"
                  : "Add Photo"}
              </button>

              {avatarError && (
                <p className="mt-1.5 text-xs text-red-400 text-center max-w-[260px]">{avatarError}</p>
              )}
            </div>

            {/* Display name */}
            <Field
              icon={<User size={16} className="text-white/40" />}
              label={t("display_name_label")}
            >
              <input
                type="text"
                value={displayName}
                onChange={e => { setDisplayName(e.target.value); setSubmitError(null); }}
                maxLength={50}
                placeholder={STR.displayNamePh}
                className="w-full bg-transparent text-white placeholder-white/25 outline-none"
              />
            </Field>

            {/* Username */}
            <Field
              icon={<AtSign size={16} className="text-white/40" />}
              label={t("username_label")}
              right={<UsernameIcon />}
            >
              <input
                type="text"
                value={username}
                onChange={e => handleUsernameChange(e.target.value)}
                maxLength={30}
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="username"
                className="w-full bg-transparent text-white placeholder-white/25 outline-none"
              />
            </Field>

            {/* Phone */}
            <Field
              icon={<Phone size={16} className="text-white/40" />}
              label={t("phone_required_label")}
            >
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={e => { setPhone(e.target.value); setSubmitError(null); }}
                placeholder="+966500000000"
                className="w-full bg-transparent text-white placeholder-white/25 outline-none"
                dir="ltr"
              />
            </Field>

            {/* Location */}
            <Field
              icon={<MapPin size={16} className="text-white/40" />}
              label={t("location_label")}
              right={
                <button
                  type="button"
                  onClick={onDetectLocation}
                  disabled={isDetecting}
                  className="p-1 -mr-1 text-primary hover:text-primary/80 transition-colors disabled:opacity-40"
                  aria-label="Detect location"
                >
                  {isDetecting ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <MapPin size={16} />
                  )}
                </button>
              }
            >
              <input
                type="text"
                value={location}
                onChange={e => { setLocation2(e.target.value); setSubmitError(null); }}
                maxLength={100}
                placeholder={STR.locationPh}
                className="w-full bg-transparent text-white placeholder-white/25 outline-none"
              />
            </Field>

            {/* Error */}
            {submitError && (
              <div className="rounded-2xl bg-red-500/10 border border-red-500/25 px-4 py-3 text-sm text-red-300">
                {submitError}
              </div>
            )}
          </>
        )}
      </div>

      {/* Save bar */}
      <div className="fixed bottom-0 inset-x-0 px-5 pb-6 pt-4 bg-gradient-to-t from-background to-transparent">
        <motion.button
          whileTap={{ scale: canSave ? 0.97 : 1 }}
          onClick={onSave}
          disabled={!canSave}
          className={`w-full py-4 rounded-2xl text-base font-bold flex items-center justify-center gap-2 transition-colors ${
            canSave
              ? "bg-primary text-white shadow-lg shadow-primary/30"
              : "bg-white/8 text-white/30"
          }`}
        >
          {isSubmitting ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              {STR.saving}
            </>
          ) : (
            t("save")
          )}
        </motion.button>
      </div>
    </div>
  );
}

// ── Tiny field wrapper for consistent styling. ──
function Field({
  icon,
  label,
  right,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white/5 border border-white/10 px-4 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-white/40">{label}</span>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}
