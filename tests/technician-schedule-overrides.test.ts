/**
 * Technician Schedule Overrides — storage + precedence tests (2026-05-17)
 *
 * Covers:
 *   • override creation (upsertOverride insert path)
 *   • override update/upsert (upsertOverride update path — same date)
 *   • override soft-delete (archiveOverride)
 *   • uniqueness: upsert never creates duplicate active rows
 *   • company scoping: findById returns null for cross-tenant ids
 *   • listOverridesForRange: date range filtering
 *   • computeEffectiveDayState precedence:
 *       - time-off beats date_override
 *       - date_override beats weekly_default
 *       - weekly_default falls through to company_default
 *   • date handling: DATE strings survive round-trip unchanged
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { companies, users, technicianTimeOff, workingHours } from "@shared/schema";
import { technicianScheduleOverrideRepository, computeEffectiveDayState } from "../server/storage/technicianSchedule";
import { v4 as uuidv4 } from "uuid";

const PREFIX = "sched_override_test_";
let companyId: string;
let otherCompanyId: string;
let techId: string;
let otherTechId: string;

// ──────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────

async function setup() {
  companyId = uuidv4();
  otherCompanyId = uuidv4();
  await db.insert(companies).values([
    { id: companyId, name: `${PREFIX}company` },
    { id: otherCompanyId, name: `${PREFIX}other_company` },
  ]);

  techId = uuidv4();
  otherTechId = uuidv4();
  await db.insert(users).values([
    {
      id: techId,
      companyId,
      email: `${PREFIX}tech_${Date.now()}@test.com`,
      password: "hash",
      role: "technician",
      status: "active",
    },
    {
      id: otherTechId,
      companyId: otherCompanyId,
      email: `${PREFIX}other_${Date.now()}@test.com`,
      password: "hash",
      role: "technician",
      status: "active",
    },
  ]);
}

async function teardown() {
  await db.delete(technicianTimeOff).where(
    (await import("drizzle-orm")).eq(technicianTimeOff.companyId, companyId),
  );
  // Cascade handles overrides via FK; explicit cleanup for robustness.
  const { eq: eqFn } = await import("drizzle-orm");
  const { technicianScheduleOverrides } = await import("@shared/schema");
  await db.delete(technicianScheduleOverrides).where(eqFn(technicianScheduleOverrides.companyId, companyId));
  await db.delete(technicianScheduleOverrides).where(eqFn(technicianScheduleOverrides.companyId, otherCompanyId));
  await db.delete(workingHours).where(eqFn(workingHours.userId, techId));
  await db.delete(users).where(eqFn(users.companyId, companyId));
  await db.delete(users).where(eqFn(users.companyId, otherCompanyId));
  await db.delete(companies).where(eqFn(companies.id, companyId));
  await db.delete(companies).where(eqFn(companies.id, otherCompanyId));
}

beforeAll(async () => { await setup(); });
afterAll(async () => { await teardown(); });

// ──────────────────────────────────────────────────────────────────────────
// CRUD
// ──────────────────────────────────────────────────────────────────────────

describe("upsertOverride — insert path", () => {
  it("creates a new override row", async () => {
    const override = await technicianScheduleOverrideRepository.upsertOverride(companyId, {
      technicianUserId: techId,
      overrideDate: "2026-06-10",
      isWorking: false,
      note: "Team offsite",
      createdByUserId: techId,
    });
    expect(override.id).toBeTruthy();
    expect(override.overrideDate).toBe("2026-06-10");
    expect(override.isWorking).toBe(false);
    expect(override.note).toBe("Team offsite");
    expect(override.archivedAt).toBeNull();
  });

  it("preserves the override_date string exactly (YYYY-MM-DD round-trip)", async () => {
    const date = "2026-07-04";
    const row = await technicianScheduleOverrideRepository.upsertOverride(companyId, {
      technicianUserId: techId,
      overrideDate: date,
      isWorking: true,
      note: null,
      createdByUserId: techId,
    });
    expect(row.overrideDate).toBe(date);
  });
});

describe("upsertOverride — update path (same date)", () => {
  const TARGET_DATE = "2026-06-15";

  it("updates isWorking and note when called twice on same date", async () => {
    await technicianScheduleOverrideRepository.upsertOverride(companyId, {
      technicianUserId: techId,
      overrideDate: TARGET_DATE,
      isWorking: false,
      note: "First call",
      createdByUserId: techId,
    });
    const updated = await technicianScheduleOverrideRepository.upsertOverride(companyId, {
      technicianUserId: techId,
      overrideDate: TARGET_DATE,
      isWorking: true,
      note: "Second call",
      createdByUserId: techId,
    });
    expect(updated.isWorking).toBe(true);
    expect(updated.note).toBe("Second call");
  });

  it("does not create duplicate active rows for the same date", async () => {
    const rows = await technicianScheduleOverrideRepository.listOverridesForRange(
      companyId, techId, TARGET_DATE, TARGET_DATE,
    );
    expect(rows).toHaveLength(1);
  });
});

describe("archiveOverride (soft-delete)", () => {
  it("sets archived_at and removes row from active queries", async () => {
    const created = await technicianScheduleOverrideRepository.upsertOverride(companyId, {
      technicianUserId: techId,
      overrideDate: "2026-06-20",
      isWorking: false,
      note: null,
      createdByUserId: techId,
    });
    const archived = await technicianScheduleOverrideRepository.archiveOverride(companyId, created.id);
    expect(archived).toBe(true);

    // Must no longer appear in active queries
    const found = await technicianScheduleOverrideRepository.findOverrideForDate(
      companyId, techId, "2026-06-20",
    );
    expect(found).toBeNull();
  });

  it("returns false when id not found or already archived", async () => {
    const result = await technicianScheduleOverrideRepository.archiveOverride(
      companyId, uuidv4(),
    );
    expect(result).toBe(false);
  });

  it("allows a new upsert on same date after archiving", async () => {
    const date = "2026-06-21";
    const first = await technicianScheduleOverrideRepository.upsertOverride(companyId, {
      technicianUserId: techId,
      overrideDate: date,
      isWorking: false,
      note: null,
      createdByUserId: techId,
    });
    await technicianScheduleOverrideRepository.archiveOverride(companyId, first.id);

    const second = await technicianScheduleOverrideRepository.upsertOverride(companyId, {
      technicianUserId: techId,
      overrideDate: date,
      isWorking: true,
      note: "Re-added",
      createdByUserId: techId,
    });
    expect(second.id).not.toBe(first.id); // new row, not update of archived
    expect(second.isWorking).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// listOverridesForRange
// ──────────────────────────────────────────────────────────────────────────

describe("listOverridesForRange", () => {
  const RANGE_START = "2026-08-01";
  const RANGE_END   = "2026-08-07";

  beforeAll(async () => {
    await Promise.all([
      technicianScheduleOverrideRepository.upsertOverride(companyId, {
        technicianUserId: techId, overrideDate: "2026-08-03", isWorking: false, note: null, createdByUserId: techId,
      }),
      technicianScheduleOverrideRepository.upsertOverride(companyId, {
        technicianUserId: techId, overrideDate: "2026-08-05", isWorking: true, note: null, createdByUserId: techId,
      }),
      // Outside range — must not appear
      technicianScheduleOverrideRepository.upsertOverride(companyId, {
        technicianUserId: techId, overrideDate: "2026-08-10", isWorking: false, note: null, createdByUserId: techId,
      }),
    ]);
  });

  it("returns only overrides within [start, end] inclusive", async () => {
    const rows = await technicianScheduleOverrideRepository.listOverridesForRange(
      companyId, techId, RANGE_START, RANGE_END,
    );
    const dates = rows.map((r) => r.overrideDate);
    expect(dates).toContain("2026-08-03");
    expect(dates).toContain("2026-08-05");
    expect(dates).not.toContain("2026-08-10");
  });

  it("returns rows sorted by override_date ascending", async () => {
    const rows = await technicianScheduleOverrideRepository.listOverridesForRange(
      companyId, techId, RANGE_START, RANGE_END,
    );
    const dates = rows.map((r) => r.overrideDate);
    expect(dates).toEqual([...dates].sort());
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Company scoping
// ──────────────────────────────────────────────────────────────────────────

describe("company scoping", () => {
  it("findById returns null for a cross-tenant id", async () => {
    const row = await technicianScheduleOverrideRepository.upsertOverride(companyId, {
      technicianUserId: techId, overrideDate: "2026-09-01", isWorking: false, note: null, createdByUserId: techId,
    });
    // Ask with the wrong company — must not find it
    const cross = await technicianScheduleOverrideRepository.findById(otherCompanyId, row.id);
    expect(cross).toBeNull();
  });

  it("listOverridesForRange does not leak data across companies", async () => {
    // Insert an override for the OTHER company's tech on the same date
    await technicianScheduleOverrideRepository.upsertOverride(otherCompanyId, {
      technicianUserId: otherTechId, overrideDate: "2026-09-02", isWorking: false, note: null, createdByUserId: otherTechId,
    });
    const rows = await technicianScheduleOverrideRepository.listOverridesForRange(
      companyId, techId, "2026-09-01", "2026-09-05",
    );
    const ids = rows.map((r) => r.technicianUserId);
    expect(ids).not.toContain(otherTechId);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// computeEffectiveDayState — precedence
// ──────────────────────────────────────────────────────────────────────────

describe("computeEffectiveDayState precedence", () => {
  // Test date: 2026-10-05 (Monday, dayOfWeek=1)
  const TEST_DATE = "2026-10-05";
  const DAY_START = new Date("2026-10-05T04:00:00Z"); // e.g. midnight ET
  const DAY_END   = new Date("2026-10-06T04:00:00Z");

  const mondayHours = [{ dayOfWeek: 1, isWorking: true }];
  const mondayOff   = [{ dayOfWeek: 1, isWorking: false }];

  it("company_default: no override, no custom hours → uses company default", async () => {
    const result = await computeEffectiveDayState(
      companyId, techId, TEST_DATE, DAY_START, DAY_END,
      {
        weeklyHours: [],
        useCustomSchedule: false,
        companyDefaultHours: [{ dayOfWeek: 1, isOpen: true }],
      },
    );
    expect(result.source).toBe("company_default");
    expect(result.isWorking).toBe(true);
  });

  it("weekly_default: custom schedule set, no override", async () => {
    const result = await computeEffectiveDayState(
      companyId, techId, TEST_DATE, DAY_START, DAY_END,
      { weeklyHours: mondayHours, useCustomSchedule: true },
    );
    expect(result.source).toBe("weekly_default");
    expect(result.isWorking).toBe(true);
  });

  it("date_override beats weekly_default", async () => {
    await technicianScheduleOverrideRepository.upsertOverride(companyId, {
      technicianUserId: techId, overrideDate: TEST_DATE, isWorking: false, note: null, createdByUserId: techId,
    });
    const result = await computeEffectiveDayState(
      companyId, techId, TEST_DATE, DAY_START, DAY_END,
      { weeklyHours: mondayHours, useCustomSchedule: true },
    );
    expect(result.source).toBe("date_override");
    expect(result.isWorking).toBe(false);
    expect(result.override).toBeTruthy();
    // cleanup
    await technicianScheduleOverrideRepository.archiveOverride(companyId, result.override!.id);
  });

  it("time_off beats date_override", async () => {
    // Set date override as "working"
    await technicianScheduleOverrideRepository.upsertOverride(companyId, {
      technicianUserId: techId, overrideDate: TEST_DATE, isWorking: true, note: null, createdByUserId: techId,
    });
    // Also insert time off covering this day
    const { eq: eqFn } = await import("drizzle-orm");
    await db.insert(technicianTimeOff).values({
      id: uuidv4(),
      companyId,
      technicianUserId: techId,
      reason: "vacation",
      startsAt: DAY_START,
      endsAt: DAY_END,
      allDay: true,
      note: null,
      createdByUserId: techId,
    });

    const result = await computeEffectiveDayState(
      companyId, techId, TEST_DATE, DAY_START, DAY_END,
      { weeklyHours: mondayHours, useCustomSchedule: true },
    );
    expect(result.source).toBe("time_off");
    expect(result.isWorking).toBe(false);
    expect(result.timeOffEntry).toBeTruthy();

    // cleanup
    await db.delete(technicianTimeOff).where(
      eqFn(technicianTimeOff.technicianUserId, techId),
    );
    const override = await technicianScheduleOverrideRepository.findOverrideForDate(companyId, techId, TEST_DATE);
    if (override) await technicianScheduleOverrideRepository.archiveOverride(companyId, override.id);
  });

  it("time_off beats weekly_default (no override)", async () => {
    const { eq: eqFn } = await import("drizzle-orm");
    await db.insert(technicianTimeOff).values({
      id: uuidv4(),
      companyId,
      technicianUserId: techId,
      reason: "sick",
      startsAt: DAY_START,
      endsAt: DAY_END,
      allDay: true,
      note: null,
      createdByUserId: techId,
    });

    const result = await computeEffectiveDayState(
      companyId, techId, TEST_DATE, DAY_START, DAY_END,
      { weeklyHours: mondayHours, useCustomSchedule: true },
    );
    expect(result.source).toBe("time_off");
    expect(result.isWorking).toBe(false);

    await db.delete(technicianTimeOff).where(eqFn(technicianTimeOff.technicianUserId, techId));
  });
});
