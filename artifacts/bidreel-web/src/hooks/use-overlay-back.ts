/**
 * useOverlayBack — wire any in-app overlay (modal, sheet, drawer, lightbox,
 * fullscreen viewer) into the centralized Android back-button policy.
 *
 *   useOverlayBack(isOpen, () => setIsOpen(false))
 *
 * While `isOpen` is true, the supplied `onClose` is pushed onto the global
 * overlay stack. The Android back button pops the top of the stack BEFORE
 * navigating. When `isOpen` flips to false (or the component unmounts), the
 * handler is removed so it can never accidentally fire after dismount.
 *
 * Web behavior is unchanged — the stack is used only by use-android-back.ts
 * which itself is a no-op on non-native platforms.
 */

import { useEffect, useRef } from "react";
import { pushOverlayHandler, removeOverlayHandler } from "@/lib/back-button-stack";

export function useOverlayBack(isOpen: boolean, onClose: () => void): void {
  // Keep a stable reference so we register/unregister the SAME function.
  // Using a ref lets the caller pass an inline arrow without thrashing.
  const handlerRef = useRef<() => void>(() => {});
  useEffect(() => { handlerRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const fn = () => handlerRef.current();
    pushOverlayHandler(fn);
    return () => removeOverlayHandler(fn);
  }, [isOpen]);
}
