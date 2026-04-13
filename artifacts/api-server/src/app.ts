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
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no Origin (server-to-server, curl, Postman).
    if (!origin) return cb(null, true);

    const allowed = [
      /^https?:\/\/localhost(:\d+)?$/,
      /\.replit\.dev$/,
      /\.repl\.co$/,
      /^https:\/\/bid-reel\.com$/,
      /^https:\/\/www\.bid-reel\.com$/,
      /^https:\/\/admin\.bid-reel\.com$/,
    ];
    const ok = allowed.some((pattern) =>
      typeof pattern === "string" ? origin === pattern : pattern.test(origin),
    );
    cb(ok ? null : new Error(`CORS: origin ${origin} not allowed`), ok);
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// ─── Catch-all: unknown routes return JSON, never HTML or plain text ──────────
app.use((_req, res) => {
  res.status(404).json({ error: "not_found", message: "Route not found" });
});

export default app;
