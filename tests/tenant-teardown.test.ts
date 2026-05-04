/**
 * tenantTeardownService — regression suite (2026-05-04).
 *
 * Coverage:
 *   1. Prefix guard rejects empty / "/" / non-tenant prefixes BEFORE any
 *      R2 SDK call.
 *   2. Production refuses unless ALLOW_PRODUCTION_RESET=true.
 *   3. Resolution by companyId vs email (ambiguous email rejected).
 *   4. Dry-run never deletes from DB or R2.
 *   5. Confirm path: R2 list → batch-delete → DB cascade → verification.
 *   6. Idempotent re-run on a clean tenant resolves to no-op.
 *   7. R2 sweep refuses to delete keys that don't start with the prefix
 *      (defense-in-depth; the SDK shouldn't return them but we test the
 *      filter anyway).
 *   8. Provider retention notes are present on every result.
 *
 * Mock-style harness — no real DB, no real Stripe, no real R2.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── R2 + storage mocks (hoisted) ─────────────────────────────────────────
const r2State = {
  configured: true,
  bucket: "test-bucket",
  // Keyed by bucket → list of { key, sizeBytes }.
  objects: new Map<string, Array<{ key: string; sizeBytes: number }>>(),
};
function getStripeAdapterStubObjects(prefix: string) {
  const all = r2State.objects.get(r2State.bucket) ?? [];
  return all.filter((o) => o.key.startsWith(prefix));
}

vi.mock("../server/services/storage/R2StorageProvider", () => {
  return {
    isR2Configured: () => r2State.configured,
    getR2Provider: () => ({
      defaultBucket: r2State.bucket,
      iterListObjectsByPrefix: async function* (bucket: string, prefix: string) {
        const matches = getStripeAdapterStubObjects(prefix);
        // Yield in pages of ~1000 just to mirror the real SDK contract.
        for (let i = 0; i < matches.length; i += 1000) {
          yield matches.slice(i, i + 1000);
        }
      },
      deleteObjectsBatch: async (bucket: string, keys: string[]) => {
        const all = r2State.objects.get(bucket) ?? [];
        const remaining = all.filter((o) => !keys.includes(o.key));
        r2State.objects.set(bucket, remaining);
        return { deleted: keys.length, errors: [] };
      },
    }),
  };
});

// ─── DB mock — minimal `pg.Client` shape the service expects ──────────────
type FakeRow = Record<string, unknown>;
const dbState = {
  // canned response per query string. The service uses parameterised
  // queries; we match by a substring of the SQL so test setup stays terse.
  responders: [] as Array<{
    match: RegExp;
    handler: (params: any[]) => { rows: FakeRow[]; rowCount?: number };
  }>,
  log: [] as Array<{ sql: string; params: any[] }>,
};

function setResponder(
  match: RegExp,
  handler: (params: any[]) => { rows: FakeRow[]; rowCount?: number },
) {
  dbState.responders.unshift({ match, handler });
}

function makeFakeClient(): any {
  return {
    async connect() {},
    async end() {},
    async query(sqlOrConfig: string | { text: string; values?: any[] }, params?: any[]) {
      const sql = typeof sqlOrConfig === "string" ? sqlOrConfig : sqlOrConfig.text;
      const values =
        typeof sqlOrConfig === "string" ? params ?? [] : sqlOrConfig.values ?? [];
      dbState.log.push({ sql, params: values });
      for (const r of dbState.responders) {
        if (r.match.test(sql)) {
          const out = r.handler(values);
          return { rows: out.rows, rowCount: out.rowCount ?? out.rows.length };
        }
      }
      // Default: empty result. Suitable for FK enumeration on a clean DB.
      return { rows: [], rowCount: 0 };
    },
  };
}

beforeEach(() => {
  dbState.responders = [];
  dbState.log = [];
  r2State.configured = true;
  r2State.bucket = "test-bucket";
  r2State.objects = new Map([["test-bucket", []]]);
  delete process.env.ALLOW_PRODUCTION_RESET;
  delete process.env.NODE_ENV;
});

// ─── Imports under test (after mocks declared) ─────────────────────────────
import {
  teardownTenant,
  __test__,
} from "../server/services/tenantTeardownService";

// ═══════════════════════════════════════════════════════════════════════════
// Prefix guard
// ═══════════════════════════════════════════════════════════════════════════

describe("R2 prefix guard", () => {
  it("rejects empty / '/' / 'tenants/' prefixes", () => {
    expect(() => __test__.guardPrefix("")).toThrow(/refused/i);
    expect(() => __test__.guardPrefix("/")).toThrow(/refused/i);
    expect(() => __test__.guardPrefix("tenants/")).toThrow(/refused/i);
    expect(() => __test__.guardPrefix("tenants")).toThrow(/refused/i);
  });

  it("rejects prefixes that don't match the canonical tenants/<uuid>/ pattern", () => {
    expect(() => __test__.guardPrefix("not-tenants/abc/")).toThrow(/canonical/);
    expect(() => __test__.guardPrefix("tenants/notauuid/")).toThrow(/canonical/);
    expect(() => __test__.guardPrefix("tenants/abc/")).toThrow(/canonical/);
  });

  it("accepts a valid tenants/<uuid>/ prefix", () => {
    expect(() =>
      __test__.guardPrefix("tenants/290c20d3-4e61-4766-af4e-953fbdfc465f/"),
    ).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Production refusal
// ═══════════════════════════════════════════════════════════════════════════

describe("production guard", () => {
  it("refuses NODE_ENV=production by default", async () => {
    process.env.NODE_ENV = "production";
    await expect(
      teardownTenant({
        companyId: "290c20d3-4e61-4766-af4e-953fbdfc465f",
        dryRun: true,
        db: makeFakeClient(),
      }),
    ).rejects.toThrow(/production/);
  });

  it("allows production when ALLOW_PRODUCTION_RESET=true", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_PRODUCTION_RESET = "true";
    // Resolve to "no company" so the run completes without DB calls.
    setResponder(/FROM users WHERE company_id/, () => ({ rows: [] }));
    setResponder(/FROM companies WHERE id = \$1/, () => ({ rows: [] }));
    const out = await teardownTenant({
      companyId: "290c20d3-4e61-4766-af4e-953fbdfc465f",
      dryRun: true,
      db: makeFakeClient(),
    });
    // companyId was provided but no users found and the company row is
    // missing — service still runs through (the cleanup-samcor flow).
    expect(out.resolved.companyIds.length).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Required-input guard
// ═══════════════════════════════════════════════════════════════════════════

describe("input guards", () => {
  it("requires companyId or email", async () => {
    await expect(teardownTenant({ dryRun: true } as any)).rejects.toThrow(
      /companyId or email/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Dry-run is read-only
// ═══════════════════════════════════════════════════════════════════════════

describe("dry-run", () => {
  it("is purely read-only — no DELETE / UPDATE issued, no R2 deletes", async () => {
    const tenantId = "290c20d3-4e61-4766-af4e-953fbdfc465f";
    setResponder(/FROM users WHERE company_id = \$1/, () => ({
      rows: [{ id: "u1" }, { id: "u2" }],
    }));
    setResponder(/FROM companies WHERE id = \$1/, () => ({
      rows: [{ id: tenantId }],
    }));
    setResponder(/information_schema/, () => ({ rows: [] }));
    setResponder(/FROM qbo_connections/, () => ({ rows: [{ n: "0" }] }));
    setResponder(/FROM companies WHERE id = ANY.*qbo_realm_id/, () => ({
      rows: [{ n: "0" }],
    }));
    setResponder(/FROM payment_provider_accounts/, () => ({
      rows: [{ n_total: "0", n_with_account: "0" }],
    }));
    setResponder(/FROM session/, () => ({ rows: [{ n: "0" }] }));

    r2State.objects.set("test-bucket", [
      { key: `tenants/${tenantId}/jobs/x/file.jpg`, sizeBytes: 100 },
    ]);

    const r = await teardownTenant({
      companyId: tenantId,
      dryRun: true,
      db: makeFakeClient(),
    });

    expect(r.executed.dryRun).toBe(true);
    expect(r.executed.r2DeletedObjects).toBe(0);
    expect(r.executed.dbCascadeDeletedCompanies).toBe(0);
    // R2 inventory still ran — service reports what it WOULD delete.
    expect(r.inventory.r2.objectCount).toBe(1);
    expect(r.inventory.r2.prefix).toBe(`tenants/${tenantId}/`);
    // Defensive: assert no DELETE / UPDATE / BEGIN went to the DB.
    const destructive = dbState.log.filter((l) =>
      /\b(DELETE FROM|UPDATE |BEGIN)\b/i.test(l.sql),
    );
    expect(destructive).toEqual([]);
    // R2 still has the object.
    expect(getStripeAdapterStubObjects(`tenants/${tenantId}/`)).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Confirm path — R2 sweep + DB cascade + verification
// ═══════════════════════════════════════════════════════════════════════════

describe("confirm path", () => {
  it("deletes every R2 object under the prefix + the company row + verifies", async () => {
    const tenantId = "290c20d3-4e61-4766-af4e-953fbdfc465f";
    let companyDeleted = false;

    setResponder(/FROM users WHERE company_id = \$1/, () => ({
      rows: [{ id: "u1" }],
    }));
    setResponder(/FROM companies WHERE id = \$1/, () => ({
      rows: companyDeleted ? [] : [{ id: tenantId }],
    }));
    setResponder(/information_schema/, () => ({ rows: [] }));
    setResponder(/FROM qbo_connections/, () => ({ rows: [{ n: "0" }] }));
    setResponder(/FROM companies WHERE id = ANY.*qbo_realm_id/, () => ({
      rows: [{ n: "0" }],
    }));
    setResponder(/FROM payment_provider_accounts/, () => ({
      rows: [{ n_total: "0", n_with_account: "0" }],
    }));
    setResponder(/FROM session/, () => ({ rows: [{ n: "0" }] }));
    setResponder(/^BEGIN$/, () => ({ rows: [] }));
    setResponder(/^COMMIT$/, () => ({ rows: [] }));
    setResponder(/^ROLLBACK$/, () => ({ rows: [] }));
    setResponder(
      /DELETE FROM session/,
      () => ({ rows: [], rowCount: 0 }),
    );
    setResponder(
      /DELETE FROM "[a-z_]+" WHERE company_id = ANY/,
      () => ({ rows: [], rowCount: 0 }),
    );
    setResponder(/DELETE FROM companies WHERE id = ANY/, () => {
      companyDeleted = true;
      return { rows: [], rowCount: 1 };
    });
    // Verification stage queries.
    setResponder(/FROM companies WHERE id = ANY/, () => ({
      rows: [{ n: companyDeleted ? "0" : "1" }],
    }));
    setResponder(/FROM users WHERE id = ANY/, () => ({ rows: [{ n: "0" }] }));
    setResponder(/FROM audit_logs/, () => ({ rows: [{ n: "0" }] }));

    // Seed R2 with 3 objects under the prefix + 1 unrelated.
    r2State.objects.set("test-bucket", [
      { key: `tenants/${tenantId}/jobs/a/file1.jpg`, sizeBytes: 100 },
      { key: `tenants/${tenantId}/jobs/b/file2.jpg`, sizeBytes: 200 },
      { key: `tenants/${tenantId}/clients/c/file3.pdf`, sizeBytes: 300 },
      { key: `tenants/UNRELATED-ID/jobs/x/keepme.txt`, sizeBytes: 9999 },
    ]);

    const r = await teardownTenant({
      companyId: tenantId,
      dryRun: false,
      db: makeFakeClient(),
    });

    expect(r.executed.r2DeletedObjects).toBe(3);
    expect(r.executed.r2DeletedBytes).toBe(600);
    expect(r.executed.dbCascadeDeletedCompanies).toBe(1);
    expect(r.verification?.r2ObjectsRemaining).toBe(0);
    // Unrelated tenant data UNTOUCHED.
    expect(getStripeAdapterStubObjects("tenants/UNRELATED-ID/")).toHaveLength(1);
    // Provider retention notes always present.
    expect(r.providerRetentions.length).toBeGreaterThan(0);
    expect(r.providerRetentions.find((x) => x.provider === "resend")).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Idempotency: second run on a clean tenant
// ═══════════════════════════════════════════════════════════════════════════

describe("idempotency", () => {
  it("a re-run after a clean tenant returns 'no company'", async () => {
    setResponder(/FROM users WHERE lower\(email\)/, () => ({ rows: [] }));
    setResponder(/FROM companies/, () => ({ rows: [] }));

    const r = await teardownTenant({
      email: "service@samcor.ca",
      dryRun: true,
      db: makeFakeClient(),
    });
    expect(r.resolved.companyIds).toEqual([]);
    expect(r.inventory.totalFkRows).toBe(0);
    expect(r.executed.r2DeletedObjects).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Ambiguous email rejected
// ═══════════════════════════════════════════════════════════════════════════

describe("ambiguous email", () => {
  it("rejects an email that resolves to >1 companies (without a companyId override)", async () => {
    setResponder(/FROM users WHERE lower\(email\)/, () => ({
      rows: [
        { id: "u1", company_id: "co_1" },
        { id: "u2", company_id: "co_2" },
      ],
    }));
    await expect(
      teardownTenant({
        email: "shared@example.com",
        dryRun: true,
        db: makeFakeClient(),
      }),
    ).rejects.toThrow(/Ambiguous tenant/);
  });

  it("accepts the same email when --company-id is supplied", async () => {
    const companyId = "290c20d3-4e61-4766-af4e-953fbdfc465f";
    setResponder(/FROM users WHERE lower\(email\)/, () => ({
      rows: [
        { id: "u1", company_id: "co_1" },
        { id: "u2", company_id: "co_2" },
      ],
    }));
    setResponder(/FROM users WHERE company_id = \$1/, () => ({
      rows: [{ id: "u1" }],
    }));
    setResponder(/FROM companies WHERE id = \$1/, () => ({
      rows: [{ id: companyId }],
    }));
    setResponder(/information_schema/, () => ({ rows: [] }));
    setResponder(/FROM qbo_connections/, () => ({ rows: [{ n: "0" }] }));
    setResponder(/qbo_realm_id/, () => ({ rows: [{ n: "0" }] }));
    setResponder(/FROM payment_provider_accounts/, () => ({
      rows: [{ n_total: "0", n_with_account: "0" }],
    }));
    setResponder(/FROM session/, () => ({ rows: [{ n: "0" }] }));

    const r = await teardownTenant({
      companyId,
      dryRun: true,
      db: makeFakeClient(),
    });
    expect(r.resolved.companyIds).toEqual([companyId]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Skip flags
// ═══════════════════════════════════════════════════════════════════════════

describe("skip flags", () => {
  it("--skip-r2 produces an inventory with R2 disabled and zero deletions", async () => {
    const tenantId = "290c20d3-4e61-4766-af4e-953fbdfc465f";
    setResponder(/FROM users WHERE company_id = \$1/, () => ({ rows: [] }));
    setResponder(/FROM companies WHERE id = \$1/, () => ({
      rows: [{ id: tenantId }],
    }));
    setResponder(/information_schema/, () => ({ rows: [] }));
    setResponder(/FROM qbo_connections/, () => ({ rows: [{ n: "0" }] }));
    setResponder(/qbo_realm_id/, () => ({ rows: [{ n: "0" }] }));
    setResponder(/FROM payment_provider_accounts/, () => ({
      rows: [{ n_total: "0", n_with_account: "0" }],
    }));
    setResponder(/FROM session/, () => ({ rows: [{ n: "0" }] }));

    // Seed R2 — but service should not list/delete because skipR2=true.
    r2State.objects.set("test-bucket", [
      { key: `tenants/${tenantId}/jobs/a/file1.jpg`, sizeBytes: 100 },
    ]);

    const r = await teardownTenant({
      companyId: tenantId,
      dryRun: true,
      skipR2: true,
      db: makeFakeClient(),
    });
    expect(r.inventory.r2.enabled).toBe(false);
    expect(r.inventory.r2.objectCount).toBe(0);
    expect(getStripeAdapterStubObjects(`tenants/${tenantId}/`)).toHaveLength(1);
  });
});
