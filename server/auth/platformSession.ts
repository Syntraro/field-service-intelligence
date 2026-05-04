/**
 * Platform Session Middleware — SaaS Admin / Platform Auth Separation Phase 1.
 *
 * 2026-04-22: introduces a dedicated session boundary for the internal
 * platform/admin console at `/api/platform/*`. Models on the same
 * `express-session` + `connect-pg-simple` pattern as the tenant session
 * but with:
 *   - a distinct cookie name (`psid` — configurable via
 *     `PLATFORM_SESSION_COOKIE_NAME`),
 *   - a distinct signing secret (`PLATFORM_SESSION_SECRET`, fallback to
 *     `SESSION_SECRET`),
 *   - a stricter idle maxAge (30 min default).
 *
 * Shares the same `session` PgStore table as the tenant session — session
 * IDs are random, so rows never collide. A dedicated table is not required
 * and would just add a schema migration.
 *
 * The `platformSessionMiddleware` export runs the express-session middleware
 * in "shadow" mode: it captures the resulting platform session onto
 * `req.platformSession`, then RESTORES the prior tenant `req.session` so
 * Passport, CSRF, and every downstream tenant concern see their usual
 * state unchanged. This is how we coexist with the existing global tenant
 * session on the same Express app.
 *
 * The `requirePlatformSession` middleware resolves `req.platformSession`
 * to a concrete `req.platformUser` (or returns 401). It is the
 * authentication half of the new boundary; `requirePlatformRole` is the
 * authorization half.
 */

import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import { Pool } from "pg";
import type { Request, Response, NextFunction } from "express";
// 2026-05-04 Phase 5: removed `storage` and `isPlatformRole` imports.
// The legacy-fallback branch (the only consumer of either) is gone;
// `requirePlatformSession` resolves identity exclusively through
// `platformIdentityRepository`.
// 2026-04-22 Revised Phase 1: canonical capability registry. One file, one
// map, shared server + client.
import {
  capabilitiesForRoles,
  type PlatformCapability,
} from "@shared/platformCapabilities";
// Phase 2-A: read identity from the dedicated platform tables. Phase 5
// (this commit) removed the deployment-window legacy `users` fallback —
// `platform_users` is the sole identity surface.
import { platformIdentityRepository } from "../storage/platformIdentity";

const IS_PROD = process.env.NODE_ENV === "production";
const PgStore = ConnectPgSimple(session);

// Lazy pool — created on first use so the module doesn't crash on import
// if DATABASE_URL isn't set yet (tests, migrations).
let platformSessionPool: Pool | null = null;
function getPool(): Pool {
  if (!platformSessionPool) {
    platformSessionPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: IS_PROD ? { rejectUnauthorized: false } : undefined,
    });
  }
  return platformSessionPool;
}

const PLATFORM_SESSION_IDLE_MS = Number(
  process.env.PLATFORM_SESSION_MAX_AGE_MS ?? 30 * 60 * 1000, // 30 min default
);
export const PLATFORM_SESSION_COOKIE_NAME =
  process.env.PLATFORM_SESSION_COOKIE_NAME ?? "psid";

// Cache the inner middleware so we don't rebuild the PgStore on every call.
let cachedInner: ReturnType<typeof session> | null = null;
function getInner(): ReturnType<typeof session> {
  if (!cachedInner) {
    const secret =
      process.env.PLATFORM_SESSION_SECRET ||
      process.env.SESSION_SECRET ||
      "dev-platform-secret";
    cachedInner = session({
      store: new PgStore({
        pool: getPool(),
        tableName: process.env.SESSION_TABLE ?? "session",
        createTableIfMissing: true,
      }),
      secret,
      resave: false,
      rolling: true,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: IS_PROD,
        sameSite: "lax",
        maxAge: PLATFORM_SESSION_IDLE_MS,
      },
      name: PLATFORM_SESSION_COOKIE_NAME,
    });
  }
  return cachedInner;
}

export interface PlatformSessionData {
  platformUserId?: string;
  platformTokenVersion?: number;
  loggedInAt?: number;
  // express-session attaches these methods at runtime:
  save?: (cb?: (err: any) => void) => void;
  destroy?: (cb?: (err: any) => void) => void;
  regenerate?: (cb?: (err: any) => void) => void;
  touch?: () => void;
}

