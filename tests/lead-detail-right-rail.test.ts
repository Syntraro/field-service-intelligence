/**
 * Lead Detail right rail — source pin tests (2026-05-08).
 *
 * Verifies LeadDetailPage uses the canonical `<DetailRightRail>` primitive
 * with the spec'd 2-tab layout (Details / Notes).
 *
 * 2026-05-08 (Phase 2 — Lead Actions relocation): the prior 3rd "Actions"
 * tab was retired. Convert / Mark Contacted / Mark Lost / Archive / Delete /
 * View-Linked-Quote moved into the page main header
 * (`<LeadSummaryCard>` Section B action bar, mirroring the QuoteHeaderCard
 * pattern). The rail now hosts only Details + Notes.
 *
 * 2026-05-08 (Phase 4 — RailContentCard adoption): `<LeadDetailsRail>`
 * migrated off its hand-rolled `bg-white rounded-md border shadow-sm`
 * chrome onto `<RailContentCard>` + `<RailContentCardFieldList>` +
 * `<RailContentCardField>`.
 *
 * What stays the same:
 *   - LeadVisitsCard remains in the LEFT column (primary content).
 *   - LeadSummaryCard + Description block remain in the LEFT column.
 *   - EntityNotesPanel mounted inside the rail's Notes tab.
 *
 * These pins fail if a future refactor:
 *   - drops the canonical `<DetailRightRail>` mount on LeadDetailPage
 *   - reintroduces the legacy `grid-cols-[1fr_360px]` aside
 *   - moves Notes back into the left column
 *   - re-adds an Actions tab to the rail
 *   - moves Lead actions back out of the main header
 *   - reintroduces hand-rolled card chrome inside `<LeadDetailsRail>`
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const LEAD_DETAIL = resolve(ROOT, "client/src/pages/LeadDetailPage.tsx");
const LEAD_SUMMARY_CARD = resolve(ROOT, "client/src/components/leads/LeadSummaryCard.tsx");
const LEAD_DETAILS_RAIL = resolve(ROOT, "client/src/components/leads/LeadDetailsRail.tsx");
const leadDetailSrc = readFileSync(LEAD_DETAIL, "utf-8");
const leadSummaryCardSrc = readFileSync(LEAD_SUMMARY_CARD, "utf-8");
const leadDetailsRailSrc = readFileSync(LEAD_DETAILS_RAIL, "utf-8");

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}
const leadDetailCodeOnly = stripComments(leadDetailSrc);
const leadDetailsRailCodeOnly = stripComments(leadDetailsRailSrc);

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

  it("has exactly TWO tabs (Details + Notes) — Actions tab removed", () => {
    const arrStart = leadDetailSrc.indexOf("const leadRailTabs:");
    expect(arrStart).toBeGreaterThan(-1);
    const arrEnd = leadDetailSrc.indexOf("];", arrStart);
    expect(arrEnd).toBeGreaterThan(arrStart);
    const arrSlice = leadDetailSrc.slice(arrStart, arrEnd);
    const idMatches = arrSlice.match(/\bid:\s*"\w+"/g) ?? [];
    expect(idMatches.length).toBe(2);
    expect(arrSlice).toMatch(/id:\s*"details"/);
    expect(arrSlice).toMatch(/id:\s*"notes"/);
    expect(arrSlice).not.toMatch(/id:\s*"actions"/);
  });

  it("rail tab order is Details, Notes (per spec)", () => {
    const arrStart = leadDetailSrc.indexOf("const leadRailTabs:");
    const arrEnd = leadDetailSrc.indexOf("];", arrStart);
    const arrSlice = leadDetailSrc.slice(arrStart, arrEnd);
    const idOrder: string[] = [];
    const re = /\bid:\s*"(\w+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(arrSlice)) !== null) idOrder.push(m[1]);
    expect(idOrder).toEqual(["details", "notes"]);
  });

  it("LeadRailTab union no longer includes \"actions\"", () => {
    expect(leadDetailSrc).toMatch(/type\s+LeadRailTab\s*=\s*"details"\s*\|\s*"notes"/);
    expect(leadDetailSrc).not.toMatch(/type\s+LeadRailTab\s*=[^;]*"actions"/);
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

  it("the Zap icon import (former Actions tab icon) is gone", () => {
    expect(leadDetailSrc).not.toMatch(/\bZap\b/);
  });

  it("Details tab content slot mounts <LeadDetailsRail mode=\"saved\">", () => {
    expect(leadDetailSrc).toMatch(
      /id:\s*"details"[\s\S]{0,2400}?<LeadDetailsRail[\s\S]{0,400}?mode="saved"/,
    );
  });

  it("Notes tab content slot mounts <EntityNotesPanel entityType=\"lead\" entityId={lead.id}>", () => {
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

  it("the page no longer renders Convert / Mark Contacted / Archive / Delete inside the rail tab registry", () => {
    const arrStart = leadDetailSrc.indexOf("const leadRailTabs:");
    const arrEnd = leadDetailSrc.indexOf("];", arrStart);
    const railSlice = leadDetailSrc.slice(arrStart, arrEnd);
    expect(railSlice).not.toMatch(/data-testid="button-convert-to-quote"/);
    expect(railSlice).not.toMatch(/Mark Contacted/);
    expect(railSlice).not.toMatch(/Archive Lead/);
    expect(railSlice).not.toMatch(/Delete Permanently/);
    expect(railSlice).not.toMatch(/data-testid="lead-rail-actions"/);
  });
});

// ── Lead actions — relocated to the page main header ─────────────────

describe("LeadDetailPage — Lead actions relocated to <LeadSummaryCard> header", () => {
  it("LeadDetailPage passes the canonical `actions` prop into <LeadSummaryCard>", () => {
    expect(leadDetailSrc).toMatch(/<LeadSummaryCard[\s\S]{0,2000}?actions=\{\{/);
  });

  it("the `actions` prop forwards canConvert / canContact / canMarkLost gating flags", () => {
    // Use the comment-stripped source so the first <LeadSummaryCard
    // match is the real JSX usage, not a doc-comment reference.
    const idx = leadDetailCodeOnly.indexOf("<LeadSummaryCard");
    expect(idx).toBeGreaterThan(-1);
    const slice = leadDetailCodeOnly.slice(idx, idx + 2000);
    expect(slice).toMatch(/canConvert,?/);
    expect(slice).toMatch(/canContact,?/);
    expect(slice).toMatch(/canMarkLost,?/);
    expect(slice).toMatch(/convertedQuoteId:\s*lead\.convertedQuoteId/);
  });

  it("the `actions` prop wires the destructive AlertDialogs via setShow* setters (not direct mutations)", () => {
    const idx = leadDetailCodeOnly.indexOf("<LeadSummaryCard");
    const slice = leadDetailCodeOnly.slice(idx, idx + 2000);
    expect(slice).toMatch(/onArchive:\s*\(\)\s*=>\s*setShowArchiveConfirm\(true\)/);
    expect(slice).toMatch(/onHardDelete:\s*\(\)\s*=>\s*setShowHardDeleteConfirm\(true\)/);
  });
});

describe("LeadSummaryCard — Section B action bar", () => {
  it("declares the canonical `LeadSummaryActions` interface for header actions", () => {
    expect(leadSummaryCardSrc).toMatch(/export\s+interface\s+LeadSummaryActions\s*\{/);
  });

  it("SavedProps accepts an optional `actions: LeadSummaryActions` prop", () => {
    expect(leadSummaryCardSrc).toMatch(/actions\?:\s*LeadSummaryActions/);
  });

  it("renders an action bar wrapper with the canonical Quote/Invoice header pattern (border-t + px-4 py-1.5)", () => {
    expect(leadSummaryCardSrc).toMatch(/data-testid="lead-header-action-bar"/);
    expect(leadSummaryCardSrc).toMatch(
      /px-4 py-1\.5 border-t border-slate-200\/60[\s\S]{0,200}?data-testid="lead-header-action-bar"/,
    );
  });

  it("the action bar preserves all 6 canonical actions (Convert / Mark Contacted / Mark Lost / View Quote / Archive / Delete)", () => {
    expect(leadSummaryCardSrc).toMatch(/data-testid="button-convert-to-quote"/);
    expect(leadSummaryCardSrc).toMatch(/data-testid="button-mark-contacted"/);
    expect(leadSummaryCardSrc).toMatch(/data-testid="button-mark-lost"/);
    expect(leadSummaryCardSrc).toMatch(/data-testid="button-view-quote"/);
    expect(leadSummaryCardSrc).toMatch(/data-testid="button-archive-lead"/);
    expect(leadSummaryCardSrc).toMatch(/data-testid="button-hard-delete-lead"/);
  });

  it("Convert button uses the canonical primary-green action chrome", () => {
    expect(leadSummaryCardSrc).toMatch(
      /bg-green-600 hover:bg-green-700 text-white[\s\S]{0,400}?data-testid="button-convert-to-quote"/,
    );
  });

  it("Convert / Mark Contacted / View Quote are gated on their respective flags", () => {
    expect(leadSummaryCardSrc).toMatch(/canConvert\s*&&\s*!convertedQuoteId/);
    expect(leadSummaryCardSrc).toMatch(/\{canContact\s*&&/);
    expect(leadSummaryCardSrc).toMatch(/\{canMarkLost\s*&&/);
    expect(leadSummaryCardSrc).toMatch(/\{convertedQuoteId\s*&&/);
  });

  it("the action bar is gated on saved-mode + actions prop (not rendered in draft mode)", () => {
    expect(leadSummaryCardSrc).toMatch(
      /props\.mode === "saved"\s*&&\s*props\.actions\s*\?\s*renderActionBar\(props\.actions\)/,
    );
  });
});

// ── LeadDetailsRail — RailContentCard adoption ───────────────────────

describe("LeadDetailsRail — RailContentCard adoption", () => {
  it("imports the canonical RailContentCard family (not hand-rolled card chrome)", () => {
    expect(leadDetailsRailSrc).toMatch(
      /import\s*\{[\s\S]*?\bRailContentCard\b[\s\S]*?\bRailContentCardHeader\b[\s\S]*?\bRailContentCardTitle\b[\s\S]*?\bRailContentCardFieldList\b[\s\S]*?\bRailContentCardField\b[\s\S]*?\}\s*from\s*["']@\/components\/detail-rail\/RailContentCard["']/,
    );
  });

  it("the outer wrapper is <RailContentCard testId=\"lead-details-rail\"> (not a hand-rolled bg-white div)", () => {
    expect(leadDetailsRailSrc).toMatch(
      /<RailContentCard\s+testId="lead-details-rail">/,
    );
  });

  it("the legacy hand-rolled chrome is gone (no bg-white rounded-md border shadow-sm wrapper, no #f8fafc header bar)", () => {
    expect(leadDetailsRailCodeOnly).not.toMatch(
      /<div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden">/,
    );
    expect(leadDetailsRailCodeOnly).not.toMatch(/bg-\[#f8fafc\]/);
  });

  it("uses <RailContentCardHeader> + <RailContentCardTitle> for the \"Details\" header (no inline text-sm font-semibold span)", () => {
    expect(leadDetailsRailSrc).toMatch(
      /<RailContentCardHeader>[\s\S]{0,200}?<RailContentCardTitle>Details<\/RailContentCardTitle>/,
    );
  });

  it("uses <RailContentCardFieldList> + <RailContentCardField> for label/value rows (saved mode)", () => {
    // Saved-mode primary fields.
    expect(leadDetailsRailSrc).toMatch(
      /<RailContentCardField label="Estimated Value">/,
    );
    expect(leadDetailsRailSrc).toMatch(
      /<RailContentCardField label="Captured By">/,
    );
    expect(leadDetailsRailSrc).toMatch(
      /<RailContentCardField label="Created By">/,
    );
    // Audit-timestamp footer fields.
    expect(leadDetailsRailSrc).toMatch(
      /<RailContentCardField label="Created">/,
    );
  });

  it("LeadMetaRow (the prior MetaRow alias) is no longer imported here", () => {
    expect(leadDetailsRailSrc).not.toMatch(/LeadMetaRow/);
  });

  it("arbitrary px sizes (text-[11px]) and ad-hoc text-xs are gone from the body", () => {
    expect(leadDetailsRailCodeOnly).not.toMatch(/text-\[11px\]/);
    // The draft-mode estimated-value Input still sets `text-xs` on the
    // input element itself (matches the pre-existing input chrome —
    // canonical Input typography is a separate concern). What this pin
    // forbids is `text-xs` on the outer card body wrapper.
    expect(leadDetailsRailCodeOnly).not.toMatch(
      /space-y-2 text-xs/,
    );
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

// ── Scroll canonicalization (2026-05-08) ──────────────────────────
//
// App.tsx mounts `<main className="flex-1 overflow-auto">` as THE SOLE
// canonical vertical scroll surface. Pages must NOT introduce their own
// inner `flex-1 min-h-0 overflow-y-auto` wrappers — that produces a
// split-scroll feel where the rail (a sibling of the left-column-shell)
// stays static while only the inner column scrolls. Job Detail is the
// reference: padding + space-y on the body, scrolling delegated to
// `<main>`. Pin Lead Detail against regression on this contract.

describe("LeadDetailPage — single-scroll canonical layout (mirrors Job Detail)", () => {
  it("the body wrapper has no inner `overflow-y-auto` / `flex-1 min-h-0` (would create split-scroll)", () => {
    // Slice from the left-column-shell open to the rail-column open.
    const startIdx = leadDetailCodeOnly.indexOf(
      'data-testid="lead-detail-left-column-shell"',
    );
    const endIdx = leadDetailCodeOnly.indexOf(
      'data-testid="lead-detail-rail-column"',
      startIdx,
    );
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const leftSlice = leadDetailCodeOnly.slice(startIdx, endIdx);
    expect(leftSlice).not.toMatch(/overflow-y-auto/);
    // `flex-1 min-h-0` is the split-scroll smell when paired with
    // overflow-y-auto. Allow `lg:min-h-0` on the outer shell (that's
    // a flex-shrink hint, not a scroll trigger), but pin against any
    // INNER body using `flex-1 min-h-0` together.
    const innerBodyPattern = /<div\s+className="flex-1\s+min-h-0[^"]*"/;
    expect(leftSlice).not.toMatch(innerBodyPattern);
  });

  it("the body wrapper uses the canonical Job pattern: padding + space-y only", () => {
    // The body wrapper directly inside the shell should be
    // `<div className="px-4 lg:px-6 py-4 space-y-3">` — no flex / overflow.
    expect(leadDetailSrc).toMatch(
      /data-testid="lead-detail-left-column-shell"[\s\S]{0,1200}?<div\s+className="px-4 lg:px-6 py-4 space-y-3">/,
    );
  });

  it("no sticky-positioned chrome inside the left column (header scrolls with content)", () => {
    const startIdx = leadDetailCodeOnly.indexOf(
      'data-testid="lead-detail-left-column-shell"',
    );
    const endIdx = leadDetailCodeOnly.indexOf(
      'data-testid="lead-detail-rail-column"',
      startIdx,
    );
    const leftSlice = leadDetailCodeOnly.slice(startIdx, endIdx);
    // Pin against any `sticky` positioning class on a wrapper inside
    // the left column (matches `sticky` followed by whitespace, not
    // class names that happen to contain the substring like
    // `data-sticky-foo`).
    expect(leftSlice).not.toMatch(/className="[^"]*\bsticky\s/);
    expect(leftSlice).not.toMatch(/className="[^"]*\bsticky"/);
  });
});
