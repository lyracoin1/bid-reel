import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { devLogin } from "../_lib/devAuth";
import { ApiError } from "../_lib/errors";
import { logger } from "../_lib/logger";
import { normalizePhoneNumber, E164_REGEX } from "../_lib/phone";

// ---------------------------------------------------------------------------
// POST /api/auth/dev-login
// ---------------------------------------------------------------------------
// Backward-compat alias for POST /api/auth/login.
// Identical behavior — same schema, same response shape.
// Requires USE_DEV_AUTH=true.
// ---------------------------------------------------------------------------

const bodySchema = z.object({
  phoneNumber: z.string().min(7, "Enter a valid phone number").max(20),
});

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "METHOD_NOT_ALLOWED", message: "POST required" });
    return;
  }

  if (process.env["USE_DEV_AUTH"] !== "true") {
    res.status(403).json({
      error: "AUTH_DISABLED",
      message: "Authentication is not enabled. Contact the administrator.",
    });
    return;
  }

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "Invalid request",
    });
    return;
  }

  const phoneNumber = normalizePhoneNumber(parsed.data.phoneNumber);

  if (!E164_REGEX.test(phoneNumber)) {
    res.status(400).json({
      error: "INVALID_PHONE",
      message:
        "Could not normalise phone number to E.164 format. Include your country code, e.g. +20 for Egypt.",
    });
    return;
  }

  try {
    const result = await devLogin(phoneNumber);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("POST /api/auth/dev-login failed", { message });
    res.status(500).json({ error: "LOGIN_FAILED", message });
  }
}
