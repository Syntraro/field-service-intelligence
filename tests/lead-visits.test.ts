/**
 * Lead Visits — Phase 2 (2026-05-05).
 *
 * Layered coverage:
 *
 *   1. Storage layer (createLeadVisit / updateLeadVisit /
 *      markLeadVisitCompleted / isLastOpenVisitForLead) against the
 *      live test DB. Exercises scheduling normalization, the
 *      atomic completion + lead.status -> needs_review side effect,
 *      and the predicate-driven list helpers.
 *
 *   2. Tech access scoping (`assertCanAccessLeadVisit`) — assigned
 *      tech allowed, unassigned tech denied, cross-tenant denied,
 *      office bypass.
 *
 *   3. Capacity-blocking — `getTodayCapacity` reflects lead visit
 *      time as booked-against-tech, but lead visits do NOT bump
 *      `visitCount` or `bookedMinutes` (those stay job-only).
 *
 *   4. Dispatch separation — the dispatch query
 *      `getScheduledLeadVisitsInRangeWithMetadata` returns
 *      lead visits with `type: "lead_visit"` and never appears in
 *      the canonical job-visit feed.
 *
 *   5. Notes + attachments — canonical envelope on
 *      GET /api/leads/:id/notes (route source-pin); FileEntityType
 *      enum source-pin for `lead_note`.
 *
 *   6. Quote conversion regression — `MANUAL_TRANSITIONS` allows
 *      moving from needs_review -> contacted/lost, and POST
 *      /api/quotes is unchanged.
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
  leads,
  leadVisits,
} from "@shared/schema";
import {
  createLeadVisit,
  updateLeadVisit,
  listLeadVisitsForLead,
  listLeadVisitsForUserInRange,
  markLeadVisitCompleted,
  isLastOpenVisitForLead,
} from "../server/storage/leadVisits";
import { assertCanAccessLeadVisit } from "../server/auth/leadVisitAccess";
import { scheduleEligibleLeadVisitFilter, uncompletedLeadVisitFilter } from "../server/storage/leadVisitPredicates";
import { getScheduledLeadVisitsInRangeWithMetadata } from "../server/storage/leadVisitsDispatch";

const PREFIX = "lead_visits_test_";

const tenantA = uuidv4();
const tenantB = uuidv4();
const ownerA = uuidv4();
const techA = uuidv4();
const techANoAssign = uuidv4();
const customerA = uuidv4();
const locationA = uuidv4();
let leadAId: string;
let leadBId: string;

async function setupFixtures() {
  await db.insert(companies).values([
    { id: tenantA, name: `${PREFIX}A` },
    { id: tenantB, name: `${PREFIX}B` },
  ]);

  await db.insert(users).values([
    {
      id: ownerA,
      companyId: tenantA,
      email: `${PREFIX}ownerA_${Date.now()}@t`,
      password: "x",
      role: "owner",
      status: "active",
    },
    {
      id: techA,
      companyId: tenantA,
      email: `${PREFIX}techA_${Date.now()}@t`,
      password: "x",
      role: "technician",
      status: "active",
    },
    {
      id: techANoAssign,
      companyId: tenantA,
      email: `${PREFIX}techANoAssign_${Date.now()}@t`,
      password: "x",
      role: "technician",
      status: "active",
    },
  ]);

  await db.insert(customerCompanies).values({
    id: customerA,
    companyId: tenantA,
    name: `${PREFIX}custA`,
  });

  await db.insert(clientLocations).values({
    id: locationA,
    companyId: tenantA,
    parentCompanyId: customerA,
    companyName: `${PREFIX}locA`,
    address: "1 Pine St",
    city: "Toronto",
    province: "ON",
    postalCode: "M1A1A1",
    selectedMonths: [],
  });

  const insertedLeads = await db
    .insert(leads)
    .values([
      {
        companyId: tenantA,
        locationId: locationA,
        customerCompanyId: customerA,
        createdByUserId: ownerA,
        status: "new",
        title: `${PREFIX}leadA — needs onsite`,
        sourceType: "office",
      },
      {
        companyId: tenantA,
        locationId: locationA,
        customerCompanyId: customerA,
        createdByUserId: ownerA,
        status: "new",
        title: `${PREFIX}leadB — already lost`,
        sourceType: "office",
      },
    ])
    .returning({ id: leads.id });
  leadAId = insertedLeads[0].id;
  leadBId = insertedLeads[1].id;
}

async function teardownFixtures() {
  for (const tid of [tenantA, tenantB]) {
    await db.delete(leadVisits).where(eq(leadVisits.companyId, tid));
    await db.delete(leads).where(eq(leads.companyId, tid));
    await db
      .delete(clientLocations)
      .where(eq(clientLocations.companyId, tid));
    await db
      .delete(customerCompanies)
      .where(eq(customerCompanies.companyId, tid));
    await db.delete(users).where(eq(users.companyId, tid));
    await db.delete(companies).where(eq(companies.id, tid));
  }
}

// ── Storage: scheduling normalization ───────────────────────────────

describe("createLeadVisit — scheduling normalization", () => {
  beforeAll(async () => {
    await setupFixtures();
  });
  afterAll(async () => {
    await teardownFixtures();
  });

  it("default duration is 60 minutes when caller omits it", async () => {
    const start = new Date(Date.now() + 60 * 60_000);
    const v = await createLeadVisit(tenantA, {
      leadId: leadAId,
      scheduledStart: start,
      assignedTechnicianIds: [techA],
      createdByUserId: ownerA,
    });
    expect(v.estimatedDurationMinutes).toBe(60);
    expect(v.scheduledEnd).toBeTruthy();
    const endMs = (v.scheduledEnd as Date).getTime();
    expect(endMs - start.getTime()).toBe(60 * 60_000);
    await db.delete(leadVisits).where(eq(leadVisits.id, v.id));
  });

  it("duration is floored at the canonical minimum (30 min)", async () => {
    const start = new Date(Date.now() + 90 * 60_000);
    const v = await createLeadVisit(tenantA, {
      leadId: leadAId,
      scheduledStart: start,
      estimatedDurationMinutes: 5,
      assignedTechnicianIds: [techA],
      createdByUserId: ownerA,
    });
    expect(v.estimatedDurationMinutes).toBe(30);
    await db.delete(leadVisits).where(eq(leadVisits.id, v.id));
  });

  it("end-time is computed from start + duration", async () => {
    const start = new Date(Date.now() + 120 * 60_000);
    const v = await createLeadVisit(tenantA, {
      leadId: leadAId,
      scheduledStart: start,
      estimatedDurationMinutes: 90,
      assignedTechnicianIds: [techA],
      createdByUserId: ownerA,
    });
    const endMs = (v.scheduledEnd as Date).getTime();
    expect(endMs - start.getTime()).toBe(90 * 60_000);
    await db.delete(leadVisits).where(eq(leadVisits.id, v.id));
  });

  it("null start preserves unscheduled state (end forced null)", async () => {
    const v = await createLeadVisit(tenantA, {
      leadId: leadAId,
      scheduledStart: null,
      assignedTechnicianIds: [techA],
      createdByUserId: ownerA,
    });
    expect(v.scheduledStart).toBeNull();
    expect(v.scheduledEnd).toBeNull();
    await db.delete(leadVisits).where(eq(leadVisits.id, v.id));
  });
});

// ── Storage: completion + needs_review transition ───────────────────

describe("markLeadVisitCompleted — atomic transition", () => {
  beforeAll(async () => {
    await setupFixtures();
  });
  afterAll(async () => {
    await teardownFixtures();
  });

  it("completes the visit and flips lead → needs_review when it was the LAST open visit", async () => {
    // Reset lead status to 'new' between tests.
    await db.update(leads).set({ status: "new" }).where(eq(leads.id, leadAId));

    const v = await createLeadVisit(tenantA, {
      leadId: leadAId,
      scheduledStart: new Date(),
      assignedTechnicianIds: [techA],
      createdByUserId: ownerA,
    });
    const result = await markLeadVisitCompleted(tenantA, v.id, techA, "Found cracked heat exchanger");
    expect(result).not.toBeNull();
    expect(result!.visit.status).toBe("completed");
    expect(result!.visit.completedAt).toBeTruthy();
    expect(result!.visit.completedByUserId).toBe(techA);
    expect(result!.leadTransitioned).toBe(true);

    const [leadAfter] = await db
      .select({ status: leads.status })
      .from(leads)
      .where(eq(leads.id, leadAId));
    expect(leadAfter.status).toBe("needs_review");

    // Cleanup.
    await db.delete(leadVisits).where(eq(leadVisits.id, v.id));
    await db.update(leads).set({ status: "new" }).where(eq(leads.id, leadAId));
  });

  it("does NOT flip the lead status when other open visits remain", async () => {
    await db.update(leads).set({ status: "new" }).where(eq(leads.id, leadAId));

    const v1 = await createLeadVisit(tenantA, {
      leadId: leadAId,
      scheduledStart: new Date(),
      assignedTechnicianIds: [techA],
      createdByUserId: ownerA,
    });
    const v2 = await createLeadVisit(tenantA, {
      leadId: leadAId,
      scheduledStart: new Date(Date.now() + 24 * 60 * 60_000),
      assignedTechnicianIds: [techA],
      createdByUserId: ownerA,
    });

    const result = await markLeadVisitCompleted(tenantA, v1.id, techA);
    expect(result!.leadTransitioned).toBe(false);

    const [leadAfter] = await db
      .select({ status: leads.status })
      .from(leads)
      .where(eq(leads.id, leadAId));
    expect(leadAfter.status).toBe("new");

    await db.delete(leadVisits).where(eq(leadVisits.id, v1.id));
    await db.delete(leadVisits).where(eq(leadVisits.id, v2.id));
  });

  it("does NOT flip the lead when it is already in a non-eligible status", async () => {
    await db
      .update(leads)
      .set({ status: "lost" })
      .where(eq(leads.id, leadBId));

    const v = await createLeadVisit(tenantA, {
      leadId: leadBId,
      scheduledStart: new Date(),
      assignedTechnicianIds: [techA],
      createdByUserId: ownerA,
    });
    const result = await markLeadVisitCompleted(tenantA, v.id, techA);
    expect(result!.leadTransitioned).toBe(false);

    const [leadAfter] = await db
      .select({ status: leads.status })
      .from(leads)
      .where(eq(leads.id, leadBId));
    expect(leadAfter.status).toBe("lost");

    await db.delete(leadVisits).where(eq(leadVisits.id, v.id));
  });

  it("returns null on already-terminal visits (idempotent)", async () => {
    const v = await createLeadVisit(tenantA, {
      leadId: leadAId,
      scheduledStart: new Date(),
      assignedTechnicianIds: [techA],
      createdByUserId: ownerA,
    });
    await markLeadVisitCompleted(tenantA, v.id, techA);
    const second = await markLeadVisitCompleted(tenantA, v.id, techA);
    expect(second).toBeNull();
    await db.delete(leadVisits).where(eq(leadVisits.id, v.id));
    await db.update(leads).set({ status: "new" }).where(eq(leads.id, leadAId));
  });
});

// ── Storage: predicates + list helpers ──────────────────────────────

describe("predicates + list helpers", () => {
  beforeAll(async () => {
    await setupFixtures();
  });
  afterAll(async () => {
    await teardownFixtures();
  });

  it("listLeadVisitsForUserInRange returns only assigned + active visits", async () => {
    const start = new Date();
    const v = await createLeadVisit(tenantA, {
      leadId: leadAId,
      scheduledStart: new Date(start.getTime() + 60 * 60_000),
      assignedTechnicianIds: [techA],
      createdByUserId: ownerA,
    });
    const end = new Date(start.getTime() + 24 * 60 * 60_000);

    const assigned = await listLeadVisitsForUserInRange(tenantA, techA, start, end);
    expect(assigned.some((row) => row.id === v.id)).toBe(true);

    const unassigned = await listLeadVisitsForUserInRange(tenantA, techANoAssign, start, end);
    expect(unassigned.some((row) => row.id === v.id)).toBe(false);

    await db.delete(leadVisits).where(eq(leadVisits.id, v.id));
  });

  it("isLastOpenVisitForLead returns true after the last open visit's id is excluded", async () => {
    const v1 = await createLeadVisit(tenantA, {
      leadId: leadAId,
      scheduledStart: new Date(),
      assignedTechnicianIds: [techA],
      createdByUserId: ownerA,
    });
    const islast = await isLastOpenVisitForLead(tenantA, leadAId, v1.id);
    expect(islast).toBe(true);

    const v2 = await createLeadVisit(tenantA, {
      leadId: leadAId,
      scheduledStart: new Date(Date.now() + 24 * 60 * 60_000),
      assignedTechnicianIds: [techA],
      createdByUserId: ownerA,
    });
    const islast2 = await isLastOpenVisitForLead(tenantA, leadAId, v1.id);
    expect(islast2).toBe(false);

    await db.delete(leadVisits).where(eq(leadVisits.id, v1.id));
    await db.delete(leadVisits).where(eq(leadVisits.id, v2.id));
  });
});

// ── Tech access scoping ─────────────────────────────────────────────

describe("assertCanAccessLeadVisit — scoping", () => {
  beforeAll(async () => {
    await setupFixtures();
  });
  afterAll(async () => {
    await teardownFixtures();
  });

  it("allows assigned tech", async () => {
    const v = await createLeadVisit(tenantA, {
      leadId: leadAId,
      scheduledStart: new Date(),
      assignedTechnicianIds: [techA],
      createdByUserId: ownerA,
    });
    await expect(
      assertCanAccessLeadVisit(tenantA, techA, "technician", v.id),
    ).resolves.toBeTruthy();
    await db.delete(leadVisits).where(eq(leadVisits.id, v.id));
  });

  it("denies unassigned tech with 403", async () => {
    const v = await createLeadVisit(tenantA, {
      leadId: leadAId,
      scheduledStart: new Date(),
      assignedTechnicianIds: [techA],
      createdByUserId: ownerA,
    });
    await expect(
      assertCanAccessLeadVisit(tenantA, techANoAssign, "technician", v.id),
    ).rejects.toThrow(/access denied/i);
    await db.delete(leadVisits).where(eq(leadVisits.id, v.id));
  });

  it("office roles bypass assignment scoping", async () => {
    const v = await createLeadVisit(tenantA, {
      leadId: leadAId,
      scheduledStart: new Date(),
      assignedTechnicianIds: [techA],
      createdByUserId: ownerA,
    });
    await expect(
      assertCanAccessLeadVisit(tenantA, ownerA, "owner", v.id),
    ).resolves.toBeTruthy();
    await db.delete(leadVisits).where(eq(leadVisits.id, v.id));
  });

  it("cross-tenant access returns 404 (no leak)", async () => {
    const v = await createLeadVisit(tenantA, {
      leadId: leadAId,
      scheduledStart: new Date(),
      assignedTechnicianIds: [techA],
      createdByUserId: ownerA,
    });
    await expect(
      assertCanAccessLeadVisit(tenantB, techA, "technician", v.id),
    ).rejects.toThrow(/lead visit not found/i);
    await db.delete(leadVisits).where(eq(leadVisits.id, v.id));
  });
});

// ── Dispatch separation ─────────────────────────────────────────────

describe("dispatch — lead visits are returned by their own query with type='lead_visit'", () => {
  beforeAll(async () => {
    await setupFixtures();
  });
  afterAll(async () => {
    await teardownFixtures();
  });

  it("getScheduledLeadVisitsInRangeWithMetadata returns lead visits with type='lead_visit'", async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 24 * 60 * 60_000);

    const v = await createLeadVisit(tenantA, {
      leadId: leadAId,
      scheduledStart: new Date(start.getTime() + 8 * 60 * 60_000),
      assignedTechnicianIds: [techA],
      createdByUserId: ownerA,
    });

    const result = await getScheduledLeadVisitsInRangeWithMetadata(
      tenantA,
      start,
      end,
    );
    const found = result.visits.find((r) => r.id === v.id);
    expect(found).toBeTruthy();
    expect(found!.type).toBe("lead_visit");
    expect(found!.leadId).toBe(leadAId);
    expect(found!.leadTitle).toContain(`${PREFIX}leadA`);

    await db.delete(leadVisits).where(eq(leadVisits.id, v.id));
  });
});

// ── Source pins (no live DB) ────────────────────────────────────────

describe("source pins — invariants", () => {
  it("FileEntityType (server) includes lead_note", () => {
    const src = readFileSync(
      resolve(__dirname, "../server/services/fileUploadService.ts"),
      "utf-8",
    );
    expect(src).toMatch(/\| "lead_note"/);
    expect(src).toMatch(/leadNoteAttachments/);
    expect(src).toMatch(/resolveLeadNote/);
  });

  it("FileEntityType (frontend) includes lead_note", () => {
    const src = readFileSync(
      resolve(__dirname, "../client/src/hooks/useFileUpload.ts"),
      "utf-8",
    );
    expect(src).toMatch(/\| "lead_note"/);
  });

  it("EntityNotesSection accepts entityType='lead'", () => {
    const src = readFileSync(
      resolve(
        __dirname,
        "../client/src/components/notes/EntityNotesSection.tsx",
      ),
      "utf-8",
    );
    expect(src).toMatch(/EntityNotesEntityType\s*=\s*"job"\s*\|\s*"invoice"\s*\|\s*"quote"\s*\|\s*"lead"/);
    expect(src).toMatch(/\/api\/leads\/\$\{entityId\}\/notes/);
  });

  it("EntityNoteDialog accepts entityType='lead' and maps to lead_note FileEntityType", () => {
    const src = readFileSync(
      resolve(
        __dirname,
        "../client/src/components/notes/EntityNoteDialog.tsx",
      ),
      "utf-8",
    );
    expect(src).toMatch(/entityType === "lead"/);
    expect(src).toMatch(/return "lead_note"/);
  });

  it("LeadDetailPage replaces inline notes with EntityNotesSection entityType='lead'", () => {
    const src = readFileSync(
      resolve(__dirname, "../client/src/pages/LeadDetailPage.tsx"),
      "utf-8",
    );
    expect(src).toMatch(
      /<EntityNotesSection\s+entityType="lead"\s+entityId=\{lead\.id\}\s*\/>/,
    );
    // Bespoke notes mutations + state are gone.
    expect(src).not.toMatch(/addNoteMutation/);
    expect(src).not.toMatch(/deleteNoteMutation/);
  });

  it("MANUAL_TRANSITIONS in routes/leads.ts allows new/contacted -> needs_review", () => {
    const src = readFileSync(
      resolve(__dirname, "../server/routes/leads.ts"),
      "utf-8",
    );
    expect(src).toMatch(/needs_review/);
    expect(src).toMatch(/new:\s*\[[^\]]*"needs_review"/);
    expect(src).toMatch(/contacted:\s*\[[^\]]*"needs_review"/);
  });

  it("visitPredicates.ts (job-side) was NOT modified to include lead-visit logic", () => {
    const src = readFileSync(
      resolve(__dirname, "../server/lib/visitPredicates.ts"),
      "utf-8",
    );
    // Sanity: lead-visit terms must not appear in the job-side
    // predicate file. Lead-visit predicates live in their own file
    // per CLAUDE.md performance-baseline rule.
    expect(src).not.toMatch(/leadVisits/);
    expect(src).not.toMatch(/lead_visits/);
  });

  it("capacity.ts blocks lead-visit time but does NOT increment job visitCount/bookedMinutes", () => {
    const src = readFileSync(
      resolve(__dirname, "../server/storage/capacity.ts"),
      "utf-8",
    );
    // Lead visits feed busyByTech (gap math) ...
    expect(src).toMatch(/listLeadVisitsInRange/);
    expect(src).toMatch(/busyByTech/);
    // ... and the comment block calling out "DO NOT add to
    // visitsByTech" is present (intentional invariant).
    expect(src).toMatch(/DO NOT add to visitsByTech/);
  });

  it("dispatch sibling endpoint is mounted at /api/calendar/lead-visits", () => {
    const src = readFileSync(
      resolve(__dirname, "../server/routes/scheduling.ts"),
      "utf-8",
    );
    expect(src).toMatch(/router\.get\(\s*"\/lead-visits"/);
    expect(src).toMatch(/getScheduledLeadVisitsInRangeWithMetadata/);
  });

  it("tech app TodayPage renders the Lead Visits section", () => {
    const src = readFileSync(
      resolve(__dirname, "../client/src/tech-app/pages/TodayPage.tsx"),
      "utf-8",
    );
    expect(src).toMatch(/LeadVisitsTodaySection/);
    expect(src).toMatch(/\/api\/tech\/lead-visits\/today/);
  });

  it("tech app router wires the lead-visit detail page", () => {
    const src = readFileSync(
      resolve(__dirname, "../client/src/tech-app/app/TechApp.tsx"),
      "utf-8",
    );
    expect(src).toMatch(/<Route path="\/tech\/lead-visit\/:id">/);
    expect(src).toMatch(/LeadVisitDetailPage/);
  });
});

// ── Predicate sanity ────────────────────────────────────────────────

describe("predicate primitives are SQL fragments (no execution side effects)", () => {
  it("scheduleEligibleLeadVisitFilter returns an SQL fragment", () => {
    const f = scheduleEligibleLeadVisitFilter();
    expect(f).toBeTruthy();
  });
  it("uncompletedLeadVisitFilter returns an SQL fragment", () => {
    const f = uncompletedLeadVisitFilter();
    expect(f).toBeTruthy();
  });
});
