/**
 * back-button-stack.ts — LIFO stack of overlay close-handlers.
 *
 * Any component that opens a modal / sheet / drawer / lightbox / fullscreen
 * overlay registers a `close` callback while it is open. The Android back
 * button (use-android-back.ts) pops the top handler and calls it BEFORE
 * touching navigation. This is the single source of truth for "is something
 * dismissable on screen right now?".
 *
 * Usage from a component:
 *   useOverlayBack(isOpen, () => setIsOpen(false))
 *
 * Pure module state — works across the whole tree, no Context required.
 * Handlers are reference-stable identifiers (we register/unregister by the
 * exact function instance) so duplicate registrations are idempotent.
 */

type CloseHandler = () => void;

const stack: CloseHandler[] = [];

export function pushOverlayHandler(handler: CloseHandler): void {
  if (!stack.includes(handler)) stack.push(handler);
}

export function removeOverlayHandler(handler: CloseHandler): void {
  const i = stack.lastIndexOf(handler);
  if (i !== -1) stack.splice(i, 1);
}

/** Returns true and consumes the top handler if one exists. */
export function popAndCloseTopOverlay(): boolean {
  const handler = stack.pop();
  if (!handler) return false;
  try {
    handler();
  } catch (err) {
    console.warn("[back-stack] overlay close handler threw:", err);
  }
  return true;
}

export function overlayStackDepth(): number {
  return stack.length;
}
