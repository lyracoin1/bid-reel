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

export default router;
