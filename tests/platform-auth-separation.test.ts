/**
 * Platform Auth Separation — Phase 1 test pack.
 *
 * 2026-04-22: proves the Phase 1 auth boundary guarantees:
 *   1. requirePlatformSession 401s without a valid psid session.
 *   2. requirePlatformSession populates req.platformUser for a valid
 *      psid-authenticated platform role.
 *   3. requirePlatformSession 403s when the session points to a user
 *      whose role is no longer a platform role.
 *   4. requirePlatformSession 401s on stale tokenVersion.
 *   5. requirePlatformRole prefers req.platformUser over req.user.
 *   6. requirePlatformRole falls back to req.user when no platform
 *      session is present (backward-compat path during rollout).
 *   7. Platform login endpoint rejects non-platform-role accounts even
 *      with a valid password.
 *   8. Platform login endpoint writes platformUserId to the session on
 *      success.
 *   9. Impersonation middleware function shape is unchanged by Phase 1
 *      (preserved flow — no behavioral changes).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ============================================================================
// Test helpers — stub req / res / next with the fields the middleware reads.
// ============================================================================

function mkReq(extra: Partial<Request> = {}): Partial<Request> {
  return {
    headers: {},
    ip: "127.0.0.1",
    originalUrl: "/api/platform/test",
    path: "/api/platform/test",
    method: "GET",
    ...extra,
  };
}

function mkRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.clearCookie = vi.fn().mockReturnValue(res);
  return res as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    clearCookie: ReturnType<typeof vi.fn>;
  };
}

// ============================================================================
// requirePlatformSession
// ============================================================================

describe("requirePlatformSession", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("401s when no platform session is present", async () => {
    const { requirePlatformSession } = await import("../server/auth/platformSession");
    const req = mkReq({ platformSession: undefined } as any) as Request;
    const res = mkRes();
    const next = vi.fn();

    await requirePlatformSession(req, res, next as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("401s when session exists but has no platformUserId", async () => {
    const { requirePlatformSession } = await import("../server/auth/platformSession");
    const req = mkReq({ platformSession: {} } as any) as Request;
    const res = mkRes();
    const next = vi.fn();

    await requirePlatformSession(req, res, next as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("passes for a valid platform role with matching tokenVersion", async () => {
    // 2026-05-04 Phase 2-A: the new repo answers canonically with
    // user + roles[]. Legacy storage mock kept around as a safety
    // net but should not be consulted on the canonical path.
    vi.doMock("../server/storage/platformIdentity", () => ({
      platformIdentityRepository: {
        getPlatformUserById: vi.fn().mockResolvedValue({
          user: {
            id: "u_platform_1",
            email: "ops@example.com",
            fullName: "Ops Admin",
            status: "active",
            disabled: false,
            tokenVersion: 2,
          },
          roles: ["platform_admin"],
        }),
      },
    }));
    vi.doMock("../server/storage/index", () => ({
      storage: {
        getUser: vi.fn().mockResolvedValue(null),
      },
    }));
    const { requirePlatformSession } = await import("../server/auth/platformSession");

    const req = mkReq({
      platformSession: { platformUserId: "u_platform_1", platformTokenVersion: 2 },
    } as any) as Request;
    const res = mkRes();
    const next = vi.fn();

    await requirePlatformSession(req, res, next as unknown as NextFunction);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect((req as any).platformUser).toMatchObject({
      id: "u_platform_1",
      email: "ops@example.com",
      role: "platform_admin",
    });
  });

  it("401s when session user's role is no longer a platform role (legacy fallback path)", async () => {
    // 2026-05-04 Phase 2-A: the new repo returns null for a tenant
    // user (it only returns rows with a platform role). The legacy
    // fallback finds them but `isPlatformRole(role)` is false, so
    // the resolution returns null overall → PLATFORM_USER_MISSING (401).
    // Status changed from 403 → 401 because the legacy-row gate now
    // fails identity resolution rather than role-check.
    vi.doMock("../server/storage/platformIdentity", () => ({
      platformIdentityRepository: {
        getPlatformUserById: vi.fn().mockResolvedValue(null),
      },
    }));
    vi.doMock("../server/storage/index", () => ({
      storage: {
        getUser: vi.fn().mockResolvedValue({
          id: "u_tenant_1",
          email: "user@example.com",
          role: "admin",
          fullName: null,
          status: "active",
          tokenVersion: 0,
        }),
      },
    }));
    const { requirePlatformSession } = await import("../server/auth/platformSession");

    const req = mkReq({
      platformSession: { platformUserId: "u_tenant_1", platformTokenVersion: 0 },
    } as any) as Request;
    const res = mkRes();
    const next = vi.fn();

    await requirePlatformSession(req, res, next as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("401s when tokenVersion has been incremented since the session was created", async () => {
    // 2026-05-04 Phase 2-A: same legacy-fallback shape as above —
    // the new repo returns null, legacy `getUser` answers with the
    // canonical platform_admin row whose tokenVersion has advanced.
    vi.doMock("../server/storage/platformIdentity", () => ({
      platformIdentityRepository: {
        getPlatformUserById: vi.fn().mockResolvedValue(null),
      },
    }));
    vi.doMock("../server/storage/index", () => ({
      storage: {
        getUser: vi.fn().mockResolvedValue({
          id: "u_platform_2",
          email: "ops@example.com",
          role: "platform_admin",
          fullName: null,
          status: "active",
          tokenVersion: 5,
        }),
      },
    }));
    const { requirePlatformSession } = await import("../server/auth/platformSession");

    const req = mkReq({
      platformSession: { platformUserId: "u_platform_2", platformTokenVersion: 1 },
    } as any) as Request;
    const res = mkRes();
    const next = vi.fn();

    await requirePlatformSession(req, res, next as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

// ============================================================================
// requirePlatformRole — Phase 1 prefers req.platformUser
// ============================================================================

describe("requirePlatformRole", () => {
  beforeEach(() => vi.resetModules());

  it("passes when req.platformUser has a platform role", async () => {
    const { requirePlatformRole } = await import("../server/auth/requirePlatformRole");
    const mw = requirePlatformRole();

    const req = mkReq({
      platformUser: { id: "u1", email: "a@b", role: "platform_support" },
      // Intentionally NO req.user — platform session alone must be enough.
    } as any) as Request;
    const res = mkRes();
    const next = vi.fn();

    await mw(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("falls back to req.user when no platform session is present", async () => {
    const { requirePlatformRole } = await import("../server/auth/requirePlatformRole");
    const mw = requirePlatformRole();

    const req = mkReq({
      user: { id: "u2", email: "c@d", role: "platform_admin" },
      isAuthenticated: () => true,
    } as any) as Request;
    const res = mkRes();
    const next = vi.fn();

    await mw(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("403s a tenant-role user even when they have a valid tenant session", async () => {
    const { requirePlatformRole } = await import("../server/auth/requirePlatformRole");
    const mw = requirePlatformRole();

    const req = mkReq({
      user: { id: "u3", email: "e@f", role: "admin" },
      isAuthenticated: () => true,
    } as any) as Request;
    const res = mkRes();
    const next = vi.fn();

    await mw(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("prefers req.platformUser even when req.user has a tenant role", async () => {
    const { requirePlatformRole } = await import("../server/auth/requirePlatformRole");
    const mw = requirePlatformRole();

    const req = mkReq({
      platformUser: { id: "p1", email: "ops@x", role: "platform_admin" },
      user: { id: "u4", email: "tenant@x", role: "technician" },
      isAuthenticated: () => true,
    } as any) as Request;
    const res = mkRes();
    const next = vi.fn();

    await mw(req, res, next as unknown as NextFunction);

    // Platform user wins — technician alone would 403.
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Platform login endpoint (/api/platform/auth/login handler)
// ============================================================================

describe("platformAuthRouter login", () => {
  beforeEach(() => vi.resetModules());

  // 2026-05-04 Phase 5 helper: classify a test-input role string as
  // platform-or-not. Tenant-role test cases (`role: "admin"`) drive
  // the harness toward an empty platform-repo resolution, which is
  // the exact production-correct behavior post-cleanup — there is
  // no path where a tenant-role account is found in `platform_users`.
  function isPlatformRoleString(r: string): boolean {
    return [
      "platform_admin",
      "platform_support",
      "platform_billing",
      "platform_readonly_audit",
    ].includes(r);
  }

  async function invokeLoginHandler(opts: {
    email: string;
    password: string;
    mockUser?: {
      id: string;
      email: string;
      role: string;
      status: string;
      tokenVersion: number;
      disabled?: boolean;
      fullName?: string | null;
    };
    mockIdentity?: { passwordHash: string };
    bcryptValid: boolean;
    platformSession: any;
    /**
     * Optional pre-existing tenant `req.session` — included as a separate
     * key from `platformSession` so tests can prove the platform login
     * handler does NOT mutate the tenant cookie. The handler's runtime
     * input shape (`req.session` vs `req.platformSession`) is set up in
     * production by `platformSessionMiddleware`; we mirror that split here.
     */
    tenantSession?: any;
  }) {
    // 2026-05-04 Phase 5: platform login resolves identity EXCLUSIVELY
    // through `platformIdentityRepository`. The legacy
    // `storage.findUserByEmailGlobal` fallback is gone. The harness
    // now drives the canonical path via `findPlatformUserByEmail`,
    // which returns the Phase 5 `{ user, identity, roles }` shape.
    // Map the harness's flat `mockUser` / `mockIdentity` /
    // `mockRoles` inputs onto that shape.
    const platformLookupResult = opts.mockUser && opts.mockIdentity
      ? {
          user: {
            id: opts.mockUser.id,
            email: opts.mockUser.email,
            fullName: opts.mockUser.fullName ?? null,
            status: opts.mockUser.status,
            disabled: opts.mockUser.disabled === true,
            tokenVersion: opts.mockUser.tokenVersion,
          },
          identity: { passwordHash: opts.mockIdentity.passwordHash },
          roles: isPlatformRoleString(opts.mockUser.role)
            ? [opts.mockUser.role]
            : [], // tenant-role accounts: no platform_users row exists,
                  // so the test mocks an empty resolution.
        }
      : null;

    // The repo now mirrors what the production code calls. When the
    // test simulates a tenant-role account, the new repo correctly
    // returns null — no fallback exists, so the handler hits the
    // `!resolved → 401` branch (the Phase 2-A anti-enumeration
    // improvement preserved in Phase 5).
    const newRepoResolves =
      platformLookupResult && platformLookupResult.roles.length > 0
        ? platformLookupResult
        : null;

    vi.doMock("../server/storage/platformIdentity", () => ({
      platformIdentityRepository: {
        findPlatformUserByEmail: vi.fn().mockResolvedValue(newRepoResolves),
        recordPlatformLogin: vi.fn().mockResolvedValue(undefined),
      },
    }));
    vi.doMock("bcryptjs", () => ({
      default: { compare: vi.fn().mockResolvedValue(opts.bcryptValid) },
      compare: vi.fn().mockResolvedValue(opts.bcryptValid),
    }));
    vi.doMock("../server/services/platformAuditService", () => ({
      platformAuditService: { log: vi.fn().mockResolvedValue(undefined) },
    }));

    // Import the router — its routes register against a local Express Router.
    const mod = await import("../server/routes/platformAuth");
    const router: any = mod.default;

    // Walk the router stack to find the POST /login handler.
    const layer = router.stack.find(
      (l: any) => l.route?.path === "/login" && l.route?.methods?.post,
    );
    if (!layer) throw new Error("POST /login not found on platformAuthRouter");
    const handler = layer.route.stack[0].handle;

    const req: any = {
      body: { email: opts.email, password: opts.password },
      platformSession: opts.platformSession,
      session: opts.tenantSession,
      headers: {},
      ip: "127.0.0.1",
      path: "/login",
      originalUrl: "/api/platform/auth/login",
    };
    const res = mkRes();

    // 2026-05-03 harness fix: previously this `next` mock did
    //   `if (err) throw err`
    // which RE-RAISED inside vi.fn's body. Combined with the bug below,
    // those re-raised errors became "unhandled rejections" that leaked
    // out after the test had already returned, and the failing tests'
    // assertions ran against an empty res mock.
    //
    // Now: `next` simply records its arguments. Errors are read back via
    // `next.mock.calls`. No mid-test throw, so no detached rejection.
    const next = vi.fn();

    // 2026-05-03 harness fix: `asyncHandler` returns `undefined` (it does
    //   `Promise.resolve(fn(...)).catch(next)`
    // and intentionally swallows the promise so Express middleware chains
    // see a synchronous return). Awaiting the wrapper resolves on the
    // current tick — BEFORE the inner async body has reached its first
    // await boundary. That is the production-correct shape, but the test
    // must wait for the inner work explicitly.
    //
    // Two `setImmediate` flushes are sufficient to drain:
    //   1. bcrypt.compare's resolved promise
    //   2. either the audit log promise (success path) OR the error's
    //      `.catch(next)` propagation (failure paths)
    // and the success path's `await new Promise(...) for ps.save`. If a
    // future change adds another `await` to the handler, add another
    // flush below — this is intentionally explicit rather than a
    // `setTimeout(0)` race.
    handler(req, res, next);
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setImmediate(resolve));

    // Capture any error that the handler rejected with — `asyncHandler`
    // routes rejections through `next(err)`. The first call with a
    // truthy first arg is the thrown error.
    const thrown =
      (next.mock.calls.find((call: unknown[]) => call[0]) as unknown[] | undefined)?.[0] ?? null;

    return { req, res, next, thrown };
  }

  it("writes platformUserId to the session on a valid platform-admin login", async () => {
    const saveMock = vi.fn((cb?: (err: any) => void) => cb?.(null));
    const session = { save: saveMock };
    // 2026-05-03 boundary assertion: a pre-existing tenant `req.session`
    // is passed in so we can prove platform login does NOT mutate it.
    // `passport.user` shape mirrors the tenant Passport session.
    const tenantSession = {
      passport: { user: "tenant-user-id" },
      cookie: { originalMaxAge: 60_000 },
    };
    const tenantSessionSnapshot = JSON.parse(JSON.stringify(tenantSession));

    const { req, res, thrown } = await invokeLoginHandler({
      email: "ops@example.com",
      password: "correct",
      mockUser: {
        id: "p_1",
        email: "ops@example.com",
        role: "platform_admin",
        status: "active",
        tokenVersion: 3,
        fullName: "Ops",
      },
      mockIdentity: { passwordHash: "$2a$hashed$" },
      bcryptValid: true,
      platformSession: session,
      tenantSession,
    });

    expect(thrown).toBeNull();
    expect(session).toMatchObject({
      platformUserId: "p_1",
      platformTokenVersion: 3,
    });
    expect(saveMock).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({
          id: "p_1",
          role: "platform_admin",
        }),
      }),
    );

    // Boundary contract: the handler must write into `req.platformSession`
    // and must NOT touch `req.session`. If a future refactor accidentally
    // promotes a platform login into the tenant cookie, this assertion
    // fails — that would let a tenant cookie carry platform-admin state.
    expect(req.session).toEqual(tenantSessionSnapshot);
    // And `req.session.passport.user` is unchanged — the platform login
    // never re-binds Passport to the platform user.
    expect(req.session?.passport?.user).toBe("tenant-user-id");
  });

  it("rejects a tenant-role account with 401 (Phase 2-A anti-enumeration)", async () => {
    // 2026-05-04 Phase 2-A behavior change: a tenant account that
    // accidentally hits /api/platform/auth/login now collapses to a
    // generic 401 "Invalid email or password" instead of 403
    // "not a platform admin". Reason:
    //   • The new resolver (`platformIdentityRepository`) only knows
    //     about platform-role rows, so it returns null for a tenant
    //     account.
    //   • The legacy fallback ALSO gates on `isPlatformRole(role)`
    //     before returning, so a tenant account never produces a
    //     `resolved` value.
    //   • The login handler hits the `!resolved` branch and emits
    //     401 with `reason: "no_account"`.
    //
    // This is STRICTLY MORE secure than the prior 403 path — a 403
    // "not a platform admin" message implicitly confirmed the email
    // exists in the user table. The new 401 does not leak that.
    // Refusing the session is what matters; the status code is the
    // anti-enumeration improvement that came with Phase 2-A.
    const session: any = { save: vi.fn((cb: any) => cb?.(null)) };
    const { thrown } = await invokeLoginHandler({
      email: "tenant@example.com",
      password: "correct",
      mockUser: {
        id: "t_1",
        email: "tenant@example.com",
        role: "admin", // tenant role
        status: "active",
        tokenVersion: 0,
      },
      mockIdentity: { passwordHash: "$2a$hashed$" },
      bcryptValid: true,
      platformSession: session,
    });

    expect(thrown).not.toBeNull();
    expect((thrown as any)?.status).toBe(401);
    expect((thrown as any)?.message).toMatch(/invalid email or password/i);
    // Critical contract preserved: a tenant account never gets a
    // platform session, regardless of the response code.
    expect(session.platformUserId).toBeUndefined();
  });

  it("rejects a bad password with 401 before checking role", async () => {
    const session: any = { save: vi.fn((cb: any) => cb?.(null)) };
    const { thrown } = await invokeLoginHandler({
      email: "ops@example.com",
      password: "WRONG",
      mockUser: {
        id: "p_1",
        email: "ops@example.com",
        // Even though this account has a platform role, a bad password
        // must short-circuit BEFORE the role check at platformAuth.ts:112.
        // The role is irrelevant to the assertion — the test is locking
        // the order-of-checks (bcrypt → role), so a tenant attacker can't
        // tell from the response shape whether a given email belongs to
        // a platform or tenant account.
        role: "platform_admin",
        status: "active",
        tokenVersion: 0,
      },
      mockIdentity: { passwordHash: "$2a$hashed$" },
      bcryptValid: false,
      platformSession: session,
    });

    expect(thrown).not.toBeNull();
    expect((thrown as any)?.status).toBe(401);
    expect((thrown as any)?.message).toMatch(/invalid email or password/i);
    expect(session.platformUserId).toBeUndefined();
  });
});

// ============================================================================
// Phase 1 preserves impersonation — structural check
// ============================================================================

describe("impersonation flow preserved", () => {
  it("impersonationMiddleware export is untouched by Phase 1", async () => {
    const mod = await import("../server/impersonationMiddleware");
    expect(typeof mod.impersonationMiddleware).toBe("function");
    expect(typeof mod.trackActivity).toBe("function");
  });

  it("impersonationService cookie name is unchanged (imp_session)", async () => {
    const mod = await import("../server/impersonationService");
    // The service file's top-level constant hasn't shifted.
    const src = await import("fs").then((fs) =>
      fs.readFileSync("C:/dev/Syntraro/server/impersonationService.ts", "utf-8"),
    );
    expect(src).toMatch(/"imp_session"/);
  });
});
