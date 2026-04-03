import { Router, type IRouter } from "express";
import { z } from "zod";
import { supabase, supabaseAdmin } from "../lib/supabase";
import { upsertProfile, getOwnProfile, PhoneAlreadyRegisteredError } from "../lib/profiles";
import { requireAuth } from "../middlewares/requireAuth";
import { devLogin } from "../lib/devAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const e164Regex = /^\+[1-9]\d{7,14}$/;

/**
 * Normalize a phone number into E.164 format.
 *
 * Handles the following input formats:
 *   - E.164 already:  "+14155550001"  →  "+14155550001"
 *   - 00-prefix:     "00201060088141" →  "+201060088141"
 *   - Local Egyptian: "01060088141"   →  "+201060088141"
 *   - Digits only:   "14155550001"    →  "+14155550001"
 *
 * Egyptian/Arab mobile numbers (starting with 0, 10-11 digits) are assumed
 * to use +20 (Egypt). All other digit-only inputs get a bare "+" prefix so
 * callers must include their country code for non-Egyptian numbers.
 */
export function normalizePhoneNumber(raw: string): string {
  const cleaned = raw.replace(/[\s\-\(\)\.]/g, "");

  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("00")) return "+" + cleaned.slice(2);

  // Local format: starts with 0 and has 9-11 digits → strip leading 0, add +20 (Egypt)
  if (/^0\d{9,10}$/.test(cleaned)) {
    return "+20" + cleaned.slice(1);
  }

  // Bare digits — assume the caller included the country code without +
  return "+" + cleaned;
}

