/**
 * Technician Time Off — schema, route, capacity, modal, dashboard
 * source-pin tests (2026-05-07 RALPH).
 *
 * The feature spans many files:
 *   • migration + Drizzle table + zod schemas     (schema layer)
 *   • repository + REST routes + permission gate  (server)
 *   • capacity integration                        (server)
 *   • modal + entry point                         (client)
 *   • Today's Schedule rendering                  (client)
 *
 * These are source-pin tests — the contract is read off the source,
 * not exercised at runtime. A future visual / integration pass can
 * add JSDOM render tests on top; for this pass we lock the
 * structural shape so refactors can't silently break the feature.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import {
  TECHNICIAN_TIME_OFF_REASONS,
  insertTechnicianTimeOffSchema,
  updateTechnicianTimeOffSchema,
} from "@shared/schema";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const MIGRATION_PATH = path("migrations/2026_05_07_technician_time_off.sql");
const SCHEMA_PATH = path("shared/schema.ts");
const STORAGE_PATH = path("server/storage/technicianTimeOff.ts");
const ROUTE_PATH = path("server/routes/technicianTimeOff.ts");
const ROUTES_INDEX_PATH = path("server/routes/index.ts");
const CAPACITY_PATH = path("server/storage/capacity.ts");
const MODAL_PATH = path("client/src/components/team/TechnicianTimeOffModal.tsx");
const PAGE_PATH = path("client/src/pages/FinancialDashboard.tsx");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

// ─── 1. Migration + canonical reason union ─────────────────────────

describe("Migration — technician_time_off SQL file", () => {
  it("file exists at the canonical path", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it("creates the technician_time_off table with the canonical columns", () => {
    const sql = read(MIGRATION_PATH);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS technician_time_off/);
    expect(sql).toMatch(/company_id\s+varchar\s+NOT NULL REFERENCES companies/);
    expect(sql).toMatch(
      /technician_user_id\s+varchar\s+NOT NULL REFERENCES users/,
    );
    expect(sql).toMatch(/starts_at\s+timestamptz\s+NOT NULL/);
    expect(sql).toMatch(/ends_at\s+timestamptz\s+NOT NULL/);
    expect(sql).toMatch(/all_day\s+boolean\s+NOT NULL DEFAULT false/);
    expect(sql).toMatch(/note\s+text/);
    expect(sql).toMatch(/created_by_user_id\s+varchar\s+NOT NULL REFERENCES users/);
    expect(sql).toMatch(/archived_at\s+timestamptz/);
  });

  it("enforces ends_at > starts_at via a CHECK constraint", () => {
    const sql = read(MIGRATION_PATH);
    expect(sql).toMatch(
      /CONSTRAINT technician_time_off_range_check[\s\S]*?CHECK \(ends_at > starts_at\)/,
    );
  });

  it("constrains the reason enum at the DB layer", () => {
    const sql = read(MIGRATION_PATH);
    expect(sql).toMatch(
      /CHECK \(reason IN \('vacation', 'sick', 'personal', 'training', 'unavailable', 'other'\)\)/,
    );
  });

  it("indexes (company_id, technician_user_id, starts_at, ends_at) for the overlap query", () => {
    const sql = read(MIGRATION_PATH);
    expect(sql).toMatch(
      /CREATE INDEX[\s\S]+?ON technician_time_off \(company_id, technician_user_id, starts_at, ends_at\)/,
    );
  });
});

// ─── 2. Drizzle table + zod schemas ────────────────────────────────

describe("Drizzle — technicianTimeOff table + zod schemas", () => {
  it("the canonical reason union has six values", () => {
    expect(TECHNICIAN_TIME_OFF_REASONS).toEqual([
      "vacation",
      "sick",
      "personal",
      "training",
      "unavailable",
      "other",
    ]);
  });

  it("insert schema accepts a valid POST body", () => {
    const result = insertTechnicianTimeOffSchema.safeParse({
      technicianUserId: "00000000-0000-0000-0000-000000000001",
      reason: "vacation",
      startsAt: "2026-05-08T09:00:00-04:00",
      endsAt: "2026-05-08T17:00:00-04:00",
      allDay: false,
      note: "Out of office",
    });
    expect(result.success).toBe(true);
  });

  it("insert schema rejects end <= start", () => {
    const result = insertTechnicianTimeOffSchema.safeParse({
      technicianUserId: "00000000-0000-0000-0000-000000000001",
      reason: "vacation",
      startsAt: "2026-05-08T09:00:00-04:00",
      endsAt: "2026-05-08T09:00:00-04:00",
    });
    expect(result.success).toBe(false);
  });

  it("insert schema rejects unknown reason", () => {
    const result = insertTechnicianTimeOffSchema.safeParse({
      technicianUserId: "00000000-0000-0000-0000-000000000001",
      reason: "snow_day",
      startsAt: "2026-05-08T09:00:00-04:00",
      endsAt: "2026-05-08T17:00:00-04:00",
    });
    expect(result.success).toBe(false);
  });

  it("insert schema rejects non-uuid technicianUserId", () => {
    const result = insertTechnicianTimeOffSchema.safeParse({
      technicianUserId: "tech-1",
      reason: "vacation",
      startsAt: "2026-05-08T09:00:00-04:00",
      endsAt: "2026-05-08T17:00:00-04:00",
    });
    expect(result.success).toBe(false);
  });

  it("update schema accepts partial patches", () => {
    expect(
      updateTechnicianTimeOffSchema.safeParse({ reason: "sick" }).success,
    ).toBe(true);
    expect(
      updateTechnicianTimeOffSchema.safeParse({
        startsAt: "2026-05-08T09:00:00-04:00",
        endsAt: "2026-05-08T17:00:00-04:00",
      }).success,
    ).toBe(true);
    // Single-sided range update is fine at the schema layer; the
    // route handler validates against the persisted opposite end.
    expect(
      updateTechnicianTimeOffSchema.safeParse({
        startsAt: "2026-05-08T09:00:00-04:00",
      }).success,
    ).toBe(true);
  });

  it("update schema rejects two-sided range with end <= start", () => {
    const result = updateTechnicianTimeOffSchema.safeParse({
      startsAt: "2026-05-08T17:00:00-04:00",
      endsAt: "2026-05-08T09:00:00-04:00",
    });
    expect(result.success).toBe(false);
  });

  it("Drizzle table is exported with the canonical name + companyId FK", () => {
    const code = read(SCHEMA_PATH);
    expect(code).toMatch(
      /export const technicianTimeOff = pgTable\(\s*"technician_time_off"/,
    );
    expect(code).toMatch(
      /companyId:\s*varchar\("company_id"\)[\s\S]*?\.references\(\(\)\s*=>\s*companies\.id/,
    );
    expect(code).toMatch(
      /technicianUserId:\s*varchar\("technician_user_id"\)[\s\S]*?\.references\(\(\)\s*=>\s*users\.id/,
    );
  });
});

// ─── 3. Repository surface ─────────────────────────────────────────

describe("Repository — server/storage/technicianTimeOff.ts", () => {
  const code = read(STORAGE_PATH);
  const codeNoComments = stripComments(code);

  it("file exists at the canonical path", () => {
    expect(existsSync(STORAGE_PATH)).toBe(true);
  });

  it("exports the canonical repository surface", () => {
    expect(codeNoComments).toMatch(/export const technicianTimeOffRepository/);
    expect(codeNoComments).toMatch(/listOverlapping/);
    expect(codeNoComments).toMatch(/findById/);
    expect(codeNoComments).toMatch(/create/);
    expect(codeNoComments).toMatch(/update/);
    expect(codeNoComments).toMatch(/softDelete/);
  });

  it("listOverlapping uses the canonical (start < windowEnd AND end > windowStart) predicate", () => {
    expect(codeNoComments).toMatch(/lt\(technicianTimeOff\.startsAt,\s*opts\.windowEnd\)/);
    expect(codeNoComments).toMatch(/gt\(technicianTimeOff\.endsAt,\s*opts\.windowStart\)/);
  });

  it("listOverlapping filters out soft-deleted rows", () => {
    expect(codeNoComments).toMatch(/isNull\(technicianTimeOff\.archivedAt\)/);
  });

  it("listOverlapping is tenant-scoped via companyId", () => {
    expect(codeNoComments).toMatch(/eq\(technicianTimeOff\.companyId,\s*companyId\)/);
  });

  it("softDelete sets archived_at = NOW() (does not hard-delete)", () => {
    expect(codeNoComments).toMatch(/\.update\(technicianTimeOff\)[\s\S]*?archivedAt:\s*sql`NOW\(\)`/);
  });
});

// ─── 4. REST routes — permission gate, validation, mounting ────────

describe("Routes — server/routes/technicianTimeOff.ts", () => {
  const code = read(ROUTE_PATH);
  const codeNoComments = stripComments(code);

  it("file exists at the canonical path", () => {
    expect(existsSync(ROUTE_PATH)).toBe(true);
  });

  it("router applies requireAuth + requireRole(MANAGER_ROLES) at mount level", () => {
    expect(codeNoComments).toMatch(/router\.use\(requireAuth\)/);
    expect(codeNoComments).toMatch(/router\.use\(requireRole\(MANAGER_ROLES\)\)/);
  });

  it("routes use asyncHandler + AuthedRequest + validateSchema", () => {
    expect(codeNoComments).toMatch(/asyncHandler\(async \(req: AuthedRequest/);
    expect(codeNoComments).toMatch(/validateSchema\(insertTechnicianTimeOffSchema/);
    expect(codeNoComments).toMatch(/validateSchema\(updateTechnicianTimeOffSchema/);
  });

  it("POST verifies the technician belongs to the requesting tenant", () => {
    expect(codeNoComments).toMatch(/assertTechnicianInCompany/);
    expect(codeNoComments).toMatch(/Technician not found in this company/);
  });

  it("PATCH validates single-sided range updates against the persisted opposite end", () => {
    expect(codeNoComments).toMatch(
      /const nextStart = body\.startsAt[\s\S]+?const nextEnd = body\.endsAt/,
    );
    expect(codeNoComments).toMatch(
      /if \(nextEnd <= nextStart\)[\s\S]+?endsAt must be strictly after startsAt/,
    );
  });

  it("DELETE returns 204 and routes through softDelete", () => {
    expect(codeNoComments).toMatch(/technicianTimeOffRepository\.softDelete/);
    expect(codeNoComments).toMatch(/res\.status\(204\)\.end\(\)/);
  });

  it("router is mounted at /api/technician-time-off in routes/index.ts", () => {
    const indexCode = read(ROUTES_INDEX_PATH);
    expect(indexCode).toMatch(
      /import technicianTimeOffRouter from "\.\/technicianTimeOff"/,
    );
    expect(indexCode).toMatch(
      /app\.use\("\/api\/technician-time-off",\s*technicianTimeOffRouter\)/,
    );
  });
});

// ─── 5. Capacity integration ───────────────────────────────────────

describe("Capacity — time_off blocks + off_today promotion", () => {
  const code = read(CAPACITY_PATH);
  const codeNoComments = stripComments(code);

  it("ScheduleBlock kind union includes `time_off`", () => {
    expect(code).toMatch(/kind:\s*"booked"\s*\|\s*"open"\s*\|\s*"time_off"/);
  });

  it("ScheduleBlock surfaces reason / note / timeOffId / allDay metadata", () => {
    expect(code).toMatch(/reason\?:\s*string/);
    expect(code).toMatch(/note\?:\s*string\s*\|\s*null/);
    expect(code).toMatch(/timeOffId\?:\s*string/);
    expect(code).toMatch(/allDay\?:\s*boolean/);
  });

  it("imports the time-off repository", () => {
    expect(codeNoComments).toMatch(
      /import \{ technicianTimeOffRepository \} from "\.\/technicianTimeOff"/,
    );
  });

  it("reads overlapping time-off rows via listOverlapping for the day window", () => {
    expect(codeNoComments).toMatch(
      /technicianTimeOffRepository\.listOverlapping\([\s\S]*?windowStart:\s*dayStart,\s*windowEnd:\s*dayEnd/,
    );
  });

  it("emits buildTimeOffBlocks helper that produces kind: time_off blocks", () => {
    expect(codeNoComments).toMatch(/function buildTimeOffBlocks/);
    expect(codeNoComments).toMatch(/kind:\s*"time_off"/);
  });

  it("folds time-off intervals into busyByTech so freeSlots clips around them", () => {
    expect(codeNoComments).toMatch(
      /const busyArr = busyByTech\.get\(t\.technicianUserId\)[\s\S]+?busyByTech\.set\(t\.technicianUserId,\s*busyArr\)/,
    );
  });

  it("promotes state to off_today when time-off covers all available capacity AND no visits", () => {
    expect(codeNoComments).toMatch(
      /isFullyOffByTimeOff\s*=\s*techVisits\.length === 0 && techTimeOff\.length > 0/,
    );
    expect(codeNoComments).toMatch(
      /state:\s*isFullyOffByTimeOff\s*\?\s*"off_today"\s*:\s*"fully_booked"/,
    );
  });

  it("buildScheduleBlocks merges booked + time_off + open with kindRank booked < time_off < open", () => {
    expect(codeNoComments).toMatch(/kindRank/);
    expect(codeNoComments).toMatch(
      /k === "booked" \? 0 : k === "time_off" \? 1 : 2/,
    );
  });
});

// ─── 6. Modal source contract ──────────────────────────────────────

describe("TechnicianTimeOffModal — canonical structure", () => {
  const code = read(MODAL_PATH);

  it("file exists at the canonical path", () => {
    expect(existsSync(MODAL_PATH)).toBe(true);
  });

  it("uses the canonical ModalShell + form-field primitives", () => {
    expect(code).toMatch(/<ModalShell/);
    expect(code).toMatch(/<ModalHeader>/);
    expect(code).toMatch(/<ModalBody/);
    expect(code).toMatch(/<ModalFooter>/);
    expect(code).toMatch(/<ModalPrimaryAction/);
    expect(code).toMatch(/<ModalSecondaryAction/);
    expect(code).toMatch(/<FormField>/);
    expect(code).toMatch(/<FormLabel/);
  });

  it("renders the canonical field set", () => {
    expect(code).toMatch(/data-testid="time-off-technician-select"/);
    expect(code).toMatch(/data-testid="time-off-reason-select"/);
    expect(code).toMatch(/data-testid="time-off-all-day-toggle"/);
    expect(code).toMatch(/data-testid="time-off-start-date"/);
    expect(code).toMatch(/data-testid="time-off-end-date"/);
    expect(code).toMatch(/data-testid="time-off-note"/);
    expect(code).toMatch(/data-testid="time-off-save"/);
    expect(code).toMatch(/data-testid="time-off-cancel"/);
  });

  it("hides time inputs when allDay is true", () => {
    expect(code).toMatch(
      /\{!allDay\s*&&\s*\([\s\S]*?data-testid="time-off-start-time"/,
    );
    expect(code).toMatch(
      /\{!allDay\s*&&\s*\([\s\S]*?data-testid="time-off-end-time"/,
    );
  });

  it("posts to /api/technician-time-off on save", () => {
    expect(code).toMatch(/apiRequest[\s\S]+?"\/api\/technician-time-off"[\s\S]+?method:\s*"POST"/);
  });

  it("invalidates the canonical query keys after a successful create", () => {
    expect(code).toMatch(/queryClient\.invalidateQueries\(\{[^}]*queryKey:\s*\["\/api\/dashboard\/capacity"\]/);
    expect(code).toMatch(/queryClient\.invalidateQueries\(\{[^}]*queryKey:\s*\["dashboard",\s*"workflow"\]/);
  });

  it("validates end > start client-side before submitting", () => {
    expect(code).toMatch(
      /if \(Date\.parse\(endsAt\) <= Date\.parse\(startsAt\)\)[\s\S]+?End must be after start/,
    );
  });
});

// ─── 7. Dashboard rendering — entry point + time_off block + Off pill

describe("FinancialDashboard — time-off entry point + rendering", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("imports the TechnicianTimeOffModal", () => {
    expect(code).toMatch(
      /import \{ TechnicianTimeOffModal \} from "@\/components\/team\/TechnicianTimeOffModal"/,
    );
  });

  it("CapacityBlockDto.kind union includes time_off", () => {
    expect(code).toMatch(/kind:\s*"booked"\s*\|\s*"open"\s*\|\s*"time_off"/);
  });

  it("team-filter Popover footer carries the Add time off entry-point button", () => {
    expect(code).toMatch(/data-testid="schedule-add-time-off"/);
    expect(code).toMatch(/Add time off/);
  });

  it("the modal is mounted with the canonical technicians map + open state", () => {
    expect(code).toMatch(/<TechnicianTimeOffModal/);
    expect(codeNoComments).toMatch(/open=\{timeOffModalOpen\}/);
    expect(codeNoComments).toMatch(/onOpenChange=\{setTimeOffModalOpen\}/);
  });

  it("the schedule renders kind: time_off blocks with a distinct test id + amber palette", () => {
    expect(code).toMatch(/schedule-block-time-off-/);
    expect(code).toMatch(/Time off/);
    expect(code).toMatch(/bg-amber-50\/40/);
  });

  it("idle column renders an Off pill when a tech has any time_off block", () => {
    // Source spans multiple lines; collapse whitespace before
    // asserting on the predicate shape.
    const collapsed = codeNoComments.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /const hasTimeOff = tech\.scheduleBlocks\.some\( \(b\) => b\.kind === "time_off",? \)/,
    );
    expect(code).toMatch(/hasTimeOff[\s\S]{0,80}\?\s*"Off"\s*:/);
  });

  it("idle row click is no-op when the tech has time-off (hasClickable && firstOpen guard)", () => {
    expect(codeNoComments).toMatch(
      /onClick=\{\(\)\s*=>[\s\S]{0,80}hasClickable\s*&&[\s\S]{0,80}firstOpen\s*&&[\s\S]{0,80}handleBlockClick/,
    );
  });
});
