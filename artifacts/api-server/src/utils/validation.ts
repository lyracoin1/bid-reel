/**
 * Validation utilities
 *
 * Reusable Zod schemas and helper functions shared across route handlers.
 */

import { z } from "zod";
import type { Response } from "express";
import { badRequest } from "./response";

// ─── Common field schemas ──────────────────────────────────────────────────────

export const uuidSchema = z.string().uuid("Must be a valid UUID");

export const e164Schema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Phone must be in E.164 format (e.g. +14155550123)");

export const emailSchema = z.string().email("Must be a valid email address");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters");

export const cursorSchema = z.string().optional();

export const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .default(20);

// ─── Parse helper ──────────────────────────────────────────────────────────────

/**
 * Parse and validate request data against a Zod schema.
 * Returns the typed data on success, or sends a 400 response and returns null.
 *
 * Usage:
 *   const body = parseOrBadRequest(res, mySchema, req.body);
 *   if (!body) return;
 */
export function parseOrBadRequest<T>(
  res: Response,
  schema: z.ZodType<T>,
  data: unknown,
): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    badRequest(res, result.error.issues[0]?.message ?? "Invalid request", "VALIDATION_ERROR");
    return null;
  }
  return result.data;
}
