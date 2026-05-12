/**
 * Lead visit day-view dispatch placement — source-pin guard (2026-05-12).
 *
 * Verifies that assigned + scheduled lead visits are threaded into
 * the canonical DispatchTimeline / DispatchLaneRow architecture and
 * rendered via DispatchLeadVisitBlock at the correct technician row,
 * while the LeadVisitsStrip receives only unassigned / unscheduled
 * overflow visits.
 *
 * These are structural source-pin tests — they read the source files
 * directly and assert the canonical integration points are present.
 * They fail fast if a future change accidentally reverts the placement.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

function read(rel: string): string {
  return readFileSync(resolve(__dirname, "..", rel), "utf-8");
}

const utils = read("client/src/components/dispatch/dispatchPreviewUtils.ts");
const laneRow = read("client/src/components/dispatch/DispatchLaneRow.tsx");
const timeline = read("client/src/components/dispatch/DispatchTimeline.tsx");
const preview = read("client/src/pages/DispatchPreview.tsx");
const leadBlock = read("client/src/components/dispatch/DispatchLeadVisitBlock.tsx");

// ── dispatchPreviewUtils ──────────────────────────────────────────────

describe("dispatchPreviewUtils — getLeadVisitPosition", () => {
  it("exports getLeadVisitPosition", () => {
    expect(utils).toMatch(/export function getLeadVisitPosition/);
  });

  it("accepts DispatchLeadVisit and has a null scheduledStart guard", () => {
    expect(utils).toMatch(/if \(!lead\.scheduledStart\) return null/);
  });

  it("defaults null durationMinutes to 30 min", () => {
    // The ?? 30 guard prevents NaN width when durationMinutes is null.
    expect(utils).toMatch(/lead\.durationMinutes \?\? 30/);
  });

  it("returns an object with left and width", () => {
    expect(utils).toMatch(/return \{ left, width \}/);
  });

  it("imports DispatchLeadVisit type", () => {
    expect(utils).toMatch(/DispatchLeadVisit/);
  });
});

// ── DispatchLeadVisitBlock ────────────────────────────────────────────

describe("DispatchLeadVisitBlock — read-only block invariants", () => {
  it("sets data-dispatch-block='lead' so lane empty-slot click suppression works", () => {
    expect(leadBlock).toMatch(/data-dispatch-block="lead"/);
  });

  it("does NOT import useDraggable (must stay read-only)", () => {
    expect(leadBlock).not.toMatch(/useDraggable/);
  });

  it("does NOT reference jobNumber, jobId, version, or priority", () => {
    expect(leadBlock).not.toMatch(/jobNumber/);
    expect(leadBlock).not.toMatch(/jobId/);
    expect(leadBlock).not.toMatch(/\bversion\b/);
    expect(leadBlock).not.toMatch(/\bpriority\b/);
  });

  it("calls onSelect with the lead on click", () => {
    expect(leadBlock).toMatch(/onSelect\?\.\(lead\)/);
  });

  it("uses amber styling consistent with the lead visit strip", () => {
    expect(leadBlock).toMatch(/border-amber-400/);
    expect(leadBlock).toMatch(/bg-amber-50/);
  });
});

// ── DispatchLaneRow ───────────────────────────────────────────────────

describe("DispatchLaneRow — additive lead visit props", () => {
  it("declares leadVisits?: DispatchLeadVisit[] in Props", () => {
    expect(laneRow).toMatch(/leadVisits\?:\s*DispatchLeadVisit\[\]/);
  });

  it("declares onSelectLeadVisit? in Props", () => {
    expect(laneRow).toMatch(/onSelectLeadVisit\?:/);
  });

  it("computes timedLeads filtered to scheduled non-allDay visits", () => {
    expect(laneRow).toMatch(/timedLeads/);
    expect(laneRow).toMatch(/lv\.isAllDay/);
    expect(laneRow).toMatch(/lv\.scheduledStart/);
  });

  it("includes timedLeads in the conflictIds memo", () => {
    expect(laneRow).toMatch(/for \(const lv of timedLeads\)/);
  });

  it("guards null durationMinutes with ?? 30 before conflict arithmetic", () => {
    expect(laneRow).toMatch(/lv\.durationMinutes \?\? 30/);
  });

  it("includes timedLeads in the occupancy rail", () => {
    expect(laneRow).toMatch(/getLeadVisitPosition\(lv,/);
    expect(laneRow).toMatch(/type: "lead"/);
  });

  it("renders DispatchLeadVisitBlock for each timedLead", () => {
    expect(laneRow).toMatch(/DispatchLeadVisitBlock/);
    expect(laneRow).toMatch(/timedLeads\.map/);
  });

  it("passes hasConflict from conflictIds to each block", () => {
    expect(laneRow).toMatch(/hasConflict=\{conflictIds\.has\(lv\.id\)\}/);
  });

  it("passes onSelectLeadVisit as onSelect to each block", () => {
    expect(laneRow).toMatch(/onSelect=\{onSelectLeadVisit\}/);
  });

  it("occupancy rail uses amber color for lead segments", () => {
    expect(laneRow).toMatch(/seg\.type === "lead"[^:]+bg-amber-400/);
  });
});

// ── DispatchTimeline ─────────────────────────────────────────────────

describe("DispatchTimeline — leads threaded to lanes", () => {
  it("declares leadVisitsByTech? in Props", () => {
    expect(timeline).toMatch(/leadVisitsByTech\?:\s*Map<string,\s*DispatchLeadVisit\[\]>/);
  });

  it("declares onSelectLeadVisit? in Props", () => {
    expect(timeline).toMatch(/onSelectLeadVisit\?:/);
  });

  it("passes leadVisits to each DispatchLaneRow", () => {
    expect(timeline).toMatch(/leadVisits=\{leadVisitsByTech\?\.get\(t\.id\)/);
  });

  it("passes onSelectLeadVisit to each DispatchLaneRow", () => {
    expect(timeline).toMatch(/onSelectLeadVisit=\{onSelectLeadVisit\}/);
  });
});

// ── DispatchPreview ───────────────────────────────────────────────────

describe("DispatchPreview — leadVisitsByTech memo and strip filter", () => {
  it("builds leadVisitsByTech grouped by technicianIds", () => {
    expect(preview).toMatch(/leadVisitsByTech/);
    expect(preview).toMatch(/lv\.technicianIds/);
  });

  it("passes leadVisitsByTech to DispatchTimeline", () => {
    expect(preview).toMatch(/leadVisitsByTech=\{leadVisitsByTech\}/);
  });

  it("filters LeadVisitsStrip to unassigned or unscheduled visits only", () => {
    // The strip must not receive assigned+scheduled visits.
    expect(preview).toMatch(
      /lv\.technicianIds\.length === 0 \|\| !lv\.scheduledStart/,
    );
  });

  it("onSelectLeadVisit navigates to /leads/:leadId", () => {
    expect(preview).toMatch(/\/leads\/\$\{lv\.leadId\}/);
  });

  it("no longer routes ALL leadVisits unconditionally to LeadVisitsStrip", () => {
    // The old pattern was: visits={leadVisits} with no filter.
    // After the fix, the strip receives stripLeadVisits (filtered).
    expect(preview).not.toMatch(/visits=\{leadVisits\}/);
  });
});
