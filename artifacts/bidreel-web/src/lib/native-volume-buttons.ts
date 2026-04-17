import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

interface VolumeButtonsPlugin {
  ping(): Promise<{ ok: boolean }>;
  addListener(
    event: "volumePressed",
    cb: (data: { direction: "up" | "down" }) => void,
  ): Promise<PluginListenerHandle>;
}

const VolumeButtons = registerPlugin<VolumeButtonsPlugin>("VolumeButtons");

/**
 * Subscribe to native Android hardware volume key presses.  Returns a teardown
 * function that removes the listener.  No-op (returns identity teardown) on
 * non-Android platforms — the JS-side `keydown` fallback in `global-mute.ts`
 * still covers desktop browsers.
 *
 * Events fire on EVERY volume key press (down stroke only), even though the
 * OS still owns stream volume control.  We do not control or report system
 * volume — we only know the user pressed a volume key.
 */
export function subscribeNativeVolumeButtons(
  cb: (direction: "up" | "down") => void,
): () => void {
  if (Capacitor.getPlatform() !== "android") {
    return () => {};
  }

  let handle: PluginListenerHandle | null = null;
  let cancelled = false;

  VolumeButtons.addListener("volumePressed", (data) => {
    if (data?.direction === "up" || data?.direction === "down") {
      cb(data.direction);
    }
  })
    .then((h) => {
      if (cancelled) {
        h.remove().catch(() => {});
      } else {
        handle = h;
      }
    })
    .catch((err) => {
      console.warn("[VolumeButtons] addListener failed:", err);
    });

  return () => {
    cancelled = true;
    if (handle) {
      handle.remove().catch(() => {});
      handle = null;
    }
  };
}
