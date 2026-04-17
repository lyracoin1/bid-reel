import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// ─── Security headers (helmet) ────────────────────────────────────────────────
//
// This is an API server — never serves HTML — so a permissive CSP that only
// allows JSON responses is fine.  The strict headers below close every finding
// commonly raised by OWASP ZAP for an API surface:
//
//   • Strict-Transport-Security  — force HTTPS for 1 year incl. subdomains
//   • X-Content-Type-Options      — block MIME-sniffing
//   • X-Frame-Options: DENY       — block clickjacking
//   • Referrer-Policy             — never leak the API URL via Referer
//   • Cross-Origin-Resource-Policy: cross-origin — explicit (we are a CORS API)
//   • Origin-Agent-Cluster        — opt-in to tighter process isolation
//
// CSP is set to a minimal policy ("default-src 'none'") because the API only
// returns JSON — no HTML, no scripts, no images.  This means any reflected
// XSS attempt that somehow returned text/html would be neutralised by the
// browser refusing to execute anything.  The frontend (bidreel-web /
// bidreel-admin) sets its own CSP via Vercel headers — see vercel.json.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'none'"],
        "frame-ancestors": ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    strictTransportSecurity: {
      maxAge: 31536000,        // 1 year
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: "no-referrer" },
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// ─── CORS ────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS: Array<string | RegExp> = [
  // Production domains
  "https://bid-reel.com",
  "https://www.bid-reel.com",
  "https://admin.bid-reel.com",
  // Local development
  "http://localhost:5173",
  "http://localhost:3000",
  // Replit preview environments
  /^https?:\/\/localhost(:\d+)?$/,
  /\.replit\.dev$/,
  /\.repl\.co$/,
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, cb) => {
    // Allow server-to-server requests, curl, and Postman (no Origin header).
    if (!origin) return cb(null, true);

    const allowed = ALLOWED_ORIGINS.some((pattern) =>
      typeof pattern === "string" ? origin === pattern : pattern.test(origin),
    );

    // Pass null + false for unknown origins — no Error, so Express's error
    // handler is not triggered and the preflight still gets a proper 200/204.
    cb(null, allowed);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

// Intercept ALL OPTIONS preflight requests before they reach any route handler.
//
// Rationale for using app.use() instead of app.options("/{*path}", cors()):
//   • app.use() is middleware — it runs for every request regardless of method
//     and path, making it strictly more reliable than a method-specific route.
//   • When the cors() origin callback returns false (rejected origin), it calls
//     next() without ending the response. In Express 5 this causes 405 for paths
//     that only have GET/POST handlers. The explicit inline handler below always
//     terminates OPTIONS requests, eliminating the fall-through entirely.
//   • This also handles the case where Vercel CDN forwards OPTIONS before the
//     serverless function's own OPTIONS handling can fire.
app.use((req, res, next) => {
  if (req.method !== "OPTIONS") return next();

  const origin = req.headers.origin as string | undefined;
  if (origin) {
    const allowed = ALLOWED_ORIGINS.some((p) =>
      typeof p === "string" ? origin === p : p.test(origin),
    );
    if (allowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");
  res.sendStatus(204);
});

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── X-Server-Time header ─────────────────────────────────────────────────────
// Stamp every API response with the server's authoritative UTC time so the
// client can compute a clock-offset and display accurate auction countdowns
// even when the device wall clock is wrong.
//
// Exposed via Access-Control-Expose-Headers so the browser's `fetch()` can
// actually read it cross-origin (capacitor:// → bid-reel.com).
app.use((_req, res, next) => {
  res.setHeader("X-Server-Time", new Date().toISOString());
  res.setHeader("Access-Control-Expose-Headers", "X-Server-Time");
  next();
});

app.use("/api", router);

// ─── Catch-all: unknown routes return JSON, never HTML or plain text ──────────
app.use((_req, res) => {
  res.status(404).json({ error: "not_found", message: "Route not found" });
});

export default app;
