import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration for BidReel Android app.
 *
 * ─── How the Android app loads ───────────────────────────────────────────────
 * The app uses BUNDLED web assets served by the Capacitor bridge from the
 * origin https://localhost (this is normal and expected Capacitor behaviour —
 * "localhost" here is the internal bridge, not a real server).
 *
 * With androidScheme: "https" the WebView origin is https://localhost, which
 * correctly supports:
 *   - History-API push-state routing (Wouter)
 *   - localStorage / sessionStorage
 *   - Same-origin fetch semantics treated as secure
 *
 * ─── API connectivity ────────────────────────────────────────────────────────
 * Because the origin is https://localhost, relative paths like /api/... would
 * resolve to https://localhost/api/... and fail.  This is solved by baking
 * VITE_API_URL into the bundle at build time.  api-client.ts already reads
 * that variable and uses it (instead of a relative path) whenever
 * Capacitor.isNativePlatform() is true.
 *
 * Use the android:build npm script — it sets VITE_API_URL automatically:
 *   pnpm --filter @workspace/bidreel-web run android:build
 *
 * ─── Build process ───────────────────────────────────────────────────────────
 *   1. pnpm --filter @workspace/bidreel-web run android:build
 *      (builds web bundle with VITE_API_URL set, then runs cap sync)
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
    /**
     * androidScheme: "https" serves bundled assets from https://localhost.
     * This is the standard Capacitor pattern — localhost here is the Capacitor
     * bridge, not a network server.  API calls reach production via the
     * VITE_API_URL that is baked into the bundle at build time.
     */
    androidScheme: "https",

    /**
     * allowNavigation: domains the WebView may navigate to.
     * Supabase is listed so OAuth redirects and asset URLs work correctly.
     */
    allowNavigation: ["*.supabase.co"],
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
