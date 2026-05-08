/**
 * Lead Detail right rail — source pin tests (2026-05-08).
 *
 * Verifies LeadDetailPage uses the canonical `<DetailRightRail>` primitive
 * with the spec'd 3-tab layout (Details / Notes / Actions).
 *
 * What stays the same:
 *   - LeadVisitsCard remains in the LEFT column (primary content).
 *   - LeadSummaryCard + Description block remain in the LEFT column.
 *   - EntityNotesSection moved FROM the left column INTO the rail's
 *     Notes tab (embedded mode, header suppressed).
 *
 * These pins fail if a future refactor:
 *   - drops the canonical `<DetailRightRail>` mount on LeadDetailPage
 *   - reintroduces the legacy `grid-cols-[1fr_360px]` aside
 *   - moves Notes back into the left column
 *   - removes Actions or merges Actions into Details
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const LEAD_DETAIL = resolve(ROOT, "client/src/pages/LeadDetailPage.tsx");
const leadDetailSrc = readFileSync(LEAD_DETAIL, "utf-8");

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}
const leadDetailCodeOnly = stripComments(leadDetailSrc);

describe("LeadDetailPage — canonical right rail", () => {
  it("imports the DetailRightRail primitive + DetailRailTab type from the canonical module", () => {
    expect(leadDetailSrc).toMatch(
      /import\s*\{[\s\S]*?\bDetailRightRail\b[\s\S]*?\btype\s+DetailRailTab\b[\s\S]*?\}\s*from\s*["']@\/components\/detail-rail\/DetailRightRail["']/,
    );
  });

  it("mounts <DetailRightRail tabs={leadRailTabs} ...> with the 'lead-side' testid prefix", () => {
    expect(leadDetailSrc).toMatch(
      /<DetailRightRail[\s\S]{0,400}?tabs=\{leadRailTabs\}[\s\S]{0,400}?testIdPrefix="lead-side"/,
    );
  });

  it("carries the aria-label='Lead information rail'", () => {
    expect(leadDetailSrc).toMatch(/ariaLabel="Lead information rail"/);
  });

  it("the rail aside is a page-level sibling of the left-column shell (mirrors Job Detail)", () => {
    expect(leadDetailSrc).toMatch(
      /<div\s+className="flex h-full flex-col lg:flex-row bg-\[#f1f5f9\]"\s+data-testid="lead-detail-page"/,
    );
    expect(leadDetailSrc).toMatch(/data-testid="lead-detail-left-column-shell"/);
    expect(leadDetailSrc).toMatch(/data-testid="lead-detail-rail-column"/);
    expect(leadDetailSrc).toMatch(/leadRailTab === null \? 80 : 380/);
    expect(leadDetailSrc).toMatch(
      /data-panel-open=\{leadRailTab === null \? "false" : "true"\}/,
    );
  });

  it("declares page-local `leadRailTab` state for active-tab tracking", () => {
    expect(leadDetailSrc).toMatch(
      /const\s*\[\s*leadRailTab\s*,\s*setLeadRailTab\s*\]\s*=\s*useState/,
    );
    expect(leadDetailSrc).toMatch(/useState<LeadRailTab\s*\|\s*null>\(/);
  });

  it("the default open tab is Details", () => {
    expect(leadDetailSrc).toMatch(
      /useState<LeadRailTab\s*\|\s*null>\(\s*"details"\s*\)/,
    );
  });
});

describe("LeadDetailPage — leadRailTabs registry", () => {
  it("declares a `leadRailTabs` array typed `DetailRailTab[]`", () => {
    expect(leadDetailSrc).toMatch(
      /const\s+leadRailTabs:\s*DetailRailTab\[\]\s*=\s*\[/,
    );
  });

  it("has exactly THREE tabs (Details + Notes + Actions)", () => {
    const arrStart = leadDetailSrc.indexOf("const leadRailTabs:");
    expect(arrStart).toBeGreaterThan(-1);
    const arrEnd = leadDetailSrc.indexOf("];", arrStart);
    expect(arrEnd).toBeGreaterThan(arrStart);
    const arrSlice = leadDetailSrc.slice(arrStart, arrEnd);
    const idMatches = arrSlice.match(/\bid:\s*"\w+"/g) ?? [];
    expect(idMatches.length).toBe(3);
    expect(arrSlice).toMatch(/id:\s*"details"/);
    expect(arrSlice).toMatch(/id:\s*"notes"/);
    expect(arrSlice).toMatch(/id:\s*"actions"/);
  });

  it("rail tab order is Details, Notes, Actions (per spec)", () => {
    const arrStart = leadDetailSrc.indexOf("const leadRailTabs:");
    const arrEnd = leadDetailSrc.indexOf("];", arrStart);
    const arrSlice = leadDetailSrc.slice(arrStart, arrEnd);
    const idOrder: string[] = [];
    const re = /\bid:\s*"(\w+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(arrSlice)) !== null) idOrder.push(m[1]);
    expect(idOrder).toEqual(["details", "notes", "actions"]);
  });

  it("Details tab carries `label: \"Details\"` + Info icon + stable testId", () => {
    expect(leadDetailSrc).toMatch(
      /id:\s*"details"[\s\S]{0,400}?label:\s*"Details"[\s\S]{0,400}?icon:\s*Info[\s\S]{0,400}?testId:\s*"lead-rail-tab-details"/,
    );
  });

  it("Notes tab carries `label: \"Notes\"` + StickyNote icon + stable testId", () => {
    expect(leadDetailSrc).toMatch(
      /id:\s*"notes"[\s\S]{0,400}?label:\s*"Notes"[\s\S]{0,400}?icon:\s*StickyNote[\s\S]{0,400}?testId:\s*"lead-rail-tab-notes"/,
    );
  });

  it("Actions tab carries `label: \"Actions\"` + Zap icon + stable testId", () => {
    expect(leadDetailSrc).toMatch(
      /id:\s*"actions"[\s\S]{0,400}?label:\s*"Actions"[\s\S]{0,400}?icon:\s*Zap[\s\S]{0,400}?testId:\s*"lead-rail-tab-actions"/,
    );
  });

  it("Details tab content slot mounts <LeadDetailsRail mode=\"saved\">", () => {
    expect(leadDetailSrc).toMatch(
      /id:\s*"details"[\s\S]{0,2400}?<LeadDetailsRail[\s\S]{0,400}?mode="saved"/,
    );
  });

  it("Notes tab content slot mounts <EntityNotesPanel entityType=\"lead\" entityId={lead.id}>", () => {
    // 2026-05-08 Tier 4 Notes canonicalization — see invoice-detail-
    // right-rail.test.ts for the cross-page contract.
    expect(leadDetailSrc).toMatch(
      /id:\s*"notes"[\s\S]{0,1600}?<EntityNotesPanel[\s\S]{0,400}?entityType="lead"[\s\S]{0,400}?entityId=\{lead\.id\}/,
    );
  });

  it("Notes tab carries the canonical +Add `action` slot wired to `notesAddSignal`", () => {
    expect(leadDetailSrc).toMatch(
      /id:\s*"notes"[\s\S]{0,1600}?action:\s*\([\s\S]{0,400}?data-testid="button-add-note-rail"/,
    );
    expect(leadDetailSrc).toMatch(
      /id:\s*"notes"[\s\S]{0,1600}?openAddNoteSignal=\{notesAddSignal\}/,
    );
  });

  it("Actions tab content preserves Convert / Mark Contacted / Archive / Delete buttons", () => {
    expect(leadDetailSrc).toMatch(
      /id:\s*"actions"[\s\S]{0,4000}?data-testid="button-convert-to-quote"/,
    );
    expect(leadDetailSrc).toMatch(/id:\s*"actions"[\s\S]{0,4000}?Mark Contacted/);
    expect(leadDetailSrc).toMatch(/id:\s*"actions"[\s\S]{0,4000}?Archive Lead/);
    expect(leadDetailSrc).toMatch(/id:\s*"actions"[\s\S]{0,4000}?Delete Permanently/);
  });
});

describe("LeadDetailPage — Notes moved out of left column", () => {
  it("LeadVisitsCard is mounted ONCE on the page (left column only — not duplicated in the rail)", () => {
    const matches = leadDetailSrc.match(/<LeadVisitsCard\b/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("EntityNotesPanel mount lives INSIDE the leadRailTabs array (Notes tab content slot)", () => {
    // 2026-05-08 Tier 4 Notes canonicalization — primitive renamed
    // from EntityNotesSection to EntityNotesPanel.
    const arrStart = leadDetailSrc.indexOf("const leadRailTabs:");
    const arrEnd = leadDetailSrc.indexOf("];", arrStart);
    expect(arrStart).toBeGreaterThan(-1);
    expect(arrEnd).toBeGreaterThan(arrStart);
    const arrSlice = leadDetailSrc.slice(arrStart, arrEnd);
    expect(arrSlice).toMatch(/<EntityNotesPanel[\s\S]{0,400}?entityType="lead"/);
    // EntityNotesPanel should appear EXACTLY ONCE on the page, inside the rail.
    const allMatches = leadDetailSrc.match(/<EntityNotesPanel\b/g) ?? [];
    expect(allMatches.length).toBe(1);
  });

  it("the legacy `grid-cols-[1fr_360px]` aside is gone (replaced by canonical rail)", () => {
    expect(leadDetailCodeOnly).not.toMatch(/grid-cols-\[1fr_360px\]/);
  });
});

describe("LeadDetailPage — closed-rail behavior delegates to the canonical primitive", () => {
  it("`leadRailTab` state is typed nullable (`LeadRailTab | null`) — the closed marker", () => {
    expect(leadDetailSrc).toMatch(/useState<LeadRailTab\s*\|\s*null>\(/);
  });

  it("the rail mount feeds `leadRailTab` directly to `activeTabId`", () => {
    expect(leadDetailSrc).toMatch(
      /<DetailRightRail[\s\S]{0,400}?activeTabId=\{leadRailTab\}/,
    );
  });

  it("`onActiveTabChange` accepts null + writes the page state directly (no clamping)", () => {
    expect(leadDetailSrc).toMatch(
      /<DetailRightRail[\s\S]{0,800}?onActiveTabChange=\{\(id\)\s*=>\s*setLeadRailTab\(id\s+as\s+LeadRailTab\s*\|\s*null\)\}/,
    );
  });

  it("the page mounts the rail twice (mobile + desktop variants) inside the rail aside", () => {
    const idx = leadDetailSrc.indexOf('data-testid="lead-detail-rail-column"');
    expect(idx).toBeGreaterThan(-1);
    const slice = leadDetailSrc.slice(idx, idx + 3000);
    const railMounts = slice.match(/<DetailRightRail\b/g) ?? [];
    expect(railMounts.length).toBe(2);
  });
});
