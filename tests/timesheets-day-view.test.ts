/**
 * Timesheets Day View — guard suite (2026-05-04 v2: grouped-cards refactor).
 *
 * Locks the canonical contracts of the v2 Day View:
 *
 *   1. categoryMap covers all 9 enum values; bucket logic is correct.
 *   2. defaultTypeForCategory commits the documented default enum.
 *   3. defaultBillableForCategory enforces "general → unbillable" rule.
 *   4. PayrollPage renders the new <DayView /> for the day branch and
 *      preserves the existing Week View block (Week View redesign is
 *      out of scope).
 *   5. PayrollPage's locked-entry edit path still routes through the
 *      existing TimeEntryModal (manager override-reason flow preserved).
 *   6. Day View structural pins:
 *        - TimelineRail (chronological dot/label column)
 *        - JobTimeGroupCard (one card per job + a single General card)
 *        - TimeEntryRowCompact (compact rows inside group cards)
 *        - DaySummaryCard inlines the category strip
 *        - Standalone CategoryStrip + per-entry TimeEntryRow files are gone
 *   7. Day View mutations target the canonical admin-timesheets endpoints.
 *   8. Grouping rule: jobId null OR general-type → General bucket.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

import {
  categoryForType,
  defaultTypeForCategory,
  commitTypeForCategoryChange,
  defaultBillableForCategory,
  CATEGORY_STYLE,
} from "../client/src/components/timesheets/categoryMap";

const ROOT = resolve(__dirname, "..");
const PAYROLL_PAGE = resolve(ROOT, "client/src/pages/PayrollPage.tsx");
const DAY_VIEW = resolve(ROOT, "client/src/components/timesheets/DayView.tsx");
const DAY_SUMMARY = resolve(ROOT, "client/src/components/timesheets/DaySummaryCard.tsx");
const TIMELINE_RAIL = resolve(ROOT, "client/src/components/timesheets/TimelineRail.tsx");
const GROUP_CARD = resolve(ROOT, "client/src/components/timesheets/JobTimeGroupCard.tsx");
const ROW_COMPACT = resolve(ROOT, "client/src/components/timesheets/TimeEntryRowCompact.tsx");
const EDIT_MODAL = resolve(ROOT, "client/src/components/timesheets/TimeEntryEditModal.tsx");
const CREATE_MODAL = resolve(ROOT, "client/src/components/timesheets/JobSessionCreateModal.tsx");
const TECH_FIELD_ROUTES = resolve(ROOT, "server/routes/techField.ts");

// Files that must NOT exist after the v2 refactor.
const REMOVED_TIME_ENTRY_ROW = resolve(ROOT, "client/src/components/timesheets/TimeEntryRow.tsx");
const REMOVED_CATEGORY_STRIP = resolve(ROOT, "client/src/components/timesheets/CategoryStrip.tsx");

const payrollSrc = readFileSync(PAYROLL_PAGE, "utf-8");
const dayViewSrc = readFileSync(DAY_VIEW, "utf-8");
const daySummarySrc = readFileSync(DAY_SUMMARY, "utf-8");
const railSrc = readFileSync(TIMELINE_RAIL, "utf-8");
const groupSrc = readFileSync(GROUP_CARD, "utf-8");
const rowCompactSrc = readFileSync(ROW_COMPACT, "utf-8");
const editModalSrc = readFileSync(EDIT_MODAL, "utf-8");
const createModalSrc = readFileSync(CREATE_MODAL, "utf-8");
const techFieldSrc = readFileSync(TECH_FIELD_ROUTES, "utf-8");

// ── Unit: categoryMap covers all 9 enum values ──────────────────────

describe("categoryMap.categoryForType", () => {
  it("buckets on-site enum values into 'onsite'", () => {
    expect(categoryForType("on_site")).toBe("onsite");
    expect(categoryForType("task_work")).toBe("onsite");
  });

  it("buckets all 4 drive enum values into 'drive'", () => {
    expect(categoryForType("travel_to_job")).toBe("drive");
    expect(categoryForType("travel_to_supplier")).toBe("drive");
    expect(categoryForType("travel_between_jobs")).toBe("drive");
    expect(categoryForType("supplier_run")).toBe("drive");
  });

  it("buckets non-billable / generic enum values into 'general'", () => {
    expect(categoryForType("admin")).toBe("general");
    expect(categoryForType("break")).toBe("general");
    expect(categoryForType("other")).toBe("general");
  });

  it("falls back to 'general' for null / unknown values", () => {
    expect(categoryForType(null)).toBe("general");
    expect(categoryForType(undefined)).toBe("general");
    expect(categoryForType("not_a_real_type")).toBe("general");
  });
});

describe("categoryMap.defaultTypeForCategory", () => {
  it("commits the documented enum default per UI category", () => {
    expect(defaultTypeForCategory("onsite")).toBe("on_site");
    expect(defaultTypeForCategory("drive")).toBe("travel_to_job");
    expect(defaultTypeForCategory("general")).toBe("other");
  });
});

describe("categoryMap.commitTypeForCategoryChange", () => {
  it("preserves a finer-grained existing enum value when category is unchanged", () => {
    expect(commitTypeForCategoryChange("travel_to_supplier", "drive"))
      .toBe("travel_to_supplier");
    expect(commitTypeForCategoryChange("task_work", "onsite")).toBe("task_work");
  });

  it("commits the new category default when category actually changes", () => {
    expect(commitTypeForCategoryChange("on_site", "drive")).toBe("travel_to_job");
    expect(commitTypeForCategoryChange("travel_to_supplier", "general")).toBe("other");
    expect(commitTypeForCategoryChange("admin", "onsite")).toBe("on_site");
  });

  it("commits the default when current type is null/undefined", () => {
    expect(commitTypeForCategoryChange(null, "drive")).toBe("travel_to_job");
    expect(commitTypeForCategoryChange(undefined, "onsite")).toBe("on_site");
  });
});

describe("categoryMap.defaultBillableForCategory", () => {
  it("on-site / drive default to billable=true; general defaults to false", () => {
    expect(defaultBillableForCategory("onsite")).toBe(true);
    expect(defaultBillableForCategory("drive")).toBe(true);
    expect(defaultBillableForCategory("general")).toBe(false);
  });
});

describe("categoryMap.CATEGORY_STYLE", () => {
  it("exposes a label, dot, and chip class for every category", () => {
    for (const cat of ["onsite", "drive", "general"] as const) {
      const s = CATEGORY_STYLE[cat];
      expect(s.label).toBeTruthy();
      expect(s.dot).toMatch(/^bg-/);
      expect(s.chip).toMatch(/border-/);
    }
  });

  it("uses emerald for on-site, blue for drive, slate for general", () => {
    expect(CATEGORY_STYLE.onsite.dot).toContain("emerald");
    expect(CATEGORY_STYLE.drive.dot).toContain("blue");
    expect(CATEGORY_STYLE.general.dot).toContain("slate");
  });
});

// ── Wiring: PayrollPage renders new DayView, Week View untouched ────

describe("PayrollPage Day View wiring", () => {
  it("imports the canonical DayView component", () => {
    expect(payrollSrc).toMatch(
      /import\s*\{\s*DayView\s*,\s*type\s+DayViewEntry\s*\}\s*from\s*["']@\/components\/timesheets\/DayView["']/,
    );
  });

  it("mounts <DayView /> inside the day-mode branch", () => {
    expect(payrollSrc).toMatch(/viewMode === "day"/);
    expect(payrollSrc).toMatch(/<DayView[\s\S]+?\/>/);
  });

  it("forwards isEntryLocked + delete-confirm + locked-edit handlers", () => {
    expect(payrollSrc).toMatch(/onOpenLockedEdit=\{\(entry\)\s*=>\s*openEditEntry/);
    expect(payrollSrc).toMatch(/onRequestDelete=\{\(id, label\)\s*=>\s*setDeleteTarget/);
  });

  it("preserves the existing TimeEntryModal mount for the override flow", () => {
    expect(payrollSrc).toMatch(/<TimeEntryModal/);
    expect(payrollSrc).toMatch(/extraInvalidateKeys=/);
  });

  it("does not redesign the Week View block", () => {
    expect(payrollSrc).toMatch(/viewMode === "week"/);
    const weekBranchMatch = payrollSrc.match(
      /\{viewMode === "week" && \(([\s\S]*?)\)\}/g,
    );
    expect(weekBranchMatch).not.toBeNull();
    for (const branch of weekBranchMatch ?? []) {
      expect(branch).not.toMatch(/<DayView/);
      expect(branch).not.toMatch(/<TimelineRail/);
      expect(branch).not.toMatch(/<JobTimeGroupCard/);
    }
  });
});

// ── v2 structural pins ──────────────────────────────────────────────

describe("Day View v2 structural contract", () => {
  it("v1 components are deleted", () => {
    expect(existsSync(REMOVED_TIME_ENTRY_ROW)).toBe(false);
    expect(existsSync(REMOVED_CATEGORY_STRIP)).toBe(false);
  });

  it("DayView composes TimelineRail + JobTimeGroupCard (not per-entry rows)", () => {
    expect(dayViewSrc).toMatch(/<TimelineRail/);
    expect(dayViewSrc).toMatch(/<JobTimeGroupCard/);
    // Per-entry "TimeEntryRow" component must not be referenced anymore.
    expect(dayViewSrc).not.toMatch(/<TimeEntryRow[^C]/);
  });

  it("JobTimeGroupCard uses TimeEntryRowCompact for body rows", () => {
    expect(groupSrc).toMatch(/import\s+\{\s*TimeEntryRowCompact/);
    expect(groupSrc).toMatch(/<TimeEntryRowCompact/);
  });

  it("DaySummaryCard inlines the category strip (no standalone <CategoryStrip>)", () => {
    expect(daySummarySrc).toMatch(/data-testid="day-category-strip"/);
    expect(dayViewSrc).not.toMatch(/CategoryStrip/);
    expect(daySummarySrc).not.toMatch(/import\s+\{\s*CategoryStrip/);
  });

  it("TimelineRail is independent of cards (no jobId-aware logic in the rail)", () => {
    // The rail only renders chronological dots; it must NOT introspect
    // jobId, jobNumber, or location data — that's card-territory.
    expect(railSrc).not.toMatch(/jobId/);
    expect(railSrc).not.toMatch(/jobNumber/);
    expect(railSrc).not.toMatch(/locationName/);
  });

  it("TimeEntryRowCompact does not render duplicate job/client text", () => {
    // The compact row must only show: type pill, start → end, duration.
    // Job number / client name belong to the group header.
    expect(rowCompactSrc).not.toMatch(/jobNumber/);
    expect(rowCompactSrc).not.toMatch(/locationName/);
    expect(rowCompactSrc).not.toMatch(/jobSummary/);
  });
});

// ── DayView mutation surface ────────────────────────────────────────

describe("DayView API contract", () => {
  it("posts inline edits to the canonical PATCH /api/admin/timesheets/entries/:id", () => {
    expect(dayViewSrc).toMatch(/PATCH.*\/api\/admin\/timesheets\/entries/);
    expect(dayViewSrc).not.toMatch(/\/api\/time\/entries\/\$\{[^}]+\}/);
  });

  it("Add Entry modal posts to POST /api/admin/timesheets/entries with technicianId", () => {
    // 2026-05-05: create flow moved from inline editor + DayView's
    // createMutation to JobSessionCreateModal with its own POST(s).
    expect(createModalSrc).toMatch(/POST.*\/api\/admin\/timesheets\/entries/);
    expect(createModalSrc).toMatch(/technicianId,/);
    // DayView still passes the selected member as technicianId on mount.
    expect(dayViewSrc).toMatch(/technicianId=\{selectedMemberId\}/);
  });

  it("uses the canonical clock-out endpoint (/api/time/entries/stop)", () => {
    expect(dayViewSrc).toMatch(/\/api\/time\/entries\/stop/);
  });

  it("routes locked entries to the existing TimeEntryModal via onOpenLockedEdit", () => {
    expect(dayViewSrc).toMatch(/onOpenLockedEdit\(entry\)/);
    // Edit modal must not render an override-reason input — that's the
    // canonical TimeEntryModal's responsibility, not the v3 focused editor.
    expect(editModalSrc).not.toMatch(/override\s+reason/i);
    expect(editModalSrc).not.toMatch(/lockReason/);
  });
});

// ── Grouping logic ─────────────────────────────────────────────────

describe("DayView grouping rule", () => {
  it("buckets entries with no jobId OR general-type into the General card", () => {
    // The DayView source must contain the rule documented in spec:
    //   `!entry.jobId || bucketByType` → GENERAL_KEY
    expect(dayViewSrc).toMatch(/GENERAL_KEY/);
    expect(dayViewSrc).toMatch(/!entry\.jobId\s*\|\|\s*bucketByType/);
    // bucketByType is derived from the categoryMap helper.
    expect(dayViewSrc).toMatch(/categoryForType\(entry\.type\)/);
  });

  it("orders General card last; jobs sorted by earliest entry start", () => {
    // Sorter pushes General to the end and orders other groups by sortKey.
    expect(dayViewSrc).toMatch(/a\.variant === "general".*?return 1/s);
    expect(dayViewSrc).toMatch(/b\.variant === "general".*?return -1/s);
    expect(dayViewSrc).toMatch(/a\.sortKey - b\.sortKey/);
  });
});

// ── Component testid surface ───────────────────────────────────────

describe("Day View v2 component test surface", () => {
  it("DaySummaryCard exposes header testids (including inline category strip)", () => {
    expect(daySummarySrc).toMatch(/data-testid="day-summary-card"/);
    expect(daySummarySrc).toMatch(/data-testid="day-employee-select"/);
    expect(daySummarySrc).toMatch(/data-testid="day-total"/);
    expect(daySummarySrc).toMatch(/data-testid="day-live-badge"/);
    expect(daySummarySrc).toMatch(/data-testid="day-category-strip"/);
    expect(daySummarySrc).toMatch(/category-total-\$\{cat\}/);
  });

  it("TimelineRail exposes per-entry marker testids", () => {
    expect(railSrc).toMatch(/data-testid="day-timeline-rail"/);
    expect(railSrc).toMatch(/rail-marker-\$\{entry\.id\}/);
  });

  it("JobTimeGroupCard exposes per-group testids (job + general variants)", () => {
    // testids are computed into a `groupTestId` variable, then bound via
    // `data-testid={groupTestId}`. Match the source-level string values.
    expect(groupSrc).toMatch(/"day-group-general"/);
    expect(groupSrc).toMatch(/`day-group-job-\$\{jobId/);
    expect(groupSrc).toMatch(/data-testid="job-group-job-number"/);
    expect(groupSrc).toMatch(/data-testid="job-group-location"/);
  });

  it("TimeEntryRowCompact exposes per-row testids and the clockout action", () => {
    expect(rowCompactSrc).toMatch(/day-entry-compact-\$\{entry\.id\}/);
    expect(rowCompactSrc).toMatch(/day-entry-compact-duration-\$\{entry\.id\}/);
    expect(rowCompactSrc).toMatch(/day-entry-compact-clockout-\$\{entry\.id\}/);
  });

  it("JobSessionCreateModal exposes compact Add-Entry testids", () => {
    // 2026-05-05 v2: 4-mode pill selector replaced by inline rows
    // (Drive + On-site optional in labor view; General in secondary view).
    expect(createModalSrc).toMatch(/data-testid="create-identity"/);
    expect(createModalSrc).toMatch(/data-testid="create-employee"/);
    expect(createModalSrc).toMatch(/data-testid="create-date"/);
    expect(createModalSrc).toMatch(/data-testid="create-job-search"/);
    // Per-row testids use template literals (`create-row-${rowKey}`).
    expect(createModalSrc).toMatch(/data-testid=\{`create-row-\$\{rowKey\}`\}/);
    // Switch links between labor / general views.
    expect(createModalSrc).toMatch(/data-testid="create-switch-general"/);
    expect(createModalSrc).toMatch(/data-testid="create-switch-labor"/);
    expect(createModalSrc).toMatch(/data-testid="create-notes"/);
    expect(createModalSrc).toMatch(/data-testid="create-save"/);
    expect(createModalSrc).toMatch(/data-testid="create-cancel"/);
  });
});

// ── Spec hard-pins ──────────────────────────────────────────────────

describe("Day View spec compliance — hard pins", () => {
  it("running entries have no end time and surface a Clock out action in the compact row", () => {
    expect(rowCompactSrc).toMatch(/Clock out/);
    expect(rowCompactSrc).toMatch(/isRunning/);
  });

  it("Add Entry default view is 'labor' (Drive + On-site rows visible)", () => {
    // 2026-05-05 v2: mode pills replaced by a labor/general view
    // toggle. Labor view shows both Drive and On-site rows up front.
    expect(createModalSrc).toMatch(/useState<CreateView>\("labor"\)/);
  });

  it("layout is 2-column: rail left + grouped cards right", () => {
    // The flex layout placing TimelineRail + groups list side-by-side.
    expect(dayViewSrc).toMatch(/data-testid="day-entries-layout"/);
    expect(dayViewSrc).toMatch(/data-testid="day-groups-list"/);
  });
});

// ── v3 UX refinement (2026-05-04): focused edit modal, no duplicate
//    counts, no bottom footer, type fixed once created ───────────────

describe("Day View v3 UX refinement", () => {
  it("DaySummaryCard no longer renders an entry-count caption", () => {
    // The "{N} entries" caption is removed from the header summary.
    expect(daySummarySrc).not.toMatch(/entryCount/);
    expect(daySummarySrc).not.toMatch(/entry"\s*:\s*"entries/);
    expect(daySummarySrc).not.toMatch(/\{entryCount\}/);
  });

  it("DayView no longer renders the bottom footer summary block", () => {
    expect(dayViewSrc).not.toMatch(/data-testid="day-footer-summary"/);
    // Defensive: the duplicate "X entries" + "Total Hh Mm" block must
    // not be re-introduced anywhere in DayView.
    expect(dayViewSrc).not.toMatch(/Total\s*\{formatMinutes/);
  });

  it("DayView mounts the focused TimeEntryEditModal", () => {
    expect(dayViewSrc).toMatch(
      /import\s*\{\s*TimeEntryEditModal\s*,/,
    );
    expect(dayViewSrc).toMatch(/<TimeEntryEditModal[\s\S]+?\/>/);
    // Edit-on-click sets the modal's `editingEntry` state — not an
    // inline editor slot in the group card.
    expect(dayViewSrc).toMatch(/setEditingEntry\(entry\)/);
  });

  it("DayView routes locked entries to the existing TimeEntryModal (not the new edit modal)", () => {
    // Lock check still short-circuits to the canonical override modal.
    expect(dayViewSrc).toMatch(/if \(isEntryLocked\(entry\)\)\s*\{[\s\S]+?onOpenLockedEdit\(entry\)/);
  });

  it("TimeEntryEditModal has no type selector (type is fixed once created)", () => {
    // Type radios from the create editor must NOT appear in the edit
    // modal — type is fixed once created (separate manager correction
    // flow exists for type changes).
    expect(editModalSrc).not.toMatch(/editor-category-/);
    expect(editModalSrc).not.toMatch(/role="radiogroup"/);
    // Type pill renders as read-only context.
    expect(editModalSrc).toMatch(/edit-modal-type-pill/);
  });

  it("TimeEntryEditModal job selector is changeable (re-link or unlink to General)", () => {
    // 2026-05-04 v3 polish: the job picker IS now exposed in the edit
    // modal so any entry — drive / on-site / general — can be reassigned.
    // Reuses the canonical /api/jobs?search= source already used by
    // TimeEntryEditor (no parallel job lookup system).
    expect(editModalSrc).toMatch(/data-testid="edit-modal-job-search"/);
    expect(editModalSrc).toMatch(/data-testid="edit-modal-job-clear"/);
    expect(editModalSrc).toMatch(/data-testid="edit-modal-job-label"/);
    // Searches against the canonical jobs endpoint.
    expect(editModalSrc).toMatch(/\/api\/jobs\?search=/);
    // "General (no job)" affordance — clear current job link.
    expect(editModalSrc).toMatch(/General\s*\(no job\)/);
  });

  it("TimeEntryEditModal commits jobId in the PATCH payload", () => {
    // jobId is now changeable, so the update mutation body must include
    // it. Type is still NOT in the body (fixed once created).
    const updateMutationBody = dayViewSrc.match(
      /updateMutation\s*=\s*useMutation\([\s\S]+?\}\),?\s*\}\s*\)/,
    );
    expect(updateMutationBody).not.toBeNull();
    const body = updateMutationBody![0];
    expect(body).toMatch(/startAt:\s*vars\.payload\.startAt/);
    expect(body).toMatch(/endAt:\s*vars\.payload\.endAt/);
    expect(body).toMatch(/notes:\s*vars\.payload\.notes/);
    expect(body).toMatch(/billable:\s*vars\.payload\.billable/);
    expect(body).toMatch(/jobId:\s*vars\.payload\.jobId/);
    // Type stays out — corrections are a separate flow.
    expect(body).not.toMatch(/type:\s*vars\.payload\.type/);
  });

  it("TimeEntryEditModal exposes Jobber-style field testids", () => {
    expect(editModalSrc).toMatch(/data-testid="edit-modal-employee"/);
    expect(editModalSrc).toMatch(/data-testid="edit-modal-start-date"/);
    expect(editModalSrc).toMatch(/data-testid="edit-modal-start-time"/);
    expect(editModalSrc).toMatch(/data-testid="edit-modal-end-time"/);
    expect(editModalSrc).toMatch(/data-testid="edit-modal-duration-hours"/);
    expect(editModalSrc).toMatch(/data-testid="edit-modal-duration-minutes"/);
    expect(editModalSrc).toMatch(/data-testid="edit-modal-notes"/);
    expect(editModalSrc).toMatch(/data-testid="edit-modal-billable"/);
    expect(editModalSrc).toMatch(/data-testid="edit-modal-save"/);
    expect(editModalSrc).toMatch(/data-testid="edit-modal-cancel"/);
    expect(editModalSrc).toMatch(/data-testid="edit-modal-delete"/);
  });

  it("TimeEntryEditModal duration is bidirectional with End Time", () => {
    // Editing duration → recompute End Time = Start + Duration.
    expect(editModalSrc).toMatch(/handleDurationChange/);
    expect(editModalSrc).toMatch(/addMinutesToIso/);
    // The handler updates endTime state.
    expect(editModalSrc).toMatch(/setEndTime\(format\(parseISO\(newEndIso\)/);
  });

  it("TimeEntryEditModal Notes textarea has no auto-fill placeholder", () => {
    // Spec: notes default blank — only user-entered text. The textarea's
    // placeholder is empty, not "Visit #..." or "What was worked on?".
    expect(editModalSrc).toMatch(/id="edit-modal-notes"/);
    // The Notes Textarea must not seed a Visit-style placeholder.
    expect(editModalSrc).not.toMatch(/placeholder=["'`].*Visit\s*#/);
    expect(editModalSrc).not.toMatch(/placeholder=["'`].*en route/i);
    expect(editModalSrc).not.toMatch(/placeholder=["'`].*on site/i);
  });

  it("JobTimeGroupCard no longer accepts editorSlot props", () => {
    // The inline editor-slot mechanism is gone; edit happens in the
    // modal at the parent level. Removing these props prevents a
    // future refactor from re-introducing inline-expand-in-card edits.
    expect(groupSrc).not.toMatch(/editorSlot/);
    expect(groupSrc).not.toMatch(/editorSlotEntryId/);
  });

  it("Add Entry now opens a modal (no inline create editor)", () => {
    // 2026-05-05: the inline `<TimeEntryEditor mode="create">` mount
    // was removed. Add Entry button opens JobSessionCreateModal.
    expect(dayViewSrc).not.toMatch(/<TimeEntryEditor/);
    expect(dayViewSrc).toMatch(/<JobSessionCreateModal/);
    expect(dayViewSrc).toMatch(/setCreateOpen\(true\)/);
  });
});

// ── v3 polish (2026-05-04 part 2): daily total reconciliation,
//    header summary, server-side notes cleanup ─────────────────────

describe("Day View v3 polish — header total + reconciliation", () => {
  it("daily total is derived client-side from entries (sum of durationMinutes)", () => {
    // Header total must reconcile with the visible rows + category
    // pills. Source of truth: entries.reduce(durationMinutes).
    expect(dayViewSrc).toMatch(/dailyTotalMinutes/);
    expect(dayViewSrc).toMatch(
      /entries\.reduce\([\s\S]+?sum\s*\+\s*\(e\.durationMinutes\s*\?\?\s*0\)/,
    );
    // Header receives the derived total — not the work_sessions value.
    expect(dayViewSrc).toMatch(/totalMinutes=\{dailyTotalMinutes\}/);
  });

  it("category strip and header total share the same source", () => {
    // bucketTotals(entries) and the dailyTotalMinutes reducer both
    // walk the same `entries` array. The category sums must add up
    // to the header total: both use entries[].durationMinutes ?? 0.
    expect(dayViewSrc).toMatch(
      /function\s+bucketTotals\([\s\S]+?entries\.reduce/,
    );
    // Both helpers consume entries — pinned indirectly by their
    // shared dependency. No work_sessions-derived `totalMinutes`
    // prop on DayView anymore.
    expect(dayViewSrc).not.toMatch(/totalMinutes:\s*number;/);
  });

  it("PayrollPage no longer passes totalMinutes to DayView", () => {
    expect(payrollSrc).not.toMatch(/totalMinutes=\{dayData/);
  });
});

describe("JobTimeGroupCard header polish — # / location / summary", () => {
  it("renders job number, em-dash, location, slash, and job summary", () => {
    // Header order: #N — locationName / jobSummary.
    expect(groupSrc).toMatch(/data-testid="job-group-job-number"/);
    expect(groupSrc).toMatch(/data-testid="job-group-location"/);
    expect(groupSrc).toMatch(/data-testid="job-group-summary"/);
    // Em-dash separator between # and location.
    expect(groupSrc).toMatch(/—/);
    // Slash separator between location and summary.
    expect(groupSrc).toMatch(/\//);
  });

  it("DayView passes jobSummary into the JobTimeGroupCard mount", () => {
    expect(dayViewSrc).toMatch(/jobSummary=\{group\.jobSummary\}/);
    // JobGroup type carries jobSummary.
    expect(dayViewSrc).toMatch(/jobSummary:\s*string\s*\|\s*null;/);
  });
});

describe("Notes cleanup — no auto-generated 'Visit #N — ...' strings", () => {
  it("server tech-field routes no longer write canned 'Visit #' notes", () => {
    // All 6 sites in techField.ts are cleared (en_route, on_site,
    // route_cancelled, start_cancelled, paused, resumed). Audit
    // context (visitId / visitNumber FK) remains for downstream
    // labeling.
    expect(techFieldSrc).not.toMatch(/`Visit #\$\{visit\.visitNumber\} — en route`/);
    expect(techFieldSrc).not.toMatch(/`Visit #\$\{visit\.visitNumber\} — on site`/);
    expect(techFieldSrc).not.toMatch(/`Visit #\$\{visit\.visitNumber\} — route cancelled`/);
    expect(techFieldSrc).not.toMatch(/`Visit #\$\{visit\.visitNumber\} — start cancelled`/);
    expect(techFieldSrc).not.toMatch(/`Visit #\$\{visit\.visitNumber\} — paused`/);
    expect(techFieldSrc).not.toMatch(/`Visit #\$\{visit\.visitNumber\} — resumed`/);
  });
});

// ── v4 polish (2026-05-04 part 3): combined drive + on-site editor,
//    Approval Locks card removed, running guard ───────────────────

const SESSION_MODAL = resolve(
  ROOT,
  "client/src/components/timesheets/JobSessionEditModal.tsx",
);
const sessionModalSrc = readFileSync(SESSION_MODAL, "utf-8");

describe("Day View v4 polish — Approval Locks card removed", () => {
  it("PayrollPage no longer renders the Approval Locks info card", () => {
    expect(payrollSrc).not.toMatch(/Approval Locks/);
    // The LockKeyhole icon stays imported (used by the Week View
    // Approved badge), but the static info card and its copy are gone.
    expect(payrollSrc).not.toMatch(
      /Once a week is approved.*time entries are locked/,
    );
  });
});

describe("Day View v4 polish — JobSessionEditModal (combined editor)", () => {
  it("renders an Edit Time Entry title + employee + job header", () => {
    expect(sessionModalSrc).toMatch(/<DialogTitle>Edit Time Entry<\/DialogTitle>/);
    expect(sessionModalSrc).toMatch(/data-testid="job-session-header"/);
    expect(sessionModalSrc).toMatch(/data-testid="job-session-employee"/);
    expect(sessionModalSrc).toMatch(/data-testid="job-session-job-number"/);
  });

  it("exposes Drive AND On-site sections", () => {
    // testid is set via `data-testid={`...${sectionKey}`}` (JSX
    // expression wrapping a template literal).
    expect(sessionModalSrc).toMatch(/data-testid=\{`job-session-section-\$\{sectionKey\}`\}/);
    // Two SessionSection mounts — one drive, one onsite.
    expect(sessionModalSrc).toMatch(/sectionKey="drive"/);
    expect(sessionModalSrc).toMatch(/sectionKey="onsite"/);
    expect(sessionModalSrc).toMatch(/sectionLabel="Drive"/);
    expect(sessionModalSrc).toMatch(/sectionLabel="On-site"/);
  });

  it("does NOT show a billable checkbox", () => {
    // Strip block + line comments so we don't match the doc comment
    // that legitimately explains *why* there's no billable control.
    const codeOnly = sessionModalSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/<Checkbox/);
    expect(codeOnly).not.toMatch(/import\s*\{[^}]*\bCheckbox\b/);
    expect(codeOnly).not.toMatch(/data-testid=["'][^"']*billable/i);
  });

  it("does NOT show 'General (no job)' inside the combined editor", () => {
    // Strip comments — the doc block legitimately documents the absence.
    const codeOnly = sessionModalSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/General\s*\(no job\)/);
  });

  it("removes number-input spinner arrows on duration inputs", () => {
    // The Tailwind utility classes that suppress webkit / firefox
    // number-input spinners.
    expect(sessionModalSrc).toMatch(/\[appearance:textfield\]/);
    expect(sessionModalSrc).toMatch(/webkit-inner-spin-button\]:appearance-none/);
  });

  it("Notes textarea has no auto-fill placeholder ('Visit #...' / 'en route' / 'on site')", () => {
    expect(sessionModalSrc).not.toMatch(/placeholder=["'`].*Visit\s*#/);
    expect(sessionModalSrc).not.toMatch(/placeholder=["'`].*en route/i);
    expect(sessionModalSrc).not.toMatch(/placeholder=["'`].*on site/i);
    // The single shared notes textarea is rendered.
    expect(sessionModalSrc).toMatch(/data-testid="job-session-notes"/);
  });

  it("save dispatches per-row PATCHes (drive + on-site stay separate rows)", () => {
    // The mutation walks rowPatches and PATCHes each time_entries
    // row independently — backend rows are not merged.
    expect(dayViewSrc).toMatch(/sessionSaveMutation/);
    expect(dayViewSrc).toMatch(/rowPatches\.push/);
    expect(dayViewSrc).toMatch(/Promise\.all\(/);
    expect(dayViewSrc).toMatch(/PATCH.*\/api\/admin\/timesheets\/entries/);
  });

  it("duration is bidirectional with End Time per section", () => {
    expect(sessionModalSrc).toMatch(/handleDurationChange/);
    expect(sessionModalSrc).toMatch(/addMinutesToIso/);
    // Duration handler updates the section's endTime.
    expect(sessionModalSrc).toMatch(/newEndTime\s*=\s*format\(parseISO\(newEndIso\)/);
  });

  it("supports a compact job swap with the canonical job search", () => {
    expect(sessionModalSrc).toMatch(/data-testid="job-session-job-swap"/);
    expect(sessionModalSrc).toMatch(/data-testid="job-session-job-search"/);
    expect(sessionModalSrc).toMatch(/\/api\/jobs\?search=/);
  });
});

describe("Day View v4 polish — DayView routing + running guard", () => {
  it("DayView mounts both editors (combined for jobs + simple for general)", () => {
    expect(dayViewSrc).toMatch(/<JobSessionEditModal/);
    expect(dayViewSrc).toMatch(/<TimeEntryEditModal/);
  });

  it("blocks editing when the session has a running entry", () => {
    // 2026-05-04 v4 fix: running guard runs against `sessionEntries`
    // (synthesized from the entries array, not the visual group).
    expect(dayViewSrc).toMatch(/Clock out before editing/);
    expect(dayViewSrc).toMatch(
      /sessionEntries\.some\(\(e\)\s*=>\s*e\.endAt\s*==\s*null\)/,
    );
    // Single-entry path also has its own running guard.
    expect(dayViewSrc).toMatch(/entry\.endAt\s*==\s*null/);
  });

  it("primary routing decision is entry-driven (isJobLinkedLabor)", () => {
    // 2026-05-04 v4 fix: routing decision is `isJobLinkedLabor`
    // computed from entry.jobId/resolvedJobId + categoryForType.
    expect(dayViewSrc).toMatch(/isJobLinkedLabor/);
    expect(dayViewSrc).toMatch(/cat === "drive"\s*\|\|\s*cat === "onsite"/);
    // Combined editor opens via setEditingGroup; single-entry via
    // setEditingEntry. Both still present.
    expect(dayViewSrc).toMatch(/setEditingGroup\(/);
    expect(dayViewSrc).toMatch(/setEditingEntry\(entry\)/);
  });

  it("group-jobId fallback recovers when entry.jobId is null but visual group is job-linked", () => {
    // 2026-05-04 v4 hardening: defensive fallback. If entry.jobId is
    // null AND the entry's visual group has variant "job", use the
    // group's jobId for the session. Defends against time_entries.jobId
    // null-vs-jobs.* denormalised-fields-populated data inconsistency.
    expect(dayViewSrc).toMatch(/resolvedJobId/);
    expect(dayViewSrc).toMatch(/group\.variant === "job"/);
    expect(dayViewSrc).toMatch(/group\.jobId/);
    // The fallback is GUARDED on `!resolvedJobId` so it only fires
    // when the per-entry jobId is missing — not on every click.
    expect(dayViewSrc).toMatch(/!resolvedJobId/);
  });

  it("session entries are filtered against the resolved jobId", () => {
    // Combined editor receives a session built by filtering the day's
    // entries by `resolvedJobId` (which is `entry.jobId` in the normal
    // case, or the group's jobId in the fallback case).
    expect(dayViewSrc).toMatch(
      /entries\.filter\([\s\S]+?e\.jobId === resolvedJobId[\s\S]+?categoryForType\(e\.type\) === "drive"[\s\S]+?categoryForType\(e\.type\) === "onsite"/,
    );
  });

  it("emits a routing diagnostic on every edit click (DevTools observability)", () => {
    // Single console.debug per click surfaces the routing decision —
    // observable in DevTools. If this line doesn't print on click,
    // the deployed bundle is older than this commit and a hard-refresh
    // is needed (stale-bundle diagnosis).
    expect(dayViewSrc).toMatch(
      /console\.debug\(\s*"\[DayView routing v4\]"/,
    );
    expect(dayViewSrc).toMatch(/target:\s*isJobLinkedLabor/);
  });
});

// ── v4 polish (2026-05-04 part 4): Delete Session — explicit
//    confirm + parallel DELETE for represented rows only ───────────

describe("Day View v4 polish — Delete Session behavior", () => {
  it("combined editor button label is 'Delete Session' (not 'Delete')", () => {
    expect(sessionModalSrc).toMatch(/>\s*Delete Session\s*</);
    // The bare "Delete" label from the prior pass is gone — strip
    // comments to avoid matching the doc explanation.
    const codeOnly = sessionModalSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/>\s*Delete\s*</);
  });

  it("Delete Session button is hidden when any represented row is running", () => {
    // The modal computes anyRunning across drive + on-site bound rows
    // and renders a disabled-state caption ("Clock out before
    // deleting") instead of the destructive button.
    expect(sessionModalSrc).toMatch(/anyRunning/);
    expect(sessionModalSrc).toMatch(/Clock out before deleting/);
    expect(sessionModalSrc).toMatch(/data-testid="job-session-delete-disabled"/);
  });

  it("onDelete callback receives the list of represented row ids", () => {
    // Modal builds representedIds from driveEntry.id + onsiteEntry.id
    // (whichever exist) and passes them to the parent. The prior
    // signature was () => void and let DayView guess; this is the
    // contract change.
    expect(sessionModalSrc).toMatch(/representedIds:\s*string\[\]/);
    expect(sessionModalSrc).toMatch(/onDelete\(representedIds\)/);
  });

  it("DayView opens an explicit session-delete AlertDialog", () => {
    expect(dayViewSrc).toMatch(/data-testid="session-delete-confirm"/);
    expect(dayViewSrc).toMatch(
      /Delete this time session\?\s*This will delete the Drive\s*and On-site entries in this card\./,
    );
    expect(dayViewSrc).toMatch(/data-testid="session-delete-cancel"/);
    expect(dayViewSrc).toMatch(/data-testid="session-delete-confirm-action"/);
  });

  it("DayView dispatches DELETE in parallel for ONLY the represented row ids", () => {
    expect(dayViewSrc).toMatch(/sessionDeleteMutation/);
    // Promise.all over the representedIds list — never iterates over
    // the full group. Extras in the same group are NOT included.
    expect(dayViewSrc).toMatch(
      /representedIds\.map\(\(id\)\s*=>\s*[\s\S]+?method:\s*"DELETE"/,
    );
    expect(dayViewSrc).toMatch(/Promise\.all\(/);
    expect(dayViewSrc).toMatch(/\/api\/admin\/timesheets\/entries\/\$\{id\}/);
  });

  it("DayView re-checks running guard at the delete handler (defense-in-depth)", () => {
    // Even though the editor button hides for running groups, the
    // handler also short-circuits with a toast if any represented
    // row is in-progress.
    expect(dayViewSrc).toMatch(/Clock out before deleting/);
    expect(dayViewSrc).toMatch(
      /representedIds\.find\([\s\S]+?endAt\s*==\s*null/,
    );
  });

  it("Single-entry combined delete (drive-only or on-site-only group) still works", () => {
    // representedIds is built from `driveEntry?.id` + `onsiteEntry?.id`
    // — whichever exist. A group with only drive (or only on-site)
    // produces a single-id array and the same Delete Session flow.
    expect(sessionModalSrc).toMatch(
      /if \(driveEntry\?\.id\)\s*representedIds\.push\(driveEntry\.id\)/,
    );
    expect(sessionModalSrc).toMatch(
      /if \(onsiteEntry\?\.id\)\s*representedIds\.push\(onsiteEntry\.id\)/,
    );
  });

  it("does NOT route session-delete through the page-level single-entry confirm", () => {
    // The misleading prior path called `onRequestDelete(firstEntry.id, ...)`
    // from the session-delete handler — it now uses an explicit local
    // confirm. The single-entry editor's delete still uses
    // onRequestDelete (handleDeleteFromEditModal), which is correct;
    // the session handler must NOT.
    const sessionHandler = dayViewSrc.match(
      /handleDeleteFromSessionEditor[\s\S]+?\n  \};/,
    );
    expect(sessionHandler).not.toBeNull();
    expect(sessionHandler![0]).not.toMatch(/onRequestDelete\(/);
    expect(sessionHandler![0]).toMatch(/setSessionDeleteTarget\(/);
  });
});

// ── 2026-05-05: Unified Add Entry modal (JobSessionCreateModal) ────

describe("Add Entry modal — JobSessionCreateModal (compact v2)", () => {
  it("Add Entry button opens the modal (not an inline editor)", () => {
    expect(dayViewSrc).not.toMatch(/<TimeEntryEditor/);
    expect(dayViewSrc).toMatch(/<JobSessionCreateModal/);
    expect(dayViewSrc).toMatch(/setCreateOpen\(true\)/);
    expect(dayViewSrc).toMatch(/data-testid="day-add-entry"/);
  });

  it("4-mode pill selector is gone (removed in v2)", () => {
    // The old `<button data-testid="create-mode-...">` block and the
    // `CreateMode` union are out of the source. Strip comments before
    // the negative pin so doc commentary that explains the removal
    // doesn't false-match.
    const codeOnly = createModalSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/data-testid="create-mode-selector"/);
    expect(codeOnly).not.toMatch(/data-testid=\{`create-mode-/);
    expect(codeOnly).not.toMatch(/CreateMode\b/);
  });

  it("renders compact Drive AND On-site rows in the labor view", () => {
    // Two CompactRow mounts in the labor branch — drive + onsite.
    expect(createModalSrc).toMatch(/rowKey="drive"/);
    expect(createModalSrc).toMatch(/rowKey="onsite"/);
    expect(createModalSrc).toMatch(/rowLabel="Drive"/);
    expect(createModalSrc).toMatch(/rowLabel="On-site"/);
    // Each row marked optional in its label strip.
    expect(createModalSrc).toMatch(/\(optional\)/);
  });

  it("Drive-only fill saves ONE drive POST (other rows skipped)", () => {
    // The save mutation pushes a section ONLY when `rowIsComplete(...)`.
    expect(createModalSrc).toMatch(
      /if\s*\(rowIsComplete\(drive\)\)\s*\{[\s\S]+?type:\s*"travel_to_job"/,
    );
  });

  it("On-site-only fill saves ONE on-site POST (other rows skipped)", () => {
    expect(createModalSrc).toMatch(
      /if\s*\(rowIsComplete\(onsite\)\)\s*\{[\s\S]+?type:\s*"on_site"/,
    );
  });

  it("Drive + On-site filled saves TWO POSTs in parallel", () => {
    // Both sections push; Promise.all dispatches in parallel.
    expect(createModalSrc).toMatch(/Promise\.all\(/);
    expect(createModalSrc).toMatch(/type:\s*"travel_to_job"/);
    expect(createModalSrc).toMatch(/type:\s*"on_site"/);
  });

  it("empty modal cannot save (validation rejects)", () => {
    expect(createModalSrc).toMatch(/Fill Drive or On-site time to save/);
    expect(createModalSrc).toMatch(/Fill General time to save/);
  });

  it("General view stays available as a secondary toggle", () => {
    // Switch links between labor / general views.
    expect(createModalSrc).toMatch(/data-testid="create-switch-general"/);
    expect(createModalSrc).toMatch(/data-testid="create-switch-labor"/);
    expect(createModalSrc).toMatch(/Add general time instead/);
    expect(createModalSrc).toMatch(/Back to job time/);
    // General save dispatches a single "other" POST with no jobId.
    expect(createModalSrc).toMatch(
      /rowIsComplete\(general\)[\s\S]+?type:\s*"other"[\s\S]+?jobId:\s*null/,
    );
  });

  it("Drive / On-site require a job once any time is entered", () => {
    expect(createModalSrc).toMatch(
      /\(rowIsComplete\(drive\)\s*\|\|\s*rowIsComplete\(onsite\)\)\s*&&\s*!jobId/,
    );
    expect(createModalSrc).toMatch(/Pick a job for Drive or On-site time/);
  });

  it("Notes default blank — no auto-fill placeholder", () => {
    expect(createModalSrc).toMatch(/setNotes\(""\)/);
    expect(createModalSrc).not.toMatch(/placeholder=["'`].*Visit\s*#/);
    expect(createModalSrc).not.toMatch(/placeholder=["'`].*en route/i);
    expect(createModalSrc).not.toMatch(/placeholder=["'`].*on site/i);
  });

  it("no Billable checkbox in the create modal", () => {
    const codeOnly = createModalSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/<Checkbox/);
    expect(codeOnly).not.toMatch(/import\s*\{[^}]*\bCheckbox\b/);
  });

  it("date is shown ONCE at the top, no per-row Start Date input", () => {
    // The friendly date appears once via `data-testid="create-date"`.
    expect(createModalSrc).toMatch(/data-testid="create-date"/);
    // Strip comments — the doc legitimately documents what's NOT here.
    const codeOnly = createModalSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/data-testid=\{`create-\$\{[^}]+\}-start-date`\}/);
    expect(codeOnly).not.toMatch(/Start Date/);
  });

  it("no 'End blank = running' hint and never creates running entries", () => {
    const codeOnly = createModalSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/blank = running/i);
    // Validator requires endTime — no nullable end-time creation path.
    expect(createModalSrc).toMatch(/needs a start and end time/);
  });

  it("duration sync: editing duration updates end time per row", () => {
    expect(createModalSrc).toMatch(/handleRowDurationChange/);
    // 2026-05-05 polish: handler now uses the shared addMinutesToTime
    // helper directly (HH:mm → HH:mm) instead of round-tripping
    // through ISO + date-fns. Cleaner; same semantics.
    expect(createModalSrc).toMatch(/addMinutesToTime\(prev\.startTime,\s*total\)/);
  });

  it("Day View invalidate keys are forwarded to the create modal", () => {
    expect(dayViewSrc).toMatch(/invalidateQueryKeys=\{invalidateQueryKeys\}/);
    expect(createModalSrc).toMatch(/invalidateQueryKeys/);
  });

  it("no spinner arrows on duration number inputs", () => {
    expect(createModalSrc).toMatch(/\[appearance:textfield\]/);
    expect(createModalSrc).toMatch(/webkit-inner-spin-button\]:appearance-none/);
  });

  it("modal max-width is in the 560–620px range (compact)", () => {
    expect(createModalSrc).toMatch(/max-w-\[6\d\dpx\]|max-w-\[57\dpx\]|max-w-\[58\dpx\]|max-w-\[59\dpx\]/);
  });
});

// ── 2026-05-05 input-speed polish: structured time inputs + autofill ─

import {
  addMinutesToTime,
  valueToSegments,
  segmentsToValue,
} from "../client/src/components/timesheets/timeParse";

describe("timeParse.addMinutesToTime", () => {
  it("adds minutes within the same day", () => {
    expect(addMinutesToTime("08:00", 60)).toBe("09:00");
    expect(addMinutesToTime("08:00", 30)).toBe("08:30");
    expect(addMinutesToTime("17:30", 45)).toBe("18:15");
  });

  it("wraps across midnight modulo 24h", () => {
    expect(addMinutesToTime("23:30", 60)).toBe("00:30");
    expect(addMinutesToTime("00:00", 0)).toBe("00:00");
  });
});

describe("timeParse.valueToSegments", () => {
  it("decomposes 24h values into 12h segments", () => {
    expect(valueToSegments("08:00")).toEqual({ h12: "8", min: "00", period: "AM" });
    expect(valueToSegments("08:30")).toEqual({ h12: "8", min: "30", period: "AM" });
    expect(valueToSegments("12:00")).toEqual({ h12: "12", min: "00", period: "PM" });
    expect(valueToSegments("13:30")).toEqual({ h12: "1", min: "30", period: "PM" });
    expect(valueToSegments("23:59")).toEqual({ h12: "11", min: "59", period: "PM" });
    expect(valueToSegments("00:00")).toEqual({ h12: "12", min: "00", period: "AM" });
  });

  it("returns blank-but-AM when input is empty / invalid", () => {
    expect(valueToSegments("")).toEqual({ h12: "", min: "", period: "AM" });
    expect(valueToSegments("not-a-time")).toEqual({ h12: "", min: "", period: "AM" });
  });
});

describe("timeParse.segmentsToValue", () => {
  it("recomposes 12h segments back into canonical 24h", () => {
    expect(segmentsToValue("8", "00", "AM")).toBe("08:00");
    expect(segmentsToValue("8", "30", "AM")).toBe("08:30");
    expect(segmentsToValue("12", "00", "PM")).toBe("12:00"); // noon
    expect(segmentsToValue("12", "00", "AM")).toBe("00:00"); // midnight
    expect(segmentsToValue("1", "30", "PM")).toBe("13:30");
    expect(segmentsToValue("11", "59", "PM")).toBe("23:59");
  });

  it("returns empty string when any segment is missing or out of range", () => {
    expect(segmentsToValue("", "00", "AM")).toBe("");
    expect(segmentsToValue("8", "", "AM")).toBe("");
    expect(segmentsToValue("13", "00", "AM")).toBe(""); // 12h cap
    expect(segmentsToValue("0", "00", "AM")).toBe("");  // 12h cap
    expect(segmentsToValue("8", "60", "AM")).toBe("");  // minute cap
  });
});

describe("Add Entry modal — segmented time inputs + autofill", () => {
  it("uses SegmentedTimeInput for Start AND End (no browser picker chrome)", () => {
    // 2026-05-05 (revision): browser type="time" replaced with three
    // direct H | M | AM/PM segments. No picker indicator, no popup,
    // no native dropdown.
    expect(createModalSrc).toMatch(/function\s+SegmentedTimeInput\s*\(/);
    expect(createModalSrc).toMatch(
      /<SegmentedTimeInput[\s\S]+?value=\{fields\.startTime\}/,
    );
    expect(createModalSrc).toMatch(
      /<SegmentedTimeInput[\s\S]+?value=\{fields\.endTime\}/,
    );
    // Strip comments before negative pins (doc commentary explains
    // the revert and would otherwise false-match).
    const codeOnly = createModalSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    // Browser time picker / its CSS hack are out.
    expect(codeOnly).not.toMatch(/<Input[^<>]*type="time"/);
    expect(codeOnly).not.toMatch(/calendar-picker-indicator/);
    // Free-text fallback subcomponent stays gone.
    expect(codeOnly).not.toMatch(/<TimeInput\b/);
    expect(codeOnly).not.toMatch(/placeholder=["'`]e\.g\./);
  });

  it("hour-first defaults: typing hour sets minute='00' and period='AM' if empty", () => {
    // The handleHourChange path commits with `min = segments.min || "00"`
    // and `period = segments.period || "AM"`. That's the spec rule.
    expect(createModalSrc).toMatch(
      /handleHourChange[\s\S]+?segments\.min\s*\|\|\s*"00"[\s\S]+?segments\.period\s*\|\|\s*"AM"/,
    );
  });

  it("minute and AM/PM remain independently editable after hour is set", () => {
    expect(createModalSrc).toMatch(/handleMinuteChange/);
    expect(createModalSrc).toMatch(/handlePeriodToggle/);
    // The period toggle is a button, not a dropdown.
    expect(createModalSrc).toMatch(
      /<button[\s\S]+?onClick=\{handlePeriodToggle\}/,
    );
    // Three sub-testids per input (hour, min, period) so downstream
    // UI tests can target each segment.
    expect(createModalSrc).toMatch(/-hour\b/);
    expect(createModalSrc).toMatch(/-min\b/);
    expect(createModalSrc).toMatch(/-period\b/);
  });

  it("auto-fills End = Start + 1h when Start changes and End is blank", () => {
    // Trigger condition documented inline in handleRowTimeChange.
    expect(createModalSrc).toMatch(
      /field === "startTime"\s*&&\s*value\s*&&\s*!prev\.endTime/,
    );
    expect(createModalSrc).toMatch(/addMinutesToTime\(value,\s*60\)/);
    // Duration sets to 1h 0m.
    expect(createModalSrc).toMatch(/hoursInput\s*=\s*"1"/);
    expect(createModalSrc).toMatch(/minutesInput\s*=\s*"0"/);
  });

  it("does NOT override a manually-set End — autofill predicate requires empty End", () => {
    // Predicate explicitly checks `!prev.endTime`. If End is set,
    // autofill skips and the user's value stays.
    expect(createModalSrc).toMatch(/!prev\.endTime/);
  });

  it("On-site row prefills from Drive End when On-site is empty (focus hook)", () => {
    expect(createModalSrc).toMatch(/handleOnsiteStartFocus/);
    // Predicate: skip if on-site already has any value, skip if drive
    // end is blank.
    expect(createModalSrc).toMatch(/if\s*\(rowHasAnyValue\(onsite\)\)\s*return/);
    expect(createModalSrc).toMatch(/if\s*\(!drive\.endTime\)\s*return/);
    // Wired to the on-site row's start input.
    expect(createModalSrc).toMatch(
      /<CompactRow[\s\S]+?rowKey="onsite"[\s\S]+?onFocusStart=\{handleOnsiteStartFocus\}/,
    );
  });

  it("General row uses the same SegmentedTimeInput (uniform across all 3 rows)", () => {
    // CompactRow renders both Start and End via SegmentedTimeInput.
    // Since the General row uses the same CompactRow, it inherits
    // the same input UX automatically.
    expect(createModalSrc).toMatch(/rowKey="general"/);
    const segmentedMatches = createModalSrc.match(/<SegmentedTimeInput\b/g) ?? [];
    expect(segmentedMatches.length).toBeGreaterThanOrEqual(2);
    // No remaining browser-native time picker anywhere in the modal.
    const codeOnly = createModalSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/<Input[^<>]*type="time"/);
  });

  it("toggle ('Add general time instead' / 'Back to job time') is rendered as outline button", () => {
    // The small text link became an outline Button (more visible,
    // still secondary to Save).
    expect(createModalSrc).toMatch(
      /<Button[\s\S]+?variant="outline"[\s\S]+?data-testid="create-switch-general"/,
    );
    expect(createModalSrc).toMatch(
      /<Button[\s\S]+?variant="outline"[\s\S]+?data-testid="create-switch-labor"/,
    );
    // Visible labels unchanged.
    expect(createModalSrc).toMatch(/Add general time instead/);
    expect(createModalSrc).toMatch(/Back to job time/);
  });

  // Sentinel (placeholder). Replaced the prior TimeInput-draft test
  // since the custom input is gone; structured browser inputs don't
  // expose a draft model.
  it("modal source no longer references the removed TimeInput component", () => {
    // Strip comments so doc commentary about the revert doesn't false-match.
    const codeOnly = createModalSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/parseTimeInput/);
    expect(codeOnly).not.toMatch(/formatTimeDisplay/);
    expect(codeOnly).not.toMatch(/const \[focused, setFocused\]/);
    expect(codeOnly).not.toMatch(/const \[draft, setDraft\]/);
  });
});
