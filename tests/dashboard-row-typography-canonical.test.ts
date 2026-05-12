/**
 * dashboard-row-typography-canonical.test.ts
 *
 * Phase Row Typography guard — primary dashboard row content standardized
 * to text-row (14px) across all in-scope cards.
 *
 * Scope: DashboardMetricRow, QuotePipelineCard, CollectionsOverviewCard,
 * ScheduledRevenueCard, OperationalAlertsCard (via DashboardMetricRow).
 *
 * Not in scope: LowerOpsCards (container-pattern rows, text-helper on wrapper),
 * TodaysScheduleCard internals (intentionally preserved raw tokens).
 *
 * Token contract after this phase:
 *   text-row     — primary readable row labels and values (14px)
 *   text-helper  — secondary/supporting copy: descriptions, timing, empty states,
 *                  footers, header counts, action links
 *   text-label   — uppercase section labels only (13px/500/0.04em + uppercase)
 *
 * Pins:
 *  1.  DashboardMetricRow default density label uses text-row
 *  2.  DashboardMetricRow compact density label uses text-row
 *  3.  DashboardMetricRow description sub-line preserves text-helper (supporting copy)
 *  4.  DashboardMetricRow counts still use text-row
 *  5.  QuotePipelineCard bucket count uses text-row
 *  6.  QuotePipelineCard customer name label uses text-row
 *  7.  QuotePipelineCard bucket labels (text-label) unchanged
 *  8.  QuotePipelineCard helper copy preserves text-helper (timing, empty, loading)
 *  9.  CollectionsOverviewCard customer label uses text-row
 * 10.  CollectionsOverviewCard invoice label uses text-row
 * 11.  CollectionsOverviewCard section labels preserve text-label
 * 12.  CollectionsOverviewCard empty states preserve text-helper
 * 13.  ScheduledRevenueCard job label uses text-row
 * 14.  ScheduledRevenueCard footer/empty states preserve text-helper
 * 15.  ScheduledRevenueCard section label preserves text-label
 * 16.  TodaysScheduleCard internals untouched (text-helper on header bands)
 * 17.  No new typography tokens introduced (no text-xs / text-sm / text-[Npx])
 * 18.  LowerOpsCards rows unchanged (text-helper on row container)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const DASH = resolve(ROOT, "client", "src", "components", "dashboard");
const dashSrc = readFileSync(resolve(ROOT, "client/src/pages/FinancialDashboard.tsx"), "utf-8");

const METRIC_ROW = readFileSync(resolve(DASH, "DashboardMetricRow.tsx"), "utf-8");
const PIPELINE   = readFileSync(resolve(DASH, "QuotePipelineCard.tsx"), "utf-8");
const LOWER_OPS  = readFileSync(resolve(DASH, "LowerOpsCards.tsx"), "utf-8");

// Slice card regions from FinancialDashboard
const colStart  = dashSrc.indexOf("// ── CollectionsOverviewCard");
const colEnd    = dashSrc.indexOf("// ── ScheduledRevenueCard");
const COLL_SRC  = dashSrc.slice(colStart, colEnd > -1 ? colEnd : dashSrc.length);

const srStart   = dashSrc.indexOf("// ── ScheduledRevenueCard");
const srEnd     = dashSrc.indexOf("// 2026-05-07 — NeedsAttentionCard removed");
const SR_SRC    = dashSrc.slice(srStart, srEnd > -1 ? srEnd : dashSrc.length);

// TodaysScheduleCard slice for invariant checks
const schedStart = dashSrc.indexOf("function TodaysScheduleCard(");
const SCHED_SRC  = dashSrc.slice(schedStart);

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// ── 1 & 2. DashboardMetricRow labels use text-row ─────────────────────────────

describe("DashboardMetricRow — primary labels use text-row (Phase Row Typography)", () => {
  it("default density label uses text-row truncate (not text-helper)", () => {
    expect(METRIC_ROW).toContain('"text-row truncate"');
  });

  it("compact density label uses flex-1 text-row truncate (not text-helper)", () => {
    expect(METRIC_ROW).toContain('"flex-1 text-row truncate"');
  });

  it("neither label pattern contains text-helper", () => {
    expect(METRIC_ROW).not.toContain('"text-helper truncate"');
    expect(METRIC_ROW).not.toContain('"flex-1 text-helper truncate"');
  });
});

// ── 3. DashboardMetricRow description preserves text-helper ──────────────────

describe("DashboardMetricRow — description sub-line preserves text-helper", () => {
  it("description uses text-helper text-muted-foreground truncate", () => {
    // Description is secondary/supporting copy — text-helper (13px) is correct.
    expect(METRIC_ROW).toContain("text-helper text-muted-foreground truncate");
  });
});

// ── 4. DashboardMetricRow counts still use text-row ──────────────────────────

describe("DashboardMetricRow — counts still use text-row tabular-nums", () => {
  it("default density count uses text-row tabular-nums", () => {
    expect(METRIC_ROW).toContain('"text-row tabular-nums"');
  });

  it("compact density count uses text-row tabular-nums shrink-0", () => {
    expect(METRIC_ROW).toContain('"text-row tabular-nums shrink-0"');
  });
});

// ── 5 & 6. QuotePipelineCard row labels use text-row ─────────────────────────

describe("QuotePipelineCard — primary row content uses text-row (Phase Row Typography)", () => {
  it("bucket count uses text-row text-foreground font-bold tabular-nums shrink-0", () => {
    expect(PIPELINE).toContain("text-row text-foreground font-bold tabular-nums shrink-0");
  });

  it("customer name uses text-row font-semibold text-foreground truncate", () => {
    expect(PIPELINE).toContain("text-row font-semibold text-foreground truncate");
  });
});

// ── 7. QuotePipelineCard section labels unchanged ─────────────────────────────

describe("QuotePipelineCard — bucket section labels still use text-label", () => {
  it("bucket label still uses text-label text-muted-foreground truncate", () => {
    expect(PIPELINE).toContain("text-label text-muted-foreground truncate");
  });
});

// ── 8. QuotePipelineCard helper copy preserved ───────────────────────────────

describe("QuotePipelineCard — supporting copy preserves text-helper", () => {
  it("loading state uses text-helper text-muted-foreground", () => {
    expect(PIPELINE).toContain("text-helper text-muted-foreground");
  });

  it("timing sub-line uses text-helper text-muted-foreground min-w-0", () => {
    // Timing is secondary metadata — must stay text-helper.
    expect(PIPELINE).toContain("text-helper text-muted-foreground min-w-0");
  });

  it("+N more button uses text-helper text-primary (action link)", () => {
    expect(PIPELINE).toContain("text-helper text-primary hover:underline");
  });
});

// ── 9 & 10. CollectionsOverviewCard row labels use text-row ───────────────────

describe("CollectionsOverviewCard — primary row labels use text-row (Phase Row Typography)", () => {
  it("customer label uses flex-1 text-row text-foreground truncate", () => {
    expect(COLL_SRC).toContain("flex-1 text-row text-foreground truncate");
  });

  it("invoice label also uses flex-1 text-row text-foreground truncate", () => {
    // Two occurrences: customers list and invoices list.
    const count = (COLL_SRC.match(/flex-1 text-row text-foreground truncate/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("no flex-1 text-helper text-foreground truncate remains", () => {
    expect(COLL_SRC).not.toContain("flex-1 text-helper text-foreground truncate");
  });
});

// ── 11. CollectionsOverviewCard section labels unchanged ─────────────────────

describe("CollectionsOverviewCard — section labels still use text-label", () => {
  it("'Top customers' section label uses text-label text-muted-foreground", () => {
    expect(COLL_SRC).toMatch(/text-label text-muted-foreground[\s\S]{0,60}Top customers/);
  });

  it("'Overdue invoices' section label uses text-label text-muted-foreground", () => {
    expect(COLL_SRC).toMatch(/text-label text-muted-foreground[\s\S]{0,60}Overdue invoices/);
  });
});

// ── 12. CollectionsOverviewCard empty states preserved ───────────────────────

describe("CollectionsOverviewCard — empty states still use text-helper", () => {
  it("empty state uses text-helper text-muted-foreground", () => {
    expect(COLL_SRC).toContain("text-helper text-muted-foreground");
  });
});

// ── 13. ScheduledRevenueCard job labels use text-row ─────────────────────────

describe("ScheduledRevenueCard — job row labels use text-row (Phase Row Typography)", () => {
  it("job row label uses flex-1 text-row text-foreground truncate", () => {
    expect(SR_SRC).toContain("flex-1 text-row text-foreground truncate");
  });

  it("no flex-1 text-helper text-foreground truncate remains in ScheduledRevenueCard", () => {
    expect(SR_SRC).not.toContain("flex-1 text-helper text-foreground truncate");
  });
});

// ── 14. ScheduledRevenueCard footer/empty states preserved ───────────────────

describe("ScheduledRevenueCard — footer and empty state preserve text-helper", () => {
  it("empty state uses text-helper text-muted-foreground", () => {
    expect(SR_SRC).toContain("text-helper text-muted-foreground");
  });

  it("footer text is preserved", () => {
    expect(SR_SRC).toContain("Based on scheduled jobs.");
  });
});

// ── 15. ScheduledRevenueCard section label preserved ─────────────────────────

describe("ScheduledRevenueCard — section label still uses text-label", () => {
  it("'Upcoming high-value' section label uses text-label text-muted-foreground", () => {
    expect(SR_SRC).toMatch(/text-label text-muted-foreground[\s\S]{0,60}Upcoming high-value/);
  });
});

// ── 16. TodaysScheduleCard internals untouched ───────────────────────────────

describe("TodaysScheduleCard internals — untouched by Phase Row Typography", () => {
  it("TodaysScheduleCard still renders (function present)", () => {
    expect(SCHED_SRC).toContain("function TodaysScheduleCard(");
  });

  it("CalendarIcon still present in TodaysScheduleCard", () => {
    expect(SCHED_SRC).toContain("CalendarIcon");
  });

  it("data-testid=todays-schedule-header still present", () => {
    expect(SCHED_SRC).toContain('data-testid="todays-schedule-header"');
  });

  it("data-header-variant stacked preserved", () => {
    expect(SCHED_SRC).toContain('data-header-variant="stacked"');
  });

  it("data-header-variant default preserved", () => {
    expect(SCHED_SRC).toContain('data-header-variant="default"');
  });
});

// ── 17. No new raw typography tokens ─────────────────────────────────────────

describe("Phase Row Typography — no new raw typography tokens introduced", () => {
  it("DashboardMetricRow has no text-xs in classNames", () => {
    const classNames = METRIC_ROW.match(/className=["`][^"`]*["`]/g) ?? [];
    for (const c of classNames) {
      expect(c).not.toContain("text-xs");
    }
  });

  it("DashboardMetricRow has no text-sm in classNames", () => {
    const classNames = METRIC_ROW.match(/className=["`][^"`]*["`]/g) ?? [];
    for (const c of classNames) {
      expect(c).not.toContain("text-sm");
    }
  });

  it("QuotePipelineCard has no text-xs in file", () => {
    expect(stripComments(PIPELINE)).not.toMatch(/\btext-xs\b/);
  });

  it("QuotePipelineCard has no text-sm in file", () => {
    expect(stripComments(PIPELINE)).not.toMatch(/\btext-sm\b/);
  });
});

// ── 18. LowerOpsCards rows unchanged ─────────────────────────────────────────

describe("LowerOpsCards — row container pattern unchanged (not in scope)", () => {
  it("OpenCapacity row still uses text-helper as row container class", () => {
    // LowerOpsCards uses text-helper on the <li> container, not per-span.
    // This pattern was intentionally excluded from Phase Row Typography scope.
    expect(LOWER_OPS).toContain("text-helper px-1.5 py-1 -mx-1.5 rounded hover:bg-primary/5");
  });

  it("JobsSnapshot row still uses text-helper as row container class", () => {
    expect(LOWER_OPS).toContain("text-helper px-1.5 py-1 -mx-1.5 rounded transition-colors");
  });
});
