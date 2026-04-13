/**
 * Vercel Serverless Function — Express API handler.
 *
 * This file is the Vercel function entry point for all /api/* routes.
 * Vercel's Node.js runtime calls the exported function with
 * (IncomingMessage, ServerResponse), which Express handles natively —
 * the same way a regular Node HTTP server does, just without the port binding.
 *
 * The Express app is pre-built by esbuild as part of the Vercel buildCommand
 * ("pnpm --filter @workspace/api-server run build"), producing:
 *   artifacts/api-server/dist/app.mjs   ← this import
 *   artifacts/api-server/dist/index.mjs ← used by Replit (includes app.listen)
 *
 * Required Vercel environment variables (set in Vercel project → Settings → Env):
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 */
export { default } from "../artifacts/api-server/dist/app.mjs";
