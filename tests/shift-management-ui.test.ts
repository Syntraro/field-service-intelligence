/**
 * Shift Management UI — Phase 3 source-pin tests.
 *
 * Source-pin style: reads source files and asserts on their text content
 * to lock key structural and terminology invariants without mounting
 * React components or making HTTP calls.
 *
 * Pins:
 *  1. Feature-disabled state renders when entitlement is false.
 *  2. Page renders with no shifts (empty grid).
 *  3. Page renders normal / on_call / unavailable shift blocks.
 *  4. ShiftFormModal has all required fields.
 *  5. Terminology: "Unavailable" not "Time Off" in user-facing labels.
 *  6. All-day toggle is unavailable-only.
 *  7. Recurrence controls exist (create only).
 *  8. Delete uses ConfirmModal with destructive variant.
 *  9. Frontend never computes recurrence — sends rule string to server.
 * 10. Feature gate: query only fires when isEnabled === true.
 * 11. Nav entry exists for /shift-management.
 * 12. Route exists in App.tsx.
 * 13. shiftKeys query key factory exists.
 * 14. apiRequest used for CSRF-safe mutations.
 * 15. Edit applies to baseShiftId (not occurrence ID).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const p = (rel: string) => resolve(ROOT, rel);

const PAGE_PATH = p("client/src/pages/ShiftManagementPage.tsx");
const GRID_PATH = p("client/src/components/shift-management/TechnicianScheduleGrid.tsx");
const BLOCK_PATH = p("client/src/components/shift-management/ShiftBlock.tsx");
const FORM_PATH = p("client/src/components/shift-management/ShiftFormModal.tsx");
const SUBTYPE_PATH = p("client/src/components/shift-management/UnavailableSubtypeSelect.tsx");
const RECURRENCE_PATH = p("client/src/components/shift-management/RecurrenceControls.tsx");
const NAV_PATH = p("client/src/lib/tenantNavConfig.ts");
const APP_PATH = p("client/src/App.tsx");
const KEYS_PATH = p("client/src/lib/queryKeys/shifts.ts");

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

// ── 0. File existence ────────────────────────────────────────────────

describe("Shift Management UI — touched files exist", () => {
  for (const path of [
    PAGE_PATH,
    GRID_PATH,
    BLOCK_PATH,
    FORM_PATH,
    SUBTYPE_PATH,
    RECURRENCE_PATH,
    KEYS_PATH,
  ]) {
    it(`exists: ${path.replace(ROOT, "")}`, () => {
      expect(existsSync(path)).toBe(true);
    });
  }
});

// ── 1. Feature gating ────────────────────────────────────────────────

describe("Feature gating — page uses useFeatureEnabled", () => {
  const src = read(PAGE_PATH);
  const stripped = stripComments(src);

  it("imports useFeatureEnabled", () => {
    expect(src).toContain('useFeatureEnabled');
  });

  it("gates query on isEnabled === true", () => {
    expect(stripped).toMatch(/enabled:\s*isEnabled\s*===\s*true/);
  });

  it("renders disabled state when isEnabled === false", () => {
    expect(src).toContain("shift-management-disabled");
  });

  it("renders spinner while isEnabled === undefined (loading)", () => {
    expect(stripped).toMatch(/isEnabled\s*===\s*undefined/);
  });
});

// ── 2. Grid renders empty state ──────────────────────────────────────

describe("TechnicianScheduleGrid — empty and populated rendering", () => {
  const src = read(GRID_PATH);

  it("renders a grid with testId", () => {
    expect(src).toContain('data-testid="technician-schedule-grid"');
  });

  it("renders empty state message when no technicians", () => {
    expect(src).toContain("No technicians found");
  });

  it("renders a cell testId per tech+date combination", () => {
    expect(src).toMatch(/data-testid=\{`schedule-cell-\$\{tech\.id\}-\$\{d\.key\}`\}/);
  });

  it("renders add-shift button per cell for quick entry", () => {
    expect(src).toMatch(/data-testid=\{`add-shift-\$\{tech\.id\}-\$\{d\.key\}`\}/);
  });

  it("groups shifts by technicianUserId and dateKey via shiftIndex", () => {
    expect(src).toContain("shiftIndex");
    expect(src).toContain("technicianUserId");
  });
});

// ── 3. ShiftBlock renders all shift types ────────────────────────────

describe("ShiftBlock — shift type rendering", () => {
  const src = read(BLOCK_PATH);

  it('maps shiftType "normal" → "Work" label', () => {
    expect(src).toContain('"Work"');
    // TypeScript object keys are unquoted identifiers
    expect(src).toContain("normal");
  });

  it('maps shiftType "on_call" → "On Call" label', () => {
    expect(src).toContain('"On Call"');
    expect(src).toContain("on_call");
  });

  it('maps shiftType "unavailable" → "Unavailable" label', () => {
    expect(src).toContain('"Unavailable"');
    expect(src).toContain('"unavailable"');
  });

  it("shows subtype label for unavailable (vacation, sick, etc.)", () => {
    expect(src).toContain("shiftSubtype");
    expect(src).toContain("SUBTYPE_LABELS");
  });

  it("shows All day label when shift.allDay is true", () => {
    expect(src).toContain('"All day"');
  });

  it("shows recurring indicator when occurrenceDate is set", () => {
    expect(src).toContain("occurrenceDate");
    expect(src).toContain("Recurring");
  });

  it("renders edit and delete action buttons", () => {
    expect(src).toMatch(/data-testid=\{`shift-edit-\$\{shift\.id\}`\}/);
    expect(src).toMatch(/data-testid=\{`shift-delete-\$\{shift\.id\}`\}/);
  });
});

// ── 4. ShiftFormModal — required fields ──────────────────────────────

describe("ShiftFormModal — form fields", () => {
  const src = read(FORM_PATH);
  const stripped = stripComments(src);

  it("has a technician selector", () => {
    expect(src).toContain('data-testid="shift-technician-select"');
  });

  it("has a shift type button group (Work / On Call / Unavailable)", () => {
    expect(src).toContain('data-testid="shift-type-group"');
    expect(src).toContain('"Work"');
    expect(src).toContain('"On Call"');
    expect(src).toContain('"Unavailable"');
  });

  it("has a date input", () => {
    expect(src).toContain('data-testid="shift-date-input"');
  });

  it("has start and end time inputs", () => {
    expect(src).toContain('data-testid="shift-start-time"');
    expect(src).toContain('data-testid="shift-end-time"');
  });

  it("has a note textarea", () => {
    expect(src).toContain('data-testid="shift-note-input"');
  });

  it("has an all-day toggle", () => {
    expect(src).toContain('data-testid="shift-allday-toggle"');
  });

  it("shows UnavailableSubtypeSelect only when shiftType is unavailable", () => {
    expect(src).toContain("isUnavailable");
    expect(src).toContain("UnavailableSubtypeSelect");
  });

  it("includes RecurrenceControls for create mode only", () => {
    expect(src).toContain("RecurrenceControls");
    expect(stripped).toMatch(/!isEdit[\s\S]{0,100}RecurrenceControls/);
  });

  it("has a save button", () => {
    expect(src).toContain('data-testid="shift-form-save"');
  });
});

// ── 5. Terminology — Unavailable not Time Off ────────────────────────

describe("Terminology — Unavailable, not Time Off", () => {
  it("ShiftFormModal uses Unavailable label", () => {
    const src = read(FORM_PATH);
    expect(src).toContain('"Unavailable"');
    expect(src).not.toMatch(/"Time Off"/i);
  });

  it("ShiftBlock uses Unavailable label", () => {
    const src = read(BLOCK_PATH);
    expect(src).toContain('"Unavailable"');
    expect(src).not.toMatch(/"Time Off"/i);
  });

  it("ShiftManagementPage title is Shift Management (not Schedules or Time Off)", () => {
    const src = read(PAGE_PATH);
    expect(src).toContain("Shift Management");
    expect(src).not.toMatch(/"Time Off"/i);
  });

  it("UnavailableSubtypeSelect does not use Time Off terminology", () => {
    const src = read(SUBTYPE_PATH);
    expect(src).not.toMatch(/"Time Off"/i);
    // Check canonical subtype labels exist
    expect(src).toContain('"Vacation"');
    expect(src).toContain('"Sick"');
    expect(src).toContain('"Personal"');
    expect(src).toContain('"Holiday"');
    expect(src).toContain('"Training"');
    expect(src).toContain('"Scheduled off"');
    expect(src).toContain('"Other"');
  });
});

// ── 6. All-day toggle is unavailable-only ────────────────────────────

describe("All-day toggle — unavailable shift type only", () => {
  const src = read(FORM_PATH);
  const stripped = stripComments(src);

  it("all-day toggle is only rendered when isUnavailable", () => {
    expect(stripped).toMatch(/isUnavailable[\s\S]{0,400}shift-allday-toggle/);
  });

  it("time inputs are hidden when allDay is true", () => {
    expect(stripped).toMatch(/!form\.allDay[\s\S]{0,600}shift-start-time/);
  });
});

// ── 7. Recurrence controls ───────────────────────────────────────────

describe("RecurrenceControls — create only, no frontend computation", () => {
  const src = read(RECURRENCE_PATH);

  it("offers No repeat, Every week, and Weekdays options", () => {
    expect(src).toContain('"No repeat"');
    expect(src).toContain('"Every week"');
    expect(src).toContain('"Weekdays"');
  });

  it("offers Daily, Every 2 weeks, and Custom options", () => {
    expect(src).toContain('"Daily"');
    expect(src).toContain('"Every 2 weeks"');
    expect(src).toContain('"Custom"');
  });

  it("exports recurrenceModeToRule that returns RRULE strings", () => {
    expect(src).toContain("recurrenceModeToRule");
    expect(src).toContain("FREQ=WEEKLY");
    expect(src).toContain("BYDAY=MO,TU,WE,TH,FR");
  });

  it("recurrenceModeToRule handles biweekly (INTERVAL=2) and daily (all-7-days)", () => {
    expect(src).toContain("FREQ=WEEKLY;INTERVAL=2");
    expect(src).toContain("BYDAY=MO,TU,WE,TH,FR,SA,SU");
  });

  it("exports CustomRecurrence interface with days and interval", () => {
    expect(src).toContain("CustomRecurrence");
    expect(src).toContain("days");
    expect(src).toContain("interval");
  });

  it("custom mode shows day-of-week checkboxes including Saturday", () => {
    expect(src).toContain('data-testid="recurrence-custom-days"');
    expect(src).toContain('"SA"');
    expect(src).toContain('"SU"');
  });

  it("frontend sends RRULE string to server — no expansion logic", () => {
    // Must NOT contain date arithmetic for generating occurrence dates
    expect(src).not.toContain("addDays");
    expect(src).not.toContain("addWeeks");
    expect(src).not.toContain("eachDayOfInterval");
  });

  it("has optional recurrence end date input", () => {
    expect(src).toContain('data-testid="recurrence-end-date"');
  });
});

// ── 8. Delete uses ConfirmModal with destructive variant ──────────────

describe("ShiftManagementPage — delete confirmation", () => {
  const src = read(PAGE_PATH);
  const stripped = stripComments(src);

  it("imports ConfirmModal", () => {
    expect(src).toContain("ConfirmModal");
  });

  it("uses destructive variant for delete confirm", () => {
    expect(src).toContain('variant="destructive"');
  });

  it("warns about recurring shift cascade on delete", () => {
    expect(src).toContain("all occurrences");
  });

  it("uses testIdPrefix delete-shift for dialog buttons", () => {
    expect(src).toContain('testIdPrefix="delete-shift"');
  });
});

// ── 9. No frontend recurrence computation ────────────────────────────

describe("Frontend never computes recurrence", () => {
  const formSrc = read(FORM_PATH);

  it("ShiftFormModal does not expand occurrences — sends RRULE to server", () => {
    expect(formSrc).not.toContain("eachDayOfInterval");
    expect(formSrc).not.toContain("getDay()");
    // recurrenceModeToRule is imported from RecurrenceControls — string only
    expect(formSrc).toContain("recurrenceModeToRule");
    expect(formSrc).toContain("recurrenceRule");
  });
});

// ── 10. Query key factory ────────────────────────────────────────────

describe("shiftKeys query key factory", () => {
  const src = read(KEYS_PATH);

  it("exports shiftKeys", () => {
    expect(src).toContain("export const shiftKeys");
  });

  it("has availability key factory with start+end params", () => {
    expect(src).toContain("availability");
    expect(src).toContain("start");
    expect(src).toContain("end");
  });

  it("has shifts key factory", () => {
    expect(src).toContain("shifts");
  });

  it("availability key spreads shiftKeys.all so invalidate-all hits the grid query", () => {
    // TanStack Query prefix-matches on array elements. availability must share the
    // same first element as .all — otherwise invalidateQueries({queryKey:shiftKeys.all})
    // never touches the grid query and created shifts won't appear.
    expect(src).toMatch(/availability.*shiftKeys\.all/s);
  });

  it("shiftKeys.all does NOT use a URL path as root (would break prefix matching)", () => {
    // URL-path roots like "/api/shift-management" differ from
    // "/api/shift-management/availability" — they share no common array element,
    // so invalidation silently misses.
    expect(src).not.toMatch(/all:\s*\["\//);
  });
});

// ── 11. Navigation entry ─────────────────────────────────────────────

describe("Nav entry — /shift-management", () => {
  const src = read(NAV_PATH);

  it("has a nav item pointing to /shift-management", () => {
    expect(src).toContain('href: "/shift-management"');
  });

  it("has testId nav-shift-management", () => {
    expect(src).toContain('testId: "nav-shift-management"');
  });

  it("imports CalendarRange icon", () => {
    expect(src).toContain("CalendarRange");
  });
});

// ── 12. App.tsx route ────────────────────────────────────────────────

describe("App.tsx — /shift-management route", () => {
  const src = read(APP_PATH);

  it("has a route for /shift-management", () => {
    expect(src).toContain('path="/shift-management"');
  });

  it("imports ShiftManagementPage", () => {
    expect(src).toContain("ShiftManagementPage");
  });
});

// ── 13. apiRequest for CSRF-safe mutations ───────────────────────────

describe("ShiftFormModal — uses apiRequest for CSRF-safe mutations", () => {
  const src = read(FORM_PATH);

  it("imports apiRequest from queryClient", () => {
    expect(src).toContain('from "@/lib/queryClient"');
    expect(src).toContain("apiRequest");
  });

  it("does NOT use raw fetch() for mutations", () => {
    const stripped = stripComments(src);
    // apiRequest is the canonical wrapper; raw fetch should not appear in mutation fns
    expect(stripped).not.toMatch(/mutationFn[\s\S]{0,200}=\s*await\s+fetch\(/);
  });
});

// ── 14. Edit targets baseShiftId ─────────────────────────────────────

describe("Edit applies to baseShiftId (not occurrence id)", () => {
  const src = read(FORM_PATH);
  const stripped = stripComments(src);

  it("PATCH uses editShift.baseShiftId (not editShift.id)", () => {
    expect(stripped).toMatch(/id:\s*editShift\.baseShiftId/);
  });
});

// ── 15. Date range mode for Unavailable shifts ───────────────────────

describe("ShiftFormModal — unavailable date range mode", () => {
  const src = read(FORM_PATH);

  it("has a date range toggle for unavailable shifts", () => {
    expect(src).toContain('data-testid="shift-date-range-toggle"');
  });

  it("has a date range end date input", () => {
    expect(src).toContain('data-testid="shift-date-range-end"');
  });

  it("date range generates FREQ=WEEKLY;BYDAY all-7-days rule", () => {
    expect(src).toContain("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU");
    expect(src).toContain("dateRangeMode");
    expect(src).toContain("dateRangeEnd");
  });

  it("date range mode hides recurrence controls", () => {
    const stripped = stripComments(src);
    // When dateRangeMode is active, RecurrenceControls must not render
    expect(stripped).toMatch(/!form\.dateRangeMode[\s\S]{0,200}RecurrenceControls/);
  });

  it("ShiftFormModal imports and uses CustomRecurrence", () => {
    expect(src).toContain("CustomRecurrence");
    expect(src).toContain("customRecurrence");
  });
});

// ── 16. Timezone-safe payload and display ────────────────────────────

describe("Timezone correctness — DST-safe scheduling", () => {
  it("ShiftFormModal sends timeOfDayStart and timeOfDayEnd in payload", () => {
    const src = read(FORM_PATH);
    expect(src).toContain("timeOfDayStart");
    expect(src).toContain("timeOfDayEnd");
  });

  it("ShiftFormModal accepts timezone prop", () => {
    const src = read(FORM_PATH);
    expect(src).toContain("timezone");
  });

  it("ShiftFormModal uses isoToLocalTime (not raw slice) for edit time extraction", () => {
    const src = read(FORM_PATH);
    expect(src).toContain("isoToLocalTime");
    expect(src).not.toContain("isoToTime(");
  });

  it("ShiftBlock accepts timezone prop and uses Intl.DateTimeFormat for display", () => {
    const src = read(BLOCK_PATH);
    expect(src).toContain("timezone");
    expect(src).toContain("Intl.DateTimeFormat");
  });

  it("TechnicianScheduleGrid accepts and threads timezone to ShiftBlock", () => {
    const src = read(GRID_PATH);
    expect(src).toContain("timezone");
  });

  it("ShiftManagementPage extracts timezone from query data and passes it down", () => {
    const src = read(PAGE_PATH);
    expect(src).toContain("shiftsQuery.data?.timezone");
    expect(src).toContain("timezone={timezone}");
  });
});

// ── 17. Edit scope controls ──────────────────────────────────────────

describe("ShiftFormModal — edit scope selector for recurring occurrences", () => {
  const src = read(FORM_PATH);
  const stripped = stripComments(src);

  it("has an edit scope radio group", () => {
    expect(src).toContain('data-testid="edit-scope-group"');
  });

  it("has all three scope options: occurrence, future, series", () => {
    expect(src).toContain('"This shift only"');
    expect(src).toContain('"This and future shifts"');
    expect(src).toContain('"Entire repeating schedule"');
  });

  it("scope selector is conditional on isRecurringOccurrence (occurrenceDate set)", () => {
    expect(stripped).toMatch(/isRecurringOccurrence[\s\S]{0,200}edit-scope-group/);
  });

  it("editScope state defaults to series when edit modal opens", () => {
    expect(src).toContain('setEditScope("series")');
  });

  it("recurrenceRule is read from editShift to pre-populate recurrence controls", () => {
    expect(src).toContain("inferRecurrenceMode");
    expect(src).toContain("editShift.recurrenceRule");
  });
});

// ── 18. Edit this shift only → POST exception ────────────────────────

describe("ShiftFormModal — occurrence scope routes to POST exception", () => {
  const src = read(FORM_PATH);
  const stripped = stripComments(src);

  it("createExceptionMutation calls /exceptions endpoint", () => {
    expect(src).toContain("/exceptions");
    expect(src).toContain("createExceptionMutation");
  });

  it("occurrence scope submit passes occurrenceDate in exception body", () => {
    expect(stripped).toMatch(/editScope\s*===\s*"occurrence"[\s\S]{0,300}occurrenceDate/);
  });

  it("occurrence scope does not show recurrence controls (showRecurrenceInEdit is false)", () => {
    expect(src).toContain("showRecurrenceInEdit");
    expect(stripped).toMatch(/editScope\s*!==\s*"occurrence"/);
  });
});

// ── 19. Edit this and future → POST split-at ─────────────────────────

describe("ShiftFormModal — future scope routes to POST split-at", () => {
  const src = read(FORM_PATH);
  const stripped = stripComments(src);

  it("splitAtMutation calls /split-at endpoint", () => {
    expect(src).toContain("/split-at");
    expect(src).toContain("splitAtMutation");
  });

  it("future scope submit dispatches splitAtMutation", () => {
    expect(stripped).toMatch(/editScope\s*===\s*"future"[\s\S]{0,400}splitAtMutation/);
  });

  it("series scope PATCH still uses editShift.baseShiftId", () => {
    expect(stripped).toMatch(/id:\s*editShift\.baseShiftId/);
  });
});

// ── 20. Delete scope modal for recurring shifts ──────────────────────

describe("ShiftManagementPage — delete scope for recurring shifts", () => {
  const src = read(PAGE_PATH);
  const stripped = stripComments(src);

  it("has a DeleteShiftScopeModal for recurring occurrences", () => {
    expect(src).toContain("DeleteShiftScopeModal");
    expect(src).toContain('data-testid="delete-shift-scope-modal"');
  });

  it("scope modal has delete-scope-group radio group", () => {
    expect(src).toContain('data-testid="delete-scope-group"');
  });

  it("occurrence scope cancels via POST exceptions with isCancelled: true", () => {
    expect(src).toContain("cancelOccurrenceMutation");
    expect(src).toContain("isCancelled: true");
  });

  it("future scope truncates series via PATCH recurrenceEndDate", () => {
    expect(src).toContain("truncateSeriesMutation");
    expect(src).toContain("recurrenceEndDate");
  });

  it("series scope hard-deletes via DELETE (existing deleteMutation)", () => {
    expect(stripped).toMatch(/deleteScope\s*===\s*"series"[\s\S]{0,200}deleteMutation/);
  });

  it("non-recurring shifts still use ConfirmModal with testIdPrefix delete-shift", () => {
    expect(src).toContain('testIdPrefix="delete-shift"');
    expect(src).toContain("!deleteTarget.occurrenceDate");
  });

  it("scope modal contains all occurrences warning text", () => {
    expect(src).toContain("all occurrences");
  });
});

// ── 21. Work-shift-per-day cap — grid ────────────────────────────────

describe("TechnicianScheduleGrid — work-shift-per-day cap", () => {
  const src = read(GRID_PATH);
  const stripped = stripComments(src);

  it("computes workShiftCount from shifts (shiftType === 'normal')", () => {
    expect(src).toContain("workShiftCount");
    expect(src).toContain("shiftType");
    expect(src).toContain('"normal"');
  });

  it("derives workShiftsFull = dayWorkCount >= 2", () => {
    expect(stripped).toMatch(/workShiftsFull\s*=\s*dayWorkCount\s*>=\s*2/);
  });

  it("passes workShiftsFull to onAddShift callback", () => {
    expect(stripped).toMatch(/onAddShift\s*\([^)]*workShiftsFull/);
  });

  it("onAddShift prop type includes workShiftsFull boolean", () => {
    expect(src).toContain("workShiftsFull");
  });

  it("marks + button with data-work-full attribute when full", () => {
    expect(src).toContain("data-work-full");
  });
});

// ── 22. Work-shift-per-day cap — modal ───────────────────────────────

describe("ShiftFormModal — workShiftsFull prop enforces Work cap", () => {
  const src = read(FORM_PATH);
  const stripped = stripComments(src);

  it("accepts workShiftsFull prop", () => {
    expect(src).toContain("workShiftsFull");
  });

  it("defaults shiftType to on_call when workShiftsFull is true", () => {
    expect(stripped).toMatch(/workShiftsFull\s*\?\s*"on_call"\s*:\s*"normal"/);
  });

  it("disables Work button when workShiftsFull", () => {
    expect(stripped).toMatch(/isWorkBlocked[\s\S]{0,400}disabled/);
  });

  it("shows FormHelperText with cap message when workShiftsFull", () => {
    expect(src).toContain("A technician can have up to 2 work shifts per day.");
    expect(src).toContain("FormHelperText");
  });

  it("ShiftManagementPage passes workShiftsFull to ShiftFormModal", () => {
    const pageSrc = read(PAGE_PATH);
    expect(pageSrc).toContain("workShiftsFull={addWorkShiftsFull}");
    expect(pageSrc).toContain("addWorkShiftsFull");
  });
});
