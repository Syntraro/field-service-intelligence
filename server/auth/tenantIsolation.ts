import type { Request, Response, NextFunction, RequestHandler } from "express";
// 2026-05-04 Phase 7: removed `isPlatformRole` import (and the
// `platformAuditService` audit call that fired alongside it). The
// runtime `req.user.role` check was structurally impossible after
// Phase 6 added the DB CHECK constraint to `users.role` — every
// value is now a canonical tenant role string by definition, so
// the audit could never fire.

/**
 * CRITICAL SECURITY MIDDLEWARE
 *
 * Guarantees:
 * - Every authenticated /api request has a valid tenant/company context
 * - Tenant context is derived ONLY from the authenticated user (or impersonation)
 * - req.companyId is set for convenient downstream access
 *
 * This middleware must run AFTER authentication (passport + requireAuth)
 * but BEFORE any route handlers.
 */

declare global {
  namespace Express {
    interface Request {
      companyId?: string;
    }
    interface User {
      id: string;
      email?: string;
      role?: string;
      companyId: string;
      impersonatedById?: string | null;
    }
  }
}

/**
 * Type-safe request interface for routes that run after requireAuth + ensureTenantContext.
 * Use this instead of Express.Request in route handlers to get type-level guarantees
 * for companyId and user, eliminating the need for non-null assertions.
 * 
 * Usage:
 *   router.get("/", async (req: AuthedRequest, res: Response) => {
 *     const companyId = req.companyId; // string, not string | undefined
 *     const userId = req.user.id;       // guaranteed to exist
 *   });
 */
export interface AuthedRequest extends Request {
  companyId: string;
  user: Express.User;
}

/**
 * Ensures authenticated user has valid company context and attaches req.companyId.
 */
export const ensureTenantContext: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (!req.path.startsWith("/api")) return next();

  // Skip for public endpoints (they don't need tenant context)
  const publicEndpoints = [
    "/api/auth/login",
    "/api/auth/logout",
    "/api/invitations/accept",
    "/api/health",
    "/api/csrf-token",
    "/api/qbo/oauth/callback", // OAuth callback reads tenant from session state
  ];

  if (publicEndpoints.some(endpoint => req.path.startsWith(endpoint))) {
    return next();
  }

  // Portal routes manage their own tenant context via session.portal
  if (req.path.startsWith("/api/portal")) {
    return next();
  }

  // Platform Ops routes manage their own RBAC via requirePlatformRole and
  // deliberately operate outside tenant context. Phase 1 (Platform Admin
  // Foundation): tenant scoping does not apply here.
  if (req.path.startsWith("/api/platform")) {
    return next();
  }

  const user = req.user as any;

  // Phase 4: Read-only support sessions allow platform actors onto tenant
  // routes WITHOUT swapping req.user. Tenant scoping is derived from the
  // support session's companyId rather than user.companyId. The read-only
  // mutation block (enforceReadOnlySupport middleware) prevents writes.
  if (req.isReadOnlySupport && req.supportSession) {
    req.companyId = req.supportSession.companyId;
    return next();
  }

  const companyId = user?.companyId;

  // 2026-05-04 Phase 7: removed the `isPlatformRole(user?.role)` gate.
  // After Phase 6 added the DB CHECK constraint on `users.role`, no
  // tenant `req.user` can hold a platform role string — the column
  // physically rejects platform values. The check was dead code.
  // Platform admins reach tenant routes EXCLUSIVELY via the
  // impersonation flow (`req.isImpersonating === true`, where
  // `req.user` is the impersonated TENANT target, not the platform
  // admin themselves). The platform admin's own identity stays
  // psid-bound on `req.platformUser`.

  if (!companyId || typeof companyId !== "string") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  req.companyId = companyId;
  return next();
};

/**
 * Lightweight per-tenant + per-IP rate limiter (no external deps).
 *
 * NOTE: If you already use express-rate-limit, you can replace this with that.
 * This implementation is safe and works in single-process deployments.
 * For multi-instance deployments, move to a shared store (Redis).
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function nowMs() {
  return Date.now();
}

function makeKey(req: Request, scope: string) {
  const companyId = (req as any).companyId || (req.user as any)?.companyId || "unknown";
  const ip = req.ip || (req.headers["x-forwarded-for"] as string) || "unknown";
  return `${scope}:${companyId}:${ip}`;
}

// Cleanup expired buckets every 5 minutes to prevent memory leak.
// 2026-04-14 Phase 2 hygiene: `.unref()` so this in-process timer never
// blocks SIGTERM. Bucket cleanup is a memory-hygiene concern only; losing
// the tick during shutdown is fine.
setInterval(() => {
  const now = nowMs();
  buckets.forEach((bucket, key) => {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  });
}, 5 * 60 * 1000).unref();

export function rateLimitPerTenant(options?: {
  windowMs?: number;
  max?: number;
  scope?: string;
}): RequestHandler {
  const windowMs = options?.windowMs ?? 60_000; // 1 minute
  const max = options?.max ?? 1200; // per tenant+ip per window
  const scope = options?.scope ?? "api";

  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api")) return next();

    const key = makeKey(req, scope);
    const t = nowMs();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= t) {
      buckets.set(key, { count: 1, resetAt: t + windowMs });
      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", String(max - 1));
      res.setHeader("X-RateLimit-Reset", String(Math.floor((t + windowMs) / 1000)));
      return next();
    }

    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);

    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.floor(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - t) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: "Too many requests" });
    }

    return next();
  };
}

/**
 * Very small audit helper for sensitive routes. This does NOT persist by itself.
 * If you have server/services/audit.ts, wire it there and call that from routes.
 */
export function auditSensitiveAction(action: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // Only annotate; actual persistence should be handled by your audit service
    (req as any)._auditAction = action;
    return next();
  };
}