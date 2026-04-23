import type { Request, Response, NextFunction } from "express";
import { impersonationService } from "./impersonationService";
import { userRepository } from "./storage/users";
import type { IStorage } from "./storage";
import type { AuthenticatedUser, ImpersonationSession } from "@shared/schema";
import { runWithSupportContext } from "./auth/supportContext";

// Extend Express Request type to include impersonation context
declare global {
  namespace Express {
    interface Request {
      realUser?: AuthenticatedUser;
      isImpersonating?: boolean;
      impersonationSessionId?: string;
      // Phase 4 — support session context
      supportSession?: ImpersonationSession;
      isReadOnlySupport?: boolean;
    }
  }
}

/**
 * Middleware that checks for active impersonation and switches user context.
 *
 * 2026-04-22 Phase 2-lite Platform Auth Separation:
 *   The middleware now runs BEFORE the tenant `requireAuth` gate and can
 *   BOOTSTRAP `req.user` from a valid `imp_session` cookie alone — i.e.,
 *   a platform admin who is only authenticated via psid (no tenant sid)
 *   can still hit tenant routes while impersonating. This unblocks the
 *   tenant-login-for-platform-admins kill-switch flip.
 *
 *   Specifically:
 *     - Impersonation mode (accessMode="impersonation"): if no tenant
 *       session is present, synthesize req.realUser from the imp_session's
 *       ownerUserId (the platform admin) and populate req.user with the
 *       impersonated target tenant user, then `requireAuth` passes.
 *     - Read-only mode (accessMode="read_only"): STILL requires a tenant
 *       session today. A platform admin with only psid + imp_session
 *       read-only will mark the session on the request but downstream
 *       `requireAuth` will 401. Full read-only bootstrap from psid is a
 *       Phase 3 concern (read-only viewing without any tenant identity
 *       requires rewiring tenantIsolation to prefer session.companyId).
 *
 * When impersonation is active:
 * - req.user is set to the TARGET user (impersonated user)
 * - req.realUser preserves the ORIGINAL user (owner/admin who is impersonating)
 * - req.isImpersonating is set to true
 * - req.impersonationSessionId holds the session ID
 *
 * Session validation is unchanged: cookie → DB lookup → expiry + idle checks.
 */
export function impersonationMiddleware(_storage: IStorage) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Session validation depends only on the imp_session cookie + DB row.
      // It does NOT require a tenant session — the cookie is independently
      // signed by impersonationService.
      const session = await impersonationService.checkImpersonation(req, res);
      if (!session) return next();

      // Attach support-session context regardless of mode so downstream
      // middleware can reason about it consistently.
      (req as any).supportSession = session;
      (req as any).impersonationSessionId = session.id;

      const hadTenantUser = !!(req.isAuthenticated?.() && req.user);

      if (session.accessMode === "read_only") {
        // Read-only mode: DO NOT swap req.user. If a tenant session is
        // present, the platform admin stays authenticated as themselves.
        // If no tenant session is present, we intentionally leave req.user
        // unset — Phase 3 will teach tenantIsolation + routes to bootstrap
        // from session.companyId for read-only support. Today the downstream
        // requireAuth will 401 in that case; operator must hold a tenant
        // session to use read-only support.
        if (hadTenantUser) {
          (req as any).isReadOnlySupport = true;
          (req as any).isImpersonating = false;
          (req as any).realUser = req.user;
        }
      } else {
        // Impersonation mode: swap req.user to the target user.
        (req as any).isImpersonating = true;

        if (session.targetUserId) {
          const targetUser = await userRepository.getAuthenticatedUser(session.targetUserId);
          if (targetUser) {
            if (hadTenantUser) {
              // Legacy path: real actor is the authenticated tenant user
              // (which IS the platform admin in the pre-separation flow).
              (req as any).realUser = req.user;
            } else {
              // Phase 2-lite bootstrap: synthesize realUser from the
              // session's ownerUserId. Full identity isn't needed for
              // downstream handlers — only the actor id is authoritative
              // for audit writes + support-context.
              (req as any).realUser = {
                id: session.ownerUserId,
                email: "unknown",
              } as unknown as AuthenticatedUser;
            }
            (req as any).user = {
              ...targetUser,
              impersonatedById: session.ownerUserId,
              impersonationSessionId: session.id,
            } as AuthenticatedUser;
          }
        }
      }

      // Establish ambient request-scoped support context so service-layer
      // mutation guards (assertWritableSupportContext) can enforce read-only
      // without needing req passed explicitly.
      const realActor = (req as any).realUser ?? req.user;
      return runWithSupportContext(
        {
          session,
          actor: {
            id: realActor?.id ?? session.ownerUserId,
            email: realActor?.email ?? "unknown",
          },
          isReadOnly: session.accessMode === "read_only",
          req,
        },
        () => next(),
      );
    } catch (err) {
      // SECURITY FIX: Log errors but don't block requests
      console.error("[IMPERSONATION] Error in impersonation middleware:", err);
      return next();
    }
  };
}

/**
 * Middleware to update last activity timestamp on each request.
 * Kept for backwards compatibility.
 */
export function trackActivity(req: Request, _res: Response, next: NextFunction) {
  try {
    const svc: any = impersonationService as any;
    if (req.isAuthenticated?.() && req.user && typeof svc.trackActivity === "function") {
      svc.trackActivity((req.user as any).id);
    }
  } catch (err) {
    // SECURITY FIX: Log errors silently
    console.error("[IMPERSONATION] Error tracking activity:", err);
  }
  return next();
}
