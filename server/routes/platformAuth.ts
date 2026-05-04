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
// 2026-05-04 Phase 5: removed `storage` and `isPlatformRole` imports.
// The legacy-fallback branch (the only consumer of either) is gone;
// platform login resolves identity exclusively through
// `platformIdentityRepository`, whose return shape already encodes
// "is this a platform identity" by virtue of querying the
// `platform_users` table.
import { platformAuditService } from "../services/platformAuditService";
import {
  requirePlatformSession,
  PLATFORM_SESSION_COOKIE_NAME,
  type PlatformSessionData,
} from "../auth/platformSession";
// 2026-04-22 Revised Phase 1: canonical capability registry.
import { capabilitiesForRoles } from "@shared/platformCapabilities";
// 2026-05-03: platform-only password reset (separate token surface
// from the tenant reset flow).
import {
  requestPlatformPasswordReset,
  confirmPlatformPasswordReset,
} from "../services/platformPasswordResetService";
// 2026-05-03: AuditAction type pulled in directly so logAudit() can
// type its `action` argument instead of casting `as any`. The union
// now includes every platform_* event emitted by this file.
import type { AuditAction } from "../services/platformAuditService";
// 2026-05-04 Phase 2-A: dedicated platform identity tables. Login
// reads from here first; falls back to the legacy `users` path
// during the deployment window (Phase 3.5) and stops once the
// destructive cleanup migration in Phase 5 deletes the legacy rows.
import { platformIdentityRepository } from "../storage/platformIdentity";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

