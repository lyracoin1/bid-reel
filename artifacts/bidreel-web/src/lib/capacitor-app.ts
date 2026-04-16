import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";

/**
 * Re-export the official @capacitor/app plugin instance.
 * Using the package directly (rather than registerPlugin('App')) ensures that
 * the JS→native event bridge is initialised exactly as Capacitor intends,
 * including the internal queuing that retains events while the WebView is paused
 * (e.g. while a Chrome Custom Tab is open over the top of the activity).
 */
export { App as CapApp };

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
