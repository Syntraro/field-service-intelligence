import { Request, Response, NextFunction } from "express";

/**
 * Role-based access control middleware.
 *
 * When impersonating, uses the REAL user's role (the owner/admin who started impersonation)
 * rather than the impersonated user's role. This allows owners to still access
 * admin routes while impersonating.
 */
export function requireRole(roles: readonly string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    // When impersonating, check the real user's role (the owner)
    // This allows owners to access admin routes even while impersonating
    const effectiveUser = (req as any).isImpersonating ? (req as any).realUser : req.user;
    const userRole = effectiveUser?.role;

    if (!userRole || !roles.includes(userRole)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}
