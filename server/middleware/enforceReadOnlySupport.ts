/**
 * Read-Only Support Session Enforcement — Phase 4.
 *
 * When a platform actor is operating under a read-only support session,
 * ALL mutating HTTP methods on tenant-scoped (/api) routes are rejected
 * with code READ_ONLY_SUPPORT_SESSION. This is the canonical server-side
 * guard — it sits between auth/impersonation middleware and route handlers
 * so every POST/PATCH/PUT/DELETE that would otherwise touch tenant state
 * is blocked regardless of which service the route dispatches to.
 *
 * UI restrictions are NOT a substitute for this middleware.
 *
 * The /api/platform/* surface is exempt — platform ops actions (including
 * session lifecycle mutations) must remain available even when the
 * platform actor holds a read-only session against some tenant.
 */

import type { Request, Response, NextFunction } from "express";
import { platformAuditService } from "../services/platformAuditService";

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export function enforceReadOnlySupport(req: Request, res: Response, next: NextFunction) {
  if (!req.isReadOnlySupport || !req.supportSession) return next();

  // Platform ops routes are not tenant mutations — allow them.
  if (req.path.startsWith("/api/platform")) return next();

  // Only /api routes are tenant-scoped.
  if (!req.path.startsWith("/api")) return next();

  if (!MUTATING_METHODS.has(req.method.toUpperCase())) return next();

  const actor = (req as any).realUser ?? req.user;
  platformAuditService
    .logReadOnlyMutationBlocked(
      actor?.id ?? "unknown",
      actor?.email ?? "unknown",
      req.supportSession.id,
      req.supportSession.companyId,
      req.method,
      req.originalUrl || req.path,
      req,
    )
    .catch((err) => {
      console.error("[support-session] read-only audit write failed:", err);
    });

  return res.status(403).json({
    error: "Forbidden",
    code: "READ_ONLY_SUPPORT_SESSION",
    message: "This support session is read-only. Mutations are not permitted.",
  });
}
