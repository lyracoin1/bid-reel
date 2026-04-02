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
// Combined phone-login + admin activation in a single request.
//
// Flow:
//   1. Validate adminCode against ADMIN_ACTIVATION_CODE FIRST — rejects bad
//      codes before touching the database. This prevents account creation
//      from unauthenticated probing.
//   2. devLogin(phoneNumber) — creates or fetches the per-phone Supabase
//      account and returns a JWT. Each phone → unique account (same as
//      /auth/login).
//   3. If the account is not yet admin, set is_admin = true on its profile.
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

  // ── Step 4: Ensure admin flag is set ──────────────────────────────────────
  if (!result.user.isAdmin) {
    const { error: adminErr } = await supabaseAdmin
      .from("profiles")
      .update({ is_admin: true })
      .eq("id", result.user.id);

    if (adminErr) {
      logger.error({ err: adminErr, userId: result.user.id }, "Admin login: failed to set is_admin");
    } else {
      result.user.isAdmin = true;
      logger.info({ userId: result.user.id }, "Admin login: is_admin set to true");
    }
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
