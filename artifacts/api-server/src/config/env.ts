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

  // ─── Firebase Cloud Messaging (optional) ───────────────────────────────────
  // JSON string of the Firebase service account credentials.
  // When absent the server runs without FCM push notifications.
  firebaseServiceAccountJson: optional("FIREBASE_SERVICE_ACCOUNT_JSON"),

  // ─── Vercel deploy hook (optional) ─────────────────────────────────────────
  // When set, POST /api/admin/deploy will call this URL to trigger a Vercel
  // deployment. The URL is a secret — never expose it to the frontend.
  vercelDeployHookUrl: optional("VERCEL_DEPLOY_HOOK_URL"),

  // ─── Derived helpers ───────────────────────────────────────────────────────
  get isProduction() {
    return this.nodeEnv === "production";
  },
  get isDevelopment() {
    return this.nodeEnv === "development";
  },
} as const;
