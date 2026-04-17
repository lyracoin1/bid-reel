/**
 * native-fcm.ts — Firebase Cloud Messaging for Capacitor native (Android/iOS).
 *
 * This module is only active when the app runs on a native platform
 * (Capacitor.isNativePlatform() === true). On the web it is a no-op.
 *
 * Uses @capacitor-firebase/messaging which wraps the native Firebase Android
 * SDK. The native SDK communicates directly with FCM without a service worker.
 *
 * Prerequisites (Android):
 *   - google-services.json placed in android/app/
 *   - @capacitor-firebase/messaging installed (already done)
 *   - npx cap sync android run to register the plugin in the native project
 *
 * Web FCM (service worker path) is handled separately in use-fcm-token.ts
 * and uses the Firebase Web SDK.
 */

import { Capacitor } from "@capacitor/core";
import { FirebaseMessaging } from "@capacitor-firebase/messaging";

export interface NativeFcmCallbacks {
  /** Called immediately after token is obtained and whenever it refreshes. */
  onToken: (token: string) => Promise<void> | void;
  /** Called when a push notification arrives while the app is in the foreground. */
  onForegroundNotification: (opts: {
    title: string;
    body: string;
    data: Record<string, string>;
  }) => void;
  /** Called when the user taps a push notification (from background or killed state). */
  onNotificationTap: (data: Record<string, string>) => void;
}

/** Prevent double-initialization if the hook re-fires. */
let _initialized = false;

/**
 * Initialize native FCM on Android/iOS.
 *
 * Steps performed:
 *  1. Check platform — exits immediately on web.
 *  2. Request POST_NOTIFICATIONS permission (Android 13+, iOS always prompted).
 *  3. Retrieve the native FCM registration token.
 *  4. Register listeners for token refresh, foreground messages, and taps.
 *
 * Non-throwing — all errors are caught and logged. The app continues normally
 * even if google-services.json is absent or FCM cannot be reached.
 */
export async function initNativeFcm(callbacks: NativeFcmCallbacks): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (_initialized) return;
  _initialized = true;

  try {
    // ── 1. Permission ────────────────────────────────────────────────────────
    const { receive } = await FirebaseMessaging.requestPermissions();
    if (receive !== "granted") {
      console.info("[native-fcm] Notification permission not granted:", receive);
      return;
    }

    // ── 1b. Notification channel (Android 8+) ────────────────────────────────
    // The server's FCM payload sets `channelId: "bidreel_default"` and the
    // AndroidManifest pins the same id as `default_notification_channel_id`.
    // BUT a referenced channel only WORKS if it has been created on the
    // device via NotificationManager.createNotificationChannel(). Without
    // this call, Samsung / Xiaomi / OnePlus ROMs silently drop the push or
    // bury it under a muted "Miscellaneous" fallback channel — which is
    // exactly the "no entry in the notification shade" symptom we hit.
    //
    // Importance 5 = IMPORTANCE_HIGH → heads-up banner + sound + vibration.
    // Safe to call repeatedly: createChannel is idempotent on the platform
    // side (matching id = no-op).
    if (Capacitor.getPlatform() === "android") {
      try {
        await FirebaseMessaging.createChannel({
          id: "bidreel_default",
          name: "BidReel notifications",
          description: "Bids, outbids, follows, won auctions, and account alerts.",
          importance: 5,                 // HIGH — heads-up + sound + vibrate
          visibility: 1,                 // VISIBILITY_PUBLIC — show on lockscreen
          sound: "default",
          vibration: true,
          lights: true,
          lightColor: "#6D28D9",
        });
        console.info("[native-fcm] Channel 'bidreel_default' ensured");
      } catch (chErr) {
        // Plugin throws if the channel already exists with different settings —
        // that's fine, log and carry on. Real failures (no Notif Manager etc.)
        // shouldn't block token registration either.
        console.warn("[native-fcm] createChannel non-fatal error:", chErr);
      }
    }

    // ── 2. Token ─────────────────────────────────────────────────────────────
    const { token } = await FirebaseMessaging.getToken();
    if (token) {
      console.info("[native-fcm] Token obtained:", token.slice(0, 24) + "…");
      await callbacks.onToken(token);
    } else {
      console.warn(
        "[native-fcm] No token returned — ensure google-services.json is present in android/app/"
      );
    }

    // ── 3. Token refresh ─────────────────────────────────────────────────────
    await FirebaseMessaging.addListener("tokenReceived", async ({ token: refreshed }) => {
      if (!refreshed) return;
      console.info("[native-fcm] Token refreshed:", refreshed.slice(0, 24) + "…");
      await callbacks.onToken(refreshed);
    });

    // ── 4. Foreground notifications ──────────────────────────────────────────
    // On Android, FCM suppresses the system notification tray entry when the
    // app is in the foreground. We surface it as an in-app banner instead.
    await FirebaseMessaging.addListener("notificationReceived", ({ notification }) => {
      const title = notification.title ?? "BidReel";
      const body = notification.body ?? "";
      const data = (notification.data ?? {}) as Record<string, string>;
      console.debug("[native-fcm] Foreground notification:", { title, body, data });
      callbacks.onForegroundNotification({ title, body, data });
    });

    // ── 5. Notification tap (background / killed) ────────────────────────────
    // Fires when the user taps a notification while the app was backgrounded
    // or completely closed. data.auctionId / data.type drive navigation.
    await FirebaseMessaging.addListener("notificationActionPerformed", ({ notification }) => {
      const data = (notification.data ?? {}) as Record<string, string>;
      console.debug("[native-fcm] Notification tapped:", data);
      callbacks.onNotificationTap(data);
    });

    console.info("[native-fcm] Initialized — all listeners registered");
  } catch (err) {
    // A missing google-services.json or misconfigured Firebase project will
    // throw here — caught so the app continues loading normally.
    console.error("[native-fcm] Initialization error (google-services.json present?):", err);
    _initialized = false;
  }
}

/**
 * Delete the native FCM token and remove all listeners.
 * Call this on logout so the device stops receiving push notifications.
 * Non-throwing.
 */
export async function deleteNativeFcmToken(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await FirebaseMessaging.deleteToken();
    await FirebaseMessaging.removeAllListeners();
    _initialized = false;
    console.info("[native-fcm] Token deleted, listeners removed");
  } catch (err) {
    console.warn("[native-fcm] Failed to delete token:", err);
  }
}
