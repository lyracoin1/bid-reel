import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { devLogin } from "../_lib/devAuth";
import { ApiError } from "../_lib/errors";
import { logger } from "../_lib/logger";
import { normalizePhoneNumber, E164_REGEX } from "../_lib/phone";

// ---------------------------------------------------------------------------
// POST /api/auth/admin-login
// ---------------------------------------------------------------------------
// Admin-only login. Requires BOTH:
//   1. A valid phone number whose profile has is_admin = true in the DB.
//   2. The correct ADMIN_ACTIVATION_CODE secret.
//
// The code is validated BEFORE any DB access. This endpoint NEVER promotes
// accounts — admin status is set exclusively via PATCH /api/admin/users/:id.
//
// Response (success): { token, isNewUser, user: OwnProfile }
// ---------------------------------------------------------------------------

const bodySchema = z.object({
  phoneNumber: z.string().min(7, "Enter a valid phone number").max(20),
  adminCode: z.string().min(1, "Admin code is required"),
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

  // Step 1: Validate admin code before touching any account.
  const expected = process.env["ADMIN_ACTIVATION_CODE"];
  if (!expected) {
    logger.error("ADMIN_ACTIVATION_CODE env var not set — admin login unavailable");
    res.status(503).json({
      error: "NOT_CONFIGURED",
      message: "خاصية تفعيل الأدمن غير مفعّلة على الخادم",
    });
    return;
  }

  if (parsed.data.adminCode !== expected) {
    logger.info("Admin login: wrong activation code supplied");
    res.status(401).json({
      error: "INVALID_CODE",
      message: "الكود غير صحيح",
    });
    return;
  }

  // Step 2: Normalise and validate phone.
  const phoneNumber = normalizePhoneNumber(parsed.data.phoneNumber);

  if (!E164_REGEX.test(phoneNumber)) {
    res.status(400).json({
      error: "INVALID_PHONE",
      message:
        "تعذّر قراءة رقم الهاتف. تأكد من تضمين كود الدولة (مثل +20 لمصر).",
    });
    return;
  }

  // Step 3: Login / create the per-phone account.
  let result: Awaited<ReturnType<typeof devLogin>>;
  try {
    result = await devLogin(phoneNumber);
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("Admin login: devLogin failed", { message });
    res.status(500).json({ error: "LOGIN_FAILED", message });
    return;
  }

  // Step 4: Verify the account is actually an admin — no auto-promotion.
  if (!result.user.isAdmin) {
    logger.info("Admin login: correct code but account is not admin", {
      userId: result.user.id,
      phone: phoneNumber.slice(0, 5) + "****",
    });
    res.status(403).json({
      error: "NOT_ADMIN",
      message: "هذا الحساب ليس لديه صلاحيات الأدمن",
    });
    return;
  }

  logger.info("Admin login: success", {
    userId: result.user.id,
    phone: phoneNumber.slice(0, 5) + "****",
  });

  res.status(200).json(result);
}
