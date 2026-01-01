import type { Request, Response, NextFunction } from "express";

/**
 * Require an authenticated session user for API routes.
 * Frontend routes (non-/api) are allowed through so Vite/static can serve them.
 * 
 * SECURITY: Public endpoints must be explicitly listed to bypass auth.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api")) return next();

  // Public endpoints that don't require authentication
  const publicEndpoints = [
    "/api/auth/login",
    "/api/auth/logout", 
    "/api/invitations/accept",
    "/api/health",
    "/api/csrf-token"
  ];

  // Check if this is a public endpoint
  if (publicEndpoints.some(endpoint => req.path.startsWith(endpoint))) {
    return next();
  }

  // Passport adds req.user and req.isAuthenticated()
  const user = (req as any).user as { id?: string; companyId?: string } | undefined;

  if (!user?.id || !user?.companyId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // CRITICAL SECURITY FIX: Set companyId on request for tenant isolation
  // Without this line, req.companyId is undefined and queries return ALL tenants' data!
  (req as any).companyId = user.companyId;

  return next();
}