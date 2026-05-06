import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { getToken, API_BASE } from "@/lib/api-client";
import { CapApp, isNative, openInBrowser } from "@/lib/capacitor-app";
import { useLang } from "@/contexts/LanguageContext";

// ── Types ────────────────────────────────────────────────────────────────────

interface VersionResponse {
  minVersionCode: number;
  latestVersionCode: number;
  currentVersionCode: number;   // kept for backward compat
  updateRequired: boolean;
  updateMessageEn: string;
  updateMessageAr: string;
  playStoreUrl: string;
}

type UpdateCheckResult =
  | { status: "ok" }
  | { status: "mandatory"; playStoreUrl: string; messageEn: string; messageAr: string }
  | { status: "optional";  playStoreUrl: string; messageEn: string; messageAr: string };

interface UpdateInfo {
  playStoreUrl: string;
  messageEn: string;
  messageAr: string;
}

// ── Update check ─────────────────────────────────────────────────────────────

/**
 * Compares the installed versionCode against the server's version config.
 *
 * Only runs on native (Capacitor Android). On web it is always a no-op so the
 * browser preview is never blocked by a version gate.
 *
 * mandatory  →  updateRequired flag OR installedCode < minVersionCode
 * optional   →  installedCode < latestVersionCode  (and not mandatory)
 * ok         →  up-to-date, check failed, or running on web
 */
