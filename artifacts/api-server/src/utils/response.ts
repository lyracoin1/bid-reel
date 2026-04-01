/**
 * HTTP response helpers
 *
 * Keeps response shape consistent across all route handlers.
 */

import type { Response } from "express";

export function ok<T>(res: Response, data: T, statusCode = 200): void {
  res.status(statusCode).json(data);
}

export function created<T>(res: Response, data: T): void {
  res.status(201).json(data);
}

export function noContent(res: Response): void {
  res.status(204).send();
}

export function badRequest(res: Response, message: string, code = "BAD_REQUEST"): void {
  res.status(400).json({ error: code, message });
}

export function unauthorized(res: Response, message = "Unauthorized", code = "UNAUTHORIZED"): void {
  res.status(401).json({ error: code, message });
}

export function forbidden(res: Response, message: string, code = "FORBIDDEN"): void {
  res.status(403).json({ error: code, message });
}

export function notFound(res: Response, message = "Not found", code = "NOT_FOUND"): void {
  res.status(404).json({ error: code, message });
}

export function conflict(res: Response, message: string, code = "CONFLICT"): void {
  res.status(409).json({ error: code, message });
}

export function unprocessable(res: Response, message: string, code: string, extra?: object): void {
  res.status(422).json({ error: code, message, ...extra });
}

export function serverError(res: Response, message = "Internal server error", code = "SERVER_ERROR"): void {
  res.status(500).json({ error: code, message });
}
