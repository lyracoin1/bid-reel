/**
 * /api/whatsapp/test — manual provider verification endpoint.
 *
 * POST /api/whatsapp/test
 *   body: { "to": "201559035388", "message": "Hello from BidReel" }
 *   → calls sendWhatsApp() with kind="test" and returns the dispatch
 *     outcome plus current provider diagnostics.
 *
 * No auth on this route on purpose: the only thing it can do is send a
 * test text message via the already-configured provider, and the provider
 * itself rate-limits abuse. If misuse becomes a concern, gate it behind
 * an admin-only middleware later.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { sendWhatsApp, getWhatsAppDiagnostics } from "../lib/whatsapp";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

// In production, this route requires admin auth so it cannot be used as
// an open outbound-WhatsApp relay (would burn provider quota / spam).
// In development, it stays unauthenticated so engineers can curl it
// directly while integrating.
const isProd = process.env["NODE_ENV"] === "production";
const guards: Array<(req: Request, res: Response, next: NextFunction) => unknown> = isProd
  ? [requireAuth, requireAdmin]
  : [];

router.post("/whatsapp/test", ...guards, async (req: Request, res: Response) => {
  const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
  const message = typeof req.body?.message === "string" ? req.body.message : "";
  const diag = getWhatsAppDiagnostics();

  if (!to || !message) {
    return res.status(400).json({
      ok: false,
      error: "MISSING_FIELDS",
      message: "Body requires { to: string, message: string }.",
      diagnostics: diag,
    });
  }

  if (!/^\+?[1-9]\d{6,14}$/.test(to)) {
    return res.status(400).json({
      ok: false,
      error: "INVALID_PHONE",
      message: "`to` must be an E.164-style phone number (digits, optional leading +).",
      diagnostics: diag,
    });
  }

  if (diag.activeProvider === "none") {
    return res.status(503).json({
      ok: false,
      error: "NO_PROVIDER_CONFIGURED",
      message:
        "Neither Meta (WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID) " +
        "nor Wapilot (WAPILOT_BASE_URL + WAPILOT_API_KEY + WAPILOT_INSTANCE_ID) " +
        "is configured in the environment.",
      diagnostics: diag,
    });
  }

  const sent = await sendWhatsApp({
    phone: to,
    body: message,
    lang: "en",
    kind: "test",
    meta: { source: "api/whatsapp/test" },
  });

  return res.status(sent ? 200 : 502).json({
    ok: sent,
    provider: diag.activeProvider,
    to,
    messageLen: message.length,
    diagnostics: diag,
  });
});

export default router;