async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (!isNative()) return { status: "ok" };

  try {
    const info         = await CapApp.getInfo();
    const installedCode = parseInt(info.build, 10);

    if (isNaN(installedCode)) {
      console.warn("[update-check] Could not parse build number:", info.build);
      return { status: "ok" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/version`, {
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      console.warn("[update-check] /version returned", res.status, "— skipping check");
      return { status: "ok" };
    }

    const data = (await res.json()) as VersionResponse;
    const {
      minVersionCode,
      latestVersionCode,
      updateRequired,
      updateMessageEn,
      updateMessageAr,
      playStoreUrl,
    } = data;

    console.log(
      `[update-check] installed=${installedCode}  min=${minVersionCode}  latest=${latestVersionCode}  forceRequired=${updateRequired}`,
    );

    const payload = {
      playStoreUrl,
      messageEn: updateMessageEn ?? "A new version of BidReel is available.",
      messageAr: updateMessageAr ?? "يتوفر إصدار جديد من BidReel.",
    };

    // Mandatory: server forced it, or the build is below the minimum gate.
    if (updateRequired || installedCode < minVersionCode) {
      return { status: "mandatory", ...payload };
    }

    // Optional: a newer build exists but the user's version still works.
    if (installedCode < latestVersionCode) {
      return { status: "optional", ...payload };
    }

    return { status: "ok" };
  } catch (err) {
    console.warn("[update-check] Check failed (non-blocking):", err);
    return { status: "ok" };
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

type SplashStatus =
  | "checking"          // version check in progress
  | "update-mandatory"  // user must update before continuing
  | "update-optional"   // newer version available; user can dismiss
  | "authenticating";   // version ok — checking auth token

export default function Splash() {
  const [, setLocation] = useLocation();
  const { lang, dir, t } = useLang();
  const isAr = lang === "ar";

  const [status, setStatus]         = useState<SplashStatus>("checking");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [opening, setOpening]       = useState(false);

  // ── Auth check (runs after version check passes or user taps "Later") ──────
  const runAuthCheck = useCallback(async () => {
    setStatus("authenticating");
    const token = await getToken();
    if (!token) {
      setLocation("/login", { replace: true });
      return;
    }
    setLocation("/feed", { replace: true });
  }, [setLocation]);

  // ── Start-up sequence ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const result = await checkForUpdate();
      if (cancelled) return;

      if (result.status === "mandatory") {
        setUpdateInfo({
          playStoreUrl: result.playStoreUrl,
          messageEn:    result.messageEn,
          messageAr:    result.messageAr,
        });
        setStatus("update-mandatory");
        // Do NOT navigate — keep the mandatory screen visible.
        return;
      }

      if (result.status === "optional") {
        setUpdateInfo({
          playStoreUrl: result.playStoreUrl,
          messageEn:    result.messageEn,
          messageAr:    result.messageAr,
        });
        setStatus("update-optional");
        // Auth check runs when the user taps "Later" (or "Update").
        return;
      }

      // No update needed — proceed straight to auth.
      await runAuthCheck();
    };

    void run();
    return () => { cancelled = true; };
  }, [runAuthCheck]);

  // ── Open Play Store ────────────────────────────────────────────────────────
  const handleUpdate = async () => {
    if (!updateInfo || opening) return;
    setOpening(true);
    try {
      await openInBrowser(updateInfo.playStoreUrl);
    } finally {
      // Re-enable the button — user may have dismissed Play Store without
      // installing (especially for optional updates).
      setOpening(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      dir={dir}
      className="relative w-full h-[100dvh] bg-background flex flex-col items-center justify-center overflow-hidden"
    >
      {/* ── Background ──────────────────────────────────────────────────── */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-[100px] mix-blend-screen animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[30rem] h-[30rem] bg-indigo-600/10 rounded-full blur-[120px] mix-blend-screen" />
        <img
          src={`${import.meta.env.BASE_URL}images/splash-bg.jpg`}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-overlay"
        />
      </div>

      {/* ── Logo + wordmark (always visible) ────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="mb-8"
        >
          <img
            src={`${import.meta.env.BASE_URL}images/logo-icon.png`}
            alt="BidReel Logo"
            className="w-32 h-32 rounded-3xl box-glow"
          />
        </motion.div>

        <motion.h1
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="text-5xl font-display font-bold text-white tracking-tight mb-4 text-glow"
        >
          BidReel
        </motion.h1>

        {/* Tagline — hidden during update screens */}
        <AnimatePresence>
          {(status === "checking" || status === "authenticating") && (
            <motion.p
              key="tagline"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="text-lg text-muted-foreground font-medium text-center max-w-[250px]"
            >
              {t("splash_tagline")}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* ── Mandatory update — full-screen blocker ───────────────────────── */}
      <AnimatePresence>
        {status === "update-mandatory" && updateInfo && (
          <motion.div
            key="mandatory"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center px-6 bg-background/90 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.3 }}
              className="w-full max-w-sm flex flex-col items-center gap-5 text-center"
            >
              {/* Icon */}
              <div className="w-20 h-20 rounded-3xl bg-primary/15 border border-primary/30 flex items-center justify-center">
                <img
                  src={`${import.meta.env.BASE_URL}images/logo-icon.png`}
                  alt="BidReel"
                  className="w-12 h-12 rounded-xl"
                />
              </div>

              {/* Bilingual heading */}
              <div className="flex flex-col gap-1">
                <h2 className="text-2xl font-display font-bold text-white">
                  {isAr ? "تحديث إجباري" : "Update Required"}
                </h2>
                <p className="text-sm font-medium text-muted-foreground">
                  {isAr ? "Update Required" : "تحديث إجباري"}
                </p>
              </div>

              {/* Message */}
              <p className="text-sm text-muted-foreground leading-relaxed max-w-[280px]">
                {isAr ? updateInfo.messageAr : updateInfo.messageEn}
              </p>

              {/* Update button */}
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={handleUpdate}
                disabled={opening}
                className="w-full max-w-[240px] py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-base shadow-lg shadow-primary/30 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {opening ? (
                  <span className="opacity-70">
                    {isAr ? "جارٍ الفتح…" : "Opening…"}
                  </span>
                ) : (
                  <>
                    <span>{isAr ? "تحديث" : "Update"}</span>
                    <span className="opacity-50 text-sm font-normal">
                      {isAr ? "· Update" : "· تحديث"}
                    </span>
                  </>
                )}
              </motion.button>

              <p className="text-xs text-muted-foreground/40 mt-1">
                {isAr
                  ? "يجب التحديث للمتابعة"
                  : "You must update to continue"}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Optional update — bottom sheet over splash ───────────────────── */}
      <AnimatePresence>
        {status === "update-optional" && updateInfo && (
          <motion.div
            key="optional"
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="absolute bottom-0 inset-x-0 z-20 pb-safe"
          >
            <div className="mx-4 mb-6 bg-card border border-border rounded-3xl p-6 shadow-2xl">

              {/* Handle */}
              <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-5" />

              {/* Header row */}
              <div className="flex items-start gap-3 mb-3">
                <div className="w-11 h-11 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
                  <img
                    src={`${import.meta.env.BASE_URL}images/logo-icon.png`}
                    alt="BidReel"
                    className="w-7 h-7 rounded-lg"
                  />
                </div>
                <div>
                  <p className="text-base font-bold text-white leading-snug">
                    {isAr ? "يتوفر تحديث جديد" : "A new version is available"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {isAr ? "A new version is available" : "يتوفر تحديث جديد"}
                  </p>
                </div>
              </div>

              {/* Message */}
              <p className="text-sm text-muted-foreground leading-relaxed mb-5">
                {isAr ? updateInfo.messageAr : updateInfo.messageEn}
              </p>

              {/* Buttons */}
              <div className="flex flex-col gap-2.5">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleUpdate}
                  disabled={opening}
                  className="w-full py-3.5 rounded-2xl bg-primary text-primary-foreground font-bold text-base shadow-lg shadow-primary/25 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {opening ? (
                    <span className="opacity-70">
                      {isAr ? "جارٍ الفتح…" : "Opening…"}
                    </span>
                  ) : (
                    <>
                      <span>{isAr ? "تحديث" : "Update"}</span>
                      <span className="opacity-50 text-sm font-normal">
                        {isAr ? "· Update" : "· تحديث"}
                      </span>
                    </>
                  )}
                </motion.button>

                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={runAuthCheck}
                  className="w-full py-3 rounded-2xl bg-white/6 border border-white/8 text-white/70 font-medium text-sm hover:text-white transition-colors"
                >
                  {isAr ? "لاحقاً · Later" : "Later · لاحقاً"}
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Animated loading dots (checking / authenticating only) ───────── */}
      <AnimatePresence>
        {(status === "checking" || status === "authenticating") && (
          <motion.div
            key="dots"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 1.2 }}
            className="absolute bottom-20 flex gap-2"
          >
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                animate={{
                  scale:   [1, 1.5, 1],
                  opacity: [0.3, 1, 0.3],
                }}
                transition={{
                  duration: 1,
                  repeat: Infinity,
                  delay: i * 0.2,
                }}
                className="w-2.5 h-2.5 rounded-full bg-primary"
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
