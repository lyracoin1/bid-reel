/**
 * Reads a required environment variable.
 * Throws at invocation time (not module load time) so cold-start errors
 * surface in function logs rather than crashing the entire runtime.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Reads an optional environment variable.
 * Returns undefined if the variable is absent or empty.
 */
export function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

/**
 * Pre-read, lazily validated env accessors for well-known variables.
 * Add new entries here as API functions are created.
 */
export const env = {
  get SUPABASE_URL(): string {
    return requireEnv("SUPABASE_URL");
  },
  get SUPABASE_ANON_KEY(): string {
    return requireEnv("SUPABASE_ANON_KEY");
  },
  get SUPABASE_SERVICE_ROLE_KEY(): string {
    return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  },
  get USE_DEV_AUTH(): boolean {
    return process.env["USE_DEV_AUTH"] === "true";
  },
  get NODE_ENV(): string {
    return process.env["NODE_ENV"] ?? "production";
  },
};
