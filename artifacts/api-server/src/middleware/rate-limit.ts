/**
 * In-process rate limiters used to protect a few high-blast-radius endpoints.
 *
 * These are intentionally small and conservative — they exist to absorb
 * casual abuse (e.g. retry storms on Buy Now / Mark Sold) rather than to be
 * a full DDoS shield. For the latter, rely on the platform/CDN edge.
 *
 * Limits chosen to be comfortably above any human-driven flow but well below
 * what a script could do unattended.
 */

import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import type { Request } from "express";

/** Keys by authenticated user ID when present, otherwise by IP. */
function keyByUserOrIp(req: Request): string {
  const uid = (req as Request & { user?: { id?: string } }).user?.id;
  if (uid) return `u:${uid}`;
  return `ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
}

const baseOptions: Partial<Options> = {
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Surface a structured error so frontend can show a friendly toast instead
  // of the default plain-text "Too many requests".
  handler: (_req, res, _next, options) => {
    res.status(options.statusCode).json({
      error: "RATE_LIMITED",
      message: "Too many requests. Please slow down and try again shortly.",
    });
  },
};

/**
 * Buy-now (fixed-price) endpoint. The endpoint is already idempotent via the
 * status-CAS UPDATE, but we cap to 30/min/buyer as a defence against retry
 * storms or a runaway client-side loop.
 */
export const buyNowLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60_000,
  limit: 30,
  keyGenerator: keyByUserOrIp,
});

/**
 * Seller-only "Mark as sold" endpoint. Sellers should hit this exactly once
 * per fixed-price listing. Cap at 30/min/seller to absorb a misbehaving
 * client without ever blocking a real seller.
 */
export const markSoldLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60_000,
  limit: 30,
  keyGenerator: keyByUserOrIp,
});
