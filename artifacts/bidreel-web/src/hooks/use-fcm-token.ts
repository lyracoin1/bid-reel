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
 *
 * ── Bundle-size note ─────────────────────────────────────────────────────────
 * `getToken` from firebase/messaging is NOT imported at the top level.
 * It is loaded via dynamic import inside initWebFcm(), which only runs when
 * Firebase is actually configured and the user grants notification permission.
 * This keeps the firebase/messaging chunk completely off the critical path.
 */

import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Capacitor } from "@capacitor/core";
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

// ── Deep-link resolver ────────────────────────────────────────────────────────
// Maps FCM push data payload to an in-app route. Covers all notification types.

const DEAL_TYPES = new Set([
  "payment_proof_uploaded",
  "shipment_proof_uploaded",
  "buyer_delivery_proof_uploaded",
  "buyer_confirmed_receipt",
  "shipping_fee_dispute_created",
  "seller_penalty_applied",
  "buyer_conditions_submitted",
  "seller_conditions_submitted",
  "deal_rated",
  "receipt_uploaded",
  "escrow_released",
  "escrow_disputed",
  "escrow_released_with_fee",
  "product_media_uploaded",
  "external_payment_warning",
]);

export function resolveDeepLinkRoute(data: Record<string, string>): string {
  const type     = data["type"] ?? "";
  const dealId   = data["dealId"] ?? data["deal_id"] ?? "";
  const auctionId = data["auctionId"] ?? "";
  const actorId  = data["actorId"] ?? "";

  // Secure-deal notification → deal activity page
  if (DEAL_TYPES.has(type) && dealId) {
    return `/secure-deals/pay/${dealId}`;
  }
  if (DEAL_TYPES.has(type)) {
    return "/deals";
  }

  // Auction notification
  if (auctionId) {
    return `/auction/${auctionId}`;
  }

  // Follower notification
  if ((type === "followed_you" || type === "new_follower") && actorId) {
    return `/users/${actorId}`;
  }
  if (actorId && !type) {
    return `/users/${actorId}`;
  }

  return "/feed";
}

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
        onForegroundNotification: ({ title, body, data }) => {
          const route = resolveDeepLinkRoute(data);
          showBannerRef.current({
            name: title,
            message: body,
            onTap: () => navigateRef.current(route),
          });
        },
        onNotificationTap: (data) => {
          const route = resolveDeepLinkRoute(data);
          navigateRef.current(route);
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

    void initWebFcm(
      (token, _platform, trigger) => tryRegister(token, "web", trigger),
      (title, body, route) => {
        showBannerRef.current({
          name: title,
          message: body,
          onTap: () => navigateRef.current(route),
        });
      },
    );

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
  onForeground: (title: string, body: string, route: string) => void,
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

    // 4. Get FCM registration token.
    //    Both firebase/messaging and getFirebaseMessaging() are loaded here
    //    as dynamic imports — they are never on the cold-start critical path.
    const messaging = await getFirebaseMessaging();
    if (!messaging) return;

    // Dynamic import keeps `getToken` and `onMessage` out of the initial bundle.
    const { getToken, onMessage } = await import("firebase/messaging");
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
    await onToken(token, "web", "initWebFcm");
    console.info("[fcm] Device token registered successfully");

    // 6. Foreground notification handler — the service worker only receives
    //    messages when the app tab is in the background. When it is in the
    //    foreground, FCM delivers the payload here instead of to the SW.
    //    We surface it as an in-app banner so the user isn't left wondering.
    onMessage(messaging, (payload) => {
      const title = payload.notification?.title ?? "BidReel";
      const body  = payload.notification?.body  ?? "";
      const data  = (payload.data ?? {}) as Record<string, string>;
      const route = resolveDeepLinkRoute(data);
      console.debug("[fcm] Foreground message:", { title, body, data, route });
      onForeground(title, body, route);
    });
  } catch (err) {
    console.error("[fcm] Initialisation error:", err);
  }
}
