/**
 * Admin router cross-tenant lockdown — regression tests.
 *
 * 2026-05-03 SECURITY LOCKDOWN. Locks in the new contract for
 * `server/routes/admin.ts`:
 *
 *   1. The cross-tenant routes that previously lived on the tenant-auth
 *      surface are GONE. They MUST NOT respond 200/302/etc to any tenant
 *      session — including the `owner` role that previously satisfied the
 *      old `requireRole(OWNER_ONLY)` gate. Specifically:
 *        - GET    /api/admin/tenants
 *        - GET    /api/admin/qbo/overview
 *        - GET    /api/admin/qbo/runs
 *        - GET    /api/admin/qbo/queue
 *        - GET    /api/admin/qbo/mappings/summary
 *        - POST   /api/admin/qbo/queue/replay-failed
 *        - POST   /api/admin/run-weekly-digest
 *      All return 410 Gone via the catch-all retired-route guards.
 *
 *   2. `POST /api/admin/run-time-alerts?allCompanies=true` no longer fans
 *      out across tenants. The route ignores the query parameter and only
 *      ever runs `runTimeAlertsForCompany(req.companyId)` — i.e. the
 *      caller's own tenant. This test mocks the worker and asserts the
 *      cross-tenant entry point is not reachable.
 *
 *   3. The genuinely tenant-scoped routes that remain on this router
 *      (e.g. `/orphan-locations`) still gate on `requireRole(OWNER_ONLY)`,
 *      so a tenant `admin` (let alone manager / dispatcher / technician)
 *      gets 403 — the previous router-wide gate behavior is preserved.
 *
 *   4. The legacy `getTenantHealthList` storage function was deleted.
 *      Importing the storage module must succeed and the exported
 *      `adminRepository` must NOT carry that function any more — if a
 *      future PR re-adds it, this test fails so the reviewer notices.
 *
 * Test harness shape: we mount the real `adminRouter` behind a minimal
 * Express app that simulates `requireAuth` + `ensureTenantContext` by
 * injecting `req.user` + `req.companyId`. We do not boot the real server
 * and we do not touch the database — every assertion is about the
 * router's input contract, which is what changed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// Mock the heavy dependencies the admin router pulls in transitively so
// the import succeeds without a live DB / impersonation store. The real
// implementations are exercised by their own integration tests; here we
// only care about the routing + auth contract.
vi.mock("../server/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([{ count: "0" }]) }) }),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

vi.mock("../server/storage/admin", () => ({
  adminRepository: {
    // getTenantHealthList intentionally omitted — its absence is asserted below.
    getTenantDetail: vi.fn(),
  },
}));

vi.mock("../server/storage/customerCompanies", () => ({
  customerCompanyRepository: {
    getOrphanLocations: vi.fn().mockResolvedValue([]),
    getOrphanLocationCount: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock("../server/services/timeAlertsWorker", () => ({
  runTimeAlertsForCompany: vi.fn().mockResolvedValue({ alertsSent: 0 }),
  // Deliberately re-exported to prove the cross-tenant entry point is
  // never imported by the router after the lockdown.
  runTimeAlertsWorker: vi.fn(),
  runWeeklyDigestWorker: vi.fn(),
  getAlertThresholds: vi.fn().mockResolvedValue({}),
}));

vi.mock("../server/services/bulkJobCleanupService", () => ({
  previewBulkCleanup: vi.fn(),
  runBulkCleanup: vi.fn(),
  isBulkCleanupWarning: vi.fn().mockReturnValue(false),
}));

vi.mock("../server/impersonationService", () => ({
  impersonationService: {
    getActiveImpersonation: vi.fn().mockResolvedValue(null),
    startImpersonation: vi.fn().mockResolvedValue({
      id: "session-1",
      ownerUserId: "owner-id",
      targetUserId: "target-id",
      companyId: "tenant-a",
      reason: "test",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    }),
    stopImpersonation: vi.fn().mockResolvedValue(undefined),
    checkImpersonation: vi.fn().mockResolvedValue(null),
    getRemainingTime: vi.fn(),
    getIdleTimeRemaining: vi.fn(),
  },
}));

vi.mock("../server/storage/users", () => ({
  userRepository: {
    getUser: vi.fn(),
    // 2026-05-03 follow-up: impersonation route now uses the tenant-scoped
    // lookup (`getUserByCompany`) instead of the unscoped `getUser`. Every
    // impersonation test below sets this mock per-case.
    getUserByCompany: vi.fn(),
    getCompanyById: vi.fn(),
  },
}));

// ────────────────────────────────────────────────────────────────────────────
// Test harness — minimal Express that injects (or omits) auth context.
// ────────────────────────────────────────────────────────────────────────────

type ActiveUser = {
  id: string;
  companyId: string;
  role: "owner" | "admin" | "manager" | "dispatcher" | "technician";
} | null;

let activeUser: ActiveUser = null;

function makeApp() {
  const app = express();
  app.use(express.json());

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!activeUser) return res.status(401).json({ error: "Unauthorized" });
    (req as any).user = {
      id: activeUser.id,
      companyId: activeUser.companyId,
      email: `${activeUser.id}@test.example`,
      role: activeUser.role,
    };
    (req as any).companyId = activeUser.companyId;
    next();
  });

  // Mount admin router under /api/admin to mirror production.
  // Dynamic import so vi.mock above takes effect.
  return import("../server/routes/admin").then(mod => {
    app.use("/api/admin", mod.default);
    // Mirror the production error handler so responses thrown via
    // `createError(status, message)` come back with `{error, code}` and
    // not Express's default stack-trace HTML. Without this, status codes
    // are still correct but `res.body` is empty in supertest.
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err?.status || err?.statusCode || 500;
      const body: Record<string, unknown> = {
        error: err?.message || "Internal server error",
      };
      if (err?.code) body.code = err.code;
      res.status(status).json(body);
    });
    return app;
  });
}

describe("Admin router — 2026-05-03 cross-tenant lockdown", () => {
  beforeEach(() => {
    activeUser = null;
  });

  // ──────────────────────────────────────────────────────────────────────
  // Cross-tenant retired routes — every tenant role must be denied.
  // ──────────────────────────────────────────────────────────────────────

  describe("retired cross-tenant endpoints return 410 Gone", () => {
    const RETIRED = [
      { method: "get",  path: "/api/admin/tenants" },
      { method: "get",  path: "/api/admin/qbo/overview" },
      { method: "get",  path: "/api/admin/qbo/runs" },
      { method: "get",  path: "/api/admin/qbo/runs/abc-123" },
      { method: "get",  path: "/api/admin/qbo/queue" },
      { method: "get",  path: "/api/admin/qbo/queue/failed-count" },
      { method: "get",  path: "/api/admin/qbo/mappings/summary" },
      { method: "post", path: "/api/admin/qbo/queue/abc-123/replay" },
      { method: "post", path: "/api/admin/qbo/queue/replay-failed" },
      { method: "post", path: "/api/admin/run-weekly-digest" },
    ] as const;

    for (const role of ["owner", "admin", "manager", "dispatcher", "technician"] as const) {
      for (const ep of RETIRED) {
        it(`${role} → ${ep.method.toUpperCase()} ${ep.path} → 410`, async () => {
          activeUser = { id: `u-${role}`, companyId: "tenant-a", role };
          const app = await makeApp();
          const res = await (request(app) as any)[ep.method](ep.path).send({});
          expect(res.status).toBe(410);
          expect(res.body).toMatchObject({
            code: "ADMIN_CROSS_TENANT_ROUTE_RETIRED",
          });
        });
      }
    }

    it("unauthenticated callers also do not get cross-tenant data (401 from the harness, never 200)", async () => {
      activeUser = null;
      const app = await makeApp();
      for (const ep of RETIRED) {
        const res = await (request(app) as any)[ep.method](ep.path).send({});
        // The harness simulates `requireAuth` returning 401 when no user is
        // present — exactly the production shape. The point is: never 200.
        expect(res.status).not.toBe(200);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // run-time-alerts: cross-tenant fan-out branch is gone.
  // ──────────────────────────────────────────────────────────────────────

  describe("POST /api/admin/run-time-alerts no longer fans out across tenants", () => {
    it("ignores ?allCompanies=true and only runs the caller's own tenant", async () => {
      activeUser = { id: "u-owner", companyId: "tenant-a", role: "owner" };
      const app = await makeApp();
      const res = await request(app)
        .post("/api/admin/run-time-alerts?allCompanies=true")
        .send({});
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        mode: "single_company",
        companyId: "tenant-a",
      });
      // The cross-tenant worker entry point must NOT have been called.
      const worker = await import("../server/services/timeAlertsWorker");
      expect(worker.runTimeAlertsWorker).not.toHaveBeenCalled();
      expect(worker.runWeeklyDigestWorker).not.toHaveBeenCalled();
    });

    it("denies non-owner tenant roles", async () => {
      for (const role of ["admin", "manager", "dispatcher", "technician"] as const) {
        activeUser = { id: `u-${role}`, companyId: "tenant-a", role };
        const app = await makeApp();
        const res = await request(app)
          .post("/api/admin/run-time-alerts")
          .send({});
        expect(res.status).toBe(403);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Tenant-scoped routes still owner-gated (router-wide gate replaced by
  // per-route gates; this confirms nothing leaked through that refactor).
  // ──────────────────────────────────────────────────────────────────────

  describe("tenant-scoped routes remain OWNER_ONLY post-refactor", () => {
    const TENANT_SCOPED_GET = [
      "/api/admin/orphan-locations",
      "/api/admin/orphan-locations/count",
      "/api/admin/time-alerts/thresholds",
    ];

    it("owner can reach orphan-locations (200)", async () => {
      activeUser = { id: "u-owner", companyId: "tenant-a", role: "owner" };
      const app = await makeApp();
      const res = await request(app).get("/api/admin/orphan-locations");
      expect(res.status).toBe(200);
    });

    for (const role of ["admin", "manager", "dispatcher", "technician"] as const) {
      for (const path of TENANT_SCOPED_GET) {
        it(`${role} → GET ${path} → 403`, async () => {
          activeUser = { id: `u-${role}`, companyId: "tenant-a", role };
          const app = await makeApp();
          const res = await request(app).get(path);
          expect(res.status).toBe(403);
        });
      }
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // Tenant-detail route: cross-tenant id rejected.
  // ──────────────────────────────────────────────────────────────────────

  describe("GET /api/admin/tenants/:companyId rejects cross-tenant ids", () => {
    it("403 when :companyId belongs to another tenant", async () => {
      activeUser = { id: "u-owner", companyId: "tenant-a", role: "owner" };
      const app = await makeApp();
      const res = await request(app).get("/api/admin/tenants/tenant-b");
      expect(res.status).toBe(403);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Impersonation tenant-boundary hardening (2026-05-03 follow-up).
//
// The previous impersonation route called `userRepository.getUser(targetUserId)`
// which is unscoped — a tenant owner could pass any UUID and start a session
// against the target's tenant. The hardened route uses
// `userRepository.getUserByCompany(req.companyId, targetUserId)` and pins the
// session's companyId to the operator's tenant. These tests exercise the
// new contract end-to-end.
// ────────────────────────────────────────────────────────────────────────────

const VALID_UUID_TARGET = "11111111-1111-4111-8111-111111111111";
const VALID_UUID_OWNER  = "22222222-2222-4222-8222-222222222222";

describe("Impersonation route — tenant-boundary hardening", () => {
  beforeEach(() => {
    activeUser = null;
    vi.clearAllMocks();
  });

  it("owner can impersonate an allowed same-tenant user (200)", async () => {
    activeUser = { id: VALID_UUID_OWNER, companyId: "tenant-a", role: "owner" };
    const users = await import("../server/storage/users");
    (users.userRepository.getUserByCompany as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: VALID_UUID_TARGET,
      companyId: "tenant-a",
      email: "tech@tenant-a.test",
      fullName: "Tech User",
      role: "technician",
      status: "active",
      disabled: false,
      deletedAt: null,
    });
    const app = await makeApp();
    const res = await request(app)
      .post("/api/admin/impersonate")
      .send({ targetUserId: VALID_UUID_TARGET, reason: "support" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(users.userRepository.getUserByCompany).toHaveBeenCalledWith(
      "tenant-a",
      VALID_UUID_TARGET,
    );
    // Session must be pinned to the OPERATOR's tenant — never the target's
    // (which would be the same here, but the contract is what we're locking).
    const imp = await import("../server/impersonationService");
    const startCall = (imp.impersonationService.startImpersonation as ReturnType<typeof vi.fn>).mock.calls[0];
    // Args: (req, res, ownerId, ownerEmail, targetId, targetCompanyId, reason)
    expect(startCall[5]).toBe("tenant-a");
  });

  it("owner cannot impersonate a user from another tenant — 404 (does not leak existence)", async () => {
    activeUser = { id: VALID_UUID_OWNER, companyId: "tenant-a", role: "owner" };
    const users = await import("../server/storage/users");
    // getUserByCompany is tenant-scoped — for a cross-tenant target it returns null,
    // even if the underlying user row exists in another tenant.
    (users.userRepository.getUserByCompany as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const app = await makeApp();
    const res = await request(app)
      .post("/api/admin/impersonate")
      .send({ targetUserId: VALID_UUID_TARGET, reason: "support" });
    expect(res.status).toBe(404);
    // No session created.
    const imp = await import("../server/impersonationService");
    expect(imp.impersonationService.startImpersonation).not.toHaveBeenCalled();
  });

  it("returns the same 404 for 'no such user' as for 'cross-tenant user' (no enumeration leak)", async () => {
    activeUser = { id: VALID_UUID_OWNER, companyId: "tenant-a", role: "owner" };
    const users = await import("../server/storage/users");
    (users.userRepository.getUserByCompany as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const app = await makeApp();
    const res = await request(app)
      .post("/api/admin/impersonate")
      .send({ targetUserId: VALID_UUID_TARGET, reason: "support" });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).toMatch(/Target user not found/i);
  });

  it("owner cannot impersonate a platform user (403)", async () => {
    activeUser = { id: VALID_UUID_OWNER, companyId: "tenant-a", role: "owner" };
    const users = await import("../server/storage/users");
    (users.userRepository.getUserByCompany as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: VALID_UUID_TARGET,
      companyId: "tenant-a",
      email: "ops@platform.test",
      fullName: "Platform User",
      role: "platform_support",
      status: "active",
      disabled: false,
      deletedAt: null,
    });
    const app = await makeApp();
    const res = await request(app)
      .post("/api/admin/impersonate")
      .send({ targetUserId: VALID_UUID_TARGET, reason: "support" });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/platform user/i);
    const imp = await import("../server/impersonationService");
    expect(imp.impersonationService.startImpersonation).not.toHaveBeenCalled();
  });

  it("owner cannot impersonate another owner (403)", async () => {
    activeUser = { id: VALID_UUID_OWNER, companyId: "tenant-a", role: "owner" };
    const users = await import("../server/storage/users");
    (users.userRepository.getUserByCompany as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: VALID_UUID_TARGET,
      companyId: "tenant-a",
      email: "co-owner@tenant-a.test",
      fullName: "Co Owner",
      role: "owner",
      status: "active",
      disabled: false,
      deletedAt: null,
    });
    const app = await makeApp();
    const res = await request(app)
      .post("/api/admin/impersonate")
      .send({ targetUserId: VALID_UUID_TARGET, reason: "support" });
    expect(res.status).toBe(403);
  });

  for (const badState of [
    { label: "soft-deleted",        patch: { deletedAt: new Date() } },
    { label: "disabled",            patch: { disabled: true } },
    { label: "status='deactivated'", patch: { status: "deactivated" } },
    { label: "status='invited'",    patch: { status: "invited" } },
  ]) {
    it(`owner cannot impersonate a ${badState.label} user — 404 (no probing)`, async () => {
      activeUser = { id: VALID_UUID_OWNER, companyId: "tenant-a", role: "owner" };
      const users = await import("../server/storage/users");
      (users.userRepository.getUserByCompany as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: VALID_UUID_TARGET,
        companyId: "tenant-a",
        email: "x@tenant-a.test",
        fullName: "X",
        role: "technician",
        status: "active",
        disabled: false,
        deletedAt: null,
        ...badState.patch,
      });
      const app = await makeApp();
      const res = await request(app)
        .post("/api/admin/impersonate")
        .send({ targetUserId: VALID_UUID_TARGET, reason: "support" });
      expect(res.status).toBe(404);
      const imp = await import("../server/impersonationService");
      expect(imp.impersonationService.startImpersonation).not.toHaveBeenCalled();
    });
  }

  it("owner cannot impersonate themselves (400)", async () => {
    activeUser = { id: VALID_UUID_OWNER, companyId: "tenant-a", role: "owner" };
    const app = await makeApp();
    const res = await request(app)
      .post("/api/admin/impersonate")
      .send({ targetUserId: VALID_UUID_OWNER, reason: "self" });
    expect(res.status).toBe(400);
  });

  for (const role of ["admin", "manager", "dispatcher", "technician"] as const) {
    it(`${role} cannot start an impersonation session (403)`, async () => {
      activeUser = { id: `u-${role}`, companyId: "tenant-a", role };
      const app = await makeApp();
      const res = await request(app)
        .post("/api/admin/impersonate")
        .send({ targetUserId: VALID_UUID_TARGET, reason: "support" });
      expect(res.status).toBe(403);
    });
  }

  it("impersonate/stop still works for owners (success)", async () => {
    activeUser = { id: VALID_UUID_OWNER, companyId: "tenant-a", role: "owner" };
    const imp = await import("../server/impersonationService");
    (imp.impersonationService.getActiveImpersonation as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "session-1",
      ownerUserId: VALID_UUID_OWNER,
    });
    const app = await makeApp();
    const res = await request(app).post("/api/admin/impersonate/stop").send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(imp.impersonationService.stopImpersonation).toHaveBeenCalled();
  });

  it("impersonate/stop with no active session still 200 (idempotent)", async () => {
    activeUser = { id: VALID_UUID_OWNER, companyId: "tenant-a", role: "owner" };
    const imp = await import("../server/impersonationService");
    (imp.impersonationService.getActiveImpersonation as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const app = await makeApp();
    const res = await request(app).post("/api/admin/impersonate/stop").send({});
    expect(res.status).toBe(200);
  });

  for (const role of ["admin", "manager", "dispatcher", "technician"] as const) {
    it(`${role} cannot reach impersonate/stop (403)`, async () => {
      activeUser = { id: `u-${role}`, companyId: "tenant-a", role };
      const app = await makeApp();
      const res = await request(app).post("/api/admin/impersonate/stop").send({});
      expect(res.status).toBe(403);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Storage-layer assertion — the cross-tenant function is gone.
// ────────────────────────────────────────────────────────────────────────────

describe("server/storage/admin — getTenantHealthList removal", () => {
  // This test does NOT use the mocked module above; it imports the real
  // file via vi.unmock so a future PR that silently re-adds the function
  // is caught here.
  it("adminRepository no longer exports getTenantHealthList", async () => {
    vi.doUnmock("../server/storage/admin");
    vi.resetModules();
    const real = await import("../server/storage/admin");
    expect(real.adminRepository).toBeDefined();
    expect((real.adminRepository as Record<string, unknown>).getTenantHealthList).toBeUndefined();
    // getTenantDetail is still exported — that is the legitimate single-
    // tenant read path used by the platform service.
    expect(typeof real.adminRepository.getTenantDetail).toBe("function");
  });
});
