import type { VercelRequest, VercelResponse } from "@vercel/node";

const ALLOWED_ORIGINS = new Set([
  "https://admin.bid-reel.com",
  "https://www.bid-reel.com",
  "https://bid-reel.com",
]);

/**
 * Apply CORS response headers and short-circuit OPTIONS preflights.
 *
 * Call this as the FIRST statement in every Vercel function handler.
 * Returns true when the request was an OPTIONS preflight — the caller
 * must return immediately. Returns false for all other methods so the
 * handler can continue normally.
 *
 * This is required for every api/admin/* function because Vercel's
 * file-based routing gives individual function files priority over the
 * wildcard rewrite in vercel.json, meaning OPTIONS preflights to
 * /api/admin/stats, /api/admin/users, etc. hit these files directly —
 * bypassing the Express app and its CORS middleware entirely.
 */
export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers["origin"] as string | undefined;

  const isKnownOrigin =
    !origin ||
    ALLOWED_ORIGINS.has(origin) ||
    /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
    /\.replit\.dev$/.test(origin) ||
    /\.repl\.co$/.test(origin);

  if (origin && isKnownOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }

  return false;
}
