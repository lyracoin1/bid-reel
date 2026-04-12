import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const rawPort = process.env.PORT;

// PORT is only required when running the dev/preview server.
// During `vite build` (Vercel CI, etc.) it is optional.
const isBuild = process.argv.includes("build");
if (!rawPort && !isBuild) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = rawPort ? Number(rawPort) : 8080;

// In Replit the artifact router injects BASE_PATH so the app is served under
// a sub-path. On Vercel the admin app is deployed at the domain root, so we
// default to "/" when the variable is absent.
const basePath = process.env.BASE_PATH ?? "/";

// Replit-specific plugins — only loaded when running inside Replit itself,
// and never during a production build.
const isReplit =
  process.env.REPL_ID !== undefined || process.env.REPL_SLUG !== undefined;

const replitPlugins =
  isReplit && !isBuild
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
    // Support both naming conventions:
    //   VITE_SUPABASE_URL  — Vite-native style (recommended for new Vercel projects)
    //   SUPABASE_URL       — legacy style used by the API server (fallback)
    // Vite 7 resolves VITE_* vars at its own env-plugin stage before define runs,
    // so we explicitly override both to guarantee the correct value is baked in.
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
      process.env["VITE_SUPABASE_URL"] ?? process.env["SUPABASE_URL"] ?? "",
    ),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(
      process.env["VITE_SUPABASE_ANON_KEY"] ?? process.env["SUPABASE_ANON_KEY"] ?? "",
    ),
    // Main app URL used for the in-admin live preview iframe.
    // Override via APP_PREVIEW_URL env var on Vercel.
    "import.meta.env.VITE_APP_PREVIEW_URL": JSON.stringify(
      process.env["APP_PREVIEW_URL"] ?? "https://bid-reel.com",
    ),
  },
  plugins: [react(), tailwindcss(), ...replitPlugins],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
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
