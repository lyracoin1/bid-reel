import { Router, type IRouter } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase";
import { upsertProfile, getOwnProfile, PhoneAlreadyRegisteredError } from "../lib/profiles";
import { requireAuth } from "../middlewares/requireAuth";
import { devLogin } from "../lib/devAuth";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const e164Regex = /^\+[1-9]\d{7,14}$/;

const phoneSchema = z
  .string()
  .regex(e164Regex, "Phone number must be in E.164 format (e.g. +14155550123)");

const requestOtpSchema = z.object({ phoneNumber: phoneSchema });

const verifyOtpSchema = z.object({
  phoneNumber: phoneSchema,
  otp: z
    .string()
    .length(6)
    .regex(/^\d{6}$/, "OTP must be exactly 6 digits"),
});

const devLoginSchema = z.object({ phoneNumber: phoneSchema });

// ---------------------------------------------------------------------------
// POST /api/auth/request-otp
// ---------------------------------------------------------------------------
// Triggers Supabase to send an SMS OTP to the given phone number.
// No auth required — this is the first step of the production login flow.
// ---------------------------------------------------------------------------
router.post("/auth/request-otp", async (req, res) => {
  const parsed = requestOtpSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "Invalid request",
    });
    return;
  }

  const { phoneNumber } = parsed.data;

  const { error } = await supabase.auth.signInWithOtp({ phone: phoneNumber });

  if (error) {
    req.log.warn(
      { err: error.message, phone: phoneNumber.slice(0, 4) + "****" },
      "OTP send failed",
    );
    res.status(400).json({
      error: "OTP_SEND_FAILED",
      message:
        "Failed to send OTP. Ensure the phone number is correct and try again.",
    });
    return;
  }

  res.json({
    message: "OTP sent",
    expiresInSeconds: 300,
    resendAvailableInSeconds: 60,
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/verify-otp
// ---------------------------------------------------------------------------
// Verifies the OTP with Supabase, upserts the profile row on first login,
// and returns a Bearer token + public user profile (no phone exposed).
// ---------------------------------------------------------------------------
router.post("/auth/verify-otp", async (req, res) => {
  const parsed = verifyOtpSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "Invalid request",
    });
    return;
  }

  const { phoneNumber, otp } = parsed.data;

  const { data, error } = await supabase.auth.verifyOtp({
    phone: phoneNumber,
    token: otp,
    type: "sms",
  });

  if (error || !data.user || !data.session) {
    req.log.warn({ err: error?.message }, "OTP verification failed");
    res.status(401).json({
      error: "INVALID_OTP",
      message: "The OTP is invalid or has expired. Please request a new one.",
    });
    return;
  }

  const { user, session } = data;

  let profileResult;
  try {
    profileResult = await upsertProfile(user.id, user.phone ?? phoneNumber);
  } catch (err) {
    if (err instanceof PhoneAlreadyRegisteredError) {
      // Supabase OTP guarantees one auth user per phone, so this shouldn't
      // normally happen. Surface it clearly if it does.
      req.log.warn({ phone: phoneNumber.slice(0, 4) + "****" }, "Phone already registered to another account");
      res.status(409).json({
        error: "PHONE_ALREADY_REGISTERED",
        message: "This phone number is already registered. Please log in with your existing account.",
      });
      return;
    }
    req.log.error({ err }, "Profile upsert failed after successful OTP");
    res.status(500).json({
      error: "PROFILE_SETUP_FAILED",
      message:
        "Authentication succeeded but profile setup failed. Please try again.",
    });
    return;
  }

  res.json({
    token: session.access_token,
    isNewUser: profileResult.isNewUser,
    user: profileResult.profile,
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/dev-login
// ---------------------------------------------------------------------------
// DEV ONLY — bypasses SMS OTP for local development and API testing.
//
// Two independent guards prevent this from running in production:
//   1. USE_DEV_AUTH env var must be exactly the string "true"
//   2. NODE_ENV must not be "production"
//
// Given a phone number, creates or retrieves a Supabase user and returns
// a real JWT token — identical in shape and behaviour to production login.
//
// See: src/lib/devAuth.ts for implementation details.
// ---------------------------------------------------------------------------
router.post("/auth/dev-login", async (req, res) => {
  // Guard 1: explicit opt-in flag
  if (process.env["USE_DEV_AUTH"] !== "true") {
    res.status(403).json({
      error: "DEV_AUTH_DISABLED",
      message:
        "Dev auth is not enabled. Set USE_DEV_AUTH=true in your environment to use this endpoint.",
    });
    return;
  }

  // Guard 2: never allow in production
  if (process.env["NODE_ENV"] === "production") {
    res.status(403).json({
      error: "DEV_AUTH_DISABLED",
      message: "Dev auth cannot be used in a production environment.",
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

  const { phoneNumber } = parsed.data;

  try {
    const result = await devLogin(phoneNumber);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err: message }, "Dev login failed");
    res.status(500).json({
      error: "DEV_LOGIN_FAILED",
      message,
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
// Returns the authenticated user's current profile.
// Works with tokens from both production OTP and dev-login flows.
// ---------------------------------------------------------------------------
router.get("/auth/me", requireAuth, async (req, res) => {
  const profile = await getOwnProfile(req.user!.id);

  if (!profile) {
    res.status(404).json({
      error: "PROFILE_NOT_FOUND",
      message: "No profile found for this user",
    });
    return;
  }

  res.json({ user: profile });
});

export default router;
