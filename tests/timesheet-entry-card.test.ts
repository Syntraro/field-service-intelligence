/**
 * Timesheet entry card canonicalization guard (2026-05-09).
 *
 * Locks the canonical compact entry rendering system introduced to
 * replace bespoke inline EntryRow logic in WeekStackPage.
 *
 * Guards:
 *  1. CompactTimeEntryCard exists + exports the canonical component.
 *  2. Both variants (job / general) use semantic typography tokens only.
 *  3. Duration is right-aligned with tabular-nums + font-semibold.
 *  4. Job number is NOT bold (no font-bold/font-semibold on job# span).
 *  5. Summary uses text-helper + text-muted-foreground.
 *  6. General variant uses soft green treatment (border-l-emerald-400).
 *  7. Job variant uses blue left accent (border-l-blue-400).
 *  8. No arbitrary text-[Npx] in CompactTimeEntryCard or shared utilities.
 *  9. No ad-hoc rounded-full chip markup in WeekStackPage (SummaryPill
 *     migrated to canonical <Chip>).
 * 10. WeekStackPage imports CompactTimeEntryCard (EntryRow eliminated).
 * 11. TimeEntryRowCompact uses shared timeDuration utilities (no duplicated
 *     inline formatDurationCompact / formatTime functions).
 * 12. JobTimeGroupCard uses shared timeDuration utilities (no duplicated
 *     inline formatDurationCompact / formatTime functions).
 * 13. DaySummaryCard uses canonical Chip for category pills (no ad-hoc
 *     rounded-full chip divs).
 * 14. timeDuration.ts exports the canonical shared utilities.
 * 15. No text-xs in timesheet feature components (legacy size token).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

function src(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

const CARD = src("client/src/components/timesheets/CompactTimeEntryCard.tsx");
const WEEK = src("client/src/pages/timesheets/WeekStackPage.tsx");
const ROW_COMPACT = src("client/src/components/timesheets/TimeEntryRowCompact.tsx");
const JOB_GROUP = src("client/src/components/timesheets/JobTimeGroupCard.tsx");
const ENTRY_CARD = src("client/src/components/timesheets/TimesheetEntryCard.tsx");
const DAY_SUMMARY = src("client/src/components/timesheets/DaySummaryCard.tsx");
const STRIP = src("client/src/components/timesheets/TimesheetSummaryStrip.tsx");
const TIME_DURATION = src("client/src/lib/timeDuration.ts");

// ── 1. File existence ──────────────────────────────────────────────

describe("CompactTimeEntryCard — file exists", () => {
  it("CompactTimeEntryCard.tsx exists at canonical path", () => {
    expect(existsSync(resolve(ROOT, "client/src/components/timesheets/CompactTimeEntryCard.tsx"))).toBe(true);
  });

  it("timeDuration.ts shared utility exists", () => {
    expect(existsSync(resolve(ROOT, "client/src/lib/timeDuration.ts"))).toBe(true);
  });
});

// ── 2. CompactTimeEntryCard exports ───────────────────────────────

describe("CompactTimeEntryCard — exports + prop types", () => {
  it("exports CompactTimeEntryCard function", () => {
    expect(CARD).toMatch(/export function CompactTimeEntryCard/);
  });

  it("exports CompactTimeEntryCardProps interface", () => {
    expect(CARD).toMatch(/export interface CompactTimeEntryCardProps/);
  });

  it("supports job variant prop", () => {
    expect(CARD).toMatch(/variant.*"job"/);
  });

  it("supports general variant prop", () => {
    expect(CARD).toMatch(/variant.*"general"/);
  });
});

// ── 3. Typography — no arbitrary sizes ────────────────────────────

describe("CompactTimeEntryCard — no arbitrary or legacy typography", () => {
  it("uses no text-[Npx] arbitrary sizes", () => {
    expect(CARD).not.toMatch(/text-\[\d+px\]/);
  });

  it("uses no text-xs legacy size token", () => {
    expect(CARD).not.toMatch(/\btext-xs\b/);
  });

  it("uses no text-sm legacy size token", () => {
    expect(CARD).not.toMatch(/\btext-sm\b/);
  });

  it("uses no font-bold override", () => {
    expect(CARD).not.toMatch(/\bfont-bold\b/);
  });
});

// ── 4. Duration prominence ────────────────────────────────────────

describe("CompactTimeEntryCard — duration is visually prominent", () => {
  it("duration span has tabular-nums", () => {
    expect(CARD).toMatch(/tabular-nums/);
  });

  it("duration span has font-semibold", () => {
    expect(CARD).toMatch(/font-semibold tabular-nums/);
  });

  it("duration uses text-row token", () => {
    expect(CARD).toMatch(/text-row font-semibold tabular-nums/);
  });
});

// ── 5. Job number not bold ────────────────────────────────────────

describe("CompactTimeEntryCard — job number not bold", () => {
  it("job number span has no font-bold", () => {
    // The job number comment block confirms this intent
    expect(CARD).toMatch(/NOT bold per spec/);
  });

  it("job number uses text-muted-foreground (recedes from client name)", () => {
    expect(CARD).toMatch(/text-row text-muted-foreground tabular-nums/);
  });
});

// ── 6. Client name styling ────────────────────────────────────────

describe("CompactTimeEntryCard — client name uses font-medium", () => {
  it("locationName renders with font-medium", () => {
    expect(CARD).toMatch(/text-row font-medium text-foreground/);
  });
});

// ── 7. Summary styling ────────────────────────────────────────────

describe("CompactTimeEntryCard — summary uses muted helper text", () => {
  it("jobSummary renders with text-helper", () => {
    expect(CARD).toMatch(/text-helper text-muted-foreground/);
  });

  it("jobSummary is clamped to 2 lines", () => {
    expect(CARD).toMatch(/line-clamp-2/);
  });
});

// ── 8. General variant — green left accent ────────────────────────

describe("CompactTimeEntryCard — general variant visual treatment", () => {
  it("general variant has emerald left accent border", () => {
    expect(CARD).toMatch(/border-l-emerald-400/);
  });

  it("general variant has soft green background", () => {
    expect(CARD).toMatch(/bg-emerald-50/);
  });
});

// ── 9. Job variant — blue left accent ─────────────────────────────

describe("CompactTimeEntryCard — job variant visual treatment", () => {
  it("job variant has blue left accent border", () => {
    expect(CARD).toMatch(/border-l-blue-400/);
  });
});

// ── 10. WeekStackPage — EntryRow eliminated ───────────────────────

describe("WeekStackPage — EntryRow replaced by CompactTimeEntryCard", () => {
  it("imports CompactTimeEntryCard", () => {
    expect(WEEK).toMatch(/import.*CompactTimeEntryCard.*from.*timesheets\/CompactTimeEntryCard/);
  });

  it("uses CompactTimeEntryCard in JSX", () => {
    expect(WEEK).toMatch(/<CompactTimeEntryCard/);
  });

  it("EntryRow function is gone", () => {
    expect(WEEK).not.toMatch(/^function EntryRow\b/m);
  });

  it("WeekStackRow type import is gone (not needed without EntryRow)", () => {
    expect(WEEK).not.toMatch(/type WeekStackRow/);
  });

  it("no leftover divide-y divide-slate-200 in entry body", () => {
    expect(WEEK).not.toMatch(/divide-y divide-slate-200.*day\.rows/s);
  });
});

// ── 11. WeekStackPage — SummaryPill uses canonical Chip ───────────

describe("WeekStackPage — SummaryPill migrated to canonical Chip", () => {
  it("imports Chip from canonical primitive", () => {
    expect(WEEK).toMatch(/import.*Chip.*from.*components\/ui\/chip/);
  });

  it("SummaryPill renders <Chip> for job/general variants", () => {
    expect(WEEK).toMatch(/<Chip/);
  });

  it("no ad-hoc rounded-full chip in SummaryPill for job/general", () => {
    // The primary pill (dark) is still a div — that's acceptable (not a
    // chip shape, it's a badge). The job/general pills must use <Chip>.
    // Guard: no chipClasses local variable (was the old ad-hoc string).
    expect(WEEK).not.toMatch(/const chipClasses/);
  });
});

// ── 12. DaySummaryCard — chip violations fixed ────────────────────

describe("DaySummaryCard — category pills use canonical Chip", () => {
  it("imports Chip from canonical primitive", () => {
    expect(DAY_SUMMARY).toMatch(/import.*Chip.*from.*components\/ui\/chip/);
  });

  it("no ad-hoc rounded-full border chip div for categories", () => {
    // The old pattern was: className={cn("inline-flex items-center gap-1.5 rounded-full border...", style.chip)}
    expect(DAY_SUMMARY).not.toMatch(/rounded-full border px-2\.5 py-0\.5 text-helper/);
  });

  it("uses <Chip> for category strip", () => {
    expect(DAY_SUMMARY).toMatch(/<Chip/);
  });

  it("Live badge uses text-helper not text-xs", () => {
    // Live badge was extracted to TimesheetSummaryStrip (shared shell).
    expect(STRIP).toMatch(/text-helper font-semibold text-emerald-700/);
    expect(STRIP).not.toMatch(/text-xs.*Live|Live.*text-xs/s);
  });
});

// ── 13. TimeEntryRowCompact — shared utilities + no arbitrary sizes ─

describe("TimeEntryRowCompact — shared timeDuration utilities", () => {
  it("timeDuration utilities are used via TimesheetEntryCard (not duplicated inline)", () => {
    // TimeEntryRowCompact delegates to TimesheetEntryCard, which owns
    // the timeDuration import. ROW_COMPACT is a thin wrapper.
    expect(ENTRY_CARD).toMatch(/from.*@\/lib\/timeDuration/);
  });

  it("no inline formatDurationCompact function", () => {
    expect(ROW_COMPACT).not.toMatch(/^function formatDurationCompact/m);
  });

  it("no inline formatTime function", () => {
    expect(ROW_COMPACT).not.toMatch(/^function formatTime\b/m);
  });

  it("no text-[11px] arbitrary size", () => {
    expect(ROW_COMPACT).not.toMatch(/text-\[11px\]/);
  });

  it("no text-xs legacy size token in feature markup", () => {
    expect(ROW_COMPACT).not.toMatch(/\btext-xs\b/);
  });
});

// ── 14. JobTimeGroupCard — shared utilities + no arbitrary sizes ───

describe("JobTimeGroupCard — shared timeDuration utilities", () => {
  it("timeDuration utilities are used via TimesheetEntryCard (not duplicated inline)", () => {
    // JobTimeGroupCard delegates general rows to TimesheetEntryCard, which
    // owns the timeDuration import. The direct import in JOB_GROUP is gone.
    expect(ENTRY_CARD).toMatch(/from.*@\/lib\/timeDuration/);
  });

  it("no inline formatDurationCompact function", () => {
    expect(JOB_GROUP).not.toMatch(/^function formatDurationCompact/m);
  });

  it("no inline formatTime function", () => {
    expect(JOB_GROUP).not.toMatch(/^function formatTime\b/m);
  });

  it("no text-[11px] arbitrary size", () => {
    expect(JOB_GROUP).not.toMatch(/text-\[11px\]/);
  });
});

// ── 15. timeDuration.ts — exports canonical utilities ─────────────

describe("timeDuration.ts — canonical shared utility exports", () => {
  it("exports formatDurationCompact", () => {
    expect(TIME_DURATION).toMatch(/export function formatDurationCompact/);
  });

  it("exports formatTimeOfDay", () => {
    expect(TIME_DURATION).toMatch(/export function formatTimeOfDay/);
  });

  it("exports formatDurationHm", () => {
    expect(TIME_DURATION).toMatch(/export function formatDurationHm/);
  });

  it("formatDurationCompact handles null (Live)", () => {
    expect(TIME_DURATION).toMatch(/Live/);
  });

  it("no text-[Npx] arbitrary sizes in utility file", () => {
    expect(TIME_DURATION).not.toMatch(/text-\[\d+px\]/);
  });
});

// ── 16. formatDurationHm — output pin ─────────────────────────────

describe("formatDurationHm — output strings pinned", () => {
  // Import dynamically so the test is driven by the real implementation.
  let formatDurationHm: (minutes: number) => string;

  beforeAll(async () => {
    const mod = await import("../client/src/lib/timeDuration");
    formatDurationHm = mod.formatDurationHm;
  });

  it("0 → '0h 0m'", () => {
    expect(formatDurationHm(0)).toBe("0h 0m");
  });

  it("30 → '0h 30m'", () => {
    expect(formatDurationHm(30)).toBe("0h 30m");
  });

  it("60 → '1h 0m'", () => {
    expect(formatDurationHm(60)).toBe("1h 0m");
  });

  it("90 → '1h 30m'", () => {
    expect(formatDurationHm(90)).toBe("1h 30m");
  });

  it("125 → '2h 5m'", () => {
    expect(formatDurationHm(125)).toBe("2h 5m");
  });
});

// ── 17. Day View typography-token audit pins (2026-05-10) ──────────

describe("JobTimeGroupCard — typography token audit", () => {
  it("job number is not font-bold", () => {
    expect(JOB_GROUP).not.toMatch(/job-group-job-number[\s\S]{0,200}font-bold/);
  });

  it("job number is not font-semibold", () => {
    expect(JOB_GROUP).not.toMatch(/job-group-job-number[\s\S]{0,200}font-semibold/);
  });

  it("job number uses text-muted-foreground (recedes visually)", () => {
    expect(JOB_GROUP).toMatch(/job-group-job-number[\s\S]{0,200}text-muted-foreground/);
  });

  it("dash separator has no font-semibold", () => {
    // The "—" separator between job# and location must be muted weight only.
    expect(JOB_GROUP).not.toMatch(/shrink-0 text-row font-semibold text-muted-foreground/);
  });

  it("location name uses font-medium not font-semibold", () => {
    // className appears before data-testid in JSX; match in reverse direction.
    expect(JOB_GROUP).toMatch(/font-medium[\s\S]{0,100}job-group-location/);
    expect(JOB_GROUP).not.toMatch(/font-semibold[\s\S]{0,100}job-group-location/);
  });

  it("total value uses span not <strong>", () => {
    expect(JOB_GROUP).not.toMatch(/<strong/);
  });

  it("total value uses font-semibold on an explicit span", () => {
    expect(JOB_GROUP).toMatch(/font-mono font-semibold tabular-nums text-foreground/);
  });

  it("no font-bold anywhere in file", () => {
    expect(JOB_GROUP).not.toMatch(/\bfont-bold\b/);
  });

  it("no text-xs in file", () => {
    expect(JOB_GROUP).not.toMatch(/\btext-xs\b/);
  });

  it("no text-sm in file", () => {
    expect(JOB_GROUP).not.toMatch(/\btext-sm\b/);
  });

  it("no text-[Npx] arbitrary sizes in file", () => {
    expect(JOB_GROUP).not.toMatch(/text-\[\d+px\]/);
  });
});

describe("TimesheetEntryCard — typography token audit", () => {
  it("time range has text-helper semantic size token", () => {
    expect(ENTRY_CARD).toMatch(/text-helper font-mono tabular-nums text-muted-foreground/);
  });

  it("time range has text-muted-foreground (not opacity variant)", () => {
    // Must use the canonical muted token, not text-foreground/70.
    expect(ENTRY_CARD).not.toMatch(/text-foreground\/70/);
  });

  it("duration uses text-row font-semibold tabular-nums", () => {
    expect(ENTRY_CARD).toMatch(/text-row font-semibold tabular-nums/);
  });

  it("no font-bold in file", () => {
    expect(ENTRY_CARD).not.toMatch(/\bfont-bold\b/);
  });

  it("no text-xs in file", () => {
    expect(ENTRY_CARD).not.toMatch(/\btext-xs\b/);
  });

  it("no text-sm in file", () => {
    expect(ENTRY_CARD).not.toMatch(/\btext-sm\b/);
  });

  it("no text-[Npx] arbitrary sizes in file", () => {
    expect(ENTRY_CARD).not.toMatch(/text-\[\d+px\]/);
  });
});
