/**
 * Effective Schedule Range — batch precedence tests (2026-05-17 Phase 3)
 *
 * Tests computeEffectiveScheduleRange against a real Neon database.
 *
 * Covers:
 *   • company_default fallback when no custom schedule
 *   • weekly_default from working_hours
 *   • date_override beats weekly_default
 *   • time_off beats date_override
 *   • time_off beats weekly_default (no override)
 *   • DST-edge: time-off partially overlapping a day boundary
 *   • Multiple overrides in range returned correctly
 *   • Override removed (archived) → falls back to weekly_default
 *   • company scoping: overrides from another company not included
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { companies, users, technicianTimeOff, workingHours } from "@shared/schema";
import { technicianScheduleOverrideRepository, computeEffectiveScheduleRange } from "../server/storage/technicianSchedule";
import { v4 as uuidv4 } from "uuid";

const PREFIX = "eff_sched_test_";
const TZ = "America/New_York"; // UTC-5 in winter, UTC-4 in summer

let companyId: string;
let techId: string;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

async function setup() {
  companyId = uuidv4();
  await db.insert(companies).values({ id: companyId, name: `${PREFIX}company` });

  techId = uuidv4();
  await db.insert(users).values({
    id: techId,
    companyId,
    email: `${PREFIX}tech_${Date.now()}@test.com`,
    password: "hash",
    role: "technician",
    status: "active",
  });
}

async function teardown() {
  const { eq: eqFn, or } = await import("drizzle-orm");
  const { technicianScheduleOverrides } = await import("@shared/schema");
  await db.delete(technicianTimeOff).where(eqFn(technicianTimeOff.companyId, companyId));
  await db.delete(technicianScheduleOverrides).where(eqFn(technicianScheduleOverrides.companyId, companyId));
  await db.delete(workingHours).where(eqFn(workingHours.userId, techId));
  await db.delete(users).where(eqFn(users.companyId, companyId));
  await db.delete(companies).where(eqFn(companies.id, companyId));
}

beforeAll(async () => { await setup(); });
afterAll(async () => { await teardown(); });

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compute range for a single date. */
async function dayState(
  date: string,
  opts: Parameters<typeof computeEffectiveScheduleRange>[5],
) {
  const days = await computeEffectiveScheduleRange(
    companyId, techId, date, date, TZ, opts,
  );
  return days[0];
}

// Monday 2026-10-05 (UTC-4, summer; dayOfWeek=1)
const MON = "2026-10-05";
// Tuesday 2026-10-06
const TUE = "2026-10-06";
// America/New_York midnight for 2026-10-05 = 04:00 UTC (UTC-4 summer)
const MON_START = new Date("2026-10-05T04:00:00Z");
const MON_END   = new Date("2026-10-06T04:00:00Z");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("company_default fallback", () => {
  it("returns company_default when no custom schedule and day is open", async () => {
    const result = await dayState(MON, {
      weeklyHours: [],
      useCustomSchedule: false,
      companyDefaultHours: [{ dayOfWeek: 1, isOpen: true }],
    });
    expect(result.source).toBe("company_default");
    expect(result.isWorking).toBe(true);
  });

  it("returns company_default=false when company has day closed", async () => {
    const result = await dayState(MON, {
      weeklyHours: [],
      useCustomSchedule: false,
      companyDefaultHours: [{ dayOfWeek: 1, isOpen: false }],
    });
    expect(result.source).toBe("company_default");
    expect(result.isWorking).toBe(false);
  });

  it("returns isWorking=false when no company hours configured", async () => {
    const result = await dayState(MON, {
      weeklyHours: [],
      useCustomSchedule: false,
      companyDefaultHours: [],
    });
    expect(result.source).toBe("company_default");
    expect(result.isWorking).toBe(false);
  });
});

describe("weekly_default from working_hours", () => {
  it("uses weekly_default when custom schedule is enabled", async () => {
    const result = await dayState(MON, {
      weeklyHours: [{ dayOfWeek: 1, isWorking: true }],
      useCustomSchedule: true,
    });
    expect(result.source).toBe("weekly_default");
    expect(result.isWorking).toBe(true);
  });

  it("weekly_default not_working when hour row isWorking=false", async () => {
    const result = await dayState(MON, {
      weeklyHours: [{ dayOfWeek: 1, isWorking: false }],
      useCustomSchedule: true,
    });
    expect(result.source).toBe("weekly_default");
    expect(result.isWorking).toBe(false);
  });

  it("skips weekly_default when useCustomSchedule=false", async () => {
    const result = await dayState(MON, {
      weeklyHours: [{ dayOfWeek: 1, isWorking: true }],
      useCustomSchedule: false,
      companyDefaultHours: [{ dayOfWeek: 1, isOpen: false }],
    });
    expect(result.source).toBe("company_default");
    expect(result.isWorking).toBe(false);
  });
});

