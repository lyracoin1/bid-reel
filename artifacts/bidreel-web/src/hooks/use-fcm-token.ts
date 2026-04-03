/**
 * useFcmToken — Initializes push notification token registration.
 *
 * Platform routing:
 *   • Android/iOS (Capacitor native): delegates to native-fcm.ts which uses
 *     @capacitor-firebase/messaging and the native Firebase Android SDK.
 *     No service worker is involved. Requires google-services.json in android/app/.
 *
 *   • Web browser: uses the Firebase Web SDK + service worker
 *     (firebase-messaging-sw.js). A no-op when VITE_FIREBASE_* env vars are absent.
 *
 * Foreground notifications surface as in-app banners via NotificationBannerContext.
 * Notification taps navigate to the relevant auction or profile page via Wouter.
 *
 * Usage: mount once at the App root. The hook is safe to mount even when Firebase
 * is not configured — it exits gracefully in both paths.
 */

import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Capacitor } from "@capacitor/core";
import { getToken } from "firebase/messaging";
import {
  isFirebaseConfigured,
  getFirebaseMessaging,
  vapidKey,
  firebaseConfig,
} from "@/lib/firebase";
import { registerDeviceToken } from "@/lib/api-client";
import { initNativeFcm } from "@/lib/native-fcm";
import { useNotificationBanner } from "@/contexts/NotificationBannerContext";

export function useFcmToken(): void {
  const [, navigate] = useLocation();
  const { showBanner } = useNotificationBanner();

  // Stable refs so the one-time useEffect always calls the latest callbacks
  // without re-running the effect when they change.
  const navigateRef = useRef(navigate);
  const showBannerRef = useRef(showBanner);

  useEffect(() => { navigateRef.current = navigate; }, [navigate]);
  useEffect(() => { showBannerRef.current = showBanner; }, [showBanner]);

  useEffect(() => {
    // ── Native path (Android / iOS) ─────────────────────────────────────────
    if (Capacitor.isNativePlatform()) {
      void initNativeFcm({
        onToken: async (token) => {
          await registerDeviceToken(token, "android");
        },
        onForegroundNotification: ({ title, body }) => {
          showBannerRef.current({ name: title, message: body });
        },
        onNotificationTap: (data) => {
          if (data["auctionId"]) {
            navigateRef.current(`/auction/${data["auctionId"]}`);
          } else if (data["actorId"]) {
            navigateRef.current(`/users/${data["actorId"]}`);
          } else {
            navigateRef.current("/feed");
          }
        },
      });
      return;
    }

    // ── Web browser path ────────────────────────────────────────────────────
    if (!isFirebaseConfigured) {
      console.info(
        "[fcm] Firebase not configured — set VITE_FIREBASE_* env vars to enable push notifications"
      );
      return;
    }

    if (!("Notification" in window)) {
      console.info("[fcm] Notifications not supported in this browser");
      return;
    }

    void initWebFcm();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

async function initWebFcm(): Promise<void> {
  try {
    // 1. Request notification permission
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.info("[fcm] Notification permission denied");
      return;
    }

    // 2. Register the service worker
    if (!("serviceWorker" in navigator)) {
      console.info("[fcm] Service workers not supported");
      return;
    }

    const swReg = await navigator.serviceWorker.register(
      "/firebase-messaging-sw.js",
      { scope: "/" }
    );

    // Wait for the SW to activate
    await navigator.serviceWorker.ready;

    // 3. Send Firebase config to the service worker so it can initialise FCM
    const activeSw = swReg.active ?? swReg.installing ?? swReg.waiting;
    if (activeSw) {
      activeSw.postMessage({ type: "FIREBASE_SW_CONFIG", config: firebaseConfig });
    }

    // 4. Get FCM registration token
    const messaging = getFirebaseMessaging();
    if (!messaging) return;

    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: swReg,
    });

    if (!token) {
      console.warn("[fcm] No registration token received");
      return;
    }

    console.info("[fcm] Token obtained, registering with server…");

    // 5. Register token with the backend (platform: "web")
    await registerDeviceToken(token, "web");
    console.info("[fcm] Device token registered successfully");
  } catch (err) {
    console.error("[fcm] Initialisation error:", err);
  }
}
