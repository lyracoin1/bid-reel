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
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

// Respond to all OPTIONS preflight requests before they reach any route.
// This must come before app.use("/api", router) so that preflight requests
// are answered immediately and never hit the 404 catch-all.
app.options("/{*path}", cors(corsOptions));
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// ─── Catch-all: unknown routes return JSON, never HTML or plain text ──────────
app.use((_req, res) => {
  res.status(404).json({ error: "not_found", message: "Route not found" });
});

export default app;
