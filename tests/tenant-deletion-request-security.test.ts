/**
 * tenantDeletionRequestService — security contract suite (2026-05-04).
 *
 * Focused on the hard guarantees that make this safe:
 *
 *   • Preview hash is deterministic + canonical — payload reorderings
 *     and `undefined` fields don't change the hash.
 *   • Stale previews (older than PREVIEW_FRESHNESS_MS) are rejected.
 *   • Confirmation phrase + tenant id confirmations must match exactly.
 *   • Reason length floor is enforced.
 *   • Self-approval is forbidden (separation of duties).
 *   • Cancellation is allowed for initiator OR holders of the approve
 *     capability — and refused for executing / terminal rows.
 *   • Re-auth helper rejects mismatched / disabled / no-identity users
 *     and never throws an exception path.
 *
 * No real DB. We mock the repository + downstream services so the
 * service-layer logic is exercised in isolation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock state ─────────────────────────────────────────────────────

const repoState = {
  rows: new Map<string, any>(),
  active: new Map<string, any>(),
};

const teardownMock = vi.fn();
const sendAlertMock = vi.fn(async () => {});
const findPlatformByEmail = vi.fn();
const bcryptCompareMock = vi.fn();
// 2026-05-04 F1 hardening: capture audit-row writes so tests can assert
// the worker emits one for every lifecycle transition.
const auditLogMock = vi.fn(async () => {});

vi.mock("../server/storage/tenantDeletionRequests", () => ({
  tenantDeletionRequestsRepository: {
    createPending: vi.fn(async (data: any) => {
      const id = `req_${repoState.rows.size + 1}`;
      const row = {
        id,
        ...data,
        createdAt: new Date(),
        approvedAt: null,
        executedAt: null,
        cancelledAt: null,
        approvedByUserId: null,
        approvedByEmail: null,
        cancelledByUserId: null,
        cancelledByEmail: null,
        executionScheduledAt: null,
        failureReason: null,
      };
      repoState.rows.set(id, row);
      repoState.active.set(data.companyId, row);
      return row;
    }),
    getById: vi.fn(async (id: string) => repoState.rows.get(id) ?? null),
    getActiveForCompany: vi.fn(
      async (companyId: string) => repoState.active.get(companyId) ?? null,
    ),
    listByCompany: vi.fn(async (companyId: string) =>
      Array.from(repoState.rows.values()).filter((r) => r.companyId === companyId),
    ),
    listExpiredPending: vi.fn(async () => []),
    listReadyToExecute: vi.fn(async () => []),
    // 2026-05-04 F2 hardening: stale-executing reaper hot path.
    listStaleExecuting: vi.fn(async (cutoff: Date) =>
      Array.from(repoState.rows.values()).filter(
        (r) =>
          r.status === "executing" &&
          r.executionStartedAt &&
          r.executionStartedAt < cutoff,
      ),
    ),
    transitionToApproved: vi.fn(async (id: string, fields: any) => {
      const row = repoState.rows.get(id);
      if (!row || row.status !== "pending") return null;
      Object.assign(row, {
        status: "approved",
        approvedByUserId: fields.approvedByUserId,
        approvedByEmail: fields.approvedByEmail,
        approvedAt: new Date(),
        executionScheduledAt: fields.executionScheduledAt,
      });
      return row;
    }),
    transitionToCancelled: vi.fn(async (id: string, fields: any) => {
      const row = repoState.rows.get(id);
      if (!row || (row.status !== "pending" && row.status !== "approved")) {
        return null;
      }
      Object.assign(row, {
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledByUserId: fields.cancelledByUserId,
        cancelledByEmail: fields.cancelledByEmail,
      });
      repoState.active.delete(row.companyId);
      return row;
    }),
    transitionToExecuting: vi.fn(async (id: string) => {
      const row = repoState.rows.get(id);
      if (!row || row.status !== "approved") return null;
      Object.assign(row, {
        status: "executing",
        executionStartedAt: new Date(),
      });
      return row;
    }),
    transitionToCompleted: vi.fn(async (id: string) => {
      const row = repoState.rows.get(id);
      if (!row || row.status !== "executing") return null;
      Object.assign(row, {
        status: "completed",
        executedAt: new Date(),
      });
      repoState.active.delete(row.companyId);
      return row;
    }),
    transitionToFailed: vi.fn(async (id: string, reason: string) => {
      const row = repoState.rows.get(id);
      if (!row || (row.status !== "executing" && row.status !== "approved")) {
        return null;
      }
      Object.assign(row, { status: "failed", failureReason: reason });
      repoState.active.delete(row.companyId);
      return row;
    }),
    transitionToExpired: vi.fn(async (id: string) => {
      const row = repoState.rows.get(id);
      if (!row || row.status !== "pending") return null;
      Object.assign(row, { status: "expired" });
      repoState.active.delete(row.companyId);
      return row;
    }),
  },
}));

vi.mock("../server/services/tenantTeardownService", () => ({
  teardownTenant: (...args: any[]) => teardownMock(...args),
}));

vi.mock("../server/services/platformTenantTeardownAlerts", () => ({
  sendTeardownAlert: (...args: any[]) => sendAlertMock(...args),
}));

// 2026-05-04 F1 hardening: mock the entire platformAuditService surface
// the worker calls. Only `.log` is exercised; the union type is
// re-exported for callsite ergonomics.
vi.mock("../server/services/platformAuditService", () => ({
  platformAuditService: { log: (...args: any[]) => auditLogMock(...args) },
}));

vi.mock("../server/storage/index", () => ({
  storage: {},
}));

vi.mock("../server/db", () => ({
  db: {
    execute: vi.fn(async () => ({
      rows: [{ id: "tenant-1", name: "Acme Inc", email: "ops@acme.test" }],
    })),
  },
}));

vi.mock("../server/storage/platformIdentity", () => ({
  platformIdentityRepository: {
    findPlatformUserByEmail: (email: string) => findPlatformByEmail(email),
  },
}));

vi.mock("bcryptjs", () => ({
  default: { compare: (...args: any[]) => bcryptCompareMock(...args) },
}));

// ─── Imports under test (after mocks declared) ─────────────────────────────

// Already in canonical (sorted) form so it survives hashableInventory()
// untouched — simplifies hash comparisons in tests.
const SAMPLE_INVENTORY = {
  companyIds: ["tenant-1"],
  userIds: ["u1", "u2"],
  fkRowCounts: [
    // sorted alphabetically by `table` to match hashableInventory()
    { table: "invoices", column: "company_id", rows: 5 },
    { table: "jobs", column: "company_id", rows: 12 },
  ],
  totalFkRows: 17,
  orphanTables: [],
  orphanRowCounts: [],
  r2: {
    bucket: "test-bucket",
    prefix: "tenants/tenant-1/",
    enabled: true,
    objectCount: 3,
    totalBytes: 1024,
  },
  providers: {
    qbo: { hasConnection: false, hasRealmId: false },
    stripeConnect: { hasAccountRow: false, providerAccountIdPresent: false },
  },
  sessions: { staffSessions: 0, portalSessions: 0 },
};

beforeEach(() => {
  repoState.rows.clear();
  repoState.active.clear();
  teardownMock.mockReset();
  sendAlertMock.mockReset();
  findPlatformByEmail.mockReset();
  bcryptCompareMock.mockReset();
  auditLogMock.mockReset();
  auditLogMock.mockResolvedValue(undefined as any);
  // Default: every dryRun call returns the standard inventory.
  teardownMock.mockResolvedValue({
    inventory: SAMPLE_INVENTORY,
    providerRetentions: {},
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Preview-hash determinism
// ═══════════════════════════════════════════════════════════════════════════

describe("preview hash determinism", () => {
  it("is stable across key reordering on the hashable shape", async () => {
    const { computePreviewHash, canonicalJson, hashableInventory } = await import(
      "../server/services/platformTenantTeardownPreviewHash"
    );
    const hash1 = computePreviewHash(SAMPLE_INVENTORY);
    const reordered = {
      sessions: SAMPLE_INVENTORY.sessions,
      providers: SAMPLE_INVENTORY.providers,
      r2: SAMPLE_INVENTORY.r2,
      orphanRowCounts: SAMPLE_INVENTORY.orphanRowCounts,
      orphanTables: SAMPLE_INVENTORY.orphanTables,
      totalFkRows: SAMPLE_INVENTORY.totalFkRows,
      fkRowCounts: SAMPLE_INVENTORY.fkRowCounts,
      userIds: SAMPLE_INVENTORY.userIds,
      companyIds: SAMPLE_INVENTORY.companyIds,
    };
    const hash2 = computePreviewHash(reordered);
    expect(hash1).toBe(hash2);
    // Canonical JSON form is identical too.
    expect(canonicalJson(SAMPLE_INVENTORY)).toBe(canonicalJson(reordered));
    // hashableInventory of an inventory containing extras (sampleKeys)
    // should drop them — verified indirectly: passing the projection
    // back in produces the same hash.
    const projected = hashableInventory({
      ...(SAMPLE_INVENTORY as any),
      r2: { ...SAMPLE_INVENTORY.r2, sampleKeys: ["a", "b"] },
    });
    expect(computePreviewHash(projected)).toBe(hash1);
  });

  it("changes when any FK row count changes", async () => {
    const { computePreviewHash } = await import(
      "../server/services/platformTenantTeardownPreviewHash"
    );
    const a = computePreviewHash(SAMPLE_INVENTORY);
    const b = computePreviewHash({
      ...SAMPLE_INVENTORY,
      fkRowCounts: [
        { table: "jobs", column: "company_id", rows: 13 }, // bumped
        { table: "invoices", column: "company_id", rows: 5 },
      ],
      totalFkRows: 18,
    });
    expect(a).not.toBe(b);
  });

  it("rejects Set/Map inputs (non-canonicalisable)", async () => {
    const { canonicalJson } = await import(
      "../server/services/platformTenantTeardownPreviewHash"
    );
    expect(() => canonicalJson({ s: new Set([1, 2]) })).toThrow(/Set\/Map/);
    expect(() => canonicalJson({ m: new Map([["k", 1]]) })).toThrow(/Set\/Map/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// createRequest — input validation contracts
// ═══════════════════════════════════════════════════════════════════════════

describe("createRequest validation", () => {
  async function service() {
    return await import("../server/services/tenantDeletionRequestService");
  }

  function baseInput(svc: any, hash: string, generatedAt: Date) {
    return {
      companyId: "tenant-1",
      previewHash: hash,
      previewGeneratedAt: generatedAt.toISOString(),
      previewPayload: SAMPLE_INVENTORY,
      reason: "Tenant abandoned project, requesting cleanup per agreement.",
      confirmations: {
        tenantName: "Acme Inc",
        tenantId: "tenant-1",
        phrase: svc.CONFIRMATION_PHRASE,
      },
      initiator: { id: "user-A", email: "a@platform.test" },
    };
  }

  it("rejects reason shorter than REASON_MIN_LENGTH", async () => {
    const svc = await service();
    const { computePreviewHash } = await import(
      "../server/services/platformTenantTeardownPreviewHash"
    );
    const hash = computePreviewHash(SAMPLE_INVENTORY);
    const input = {
      ...baseInput(svc, hash, new Date()),
      reason: "too short",
    };
    await expect(svc.createRequest(input)).rejects.toMatchObject({
      code: "REASON_TOO_SHORT",
      status: 400,
    });
  });

  it("rejects wrong confirmation phrase", async () => {
    const svc = await service();
    const { computePreviewHash } = await import(
      "../server/services/platformTenantTeardownPreviewHash"
    );
    const hash = computePreviewHash(SAMPLE_INVENTORY);
    const input = baseInput(svc, hash, new Date());
    input.confirmations.phrase = "delete tenant"; // case-sensitive — wrong
    await expect(svc.createRequest(input)).rejects.toMatchObject({
      code: "INVALID_CONFIRMATION_PHRASE",
    });
  });

  it("rejects wrong tenant id confirmation", async () => {
    const svc = await service();
    const { computePreviewHash } = await import(
      "../server/services/platformTenantTeardownPreviewHash"
    );
    const hash = computePreviewHash(SAMPLE_INVENTORY);
    const input = baseInput(svc, hash, new Date());
    input.confirmations.tenantId = "tenant-2";
    await expect(svc.createRequest(input)).rejects.toMatchObject({
      code: "INVALID_TENANT_ID_CONFIRMATION",
    });
  });

  it("rejects stale preview (older than PREVIEW_FRESHNESS_MS)", async () => {
    const svc = await service();
    const { computePreviewHash } = await import(
      "../server/services/platformTenantTeardownPreviewHash"
    );
    const hash = computePreviewHash(SAMPLE_INVENTORY);
    const stale = new Date(Date.now() - svc.PREVIEW_FRESHNESS_MS - 5_000);
    const input = baseInput(svc, hash, stale);
    await expect(svc.createRequest(input)).rejects.toMatchObject({
      code: "PREVIEW_STALE",
    });
  });

  it("rejects mismatched preview hash", async () => {
    const svc = await service();
    const input = baseInput(svc, "0".repeat(64), new Date());
    await expect(svc.createRequest(input)).rejects.toMatchObject({
      code: "PREVIEW_HASH_MISMATCH",
    });
  });

  it("rejects when fresh preview disagrees (state drifted since preview)", async () => {
    const svc = await service();
    const { computePreviewHash } = await import(
      "../server/services/platformTenantTeardownPreviewHash"
    );
    const hash = computePreviewHash(SAMPLE_INVENTORY);
    // Live re-preview returns a DIFFERENT shape than the user-supplied
    // payload. The service recomputes the hash from the live data and
    // refuses on mismatch. (The user-supplied payload still self-
    // consistently hashes to `hash`, so PREVIEW_HASH_MISMATCH does not
    // fire — only PREVIEW_DRIFT.)
    teardownMock.mockReset();
    teardownMock.mockResolvedValue({
      inventory: { ...SAMPLE_INVENTORY, totalFkRows: 999 },
      providerRetentions: {},
    });
    const input = baseInput(svc, hash, new Date());
    await expect(svc.createRequest(input)).rejects.toMatchObject({
      code: "PREVIEW_DRIFT",
    });
  });

  it("rejects wrong tenant name confirmation against live snapshot", async () => {
    const svc = await service();
    const { computePreviewHash } = await import(
      "../server/services/platformTenantTeardownPreviewHash"
    );
    const hash = computePreviewHash(SAMPLE_INVENTORY);
    const input = baseInput(svc, hash, new Date());
    input.confirmations.tenantName = "Wrong Name";
    await expect(svc.createRequest(input)).rejects.toMatchObject({
      code: "INVALID_TENANT_NAME_CONFIRMATION",
    });
  });

  it("rejects when an active request already exists for the tenant", async () => {
    const svc = await service();
    const { computePreviewHash } = await import(
      "../server/services/platformTenantTeardownPreviewHash"
    );
    const hash = computePreviewHash(SAMPLE_INVENTORY);
    repoState.active.set("tenant-1", {
      id: "existing",
      status: "pending",
    });
    const input = baseInput(svc, hash, new Date());
    await expect(svc.createRequest(input)).rejects.toMatchObject({
      code: "ACTIVE_REQUEST_EXISTS",
      status: 409,
    });
  });

  it("creates a pending request on the happy path", async () => {
    const svc = await service();
    const { computePreviewHash } = await import(
      "../server/services/platformTenantTeardownPreviewHash"
    );
    const hash = computePreviewHash(SAMPLE_INVENTORY);
    const created = await svc.createRequest(baseInput(svc, hash, new Date()));
    expect(created.status).toBe("pending");
    expect(created.companyId).toBe("tenant-1");
    expect(created.initiatedByUserId).toBe("user-A");
    expect(created.previewHash).toBe(hash);
    expect(sendAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: "request_created", requestId: created.id }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// approveRequest — separation of duties
// ═══════════════════════════════════════════════════════════════════════════

describe("approveRequest", () => {
  async function setupPending() {
    const svc = await import("../server/services/tenantDeletionRequestService");
    const { computePreviewHash } = await import(
      "../server/services/platformTenantTeardownPreviewHash"
    );
    const hash = computePreviewHash(SAMPLE_INVENTORY);
    const created = await svc.createRequest({
      companyId: "tenant-1",
      previewHash: hash,
      previewGeneratedAt: new Date().toISOString(),
      previewPayload: SAMPLE_INVENTORY,
      reason: "Tenant abandoned project, requesting cleanup per agreement.",
      confirmations: {
        tenantName: "Acme Inc",
        tenantId: "tenant-1",
        phrase: svc.CONFIRMATION_PHRASE,
      },
      initiator: { id: "user-A", email: "a@platform.test" },
    });
    return { svc, created };
  }

  it("forbids self-approval (initiator is approver)", async () => {
    const { svc, created } = await setupPending();
    await expect(
      svc.approveRequest({
        requestId: created.id,
        approver: { id: "user-A", email: "a@platform.test" },
      }),
    ).rejects.toMatchObject({ code: "SELF_APPROVAL_FORBIDDEN", status: 403 });
  });

  it("rejects approval of a non-pending request", async () => {
    const { svc, created } = await setupPending();
    // Manually mark the row as approved.
    repoState.rows.get(created.id).status = "approved";
    await expect(
      svc.approveRequest({
        requestId: created.id,
        approver: { id: "user-B", email: "b@platform.test" },
      }),
    ).rejects.toMatchObject({ code: "REQUEST_NOT_PENDING", status: 409 });
  });

  it("rejects approval of an expired request", async () => {
    const { svc, created } = await setupPending();
    repoState.rows.get(created.id).expiresAt = new Date(Date.now() - 1_000);
    await expect(
      svc.approveRequest({
        requestId: created.id,
        approver: { id: "user-B", email: "b@platform.test" },
      }),
    ).rejects.toMatchObject({ code: "REQUEST_EXPIRED" });
  });

  it("approves on the happy path and schedules execution", async () => {
    const { svc, created } = await setupPending();
    const before = Date.now();
    const updated = await svc.approveRequest({
      requestId: created.id,
      approver: { id: "user-B", email: "b@platform.test" },
    });
    expect(updated.status).toBe("approved");
    expect(updated.approvedByUserId).toBe("user-B");
    const scheduled = new Date(updated.executionScheduledAt!).getTime();
    expect(scheduled - before).toBeGreaterThanOrEqual(svc.EXECUTION_DELAY_MS - 1_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// cancelRequest — guards
// ═══════════════════════════════════════════════════════════════════════════

describe("cancelRequest", () => {
  async function setupPending() {
    const svc = await import("../server/services/tenantDeletionRequestService");
    const { computePreviewHash } = await import(
      "../server/services/platformTenantTeardownPreviewHash"
    );
    const hash = computePreviewHash(SAMPLE_INVENTORY);
    const created = await svc.createRequest({
      companyId: "tenant-1",
      previewHash: hash,
      previewGeneratedAt: new Date().toISOString(),
      previewPayload: SAMPLE_INVENTORY,
      reason: "Tenant abandoned project, requesting cleanup per agreement.",
      confirmations: {
        tenantName: "Acme Inc",
        tenantId: "tenant-1",
        phrase: svc.CONFIRMATION_PHRASE,
      },
      initiator: { id: "user-A", email: "a@platform.test" },
    });
    return { svc, created };
  }

  it("allows the initiator to cancel a pending request", async () => {
    const { svc, created } = await setupPending();
    const cancelled = await svc.cancelRequest({
      requestId: created.id,
      actor: {
        id: "user-A",
        email: "a@platform.test",
        capabilities: ["platform:tenant_teardown_request"],
      },
    });
    expect(cancelled.status).toBe("cancelled");
  });

  it("allows a super admin (approve cap) to cancel a request they didn't initiate", async () => {
    const { svc, created } = await setupPending();
    const cancelled = await svc.cancelRequest({
      requestId: created.id,
      actor: {
        id: "super",
        email: "super@platform.test",
        capabilities: ["platform:tenant_teardown_approve"],
      },
    });
    expect(cancelled.status).toBe("cancelled");
  });

  it("forbids cancellation by an unrelated user without approve cap", async () => {
    const { svc, created } = await setupPending();
    await expect(
      svc.cancelRequest({
        requestId: created.id,
        actor: {
          id: "rando",
          email: "x@platform.test",
          capabilities: ["platform:tenant_teardown_preview"],
        },
      }),
    ).rejects.toMatchObject({ code: "CANCEL_NOT_PERMITTED", status: 403 });
  });

  it("refuses cancellation while executing (worker is mid-flight)", async () => {
    const { svc, created } = await setupPending();
    repoState.rows.get(created.id).status = "executing";
    await expect(
      svc.cancelRequest({
        requestId: created.id,
        actor: {
          id: "user-A",
          email: "a@platform.test",
          capabilities: ["platform:tenant_teardown_approve"],
        },
      }),
    ).rejects.toMatchObject({ code: "EXECUTING_NOT_CANCELLABLE" });
  });

  it("refuses cancellation in terminal status", async () => {
    const { svc, created } = await setupPending();
    repoState.rows.get(created.id).status = "completed";
    await expect(
      svc.cancelRequest({
        requestId: created.id,
        actor: {
          id: "user-A",
          email: "a@platform.test",
          capabilities: ["platform:tenant_teardown_approve"],
        },
      }),
    ).rejects.toMatchObject({ code: "TERMINAL_NOT_CANCELLABLE" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// verifyPlatformPassword — re-auth helper
// ═══════════════════════════════════════════════════════════════════════════

describe("verifyPlatformPassword", () => {
  async function helper() {
    return await import("../server/services/platformTenantTeardownAuth");
  }

  it("returns INVALID_PASSWORD when the email lookup misses", async () => {
    findPlatformByEmail.mockResolvedValue(null);
    bcryptCompareMock.mockResolvedValue(false);
    const { verifyPlatformPassword } = await helper();
    const r = await verifyPlatformPassword({
      userId: "u1",
      email: "nobody@example.test",
      password: "x",
    });
    expect(r).toEqual({ ok: false, code: "INVALID_PASSWORD" });
    // Always runs bcrypt to keep timing uniform.
    expect(bcryptCompareMock).toHaveBeenCalled();
  });

  it("returns INVALID_PASSWORD when the password is wrong", async () => {
    findPlatformByEmail.mockResolvedValue({
      user: { id: "u1", disabled: false, status: "active" },
      identity: { passwordHash: "$2a$10$validhash" },
      roles: ["platform_super_admin"],
    });
    bcryptCompareMock.mockResolvedValue(false);
    const { verifyPlatformPassword } = await helper();
    const r = await verifyPlatformPassword({
      userId: "u1",
      email: "a@example.test",
      password: "wrong",
    });
    expect(r).toEqual({ ok: false, code: "INVALID_PASSWORD" });
  });

  it("returns ACCOUNT_DISABLED when user is disabled", async () => {
    findPlatformByEmail.mockResolvedValue({
      user: { id: "u1", disabled: true, status: "active" },
      identity: { passwordHash: "$2a$10$validhash" },
      roles: ["platform_super_admin"],
    });
    bcryptCompareMock.mockResolvedValue(true);
    const { verifyPlatformPassword } = await helper();
    const r = await verifyPlatformPassword({
      userId: "u1",
      email: "a@example.test",
      password: "x",
    });
    expect(r).toEqual({ ok: false, code: "ACCOUNT_DISABLED" });
  });

  it("returns NO_IDENTITY when password hash is missing", async () => {
    findPlatformByEmail.mockResolvedValue({
      user: { id: "u1", disabled: false, status: "active" },
      identity: { passwordHash: null },
      roles: ["platform_super_admin"],
    });
    const { verifyPlatformPassword } = await helper();
    const r = await verifyPlatformPassword({
      userId: "u1",
      email: "a@example.test",
      password: "x",
    });
    expect(r).toEqual({ ok: false, code: "NO_IDENTITY" });
  });

  it("returns ok:true on a valid match", async () => {
    findPlatformByEmail.mockResolvedValue({
      user: { id: "u1", disabled: false, status: "active" },
      identity: { passwordHash: "$2a$10$validhash" },
      roles: ["platform_super_admin"],
    });
    bcryptCompareMock.mockResolvedValue(true);
    const { verifyPlatformPassword } = await helper();
    const r = await verifyPlatformPassword({
      userId: "u1",
      email: "a@example.test",
      password: "right",
    });
    expect(r).toEqual({ ok: true });
  });

  it("rejects userId mismatch even when email resolves", async () => {
    findPlatformByEmail.mockResolvedValue({
      user: { id: "u1", disabled: false, status: "active" },
      identity: { passwordHash: "$2a$10$validhash" },
      roles: ["platform_super_admin"],
    });
    const { verifyPlatformPassword } = await helper();
    const r = await verifyPlatformPassword({
      userId: "u-different",
      email: "a@example.test",
      password: "x",
    });
    expect(r).toEqual({ ok: false, code: "INVALID_PASSWORD" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Capability registry — structural separation of duties
// ═══════════════════════════════════════════════════════════════════════════

describe("capability registry", () => {
  it("never grants execute to a human role", async () => {
    const { PLATFORM_ROLE_CAPS } = await import("../shared/platformCapabilities");
    for (const role of Object.keys(PLATFORM_ROLE_CAPS)) {
      expect(PLATFORM_ROLE_CAPS[role]).not.toContain(
        "platform:tenant_teardown_execute",
      );
    }
  });

  it("only super admin holds the approve cap", async () => {
    const { PLATFORM_ROLE_CAPS } = await import("../shared/platformCapabilities");
    const grantingRoles = Object.entries(PLATFORM_ROLE_CAPS)
      .filter(([, caps]) => caps.includes("platform:tenant_teardown_approve"))
      .map(([role]) => role);
    expect(grantingRoles).toEqual(["platform_super_admin"]);
  });

  it("admin holds request but not approve", async () => {
    const { PLATFORM_ROLE_CAPS } = await import("../shared/platformCapabilities");
    const admin = PLATFORM_ROLE_CAPS["platform_admin"];
    expect(admin).toContain("platform:tenant_teardown_request");
    expect(admin).not.toContain("platform:tenant_teardown_approve");
  });

  it("support holds preview only", async () => {
    const { PLATFORM_ROLE_CAPS } = await import("../shared/platformCapabilities");
    const support = PLATFORM_ROLE_CAPS["platform_support"];
    expect(support).toContain("platform:tenant_teardown_preview");
    expect(support).not.toContain("platform:tenant_teardown_request");
    expect(support).not.toContain("platform:tenant_teardown_approve");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// F1 hardening — worker audit emission
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Drive a request through the full happy-path lifecycle (preview →
 * request → approve → execute) so the audit assertions have realistic
 * row state to inspect. Returns the post-completion request id +
 * helpers for inspecting captured audit calls.
 */
