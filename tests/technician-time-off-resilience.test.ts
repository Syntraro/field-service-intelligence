/**
 * Technician Time Off — regression guards for the post-feature
 * dashboard load failure (2026-05-07 RALPH).
 *
 * After the time-off feature shipped, three issues surfaced together:
 *
 *   1. The capacity service crashed when the `technician_time_off`
 *      table didn't exist (e.g., when the migration hadn't been
 *      applied to the running database). React Query then retried
 *      the failed `/api/dashboard/capacity` request with backoff for
 *      ~30 seconds before settling on an empty response, which the
 *      schedule card rendered as "No technicians in the selected
 *      scope." Capacity must be RESILIENT to a missing time-off
 *      table — a missing migration cannot block the canonical
 *      dashboard endpoint.
 *
 *   2. The Column / Stacked display-mode toggle gated on `!compact`,
 *      and `compact` is now derived from the page's
 *      `scheduleActiveTechCount` (post-idle-grouping). When zero
 *      techs are currently active (every tech idle, or every tech on
 *      time-off), `compact === true` and the toggle disappeared,
 *      stranding the user in stacked mode with no way back. The
 *      toggle should remain visible whenever the company has ≥ 2
 *      schedulable techs (`isMultiTech`), regardless of how many of
 *      them are currently active.
 *
 *   3. There was no inline error state on the schedule card. When
 *      the capacity endpoint failed for any reason, the card showed
 *      a long loading spinner and then "No technicians in the
 *      selected scope" — indistinguishable from a legitimate empty
 *      team. The error state surfaces the failure + a Retry button
 *      so the user can recover the moment the backend is healthy.
 *
 * These pins make sure none of the three regressions can come back.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const CAPACITY_PATH = path("server/storage/capacity.ts");
const PAGE_PATH = path("client/src/pages/FinancialDashboard.tsx");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

// ─── 1. Capacity is resilient to a missing time_off table ──────────

describe("Capacity service — resilient to missing technician_time_off table", () => {
  const code = read(CAPACITY_PATH);
  const codeNoComments = stripComments(code);

  it("wraps the listOverlapping call in try/catch", () => {
    expect(codeNoComments).toMatch(
      /try\s*\{\s*todaysTimeOff\s*=\s*await\s*technicianTimeOffRepository\.listOverlapping/,
    );
    expect(codeNoComments).toMatch(/catch\s*\(err\)\s*\{/);
  });

  it("logs a warning instead of crashing the endpoint when the query fails", () => {
    expect(codeNoComments).toMatch(/console\.warn/);
    expect(code).toMatch(
      /\[capacity\] listOverlapping\(time_off\) failed; treating as empty/,
    );
  });

  it("falls back to an empty time-off array so the per-tech loop still runs", () => {
    expect(codeNoComments).toMatch(
      /let todaysTimeOff:\s*Awaited<\s*ReturnType<typeof technicianTimeOffRepository\.listOverlapping>\s*>\s*=\s*\[\]/,
    );
  });

  it("the for-loop that consumes todaysTimeOff is unchanged (no behaviour drift)", () => {
    // The fold-into-busyByTech logic still runs; it just iterates
    // an empty array when the table is missing.
    expect(codeNoComments).toMatch(/for \(const t of todaysTimeOff\)/);
  });
});

// ─── 2. Display-mode toggle visibility — gates on isMultiTech ──────

describe("Display-mode toggle — visible whenever isMultiTech", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("showDisplayModeToggle = isStackedMode || isMultiTech (NOT !compact)", () => {
    expect(codeNoComments).toMatch(
      /const showDisplayModeToggle\s*=\s*isStackedMode\s*\|\|\s*isMultiTech/,
    );
    // The OLD rule (`isStackedMode || !compact`) is gone — verify so
    // a future refactor can't quietly bring it back.
    expect(codeNoComments).not.toMatch(
      /const showDisplayModeToggle\s*=\s*isStackedMode\s*\|\|\s*!compact/,
    );
  });

  it("isMultiTech is derived from techs.length > 1 (the canonical signal)", () => {
    expect(codeNoComments).toMatch(/const isMultiTech\s*=\s*techs\.length\s*>\s*1/);
  });

  it("team-filter Popover trigger still gates on isMultiTech (preserved)", () => {
    expect(codeNoComments).toMatch(/teamFilterControl = isMultiTech \?/);
  });
});

// ─── 3. Schedule card error state ──────────────────────────────────

describe("Schedule card — error state when capacityQuery fails", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("renders a schedule-error-state branch on capacityQuery.isError", () => {
    expect(codeNoComments).toMatch(
      /capacityQuery\.isError\s*\?[\s\S]*?data-testid="schedule-error-state"/,
    );
  });

  it("the error state shows a clear copy plus a Retry button wired to refetch()", () => {
    expect(code).toMatch(/Couldn't load today's schedule/);
    expect(code).toMatch(/data-testid="schedule-error-retry"/);
    expect(code).toMatch(/capacityQuery\.refetch\(\)/);
  });

  it("the error branch is checked BEFORE the empty-techs branch", () => {
    // The order matters — error first so a backend failure doesn't
    // get rendered as "No technicians in the selected scope."
    const isErrorIdx = codeNoComments.indexOf("capacityQuery.isError ?");
    const noTechsIdx = codeNoComments.indexOf(
      "No technicians in the selected scope",
    );
    expect(isErrorIdx).toBeGreaterThan(0);
    expect(noTechsIdx).toBeGreaterThan(0);
    expect(isErrorIdx).toBeLessThan(noTechsIdx);
  });

  it("capacity query caps retry at 1 so errors surface in ~1-2 s instead of ~30 s", () => {
    // Find the schedule card's capacityQuery (the second occurrence
    // — the first is the page-level lifted query).
    expect(codeNoComments).toMatch(
      /queryKey:\s*\["\/api\/dashboard\/capacity"\][\s\S]{0,400}retry:\s*1/,
    );
  });

  it("loading skeleton still renders BEFORE the error/empty branches", () => {
    const loadingIdx = codeNoComments.indexOf("capacityQuery.isLoading");
    const errorIdx = codeNoComments.indexOf("capacityQuery.isError");
    expect(loadingIdx).toBeGreaterThan(0);
    expect(errorIdx).toBeGreaterThan(loadingIdx);
  });
});

// ─── 4. Header controls remain visible during loading + error ──────

describe("Header controls — visible regardless of capacity result", () => {
  const code = read(PAGE_PATH);
  const codeNoComments = stripComments(code);

  it("openOnlyToggleControl is unconditional (not gated on data presence)", () => {
    // Pin: const openOnlyToggleControl = ( <button ... /> );
    // — declared without a ternary on data state.
    expect(codeNoComments).toMatch(
      /const openOnlyToggleControl\s*=\s*\(\s*<button/,
    );
  });

  it("teamFilterControl renders whenever isMultiTech (data presence is implicit)", () => {
    // isMultiTech is `techs.length > 1` — once the query lands with
    // any 2+ tech response, the team filter renders. While loading,
    // techs is [] and the filter is hidden — but the brief allows
    // this since the loading skeleton occupies the body.
    expect(codeNoComments).toMatch(/teamFilterControl = isMultiTech \?/);
  });

  it("the controls cluster always renders the three constants in default mode", () => {
    // `<div className="flex items-center gap-2 flex-wrap justify-end">
    //    {openOnlyToggleControl}
    //    {teamFilterControl}
    //    {displayModeToggleControl}
    //  </div>`
    const collapsed = codeNoComments.replace(/\s+/g, " ");
    expect(collapsed).toMatch(
      /\{openOnlyToggleControl\}\s*\{teamFilterControl\}\s*\{displayModeToggleControl\}/,
    );
  });
});
