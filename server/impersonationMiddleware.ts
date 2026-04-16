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
 * When impersonation is active:
 * - req.user is set to the TARGET user (impersonated user)
 * - req.realUser preserves the ORIGINAL user (owner/admin who is impersonating)
 * - req.isImpersonating is set to true
 * - req.impersonationSessionId holds the session ID
 *
 * This allows tenant isolation to work seamlessly while preserving
 * the ability to identify the real user for audit purposes.
 *
 * Session validation:
 * - Loads session from httpOnly cookie
 * - Checks expiry and idle timeout
 * - Automatically ends expired/idle sessions
 * - Updates lastSeenAt on active sessions
 */
export function impersonationMiddleware(_storage: IStorage) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Only process if user is authenticated
      if (!req.isAuthenticated?.() || !req.user) return next();

      // Check for active impersonation session (includes expiry/idle validation)
      // Pass res so the service can clear cookies if session is invalid
      const session = await impersonationService.checkImpersonation(req, res);

      if (session) {
        // Phase 4: attach support-session context regardless of mode so
        // downstream middleware (tenantIsolation, read-only enforcement)
        // can reason about it consistently.
        (req as any).supportSession = session;
        (req as any).impersonationSessionId = session.id;

        if (session.accessMode === "read_only") {
          // Read-only mode: DO NOT swap req.user. The platform admin stays
          // authenticated as themselves. tenantIsolation will honor the
          // session's companyId to scope tenant data access.
          (req as any).isReadOnlySupport = true;
          (req as any).isImpersonating = false;
          (req as any).realUser = req.user;
        } else {
          // Impersonation mode: swap req.user to the target user, preserving
          // the real actor on req.realUser. This matches pre-Phase-4 behavior.
          (req as any).realUser = req.user;
          (req as any).isImpersonating = true;

          if (session.targetUserId) {
            const targetUser = await userRepository.getAuthenticatedUser(session.targetUserId);
            if (targetUser) {
              (req as any).user = {
                ...targetUser,
                impersonatedById: session.ownerUserId,
                impersonationSessionId: session.id,
              } as AuthenticatedUser;
            }
          }
        }

        // Phase 5: establish ambient request-scoped support context so
        // service-layer mutation guards (assertWritableSupportContext)
        // can enforce read-only without needing req passed explicitly.
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
      }

      return next();
    } catch (err) {
      // SECURITY FIX: Log errors but don't block requests
      console.error('[IMPERSONATION] Error in impersonation middleware:', err);
      // Never block the request due to audit/impersonation plumbing issues
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
    console.error('[IMPERSONATION] Error tracking activity:', err);
  }
  return next();
}