import { useState, useEffect } from "react";

// ─── Module-level singleton ───────────────────────────────────────────────────
// Fetched once per page session; shared across all components.

interface LatLng { lat: number; lng: number }

let _loc: LatLng | null = null;
let _fetched = false;
const _listeners = new Set<() => void>();

function _notify() {
  _listeners.forEach((l) => l());
}

function _fetch() {
  if (_fetched) return;
  _fetched = true;

  if (!navigator.geolocation) return;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      _loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      _notify();
    },
    () => {
      /* silently ignore denied / unavailable */
    },
    { timeout: 12_000, maximumAge: 5 * 60 * 1000 },
  );
}

/**
 * Returns the current viewer's geolocation (for distance calculation only).
 * Returns null if unavailable or not yet resolved.
 * Does NOT block any UI — components should handle null gracefully.
 */
export function useViewerLocation(): LatLng | null {
  const [loc, setLoc] = useState<LatLng | null>(_loc);

  useEffect(() => {
    const handler = () => {
      if (_loc) setLoc({ ..._loc });
    };
    _listeners.add(handler);
    _fetch();

    return () => {
      _listeners.delete(handler);
    };
  }, []);

  return loc;
}
