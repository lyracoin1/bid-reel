import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Thin TypeScript interface for the built-in Capacitor App plugin.
 *
 * The native implementation ships inside @capacitor/android — no extra npm
 * package is needed. `registerPlugin('App')` retrieves the plugin by name
 * from the native bridge at runtime (web stub on non-native platforms).
 */
interface AppPlugin {
  addListener(
    event: "appUrlOpen",
    handler: (data: { url: string }) => void,
  ): Promise<{ remove: () => void }>;
  getLaunchUrl(): Promise<{ url: string | null }>;
}

export const CapApp = registerPlugin<AppPlugin>("App");

/**
 * Returns true when the JS is running inside a Capacitor native wrapper
 * (Android APK / iOS IPA).  Always false on the plain web.
 */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * The custom URL scheme registered in AndroidManifest.xml.
 * OAuth redirectTo must match exactly — Supabase will redirect here after
 * Google auth, and Android will route the intent back into the app.
 */
export const OAUTH_SCHEME = "com.bidreel.app";
export const OAUTH_REDIRECT_URL = `${OAUTH_SCHEME}://auth/callback`;
