import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "./env";

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
} as const;

// Anon client — used for auth operations (OTP send/verify, sign-in).
// Operates under RLS with anon / authenticated permissions.
export const supabase = createClient(
  requireEnv("SUPABASE_URL"),
  requireEnv("SUPABASE_ANON_KEY"),
  clientOptions,
);

// Admin client — service_role key, bypasses RLS.
// NEVER expose this client or key to any frontend code.
// Use only inside serverless API functions.
export const supabaseAdmin = createClient(
  requireEnv("SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  clientOptions,
);

// ---------------------------------------------------------------------------
// supabase-js@2.100.0 breaking change: SupabaseClient.auth is now typed as
// SupabaseAuthClient (extends AuthClient) instead of GoTrueClient.  Methods
// that only exist on GoTrueClient — admin.*, getUser(jwt) — are no longer
// visible to TypeScript.  GoTrueClient is not exported from @supabase/supabase-js
// and @supabase/auth-js is a transitive dep only (not directly importable).
//
// Fix: cast once here using local structural interfaces that cover exactly the
// methods this codebase calls.  Runtime behaviour is unchanged — the object
// at supabaseAdmin.auth is still a GoTrueClient instance.
// ---------------------------------------------------------------------------

interface _AuthAdminApi {
  createUser(attrs: object): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  updateUserById(uid: string, attrs: object): Promise<{ data: unknown; error: unknown }>;
  deleteUser(uid: string): Promise<{ data: unknown; error: unknown }>;
}

interface _GoTrueClientLike {
  admin: _AuthAdminApi;
  getUser(jwt?: string): Promise<{ data: { user: { id: string; phone?: string } | null }; error: unknown }>;
}

// Use authAdmin.xxx() instead of supabaseAdmin.auth.admin.xxx().
export const authAdmin = (supabaseAdmin.auth as unknown as _GoTrueClientLike).admin;

// Use goTrueAuth.getUser(jwt) instead of supabaseAdmin.auth.getUser(jwt).
export const goTrueAuth = supabaseAdmin.auth as unknown as _GoTrueClientLike;