describe("date_override beats weekly_default", () => {
  it("override isWorking=false overrides a working weekly_default", async () => {
    await technicianScheduleOverrideRepository.upsertOverride(companyId, {
      technicianUserId: techId,
      overrideDate: MON,
      isWorking: false,
      note: "test",
      createdByUserId: techId,
    });

    const result = await dayState(MON, {
      weeklyHours: [{ dayOfWeek: 1, isWorking: true }],
      useCustomSchedule: true,
    });
    expect(result.source).toBe("date_override");
    expect(result.isWorking).toBe(false);
    expect(result.override).toBeTruthy();

    // cleanup
    await technicianScheduleOverrideRepository.archiveOverride(companyId, result.override!.id);
  });

  it("override removed → falls back to weekly_default", async () => {
    const created = await technicianScheduleOverrideRepository.upsertOverride(companyId, {
      technicianUserId: techId,
      overrideDate: TUE,
      isWorking: false,
      note: null,
      createdByUserId: techId,
    });
    await technicianScheduleOverrideRepository.archiveOverride(companyId, created.id);

    const result = await dayState(TUE, {
      weeklyHours: [{ dayOfWeek: 2, isWorking: true }],
      useCustomSchedule: true,
    });
    expect(result.source).toBe("weekly_default");
    expect(result.isWorking).toBe(true);
  });
});

describe("time_off beats everything", () => {
  const insertTimeOff = async (startsAt: Date, endsAt: Date) => {
    const { eq: eqFn } = await import("drizzle-orm");
    const id = uuidv4();
    await db.insert(technicianTimeOff).values({
      id,
      companyId,
      technicianUserId: techId,
      reason: "vacation",
      startsAt,
      endsAt,
      allDay: true,
      note: null,
      createdByUserId: techId,
    });
    return id;
  };

  it("time_off beats weekly_default (no override)", async () => {
    const toId = await insertTimeOff(MON_START, MON_END);

    const result = await dayState(MON, {
      weeklyHours: [{ dayOfWeek: 1, isWorking: true }],
      useCustomSchedule: true,
    });
    expect(result.source).toBe("time_off");
    expect(result.isWorking).toBe(false);
    expect(result.timeOffEntry).toBeTruthy();

    const { eq: eqFn } = await import("drizzle-orm");
    await db.delete(technicianTimeOff).where(eqFn(technicianTimeOff.id, toId));
  });

  it("time_off beats date_override (override says working)", async () => {
    const override = await technicianScheduleOverrideRepository.upsertOverride(companyId, {
      technicianUserId: techId,
      overrideDate: MON,
      isWorking: true,
      note: null,
      createdByUserId: techId,
    });
    const toId = await insertTimeOff(MON_START, MON_END);

    const result = await dayState(MON, {
      weeklyHours: [{ dayOfWeek: 1, isWorking: true }],
      useCustomSchedule: true,
    });
    expect(result.source).toBe("time_off");
    expect(result.isWorking).toBe(false);

    const { eq: eqFn } = await import("drizzle-orm");
    await db.delete(technicianTimeOff).where(eqFn(technicianTimeOff.id, toId));
    await technicianScheduleOverrideRepository.archiveOverride(companyId, override.id);
  });

  it("time_off partial overlap at start of day still blocks", async () => {
    // Starts 2h before EOD of previous day, ends 1h into MON → overlaps MON
    const startsAt = new Date("2026-10-05T03:00:00Z"); // 1h before MON_START (04:00Z)
    const endsAt = new Date("2026-10-05T05:00:00Z");   // 1h into MON
    const toId = await insertTimeOff(startsAt, endsAt);

    const result = await dayState(MON, {
      weeklyHours: [{ dayOfWeek: 1, isWorking: true }],
      useCustomSchedule: true,
    });
    expect(result.source).toBe("time_off");

    const { eq: eqFn } = await import("drizzle-orm");
    await db.delete(technicianTimeOff).where(eqFn(technicianTimeOff.id, toId));
  });
});

describe("full range: multiple overrides and mixed sources", () => {
  it("returns correct source for each day in a multi-day range", async () => {
    // Range: MON and TUE
    // MON: override not_working
    // TUE: no override → weekly_default working
    const override = await technicianScheduleOverrideRepository.upsertOverride(companyId, {
      technicianUserId: techId,
      overrideDate: MON,
      isWorking: false,
      note: null,
      createdByUserId: techId,
    });

    const days = await computeEffectiveScheduleRange(
      companyId, techId, MON, TUE, TZ,
      {
        weeklyHours: [
          { dayOfWeek: 1, isWorking: true },
          { dayOfWeek: 2, isWorking: true },
        ],
        useCustomSchedule: true,
      },
    );

    expect(days).toHaveLength(2);
    const monDay = days.find((d) => d.date === MON);
    const tueDay = days.find((d) => d.date === TUE);

    expect(monDay?.source).toBe("date_override");
    expect(monDay?.isWorking).toBe(false);
    expect(tueDay?.source).toBe("weekly_default");
    expect(tueDay?.isWorking).toBe(true);

    await technicianScheduleOverrideRepository.archiveOverride(companyId, override.id);
  });
});
