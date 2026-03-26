import { Router, type IRouter } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase";
import { upsertProfile, getProfileById } from "../lib/profiles";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const e164Regex = /^\+[1-9]\d{7,14}$/;

const requestOtpSchema = z.object({
  phoneNumber: z
    .string()
    .regex(e164Regex, "Phone number must be in E.164 format (e.g. +14155550123)"),
});

const verifyOtpSchema = z.object({
  phoneNumber: z
    .string()
    .regex(e164Regex, "Phone number must be in E.164 format"),
  otp: z
    .string()
    .length(6)
    .regex(/^\d{6}$/, "OTP must be exactly 6 digits"),
});

// ---------------------------------------------------------------------------
// POST /api/auth/request-otp
// ---------------------------------------------------------------------------
// Triggers Supabase to send an SMS OTP to the given phone number.
// No auth required — this is the first step of the login flow.
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
    req.log.warn({ err: error.message, phone: phoneNumber.slice(0, 4) + "****" }, "OTP send failed");
    // Surface a generic error to avoid leaking Supabase internals.
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

  // Upsert profile — creates row on first login, returns existing on subsequent logins.
  let profileResult;
  try {
    profileResult = await upsertProfile(user.id, user.phone ?? phoneNumber);
  } catch (err) {
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
    // access_token is a Supabase JWT — include in subsequent requests as:
    // Authorization: Bearer <token>
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
// Returns the authenticated user's current profile.
// Lightweight endpoint for token validation and session restore on app launch.
// ---------------------------------------------------------------------------
router.get("/auth/me", requireAuth, async (req, res) => {
  const profile = await getProfileById(req.user!.id);

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
