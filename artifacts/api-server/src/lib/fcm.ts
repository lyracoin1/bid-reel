/**
 * FCM service — Firebase Cloud Messaging via Admin SDK.
 *
 * Initialised lazily: if FIREBASE_SERVICE_ACCOUNT_JSON is not set the module
 * logs a one-time warning and all send* functions become no-ops.  This keeps
 * the server running in environments where Firebase is not yet configured.
 */

import { logger } from "./logger";

type App = import("firebase-admin/app").App;
type Messaging = import("firebase-admin/messaging").Messaging;

let adminApp: App | null = null;
let messaging: Messaging | null = null;
let initialised = false;

async function getMessaging(): Promise<Messaging | null> {
  if (initialised) return messaging;
  initialised = true;

  const raw = process.env["FIREBASE_SERVICE_ACCOUNT_JSON"];
  if (!raw) {
    logger.warn("FCM: FIREBASE_SERVICE_ACCOUNT_JSON not set — push notifications disabled");
    return null;
  }

  try {
    const { initializeApp, cert } = await import("firebase-admin/app");
    const { getMessaging: gm } = await import("firebase-admin/messaging");

    const serviceAccount = JSON.parse(raw);
    adminApp = initializeApp({ credential: cert(serviceAccount) }, "bidreel-fcm");
    messaging = gm(adminApp);
    logger.info("FCM: Firebase Admin SDK initialised");
  } catch (err) {
    logger.error({ err }, "FCM: failed to initialise Firebase Admin SDK");
  }

  return messaging;
}

export interface FcmPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Send a push notification to a single device token.
 * Non-throwing — errors are logged and swallowed.
 */
export async function sendFcmPush(token: string, payload: FcmPayload): Promise<void> {
  const m = await getMessaging();
  if (!m) return;

  try {
    await m.send({
      token,
      // Top-level notification shown on all platforms (Android, iOS, web)
      notification: { title: payload.title, body: payload.body },
      // Arbitrary key/value pairs forwarded to the app for deep-link navigation.
      // All values must be strings (FCM requirement).
      data: payload.data,
      // Android-specific overrides
      android: {
        priority: "high",
        notification: {
          icon: "ic_launcher",   // must match a drawable in the Android project
          color: "#6d28d9",      // BidReel violet
          clickAction: "FLUTTER_NOTIFICATION_CLICK", // standard Capacitor tap intent
        },
      },
      // Web push (browser service worker) config — no-op on native Android
      webpush: {
        notification: {
          title: payload.title,
          body: payload.body,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          requireInteraction: true,
        },
        fcmOptions: {
          link: payload.data?.["auctionId"]
            ? `/auction/${payload.data["auctionId"]}`
            : "/feed",
        },
      },
    });
    logger.debug({ token: token.slice(0, 20) + "…" }, "FCM: push sent");
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? "";
    if (code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token") {
      logger.warn({ token: token.slice(0, 20) + "…", code }, "FCM: stale token — should be pruned");
    } else {
      logger.error({ err }, "FCM: send failed");
    }
  }
}

/**
 * Fan out a push notification to multiple device tokens (best-effort).
 * Invalid tokens are silently skipped.
 */
export async function sendFcmPushMulti(tokens: string[], payload: FcmPayload): Promise<void> {
  if (!tokens.length) return;
  await Promise.all(tokens.map(t => sendFcmPush(t, payload)));
}
