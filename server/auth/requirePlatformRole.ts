/**
 * Platform Role Gate — Phase 1 (Platform Admin Foundation).
 *
 * Canonical middleware for all /api/platform/* routes. Composes with the
 * existing auth stack:
 *   requireAuth  →  impersonationMiddleware  →  requirePlatformRole
 *
 * Rules:
 * - Requires an authenticated user.
 * - When impersonation is active, checks the REAL actor's role (req.realUser),
 *   matching the behavior of requireRole. A platform admin remains a platform
 *   admin for the purpose of platform-portal access while impersonating.
 * - Only users whose effective role is in the allowed PlatformRole list are
 *   granted access. Tenant-only users (owner/admin/manager/...) are denied.
 * - Denials are logged to the existing audit_logs table via platformAuditService
 *   (no new audit surface created).
 *
 * Holding a platform role does NOT by itself grant tenant data access — that
 * is enforced separately in ensureTenantContext.
 */

import type { Request, Response, NextFunction } from "express";
import { PLATFORM_ROLES, isPlatformRole, type PlatformRole } from "./roles";
import { platformAuditService } from "../services/platformAuditService";

export function requirePlatformRole(
  allowed: readonly PlatformRole[] = PLATFORM_ROLES,
) {
  const allowedSet = new Set<string>(allowed);

  return async (req: Request, res: Response, next: NextFunction) => {
    const isAuthed = typeof (req as any).isAuthenticated === "function" && (req as any).isAuthenticated();
    if (!isAuthed || !req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Use the REAL actor when impersonation is active (mirrors requireRole).
    const effectiveUser = (req as any).isImpersonating ? (req as any).realUser : req.user;
    const userRole: string | undefined = effectiveUser?.role;

    if (!userRole || !isPlatformRole(userRole) || !allowedSet.has(userRole)) {
      // Fire-and-forget audit write. Never block the response on audit I/O.
      platformAuditService
        .logPlatformRoleDenied(
          effectiveUser?.id ?? "unknown",
          effectiveUser?.email ?? "unknown",
          req.originalUrl || req.path,
          userRole ?? null,
          req,
        )
        .catch((err) => {
          console.error("[platform-rbac] audit write failed:", err);
        });

      return res.status(403).json({ error: "Forbidden" });
    }

    return next();
  };
}
