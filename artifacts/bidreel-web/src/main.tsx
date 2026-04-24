window.addEventListener("error", (e) => {
  alert("JS Error: " + e.message);
});

window.addEventListener("unhandledrejection", (e) => {
  alert("Promise Error: " + String(e.reason));
});

import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { recordServerTimeFromResponse } from "@/lib/server-clock";
import { API_BASE } from "@/lib/api-client";

// ─── Server-clock calibration ────────────────────────────────────────────────
{
  const originalFetch = window.fetch.bind(window);
  const apiBaseAbs = API_BASE.startsWith("http") ? API_BASE : null;
  const apiBasePath = apiBaseAbs ? null : API_BASE;

  function isApiRequest(input: RequestInfo | URL): boolean {
    const url = typeof input === "string"
      ? input
      : input instanceof URL ? input.href
      : input instanceof Request ? input.url
      : "";

    if (apiBaseAbs) return url.startsWith(apiBaseAbs);

    if (url.startsWith(apiBasePath!)) return true;

    try {
      const parsed = new URL(url, window.location.origin);
      return parsed.origin === window.location.origin &&
             parsed.pathname.startsWith(apiBasePath!);
    } catch {
      return false;
    }
  }

  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await originalFetch(...args);
    if (isApiRequest(args[0])) {
      try {
        recordServerTimeFromResponse(res);
      } catch {
        /* never break a response */
      }
    }
    return res;
  };
}

async function calibrateClock(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/_time`, { cache: "no-store" });
    if (res.ok) recordServerTimeFromResponse(res);
  } catch {
    /* offline or DNS failure */
  }
}

void calibrateClock();
setInterval(() => {
  void calibrateClock();
}, 60_000);

createRoot(document.getElementById("root")!).render(<App />);