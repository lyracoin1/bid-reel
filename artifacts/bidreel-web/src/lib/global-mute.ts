import { useEffect, useState } from "react";
import { subscribeNativeVolumeButtons } from "./native-volume-buttons";

const STORAGE_KEY = "globalMuted";

function readInitial(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "false") return false;
    if (v === "true") return true;
  } catch {
  }
  return true;
}

let isMuted: boolean = readInitial();
const listeners = new Set<(v: boolean) => void>();

export function getGlobalMuted(): boolean {
  return isMuted;
}

export function setGlobalMuted(next: boolean): void {
  if (next === isMuted) return;
  isMuted = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
  } catch {
  }
  for (const fn of listeners) fn(next);
}

export function subscribeGlobalMuted(fn: (v: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useGlobalMute(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(isMuted);
  useEffect(() => subscribeGlobalMuted(setV), []);
  return [v, setGlobalMuted];
}

let intentInstalled = false;

export function installAudioIntentListener(): void {
  if (intentInstalled) return;
  intentInstalled = true;

  // ── 1. Native Android hardware-volume listener (real fix) ─────────────────
  // Android intercepts KEYCODE_VOLUME_UP / VOLUME_DOWN at the OS level — they
  // never reach the WebView as a JS `keydown` event.  The companion native
  // plugin overrides MainActivity.dispatchKeyEvent and forwards each press
  // through Capacitor.  This subscriber unmutes on the FIRST press and stays
  // active so subsequent presses still flip mute off if the user re-muted.
  subscribeNativeVolumeButtons(() => {
    if (getGlobalMuted()) setGlobalMuted(false);
  });

  // ── 2. Browser / desktop fallback ─────────────────────────────────────────
  // Covers desktop browsers (where keyboard volume keys CAN reach `keydown`)
  // and gives the spec-required "any first interaction implies sound intent"
  // behaviour for users on web.
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const VOLUME_KEYS = new Set([
    "AudioVolumeUp",
    "AudioVolumeDown",
    "VolumeUp",
    "VolumeDown",
  ]);

  const onKey = (e: KeyboardEvent) => {
    if (VOLUME_KEYS.has(e.key)) {
      if (getGlobalMuted()) setGlobalMuted(false);
      return;
    }
    onAnyInteraction();
  };

  const onAnyInteraction = () => {
    if (getGlobalMuted()) setGlobalMuted(false);
    cleanup();
  };

  const cleanup = () => {
    document.removeEventListener("touchstart", onAnyInteraction, opts);
    document.removeEventListener("pointerdown", onAnyInteraction, opts);
    document.removeEventListener("keydown", onKey, opts);
  };

  const opts: AddEventListenerOptions = { capture: true, passive: true };

  document.addEventListener("touchstart", onAnyInteraction, opts);
  document.addEventListener("pointerdown", onAnyInteraction, opts);
  document.addEventListener("keydown", onKey, opts);
}
