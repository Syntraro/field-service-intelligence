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
const leadVisitsTechSrc = read("server/routes/leadVisitsTech.ts");
const addEquipmentDialogSrc = read("client/src/components/AddEquipmentDialog.tsx");
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

  it("DispatchPreview renders LeadVisitsStrip on day view only (overflow surface)", () => {
    // Strip is now filtered to unassigned/unscheduled overflow only —
    // assigned+scheduled lead visits are routed to technician lanes instead.
    expect(dispatchPreview).toMatch(/activeView === "day"/);
    expect(dispatchPreview).toMatch(/<LeadVisitsStrip/);
    // Strip receives filtered visits, not the raw leadVisits array.
    expect(dispatchPreview).toMatch(
      /lv\.technicianIds\.length === 0 \|\| !lv\.scheduledStart/,
    );
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

// ── Step 4 (Phase 4, 2026-05-13): Salesperson-enriched lead visit ────
//
// Pins the structural invariants introduced in the salesperson-mode
// enhancement: role-gated DTO enrichment, canConvert logic, UI mode
// branch, canonical drift fixes, and the ProtectedRoute correction
// that allows dispatcher/manager to reach CreateQuotePage.

const techLeadVisitServer = read("server/routes/leadVisitsTech.ts");
const appShell = read("client/src/App.tsx");

describe("Phase 4 — server DTO gating", () => {
  it("TechLeadVisitDto declares optional enriched fields", () => {
    expect(techLeadVisitServer).toMatch(/canConvert\?:\s*boolean/);
    expect(techLeadVisitServer).toMatch(/leadDescription\?:/);
    expect(techLeadVisitServer).toMatch(/estimatedValue\?:/);
    expect(techLeadVisitServer).toMatch(/priority\?:/);
    expect(techLeadVisitServer).toMatch(/leadStatus\?:/);
    expect(techLeadVisitServer).toMatch(/customerCompanyName\?:/);
    expect(techLeadVisitServer).toMatch(/convertedQuoteId\?:/);
    expect(techLeadVisitServer).toMatch(/locationId\?:/);
  });

  it("toDto branches on MANAGER_ROLES — enriched fields only when role matches", () => {
    expect(techLeadVisitServer).toMatch(/MANAGER_ROLES.*includes\(userRole\)/);
    // The enriched block must be inside the role-guard branch.
    expect(techLeadVisitServer).toMatch(/if\s*\(userRole.*MANAGER_ROLES/);
  });

  it("canConvert is false when visit is completed", () => {
    // The canConvert computation must guard on visitStatus !== 'completed'.
    expect(techLeadVisitServer).toMatch(/visitStatus\s*!==\s*"completed"/);
  });

  it("canConvert is false when visit is cancelled", () => {
    expect(techLeadVisitServer).toMatch(/visitStatus\s*!==\s*"cancelled"/);
  });

  it("canConvert is false when lead is already converted", () => {
    expect(techLeadVisitServer).toMatch(/!row\.leadConvertedQuoteId/);
  });

  it("fetchLeadVisitDtoById accepts userRole parameter", () => {
    expect(techLeadVisitServer).toMatch(
      /fetchLeadVisitDtoById\(\s*\n?\s*companyId[^)]*userRole\?/,
    );
  });

  it("fetchLeadVisitDtoById joins customerCompanies via left join", () => {
    expect(techLeadVisitServer).toMatch(/leftJoin\s*\(\s*\n?\s*customerCompanies/);
    expect(techLeadVisitServer).toMatch(/customerCompanies\.id.*leads\.customerCompanyId/);
  });

  it("GET /:visitId passes user.role to fetchLeadVisitDtoById", () => {
    expect(techLeadVisitServer).toMatch(
      /fetchLeadVisitDtoById\(companyId,\s*visitId,\s*user\.role/,
    );
  });

  it("POST /:visitId/complete also passes user.role to fetchLeadVisitDtoById", () => {
    // The complete endpoint re-fetches the DTO; must also be role-aware.
    const completeFetch = techLeadVisitServer.match(
      /fetchLeadVisitDtoById\(companyId,\s*visitId,\s*user\.role[^)]*\)/g,
    );
    expect(completeFetch).not.toBeNull();
    expect(completeFetch!.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Phase 4 — client UI salesperson mode", () => {
  it("TechLeadVisitDetail interface declares optional enriched fields", () => {
    expect(techLeadVisitDetail).toMatch(/canConvert\?:\s*boolean/);
    expect(techLeadVisitDetail).toMatch(/leadDescription\?:/);
    expect(techLeadVisitDetail).toMatch(/estimatedValue\?:/);
    expect(techLeadVisitDetail).toMatch(/leadStatus\?:/);
    expect(techLeadVisitDetail).toMatch(/customerCompanyName\?:/);
  });

  it("Create Quote button is gated on visit.canConvert (not always shown)", () => {
    expect(techLeadVisitDetail).toMatch(/visit\.canConvert/);
    expect(techLeadVisitDetail).toMatch(/data-testid="button-tech-create-quote"/);
  });

  it("Create Quote button navigates to /quotes/new?leadId=", () => {
    expect(techLeadVisitDetail).toMatch(
      /\/quotes\/new\?leadId=\$\{visit\.leadId\}/,
    );
  });

  it("Create Quote button is NOT shown when canConvert is absent (technician view)", () => {
    // The gate must be `visit.canConvert` (undefined is falsy) so
    // technicians, who receive no canConvert field, never see the button.
    expect(techLeadVisitDetail).toMatch(/\{visit\.canConvert\s*&&/);
  });

  it("enriched sales info section is gated on presence of enriched fields", () => {
    expect(techLeadVisitDetail).toMatch(/data-testid="lead-visit-sales-info"/);
    // Guard expression must check for non-null enriched fields.
    expect(techLeadVisitDetail).toMatch(/visit\.customerCompanyName\s*!=\s*null/);
  });
});

describe("Phase 4 — canonical drift fixes", () => {
  it("uses AlertDialog for completion confirm (not raw Dialog)", () => {
    expect(techLeadVisitDetail).toMatch(/AlertDialog/);
    expect(techLeadVisitDetail).toMatch(/AlertDialogContent/);
    expect(techLeadVisitDetail).toMatch(/AlertDialogTitle/);
    expect(techLeadVisitDetail).toMatch(/AlertDialogCancel/);
    // Confirm raw Dialog primitives are no longer present.
    expect(techLeadVisitDetail).not.toMatch(
      /from\s+["']@\/components\/ui\/dialog["']/,
    );
  });

  it("uses canonical Chip for Lead visit badge (not ad-hoc amber span)", () => {
    expect(techLeadVisitDetail).toMatch(/<Chip\s+tone="warning"/);
    // Ad-hoc pattern must be gone.
    expect(techLeadVisitDetail).not.toMatch(/bg-amber-100.*text-amber-700/);
  });

  it("uses SectionLabel for card headers (not ad-hoc text-[10px] spans)", () => {
    expect(techLeadVisitDetail).toMatch(/<SectionLabel/);
    // The old ad-hoc pattern must not remain for section labels.
    expect(techLeadVisitDetail).not.toMatch(
      /text-\[10px\].*uppercase tracking-wider/,
    );
  });

  it("imports Chip and SectionLabel from canonical paths", () => {
    expect(techLeadVisitDetail).toMatch(
      /from\s+["']@\/components\/ui\/chip["']/,
    );
    expect(techLeadVisitDetail).toMatch(
      /from\s+["']@\/components\/ui\/typography["']/,
    );
  });
});

describe("Phase 4 — ProtectedRoute gate for /quotes/new", () => {
  it("/quotes/new uses requireManager (allows dispatcher + manager)", () => {
    // The route must be gated by requireManager, not requireAdmin.
    // This allows dispatcher/manager to access CreateQuotePage from
    // the tech lead visit detail "Create Quote" button.
    expect(appShell).toMatch(
      /path="\/quotes\/new"[\s\S]{0,200}requireManager/,
    );
  });

  it("/quotes/new does NOT use requireAdmin", () => {
    // Verify the old over-restrictive gate is removed. Extract only
    // the /quotes/new Route block (up to its closing </Route> tag) so
    // we don't accidentally match the adjacent /quotes/:id Route which
    // legitimately retains requireAdmin.
    const quotesNewBlock = appShell.match(
      /path="\/quotes\/new"[\s\S]*?<\/Route>/,
    );
    expect(quotesNewBlock).not.toBeNull();
    expect(quotesNewBlock![0]).not.toMatch(/requireAdmin/);
  });
});

// ── Phase 2 (2026-05-13): equipment context on enriched lead visit ───
//
// Pins the read-only "Equipment at this location" section added for
// salesperson/dispatcher/manager/admin/owner users. The section is
// gated on locationId (enriched mode only) and relies entirely on
// the existing /api/tech/locations/:locationId/equipment endpoint for
// both data and authorization.

const techLocationsRoutesSrc = read("server/routes/techLocations.ts");
const techLocationAccessSrc = read("server/auth/techLocationAccess.ts");

describe("Phase 2 — equipment context on enriched lead visit", () => {
  it("equipment query is enabled only when locationId is present", () => {
    expect(techLeadVisitDetail).toMatch(/enabled:\s*!!visit\?\.locationId/);
  });

  it("equipment section is gated on visit.locationId (enriched mode only)", () => {
    expect(techLeadVisitDetail).toMatch(
      /visit\.locationId\s*&&[\s\S]{0,200}lead-visit-equipment-section/,
    );
  });

  it("equipment query calls GET /api/tech/locations/:locationId/equipment", () => {
    expect(techLeadVisitDetail).toMatch(
      /\/api\/tech\/locations\/\$\{.*locationId.*\}\/equipment/,
    );
  });

  it("equipment rows are read-only (no edit or delete controls)", () => {
    expect(techLeadVisitDetail).toMatch(/data-testid="lead-visit-equipment-list"/);
    expect(techLeadVisitDetail).not.toMatch(/data-testid="button-edit-equipment"/);
    expect(techLeadVisitDetail).not.toMatch(/data-testid="button-delete-equipment"/);
  });

  it("empty state renders when endpoint returns []", () => {
    expect(techLeadVisitDetail).toMatch(/data-testid="lead-visit-equipment-empty"/);
    expect(techLeadVisitDetail).toMatch(
      /No equipment recorded for this location/,
    );
  });

  it("loading state is inline (not full-page blocking)", () => {
    expect(techLeadVisitDetail).toMatch(/data-testid="lead-visit-equipment-loading"/);
    // Loading state must not trigger the full-page MobileShell spinner.
    // The existing full-page spinner is gated on `isLoading` (the visit query),
    // not on equipmentLoading — this regex must not match.
    expect(techLeadVisitDetail).not.toMatch(
      /equipmentLoading[\s\S]{0,80}<MobileShell/,
    );
  });

  it("error state renders inline without breaking the page", () => {
    expect(techLeadVisitDetail).toMatch(/data-testid="lead-visit-equipment-error"/);
    // Inline error — must not propagate to a full-page error block.
    expect(techLeadVisitDetail).not.toMatch(
      /equipmentError[\s\S]{0,80}isError \|\| !visit/,
    );
  });

  it("equipment section is absent when locationId is falsy (technician view)", () => {
    // The gate `visit.locationId &&` is falsy for technicians (locationId absent).
    // Confirm the gate expression is present and not inverted.
    expect(techLeadVisitDetail).not.toMatch(
      /!visit\.locationId[\s\S]{0,60}lead-visit-equipment-section/,
    );
  });

  it("security: endpoint applies assertCanAccessTechLocation for all requests", () => {
    // The equipment route reuses the same access-control gate as other
    // tech location routes — no new bypass was introduced.
    expect(techLocationsRoutesSrc).toMatch(
      /router\.get\(\s*["']\/locations\/:locationId\/equipment["']/,
    );
    const matches = techLocationsRoutesSrc.match(
      /assertCanAccessTechLocation\(/g,
    );
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("security: dispatcher without assignment is denied by assertCanAccessTechLocation", () => {
    // assertCanAccessTechLocation denies dispatchers who lack an active
    // job-visit assignment at the location (same scope as technicians).
    // This is covered by the live-DB test in tech-locations-routes.test.ts;
    // we pin the source invariant here.
    expect(techLocationAccessSrc).toMatch(/dispatcher/i);
  });
});

// ── Step 4: Lead detail UX polish ───────────────────────────────────

// ── Phase 3: add discovered equipment from lead visit ────────────────

describe("add equipment from lead visit — backend source pins", () => {
  it("POST /:visitId/location-equipment route is declared", () => {
    expect(leadVisitsTechSrc).toMatch(
      /router\.post\(\s*["']\/:visitId\/location-equipment["']/,
    );
  });

  it("handler calls assertCanAccessLeadVisit", () => {
    // Ensure the equipment handler is behind the same visit-scoped gate
    // as /complete and /notes — not a raw ownership bypass.
    const matches = leadVisitsTechSrc.match(/assertCanAccessLeadVisit\(/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("handler derives locationId from leads table via leadId — not from req.body", () => {
    expect(leadVisitsTechSrc).toMatch(/leads\.locationId/);
    expect(leadVisitsTechSrc).toMatch(/eq\(leads\.id,\s*visit\.leadId\)/);
    // companyId filter on the leads query prevents cross-tenant traversal.
    expect(leadVisitsTechSrc).toMatch(/eq\(leads\.companyId,\s*companyId\)/);
  });

  it("handler does NOT read req.body.locationId", () => {
    // locationId must never come from the client on this endpoint.
    const bodyLines = leadVisitsTechSrc
      .split("\n")
      .filter((l) => l.includes("req.body") && l.includes("locationId"));
    expect(bodyLines).toHaveLength(0);
  });

  it("handler calls storage.createLocationEquipment", () => {
    expect(leadVisitsTechSrc).toMatch(/storage\.createLocationEquipment\(/);
  });

  it("handler does NOT create job_equipment or emit job dispatch event", () => {
    // Equipment belongs to location_equipment only — no job link row.
    expect(leadVisitsTechSrc).not.toMatch(/createJobEquipment/);
    expect(leadVisitsTechSrc).not.toMatch(/dispatchEquipment|emitDispatch/);
  });

  it("response shape matches GET /api/tech/locations/:id/equipment DTO", () => {
    // Confirm the handler maps the same field renames used by the GET endpoint.
    expect(leadVisitsTechSrc).toMatch(/type:\s*created\.equipmentType/);
    expect(leadVisitsTechSrc).toMatch(/model:\s*created\.modelNumber/);
    expect(leadVisitsTechSrc).toMatch(/installedAt:\s*created\.installDate/);
  });

  it("missing name returns 400 via Zod parse (min 1)", () => {
    // The schema enforces name min(1) — Zod throws ZodError which the
    // asyncHandler converts to a 400 via the canonical error middleware.
    expect(leadVisitsTechSrc).toMatch(/name:\s*z\.string\(\)\.min\(1\)/);
  });
});

describe("add equipment from lead visit — frontend source pins", () => {
  it("Add Equipment button is inside the equipment card", () => {
    expect(techLeadVisitDetail).toMatch(
      /data-testid="button-lead-visit-add-equipment"/,
    );
  });

  it("Add Equipment button is absent outside the visit.locationId gate", () => {
    // The equipment section — and the button inside it — is gated on
    // `visit.locationId &&`, so technicians who receive no locationId never
    // see it.
    expect(techLeadVisitDetail).toMatch(
      /visit\.locationId\s*&&[\s\S]{0,600}button-lead-visit-add-equipment/,
    );
  });

  it("AddEquipmentDialog is imported and rendered on the page", () => {
    expect(techLeadVisitDetail).toMatch(/import.*AddEquipmentDialog/);
    expect(techLeadVisitDetail).toMatch(/<AddEquipmentDialog/);
  });

  it("dialog uses createUrl pointed at the lead-visit equipment endpoint", () => {
    expect(techLeadVisitDetail).toMatch(
      /createUrl=\{`\/api\/tech\/lead-visits\/\$\{visitId\}\/location-equipment`\}/,
    );
  });

  it("onCreated invalidates the tech locations equipment query", () => {
    expect(techLeadVisitDetail).toMatch(
      /\/api\/tech\/locations.*equipment[\s\S]{0,100}invalidateQueries|invalidateQueries[\s\S]{0,200}\/api\/tech\/locations.*equipment/,
    );
  });

  it("existing read-only equipment list still renders unchanged", () => {
    expect(techLeadVisitDetail).toMatch(/data-testid="lead-visit-equipment-list"/);
    expect(techLeadVisitDetail).toMatch(/data-testid="lead-visit-equipment-empty"/);
    expect(techLeadVisitDetail).toMatch(/data-testid="lead-visit-equipment-loading"/);
  });
});

describe("AddEquipmentDialog — createUrl override", () => {
  it("accepts a createUrl prop", () => {
    expect(addEquipmentDialogSrc).toMatch(/createUrl\?\s*:\s*string/);
  });

  it("uses createUrl in the POST mutation when provided", () => {
    expect(addEquipmentDialogSrc).toMatch(
      /createUrl\s*\?\?\s*`\/api\/clients\/\$\{locationId\}\/equipment`/,
    );
  });

  it("edit mode PATCH URL is unchanged by createUrl", () => {
    // createUrl only affects create-mode POSTs.
    expect(addEquipmentDialogSrc).toMatch(
      /\/api\/clients\/\$\{locationId\}\/equipment\/\$\{existingEquipment\.id\}/,
    );
  });
});

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
