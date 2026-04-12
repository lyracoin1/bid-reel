import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

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
      JSON.stringify(process.env['VITE_SUPABASE_URL'] ?? process.env['SUPABASE_URL'] ?? ''),
    'import.meta.env.VITE_SUPABASE_ANON_KEY':
      JSON.stringify(process.env['VITE_SUPABASE_ANON_KEY'] ?? process.env['SUPABASE_ANON_KEY'] ?? ''),
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
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
