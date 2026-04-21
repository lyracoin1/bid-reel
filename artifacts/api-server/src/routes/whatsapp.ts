/**
 * /api/whatsapp/test — manual Wapilot verification endpoint.
 *
 * POST /api/whatsapp/test
 *   body: { "to": "201559035388", "message": "Hello from BidReel" }
 *   → calls sendWhatsApp() with kind="test" and returns the dispatch
 *     outcome plus current Wapilot diagnostics.
 *
 * In production, this route requires admin auth so it cannot be used as
 * an open outbound-WhatsApp relay (would burn provider quota / spam).
 * In development, it stays unauthenticated so engineers can curl it
 * directly while integrating.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { sendWhatsApp, getWhatsAppDiagnostics } from "../lib/whatsapp";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

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

  if (!diag.configured) {
    return res.status(503).json({
      ok: false,
      error: "NO_PROVIDER_CONFIGURED",
      message:
        "Wapilot is not configured. Set WAPILOT_BASE_URL, WAPILOT_API_KEY, and WAPILOT_INSTANCE_ID.",
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
    provider: diag.provider,
    to,
    chatId: `${to.replace(/\D/g, "")}@c.us`,
    messageLen: message.length,
    diagnostics: diag,
  });
});

export default router;
