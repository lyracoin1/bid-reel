import { supabaseAdmin } from "./supabase";
import { isUserBanned } from "./profiles";
import { ApiError } from "./errors";

/**
 * Authenticated user — attached by requireAuth() and forwarded to handlers.
 * Phone is included for internal use only (e.g. WhatsApp links); never
 * include it in any API response shape.
 */
export interface AuthUser {
  id: string;
  phone: string;
}

/**
 * requireAuth — plain async helper for Vercel functions.
 *
 * Replaces the Express middleware. Call at the top of each handler:
 *
 *   const user = await requireAuth(req.headers["authorization"]);
 *
 * Throws ApiError (401 or 403) on failure; returns AuthUser on success.
 */
export async function requireAuth(
  authorizationHeader: string | string[] | undefined,
): Promise<AuthUser> {
  const header = Array.isArray(authorizationHeader)
    ? authorizationHeader[0]
    : authorizationHeader;

  if (!header?.startsWith("Bearer ")) {
    throw new ApiError(
      401,
      "MISSING_TOKEN",
      "Authorization header with Bearer token is required",
    );
  }

  const token = header.slice(7);

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    throw new ApiError(
      401,
      "INVALID_TOKEN",
      "Invalid or expired token. Please log in again.",
    );
  }

  const banned = await isUserBanned(data.user.id);
  if (banned) {
    throw new ApiError(
      403,
      "ACCOUNT_BANNED",
      "Your account has been suspended. Contact support if you believe this is a mistake.",
    );
  }

  return {
    id: data.user.id,
    phone: data.user.phone ?? "",
  };
}
