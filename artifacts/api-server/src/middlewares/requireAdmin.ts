import type { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../lib/supabase";

/**
 * requireAdmin middleware
 *
 * Must be used AFTER requireAuth (relies on req.user being set).
 * Checks that profiles.is_admin = true for the authenticated user.
 * Returns 403 if the user is not an admin.
 */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Authentication required" });
    return;
  }

  const { data } = await supabaseAdmin
    .from("profiles")
    .select("is_admin")
    .eq("id", req.user.id)
    .maybeSingle();

  if (!data?.is_admin) {
    req.log?.warn({ userId: req.user.id }, "Non-admin tried to access admin route");
    res.status(403).json({ error: "FORBIDDEN", message: "Admin access required" });
    return;
  }

  next();
}