// Flexible schema: any non-empty string of 7-15 chars is accepted;
// actual validation and normalization happen in the handler.
const devLoginSchema = z.object({
  phoneNumber: z.string().min(7, "Enter a valid phone number").max(20),
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
// Phone-only, passwordless login.
//
// Accepts any phone format (local or E.164). Normalises to E.164, then:
//   - If a profile exists for that number → log in to the same account
//   - If no profile exists → create a new account and log in
//   - One phone number can never belong to more than one account
//
// Requires USE_DEV_AUTH=true in the environment.
// ---------------------------------------------------------------------------
router.post("/auth/login", async (req, res) => {
  if (process.env["USE_DEV_AUTH"] !== "true") {
    res.status(403).json({
      error: "AUTH_DISABLED",
      message: "Authentication is not enabled. Contact the administrator.",
    });
    return;
  }

  const parsed = devLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "Invalid request",
    });
    return;
  }

  const phoneNumber = normalizePhoneNumber(parsed.data.phoneNumber);

  if (!e164Regex.test(phoneNumber)) {
    res.status(400).json({
      error: "INVALID_PHONE",
      message: "Could not normalise phone number to E.164 format. Include your country code, e.g. +20 for Egypt.",
    });
    return;
  }

  try {
    const result = await devLogin(phoneNumber);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err: message }, "Login failed");
    res.status(500).json({ error: "LOGIN_FAILED", message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/dev-login  (alias kept for backward compat)
// ---------------------------------------------------------------------------
router.post("/auth/dev-login", async (req, res) => {
  if (process.env["USE_DEV_AUTH"] !== "true") {
    res.status(403).json({
      error: "AUTH_DISABLED",
      message: "Authentication is not enabled. Contact the administrator.",
    });
    return;
  }

  const parsed = devLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "Invalid request",
    });
    return;
  }

  const phoneNumber = normalizePhoneNumber(parsed.data.phoneNumber);

  if (!e164Regex.test(phoneNumber)) {
    res.status(400).json({
      error: "INVALID_PHONE",
      message: "Could not normalise phone number to E.164 format. Include your country code, e.g. +20 for Egypt.",
    });
    return;
  }

  try {
    const result = await devLogin(phoneNumber);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err: message }, "Login failed");
    res.status(500).json({ error: "LOGIN_FAILED", message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/admin-login
// ---------------------------------------------------------------------------
// Admin-only login. Requires BOTH a valid phone (is_admin = true in DB)
// AND the ADMIN_ACTIVATION_CODE secret. Neither alone is sufficient.
//
// Flow:
//   1. Validate adminCode against ADMIN_ACTIVATION_CODE FIRST — rejects bad
//      codes before touching the database.
//   2. devLogin(phoneNumber) — fetches/creates the per-phone Supabase account.
//   3. Verify profile.is_admin === true. Reject with 403 if not.
//      NOTE: this endpoint does NOT promote users. Admin promotion is done
//      exclusively through PATCH /api/admin/users/:id (admin panel only).
//   4. Return the same { token, isNewUser, user } shape as /auth/login.
//
// The admin code is NEVER returned to the client — only a boolean isAdmin.
// ---------------------------------------------------------------------------

const adminLoginSchema = z.object({
  phoneNumber: z.string().min(7, "Enter a valid phone number").max(20),
  adminCode: z.string().min(1, "Admin code is required"),
});

router.post("/auth/admin-login", async (req, res) => {
  if (process.env["USE_DEV_AUTH"] !== "true") {
    res.status(403).json({
      error: "AUTH_DISABLED",
      message: "Authentication is not enabled. Contact the administrator.",
    });
    return;
  }

  const parsed = adminLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "Invalid request",
    });
    return;
  }

  // ── Step 1: Validate admin code before creating/accessing any account ──────
  const expected = process.env["ADMIN_ACTIVATION_CODE"];
  if (!expected) {
    logger.warn("ADMIN_ACTIVATION_CODE env var not set — admin login unavailable");
    res.status(503).json({
      error: "NOT_CONFIGURED",
      message: "خاصية تفعيل الأدمن غير مفعّلة على الخادم",
    });
    return;
  }

  if (parsed.data.adminCode !== expected) {
    logger.warn("Admin login attempt with wrong code");
    res.status(401).json({
      error: "INVALID_CODE",
      message: "الكود غير صحيح",
    });
    return;
  }

  // ── Step 2: Normalize and validate phone ───────────────────────────────────
  const phoneNumber = normalizePhoneNumber(parsed.data.phoneNumber);
  const e164Regex = /^\+[1-9]\d{7,14}$/;

  if (!e164Regex.test(phoneNumber)) {
    res.status(400).json({
      error: "INVALID_PHONE",
      message: "تعذّر قراءة رقم الهاتف. تأكد من تضمين كود الدولة (مثل +20 لمصر).",
    });
    return;
  }

  // ── Step 3: Login / create the per-phone account ───────────────────────────
  let result: Awaited<ReturnType<typeof devLogin>>;
  try {
    result = await devLogin(phoneNumber);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err: message }, "Admin login: devLogin failed");
    res.status(500).json({ error: "LOGIN_FAILED", message });
    return;
  }

  // ── Step 4: Verify the account is actually an admin — no auto-promotion ────
  // Admin status can only be set via the admin panel (PATCH /api/admin/users/:id).
  // Knowing the activation code alone does NOT grant admin access.
  if (!result.user.isAdmin) {
    logger.warn(
      { userId: result.user.id, phone: phoneNumber.slice(0, 5) + "****" },
      "Admin login: correct code but account is not admin",
    );
    res.status(403).json({
      error: "NOT_ADMIN",
      message: "هذا الحساب ليس لديه صلاحيات الأدمن",
    });
    return;
  }

  const maskedPhone = phoneNumber.slice(0, 5) + "****";
  logger.info(
    { userId: result.user.id, phone: maskedPhone },
    "Admin login: success",
  );

  res.json(result);
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
router.get("/auth/me", requireAuth, async (req, res) => {
  const profile = await getOwnProfile(req.user!.id);
  if (!profile) {
    res.status(404).json({ error: "PROFILE_NOT_FOUND", message: "Profile not found." });
    return;
  }
  res.json(profile);
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------
router.post("/auth/logout", requireAuth, async (_req, res) => {
  await supabase.auth.signOut();
  res.json({ message: "Logged out" });
});

export default router;
