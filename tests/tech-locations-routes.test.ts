/**
 * Tech Location Routes — Phase 2 PR 1 (2026-05-04)
 *
 * Pins the new tech-safe read endpoints introduced alongside the
 * Phase 1 dashboard authorization fix:
 *
 *   GET /api/tech/locations/:locationId
 *   GET /api/tech/locations/:locationId/equipment
 *   GET /api/tech/locations/:locationId/jobs
 *
 * Tests cover:
 *
 *   1. Source-level wiring pins. The router is imported and mounted
 *      at /api/tech in `server/routes/index.ts`. A future edit that
 *      drops the mount will break this test loudly.
 *
 *   2. Scoping helper behaviour (live DB).
 *      a. Tech with ≥1 active assigned visit at the location → allowed.
 *      b. Tech without an assignment → denied.
 *      c. Tech assigned to an INACTIVE visit (is_active=false) → denied.
 *      d. Cross-tenant access → denied (treated identically to a
 *         non-existent location, no leak).
 *      e. Owner / admin / manager bypass — allowed even without an
 *         assignment, as long as the location exists in their tenant.
 *
 *   3. DTO redaction. The location-detail handler returns ONLY the
 *      whitelisted fields. Sensitive columns (qboCustomerId,
 *      selectedMonths, parentCompanyId, version, deletedAt, notes,
 *      …) are absent from the response object.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { v4 as uuidv4 } from "uuid";
import { and, eq } from "drizzle-orm";

import { db } from "../server/db";
import {
  companies,
  users,
  customerCompanies,
  clientLocations,
  jobs,
  jobVisits,
  locationEquipment,
} from "@shared/schema";

import { assertCanAccessTechLocation } from "../server/auth/techLocationAccess";
import { jobRepository } from "../server/storage/jobs";

// ── Source-level wiring pins ─────────────────────────────────────────

const indexSrc = readFileSync(
  resolve(__dirname, "../server/routes/index.ts"),
  "utf-8",
);
const techLocationsSrc = readFileSync(
  resolve(__dirname, "../server/routes/techLocations.ts"),
  "utf-8",
);

describe("Backend wiring — /api/tech tech-safe location reads", () => {
  it("imports the techLocations router in routes/index.ts", () => {
    expect(indexSrc).toMatch(
      /import\s+techLocationsRouter\s+from\s+["']\.\/techLocations["']/,
    );
  });

  it("mounts techLocationsRouter at /api/tech", () => {
    expect(indexSrc).toMatch(
      /app\.use\(\s*["']\/api\/tech["']\s*,\s*techLocationsRouter\s*\)/,
    );
  });

  it("declares all three tech-safe location read routes", () => {
    expect(techLocationsSrc).toMatch(
      /router\.get\(\s*["']\/locations\/:locationId["']/,
    );
    expect(techLocationsSrc).toMatch(
      /router\.get\(\s*["']\/locations\/:locationId\/equipment["']/,
    );
    expect(techLocationsSrc).toMatch(
      /router\.get\(\s*["']\/locations\/:locationId\/jobs["']/,
    );
  });

  it("gates the router with requireSchedulable", () => {
    expect(techLocationsSrc).toMatch(/router\.use\(\s*requireSchedulable\s*\)/);
  });

  it("each route invokes assertCanAccessTechLocation", () => {
    const matches = techLocationsSrc.match(/assertCanAccessTechLocation\(/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

// ── Live-DB scoping helper coverage ──────────────────────────────────

const PREFIX = "tech_locations_routes_test_";

const tenantA = uuidv4();
const tenantB = uuidv4();
const techA = uuidv4(); // technician in tenant A — assigned at locA1
const techANoAssign = uuidv4(); // technician in tenant A — no assignments
const ownerA = uuidv4();
const adminA = uuidv4();
const managerA = uuidv4();
const dispatcherA = uuidv4();
const customerA = uuidv4();
const locA1 = uuidv4(); // tenant A — techA has an active visit here
const locA2 = uuidv4(); // tenant A — no assignments
const customerB = uuidv4();
const locB = uuidv4(); // tenant B — for cross-tenant probe
let visitA1Id: string | null = null;
let visitA1InactiveId: string | null = null;

async function setupFixtures() {
  await db.insert(companies).values([
    { id: tenantA, name: `${PREFIX}tenant_A` },
    { id: tenantB, name: `${PREFIX}tenant_B` },
  ]);

  await db.insert(users).values([
    {
      id: techA,
      companyId: tenantA,
      email: `${PREFIX}techA_${Date.now()}@test`,
      password: "x",
      role: "technician",
      status: "active",
    },
    {
      id: techANoAssign,
      companyId: tenantA,
      email: `${PREFIX}techANoAssign_${Date.now()}@test`,
      password: "x",
      role: "technician",
      status: "active",
    },
    {
      id: ownerA,
      companyId: tenantA,
      email: `${PREFIX}ownerA_${Date.now()}@test`,
      password: "x",
      role: "owner",
      status: "active",
    },
    {
      id: adminA,
      companyId: tenantA,
      email: `${PREFIX}adminA_${Date.now()}@test`,
      password: "x",
      role: "admin",
      status: "active",
    },
    {
      id: managerA,
      companyId: tenantA,
      email: `${PREFIX}managerA_${Date.now()}@test`,
      password: "x",
      role: "manager",
      status: "active",
    },
    {
      id: dispatcherA,
      companyId: tenantA,
      email: `${PREFIX}dispatcherA_${Date.now()}@test`,
      password: "x",
      role: "dispatcher",
      status: "active",
    },
  ]);

  await db.insert(customerCompanies).values([
    { id: customerA, companyId: tenantA, name: `${PREFIX}custA` },
    { id: customerB, companyId: tenantB, name: `${PREFIX}custB` },
  ]);

  await db.insert(clientLocations).values([
    {
      id: locA1,
      companyId: tenantA,
      parentCompanyId: customerA,
      companyName: `${PREFIX}locA1`,
      address: "1 Main St",
      city: "Toronto",
      province: "ON",
      contactName: "Jane Tenant",
      email: "jane@example.com",
      phone: "555-0101",
      roofLadderCode: "RL-A1",
      qboCustomerId: "qbo-leak-test-A1",
      notes: "internal note must not leak",
      selectedMonths: [1, 4, 7, 10],
    },
    {
      id: locA2,
      companyId: tenantA,
      parentCompanyId: customerA,
      companyName: `${PREFIX}locA2`,
      selectedMonths: [],
    },
    {
      id: locB,
      companyId: tenantB,
      parentCompanyId: customerB,
      companyName: `${PREFIX}locB`,
      selectedMonths: [],
    },
  ]);

  // Job + active assigned visit at locA1 for techA.
  const jobA1 = await jobRepository.createJob(tenantA, {
    companyId: tenantA,
    locationId: locA1,
    summary: `${PREFIX}jobA1`,
    status: "open",
    jobType: "maintenance",
    priority: "medium",
  });
  const [vA1] = await db
    .select()
    .from(jobVisits)
    .where(
      and(eq(jobVisits.companyId, tenantA), eq(jobVisits.jobId, jobA1.id)),
    )
    .limit(1);
  visitA1Id = vA1.id;
  await db
    .update(jobVisits)
    .set({ assignedTechnicianIds: [techA], scheduledStart: new Date() })
    .where(eq(jobVisits.id, vA1.id));

  // Inactive visit at locA2 — must NOT grant access to techA.
  const jobA2 = await jobRepository.createJob(tenantA, {
    companyId: tenantA,
    locationId: locA2,
    summary: `${PREFIX}jobA2`,
    status: "open",
    jobType: "maintenance",
    priority: "medium",
  });
  const [vA2] = await db
    .select()
    .from(jobVisits)
    .where(
      and(eq(jobVisits.companyId, tenantA), eq(jobVisits.jobId, jobA2.id)),
    )
    .limit(1);
  visitA1InactiveId = vA2.id;
  await db
    .update(jobVisits)
    .set({
      assignedTechnicianIds: [techA],
      scheduledStart: new Date(),
      isActive: false,
    })
    .where(eq(jobVisits.id, vA2.id));

  // Equipment row at locA1 — used to verify the equipment endpoint shape.
  await db.insert(locationEquipment).values({
    id: uuidv4(),
    companyId: tenantA,
    locationId: locA1,
    name: `${PREFIX}eq1`,
    equipmentType: "RTU",
    manufacturer: "Acme",
    modelNumber: "X-100",
    serialNumber: "SN-001",
    notes: "internal eq note",
    isActive: true,
  });
}

async function teardownFixtures() {
  for (const tid of [tenantA, tenantB]) {
    await db.delete(locationEquipment).where(eq(locationEquipment.companyId, tid));
    await db.delete(jobVisits).where(eq(jobVisits.companyId, tid));
    await db.delete(jobs).where(eq(jobs.companyId, tid));
    await db.delete(clientLocations).where(eq(clientLocations.companyId, tid));
    await db.delete(customerCompanies).where(eq(customerCompanies.companyId, tid));
    await db.delete(users).where(eq(users.companyId, tid));
    await db.delete(companies).where(eq(companies.id, tid));
  }
}

describe("assertCanAccessTechLocation — scoping rules (live DB)", () => {
  beforeAll(async () => {
    await setupFixtures();
  });

  afterAll(async () => {
    await teardownFixtures();
  });

  it("allows a technician with an active assigned visit at the location", async () => {
    await expect(
      assertCanAccessTechLocation(tenantA, techA, "technician", locA1),
    ).resolves.toBeUndefined();
  });

  it("denies a technician without any assignment at the location", async () => {
    await expect(
      assertCanAccessTechLocation(tenantA, techANoAssign, "technician", locA1),
    ).rejects.toThrow(/access denied/i);
  });

  it("denies a technician whose only assignment is an INACTIVE visit", async () => {
    await expect(
      assertCanAccessTechLocation(tenantA, techA, "technician", locA2),
    ).rejects.toThrow(/access denied/i);
  });

  it("denies cross-tenant access without leaking the location's existence", async () => {
    await expect(
      assertCanAccessTechLocation(tenantA, techA, "technician", locB),
    ).rejects.toThrow(/access denied/i);
  });

  it("denies a dispatcher in tenant A without an assignment", async () => {
    // Spec: only owner/admin/manager bypass; dispatcher must follow the
    // assignment scope like a technician.
    await expect(
      assertCanAccessTechLocation(tenantA, dispatcherA, "dispatcher", locA1),
    ).rejects.toThrow(/access denied/i);
  });

  it("allows owner/admin/manager once the location belongs to their tenant", async () => {
    await expect(
      assertCanAccessTechLocation(tenantA, ownerA, "owner", locA2),
    ).resolves.toBeUndefined();
    await expect(
      assertCanAccessTechLocation(tenantA, adminA, "admin", locA2),
    ).resolves.toBeUndefined();
    await expect(
      assertCanAccessTechLocation(tenantA, managerA, "manager", locA2),
    ).resolves.toBeUndefined();
  });

  it("denies even an owner if the location is in another tenant", async () => {
    await expect(
      assertCanAccessTechLocation(tenantA, ownerA, "owner", locB),
    ).rejects.toThrow(/access denied/i);
  });
});

// ── DTO redaction pin ────────────────────────────────────────────────
//
// Confirms the location-detail handler in techLocations.ts only emits
// the documented whitelist. We don't spin up the HTTP layer here; we
// re-derive the shape from the source so a future edit that adds a
// sensitive field to the response object trips this test.

describe("DTO redaction — /api/tech/locations/:locationId response shape", () => {
  it("location-detail handler omits sensitive client_locations fields", () => {
    // Pull the detail handler block out of the source.
    const handler = techLocationsSrc.match(
      /router\.get\(\s*["']\/locations\/:locationId["'][\s\S]*?\}\),\s*\);/,
    );
    expect(handler, "expected to find /locations/:locationId handler block")
      .toBeTruthy();
    const block = handler![0];

    // Every key listed in the spec must appear inside the res.json({...}).
    const required = [
      "id",
      "companyName",
      "parentCompanyName",
      "location",
      "address",
      "address2",
      "city",
      "province",
      "postalCode",
      "country",
      "lat",
      "lng",
      "contactName",
      "email",
      "phone",
      "roofLadderCode",
    ];
    for (const k of required) {
      expect(block, `missing required DTO field "${k}"`).toMatch(
        new RegExp(`\\b${k}\\s*:`),
      );
    }

    // No sensitive columns may appear as response keys.
    const forbidden = [
      "qboCustomerId",
      "qboParentCustomerId",
      "qboSyncToken",
      "qboLastSyncedAt",
      "selectedMonths",
      "nextDue",
      "inactive",
      "needsDetails",
      "billWithParent",
      "version",
      "userId",
      "parentCompanyId",
      "deletedAt",
      "createdAt",
      "updatedAt",
      "notes",
      "placeId",
    ];
    for (const k of forbidden) {
      // We only flag a sensitive key when it appears as a response-side
      // assignment (key:). Request-side reads (loc.notes) are fine.
      const re = new RegExp(`\\b${k}\\s*:\\s*(loc\\.|parent\\.|null)`);
      expect(
        block,
        `forbidden DTO field "${k}" present in /locations/:locationId response`,
      ).not.toMatch(re);
    }
  });

  it("equipment handler emits only the seven whitelisted keys", () => {
    const handler = techLocationsSrc.match(
      /router\.get\(\s*["']\/locations\/:locationId\/equipment["'][\s\S]*?\}\),\s*\);/,
    );
    expect(handler).toBeTruthy();
    const block = handler![0];
    const required = [
      "id",
      "type",
      "manufacturer",
      "model",
      "serialNumber",
      "installedAt",
      "notes",
    ];
    for (const k of required) {
      expect(block).toMatch(new RegExp(`\\b${k}\\s*:`));
    }
    // tagNumber, warrantyExpiry, nameplatePhotoId etc. must not leak.
    for (const k of ["tagNumber", "warrantyExpiry", "nameplatePhotoId", "isActive"]) {
      const re = new RegExp(`\\b${k}\\s*:\\s*r\\.`);
      expect(block).not.toMatch(re);
    }
  });

  it("jobs handler returns the six tech-safe job fields plus technicianName", () => {
    const handler = techLocationsSrc.match(
      /router\.get\(\s*["']\/locations\/:locationId\/jobs["'][\s\S]*?\}\),\s*\);/,
    );
    expect(handler).toBeTruthy();
    const block = handler![0];
    for (const k of [
      "jobNumber",
      "jobType",
      "status",
      "scheduledStart",
      "scheduledEnd",
      "summary",
      "technicianName",
      "hasMore",
    ]) {
      expect(block).toMatch(new RegExp(`\\b${k}\\b`));
    }
    // No invoice / financial leakage.
    for (const k of ["invoiceCount", "qboInvoiceId", "billingNotes", "holdReason"]) {
      const re = new RegExp(`\\b${k}\\s*:`);
      expect(block).not.toMatch(re);
    }
  });
});
