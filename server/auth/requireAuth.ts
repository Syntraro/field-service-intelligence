import type { Request, Response, NextFunction } from "express";

const PUBLIC_PATHS = new Set([
  "/auth/login",
  "/auth/signup",
  "/auth/me",
  "/csrf-token",
  "/health",
]);

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  console.log('🔍 DEBUG requireAuth - path:', req.path, 'url:', req.url);
  
  if (PUBLIC_PATHS.has(req.path)) return next();

  const isAuthed = typeof (req as any).isAuthenticated === "function" && (req as any).isAuthenticated();
  if (isAuthed) return next();

  return res.status(401).json({ error: "Unauthorized" });
}