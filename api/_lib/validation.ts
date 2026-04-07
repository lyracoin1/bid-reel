import { z } from "zod";
import { ApiError } from "./errors";

// ─── Common field schemas ──────────────────────────────────────────────────────

export const uuidSchema = z.string().uuid("Must be a valid UUID");

export const e164Schema = z
  .string()
  .regex(
    /^\+[1-9]\d{7,14}$/,
    "Phone must be in E.164 format (e.g. +14155550123)",
  );

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

// ─── Framework-agnostic parse helper ─────────────────────────────────────────

/**
 * Parse and validate data against a Zod schema.
 * Returns the typed result on success; throws ApiError(400) on failure.
 *
 * Usage inside a Vercel handler:
 *   const body = parseOrThrow(mySchema, req.body, "body");
 */
export function parseOrThrow<T>(
  schema: z.ZodType<T>,
  data: unknown,
  label = "input",
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      result.error.issues[0]?.message ?? `Invalid ${label}`,
    );
  }
  return result.data;
}
