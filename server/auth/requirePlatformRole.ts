/**
 * Platform Role Gate — Phase 1 (Platform Admin Foundation) / 2026-04-22 Phase 1
 * Platform Auth Separation.
 *
 * Canonical middleware for all /api/platform/* routes. Composes with the new
 * psid-based auth stack:
 *   platformSessionMiddleware  →  requirePlatformSession  →  requirePlatformRole
 *
 * 2026-04-22: this middleware now prefers `req.platformUser` (set by
 * `requirePlatformSession` from the psid session) over the legacy
 * `req.user` (set by Passport from the sid session). The legacy path is
 * retained as a fallback so any transitional callers that still rely on
 * the tenant session continue to work during rollout — but platform routes
 * on the canonical mount go through psid first.
 *
 * Rules:
 * - Requires an authenticated platform user (via psid OR, fallback, via sid).
 * - When impersonation is active on the tenant path, checks the REAL actor's
 *   role (req.realUser) — matches requireRole behavior.
 * - Only users whose effective role is in the allowed PlatformRole list are
 *   granted access. Tenant-only users (owner/admin/manager/...) are denied.
 * - Denials are logged to audit_logs via platformAuditService.
 *
 * Holding a platform role does NOT by itself grant tenant data access —
 * that's enforced separately in ensureTenantContext.
 */

import type { Request, Response, NextFunction } from "express";
import { PLATFORM_ROLES, isPlatformRole, type PlatformRole } from "./roles";
import { platformAuditService } from "../services/platformAuditService";

export function requirePlatformRole(
  allowed: readonly PlatformRole[] = PLATFORM_ROLES,
) {
  const allowedSet = new Set<string>(allowed);

  return async (req: Request, res: Response, next: NextFunction) => {
    // 1) Prefer psid-backed platform identity (canonical path post-2026-04-22).
    const platformUser = (req as any).platformUser as
      | { id: string; email: string; role: string }
      | undefined;

    let effectiveUser: { id?: string; email?: string; role?: string } | undefined;
    let userRole: string | undefined;

    if (platformUser?.role) {
      effectiveUser = platformUser;
      userRole = platformUser.role;
    } else {
      // 2) Legacy fallback: sid-backed tenant session with a platform-role user.
      //    Kept for a transitional window; remove once all platform callers go
      //    through psid and tenant login is gated against platform roles.
      const isAuthed =
        typeof (req as any).isAuthenticated === "function" &&
        (req as any).isAuthenticated();
      if (!isAuthed || !req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      effectiveUser = (req as any).isImpersonating ? (req as any).realUser : req.user;
      userRole = (effectiveUser as any)?.role;
    }

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
