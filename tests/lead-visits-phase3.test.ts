/**
 * Lead Visits — Phase 3 polish (2026-05-05).
 *
 * Source pins for the dispatch UI integration, tech photo upload,
 * and lead-detail UX polish. No live-DB tests — Phase 2's
 * `tests/lead-visits.test.ts` already covers the storage + scoping
 * + dispatch query behavior. This file pins the FRONTEND surface
 * the polish PR introduced.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

function read(rel: string): string {
  return readFileSync(resolve(__dirname, "..", rel), "utf-8");
}

const dispatchDataCore = read(
  "client/src/components/dispatch/dispatchDataCore.ts",
);
const dispatchTypes = read(
  "client/src/components/dispatch/dispatchPreviewTypes.ts",
);
const dispatchPreview = read("client/src/pages/DispatchPreview.tsx");
const previewData = read(
  "client/src/components/dispatch/useDispatchPreviewData.ts",
);
const techLeadVisitDetail = read(
  "client/src/tech-app/pages/LeadVisitDetailPage.tsx",
);
const leadDetailPage = read("client/src/pages/LeadDetailPage.tsx");
// 2026-05-06 PR1: the right-rail "Details" card was extracted to a
// shared component used by both LeadDetailPage and the new /leads/new
// CreateLeadPage. The next-visit-row predicate moved with it.
const leadDetailsRail = read("client/src/components/leads/LeadDetailsRail.tsx");
const monthData = read(
  "client/src/components/dispatch/useDispatchMonthData.ts",
);
const weekData = read(
  "client/src/components/dispatch/useDispatchWeekData.ts",
);
const monthGrid = read(
  "client/src/components/dispatch/MonthDispatchGrid.tsx",
);
const weekGrid = read(
  "client/src/components/dispatch/WeekDispatchGrid.tsx",
);
const weekCell = read(
  "client/src/components/dispatch/WeekDispatchCell.tsx",
);

// ── Step 1: Dispatch UI integration ─────────────────────────────────

describe("Dispatch — lead visits merged client-side (no SQL UNION)", () => {
  it("DispatchLeadVisit type exists with type:'lead_visit' discriminator", () => {
    expect(dispatchTypes).toMatch(/export type DispatchLeadVisit/);
    expect(dispatchTypes).toMatch(/type:\s*"lead_visit"/);
  });

  it("dispatchDataCore fetches /api/calendar/lead-visits in parallel", () => {
    expect(dispatchDataCore).toMatch(
      /\/api\/calendar\/lead-visits\?start=\$\{encodeURIComponent\(startISO\)\}&end=\$\{encodeURIComponent\(endISO\)\}/,
    );
  });

  it("dispatchDataCore exposes leadVisits as a parallel array (not merged into scheduledVisits)", () => {
    expect(dispatchDataCore).toMatch(/leadVisits:\s*DispatchLeadVisit\[\]/);
    // The scheduled visits mapping must be unchanged — still maps from
    // events (jobs), not from a UNION-of-both source.
    expect(dispatchDataCore).toMatch(/events\.map\(mapEventToDispatchVisit\)/);
  });

  it("day-view consumer passes leadVisits through with day-key filtering", () => {
    expect(previewData).toMatch(/leadVisits:\s*DispatchLeadVisit\[\]/);
    expect(previewData).toMatch(/rangeData\.leadVisits/);
  });

  it("DispatchPreview renders LeadVisitsStrip on day view only", () => {
    expect(dispatchPreview).toMatch(/activeView === "day" && leadVisits\.length > 0/);
    expect(dispatchPreview).toMatch(/<LeadVisitsStrip/);
  });

  it("LeadVisitsStrip click handler routes to /leads/:leadId (not a job route)", () => {
    expect(dispatchPreview).toMatch(
      /onOpenLead=\{\(leadId\) =>\s*setLocation\(`\/leads\/\$\{leadId\}`\)\}/,
    );
  });

  it("LeadVisitsStrip branches on type === 'lead_visit' (the spec invariant)", () => {
    // Pin the early-return guard. This is the structural rule the
    // spec calls out — branch render rules MUST discriminate on the
    // `type` field. A future regression that drops this check would
    // let this test fail because the render path could otherwise
    // flow into job-shaped logic.
    expect(dispatchPreview).toMatch(/v\.type !== "lead_visit"/);
  });

  it("LEAD badge + amber tint applied to the strip", () => {
    expect(dispatchPreview).toMatch(/dispatch-lead-visits-strip/);
    expect(dispatchPreview).toMatch(/bg-amber-50/);
    expect(dispatchPreview).toMatch(/Lead/);
  });
});

// ── Phase 3 correction (2026-05-05): lead visits in ALL dispatch views ──
//
// The earlier Phase 3 only rendered lead visits in day view. The
// correction extends them to week and month so dispatchers see the
// same workload regardless of which view they're in. The tests below
// pin the structural invariants:
//   • Both data hooks expose a `leadVisitsByDay` map.
//   • Both grid components accept that map as a prop and branch-render
//     lead pills WITHOUT flowing through job-shaped logic.
//   • Click handlers route to /leads/:leadId, not to job routes.
//   • Lead pills NEVER read jobNumber/jobStatus/openSubStatus/version —
//     those fields don't exist on DispatchLeadVisit.

describe("Dispatch — lead visits render in week + month views", () => {
  it("useDispatchMonthData exposes leadVisitsByDay grouped by canonical day key", () => {
    expect(monthData).toMatch(/DispatchLeadVisit/);
    expect(monthData).toMatch(/const leadVisitsByDay = useMemo/);
    expect(monthData).toMatch(/rangeData\.leadVisits/);
    expect(monthData).toMatch(/getDispatchDayKey\(v\.scheduledStart, v\.isAllDay\)/);
    expect(monthData).toMatch(/leadVisitsByDay,/);
  });

  it("useDispatchWeekData exposes leadVisitsByDay grouped by canonical day key", () => {
    expect(weekData).toMatch(/DispatchLeadVisit/);
    expect(weekData).toMatch(/const leadVisitsByDay = useMemo/);
    expect(weekData).toMatch(/rangeData\.leadVisits/);
    expect(weekData).toMatch(/getDispatchDayKey\(v\.scheduledStart, v\.isAllDay\)/);
    expect(weekData).toMatch(/leadVisitsByDay,/);
  });

  it("MonthDispatchGrid accepts leadVisitsByDay + onOpenLead and branch-renders", () => {
    expect(monthGrid).toMatch(/leadVisitsByDay:\s*Map<string, DispatchLeadVisit\[\]>/);
    expect(monthGrid).toMatch(/onOpenLead:\s*\(leadId: string\) => void/);
    // Branch render via a discriminated union — lead items must NEVER
    // flow through VisitCardContent / job color logic.
    expect(monthGrid).toMatch(/item\.kind === "lead"/);
    expect(monthGrid).toMatch(/MonthLeadVisitPill/);
  });

  it("MonthDispatchGrid lead pill: amber styling, Lead badge, click routes to /leads/:id", () => {
    expect(monthGrid).toMatch(/bg-amber-50/);
    expect(monthGrid).toMatch(/onOpenLead\(leadVisit\.leadId\)/);
    // Lead pill MUST NOT read job-only fields. These regexes search
    // the file for any access to job-shaped keys on a lead carrier;
    // none should exist.
    expect(monthGrid).not.toMatch(/leadVisit\.jobNumber/);
    expect(monthGrid).not.toMatch(/leadVisit\.jobStatus/);
    expect(monthGrid).not.toMatch(/leadVisit\.jobOpenSubStatus/);
  });

  it("MonthDispatchGrid counts lead visits in the same MAX_MONTH_CELL_ITEMS overflow as jobs", () => {
    // Items array combines visits + leadVisits then slices to
    // MAX_MONTH_CELL_ITEMS. The overflow count must be `items.length`,
    // not `visits.length` — otherwise lead visits drop silently.
    expect(monthGrid).toMatch(/buildCellItems\(/);
    expect(monthGrid).toMatch(/items\.length > MAX_MONTH_CELL_ITEMS/);
    expect(monthGrid).toMatch(/items\.length - MAX_MONTH_CELL_ITEMS/);
  });

  it("WeekDispatchGrid accepts leadVisitsByDay + onOpenLead and forwards to WeekDayColumn", () => {
    expect(weekGrid).toMatch(/leadVisitsByDay:\s*Map<string, DispatchLeadVisit\[\]>/);
    expect(weekGrid).toMatch(/onOpenLead:\s*\(leadId: string\) => void/);
    expect(weekGrid).toMatch(/leadVisits=\{leadVisitsByDay\.get\(dayKey\)/);
    expect(weekGrid).toMatch(/onOpenLead=\{onOpenLead\}/);
  });

  it("WeekDispatchCell renders lead-visit blocks branched on type === 'lead_visit'", () => {
    expect(weekCell).toMatch(/leadVisits:\s*DispatchLeadVisit\[\]/);
    // The structural branch guard the spec requires: lead-visit items
    // must be discriminated on the `type` field before render.
    expect(weekCell).toMatch(/lv\.type !== "lead_visit"/);
    expect(weekCell).toMatch(/WeekCalendarLeadVisitBlock/);
  });

  it("WeekDispatchCell lead block: amber styling, no jobNumber/jobStatus access", () => {
    expect(weekCell).toMatch(/bg-amber-50/);
    expect(weekCell).toMatch(/onOpenLead\(leadVisit\.leadId\)/);
    expect(weekCell).not.toMatch(/leadVisit\.jobNumber/);
    expect(weekCell).not.toMatch(/leadVisit\.jobStatus/);
    expect(weekCell).not.toMatch(/leadVisit\.jobOpenSubStatus/);
    expect(weekCell).not.toMatch(/leadVisit\.version/);
  });

  it("WeekDispatchCell positions lead visits in the same overlap layout as jobs (no visual collision)", () => {
    // Lead visits must join the same `allRanges` array fed to
    // computeOverlapLayout so they get a side-by-side column when
    // their slot overlaps a job.
    expect(weekCell).toMatch(/kind:\s*"lead"/);
    expect(weekCell).toMatch(/leadVisitPositions/);
  });

  it("DispatchPreview wires monthData.leadVisitsByDay + weekData.leadVisitsByDay through to the grids", () => {
    expect(dispatchPreview).toMatch(/leadVisitsByDay=\{monthData\.leadVisitsByDay\}/);
    expect(dispatchPreview).toMatch(/leadVisitsByDay=\{weekData\.leadVisitsByDay\}/);
    // Both grids get the same /leads/:id click handler — never a job route.
    const leadRouteMatches = dispatchPreview.match(
      /onOpenLead=\{\(leadId\) =>\s*setLocation\(`\/leads\/\$\{leadId\}`\)\}/g,
    );
    expect(leadRouteMatches).not.toBeNull();
    expect(leadRouteMatches!.length).toBeGreaterThanOrEqual(3); // day strip + week + month
  });
});

// ── Step 2: Tech photo upload ───────────────────────────────────────

describe("Tech LeadVisitDetailPage — canonical photo upload", () => {
  it("imports useFileUpload + validateFileClientSide from the canonical hook", () => {
    expect(techLeadVisitDetail).toMatch(
      /from\s+["']@\/hooks\/useFileUpload["']/,
    );
    expect(techLeadVisitDetail).toMatch(/useFileUpload/);
    expect(techLeadVisitDetail).toMatch(/validateFileClientSide/);
  });

  it("uses FileEntityType='lead_note' (no new upload flow)", () => {
    expect(techLeadVisitDetail).toMatch(/entityType:\s*"lead_note"/);
  });

  it("creates the note FIRST, then uploads each photo bound to noteId", () => {
    // Pin the canonical sequence: POST note → for each staged file,
    // upload(file, { entityType: 'lead_note', entityId: note.id }).
    expect(techLeadVisitDetail).toMatch(
      /\/api\/tech\/lead-visits\/\$\{visitId\}\/notes/,
    );
    expect(techLeadVisitDetail).toMatch(/entityId:\s*note\.id/);
  });

  it("renders the staged-photos preview strip + Attach photo button", () => {
    expect(techLeadVisitDetail).toMatch(
      /data-testid="tech-lead-note-staged-photos"/,
    );
    expect(techLeadVisitDetail).toMatch(
      /data-testid="button-tech-attach-photo"/,
    );
  });

  it("renders saved attachments via NoteThumb on each note row", () => {
    expect(techLeadVisitDetail).toMatch(/<NoteThumb /);
    expect(techLeadVisitDetail).toMatch(
      /data-testid=\{`tech-lead-note-attachments-\$\{n\.id\}`\}/,
    );
  });
});

// ── Step 3: Tech completion UX ──────────────────────────────────────

describe("Tech completion — empty-notes warning + redirect to Today", () => {
  it("shows non-blocking warning when completing with no notes / no outcome", () => {
    expect(techLeadVisitDetail).toMatch(
      /data-testid="tech-lead-complete-empty-warning"/,
    );
    expect(techLeadVisitDetail).toMatch(
      /notes\.length === 0 && !outcomeDraft\.trim\(\)/,
    );
  });

  it("redirects to /tech/today after completion", () => {
    expect(techLeadVisitDetail).toMatch(/setLocation\("\/tech\/today"\)/);
  });
});

// ── Step 4: Lead detail UX polish ───────────────────────────────────

describe("LeadDetailPage — next-visit summary instead of static Assigned To", () => {
  it("fetches the lead-visits feed for next-visit metadata", () => {
    expect(leadDetailPage).toMatch(
      /\["\/api\/leads",\s*leadId,\s*"visits"\]/,
    );
    expect(leadDetailPage).toMatch(/\/api\/leads\/\$\{leadId\}\/visits/);
  });

  it("derives nextUpcomingVisit from scheduled+future visits sorted by start", () => {
    expect(leadDetailPage).toMatch(/nextUpcomingVisit/);
    expect(leadDetailPage).toMatch(
      /v\.status === "scheduled" \|\| v\.status === "in_progress"/,
    );
  });

  it("hides the Next Visit Assignee row entirely when no visits exist", () => {
    // 2026-05-06 PR1: the row predicate moved from inline JSX in
    // LeadDetailPage to the shared LeadDetailsRail component. The
    // gating is now expressed as `hasVisits && nextVisit` /
    // `hasVisits && !nextVisit` against the rail's saved-mode props,
    // and LeadDetailPage passes `hasVisits={leadVisits.length > 0}`.
    expect(leadDetailPage).toMatch(/hasVisits=\{leadVisits\.length > 0\}/);
    expect(leadDetailsRail).toMatch(/hasVisits\s*&&\s*nextVisit/);
    expect(leadDetailsRail).toMatch(/hasVisits\s*&&\s*!nextVisit/);
  });
});
