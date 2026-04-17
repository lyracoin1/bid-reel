import { useEffect, useState } from "react";

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
  if (typeof window === "undefined" || typeof document === "undefined") return;
  intentInstalled = true;

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
