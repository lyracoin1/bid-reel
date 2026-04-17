import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

function ok(_req: unknown, res: { json: (b: unknown) => void }) {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
}

router.get("/healthz", ok);
// Vercel rewrite strips the path so the Express side sees /api/health.
// We mount with both forms to be robust to future routing changes.
router.get("/health", ok);

// ─── GET /_time ───────────────────────────────────────────────────────────────
// Cheap, no-auth endpoint the client pings to calibrate its clock against
// the server's authoritative UTC time. Used by lib/server-clock.ts to keep
// auction countdowns accurate when the device wall clock is wrong.
router.get("/_time", (_req, res) => {
  res.json({ now: new Date().toISOString() });
});

export default router;
