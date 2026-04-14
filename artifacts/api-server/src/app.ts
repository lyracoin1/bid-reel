import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

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

app.use("/api", router);

// ─── Catch-all: unknown routes return JSON, never HTML or plain text ──────────
app.use((_req, res) => {
  res.status(404).json({ error: "not_found", message: "Route not found" });
});

export default app;
