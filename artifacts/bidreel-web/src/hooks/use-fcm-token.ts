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
import { supabase } from "@/lib/supabase";

// Module-level cache so we can re-send the same FCM token to the backend on
// SIGNED_IN without re-running the (heavy) native plugin init.
let lastFcmToken: string | null = null;
let lastRegisteredForUserId: string | null = null;

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
    // Helper: actually call the backend, but ONLY if we have a session.
    // No-op + log otherwise (the auth listener below will retry on SIGNED_IN).
    async function tryRegister(token: string, platform: "android" | "ios" | "web", trigger: string) {
      lastFcmToken = token;
      const session = supabase ? (await supabase.auth.getSession()).data.session : null;
      if (!session?.access_token) {
        console.info(
          "[fcm] token received but NO auth session yet — deferring backend register until SIGNED_IN",
          { trigger, tokenPrefix: token.slice(0, 24) + "…" },
        );
        return;
      }
      const userId = session.user.id;
      console.info("[fcm] registering token with backend", {
        trigger,
        userId,
        platform,
        tokenPrefix: token.slice(0, 24) + "…",
      });
      const ok = await registerDeviceToken(token, platform);
      if (ok) {
        lastRegisteredForUserId = userId;
        console.info("[fcm] backend register OK", { userId, platform });
      } else {
        console.warn("[fcm] backend register FAILED — will retry on next auth/token event", { userId });
      }
    }

    // ── Native path (Android / iOS) ─────────────────────────────────────────
    if (Capacitor.isNativePlatform()) {
      const platform: "android" | "ios" = Capacitor.getPlatform() === "ios" ? "ios" : "android";
      void initNativeFcm({
        onToken: async (token) => {
          await tryRegister(token, platform, "onToken");
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

      // Retry registration whenever auth state changes — covers the common
      // case where FCM init runs at app launch (cold start, no session) and
      // the user signs in seconds later. Without this listener the device
      // token would never reach the backend on the first install.
      let unsubAuth: (() => void) | undefined;
      if (supabase) {
        const { data } = supabase.auth.onAuthStateChange((event, session) => {
          if (event === "SIGNED_OUT") {
            lastRegisteredForUserId = null;
            return;
          }
          if (!session?.user?.id || !lastFcmToken) return;
          if (lastRegisteredForUserId === session.user.id) return; // already done
          console.info("[fcm] auth state change — retrying device register", { event, userId: session.user.id });
          void tryRegister(lastFcmToken, platform, `auth:${event}`);
        });
        unsubAuth = () => data.subscription.unsubscribe();
      }
      return () => { if (unsubAuth) unsubAuth(); };
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

    void initWebFcm((token, _platform, trigger) => tryRegister(token, "web", trigger));

    // Same SIGNED_IN retry on web.
    let unsubAuth: (() => void) | undefined;
    if (supabase) {
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT") {
          lastRegisteredForUserId = null;
          return;
        }
        if (!session?.user?.id || !lastFcmToken) return;
        if (lastRegisteredForUserId === session.user.id) return;
        console.info("[fcm] auth state change (web) — retrying device register", { event, userId: session.user.id });
        void tryRegister(lastFcmToken, "web", `auth:${event}`);
      });
      unsubAuth = () => data.subscription.unsubscribe();
    }
    return () => { if (unsubAuth) unsubAuth(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

async function initWebFcm(
  onToken: (token: string, platform: "web", trigger: string) => Promise<void> | void,
): Promise<void> {
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
