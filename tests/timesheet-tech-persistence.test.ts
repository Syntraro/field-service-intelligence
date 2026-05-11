/**
 * Timesheet technician selection persistence guard (2026-05-10).
 *
 * Locks the URL-threading mechanism that preserves selected-technician
 * state when the user switches between Day view (PayrollPage) and Week
 * view (WeekStackPage).
 *
 * Root cause (fixed): TimesheetsRoute in App.tsx conditionally renders
 * two completely independent components. Each remount previously reset
 * tech selection. The fix threads the tech ID via URL params so that:
 *
 *   Week → Day   already worked (WeekStackPage passes ?tech= in goToDay).
 *   Day  → Week  now works: PayrollPage includes ?tech= in the Week
 *                toggle navigation; WeekStackPage seeds its initial
 *                techId state from ?tech= on mount.
 *
 * Guards:
 *  1. WeekStackPage reads ?tech= URL param to seed initial techId.
 *  2. WeekStackPage auto-select effect defaults to first tech only when
 *     techId is empty (does NOT override a URL-seeded selection).
 *  3. WeekStackPage auto-select effect falls back to first tech when the
 *     URL-seeded tech is no longer in the technician list.
 *  4. PayrollPage Week-toggle navigation includes ?tech= when a tech
 *     is selected (preserves Day→Week flow).
 *  5. PayrollPage Week-toggle navigation still works without a tech
 *     selected (navigates cleanly to /timesheets).
 *  6. WeekStackPage Day-toggle still passes ?tech= when navigating to
 *     Day view (existing Week→Day flow preserved).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

function src(rel: string) {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

const WEEK = src("client/src/pages/timesheets/WeekStackPage.tsx");
const PAYROLL = src("client/src/pages/PayrollPage.tsx");

// ── 1. WeekStackPage — URL-param seeding ──────────────────────────

describe("WeekStackPage — seeds techId from URL ?tech= param", () => {
  it("reads window.location.search for initial techId", () => {
    // The useState initializer reads the URL param so a returning
    // Day→Week navigation that includes ?tech=<id> correctly seeds the
    // selection before the technician list loads.
    expect(WEEK).toMatch(/window\.location\.search.*get\(["']tech["']\)/s);
  });

  it("URL-seeded state is read inside useState initializer (not useEffect)", () => {
    // Must be in the initializer so the value is set synchronously on
    // mount — an effect would fire after render and cause a flicker.
    expect(WEEK).toMatch(/useState.*\(\s*\(\)\s*=>\s*\{[\s\S]*?window\.location\.search[\s\S]*?\}\s*\)/);
  });

  it("falls back to empty string when ?tech= is absent", () => {
    // The nullish coalescing fallback: .get("tech") ?? ""
    expect(WEEK).toMatch(/get\(["']tech["']\)\s*\?\?\s*["']["']/);
  });
});

// ── 2. WeekStackPage — auto-select effect is safe ────────────────

describe("WeekStackPage — auto-select effect does not override URL-seeded tech", () => {
  it("effect only sets first tech when techId is empty", () => {
    // Guard the exact condition: `!techId` — does NOT fire when
    // techId has a value (even a URL-seeded one).
    expect(WEEK).toMatch(/if.*!techId.*setTechId\(technicians\[0\]\.id\)/);
  });

  it("effect falls back to first tech when seeded tech is not in list", () => {
    // If the technician whose ID came from the URL no longer exists
    // in the fetched list, we gracefully fall back rather than keeping
    // a dangling ID that would cause a failed query.
    expect(WEEK).toMatch(/technicians\.find.*t.*t\.id.*techId/);
    expect(WEEK).toMatch(/setTechId\(technicians\[0\]\.id\)/);
  });

  it("effect bails early when technicians list is empty", () => {
    // Prevents premature reset while the list is still loading.
    expect(WEEK).toMatch(/technicians\.length.*===.*0.*return/);
  });
});

// ── 3. PayrollPage — Week toggle threads tech ID ─────────────────

describe("PayrollPage — Week toggle navigation includes tech ID", () => {
  it("Week toggle passes ?tech= when dayViewTechId is set", () => {
    // Previously this was setLocation("/timesheets") — a plain navigation
    // that caused WeekStackPage to mount with no tech context.
    expect(PAYROLL).toMatch(/dayViewTechId.*\/timesheets\?tech=\$\{dayViewTechId\}/);
  });

  it("Week toggle falls back to plain /timesheets when no tech is selected", () => {
    // Ternary must include the no-tech fallback so the button still
    // works on initial load before a tech is selected.
    expect(PAYROLL).toMatch(/dayViewTechId.*?.*\/timesheets["']/);
  });

  it("Week toggle is wired to the view-toggle-week testId button", () => {
    // The onClick with /timesheets appears before the data-testid in source.
    // Check that both exist on the same button within a reasonable proximity.
    expect(PAYROLL).toMatch(/timesheets[\s\S]{0,300}view-toggle-week/);
  });
});

// ── 4. Existing Week→Day threading preserved ─────────────────────

describe("WeekStackPage — Day toggle still threads tech ID", () => {
  it("goToDay includes ?tech= in the navigation URL", () => {
    expect(WEEK).toMatch(/timesheets\?view=day&tech=\$\{techId\}&date=/);
  });

  it("Day view toggle button includes ?tech= when tech is selected", () => {
    expect(WEEK).toMatch(/timesheets\?view=day&tech=\$\{techId\}/);
  });
});
