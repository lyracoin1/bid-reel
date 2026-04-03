import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration for BidReel Android app.
 *
 * Routing decision: Path-based routing (no hash routing change needed).
 * With androidScheme: "https", Capacitor serves assets from https://localhost
 * in the Android WebView. Wouter's push-state routing works natively in this
 * context — no code changes required to the router.
 *
 * Build process:
 *   1. Set production env vars (SUPABASE_URL, SUPABASE_ANON_KEY, VITE_FIREBASE_*)
 *   2. pnpm --filter @workspace/bidreel-web run build
 *   3. npx cap sync android
 *   4. npx cap open android  (opens Android Studio)
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
     * androidScheme: "https" makes the WebView serve from https://localhost
     * instead of file://. This enables:
     *   - Path-based routing (no hash routing change needed)
     *   - localStorage + sessionStorage work correctly
     *   - Same-origin fetch requests are treated as secure
     *   - Firebase Messaging service worker registration succeeds
     */
    androidScheme: "https",

    /**
     * Allow navigation to external domains opened from within the app.
     * wa.me and api.whatsapp.com are opened via the system browser
     * automatically by Capacitor's link handling.
     */
    allowNavigation: ["*.supabase.co"],
  },

  plugins: {
    /**
     * SplashScreen — disabled here since the web app renders its own
     * splash screen (splash.tsx). Set launchShowDuration to 0 so the
     * native splash dismisses immediately and the web splash takes over.
     * Requires: @capacitor/splash-screen installed
     */
    SplashScreen: {
      launchShowDuration: 0,
      backgroundColor: "#030305",
      showSpinner: false,
    },

    /**
     * PushNotifications — handled via @capacitor-firebase/messaging.
     * presentationOptions controls how FCM notifications appear when
     * the app is in the foreground on iOS (Android ignores this).
     */
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },

  android: {
    /**
     * Build-time Android settings.
     * minWebViewVersion: 60 — ensures modern JS/CSS support
     * loggingBehavior: "none" for release, "debug" for local dev
     */
    minWebViewVersion: 60,
  },
};

export default config;
