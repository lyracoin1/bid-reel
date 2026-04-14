/**
 * Vercel Serverless Function — Express API handler.
 *
 * This file is the Vercel function entry point for all /api/* routes.
 * Vercel's Node.js runtime calls the exported function with
 * (IncomingMessage, ServerResponse), which Express handles natively —
 * the same way a regular Node HTTP server does, just without the port binding.
 *
 * The Express app is pre-built by esbuild as part of the Vercel buildCommand
 * ("pnpm --filter @workspace/api-server run build"), producing:
 *   artifacts/api-server/dist/app.mjs   ← this import
 *   artifacts/api-server/dist/index.mjs ← used by Replit (includes app.listen)
 *
 * Required Vercel environment variables (set in Vercel project → Settings → Env):
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * CRASH SAFETY: If the app fails to initialize (e.g. missing env vars), this
 * wrapper still exports a valid handler that:
 *   - Responds to OPTIONS preflight with proper CORS headers (so the browser
 *     does not block cross-origin admin API calls with "Failed to fetch").
 *   - Returns a JSON 503 for all other requests with a clear error message
 *     pointing to the missing configuration.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true",
  "Vary": "Origin",
};

let app = null;
let startupError = null;

try {
  const mod = await import("../artifacts/api-server/dist/app.mjs");
  app = mod.default;
} catch (err) {
  startupError = err?.message ?? String(err);
  console.error("[BidReel API] Startup failed:", startupError);
}

export default function handler(req, res) {
  // Always handle CORS preflight first, even when startup failed.
  // Without this, OPTIONS from admin.bid-reel.com gets no CORS headers
  // and the browser blocks every subsequent API call with "Failed to fetch".
  if (req.method === "OPTIONS") {
    const origin = req.headers["origin"];
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    else res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", CORS_HEADERS["Access-Control-Allow-Methods"]);
    res.setHeader("Access-Control-Allow-Headers", CORS_HEADERS["Access-Control-Allow-Headers"]);
    res.setHeader("Access-Control-Allow-Credentials", CORS_HEADERS["Access-Control-Allow-Credentials"]);
    res.setHeader("Vary", "Origin");
    res.writeHead(204);
    res.end();
    return;
  }

  if (!app) {
    // App failed to initialize — still return JSON with CORS headers so the
    // browser does not swallow the response as a CORS error.
    const origin = req.headers["origin"];
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    else res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
    res.setHeader("Content-Type", "application/json");
    res.writeHead(503);
    res.end(JSON.stringify({
      error: "server_init_failed",
      message:
        "API server failed to start. Verify that SUPABASE_URL, SUPABASE_ANON_KEY, " +
        "and SUPABASE_SERVICE_ROLE_KEY are set in the Vercel project environment variables.",
      detail: startupError,
    }));
    return;
  }

  return app(req, res);
}
