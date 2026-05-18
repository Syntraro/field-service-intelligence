/**
 * Shift Management Route Integration Tests — Phase 1 (2026-05-18).
 *
 * Tests template and shift CRUD, exceptions, and availability endpoints
 * against a real database. Follows the calendar-drag-drop.test.ts fixture
 * pattern: create company + users, run operations, clean up.
 *
 * NOTE: Feature gate (technician_shift_management) must be enabled for the
 * test company. Tests that verify the gate-closed behavior mock the
 * entitlement check instead of requiring catalog setup.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import {
  companies,
  users,
  technicianShiftTemplates,
  technicianShifts,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { technicianShiftTemplatesRepository } from "../server/storage/technicianShiftTemplates";
import { technicianShiftsRepository } from "../server/storage/technicianShifts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PREFIX = "shift_mgmt_test_";
let companyId: string;
let techId: string;
let adminId: string;

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
    firstName: "Test",
    lastName: "Tech",
  });

  adminId = uuidv4();
  await db.insert(users).values({
    id: adminId,
    companyId,
    email: `${PREFIX}admin_${Date.now()}@test.com`,
    password: "hash",
    role: "admin",
    firstName: "Test",
    lastName: "Admin",
  });
}

async function teardown() {
  // Exceptions are removed automatically via ON DELETE CASCADE from the base shift.
  // Delete shifts + templates before users: created_by_user_id FKs on both
  // tables have no CASCADE, so the user row must outlive the shift rows.
  await db.delete(technicianShifts).where(eq(technicianShifts.companyId, companyId));
  await db.delete(technicianShiftTemplates).where(eq(technicianShiftTemplates.companyId, companyId));
  await db.delete(users).where(eq(users.companyId, companyId));
  await db.delete(companies).where(eq(companies.id, companyId));
}

beforeAll(setup);
afterAll(teardown);

// ── Template CRUD ─────────────────────────────────────────────────────────────

describe("technicianShiftTemplatesRepository", () => {
  let templateId: string;

  it("creates a template", async () => {
    const tpl = await technicianShiftTemplatesRepository.create(
      companyId,
      {
        name: "Standard Day Shift",
        shiftType: "normal",
        timeOfDayStart: "08:00",
        timeOfDayEnd: "16:00",
        recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      },
      adminId,
    );
    expect(tpl.id).toBeTruthy();
    expect(tpl.name).toBe("Standard Day Shift");
    expect(tpl.shiftType).toBe("normal");
    templateId = tpl.id;
  });

  it("lists templates for company", async () => {
    const templates = await technicianShiftTemplatesRepository.list(companyId);
    expect(templates.some((t) => t.id === templateId)).toBe(true);
  });

  it("finds template by id", async () => {
    const found = await technicianShiftTemplatesRepository.findById(companyId, templateId);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Standard Day Shift");
  });

  it("returns null for cross-tenant findById", async () => {
    const other = await technicianShiftTemplatesRepository.findById("wrong-company", templateId);
    expect(other).toBeNull();
  });

  it("updates a template", async () => {
    const updated = await technicianShiftTemplatesRepository.update(
      companyId,
      templateId,
      { name: "Updated Shift" },
    );
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Updated Shift");
  });

  it("hard-deletes a template (row is gone)", async () => {
    const ok = await technicianShiftTemplatesRepository.hardDelete(companyId, templateId);
    expect(ok).toBe(true);
    // Row must be truly gone — not just hidden.
    const afterDelete = await technicianShiftTemplatesRepository.findById(companyId, templateId);
    expect(afterDelete).toBeNull();
    // Second delete returns false (row no longer exists).
    const second = await technicianShiftTemplatesRepository.hardDelete(companyId, templateId);
    expect(second).toBe(false);
  });

  it("hard-delete nullifies template_id on existing shifts", async () => {
    // Create a fresh template and a shift that references it.
    const tpl2 = await technicianShiftTemplatesRepository.create(
      companyId,
      { name: "Linked Template", shiftType: "normal" },
      adminId,
    );
    const shift = await technicianShiftsRepository.create(
      companyId,
      {
        technicianUserId: techId,
        shiftType: "normal",
        templateId: tpl2.id,
        startsAt: new Date("2026-07-01T13:00:00Z"),
        endsAt: new Date("2026-07-01T21:00:00Z"),
        timeOfDayStart: "09:00",
        timeOfDayEnd: "17:00",
      },
      adminId,
    );
    expect(shift.templateId).toBe(tpl2.id);

    // Deleting the template should nullify the FK on the shift row.
    const ok = await technicianShiftTemplatesRepository.hardDelete(companyId, tpl2.id);
    expect(ok).toBe(true);

    const reloaded = await technicianShiftsRepository.findById(companyId, shift.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.templateId).toBeNull();

    // Clean up the shift.
    await technicianShiftsRepository.hardDelete(companyId, shift.id);
  });
});

// ── Template subtype invariant ────────────────────────────────────────────────

describe("template subtype invariant", () => {
  it("rejects unavailable without subtype via DB constraint", async () => {
    // The DB CHECK constraint will fire.
    await expect(
      db.insert(technicianShiftTemplates).values({
        id: uuidv4(),
        companyId,
        name: "Bad template",
        shiftType: "unavailable",
        // shiftSubtype intentionally omitted
        createdByUserId: adminId,
      }),
    ).rejects.toThrow();
  });

  it("rejects normal with subtype via DB constraint", async () => {
    await expect(
      db.insert(technicianShiftTemplates).values({
        id: uuidv4(),
        companyId,
        name: "Bad template 2",
        shiftType: "normal",
        shiftSubtype: "vacation",
        createdByUserId: adminId,
      }),
    ).rejects.toThrow();
  });
});

// ── Shift CRUD ────────────────────────────────────────────────────────────────

describe("technicianShiftsRepository", () => {
  let oneOffId: string;
  let recurringId: string;
  let exceptionId: string;

  it("creates a one-off shift", async () => {
    const shift = await technicianShiftsRepository.create(
      companyId,
      {
        technicianUserId: techId,
        shiftType: "normal",
        startsAt: new Date("2026-06-01T13:00:00Z"),
        endsAt: new Date("2026-06-01T21:00:00Z"),
        timeOfDayStart: "09:00",
        timeOfDayEnd: "17:00",
      },
      adminId,
    );
    expect(shift.id).toBeTruthy();
    expect(shift.shiftType).toBe("normal");
    expect(shift.recurrenceRule).toBeNull();
    oneOffId = shift.id;
  });

  it("creates a recurring shift", async () => {
    const shift = await technicianShiftsRepository.create(
      companyId,
      {
        technicianUserId: techId,
        shiftType: "normal",
        startsAt: new Date("2026-06-02T13:00:00Z"),
        endsAt: new Date("2026-06-02T21:00:00Z"),
        timeOfDayStart: "09:00",
        timeOfDayEnd: "17:00",
        recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
      },
      adminId,
    );
    expect(shift.recurrenceRule).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");
    recurringId = shift.id;
  });

  it("rejects shift with unavailable but no subtype via DB constraint", async () => {
    await expect(
      db.insert(technicianShifts).values({
        id: uuidv4(),
        companyId,
        technicianUserId: techId,
        shiftType: "unavailable",
        // shiftSubtype omitted
        startsAt: new Date("2026-06-03T13:00:00Z"),
        endsAt: new Date("2026-06-03T21:00:00Z"),
      }),
    ).rejects.toThrow();
  });

  it("lists base shifts in window", async () => {
    const rows = await technicianShiftsRepository.listBaseShiftsInWindow(
      companyId,
      [techId],
      new Date("2026-06-01T00:00:00Z"),
      new Date("2026-06-05T00:00:00Z"),
    );
    expect(rows.some((r) => r.id === oneOffId)).toBe(true);
    expect(rows.some((r) => r.id === recurringId)).toBe(true);
  });

  it("creates a cancel exception for a recurring occurrence", async () => {
    const exc = await technicianShiftsRepository.createException(
      companyId,
      {
        recurrenceParentId: recurringId,
        technicianUserId: techId,
        occurrenceDate: "2026-06-08", // A Monday
        isCancelled: true,
        shiftType: "normal",
        startsAt: new Date("2026-06-08T13:00:00Z"),
        endsAt: new Date("2026-06-08T21:00:00Z"),
      },
      adminId,
    );
    expect(exc.isCancelled).toBe(true);
    expect(exc.recurrenceParentId).toBe(recurringId);
    exceptionId = exc.id;
  });

  it("lists exceptions for base shifts", async () => {
    const exceptions = await technicianShiftsRepository.listExceptionsForBases(
      companyId,
      [recurringId],
      "2026-06-01",
      "2026-06-30",
    );
    expect(exceptions.some((e) => e.id === exceptionId)).toBe(true);
  });

  it("updates an exception", async () => {
    const updated = await technicianShiftsRepository.updateException(
      companyId,
      exceptionId,
      { isCancelled: false, note: "Rescheduled" },
    );
    expect(updated).not.toBeNull();
    expect(updated!.isCancelled).toBe(false);
  });

  it("deletes an exception (hard delete)", async () => {
    const ok = await technicianShiftsRepository.deleteException(companyId, exceptionId);
    expect(ok).toBe(true);
    // Verify it's gone
    const rows = await technicianShiftsRepository.listExceptionsForBases(
      companyId,
      [recurringId],
      "2026-06-01",
      "2026-06-30",
    );
    expect(rows.some((e) => e.id === exceptionId)).toBe(false);
  });

  it("hard-deletes a base shift (row is truly gone)", async () => {
    const ok = await technicianShiftsRepository.hardDelete(companyId, oneOffId);
    expect(ok).toBe(true);
    const found = await technicianShiftsRepository.findById(companyId, oneOffId);
    expect(found).toBeNull();
    // Second delete returns false.
    const second = await technicianShiftsRepository.hardDelete(companyId, oneOffId);
    expect(second).toBe(false);
  });

  it("truncates series by updating recurrenceEndDate", async () => {
    // Create a fresh recurring shift to truncate.
    const baseShift = await technicianShiftsRepository.create(
      companyId,
      {
        technicianUserId: techId,
        shiftType: "normal",
        startsAt: new Date("2026-08-01T13:00:00Z"),
        endsAt: new Date("2026-08-01T21:00:00Z"),
        timeOfDayStart: "09:00",
        timeOfDayEnd: "17:00",
        recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
      },
      adminId,
    );
    expect(baseShift.recurrenceEndDate).toBeNull();

    // Truncate: set recurrenceEndDate to day before an occurrence.
    const updated = await technicianShiftsRepository.update(companyId, baseShift.id, {
      recurrenceEndDate: "2026-08-14",
    });
    expect(updated).not.toBeNull();
    expect(updated!.recurrenceEndDate).toBe("2026-08-14");

    await technicianShiftsRepository.hardDelete(companyId, baseShift.id);
  });

  it("creates a split: truncates base and creates new base from occurrence date", async () => {
    // Simulates split-at logic: one base becomes two.
    const originalBase = await technicianShiftsRepository.create(
      companyId,
      {
        technicianUserId: techId,
        shiftType: "normal",
        startsAt: new Date("2026-09-01T13:00:00Z"),
        endsAt: new Date("2026-09-01T21:00:00Z"),
        timeOfDayStart: "09:00",
        timeOfDayEnd: "17:00",
        recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
      },
      adminId,
    );

    // Step 1: Truncate original series.
    const truncated = await technicianShiftsRepository.update(companyId, originalBase.id, {
      recurrenceEndDate: "2026-09-11", // day before 2026-09-12
    });
    expect(truncated!.recurrenceEndDate).toBe("2026-09-11");

    // Step 2: Create new base starting at split point.
    const newBase = await technicianShiftsRepository.create(
      companyId,
      {
        technicianUserId: techId,
        shiftType: "on_call", // changed type for the new series
        startsAt: new Date("2026-09-12T14:00:00Z"),
        endsAt: new Date("2026-09-12T22:00:00Z"),
        timeOfDayStart: "10:00",
        timeOfDayEnd: "18:00",
        recurrenceRule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
      },
      adminId,
    );
    expect(newBase.shiftType).toBe("on_call");
    expect(newBase.recurrenceRule).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");

    // Original base ends before the split; new base starts at split.
    const reloadedOriginal = await technicianShiftsRepository.findById(companyId, originalBase.id);
    expect(reloadedOriginal!.recurrenceEndDate).toBe("2026-09-11");

    await technicianShiftsRepository.hardDelete(companyId, originalBase.id);
    await technicianShiftsRepository.hardDelete(companyId, newBase.id);
  });

  it("hard-deleting a recurring base removes its exceptions via CASCADE", async () => {
    // Add a fresh exception to recurringId so there is something to cascade.
    const exc2 = await technicianShiftsRepository.createException(
      companyId,
      {
        recurrenceParentId: recurringId,
        technicianUserId: techId,
        occurrenceDate: "2026-06-15",
        isCancelled: true,
        shiftType: "normal",
        startsAt: new Date("2026-06-15T13:00:00Z"),
        endsAt: new Date("2026-06-15T21:00:00Z"),
      },
      adminId,
    );

    const ok = await technicianShiftsRepository.hardDelete(companyId, recurringId);
    expect(ok).toBe(true);

    // Base is gone.
    expect(await technicianShiftsRepository.findById(companyId, recurringId)).toBeNull();
    // Exception was removed by CASCADE.
    expect(await technicianShiftsRepository.findById(companyId, exc2.id)).toBeNull();
  });
});
