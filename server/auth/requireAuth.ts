import type { Request, Response, NextFunction } from "express";

const PUBLIC_PATHS = new Set([
  "/auth/login",
  "/auth/signup",
  "/auth/me",
  "/csrf-token",
  "/health",
  "/qbo/oauth/callback", // OAuth callback validates its own state via session
]);

/** Portal routes handle their own auth via session.portal — skip staff auth */
function isPortalPath(path: string): boolean {
  return path.startsWith("/portal/") || path === "/portal";
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (isPortalPath(req.path)) return next(); // Portal uses its own session auth

  const isAuthed = typeof (req as any).isAuthenticated === "function" && (req as any).isAuthenticated();
  if (isAuthed) return next();

  return res.status(401).json({ error: "Unauthorized" });
}