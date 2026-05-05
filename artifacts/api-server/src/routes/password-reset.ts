/**
 * password-reset.ts — REMOVED
 *
 * The WhatsApp/phone OTP password-reset flow (3 endpoints) that lived here has
 * been removed. Password recovery is now handled entirely by Supabase's
 * built-in email recovery:
 *
 *   Client calls:
 *     supabase.auth.resetPasswordForEmail(email, {
 *       redirectTo: "https://www.bid-reel.com/reset-password"
 *     })
 *
 *   Supabase + Resend send the recovery email automatically.
 *   The /reset-password page calls supabase.auth.updateUser({ password }).
 *
 * No server-side routes are needed for this flow.
 *
 * The password_reset_otps Supabase table may be retained for audit history
 * but is no longer written to by this server.
 */

import { Router, type IRouter } from "express";

const router: IRouter = Router();

export default router;
