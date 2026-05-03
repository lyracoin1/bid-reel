import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const env = loadEnv(process.env.NODE_ENV ?? "production", process.cwd(), "");

const rawPort = process.env.PORT;

// PORT is only required when running the dev/preview server.
// During `vite build` (Vercel CI, Capacitor, etc.) it is optional.
const isBuild = process.argv.includes("build");
if (!rawPort && !isBuild) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = rawPort ? Number(rawPort) : 8080;

if (!Number.isNaN(port) && (port <= 0 || !Number.isInteger(port))) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// In Replit the artifact router injects BASE_PATH (e.g. "/bidreel-web") so the
// app is served under a sub-path.  On Vercel / standalone deploys no prefix is
// needed, so we default to "/" when the variable is absent.
const basePath = process.env.BASE_PATH ?? "/";

// Replit-specific plugins — only loaded when running inside Replit itself.
// Never imported on Vercel or in Capacitor Android builds.
const isReplit =
  process.env.REPL_ID !== undefined || process.env.REPL_SLUG !== undefined;

const replitPlugins = isReplit && !isBuild
  ? await Promise.all([
      import("@replit/vite-plugin-runtime-error-modal").then((m) =>
        m.default(),
      ),
      import("@replit/vite-plugin-cartographer").then((m) =>
        m.cartographer({ root: path.resolve(import.meta.dirname, "..") }),
      ),
      import("@replit/vite-plugin-dev-banner").then((m) => m.devBanner()),
    ])
  : [];

export default defineConfig({
  base: basePath,
  define: {
    // Expose Supabase connection details to the frontend bundle.
    // Support both naming conventions: VITE_SUPABASE_URL (Vite-native) and
    // SUPABASE_URL (legacy/server-style). VITE_ prefix is checked first.
    'import.meta.env.VITE_SUPABASE_URL':
      JSON.stringify(env['VITE_SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL'] ?? env['SUPABASE_URL'] ?? process.env['SUPABASE_URL'] ?? ''),
    'import.meta.env.VITE_SUPABASE_ANON_KEY':
      JSON.stringify(env['VITE_SUPABASE_ANON_KEY'] ?? process.env['VITE_SUPABASE_ANON_KEY'] ?? env['SUPABASE_ANON_KEY'] ?? process.env['SUPABASE_ANON_KEY'] ?? ''),
    // Firebase Web SDK config — support both VITE_FIREBASE_* (preferred) and
    // bare FIREBASE_* secret names (Replit Secrets don't expose non-VITE_ vars
    // automatically to the browser, so we bridge them here).
    'import.meta.env.VITE_FIREBASE_API_KEY':
      JSON.stringify(process.env['VITE_FIREBASE_API_KEY'] ?? process.env['FIREBASE_API_KEY'] ?? ''),
    'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN':
      JSON.stringify(process.env['VITE_FIREBASE_AUTH_DOMAIN'] ?? process.env['FIREBASE_AUTH_DOMAIN'] ?? ''),
    'import.meta.env.VITE_FIREBASE_PROJECT_ID':
      JSON.stringify(process.env['VITE_FIREBASE_PROJECT_ID'] ?? process.env['FIREBASE_PROJECT_ID'] ?? ''),
    'import.meta.env.VITE_FIREBASE_STORAGE_BUCKET':
      JSON.stringify(process.env['VITE_FIREBASE_STORAGE_BUCKET'] ?? process.env['FIREBASE_STORAGE_BUCKET'] ?? ''),
    'import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID':
      JSON.stringify(process.env['VITE_FIREBASE_MESSAGING_SENDER_ID'] ?? process.env['FIREBASE_MESSAGING_SENDER_ID'] ?? ''),
    'import.meta.env.VITE_FIREBASE_APP_ID':
      JSON.stringify(process.env['VITE_FIREBASE_APP_ID'] ?? process.env['FIREBASE_APP_ID'] ?? ''),
    'import.meta.env.VITE_FIREBASE_VAPID_KEY':
      JSON.stringify(process.env['VITE_FIREBASE_VAPID_KEY'] ?? process.env['FIREBASE_VAPID_KEY'] ?? ''),
    // Public base URL used for deep links (e.g. share links in Secure Deals).
    // Supports both VITE_ prefix (auto-exposed by Vite) and bare name fallback.
    'import.meta.env.VITE_PUBLIC_BASE_URL':
      JSON.stringify(process.env['VITE_PUBLIC_BASE_URL'] ?? process.env['PUBLIC_BASE_URL'] ?? ''),
  },
  plugins: [
    react(),
    tailwindcss(),
    ...replitPlugins,
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // ── Vendor chunk splitting ───────────────────────────────────────────
        // Splitting heavy node_modules into named chunks gives two benefits:
        //   1. Smaller initial parse cost — the browser/WebView only parses
        //      what is needed for the current route on cold start.
        //   2. Better long-term HTTP cache hit rate — vendor chunks rarely
        //      change between deploys, so returning users skip re-downloading
        //      framer-motion/radix/supabase even when app code updates.
        //
        // Firebase is handled separately: firebase.ts uses dynamic imports so
        // the SDK is never in the initial bundle at all. The manualChunks entry
        // below just gives it a stable, predictable chunk name.
        manualChunks(id: string) {
          // Firebase Web SDK — loaded lazily, only when push notifications
          // are configured. Named chunk for stable caching.
          if (id.includes("/node_modules/firebase/") ||
              id.includes("/node_modules/@firebase/")) {
            return "vendor-firebase";
          }
          // Framer Motion — animation runtime, not needed for initial render.
          if (id.includes("/node_modules/framer-motion/")) {
            return "vendor-framer";
          }
          // Radix UI primitives — large collection of component packages.
          if (id.includes("/node_modules/@radix-ui/")) {
            return "vendor-radix";
          }
          // Supabase client + realtime + storage.
          if (id.includes("/node_modules/@supabase/")) {
            return "vendor-supabase";
          }
          // React core — tiny but benefits from a long-lived cache entry.
          if (id.includes("/node_modules/react/") ||
              id.includes("/node_modules/react-dom/") ||
              id.includes("/node_modules/scheduler/")) {
            return "vendor-react";
          }
        },
      },
    },
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});