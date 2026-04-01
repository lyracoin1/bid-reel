/**
 * useFcmToken — requests notification permission, retrieves the FCM device
 * token, sends the service-worker config, and registers the token with the
 * API server.
 *
 * Usage: mount once in App.tsx.  The hook is a no-op when Firebase is not
 * configured (VITE_FIREBASE_* env vars missing) or when the browser does not
 * support notifications.
 */

import { useEffect } from "react";
import { getToken } from "firebase/messaging";
import {
  isFirebaseConfigured,
  getFirebaseMessaging,
  vapidKey,
  firebaseConfig,
} from "@/lib/firebase";
import { registerDeviceToken } from "@/lib/api-client";

export function useFcmToken(): void {
  useEffect(() => {
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

    void initFcm();
  }, []);
}

async function initFcm(): Promise<void> {
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

    // 5. Register token with the backend
    await registerDeviceToken(token);
    console.info("[fcm] Device token registered successfully");
  } catch (err) {
    console.error("[fcm] Initialisation error:", err);
  }
}