async function runHappyPathExecution() {
  const svc = await import("../server/services/tenantDeletionRequestService");
  const { computePreviewHash } = await import(
    "../server/services/platformTenantTeardownPreviewHash"
  );
  const hash = computePreviewHash(SAMPLE_INVENTORY);
  // Default mock: dryRun preview + the verify-clean confirm result.
  teardownMock.mockReset();
  teardownMock.mockImplementation(async (input: any) => {
    if (input.dryRun) {
      return { inventory: SAMPLE_INVENTORY, providerRetentions: {} };
    }
    return {
      inventory: SAMPLE_INVENTORY,
      executed: {
        dryRun: false,
        r2DeletedObjects: 7,
        r2DeletedBytes: 4096,
        r2DeleteErrors: [],
        qboRevokeAttempted: false,
        qboRevokeSuccess: null,
        qboRevokeMessage: null,
        sessionsDeleted: 2,
        dbCascadeDeletedCompanies: 1,
        dbCascadeRowsApprox: 17,
      },
      verification: {
        companiesRemaining: 0,
        usersWithEmailRemaining: 0,
        userIdsRemaining: 0,
        fkTablesWithRows: [],
        r2ObjectsRemaining: 0,
        auditLogsTargetingTenant: 5,
      },
      providerRetentions: [],
    };
  });
  const created = await svc.createRequest({
    companyId: "tenant-1",
    previewHash: hash,
    previewGeneratedAt: new Date().toISOString(),
    previewPayload: SAMPLE_INVENTORY,
    reason: "Tenant abandoned project, requesting cleanup per agreement.",
    confirmations: {
      tenantName: "Acme Inc",
      tenantId: "tenant-1",
      phrase: svc.CONFIRMATION_PHRASE,
    },
    initiator: { id: "user-A", email: "a@platform.test" },
  });
  await svc.approveRequest({
    requestId: created.id,
    approver: { id: "user-B", email: "b@platform.test" },
  });
  // Move the schedule into the past so executeRequest passes its
  // "execution window has opened" guard.
  repoState.rows.get(created.id).executionScheduledAt = new Date(
    Date.now() - 1000,
  );
  const exec = await svc.executeRequest(created.id);
  return { svc, created, exec };
}

