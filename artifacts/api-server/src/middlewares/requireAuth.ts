import type { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../lib/supabase";

// Attached to req by requireAuth middleware — available in all downstream handlers.
export interface AuthUser {
  id: string;
  phone: string;
}

// Extend Express Request type globally so handlers can access req.user with types.
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
 * Validates the Bearer JWT from the Authorization header using the Supabase
 * Admin client. On success, attaches `req.user` with the user's id and phone.
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

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    req.log.warn({ err: error?.message }, "Token validation failed");
    res.status(401).json({
      error: "INVALID_TOKEN",
      message: "Invalid or expired token",
    });
    return;
  }

  req.user = {
    id: data.user.id,
    phone: data.user.phone ?? "",
  };

  next();
}
