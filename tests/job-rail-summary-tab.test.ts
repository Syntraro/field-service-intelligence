/**
 * Job Detail right rail — Summary tab source-pin tests (2026-05-09, updated 2026-05-10).
 *
 * Verifies the Summary tab in JobDetailPage's canonical right rail:
 *   - Tab exists, is first, is the default open tab
 *   - Financial Summary card: buildFinancialSummaryContent helper invoked (no inline JSX)
 *   - testIds, billingTotals guards, and breakdown data in the builder
 *   - KPI hero / bar / color logic / token classes in the shared helper
 *   - Associated Visits: each subrow shows date, time range, and technician(s)
 *   - "Unassigned" fallback when no techs assigned
 *   - No duplicate data fetches — all data from existing component state
 *   - Existing Notes/Labour/Equipment tabs unaffected
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const JOB_DETAIL = resolve(ROOT, "client/src/pages/JobDetailPage.tsx");
const HELPER = resolve(ROOT, "client/src/components/detail-rail/buildFinancialSummaryContent.tsx");

const jobDetailSrc = readFileSync(JOB_DETAIL, "utf-8");
const helperSrc = readFileSync(HELPER, "utf-8");

// Extract just the builder function body for scoped assertions.
const builderStart = jobDetailSrc.indexOf("const buildJobSummaryPanelDescriptor");
const builderEnd = jobDetailSrc.indexOf("\n  };", builderStart) + 5;
const builderSrc = jobDetailSrc.slice(builderStart, builderEnd);

// ── 1. Tab existence, default, and type ───────────────────────────

describe("JobDetailPage Summary tab — existence and default", () => {
  it("declares `id: \"summary\"` as the first tab in jobRailTabs", () => {
    const arrStart = jobDetailSrc.indexOf("const jobRailTabs:");
    expect(arrStart).toBeGreaterThan(-1);
    const arrEnd = jobDetailSrc.indexOf("];", arrStart);
    const firstId = jobDetailSrc.slice(arrStart, arrEnd).match(/\bid:\s*"(\w+)"/)?.[1];
    expect(firstId).toBe("summary");
  });

  it("Summary tab carries label \"Summary\", BarChart2 icon, stable testId", () => {
    expect(jobDetailSrc).toMatch(
      /id:\s*"summary"[\s\S]{0,400}?label:\s*"Summary"[\s\S]{0,400}?icon:\s*BarChart2[\s\S]{0,400}?testId:\s*"job-rail-tab-summary"/,
    );
  });

  it("default open tab is \"summary\"", () => {
    expect(jobDetailSrc).toMatch(
      /useState<JobRailTab\s*\|\s*null>\(\s*"summary"\s*\)/,
    );
  });

  it("JobRailTab type union includes \"summary\"", () => {
    expect(jobDetailSrc).toMatch(/type\s+JobRailTab\s*=\s*"summary"\s*\|/);
  });

  it("BarChart2 imported from lucide-react", () => {
    expect(jobDetailSrc).toMatch(
      /import\s*\{[\s\S]*?\bBarChart2\b[\s\S]*?\}\s*from\s*["']lucide-react["']/,
    );
  });
});

// ── 2. Summary tab content — RailPanelRenderer wiring ─────────────

describe("JobDetailPage Summary tab — RailPanelRenderer wiring", () => {
  it("Summary tab content mounts <RailPanelRenderer> inside data-testid=\"card-summary\"", () => {
    expect(jobDetailSrc).toMatch(
      /id:\s*"summary"[\s\S]{0,1000}?data-testid="card-summary"[\s\S]{0,800}?<RailPanelRenderer/,
    );
  });

  it("Summary panel uses testIdPrefix=\"job-summary\"", () => {
    const idx = jobDetailSrc.indexOf('data-testid="card-summary"');
    expect(idx).toBeGreaterThan(-1);
    const slice = jobDetailSrc.slice(idx, idx + 600);
    expect(slice).toMatch(/testIdPrefix="job-summary"/);
  });

  it("descriptor builder is named buildJobSummaryPanelDescriptor, returns RailPanelDescriptor", () => {
    expect(jobDetailSrc).toMatch(
      /const\s+buildJobSummaryPanelDescriptor\s*=\s*\(\s*\)\s*:\s*RailPanelDescriptor/,
    );
  });

  it("descriptor kind is \"list\" with testId \"job-summary-panel\"", () => {
    expect(builderSrc).toMatch(/kind:\s*"list"/);
    expect(builderSrc).toMatch(/testId:\s*"job-summary-panel"/);
  });
});

// ── 3. Financial Summary — shared helper invoked, no inline JSX ────

describe("JobDetailPage Summary tab — Financial Summary helper invocation", () => {
  it("Financial Summary card uses extraContent: buildFinancialSummaryContent (not raw JSX)", () => {
    expect(builderSrc).toMatch(/extraContent:\s*buildFinancialSummaryContent\(/);
    expect(builderSrc).not.toMatch(/fields:\s*\[/);
  });

  it("buildFinancialSummaryContent imported from the shared helper module", () => {
    expect(jobDetailSrc).toMatch(
      /import.*buildFinancialSummaryContent.*from.*detail-rail\/buildFinancialSummaryContent/,
    );
  });

  it("margin testId \"job-summary-margin-pct\" passed as argument", () => {
    expect(builderSrc).toMatch(/"job-summary-margin-pct"/);
  });

  it("bar testId \"job-summary-margin-bar\" passed as argument", () => {
    expect(builderSrc).toMatch(/"job-summary-margin-bar"/);
  });

  it("hasData guard passes !!billingTotals to helper", () => {
    expect(builderSrc).toMatch(/hasData:\s*!!billingTotals/);
  });

  it("bar clamping logic delegated to helper (not duplicated in builder)", () => {
    expect(builderSrc).not.toMatch(/Math\.max\(0/);
    expect(helperSrc).toMatch(/Math\.max\(0,\s*Math\.min\(100,\s*Math\.abs\(marginPct\)\)\)/);
  });

  it("margin % display (Math.round) delegated to helper", () => {
    expect(builderSrc).not.toMatch(/Math\.round\(/);
    expect(helperSrc).toMatch(/Math\.round\(marginPct\)/);
  });
});

// ── 4. Financial Summary — positive/negative semantic color tokens ─

describe("JobDetailPage Summary tab — Financial Summary profit/margin color logic", () => {
  it("isProfit flag derived from profit >= 0 (in shared helper)", () => {
    expect(helperSrc).toMatch(/isProfit\s*=\s*profit\s*>=\s*0/);
  });

  it("positive path uses text-success semantic token (in shared helper)", () => {
    expect(helperSrc).toMatch(/isProfit\s*\?\s*"text-success"\s*:\s*"text-danger"/);
  });

  it("positive path uses bg-success for the indicator bar (in shared helper)", () => {
    expect(helperSrc).toMatch(/isProfit\s*\?\s*"bg-success"\s*:\s*"bg-danger"/);
  });

  it("profitColor class applied at least twice in helper (margin % + profit total)", () => {
    const occurrences = (helperSrc.match(/\$\{profitColor\}/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("no raw color classes in helper (no text-emerald-* / text-red-*)", () => {
    expect(helperSrc).not.toMatch(/text-emerald-\d+/);
    expect(helperSrc).not.toMatch(/text-red-\d+/);
    expect(helperSrc).not.toMatch(/text-green-\d+/);
  });
});

// ── 5. Financial Summary — breakdown rows and profit total ─────────

describe("JobDetailPage Summary tab — Financial Summary breakdown rows", () => {
  it("Revenue row testId \"job-summary-revenue\" passed to helper", () => {
    expect(builderSrc).toMatch(/"job-summary-revenue"/);
  });

  it("Revenue row value reads billingTotals.totalPrice with '—' guard", () => {
    expect(builderSrc).toMatch(/billingTotals\s*\?\s*formatCurrency\(billingTotals\.totalPrice\)\s*:\s*"—"/);
  });

  it("Labour row testId \"job-summary-labour-cost\" passed to helper", () => {
    expect(builderSrc).toMatch(/"job-summary-labour-cost"/);
  });

  it("Labour row value reads labourBuckets.totalCost", () => {
    expect(builderSrc).toMatch(/formatCurrency\(labourBuckets\.totalCost\)/);
  });

  it("Expenses row testId \"job-summary-expenses\" passed to helper", () => {
    expect(builderSrc).toMatch(/"job-summary-expenses"/);
  });

  it("Expenses row value reads expenseTotalAmount", () => {
    expect(builderSrc).toMatch(/formatCurrency\(expenseTotalAmount\)/);
  });

  it("profitTestId \"job-summary-profit\" + billingTotals.profit guard in builder", () => {
    expect(builderSrc).toMatch(/"job-summary-profit"/);
    expect(builderSrc).toMatch(/billingTotals\s*\?\s*formatCurrency\(billingTotals\.profit\)\s*:\s*"—"/);
  });

  it("Revenue and Profit show '—' guard when billingTotals is null", () => {
    const dashGuards = builderSrc.match(/billingTotals\s*\?[^:]+:\s*"—"/g) ?? [];
    expect(dashGuards.length).toBeGreaterThanOrEqual(2);
  });

  it("breakdown rows use text-row canonical token (in shared helper)", () => {
    expect(helperSrc).toMatch(/text-row/);
    expect(builderSrc).not.toMatch(/\btext-xs\b/);
    expect(builderSrc).not.toMatch(/\btext-sm\b/);
  });

  it("profit total row uses text-emphasis canonical token (in shared helper)", () => {
    expect(helperSrc).toMatch(/text-emphasis/);
  });

  it("margin hero uses text-header canonical token (in shared helper)", () => {
    expect(helperSrc).toMatch(/text-header/);
    expect(helperSrc).not.toMatch(/text-display/);
  });

  it("MARGIN eyebrow uses text-label canonical token (in shared helper)", () => {
    expect(helperSrc).toMatch(/text-label/);
  });
});

// ── 6. Associated Visits — date, time, technician display ─────────

describe("JobDetailPage Summary tab — Associated Visits date/time/tech", () => {
  it("visit subrows built from jobVisitsAll — no new useQuery / apiRequest", () => {
    expect(builderSrc).toMatch(/jobVisitsAll/);
    expect(builderSrc).not.toMatch(/useQuery\b/);
    expect(builderSrc).not.toMatch(/apiRequest\b/);
  });

  it("visit onClick wires to setSelectedVisitId (existing VisitEditorLauncher flow)", () => {
    expect(builderSrc).toMatch(/onClick:\s*\(\)\s*=>\s*setSelectedVisitId\(visit\.id\)/);
  });

  it("visit date formatted with format(new Date(visit.scheduledStart), ...)", () => {
    expect(builderSrc).toMatch(/format\(new Date\(visit\.scheduledStart\)/);
  });

  it("visit time range shown in meta.leftText (start–end format)", () => {
    expect(builderSrc).toMatch(/leftText:\s*timeLabel/);
    expect(builderSrc).toMatch(/scheduledEnd/);
    expect(builderSrc).toMatch(/format\(new Date\(visit\.scheduledStart\),\s*"h:mm a"\)/);
    expect(builderSrc).toMatch(/format\(new Date\(visit\.scheduledEnd\),\s*"h:mm a"\)/);
  });

  it("technician names shown in meta.rightText from techByIdMap lookup", () => {
    expect(builderSrc).toMatch(/rightText:\s*techLabel/);
    expect(builderSrc).toMatch(/techByIdMap\.get\(id\)/);
  });

  it("\"Unassigned\" shown when assignedTechnicianIds is empty or null", () => {
    expect(builderSrc).toMatch(/"Unassigned"/);
    expect(builderSrc).toMatch(/assignedTechnicianIds/);
  });

  it("status chip retained on visit subrow title (secondary indicator)", () => {
    expect(builderSrc).toMatch(/chip:\s*resolveVisitChip\(visit\.status\)/);
  });

  it("empty visits case shows meta text (no visits scheduled)", () => {
    expect(builderSrc).toMatch(/meta:\s*"No visits scheduled\."/);
  });
});

// ── 7. Existing tabs unaffected ────────────────────────────────────

describe("JobDetailPage Summary tab — existing tabs unaffected", () => {
  it("Notes tab still present with EntityNotesPanel", () => {
    expect(jobDetailSrc).toMatch(/id:\s*"notes"[\s\S]{0,3000}?<EntityNotesPanel/);
  });

  it("Labour tab still present with buildJobLabourPanelDescriptor", () => {
    expect(jobDetailSrc).toMatch(/id:\s*"labour"/);
    expect(jobDetailSrc).toMatch(/buildJobLabourPanelDescriptor/);
  });

  it("Equipment tab still present with JobEquipmentSection", () => {
    expect(jobDetailSrc).toMatch(/id:\s*"equipment"[\s\S]{0,3000}?<JobEquipmentSection/);
  });

  it("tab count is FOUR (Summary + Notes + Labour + Equipment)", () => {
    const arrStart = jobDetailSrc.indexOf("const jobRailTabs:");
    const arrEnd = jobDetailSrc.indexOf("];", arrStart);
    const idMatches = jobDetailSrc.slice(arrStart, arrEnd).match(/\bid:\s*"\w+"/g) ?? [];
    expect(idMatches.length).toBe(4);
  });
});

// ── 8. No one-off card chrome in Summary tab slot ─────────────────

describe("JobDetailPage Summary tab — no one-off card chrome", () => {
  it("Summary tab content slot only mounts RailPanelRenderer — no inline RailContentCard slot primitives", () => {
    const summaryTabIdx = jobDetailSrc.indexOf('id: "summary"');
    const notesTabIdx = jobDetailSrc.indexOf('id: "notes"', summaryTabIdx);
    const summaryTabSlice = jobDetailSrc.slice(summaryTabIdx, notesTabIdx);
    expect(summaryTabSlice).not.toMatch(/<RailContentCardHeader/);
    expect(summaryTabSlice).not.toMatch(/<RailContentCardTitle/);
  });

  it("Summary tab has no action button (read-only panel)", () => {
    const summaryTabIdx = jobDetailSrc.indexOf('id: "summary"');
    const notesTabIdx = jobDetailSrc.indexOf('id: "notes"', summaryTabIdx);
    const summaryTabSlice = jobDetailSrc.slice(summaryTabIdx, notesTabIdx);
    expect(summaryTabSlice).not.toMatch(/\baction:\s*\(/);
  });
});
