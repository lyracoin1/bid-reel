/**
 * useAndroidBack — centralised hardware back-button policy for the
 * Capacitor Android app. Mounted ONCE at the application root.
 *
 * Why this exists
 * ───────────────
 * The default Capacitor / WebView behavior follows browser history. After a
 * normal session the back stack contains every screen the user passed
 * through, plus duplicate entries from React-router-style navigation, plus
 * silent entries from modals (whenever AnimatePresence triggered a hash
 * change). Pressing back walks through that whole tape — totally unlike a
 * real Android app.
 *
 * We replace that with an explicit four-tier priority:
 *
 *   A. Overlay first    — close modal/sheet/drawer/lightbox if any open
 *   B. Inner page       — go to its logical parent (NOT history.back)
 *   C. Root tab         — exit the app via App.exitApp() (double-tap to
 *                         confirm so a fat-finger doesn't kill the session)
 *   D. Anywhere else    — replace location with /feed (never push)
 *
 * History pollution prevention: this hook never calls window.history.back().
 * It always uses wouter's setLocation(..., { replace: true }) so the back
 * stack stays empty of internally-driven navigation.
 *
 * Web behavior is preserved — this hook is a no-op on non-native platforms.
 */

import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { CapApp, isNative } from "@/lib/capacitor-app";
import { popAndCloseTopOverlay } from "@/lib/back-button-stack";

/** Routes that act as "root tabs" — back from these exits the app. */
const ROOT_ROUTES: ReadonlySet<string> = new Set([
  "/feed",
  "/explore",
  "/profile",
  "/create",
]);

/**
 * For each known inner page, the logical parent that back should navigate
 * to. Keys are matched as path PREFIXES so dynamic segments work.
 * Anything not in this map falls through to the default fallback (/feed).
 */
const INNER_PARENT: ReadonlyArray<readonly [string, string]> = [
  ["/auction/",        "/feed"],     // auction detail → feed
  ["/users/",          "/explore"],  // public profile → explore
  ["/profile/edit",    "/profile"],  // edit profile → profile
  ["/change-password", "/profile"],  // change pw → profile
  ["/safety-rules",    "/profile"],  // safety rules → profile
  ["/privacy",         "/profile"],  // privacy → profile
  ["/interests",       "/feed"],     // onboarding (rarely reachable as back)
];

const DOUBLE_TAP_EXIT_MS = 1500;

export function useAndroidBack(): void {
  const [location, setLocation] = useLocation();

  // Refs so the single backButton listener (registered once) sees the
  // latest values without being torn down/re-registered on every render.
  const locationRef = useRef(location);
  const setLocationRef = useRef(setLocation);
  useEffect(() => { locationRef.current = location; }, [location]);
  useEffect(() => { setLocationRef.current = setLocation; }, [setLocation]);

  useEffect(() => {
    if (!isNative()) return;

    let lastBackAt = 0;

    const handle = CapApp.addListener("backButton", () => {
      // ── PRIORITY A — overlay first ─────────────────────────────────────
      if (popAndCloseTopOverlay()) return;

      const path = locationRef.current;

      // ── PRIORITY C — root tab → exit (double-tap to confirm) ───────────
      if (ROOT_ROUTES.has(path)) {
        const now = Date.now();
        if (now - lastBackAt < DOUBLE_TAP_EXIT_MS) {
          void CapApp.exitApp();
          return;
        }
        lastBackAt = now;
        // Lightweight visual cue. Avoids importing the toast system here so
        // this file stays dependency-free; a console.info is enough since
        // the press-again hint is intuitive within 1.5 s.
        console.info("[back] press back again to exit");
        return;
      }

      // ── PRIORITY B — inner page → logical parent (REPLACE) ─────────────
      for (const [prefix, parent] of INNER_PARENT) {
        if (path.startsWith(prefix) && path !== parent) {
          setLocationRef.current(parent, { replace: true });
          return;
        }
      }

      // ── PRIORITY D — unknown route → fallback to feed (REPLACE) ────────
      setLocationRef.current("/feed", { replace: true });
    });

    return () => {
      handle.then(h => h.remove()).catch(() => {});
    };
  }, []);
}
