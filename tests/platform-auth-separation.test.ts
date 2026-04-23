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
    vi.doMock("../server/storage/index", () => ({
      storage: {
        getUser: vi.fn().mockResolvedValue({
          id: "u_platform_1",
          email: "ops@example.com",
          role: "platform_admin",
          fullName: "Ops Admin",
          status: "active",
          tokenVersion: 2,
        }),
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

  it("403s when session user's role is no longer a platform role", async () => {
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

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("401s when tokenVersion has been incremented since the session was created", async () => {
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
  }) {
    // Mock dependencies BEFORE importing the module.
    vi.doMock("../server/storage/index", () => ({
      storage: {
        findUserByEmailGlobal: vi.fn().mockResolvedValue(
          opts.mockUser && opts.mockIdentity
            ? { user: opts.mockUser, identity: opts.mockIdentity }
            : null,
        ),
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
      headers: {},
      ip: "127.0.0.1",
      path: "/login",
      originalUrl: "/api/platform/auth/login",
    };
    const res = mkRes();
    const next = vi.fn((err?: any) => {
      if (err) throw err;
    });

    try {
      await handler(req, res, next);
    } catch (err) {
      return { req, res, thrown: err };
    }
    return { req, res, thrown: null };
  }

  it("writes platformUserId to the session on a valid platform-admin login", async () => {
    const saveMock = vi.fn((cb?: (err: any) => void) => cb?.(null));
    const session = { save: saveMock };
    const { req, res } = await invokeLoginHandler({
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
    });

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
  });

  it("rejects a tenant-role account with 403 PLATFORM_ACCOUNT even with a valid password", async () => {
    const session: any = { save: vi.fn((cb: any) => cb?.(null)) };
    const { res, thrown } = await invokeLoginHandler({
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

    // Handler throws createError(403, ...); asyncHandler surfaces it. Either
    // the error is thrown or res.status(403).json(...) was called.
    const looksLike403 =
      (thrown as any)?.status === 403 ||
      res.status.mock.calls.some((c: any) => c[0] === 403);
    expect(looksLike403).toBe(true);
    expect(session.platformUserId).toBeUndefined();
  });

  it("rejects a bad password with 401 before checking role", async () => {
    const session: any = { save: vi.fn((cb: any) => cb?.(null)) };
    const { res, thrown } = await invokeLoginHandler({
      email: "ops@example.com",
      password: "WRONG",
      mockUser: {
        id: "p_1",
        email: "ops@example.com",
        role: "platform_admin",
        status: "active",
        tokenVersion: 0,
      },
      mockIdentity: { passwordHash: "$2a$hashed$" },
      bcryptValid: false,
      platformSession: session,
    });

    const looksLike401 =
      (thrown as any)?.status === 401 ||
      res.status.mock.calls.some((c: any) => c[0] === 401);
    expect(looksLike401).toBe(true);
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
