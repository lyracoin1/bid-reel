import { supabaseAdmin } from "./supabase";
import type { AuthUser } from "./requireAuth";
import { ApiError } from "./errors";

/**
 * requireAdmin — plain async helper for Vercel functions.
 *
 * Must be called AFTER requireAuth (requires a resolved AuthUser).
 * Throws ApiError(403) if the user is not an admin; resolves on success.
 *
 *   const user = await requireAuth(req.headers["authorization"]);
 *   await requireAdmin(user);
 */
export async function requireAdmin(user: AuthUser): Promise<void> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!data?.is_admin) {
    throw new ApiError(403, "FORBIDDEN", "Admin access required");
  }
}
