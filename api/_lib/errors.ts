/**
 * ApiError — structured error type for Vercel serverless handlers.
 *
 * Route handlers catch this and respond with the appropriate HTTP status:
 *
 *   try { ... }
 *   catch (err) {
 *     if (err instanceof ApiError) return res.status(err.statusCode).json(err.toJSON());
 *     throw err;
 *   }
 */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  toJSON() {
    return { error: this.code, message: this.message };
  }
}
