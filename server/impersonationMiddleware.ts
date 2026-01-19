import type { Request, Response, NextFunction } from "express";
import { impersonationService } from "./impersonationService";
import { userRepository } from "./storage/users";
import type { IStorage } from "./storage";
import type { AuthenticatedUser } from "@shared/schema";

// Extend Express Request type to include impersonation context
declare global {
  namespace Express {
    interface Request {
      realUser?: AuthenticatedUser;
      isImpersonating?: boolean;
      impersonationSessionId?: string;
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
        // Store the real user (owner) for audit purposes
        (req as any).realUser = req.user;
        (req as any).isImpersonating = true;
        (req as any).impersonationSessionId = session.id;

        // Get the target user's authenticated context
        const targetUser = await userRepository.getAuthenticatedUser(session.targetUserId);

        if (targetUser) {
          // Switch req.user to the target user
          // This makes tenant isolation work seamlessly
          (req as any).user = {
            ...targetUser,
            // Add impersonation markers for audit
            impersonatedById: session.ownerUserId,
            impersonationSessionId: session.id,
          } as AuthenticatedUser;
        }
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