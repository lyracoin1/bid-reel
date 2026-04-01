/**
 * Firebase Web SDK — client-side initialisation.
 *
 * All Firebase config values are read from VITE_FIREBASE_* environment
 * variables.  When those are not set the module exports null helpers so the
 * rest of the app degrades gracefully without any runtime errors.
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

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getMessaging, type Messaging } from "firebase/messaging";

const firebaseConfig = {
  apiKey: import.meta.env["VITE_FIREBASE_API_KEY"],
  authDomain: import.meta.env["VITE_FIREBASE_AUTH_DOMAIN"],
  projectId: import.meta.env["VITE_FIREBASE_PROJECT_ID"],
  storageBucket: import.meta.env["VITE_FIREBASE_STORAGE_BUCKET"],
  messagingSenderId: import.meta.env["VITE_FIREBASE_MESSAGING_SENDER_ID"],
  appId: import.meta.env["VITE_FIREBASE_APP_ID"],
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

export function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseConfigured) return null;
  if (_app) return _app;
  try {
    _app = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);
    return _app;
  } catch (err) {
    console.error("[firebase] initializeApp failed:", err);
    return null;
  }
}

export function getFirebaseMessaging(): Messaging | null {
  if (_messaging) return _messaging;
  const app = getFirebaseApp();
  if (!app) return null;
  try {
    _messaging = getMessaging(app);
    return _messaging;
  } catch (err) {
    console.error("[firebase] getMessaging failed:", err);
    return null;
  }
}

export { firebaseConfig };
