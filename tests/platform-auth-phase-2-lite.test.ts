/**
 * Platform Auth Separation — Phase 2-lite test pack.
 *
 * 2026-04-22: proves the four Phase 2-lite guarantees:
 *   1. supportSessions route authenticates actor from req.platformUser
 *      (psid) and does NOT require req.user (sid).
 *   2. impersonationMiddleware bootstraps req.user from a valid imp_session
 *      cookie even when no tenant session is present — unblocking the
 *      tenant-login kill-switch flip.
 *   3. Read-only support mode WITHOUT a tenant session does NOT bootstrap
 *      req.user (documented limitation; Phase 3 concern).
 *   4. Tenant /login rejects platform-role accounts by default (env var
 *      default flipped from "true" to "false").
 *
 * Plus Phase 1 regression guards:
 *   5. A request with only sid (tenant session) hitting /api/platform/*
 *      still fails at requirePlatformSession (no psid).
 *   6. impersonationService cookie name is still imp_session.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// 2026-05-03 test-isolation fix.
//
// `beforeEach(() => vi.resetModules())` inside the "Phase 1 boundaries
// still enforced" describe block (below, line ~256) clears the module
// cache before each test. The subsequent `await import("../server/auth/platformSession")`
// re-evaluates the real module graph; that graph transitively loads
// `server/storage/index.ts`, which at module-evaluation time runs
// `userRepository.getUser.bind(userRepository)`. In the cleared-cache
// path the imported `userRepository` resolves to a partially-constructed
// object (its method bindings happen during class instantiation, which
// races the storage/index aggregator on certain import orders) — and
// `userRepository.getUser` is `undefined`, so `.bind(...)` throws
// `TypeError: Cannot read properties of undefined (reading 'bind')`.
//
// The actual middleware behaviour the regression test exercises
// (`requirePlatformSession` returns 401 when `req.platformSession` is
// undefined) NEVER reaches `storage.getUser` — the early-return
// happens at the very top of the function. The crash is purely a
// module-load artifact of `vi.resetModules` interacting with the real
// storage chain.
//
// Fix: file-level `vi.mock("../server/storage/index", …)` so the
// dynamic import receives a stub instead of the real aggregator.
// The stub provides only the methods callers in this file might
// touch — `getUser` and `incrementTokenVersion` (the two members
// `requirePlatformSession` would reach if the auth path actually ran).
// All other tests in the file either don't load `storage/index` at
// all (they read source files via `fs.readFileSync` for string-level
// regression checks) or they exercise impersonation middleware whose
// storage interactions are already stubbed via their own request-
// shape mocks. No coverage is reduced.
vi.mock("../server/storage/index", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue(null),
    incrementTokenVersion: vi.fn().mockResolvedValue(undefined),
    findUserByEmailGlobal: vi.fn().mockResolvedValue(null),
  },
}));

function mkRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.clearCookie = vi.fn().mockReturnValue(res);
  return res as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

// ============================================================================
// 1. supportSessions route — actor comes from req.platformUser
// ============================================================================

describe("supportSessions route — Phase 2-lite actor derivation", () => {
  beforeEach(() => vi.resetModules());

  it("requireActor prefers req.platformUser over req.user", async () => {
    const mod = await import("../server/routes/supportSessions");
    // requireActor is module-internal; exercise it indirectly by invoking
    // the router's POST / handler with a mocked service. Instead of
    // mocking the whole service tree, we assert the contract via a
    // direct import of the file's source — string-level regression guard
    // that platformUser is the preferred source.
    const src = await import("fs").then((fs) =>
      fs.readFileSync(
        "C:/dev/Syntraro/server/routes/supportSessions.ts",
        "utf-8",
      ),
    );
    // Preference ordering: platformUser must appear before req.user in the
    // requireActor function body.
    const fnMatch = src.match(/function requireActor[\s\S]+?^}/m);
    expect(fnMatch, "requireActor function not found").toBeTruthy();
    const body = fnMatch![0];
    const pIdx = body.indexOf("platformUser");
    const uIdx = body.indexOf("req.user");
    expect(pIdx).toBeGreaterThan(-1);
    expect(uIdx).toBeGreaterThan(-1);
    expect(pIdx).toBeLessThan(uIdx);
    // Also assert the router mounted without throwing.
    expect(mod.default).toBeDefined();
  });
});

// ============================================================================
// 2. impersonationMiddleware bootstraps req.user from imp_session alone
// ============================================================================

describe("impersonationMiddleware — Phase 2-lite bootstrap", () => {
  beforeEach(() => vi.resetModules());

  async function setupMiddleware(opts: {
    sessionReturned: any;
    targetUserReturned: any;
  }) {
    vi.doMock("../server/impersonationService", () => ({
      impersonationService: {
        checkImpersonation: vi.fn().mockResolvedValue(opts.sessionReturned),
        trackActivity: vi.fn(),
      },
    }));
    vi.doMock("../server/storage/users", () => ({
      userRepository: {
        getAuthenticatedUser: vi.fn().mockResolvedValue(opts.targetUserReturned),
      },
    }));
    vi.doMock("../server/auth/supportContext", () => ({
      // Runs the inner callback directly; don't care about AsyncLocalStorage.
      runWithSupportContext: (_ctx: any, fn: any) => fn(),
    }));
    const { impersonationMiddleware } = await import("../server/impersonationMiddleware");
    return impersonationMiddleware({} as any);
  }

  it("bootstraps req.user from imp_session + target user when NO tenant session present", async () => {
    const mw = await setupMiddleware({
      sessionReturned: {
        id: "imp_1",
        accessMode: "impersonation",
        ownerUserId: "platform_admin_1",
        targetUserId: "tenant_user_1",
        companyId: "tenant_co_1",
      },
      targetUserReturned: {
        id: "tenant_user_1",
        email: "target@tenant.com",
        role: "admin",
        companyId: "tenant_co_1",
        status: "active",
      },
    });

    const req: any = {
      isAuthenticated: () => false,
      user: undefined,
      headers: {},
      cookies: { imp_session: "whatever" },
    };
    const res = mkRes();
    const next = vi.fn();

    await mw(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalled();
    expect(req.user?.id).toBe("tenant_user_1");
    expect(req.isImpersonating).toBe(true);
    // realUser synthesized from ownerUserId
    expect(req.realUser?.id).toBe("platform_admin_1");
    expect(req.impersonationSessionId).toBe("imp_1");
  });

  it("retains legacy behavior when tenant session IS present (realUser = tenant req.user)", async () => {
    const tenantPlatformAdmin = {
      id: "platform_admin_1",
      email: "ops@example.com",
      role: "platform_admin",
      companyId: "platform_co",
    };
    const mw = await setupMiddleware({
      sessionReturned: {
        id: "imp_2",
        accessMode: "impersonation",
        ownerUserId: "platform_admin_1",
        targetUserId: "tenant_user_2",
        companyId: "tenant_co_2",
      },
      targetUserReturned: {
        id: "tenant_user_2",
        email: "target@tenant.com",
        role: "admin",
        companyId: "tenant_co_2",
        status: "active",
      },
    });

    const req: any = {
      isAuthenticated: () => true,
      user: tenantPlatformAdmin,
      headers: {},
      cookies: { imp_session: "whatever" },
    };
    const res = mkRes();
    const next = vi.fn();

    await mw(req, res, next as unknown as NextFunction);

    expect(req.user?.id).toBe("tenant_user_2");
    expect(req.realUser?.email).toBe("ops@example.com");
    expect(req.realUser?.id).toBe("platform_admin_1");
    expect(req.isImpersonating).toBe(true);
  });

  it("does NOT bootstrap req.user for read-only mode without tenant session (Phase 3 concern)", async () => {
    const mw = await setupMiddleware({
      sessionReturned: {
        id: "imp_3",
        accessMode: "read_only",
        ownerUserId: "platform_admin_1",
        targetUserId: null,
        companyId: "tenant_co_3",
      },
      targetUserReturned: null,
    });

    const req: any = {
      isAuthenticated: () => false,
      user: undefined,
      headers: {},
      cookies: { imp_session: "whatever" },
    };
    const res = mkRes();
    const next = vi.fn();

    await mw(req, res, next as unknown as NextFunction);

    // Support session is marked for observability, but req.user stays
    // unset so downstream requireAuth 401s (documented limitation).
    expect(req.supportSession?.id).toBe("imp_3");
    expect(req.user).toBeUndefined();
    expect(req.isReadOnlySupport).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("no-op when no imp_session cookie is present (normal tenant request)", async () => {
    const mw = await setupMiddleware({
      sessionReturned: null,
      targetUserReturned: null,
    });

    const tenantUser = { id: "t_1", email: "tenant@x", role: "admin", companyId: "c_1" };
    const req: any = {
      isAuthenticated: () => true,
      user: tenantUser,
      headers: {},
      cookies: {},
    };
    const res = mkRes();
    const next = vi.fn();

    await mw(req, res, next as unknown as NextFunction);

    // Original req.user preserved; no impersonation fields attached.
    expect(req.user).toBe(tenantUser);
    expect(req.isImpersonating).toBeUndefined();
    expect(req.supportSession).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});

// ============================================================================
// 4. Tenant /login default rejects platform-role accounts
// ============================================================================

describe("tenant /login — platform-role rejection (Phase 7: branch removed)", () => {
  it("the entire ALLOW_PLATFORM_IN_TENANT_LOGIN branch is gone from auth.ts", async () => {
    // 2026-05-04 Phase 7: the `ALLOW_PLATFORM_IN_TENANT_LOGIN` env-var
    // escape hatch + the `isPlatformRole((user as any).role)` rejection
    // branch were both removed from `server/routes/auth.ts`. After
    // Phase 6's DB CHECK constraint on `users.role`, no row in `users`
    // can hold a platform string — the rejection branch was dead
    // code. The structural guarantee replaces the runtime check.
    const src = await import("fs").then((fs) =>
      fs.readFileSync("C:/dev/Syntraro/server/routes/auth.ts", "utf-8"),
    );
    expect(src).not.toMatch(/ALLOW_PLATFORM_IN_TENANT_LOGIN/);
    expect(src).not.toMatch(/isPlatformRole\(\(user as any\)\.role\)/);
    // Defense-in-depth: no PLATFORM_ACCOUNT_REJECTED error code
    // remains either (it was the response shape for the removed
    // branch).
    expect(src).not.toMatch(/PLATFORM_ACCOUNT_REJECTED/);
  });
});

// ============================================================================
// 5. Regression guards — Phase 1 boundaries still hold
// ============================================================================

describe("Phase 1 boundaries still enforced", () => {
  beforeEach(() => vi.resetModules());

  it("requirePlatformSession still 401s a sid-only request to /api/platform/*", async () => {
    const { requirePlatformSession } = await import("../server/auth/platformSession");
    const req: any = {
      // Tenant session present (req.user set), but no platformSession.
      user: { id: "u", role: "admin" },
      isAuthenticated: () => true,
      platformSession: undefined,
      headers: {},
      path: "/api/platform/tenants",
    };
    const res = mkRes();
    const next = vi.fn();
    await requirePlatformSession(req, res, next as unknown as NextFunction);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("impersonation cookie name is still imp_session", async () => {
    const src = await import("fs").then((fs) =>
      fs.readFileSync("C:/dev/Syntraro/server/impersonationService.ts", "utf-8"),
    );
    expect(src).toMatch(/IMPERSONATION_COOKIE_NAME\s*=\s*"imp_session"/);
  });
});
