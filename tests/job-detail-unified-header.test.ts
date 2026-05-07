/**
 * Job Detail — unified detail header card (2026-05-07).
 *
 * Locks the contract that the JobDetailPage's top region is now ONE
 * unified primary detail card, not two stacked sections. The previous
 * standalone `<CanonicalDetailHeader>` strip + the separate
 * `card-job-context` CardShell were merged into a single CardShell
 * containing:
 *
 *   • Job summary H1 (`text-page-title font-semibold`)
 *   • Status pill inline beside the title
 *   • Client / location name link below the title
 *   • Service Address block below the client name
 *   • Three vertical meta blocks: Job # / Scheduled / Invoice #
 *   • Edit pencil + Add Equipment button + More-actions overflow menu
 *     + status-driven primary CTA, all pinned top-right via `self-start`
 *   • Job description (optional) section + Save/Cancel footer (kept
 *     from the existing card; not duplicated)
 *
 * This file is a STATIC SOURCE PIN — it reads JobDetailPage.tsx as a
 * string and asserts the structural / className / testid contract is
 * intact. It does not render React, so it cannot regress on visual
 * polish; it is the canary for "the merge stayed merged" rather than
 * a layout test.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const JOB_DETAIL = resolve(ROOT, "client/src/pages/JobDetailPage.tsx");
const jobDetailSrc = readFileSync(JOB_DETAIL, "utf-8");

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const codeOnly = stripComments(jobDetailSrc);

// ── 1. Standalone CanonicalDetailHeader strip is gone ──────────────

describe("JobDetailPage — standalone CanonicalDetailHeader strip removed", () => {
  it("does NOT import CanonicalDetailHeader", () => {
    // The component is still used by InvoiceDetailPage; it is the
    // import + mount on the Job page that the merge eliminates.
    expect(codeOnly).not.toMatch(
      /import\s*\{[^}]*\bCanonicalDetailHeader\b[^}]*\}\s*from\s*["']@\/components\/detail\/CanonicalDetailHeader["']/,
    );
  });

  it("does NOT render <CanonicalDetailHeader …> JSX anywhere", () => {
    expect(codeOnly).not.toMatch(/<CanonicalDetailHeader\b/);
  });
});

// ── 2. The unified card lives at the top of the page body ──────────

describe("JobDetailPage — unified detail header card", () => {
  it("the `job-detail-header` testid lives INSIDE the `card-job-context` CardShell", () => {
    // Capture the CardShell substring and assert the unified header
    // testid is a descendant — i.e. the merge happened structurally,
    // not just by coincidence of testids.
    const cardShellMatch = jobDetailSrc.match(
      /<CardShell\s+data-testid="card-job-context">([\s\S]*?)<\/CardShell>/,
    );
    expect(cardShellMatch).not.toBeNull();
    const cardShellBody = cardShellMatch![1];
    expect(cardShellBody).toMatch(/data-testid="job-detail-header"/);
  });

  it("renders the job summary H1 with text-page-title typography", () => {
    expect(jobDetailSrc).toMatch(
      /<h1[^>]*className="[^"]*\btext-page-title\b[^"]*\bfont-semibold\b[^"]*"[^>]*data-testid="job-detail-header-title"/,
    );
  });

  it("renders the editable summary textarea (edit-mode swap) with text-page-title typography", () => {
    expect(jobDetailSrc).toMatch(
      /<textarea[\s\S]*?className="[^"]*\btext-page-title\b[^"]*\bfont-semibold\b[^"]*"[\s\S]*?data-testid="input-job-summary-header"/,
    );
  });

  it("renders the StatusPill inline with the title (header-status-pill testid present)", () => {
    expect(jobDetailSrc).toMatch(
      /<StatusPill[\s\S]*?data-testid="header-status-pill"/,
    );
  });

  it("renders the client/location name link with text-section-title typography", () => {
    expect(jobDetailSrc).toMatch(
      /className="[^"]*\btext-section-title\b[^"]*"[\s\S]*?data-testid="link-client-context"/,
    );
  });

  it("renders the AddressBlock service-address binding (RAW location through resolver)", () => {
    expect(jobDetailSrc).toMatch(
      /<AddressBlock[\s\S]+?variant="job"[\s\S]+?label="Service Address"[\s\S]+?locationName=\{resolveServiceLocationName\(job\.location\?\.location,\s*clientName\)\}/,
    );
  });
});

// ── 3. Top-row layout — title-left, actions+meta-right, responsive ─

describe("JobDetailPage — title left / actions+meta right top row", () => {
  it("the top row is a column-on-mobile / row-on-lg flex (title doesn't get squeezed by meta+actions)", () => {
    // 2026-05-07 responsive fix: switched the 3-sibling flex-wrap row
    // (title / meta / actions) to a 2-sibling layout where actions +
    // meta share a right-side column. Below `lg`, the layout wraps
    // to a column so the right cluster drops below the title.
    expect(jobDetailSrc).toMatch(
      /<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"/,
    );
  });

  it("the title block carries `flex-1 min-w-0` so it can grow + shrink without being clipped", () => {
    expect(jobDetailSrc).toMatch(
      /<div className="flex-1 min-w-0[^"]*">/,
    );
  });

  it("the right-side wrapper carries `shrink-0 flex flex-col items-end gap-3` and a stable testid", () => {
    expect(jobDetailSrc).toMatch(
      /<div\s+className="shrink-0 flex flex-col items-end gap-3"\s+data-testid="job-detail-header-right"/,
    );
  });
});

// ── 4. Meta blocks — Job # / Scheduled / Invoice # ─────────────────

describe("JobDetailPage — meta blocks under the action cluster", () => {
  it("the meta wrapper sits INSIDE the `job-detail-header-right` column (under, not beside, the actions)", () => {
    // The right column wraps two children: actions (top) + meta
    // (under). Pin the right column → … → actions … → meta order so
    // a future refactor can't accidentally reverse them.
    const rightCol = jobDetailSrc.match(
      /data-testid="job-detail-header-right"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/,
    );
    expect(rightCol).not.toBeNull();
    expect(rightCol![0]).toMatch(/data-testid="job-detail-header-actions"/);
    expect(rightCol![0]).toMatch(/data-testid="job-detail-header-items"/);
    // Actions appear before meta in source order (actions on top).
    const actionsIdx = rightCol![0].indexOf('data-testid="job-detail-header-actions"');
    const metaIdx = rightCol![0].indexOf('data-testid="job-detail-header-items"');
    expect(actionsIdx).toBeGreaterThan(-1);
    expect(metaIdx).toBeGreaterThan(actionsIdx);
  });

  it("the meta wrapper allows wrapping with `flex-wrap justify-end`", () => {
    expect(jobDetailSrc).toMatch(
      /className="flex items-start gap-x-6 gap-y-3 flex-wrap justify-end"\s+data-testid="job-detail-header-items"/,
    );
  });

  it("renders the Job # meta block with text-label + text-row tokens", () => {
    const block = jobDetailSrc.match(
      /data-testid="job-detail-header-item-job-number"[\s\S]*?(?=data-testid="job-detail-header-item-scheduled")/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/Job #/);
    expect(block![0]).toMatch(/\btext-label\b/);
    expect(block![0]).toMatch(/\btext-row\b/);
    // The read-mode value is the canonical primary EntityNumber pill.
    expect(block![0]).toMatch(
      /<EntityNumber\s+variant="primary"[\s\S]*?data-testid="header-job-number-pill"/,
    );
    // The edit-mode swap is the inline number input.
    expect(block![0]).toMatch(/data-testid="input-job-number"/);
  });

  it("renders the Scheduled meta block with text-label + text-row tokens and tabular-nums values", () => {
    const block = jobDetailSrc.match(
      /data-testid="job-detail-header-item-scheduled"[\s\S]*?(?=data-testid="job-detail-header-item-invoice-number")/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/Scheduled/);
    expect(block![0]).toMatch(/\btext-label\b/);
    expect(block![0]).toMatch(/\btext-row\b/);
    expect(block![0]).toMatch(/\btabular-nums\b/);
    expect(block![0]).toMatch(/nextVisit\?\.scheduledStart/);
  });

  it("renders the Invoice # meta block with the canonical EntityNumber linked variant", () => {
    // Pin from the invoice testid forward to the close of the meta
    // wrapper. The meta wrapper closes 3 `</div>` deep (item, items,
    // right column) — anchor on the items testid via lookahead from
    // the closing chain, but easiest is a generous slice forward.
    const startIdx = jobDetailSrc.indexOf('data-testid="job-detail-header-item-invoice-number"');
    expect(startIdx).toBeGreaterThan(-1);
    const slice = jobDetailSrc.slice(startIdx, startIdx + 1500);
    expect(slice).toMatch(/Invoice #/);
    expect(slice).toMatch(/\btext-label\b/);
    expect(slice).toMatch(
      /<EntityNumber\s+variant="linked"[\s\S]*?data-testid="header-invoice-link"/,
    );
    // Missing-state placeholder — keeps the visual contract for jobs
    // that have no invoice yet.
    expect(slice).toMatch(/<EntityNumber\s+variant="missing"\s*\/>/);
  });

  it("meta blocks are NOT rendered inside the title block (would re-introduce the squeeze regression)", () => {
    // Slice from the title block opening up to the right-wrapper's
    // opening (anchored on the `job-detail-header-right` testid).
    // The title block lives entirely BEFORE that anchor in source
    // order, so this slice is a strict superset of the title's
    // content. None of the three meta testids may appear within.
    const titleStart = jobDetailSrc.indexOf('<div className="flex-1 min-w-0 max-w-2xl"');
    const rightStart = jobDetailSrc.indexOf('data-testid="job-detail-header-right"');
    expect(titleStart).toBeGreaterThan(-1);
    expect(rightStart).toBeGreaterThan(titleStart);
    const titleSlice = jobDetailSrc.slice(titleStart, rightStart);
    // Title slice must NOT contain meta testids.
    expect(titleSlice).not.toMatch(/data-testid="job-detail-header-items"/);
    expect(titleSlice).not.toMatch(/data-testid="job-detail-header-item-job-number"/);
    expect(titleSlice).not.toMatch(/data-testid="job-detail-header-item-scheduled"/);
    expect(titleSlice).not.toMatch(/data-testid="job-detail-header-item-invoice-number"/);
  });
});

// ── 5. Action cluster — top of the right-side column ───────────────

describe("JobDetailPage — action cluster sits at the top of the right column", () => {
  it("the actions wrapper is `flex items-center gap-2` (no longer needs `self-start` since the parent column handles alignment)", () => {
    expect(jobDetailSrc).toMatch(
      /<div\s+className="flex items-center gap-2"\s+data-testid="job-detail-header-actions"/,
    );
  });

  it("renders the edit pencil (button-edit-job-card)", () => {
    expect(jobDetailSrc).toMatch(/data-testid="button-edit-job-card"/);
  });

  it("does NOT render the Add Equipment combo button in the top header actions (moved to the rail's Equipment tab)", () => {
    // 2026-05-07 layout v4: Equipment actions moved out of the
    // top-header action cluster and into the canonical right-rail's
    // Equipment tab. The previous Wrench+Plus combo (testid
    // `button-add-equipment-header`) is gone from the page entirely.
    expect(jobDetailSrc).not.toMatch(/data-testid="button-add-equipment-header"/);
    // The replacement lives on the rail tab — pin its presence so a
    // future revert is caught.
    expect(jobDetailSrc).toMatch(/data-testid="button-add-equipment-rail"/);
  });

  it("renders the More-actions overflow menu (button-more-actions) inside the actions cluster", () => {
    const cluster = jobDetailSrc.match(
      /data-testid="job-detail-header-actions"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/,
    );
    expect(cluster).not.toBeNull();
    expect(cluster![0]).toMatch(/data-testid="button-more-actions"/);
  });

  it("renders all status-driven primary CTAs inside the actions cluster", () => {
    const cluster = jobDetailSrc.match(
      /data-testid="job-detail-header-actions"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/,
    );
    expect(cluster).not.toBeNull();
    expect(cluster![0]).toMatch(/data-testid="button-schedule-visit-action"/);
    expect(cluster![0]).toMatch(/data-testid="button-invoice-action"/);
    expect(cluster![0]).toMatch(/data-testid="button-restore-job"/);
  });
});

// ── 5. Description + edit footer kept inside the same card ─────────

describe("JobDetailPage — description + edit footer remain inside the unified card", () => {
  it("the description section + edit footer live inside the same `card-job-context` CardShell as the unified header", () => {
    const cardShellMatch = jobDetailSrc.match(
      /<CardShell\s+data-testid="card-job-context">([\s\S]*?)<\/CardShell>/,
    );
    expect(cardShellMatch).not.toBeNull();
    const cardShellBody = cardShellMatch![1];
    expect(cardShellBody).toMatch(/data-testid="job-description-section"/);
    expect(cardShellBody).toMatch(/data-testid="job-header-edit-footer"/);
    expect(cardShellBody).toMatch(/data-testid="button-header-save"/);
    expect(cardShellBody).toMatch(/data-testid="button-header-cancel"/);
  });

  it("there is exactly ONE CardShell with `card-job-context` testid (no duplicate header card)", () => {
    const matches = jobDetailSrc.match(/data-testid="card-job-context"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("there is exactly ONE `job-detail-header` testid (no duplicate header region)", () => {
    const matches = jobDetailSrc.match(/data-testid="job-detail-header"/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
