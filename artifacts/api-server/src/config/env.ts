/**
 * Centralized environment configuration.
 * All env vars are read and validated here — never inline process.env access in route files.
 * Missing required vars throw at startup so failures are immediately visible.
 */

function require(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function optional(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

export const env = {
  // ─── Server ────────────────────────────────────────────────────────────────
  port: Number(optional("PORT", "8080")),
  nodeEnv: optional("NODE_ENV", "development"),

  // ─── Supabase ──────────────────────────────────────────────────────────────
  supabaseUrl: require("SUPABASE_URL"),
  supabaseAnonKey: require("SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: require("SUPABASE_SERVICE_ROLE_KEY"),

  // ─── Admin ─────────────────────────────────────────────────────────────────
  adminSecret: optional("ADMIN_SECRET"),

  // ─── Feature flags ─────────────────────────────────────────────────────────
  useDevAuth: optional("USE_DEV_AUTH") === "true",

  // ─── Derived helpers ───────────────────────────────────────────────────────
  get isProduction() {
    return this.nodeEnv === "production";
  },
  get isDevelopment() {
    return this.nodeEnv === "development";
  },
} as const;