function findAuditCall(action: string) {
  return auditLogMock.mock.calls.find(
    (c: any[]) => c[0]?.action === action,
  )?.[0];
}

describe("F1 — worker audit emission", () => {
  it("emits platform_tenant_teardown_execute_started on transition to executing", async () => {
    const { created } = await runHappyPathExecution();
    const call = findAuditCall("platform_tenant_teardown_execute_started");
    expect(call).toBeDefined();
    expect(call.platformAdminId).toBe("system");
    expect(call.platformAdminEmail).toBe("system");
    expect(call.targetCompanyId).toBe("tenant-1");
    expect(call.details.requestId).toBe(created.id);
    expect(call.details.transition).toBe("approved → executing");
    expect(call.details.executionStartedAt).toBeTruthy();
    expect(call.details.companyNameSnapshot).toBe("Acme Inc");
    // Sensitive fields must NOT leak into audit details.
    expect(call.details).not.toHaveProperty("previewPayloadJson");
    expect(call.details).not.toHaveProperty("requestUserAgent");
  });

  it("emits platform_tenant_teardown_executed on successful completion", async () => {
    const { created } = await runHappyPathExecution();
    const call = findAuditCall("platform_tenant_teardown_executed");
    expect(call).toBeDefined();
    expect(call.platformAdminId).toBe("system");
    expect(call.targetCompanyId).toBe("tenant-1");
    expect(call.details.requestId).toBe(created.id);
    expect(call.details.transition).toBe("executing → completed");
    expect(call.details.summary).toMatchObject({
      r2DeletedObjects: 7,
      r2DeletedBytes: 4096,
      r2DeleteErrorCount: 0,
      sessionsDeleted: 2,
      dbCascadeRowsApprox: 17,
    });
    // Verification COUNTS only — no table names, no key paths.
    expect(call.details.summary.verification.fkTablesWithRowsCount).toBe(0);
    expect(call.details.summary.verification.r2ObjectsRemaining).toBe(0);
    expect(call.details.summary).not.toHaveProperty("r2DeleteErrors");
    expect(call.details.summary).not.toHaveProperty("sampleKeys");
  });

  it("emits platform_tenant_teardown_execute_failed when teardown throws", async () => {
    const svc = await import("../server/services/tenantDeletionRequestService");
    const { computePreviewHash } = await import(
      "../server/services/platformTenantTeardownPreviewHash"
    );
    const hash = computePreviewHash(SAMPLE_INVENTORY);
    teardownMock.mockReset();
    teardownMock.mockImplementation(async (input: any) => {
      if (input.dryRun) {
        return { inventory: SAMPLE_INVENTORY, providerRetentions: {} };
      }
      throw new Error("R2 credentials invalid");
    });
    const created = await svc.createRequest({
      companyId: "tenant-1",
      previewHash: hash,
      previewGeneratedAt: new Date().toISOString(),
      previewPayload: SAMPLE_INVENTORY,
      reason: "Tenant abandoned project, requesting cleanup per agreement.",
      confirmations: {
        tenantName: "Acme Inc",
        tenantId: "tenant-1",
        phrase: svc.CONFIRMATION_PHRASE,
      },
      initiator: { id: "user-A", email: "a@platform.test" },
    });
    await svc.approveRequest({
      requestId: created.id,
      approver: { id: "user-B", email: "b@platform.test" },
    });
    repoState.rows.get(created.id).executionScheduledAt = new Date(
      Date.now() - 1000,
    );
    const result = await svc.executeRequest(created.id);
    expect(result.outcome).toBe("failed");
    const call = findAuditCall("platform_tenant_teardown_execute_failed");
    expect(call).toBeDefined();
    expect(call.platformAdminId).toBe("system");
    expect(call.targetCompanyId).toBe("tenant-1");
    expect(call.details.failureReason).toMatch(/R2 credentials invalid/);
    expect(call.details.failedAt).toBeTruthy();
    expect(call.details).not.toHaveProperty("previewPayloadJson");
  });

  it("emits platform_tenant_teardown_expired when a pending row times out", async () => {
    const svc = await import("../server/services/tenantDeletionRequestService");
    const { computePreviewHash } = await import(
      "../server/services/platformTenantTeardownPreviewHash"
    );
    const hash = computePreviewHash(SAMPLE_INVENTORY);
    const created = await svc.createRequest({
      companyId: "tenant-1",
      previewHash: hash,
      previewGeneratedAt: new Date().toISOString(),
      previewPayload: SAMPLE_INVENTORY,
      reason: "Tenant abandoned project, requesting cleanup per agreement.",
      confirmations: {
        tenantName: "Acme Inc",
        tenantId: "tenant-1",
        phrase: svc.CONFIRMATION_PHRASE,
      },
      initiator: { id: "user-A", email: "a@platform.test" },
    });
    const result = await svc.expireOnePending(created);
    expect(result?.status).toBe("expired");
    const call = findAuditCall("platform_tenant_teardown_expired");
    expect(call).toBeDefined();
    expect(call.platformAdminId).toBe("system");
    expect(call.targetCompanyId).toBe("tenant-1");
    expect(call.details.requestId).toBe(created.id);
    expect(call.details.transition).toBe("pending → expired");
    expect(call.details.expiredAt).toBeTruthy();
    expect(call.details.originalExpiresAt).toBeTruthy();
    // Reason text from the original request should NOT be leaked into
    // the expired audit row's details — the actor never typed it; the
    // worker shouldn't echo it. (It's still in the source-of-truth row.)
    expect(call.details).not.toHaveProperty("reason");
  });

  it("includes envSnapshot but never raw DATABASE_URL or secrets", async () => {
    process.env.DATABASE_URL =
      "postgres://secret_user:secret_pass@some-db.example/test";
    const { created } = await runHappyPathExecution();
    void created;
    const call = findAuditCall("platform_tenant_teardown_execute_started");
    expect(call.details.environment).toBeDefined();
    expect(call.details.environment.dbHost).toBe("some-db.example");
    // Stringify the full audit payload — must not contain raw credentials.
    const serialized = JSON.stringify(call);
    expect(serialized).not.toContain("secret_user");
    expect(serialized).not.toContain("secret_pass");
    delete process.env.DATABASE_URL;
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// F2 hardening — stale-executing reaper
// ═══════════════════════════════════════════════════════════════════════════

describe("F2 — stale-executing reaper", () => {
  /**
   * Helper: drive a request through approve → executing then leave it
   * stuck. `executionStartedAt` is the anchor the reaper looks at.
   */
  async function setupStuckExecuting(opts: { ageMs: number }) {
    const svc = await import("../server/services/tenantDeletionRequestService");
    const { computePreviewHash } = await import(
      "../server/services/platformTenantTeardownPreviewHash"
    );
    const hash = computePreviewHash(SAMPLE_INVENTORY);
    teardownMock.mockReset();
    teardownMock.mockResolvedValue({
      inventory: SAMPLE_INVENTORY,
      providerRetentions: {},
    });
    const created = await svc.createRequest({
      companyId: "tenant-1",
      previewHash: hash,
      previewGeneratedAt: new Date().toISOString(),
      previewPayload: SAMPLE_INVENTORY,
      reason: "Tenant abandoned project, requesting cleanup per agreement.",
      confirmations: {
        tenantName: "Acme Inc",
        tenantId: "tenant-1",
        phrase: svc.CONFIRMATION_PHRASE,
      },
      initiator: { id: "user-A", email: "a@platform.test" },
    });
    await svc.approveRequest({
      requestId: created.id,
      approver: { id: "user-B", email: "b@platform.test" },
    });
    // Manually fake the executing claim — DO NOT call executeRequest
    // (that would actually finish). Set executionStartedAt to the
    // requested age in the past.
    const row = repoState.rows.get(created.id);
    Object.assign(row, {
      status: "executing",
      executionStartedAt: new Date(Date.now() - opts.ageMs),
    });
    return { svc, created, row };
  }

  it("does NOT reap a fresh executing row", async () => {
    const { svc } = await setupStuckExecuting({ ageMs: 5 * 60 * 1000 }); // 5 min — well under threshold
    const cutoff = new Date(Date.now() - svc.STALE_EXECUTING_AFTER_MS);
    const stale =
      await (await import("../server/storage/tenantDeletionRequests")).tenantDeletionRequestsRepository.listStaleExecuting(
        cutoff,
      );
    expect(stale.length).toBe(0);
  });

  it("reaps an executing row past STALE_EXECUTING_AFTER_MS and marks it failed", async () => {
    const { svc, row } = await setupStuckExecuting({
      ageMs: 70 * 60 * 1000, // 70 min — over the 60-min threshold
    });
    const failed = await svc.reapStaleExecuting(row);
    expect(failed).toBeTruthy();
    expect(failed?.status).toBe("failed");
    expect(failed?.failureReason).toBe(svc.STALE_FAILURE_REASON);
  });

  it("emits platform_tenant_teardown_execute_failed audit row with stale=true marker", async () => {
    const { svc, row } = await setupStuckExecuting({ ageMs: 70 * 60 * 1000 });
    await svc.reapStaleExecuting(row);
    const call = findAuditCall("platform_tenant_teardown_execute_failed");
    expect(call).toBeDefined();
    expect(call.platformAdminId).toBe("system");
    expect(call.details.stale).toBe(true);
    expect(call.details.staleTimeoutMs).toBe(svc.STALE_EXECUTING_AFTER_MS);
    expect(call.details.failureReason).toBe(svc.STALE_FAILURE_REASON);
    expect(call.details.executionStartedAt).toBeTruthy();
    expect(call.details.transition).toBe("executing → failed");
  });

  it("calls sendTeardownAlert with execution_failed for stale rows", async () => {
    const { svc, row } = await setupStuckExecuting({ ageMs: 70 * 60 * 1000 });
    await svc.reapStaleExecuting(row);
    const alertCall = sendAlertMock.mock.calls.find(
      (c: any[]) => c[0]?.event === "execution_failed",
    )?.[0];
    expect(alertCall).toBeDefined();
    expect(alertCall.failureReason).toBe(svc.STALE_FAILURE_REASON);
    expect(alertCall.companyId).toBe("tenant-1");
  });

  it("never re-invokes teardownTenant when reaping (no double execution)", async () => {
    const { svc, row } = await setupStuckExecuting({ ageMs: 70 * 60 * 1000 });
    const callsBefore = teardownMock.mock.calls.length;
    await svc.reapStaleExecuting(row);
    const callsAfter = teardownMock.mock.calls.length;
    // The reaper must NOT call teardownTenant — it's a state-machine
    // transition only, never a destructive retry.
    expect(callsAfter).toBe(callsBefore);
  });

  it("never flips a stale row back to approved", async () => {
    const { svc, created } = await setupStuckExecuting({
      ageMs: 70 * 60 * 1000,
    });
    await svc.reapStaleExecuting(repoState.rows.get(created.id));
    const row = repoState.rows.get(created.id);
    expect(row.status).toBe("failed");
    expect(row.status).not.toBe("approved");
  });

  it("returns null without alert/audit when the row was already terminal (race-loser path)", async () => {
    const { svc, row, created } = await setupStuckExecuting({
      ageMs: 70 * 60 * 1000,
    });
    // Simulate a worker beating the reaper to the punch.
    Object.assign(repoState.rows.get(created.id), {
      status: "completed",
      executedAt: new Date(),
    });
    auditLogMock.mockClear();
    sendAlertMock.mockClear();
    const result = await svc.reapStaleExecuting(row);
    expect(result).toBeNull();
    // Race-loser path: must not emit audit or alert.
    expect(auditLogMock).not.toHaveBeenCalled();
    expect(sendAlertMock).not.toHaveBeenCalled();
  });

  it("listStaleExecuting filters by status='executing' AND executionStartedAt < cutoff", async () => {
    // Three rows: fresh executing, stale executing, completed (terminal)
    const fresh = {
      id: "r-fresh",
      status: "executing",
      executionStartedAt: new Date(Date.now() - 5 * 60 * 1000),
      companyId: "t-fresh",
    };
    const stale = {
      id: "r-stale",
      status: "executing",
      executionStartedAt: new Date(Date.now() - 90 * 60 * 1000),
      companyId: "t-stale",
    };
    const done = {
      id: "r-done",
      status: "completed",
      executionStartedAt: new Date(Date.now() - 90 * 60 * 1000),
      companyId: "t-done",
    };
    repoState.rows.set(fresh.id, fresh);
    repoState.rows.set(stale.id, stale);
    repoState.rows.set(done.id, done);
    const { tenantDeletionRequestsRepository } = await import(
      "../server/storage/tenantDeletionRequests"
    );
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    const result =
      await tenantDeletionRequestsRepository.listStaleExecuting(cutoff);
    expect(result.map((r) => r.id).sort()).toEqual(["r-stale"]);
  });
});
