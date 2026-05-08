/**
 * Quote Detail right rail — source pin tests (2026-05-08).
 *
 * Verifies QuoteDetailPage uses the canonical `<DetailRightRail>` primitive
 * with the spec'd 5-tab layout (Summary / Notes / References / Workflow /
 * Activity).
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
 *   - re-wraps Workflow tab content in a `<Card>` (double-card layering)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const QUOTE_DETAIL = resolve(ROOT, "client/src/pages/QuoteDetailPage.tsx");
const quoteDetailSrc = readFileSync(QUOTE_DETAIL, "utf-8");

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}
const quoteDetailCodeOnly = stripComments(quoteDetailSrc);

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

  it("has exactly FIVE tabs (Summary + Notes + References + Workflow + Activity)", () => {
    const arrStart = quoteDetailSrc.indexOf("const quoteRailTabs:");
    expect(arrStart).toBeGreaterThan(-1);
    const arrEnd = quoteDetailSrc.indexOf("];", arrStart);
    expect(arrEnd).toBeGreaterThan(arrStart);
    const arrSlice = quoteDetailSrc.slice(arrStart, arrEnd);
    const idMatches = arrSlice.match(/\bid:\s*"\w+"/g) ?? [];
    expect(idMatches.length).toBe(5);
    expect(arrSlice).toMatch(/id:\s*"summary"/);
    expect(arrSlice).toMatch(/id:\s*"notes"/);
    expect(arrSlice).toMatch(/id:\s*"references"/);
    expect(arrSlice).toMatch(/id:\s*"workflow"/);
    expect(arrSlice).toMatch(/id:\s*"activity"/);
  });

  it("rail tab order is Summary, Notes, References, Workflow, Activity (per spec)", () => {
    const arrStart = quoteDetailSrc.indexOf("const quoteRailTabs:");
    const arrEnd = quoteDetailSrc.indexOf("];", arrStart);
    const arrSlice = quoteDetailSrc.slice(arrStart, arrEnd);
    const idOrder: string[] = [];
    const re = /\bid:\s*"(\w+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(arrSlice)) !== null) idOrder.push(m[1]);
    expect(idOrder).toEqual(["summary", "notes", "references", "workflow", "activity"]);
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

  it("Workflow tab carries GitBranch icon + stable testId", () => {
    expect(quoteDetailSrc).toMatch(
      /id:\s*"workflow"[\s\S]{0,400}?label:\s*"Workflow"[\s\S]{0,400}?icon:\s*GitBranch[\s\S]{0,400}?testId:\s*"quote-rail-tab-workflow"/,
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

  it("Workflow tab content does NOT wrap in a <Card> (rail panel chrome already provides the title)", () => {
    const arrStart = quoteDetailCodeOnly.indexOf('id: "workflow"');
    const arrEnd = quoteDetailCodeOnly.indexOf('id: "activity"', arrStart);
    expect(arrStart).toBeGreaterThan(-1);
    expect(arrEnd).toBeGreaterThan(arrStart);
    const slice = quoteDetailCodeOnly.slice(arrStart, arrEnd);
    expect(slice).not.toMatch(/<Card\b/);
    expect(slice).not.toMatch(/<CardHeader\b/);
    expect(slice).not.toMatch(/<CardContent\b/);
    expect(slice).not.toMatch(/<CardTitle\b/);
    // Workflow body still surfaces Owner + Assessment.
    expect(slice).toMatch(/Owner/);
    expect(slice).toMatch(/Assessment/);
  });

  it("Activity tab content slot mounts <ActivityCard entityType=\"quote\">", () => {
    expect(quoteDetailSrc).toMatch(
      /id:\s*"activity"[\s\S]{0,400}?<ActivityCard[\s\S]{0,400}?entityType="quote"/,
    );
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
