import type { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../lib/supabase";
import { isUserBanned } from "../lib/profiles";

// Attached to req by requireAuth — available in all downstream handlers.
export interface AuthUser {
  id: string;
  phone: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * requireAuth middleware
 *
 * 1. Reads the Bearer token from the Authorization header.
 * 2. Validates the JWT via Supabase Admin (getUser — server-side verify, no network hop).
 * 3. Checks that the user's account is not banned (profiles.is_banned).
 * 4. Attaches req.user = { id, phone } for downstream handlers.
 *
 * Phone is taken from the Supabase Auth user object — it is only used internally
 * (e.g. for WhatsApp link generation) and must never appear in API responses.
 *
 * Usage: router.get("/protected", requireAuth, handler)
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers["authorization"];

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({
      error: "MISSING_TOKEN",
      message: "Authorization header with Bearer token is required",
    });
    return;
  }

  const token = authHeader.slice(7);

  // Step 1: validate JWT with Supabase
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    req.log?.warn({ err: error?.message }, "Token validation failed");
    res.status(401).json({
      error: "INVALID_TOKEN",
      message: "Invalid or expired token. Please log in again.",
    });
    return;
  }

  // Step 2: check if account is banned
  // isUserBanned returns false if the profile row doesn't exist yet (first login
  // race condition) — the profile upsert happens after verify-otp, so banned
  // users will be caught here on every subsequent request.
  const banned = await isUserBanned(data.user.id);
  if (banned) {
    req.log?.warn({ userId: data.user.id }, "Banned user attempted access");
    res.status(403).json({
      error: "ACCOUNT_BANNED",
      message: "Your account has been suspended. Contact support if you believe this is a mistake.",
    });
    return;
  }

  // Step 3: attach user to request
  req.user = {
    id: data.user.id,
    phone: data.user.phone ?? "",
  };

  next();
}
