type LogLevel = "info" | "error";

function log(level: LogLevel, message: string, meta?: unknown): void {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(meta !== undefined && { meta }),
  };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

export const logger = {
  info(message: string, meta?: unknown): void {
    log("info", message, meta);
  },
  error(message: string, meta?: unknown): void {
    log("error", message, meta);
  },
};
