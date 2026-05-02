/**
 * Firebase Web SDK — client-side initialisation.
 *
 * All Firebase config values are read from VITE_FIREBASE_* environment
 * variables.  When those are not set the module exports null helpers so the
 * rest of the app degrades gracefully without any runtime errors.
 *
 * ── Bundle-size strategy ─────────────────────────────────────────────────────
 * The Firebase Web SDK (~130 KB gzipped) is NOT imported at the module's top
 * level.  Instead, `firebase/app` and `firebase/messaging` are loaded via
 * dynamic `await import(...)` INSIDE the initialiser functions.
 *
 * Effect: on cold start (and whenever Firebase is not configured at all) the
 * Firebase SDK is never downloaded, parsed, or executed.  It is fetched as a
 * separate async chunk only the first time `getFirebaseApp()` is called, which
 * happens inside a `useEffect` well after the feed is already visible.
 *
 * The type-only imports below (`import type`) are erased at compile time and
 * add zero bytes to the bundle.
 *
 * Setup instructions (one-time, per Firebase project):
 *   1. Create a Firebase project at https://console.firebase.google.com
 *   2. Enable Cloud Messaging in Project Settings > Cloud Messaging
 *   3. Add a Web App and copy the firebaseConfig object
 *   4. Generate a VAPID key pair under Cloud Messaging > Web push certificates
 *   5. Set the VITE_FIREBASE_* and VITE_FIREBASE_VAPID_KEY env vars in Replit
 *   6. For the backend: download a service account JSON and set
 *      FIREBASE_SERVICE_ACCOUNT_JSON in the API Server secrets
 */

// Type-only imports — erased at compile time, zero runtime cost.
import type { FirebaseApp } from "firebase/app";
import type { Messaging } from "firebase/messaging";

const firebaseConfig = {
  apiKey:            import.meta.env["VITE_FIREBASE_API_KEY"],
  authDomain:        import.meta.env["VITE_FIREBASE_AUTH_DOMAIN"],
  projectId:         import.meta.env["VITE_FIREBASE_PROJECT_ID"],
  storageBucket:     import.meta.env["VITE_FIREBASE_STORAGE_BUCKET"],
  messagingSenderId: import.meta.env["VITE_FIREBASE_MESSAGING_SENDER_ID"],
  appId:             import.meta.env["VITE_FIREBASE_APP_ID"],
};

export const vapidKey: string | undefined = import.meta.env["VITE_FIREBASE_VAPID_KEY"];

/** True when all required Firebase config values are present */
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.messagingSenderId &&
  firebaseConfig.appId
);

let _app: FirebaseApp | null = null;
let _messaging: Messaging | null = null;

/**
 * Lazy-initialise the Firebase app.
 * The firebase/app SDK is loaded dynamically on first call — never at module
 * load time — so it does not contribute to the initial JS parse budget.
 */
export async function getFirebaseApp(): Promise<FirebaseApp | null> {
  if (!isFirebaseConfigured) return null;
  if (_app) return _app;
  try {
    const { initializeApp, getApps } = await import("firebase/app");
    _app = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);
    return _app;
  } catch (err) {
    console.error("[firebase] initializeApp failed:", err);
    return null;
  }
}

/**
 * Lazy-initialise Firebase Messaging.
 * The firebase/messaging SDK is loaded dynamically on first call.
 */
export async function getFirebaseMessaging(): Promise<Messaging | null> {
  if (_messaging) return _messaging;
  const app = await getFirebaseApp();
  if (!app) return null;
  try {
    const { getMessaging } = await import("firebase/messaging");
    _messaging = getMessaging(app);
    return _messaging;
  } catch (err) {
    console.error("[firebase] getMessaging failed:", err);
    return null;
  }
}

export { firebaseConfig };
