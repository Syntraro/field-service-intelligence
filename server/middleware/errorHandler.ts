import { Request, Response, NextFunction } from "express";

/**
 * Async handler wrapper to eliminate try/catch boilerplate in route handlers
 * Usage: router.get('/path', requireAuth, asyncHandler(async (req, res) => { ... }))
 */
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Standard error response for tenant-scoped operations
 * Handles common HTTP error codes with consistent messaging
 */
export const handleApiError = (err: any, res: Response, defaultMessage = "Operation failed") => {
  if (err?.status === 400 || err?.statusCode === 400) {
    return res.status(400).json({ error: err.message || "Bad request" });
  }

  if (err?.status === 404 || err?.statusCode === 404) {
    return res.status(404).json({ error: err.message || "Not found" });
  }

  if (err?.status === 403 || err?.statusCode === 403) {
    // Support custom toJSON for structured error responses (e.g., SchedulingForbiddenError)
    if (typeof err.toJSON === "function") {
      return res.status(403).json(err.toJSON());
    }
    return res.status(403).json({
      error: err.message || "Forbidden",
      code: err.code || "FORBIDDEN",
    });
  }

  if (err?.status === 401 || err?.statusCode === 401) {
    return res.status(401).json({ error: err.message || "Unauthorized" });
  }

  // 2026-03-20: 409 Conflict — structured code for client-side detection
  if (err?.status === 409 || err?.statusCode === 409) {
    return res.status(409).json({
      error: err.message || "Conflict",
      code: err.code || "CONFLICT",
    });
  }

  console.error("API Error:", err);
  return res.status(500).json({ error: defaultMessage });
};

/**
 * Creates a standardized error object
 */
export const createError = (status: number, message: string) => {
  const error = new Error(message) as any;
  error.status = status;
  return error;
};
