import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration for BidReel Android app — Production.
 *
 * ─── Production mode ─────────────────────────────────────────────────────────
 * server.url is set to the production domain. The Android WebView loads the
 * live site at https://www.bid-reel.com instead of bundled local assets.
 * All API calls resolve against the production domain — no localhost involved.
 *
 * ─── Build process ───────────────────────────────────────────────────────────
 *   1. npx cap sync android   (from artifacts/bidreel-web/)
 *   2. npx cap open android   (opens Android Studio)
 *   3. Build > Generate Signed Bundle / APK in Android Studio
 */

const config: CapacitorConfig = {
  appId: "com.bidreel.app",
  appName: "BidReel",

  /**
   * webDir is relative to this config file's location (artifacts/bidreel-web/).
   * Matches the Vite build output: build.outDir = "dist/public"
   */
  webDir: "dist/public",

  server: {
    url: "https://www.bid-reel.com",
    cleartext: false,
  },

  plugins: {
    /**
     * SplashScreen — the web app renders its own splash screen (splash.tsx).
     * Set launchShowDuration to 0 so the native splash dismisses immediately
     * and the web splash takes over.
     */
    SplashScreen: {
      launchShowDuration: 0,
      backgroundColor: "#030305",
      showSpinner: false,
    },
  },

  android: {
    /**
     * minWebViewVersion: 60 — ensures modern JS/CSS support (Android 7+).
     */
    minWebViewVersion: 60,
  },
};

export default config;
