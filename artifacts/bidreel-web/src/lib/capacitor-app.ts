import { Capacitor, registerPlugin } from "@capacitor/core";
import { Browser } from "@capacitor/browser";

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
 * Opens a URL in a Chrome Custom Tab (Android) / SFSafariViewController (iOS).
 *
 * Unlike window.open('_blank'), this is guaranteed to open in the system
 * browser process — not an in-app WebView — so the custom-scheme deep-link
 * intent correctly targets the app's MainActivity and Capacitor can fire
 * appUrlOpen on the JS bridge when the OAuth callback arrives.
 */
export async function openInBrowser(url: string): Promise<void> {
  await Browser.open({ url });
}

/**
 * Closes the Chrome Custom Tab opened by openInBrowser().
 * Call this at the start of the appUrlOpen handler so the Custom Tab
 * is dismissed before the app processes the OAuth callback.
 */
export async function closeBrowser(): Promise<void> {
  try {
    await Browser.close();
  } catch {
    // Browser may already be closed — safe to ignore.
  }
}

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
