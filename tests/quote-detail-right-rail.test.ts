/**
 * Quote Detail right rail — source pin tests (2026-05-08).
 *
 * Verifies QuoteDetailPage uses the canonical `<DetailRightRail>` primitive
 * with the spec'd 4-tab layout (Summary / Notes / References / Activity).
 *
 * 2026-05-08 (Phase 3 — Quote Workflow relocation): the prior 5th
 * "Workflow" tab was retired. Owner + Assessment lifecycle controls
 * moved into <QuoteHeaderCard>'s Section B action bar (entity-level
 * mutations belong with Send / Approve / Decline / Convert in the
 * header, not a rail tab).
 *
 * What stays the same:
 *   - LineItemsCard remains in the LEFT column (core document content).
 *   - QuoteHeaderCard + QuoteDescriptionCard remain in the LEFT column.
 *
 * These pins fail if a future refactor:
 *   - drops the canonical `<DetailRightRail>` mount on QuoteDetailPage
 *   - reintroduces `<DetailPageShell rightRail={...}>` (legacy stacked-cards
 *     rail with drag-resize)
 *   - moves Line Items into the rail
 *   - re-adds a Workflow tab to the rail
 *   - moves Owner / Assessment controls back out of the header
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const QUOTE_DETAIL = resolve(ROOT, "client/src/pages/QuoteDetailPage.tsx");
const QUOTE_HEADER_CARD = resolve(ROOT, "client/src/components/QuoteHeaderCard.tsx");
const quoteDetailSrc = readFileSync(QUOTE_DETAIL, "utf-8");
const quoteHeaderCardSrc = readFileSync(QUOTE_HEADER_CARD, "utf-8");

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}
const quoteDetailCodeOnly = stripComments(quoteDetailSrc);
const quoteHeaderCardCodeOnly = stripComments(quoteHeaderCardSrc);

describe("QuoteDetailPage — canonical right rail", () => {
  it("imports the DetailRightRail primitive + DetailRailTab type from the canonical module", () => {
    expect(quoteDetailSrc).toMatch(
      /import\s*\{[\s\S]*?\bDetailRightRail\b[\s\S]*?\btype\s+DetailRailTab\b[\s\S]*?\}\s*from\s*["']@\/components\/detail-rail\/DetailRightRail["']/,
    );
  });

  it("does NOT import DetailPageShell anymore (legacy stacked-cards rail dropped)", () => {
    expect(quoteDetailSrc).not.toMatch(
      /from\s+["']@\/components\/layout\/DetailPageShell["']/,
    );
  });

  it("mounts <DetailRightRail tabs={quoteRailTabs} ...> with the 'quote-side' testid prefix", () => {
    expect(quoteDetailSrc).toMatch(
      /<DetailRightRail[\s\S]{0,400}?tabs=\{quoteRailTabs\}[\s\S]{0,400}?testIdPrefix="quote-side"/,
    );
  });

  it("carries the aria-label='Quote information rail'", () => {
    expect(quoteDetailSrc).toMatch(/ariaLabel="Quote information rail"/);
  });

  it("the rail aside is a page-level sibling of the left-column shell (mirrors Job Detail)", () => {
    expect(quoteDetailSrc).toMatch(
      /<div\s+className="flex h-full flex-col lg:flex-row bg-app-bg"\s+data-testid="quote-detail-page"/,
    );
    expect(quoteDetailSrc).toMatch(/data-testid="quote-detail-left-column-shell"/);
    expect(quoteDetailSrc).toMatch(/data-testid="quote-detail-rail-column"/);
    expect(quoteDetailSrc).toMatch(/quoteRailTab === null \? 80 : 380/);
    expect(quoteDetailSrc).toMatch(
      /data-panel-open=\{quoteRailTab === null \? "false" : "true"\}/,
    );
  });

  it("declares page-local `quoteRailTab` state for active-tab tracking", () => {
    expect(quoteDetailSrc).toMatch(
      /const\s*\[\s*quoteRailTab\s*,\s*setQuoteRailTab\s*\]\s*=\s*useState/,
    );
    expect(quoteDetailSrc).toMatch(/useState<QuoteRailTab\s*\|\s*null>\(/);
  });

  it("the default open tab is Summary", () => {
    expect(quoteDetailSrc).toMatch(
      /useState<QuoteRailTab\s*\|\s*null>\(\s*"summary"\s*\)/,
    );
  });
});

describe("QuoteDetailPage — quoteRailTabs registry", () => {
  it("declares a `quoteRailTabs` array typed `DetailRailTab[]`", () => {
    expect(quoteDetailSrc).toMatch(
      /const\s+quoteRailTabs:\s*DetailRailTab\[\]\s*=\s*\[/,
    );
  });

  it("has exactly FOUR tabs (Summary + Notes + References + Activity) — Workflow tab removed", () => {
    const arrStart = quoteDetailSrc.indexOf("const quoteRailTabs:");
    expect(arrStart).toBeGreaterThan(-1);
    const arrEnd = quoteDetailSrc.indexOf("];", arrStart);
    expect(arrEnd).toBeGreaterThan(arrStart);
    const arrSlice = quoteDetailSrc.slice(arrStart, arrEnd);
    const idMatches = arrSlice.match(/\bid:\s*"\w+"/g) ?? [];
    expect(idMatches.length).toBe(4);
    expect(arrSlice).toMatch(/id:\s*"summary"/);
    expect(arrSlice).toMatch(/id:\s*"notes"/);
    expect(arrSlice).toMatch(/id:\s*"references"/);
    expect(arrSlice).toMatch(/id:\s*"activity"/);
    expect(arrSlice).not.toMatch(/id:\s*"workflow"/);
  });

  it("rail tab order is Summary, Notes, References, Activity (per spec)", () => {
    const arrStart = quoteDetailSrc.indexOf("const quoteRailTabs:");
    const arrEnd = quoteDetailSrc.indexOf("];", arrStart);
    const arrSlice = quoteDetailSrc.slice(arrStart, arrEnd);
    const idOrder: string[] = [];
    const re = /\bid:\s*"(\w+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(arrSlice)) !== null) idOrder.push(m[1]);
    expect(idOrder).toEqual(["summary", "notes", "references", "activity"]);
  });

  it("QuoteRailTab union no longer includes \"workflow\"", () => {
    expect(quoteDetailSrc).toMatch(
      /type\s+QuoteRailTab\s*=\s*"summary"\s*\|\s*"notes"\s*\|\s*"references"\s*\|\s*"activity"/,
    );
    expect(quoteDetailSrc).not.toMatch(/type\s+QuoteRailTab\s*=[^;]*"workflow"/);
  });

  it("the GitBranch icon import (former Workflow tab icon) is gone", () => {
    expect(quoteDetailSrc).not.toMatch(/\bGitBranch\b/);
  });

  it("Summary tab carries DollarSign icon + stable testId", () => {
    expect(quoteDetailSrc).toMatch(
      /id:\s*"summary"[\s\S]{0,400}?label:\s*"Summary"[\s\S]{0,400}?icon:\s*DollarSign[\s\S]{0,400}?testId:\s*"quote-rail-tab-summary"/,
    );
  });

  it("Notes tab carries StickyNote icon + stable testId", () => {
    expect(quoteDetailSrc).toMatch(
      /id:\s*"notes"[\s\S]{0,400}?label:\s*"Notes"[\s\S]{0,400}?icon:\s*StickyNote[\s\S]{0,400}?testId:\s*"quote-rail-tab-notes"/,
    );
  });

  it("References tab carries Tag icon + stable testId", () => {
    expect(quoteDetailSrc).toMatch(
      /id:\s*"references"[\s\S]{0,400}?label:\s*"References"[\s\S]{0,400}?icon:\s*Tag[\s\S]{0,400}?testId:\s*"quote-rail-tab-references"/,
    );
  });

  it("Activity tab carries ActivityIcon (lucide Activity aliased) + stable testId", () => {
    expect(quoteDetailSrc).toMatch(
      /id:\s*"activity"[\s\S]{0,400}?label:\s*"Activity"[\s\S]{0,400}?icon:\s*ActivityIcon[\s\S]{0,400}?testId:\s*"quote-rail-tab-activity"/,
    );
  });

  it("Summary tab content slot mounts <QuoteSummaryCard>", () => {
    expect(quoteDetailSrc).toMatch(
      /id:\s*"summary"[\s\S]{0,1200}?<QuoteSummaryCard\b/,
    );
  });

  it("Notes tab content slot mounts <EntityNotesPanel entityType=\"quote\" entityId={quote.id}>", () => {
    // 2026-05-08 Tier 4 Notes canonicalization — see invoice-detail-
    // right-rail.test.ts for the cross-page contract.
    expect(quoteDetailSrc).toMatch(
      /id:\s*"notes"[\s\S]{0,1600}?<EntityNotesPanel[\s\S]{0,400}?entityType="quote"[\s\S]{0,400}?entityId=\{quote\.id\}/,
    );
  });

  it("Notes tab carries the canonical +Add `action` slot wired to `notesAddSignal`", () => {
    expect(quoteDetailSrc).toMatch(
      /id:\s*"notes"[\s\S]{0,1600}?action:\s*\([\s\S]{0,400}?data-testid="button-add-note-rail"/,
    );
    expect(quoteDetailSrc).toMatch(
      /id:\s*"notes"[\s\S]{0,1600}?openAddNoteSignal=\{notesAddSignal\}/,
    );
  });

  it("References tab content slot mounts <ReferenceFieldsSection entityType=\"quote\">", () => {
    expect(quoteDetailSrc).toMatch(
      /id:\s*"references"[\s\S]{0,400}?<ReferenceFieldsSection[\s\S]{0,400}?entityType="quote"/,
    );
  });

  it("the rail registry no longer references the Workflow tab's content (Owner select / Assessment lifecycle)", () => {
    const arrStart = quoteDetailCodeOnly.indexOf("const quoteRailTabs:");
    const arrEnd = quoteDetailCodeOnly.indexOf("];", arrStart);
    const railSlice = quoteDetailCodeOnly.slice(arrStart, arrEnd);
    expect(railSlice).not.toMatch(/data-testid="quote-rail-workflow"/);
    expect(railSlice).not.toMatch(/updateOwnerMutation/);
    expect(railSlice).not.toMatch(/toggleAssessmentMutation/);
    expect(railSlice).not.toMatch(/Mark needed/);
  });

  it("Activity tab content slot mounts <ActivityCard entityType=\"quote\">", () => {
    expect(quoteDetailSrc).toMatch(
      /id:\s*"activity"[\s\S]{0,400}?<ActivityCard[\s\S]{0,400}?entityType="quote"/,
    );
  });
});

// ── Quote workflow controls — relocated to header ───────────────────

describe("QuoteHeaderCard — workflow controls (Owner + Assessment) in Section B", () => {
  it("declares the canonical `QuoteHeaderWorkflow` interface for header workflow controls", () => {
    expect(quoteHeaderCardSrc).toMatch(
      /export\s+interface\s+QuoteHeaderWorkflow\s*\{/,
    );
  });

  it("QuoteHeaderCardProps accepts an optional `workflow: QuoteHeaderWorkflow` prop", () => {
    expect(quoteHeaderCardSrc).toMatch(/workflow\?:\s*QuoteHeaderWorkflow/);
  });

  it("Section B action bar carries the canonical testid `quote-header-action-bar`", () => {
    expect(quoteHeaderCardSrc).toMatch(/data-testid="quote-header-action-bar"/);
  });

  it("renders an Owner select inside the Section B workflow cluster", () => {
    expect(quoteHeaderCardSrc).toMatch(/data-testid="quote-header-workflow-cluster"/);
    expect(quoteHeaderCardSrc).toMatch(/data-testid="quote-header-owner-select"/);
    // Owner change still routes to the page-owned mutation via the
    // `workflow.onOwnerChange` callback (not direct mutation calls
    // inside the card).
    expect(quoteHeaderCardSrc).toMatch(/workflow\.onOwnerChange\(e\.target\.value\s*\|\|\s*null\)/);
  });

  it("renders the Assessment lifecycle controls (Mark needed / Schedule / Clear / Complete / Cancel)", () => {
    expect(quoteHeaderCardSrc).toMatch(
      /data-testid="quote-header-assessment-mark-needed"/,
    );
    expect(quoteHeaderCardSrc).toMatch(
      /data-testid="quote-header-assessment-schedule"/,
    );
    expect(quoteHeaderCardSrc).toMatch(
      /data-testid="quote-header-assessment-clear"/,
    );
    expect(quoteHeaderCardSrc).toMatch(
      /data-testid="quote-header-assessment-complete"/,
    );
    expect(quoteHeaderCardSrc).toMatch(
      /data-testid="quote-header-assessment-cancel"/,
    );
  });

  it("the workflow cluster is gated on the optional `workflow` prop (not rendered when absent)", () => {
    // Look for the canonical rendering guard on the cluster.
    expect(quoteHeaderCardCodeOnly).toMatch(
      /\{workflow\s*&&\s*\([\s\S]{0,200}?data-testid="quote-header-workflow-cluster"/,
    );
  });

  it("page-level QuoteDetailPage passes the canonical `workflow` prop into <QuoteHeaderCard>", () => {
    expect(quoteDetailCodeOnly).toMatch(
      /<QuoteHeaderCard[\s\S]{0,4000}?workflow=\{\{/,
    );
  });

  it("the page-level workflow prop wires Owner + Assessment mutations", () => {
    const idx = quoteDetailCodeOnly.indexOf("workflow={{");
    expect(idx).toBeGreaterThan(-1);
    const slice = quoteDetailCodeOnly.slice(idx, idx + 2000);
    expect(slice).toMatch(/onOwnerChange:\s*\(userId\)\s*=>\s*updateOwnerMutation\.mutate\(userId\)/);
    expect(slice).toMatch(/onMarkAssessmentNeeded:\s*\(\)\s*=>\s*toggleAssessmentMutation\.mutate\(true\)/);
    expect(slice).toMatch(/onScheduleAssessment:\s*\(\)\s*=>\s*setShowScheduleAssessment\(true\)/);
    expect(slice).toMatch(/onCompleteAssessment:\s*\(\)\s*=>\s*completeAssessmentMutation\.mutate\(\)/);
    expect(slice).toMatch(/onCancelAssessment:\s*\(\)\s*=>\s*cancelAssessmentMutation\.mutate\(\)/);
  });

  it("the rail-shell layout markers are still canonical (post-Workflow-relocation)", () => {
    // Belt-and-suspenders: confirm the layout migration done by an
    // earlier phase is still intact after this change.
    expect(quoteDetailSrc).toMatch(
      /<div\s+className="flex h-full flex-col lg:flex-row bg-app-bg"\s+data-testid="quote-detail-page"/,
    );
    expect(quoteDetailSrc).toMatch(/data-testid="quote-detail-left-column-shell"/);
    expect(quoteDetailSrc).toMatch(/data-testid="quote-detail-rail-column"/);
  });
});

describe("QuoteDetailPage — left column preserves Line Items", () => {
  it("<LineItemsCard> mounts INSIDE the left column shell, not the rail", () => {
    const leftIdx = quoteDetailSrc.indexOf('data-testid="quote-detail-left-column-shell"');
    expect(leftIdx).toBeGreaterThan(-1);
    const railIdx = quoteDetailSrc.indexOf('data-testid="quote-detail-rail-column"');
    expect(railIdx).toBeGreaterThan(leftIdx);
    const leftSlice = quoteDetailSrc.slice(leftIdx, railIdx);
    expect(leftSlice).toMatch(/<LineItemsCard\b/);
    // LineItemsCard should appear ONLY in the left slice (not duplicated
    // in the rail).
    const railSlice = quoteDetailSrc.slice(railIdx);
    expect(railSlice).not.toMatch(/<LineItemsCard\b/);
  });

  it("the legacy `<DetailPageShell rightRail={...}>` mount is gone", () => {
    expect(quoteDetailCodeOnly).not.toMatch(/<DetailPageShell\b/);
    expect(quoteDetailCodeOnly).not.toMatch(/rightRail=\{/);
    expect(quoteDetailCodeOnly).not.toMatch(/leftColumn=\{/);
  });

  it("the legacy Notes Collapsible (with MessageSquare + ChevronDown) is gone — Notes now in the rail", () => {
    expect(quoteDetailSrc).not.toMatch(/setNotesExpanded/);
    expect(quoteDetailSrc).not.toMatch(/data-testid="section-quote-notes"/);
    expect(quoteDetailSrc).not.toMatch(/<Collapsible\b/);
  });
});

describe("QuoteDetailPage — closed-rail behavior delegates to the canonical primitive", () => {
  it("`quoteRailTab` state is typed nullable (`QuoteRailTab | null`)", () => {
    expect(quoteDetailSrc).toMatch(/useState<QuoteRailTab\s*\|\s*null>\(/);
  });

  it("the rail mount feeds `quoteRailTab` directly to `activeTabId`", () => {
    expect(quoteDetailSrc).toMatch(
      /<DetailRightRail[\s\S]{0,400}?activeTabId=\{quoteRailTab\}/,
    );
  });

  it("`onActiveTabChange` accepts null + writes page state directly", () => {
    expect(quoteDetailSrc).toMatch(
      /<DetailRightRail[\s\S]{0,800}?onActiveTabChange=\{\(id\)\s*=>\s*setQuoteRailTab\(id\s+as\s+QuoteRailTab\s*\|\s*null\)\}/,
    );
  });

  it("the page mounts the rail twice (mobile + desktop variants) inside the rail aside", () => {
    const idx = quoteDetailSrc.indexOf('data-testid="quote-detail-rail-column"');
    expect(idx).toBeGreaterThan(-1);
    const slice = quoteDetailSrc.slice(idx, idx + 3000);
    const railMounts = slice.match(/<DetailRightRail\b/g) ?? [];
    expect(railMounts.length).toBe(2);
  });
});

// ── Scroll canonicalization (2026-05-08) ──────────────────────────
//
// Pin against the split-scroll regression — see
// `lead-detail-right-rail.test.ts` for the cross-page contract.

describe("QuoteDetailPage — single-scroll canonical layout (mirrors Job Detail)", () => {
  it("the body wrapper has no inner `overflow-y-auto` / `flex-1 min-h-0` (would create split-scroll)", () => {
    const startIdx = quoteDetailCodeOnly.indexOf(
      'data-testid="quote-detail-left-column-shell"',
    );
    const endIdx = quoteDetailCodeOnly.indexOf(
      'data-testid="quote-detail-rail-column"',
      startIdx,
    );
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const leftSlice = quoteDetailCodeOnly.slice(startIdx, endIdx);
    expect(leftSlice).not.toMatch(/overflow-y-auto/);
    const innerBodyPattern = /<div\s+className="flex-1\s+min-h-0[^"]*"/;
    expect(leftSlice).not.toMatch(innerBodyPattern);
  });

  it("the body wrapper uses the canonical Job pattern: padding + space-y only", () => {
    // Body wrapper directly inside the shell is
    // `<div className="px-4 lg:px-6 py-4 space-y-4">`.
    expect(quoteDetailSrc).toMatch(
      /data-testid="quote-detail-left-column-shell"[\s\S]{0,1500}?<div\s+className="px-4 lg:px-6 py-4 space-y-4">/,
    );
  });

  it("no sticky-positioned chrome inside the left column (header scrolls with content)", () => {
    const startIdx = quoteDetailCodeOnly.indexOf(
      'data-testid="quote-detail-left-column-shell"',
    );
    const endIdx = quoteDetailCodeOnly.indexOf(
      'data-testid="quote-detail-rail-column"',
      startIdx,
    );
    const leftSlice = quoteDetailCodeOnly.slice(startIdx, endIdx);
    expect(leftSlice).not.toMatch(/className="[^"]*\bsticky\s/);
    expect(leftSlice).not.toMatch(/className="[^"]*\bsticky"/);
  });
});
