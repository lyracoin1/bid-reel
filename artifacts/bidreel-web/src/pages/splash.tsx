import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { getToken, API_BASE } from "@/lib/api-client";
import { CapApp, isNative, openInBrowser } from "@/lib/capacitor-app";

// ── Types ────────────────────────────────────────────────────────────────────

interface VersionResponse {
  minVersionCode: number;
  currentVersionCode: number;
  playStoreUrl: string;
}

// ── Update check ─────────────────────────────────────────────────────────────

/**
 * Checks whether the installed build needs a mandatory update.
 *
 * Only runs on native (Capacitor Android) — on web the version check is a
 * no-op so the browser preview is never blocked by a version gate.
 *
 * Returns:
 *   { needsUpdate: true,  playStoreUrl }  — versionCode < minVersionCode
 *   { needsUpdate: false }               — up-to-date or check failed/skipped
 */
async function checkForUpdate(): Promise<
  { needsUpdate: true; playStoreUrl: string } | { needsUpdate: false }
> {
  if (!isNative()) return { needsUpdate: false };

  try {
    // Get the installed versionCode from the native layer.
    const info = await CapApp.getInfo();
    // Capacitor exposes versionCode as `build` (string on Android).
    const installedCode = parseInt(info.build, 10);

    if (isNaN(installedCode)) {
      console.warn("[update-check] Could not parse build number:", info.build);
      return { needsUpdate: false };
    }

    // Ask our server for the minimum acceptable versionCode.
    // Short timeout (5 s) — on a slow connection we must not block the user
    // indefinitely; if the server is unreachable we let them in as-is.
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
      return { needsUpdate: false };
    }

    const data = (await res.json()) as VersionResponse;
    const { minVersionCode, playStoreUrl } = data;

    console.log(
      `[update-check] installed=${installedCode} minRequired=${minVersionCode}`,
    );

    if (installedCode < minVersionCode) {
      return { needsUpdate: true, playStoreUrl };
    }

    return { needsUpdate: false };
  } catch (err) {
    // Network failure, abort, or unexpected error — let the user continue.
    console.warn("[update-check] Check failed (non-blocking):", err);
    return { needsUpdate: false };
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

type SplashStatus =
  | "checking"          // version check in progress
  | "update-required"   // redirecting to Play Store
  | "authenticating";   // version ok — checking auth token

export default function Splash() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<SplashStatus>("checking");

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // ── Step 1: version check (native only) ───────────────────────────────
      const updateResult = await checkForUpdate();

      if (cancelled) return;

      if (updateResult.needsUpdate) {
        setStatus("update-required");
        // Open Play Store in the system browser.
        await openInBrowser(updateResult.playStoreUrl);
        // Keep the "Update Required" screen visible — do NOT navigate further.
        // The OS will bring the app back when the user returns, at which point
        // they'll have updated (or they dismissed Play Store). Either way the
        // splash re-runs on next cold start.
        return;
      }

      // ── Step 2: auth check ────────────────────────────────────────────────
      setStatus("authenticating");

      const token = await getToken();
      if (cancelled) return;

      if (!token) {
        // REPLACE — splash is a one-shot redirect; back from /login must NOT
        // return to the splash screen.
        setLocation("/login", { replace: true });
        return;
      }
      // Authenticated users always go to /feed.
      setLocation("/feed", { replace: true });
    };

    void run();
    return () => { cancelled = true; };
  }, [setLocation]);

  return (
    <div className="relative w-full h-[100dvh] bg-background flex flex-col items-center justify-center overflow-hidden">

      {/* Abstract background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-[100px] mix-blend-screen animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[30rem] h-[30rem] bg-indigo-600/10 rounded-full blur-[120px] mix-blend-screen" />
        <img
          src={`${import.meta.env.BASE_URL}images/splash-bg.jpg`}
          alt="Atmosphere"
          className="absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-overlay"
        />
      </div>

      {/* Content */}
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

        {status === "update-required" ? (
          /* Update required overlay */
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center gap-3 mt-2 px-6 text-center"
          >
            <p className="text-lg font-semibold text-white">
              Update Required
            </p>
            <p className="text-sm text-muted-foreground max-w-[260px]">
              A new version of BidReel is available. Please update to continue.
            </p>
            <motion.div
              className="mt-2 px-6 py-2.5 rounded-full bg-primary text-white text-sm font-semibold"
              animate={{ scale: [1, 1.04, 1] }}
              transition={{ duration: 1.6, repeat: Infinity }}
            >
              Opening Google Play…
            </motion.div>
          </motion.div>
        ) : (
          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="text-lg text-muted-foreground font-medium text-center max-w-[250px]"
          >
            Bid on anything.<br />Watch it happen.
          </motion.p>
        )}
      </div>

      {/* Loading dots — hidden when update screen is shown */}
      {status !== "update-required" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
          className="absolute bottom-20 flex gap-2"
        >
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              animate={{
                scale: [1, 1.5, 1],
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
    </div>
  );
}
