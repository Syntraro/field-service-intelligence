/**
 * Platform Auth Routes — SaaS Admin Phase 1.
 *
 * 2026-04-22: dedicated login endpoints for the internal /platform admin
 * console. Distinct from tenant auth (`/api/auth/*`): a separate cookie
 * (`psid`), a separate session store scope, and a login strategy that
 * REJECTS any non-platform-role account. Tenant users can never acquire
 * a platform session by hitting /api/platform/auth/login.
 *
 * Preserves impersonation: a platform admin still has their own
 * `impersonationService` flow — this layer only establishes the platform
 * admin's own identity.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { storage } from "../storage/index";
import { isPlatformRole } from "../auth/roles";
import { platformAuditService } from "../services/platformAuditService";
import {
  requirePlatformSession,
  PLATFORM_SESSION_COOKIE_NAME,
  type PlatformSessionData,
} from "../auth/platformSession";
// 2026-04-22 Revised Phase 1: canonical capability registry.
import { capabilitiesForRoles } from "@shared/platformCapabilities";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

async function logAudit(
  action: string,
  req: Request,
  opts: { userId?: string | null; email?: string | null; details?: Record<string, unknown> },
) {
  try {
    await platformAuditService.log({
      platformAdminId: opts.userId ?? "unknown",
      platformAdminEmail: opts.email ?? "unknown",
      action: action as any,
      req,
      details: opts.details ?? {},
    });
  } catch (err) {
    // Never let audit infrastructure break auth flow.
    console.error(`[platformAuth] audit '${action}' failed:`, err);
  }
}

/**
 * POST /api/platform/auth/login
 *
 * Email + password. Rejects non-platform-role accounts even with a valid
 * password. On success, writes `platformUserId` + `platformTokenVersion`
 * onto `req.platformSession` and returns the authenticated identity.
 */
router.post(
  "/login",
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = validateSchema(loginSchema, req.body);
    const normalizedEmail = email.trim().toLowerCase();

    const result = await storage.findUserByEmailGlobal(normalizedEmail);
    if (!result) {
      await logAudit("platform_login_failed", req, {
        email: normalizedEmail,
        details: { reason: "no_account" },
      });
      throw createError(401, "Invalid email or password");
    }

    const { user, identity } = result;

    if (!identity.passwordHash) {
      await logAudit("platform_login_failed", req, {
        userId: user.id,
        email: user.email,
        details: { reason: "no_password_set" },
      });
      throw createError(
        401,
        "Account not activated yet. Please reset your password.",
      );
    }

    const valid = await bcrypt.compare(password, identity.passwordHash);
    if (!valid) {
      await logAudit("platform_login_failed", req, {
        userId: user.id,
        email: user.email,
        details: { reason: "bad_password" },
      });
      throw createError(401, "Invalid email or password");
    }

    if ((user as any).disabled || user.status === "deactivated") {
      await logAudit("platform_login_failed", req, {
        userId: user.id,
        email: user.email,
        details: { reason: "account_disabled" },
      });
      throw createError(403, "Account is disabled");
    }

    if (!isPlatformRole(user.role)) {
      // A tenant user trying the platform login is notable — tenants should
      // never reach this endpoint. Surface-level audit so attempts are
      // visible to ops.
      await logAudit("platform_login_rejected_non_platform", req, {
        userId: user.id,
        email: user.email,
        details: { role: user.role },
      });
      throw createError(
        403,
        "This account is not a platform admin. Use the tenant login.",
      );
    }

    const ps = req.platformSession as PlatformSessionData | undefined;
    if (!ps) {
      // platformSessionMiddleware wasn't mounted — misconfiguration. Surface
      // loudly rather than silently writing nothing.
      throw createError(500, "Platform session not initialized");
    }

    ps.platformUserId = user.id;
    ps.platformTokenVersion = user.tokenVersion ?? 0;
    ps.loggedInAt = Date.now();

    // Explicit save so the cookie is committed before the response lands.
    await new Promise<void>((resolve, reject) => {
      if (typeof ps.save !== "function") return resolve();
      ps.save((err: any) => (err ? reject(err) : resolve()));
    });

    await logAudit("platform_login", req, {
      userId: user.id,
      email: user.email,
      details: { role: user.role },
    });

    // 2026-04-22 Revised Phase 1: return the capability set alongside the
    // identity so the client's initial render doesn't need a follow-up
    // round-trip to `/me` to decide which nav items to show.
    const roles = [user.role];
    const capabilities = Array.from(capabilitiesForRoles(roles));

    res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.fullName,
        roles,
        capabilities,
      },
    });
  }),
);

/**
 * POST /api/platform/auth/logout
 *
 * Destroys the psid session and clears the cookie. Idempotent — an already
 * logged-out caller gets `{ ok: true }`.
 */
router.post(
  "/logout",
  asyncHandler(async (req: Request, res: Response) => {
    const ps = req.platformSession as PlatformSessionData | undefined;
    const userId = ps?.platformUserId ?? null;

    if (ps && typeof ps.destroy === "function") {
      await new Promise<void>((resolve) => {
        ps.destroy!((err: any) => {
          if (err) console.error("[platformAuth] logout destroy failed:", err);
          resolve();
        });
      });
    }
    res.clearCookie(PLATFORM_SESSION_COOKIE_NAME);

    if (userId) {
      await logAudit("platform_logout", req, { userId });
    }
    res.json({ ok: true });
  }),
);

/**
 * GET /api/platform/auth/me
 *
 * Returns the currently authenticated platform user. 401 if not logged in.
 */
router.get(
  "/me",
  requirePlatformSession,
  (req: Request, res: Response) => {
    res.json({ user: req.platformUser });
  },
);

export default router;
