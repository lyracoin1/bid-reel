/**
 * Vercel Serverless Function — Express API handler.
 *
 * This file is the Vercel function entry point for ALL `/api/*` routes
 * (vercel.json rewrites every /api/* path to /api/index). The Express
 * app is pre-built by esbuild as part of the Vercel buildCommand:
 *
 *   pnpm --filter @workspace/api-server run build
 *     → artifacts/api-server/dist/app.mjs   ← imported here (no port listener)
 *     → artifacts/api-server/dist/index.mjs ← used by Replit (with app.listen)
 *
 * RESILIENCE GUARANTEES:
 *
 *   1. /api/health (and /api/healthz) ALWAYS responds 200 — even if the
 *      Express app failed to import. Useful for uptime checks and to
 *      confirm the function itself is reachable.
 *
 *   2. CORS preflight (OPTIONS) is always answered with the right headers,
 *      even on startup failure, so the browser does not swallow real
 *      errors as "Failed to fetch".
 *
 *   3. When startup fails, the 503 response includes the REAL underlying
 *      error message (e.g. which env var is missing) instead of a fixed
 *      hard-coded "SUPABASE_*" message. The error is also logged to the
 *      Vercel function logs.
 */

const CORS_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const CORS_HEADERS_LIST = "Content-Type, Authorization";

function setCors(req, res) {
  const origin = req.headers["origin"];
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Methods", CORS_METHODS);
  res.setHeader("Access-Control-Allow-Headers", CORS_HEADERS_LIST);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Vary", "Origin");
}

// ─── Try to import the Express app; capture errors instead of crashing ───────

let app = null;
let startupError = null;
let startupErrorStack = null;

try {
  const mod = await import("../artifacts/api-server/dist/app.mjs");
  app = mod.default;
  if (typeof app !== "function") {
    throw new Error(
      "Imported app.mjs does not export a function — got " + typeof app,
    );
  }
  console.log("[BidReel API] Express app loaded successfully");
} catch (err) {
  startupError = err?.message ?? String(err);
  startupErrorStack = err?.stack ?? null;
  console.error("[BidReel API] Startup failed:", startupError);
  if (startupErrorStack) console.error(startupErrorStack);
}

// ─── Vercel handler ──────────────────────────────────────────────────────────

export default function handler(req, res) {
  // Always handle CORS preflight first.
  if (req.method === "OPTIONS") {
    setCors(req, res);
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check — always succeeds, regardless of app state.
  // Vercel strips the /api prefix in some configurations and not others,
  // so accept both variants.
  const url = req.url || "";
  // Normalize: drop the query string and any trailing slash (except root) so
  // that "/api/health", "/api/health/", and "/api/health?foo=bar" all match.
  const rawPath = url.split("?")[0];
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, "") : rawPath;
  if (
    path === "/health" ||
    path === "/healthz" ||
    path === "/api/health" ||
    path === "/api/healthz"
  ) {
    setCors(req, res);
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(
      JSON.stringify({
        status: "ok",
        appLoaded: Boolean(app),
        startupError: startupError || null,
      }),
    );
    return;
  }

  // App failed to load — return a 503 with the REAL error.
  if (!app) {
    setCors(req, res);
    res.setHeader("Content-Type", "application/json");
    res.writeHead(503);
    res.end(
      JSON.stringify({
        error: "server_init_failed",
        message:
          startupError ||
          "API server failed to initialise. Check the Vercel function logs for details.",
        hint:
          "Verify that all required environment variables are set in the Vercel " +
          "project (Settings → Environment Variables) AND that the deployment was " +
          "redeployed after they were added. Required: SUPABASE_URL, " +
          "SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID, " +
          "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL.",
      }),
    );
    return;
  }

  // Normal path — hand the request to Express.
  return app(req, res);
}