export interface PlatformUser {
  id: string;
  email: string;
  role: string;
  fullName: string | null;
  // 2026-04-22 Revised Phase 1: canonical role set + computed capability set.
  // Today `roles` is always `[role]` (single-role storage in users.role).
  // Phase 2's `platform_user_roles` junction populates multi-role naturally;
  // `capabilities` is the UNION and is the only field downstream code reads.
  roles: readonly string[];
  capabilities: readonly PlatformCapability[];
}

declare global {
  namespace Express {
    interface Request {
      platformSession?: PlatformSessionData;
      platformUser?: PlatformUser;
    }
  }
}

/**
 * Runs the psid-backed express-session middleware without clobbering the
 * tenant `req.session`. After it completes:
 *   - `req.platformSession` holds the platform session (may be empty).
 *   - `req.session` is restored to whatever the tenant session middleware
 *     set it to (or undefined if none was mounted).
 *
 * Mount this as a path-scoped middleware on `/api/platform` (before any
 * platform route, including platform auth).
 */
export function platformSessionMiddleware(req: Request, res: Response, next: NextFunction) {
  const tenantSession = (req as any).session;
  // Null out so express-session initializes its own state from the psid cookie.
  (req as any).session = undefined;
  (req as any).sessionID = undefined;
  (req as any).sessionStore = undefined;

  const inner = getInner();
  inner(req, res, (err?: any) => {
    if (err) {
      // Restore tenant state and propagate the error.
      (req as any).session = tenantSession;
      return next(err);
    }
    // Capture the platform session, restore tenant.
    (req as any).platformSession = (req as any).session;
    (req as any).session = tenantSession;
    next();
  });
}

/**
 * Authenticates a request against the platform session.
 *
 *   - Reads `req.platformSession.platformUserId`.
 *   - Loads the user from the canonical `users` table.
 *   - Rejects if the user is not a platform role (defense-in-depth against
 *     post-login role downgrades; `requirePlatformRole` is the other half).
 *   - Rejects if the user's `tokenVersion` no longer matches the session
 *     (same invalidation mechanism the tenant session uses).
 *
 * On success, populates `req.platformUser`. On any miss, returns 401.
 *
 * MUST be mounted AFTER `platformSessionMiddleware`.
 */
export async function requirePlatformSession(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const ps = req.platformSession;
  if (!ps?.platformUserId) {
    return res.status(401).json({ error: "Not authenticated", code: "PLATFORM_NOT_AUTHED" });
  }

  try {
    // 2026-05-04 Phase 5: identity comes EXCLUSIVELY from the dedicated
    // platform tables. The Phase 3.5 legacy `users` fallback was
    // removed in this commit alongside the destructive cleanup
    // migration. Any psid session whose `platformUserId` does not
    // resolve in `platform_users` is treated as missing → 401, which
    // forces a fresh login through the canonical surface.
    const fromNew = await platformIdentityRepository.getPlatformUserById(ps.platformUserId);
    const resolved = fromNew
      ? {
          id: fromNew.user.id,
          email: fromNew.user.email,
          fullName: fromNew.user.fullName ?? null,
          tokenVersion: fromNew.user.tokenVersion ?? 0,
          disabled: fromNew.user.disabled,
          status: fromNew.user.status,
          roles: fromNew.roles,
        }
      : null;

    if (!resolved) {
      return res.status(401).json({ error: "Not authenticated", code: "PLATFORM_USER_MISSING" });
    }
    if (resolved.tokenVersion !== (ps.platformTokenVersion ?? 0)) {
      return res.status(401).json({ error: "Session expired", code: "PLATFORM_TOKEN_VERSION_STALE" });
    }
    if (resolved.disabled || resolved.status === "deactivated") {
      return res.status(403).json({ error: "Account disabled", code: "PLATFORM_ACCOUNT_DISABLED" });
    }

    // 2026-04-22 Revised Phase 1: derive the capability set from the user's
    // role(s). Single-role today; multi-role-ready (the new platform_user_roles
    // join table can return >1 role).
    const roles = resolved.roles;
    const capabilities = Array.from(capabilitiesForRoles(roles));

    req.platformUser = {
      id: resolved.id,
      email: resolved.email,
      // Backward-compat: clients still read `.role` (singular).
      role: roles[0],
      fullName: resolved.fullName,
      roles,
      capabilities,
    };
    next();
  } catch (err) {
    console.error("[platformSession] requirePlatformSession failed:", err);
    return res.status(500).json({ error: "Platform auth check failed" });
  }
}
