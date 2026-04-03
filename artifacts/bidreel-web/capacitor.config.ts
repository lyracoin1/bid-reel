import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration for BidReel Android app.
 *
 * ─── Routing ────────────────────────────────────────────────────────────────
 * Path-based routing (Wouter) works unchanged inside the Android WebView.
 * With androidScheme: "https", Capacitor serves assets from https://localhost,
 * a proper HTTP origin that supports History API push-state. No hash routing
 * migration is needed.
 *
 * ─── API connectivity ────────────────────────────────────────────────────────
 * The web app resolves API calls as relative paths (/api/...) which the Replit
 * proxy routes to the Express server on the same domain.  Inside the Android
 * WebView there is no such proxy, so two modes are supported:
 *
 *  MODE A — Live Reload (first debug run / active development)
 *    Set CAPACITOR_LIVE_RELOAD_URL before running `cap sync android`.
 *    The WebView loads your Replit dev server directly, so all /api/* requests
 *    go through Replit's routing and work exactly like the web version.
 *    Example:
 *      CAPACITOR_LIVE_RELOAD_URL=https://<your-repl>.riker.replit.dev \
 *        npx cap sync android
 *
 *  MODE B — Standalone APK (production / release builds)
 *    Set VITE_API_URL when building and leave CAPACITOR_LIVE_RELOAD_URL unset.
 *    The web bundle is self-contained; all API calls go directly to the
 *    deployed API server URL baked in at build time.
 *    Example:
 *      VITE_API_URL=https://<deployed>.replit.app/api \
 *        pnpm --filter @workspace/bidreel-web run android:build
 *
 * ─── Build process (MODE B) ──────────────────────────────────────────────────
 *   1. Set VITE_API_URL to your deployed API server URL
 *   2. pnpm --filter @workspace/bidreel-web run android:build
 *   3. npx cap open android   (opens Android Studio)
 *   4. Build > Run in Android Studio
 */

/** When set, the WebView loads from this URL instead of bundled assets. */
const liveReloadUrl = process.env.CAPACITOR_LIVE_RELOAD_URL;

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
     * androidScheme: "https" makes the WebView serve from https://localhost
     * instead of file://. This enables:
     *   - Path-based routing (no hash routing change needed)
     *   - localStorage + sessionStorage work correctly
     *   - Same-origin fetch requests are treated as secure
     */
    androidScheme: "https",

    /**
     * allowNavigation: domains the WebView itself may navigate to.
     * Supabase is listed so that OAuth redirects and asset URLs work.
     * External links (wa.me, etc.) are always opened in the system browser.
     */
    allowNavigation: ["*.supabase.co"],

    /**
     * Live reload URL — only populated when CAPACITOR_LIVE_RELOAD_URL is set.
     * When present, the WebView loads from the specified dev server instead of
     * the bundled web assets.  Remove (or leave unset) for release builds.
     */
    ...(liveReloadUrl ? { url: liveReloadUrl } : {}),
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