async function logAudit(
  // 2026-05-03: typed `action` instead of `string`. Every callsite in
  // this file passes a literal that exists in the AuditAction union;
  // a typo (or a removed member) now fails at compile time. The
  // previous `action as any` cast inside the body is no longer
  // necessary.
  action: AuditAction,
  req: Request,
  opts: { userId?: string | null; email?: string | null; details?: Record<string, unknown> },
) {
  try {
    await platformAuditService.log({
      platformAdminId: opts.userId ?? "unknown",
      platformAdminEmail: opts.email ?? "unknown",
      action,
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

    // 2026-05-04 Phase 5: identity comes EXCLUSIVELY from the dedicated
    // platform tables. The Phase 3.5 fallback to `users WHERE role IN
    // PLATFORM_ROLES` was removed in this commit alongside the
    // destructive cleanup migration that emptied those rows. There is
    // no longer a legitimate path for a platform identity to exist in
    // `users`; if a row appears there in the future via mistake or
    // backup-restore drift, it would NOT be picked up here.
    const fromNew = await platformIdentityRepository.findPlatformUserByEmail(normalizedEmail);
    const resolved = fromNew
      ? {
          userId: fromNew.user.id,
          email: fromNew.user.email,
          fullName: fromNew.user.fullName ?? null,
          passwordHash: fromNew.identity.passwordHash ?? null,
          tokenVersion: fromNew.user.tokenVersion ?? 0,
          disabled: fromNew.user.disabled,
          status: fromNew.user.status,
          roles: fromNew.roles,
        }
      : null;

    if (!resolved) {
      await logAudit("platform_login_failed", req, {
        email: normalizedEmail,
        details: { reason: "no_account" },
      });
      throw createError(401, "Invalid email or password");
    }

    if (!resolved.passwordHash) {
      await logAudit("platform_login_failed", req, {
        userId: resolved.userId,
        email: resolved.email,
        details: { reason: "no_password_set" },
      });
      throw createError(
        401,
        "Account not activated yet. Please reset your password.",
      );
    }

    const valid = await bcrypt.compare(password, resolved.passwordHash);
    if (!valid) {
      await logAudit("platform_login_failed", req, {
        userId: resolved.userId,
        email: resolved.email,
        details: { reason: "bad_password" },
      });
      throw createError(401, "Invalid email or password");
    }

    if (resolved.disabled || resolved.status === "deactivated") {
      await logAudit("platform_login_failed", req, {
        userId: resolved.userId,
        email: resolved.email,
        details: { reason: "account_disabled" },
      });
      throw createError(403, "Account is disabled");
    }

    if (resolved.roles.length === 0) {
      // Defense-in-depth: half-provisioned platform user with no roles.
      await logAudit("platform_login_rejected_non_platform", req, {
        userId: resolved.userId,
        email: resolved.email,
        details: { reason: "no_roles" },
      });
      throw createError(
        403,
        "This account does not have a platform role assigned.",
      );
    }

    const ps = req.platformSession as PlatformSessionData | undefined;
    if (!ps) {
      // platformSessionMiddleware wasn't mounted — misconfiguration. Surface
      // loudly rather than silently writing nothing.
      throw createError(500, "Platform session not initialized");
    }

    ps.platformUserId = resolved.userId;
    ps.platformTokenVersion = resolved.tokenVersion;
    ps.loggedInAt = Date.now();

    // Explicit save so the cookie is committed before the response lands.
    await new Promise<void>((resolve, reject) => {
      if (typeof ps.save !== "function") return resolve();
      ps.save((err: any) => (err ? reject(err) : resolve()));
    });

    // Best-effort: stamp last_login_at. Failure is non-fatal — the
    // login already succeeded.
    platformIdentityRepository.recordPlatformLogin(resolved.userId).catch(() => {});

    await logAudit("platform_login", req, {
      userId: resolved.userId,
      email: resolved.email,
      // 2026-05-04 Phase 5: the previous Phase 2-A `identitySource`
      // field is no longer emitted in this payload — there is only
      // one source now. Audit log readers that previously filtered
      // on the value "legacy_users" can stop checking; the expected
      // value is always implicitly "platform_users".
      details: { roles: resolved.roles },
    });

    // 2026-04-22 Revised Phase 1: return the capability set alongside the
    // identity so the client's initial render doesn't need a follow-up
    // round-trip to `/me` to decide which nav items to show.
    const roles = resolved.roles;
    const capabilities = Array.from(capabilitiesForRoles(roles));

    res.json({
      user: {
        id: resolved.userId,
        email: resolved.email,
        // Backward-compat: clients still read `.role` (singular). Today
        // every platform user has exactly one role, so emit roles[0].
        role: resolved.roles[0],
        fullName: resolved.fullName,
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

// ============================================================================
// 2026-05-03: Platform-only password reset
// ============================================================================
//
// Two endpoints separate from the tenant `/api/auth/password-reset-*` flow:
//
//   POST /api/platform/auth/request-reset { email }
//     → 200 { ok: true } unconditionally (no enumeration). Only platform-role
//       emails actually receive a reset email; tenant emails fall through silently.
//
//   POST /api/platform/auth/reset-password { token, newPassword }
//     → 200 { ok: true } on success; 400 on invalid/expired token / weak password
//       / role-no-longer-platform.
//
// Tokens come from `platform_password_reset_tokens` (separate table). A
// tenant reset link CANNOT be redeemed here and a platform reset link
// CANNOT be redeemed at the tenant endpoint. Successful confirm bumps
// the user's `tokenVersion` to invalidate every existing psid session.

const requestResetSchema = z.object({
  email: z.string().email(),
});

router.post(
  "/request-reset",
  asyncHandler(async (req: Request, res: Response) => {
    const { email } = validateSchema(requestResetSchema, req.body);
    const requestIp =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
      req.ip ||
      null;
    const requestOrigin = (req.headers.origin as string | undefined) ?? null;

    const result = await requestPlatformPasswordReset({
      email,
      requestIp,
      requestOrigin,
    });

    // Audit ALWAYS — both the deliverable and silent-noop branches.
    // `result.userId` is null when the email matched no user OR matched
    // a tenant-only user; we do not distinguish in the audit row to
    // keep the same no-enumeration shape the response uses.
    await logAudit("platform_password_reset_requested", req, {
      userId: result.userId ?? null,
      email: email.trim().toLowerCase(),
      details: { delivered: result.delivered },
    });

    // Generic success — never reveal whether the email matched a
    // platform account, a tenant account, or no account at all.
    res.json({ ok: true });
  }),
);

const confirmResetSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

router.post(
  "/reset-password",
  asyncHandler(async (req: Request, res: Response) => {
    const { token, newPassword } = validateSchema(confirmResetSchema, req.body);

    const result = await confirmPlatformPasswordReset({
      rawToken: token,
      newPassword,
    });

    if (!result.ok) {
      // Don't help an attacker distinguish missing vs expired vs role-changed.
      // Weak passwords get their own message because the user submitted them
      // — that's not enumeration.
      if (result.error === "weak_password") {
        throw createError(400, "Password must be at least 8 characters");
      }
      throw createError(
        400,
        "This reset link is invalid or has expired. Please request a new one.",
      );
    }

    await logAudit("platform_password_reset_completed", req, {
      userId: result.userId ?? null,
      email: null,
      details: {},
    });

    res.json({ ok: true });
  }),
);

export default router;
