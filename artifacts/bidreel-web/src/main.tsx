import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { recordServerTimeFromResponse } from "@/lib/server-clock";
import { API_BASE } from "@/lib/api-client";

// ─── Server-clock calibration ────────────────────────────────────────────────
// Wrap window.fetch so every response from OUR API feeds the X-Server-Time
// header into the clock-offset estimator. This keeps auction countdowns
// accurate even when the device wall clock is wrong (battery-pull, manual
// change). We restrict to API_BASE so a third-party origin can't influence
// our clock by echoing an X-Server-Time header back.
{
  const originalFetch = window.fetch.bind(window);
  // API_BASE is either an absolute https URL (capacitor builds) or a path
  // prefix like "/api" (web builds). For web we accept same-origin; for
  // capacitor we accept exact URL prefix.
  const apiBaseAbs = API_BASE.startsWith("http") ? API_BASE : null;
  const apiBasePath = apiBaseAbs ? null : API_BASE;
  function isApiRequest(input: RequestInfo | URL): boolean {
    const url = typeof input === "string"
      ? input
      : input instanceof URL ? input.href
      : input instanceof Request ? input.url
      : "";
    if (apiBaseAbs) return url.startsWith(apiBaseAbs);
    // Web: same-origin path-prefix match (e.g. "/api/auctions" or
    // "https://bid-reel.com/api/auctions").
    if (url.startsWith(apiBasePath!)) return true;
    try {
      const parsed = new URL(url, window.location.origin);
      return parsed.origin === window.location.origin &&
             parsed.pathname.startsWith(apiBasePath!);
    } catch { return false; }
  }
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await originalFetch(...args);
    if (isApiRequest(args[0])) {
      try { recordServerTimeFromResponse(res); } catch { /* never break a response */ }
    }
    return res;
  };
}

// Boot-time calibration: ping /_time once immediately, then every 60s, so a
// fresh page load has an accurate offset before the first auction renders.
async function calibrateClock(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/_time`, { cache: "no-store" });
    if (res.ok) recordServerTimeFromResponse(res);
  } catch { /* offline or DNS failure — fall back to client clock */ }
}
void calibrateClock();
setInterval(() => { void calibrateClock(); }, 60_000);

createRoot(document.getElementById("root")!).render(<App />);
