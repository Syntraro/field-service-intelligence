/**
 * dashboard-scheduled-revenue-canonical.test.ts
 *
 * Phase 2B dashboard canonicalization guard tests for ScheduledRevenueCard
 * in `client/src/pages/FinancialDashboard.tsx`.
 *
 * Pins:
 *  1.  Uses CardShell (not local DashCard)
 *  2.  Uses CardShellHeader + CardShellTitle for the header
 *  3.  ScheduledRevCell deleted — KPI strip uses CardMetricBlock align="start"
 *  4.  KPI grid dividers use divide-card-border (not hex)
 *  5.  No hardcoded hex colors or text-slate-* in the card region
 *  6.  No raw text-[10px] usage (replaced by text-label / CardMetricBlock label)
 *  7.  No raw text-base usage on the currency values (CardMetricBlock replaces)
 *  8.  Job rows use py-1.5 compact density (not py-1)
 *  9.  Job rows use hover:bg-primary/5 (not hex hover)
 * 10.  Footer and empty state use text-helper text-muted-foreground
 * 11.  onOpenJob click behavior preserved
 * 12.  testid attributes preserved on KPI cells and job rows
 * 13.  CardMetricBlock is imported from @/components/ui/card
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT     = resolve(__dirname, "..");
const dashSrc  = readFileSync(resolve(ROOT, "client/src/pages/FinancialDashboard.tsx"), "utf-8");

// Slice from the ScheduledRevenueCard section comment to the next section anchor.
// The anchor comment that follows ScheduledRevCell (or the card, post-migration)
// is a reliable delimiter — it describes the removed NeedsAttentionCard.
const cardStart = dashSrc.indexOf("// ── ScheduledRevenueCard");
const cardEnd   = dashSrc.indexOf("// 2026-05-07 — NeedsAttentionCard removed");
const CARD_SRC  = dashSrc.slice(
  cardStart,
  cardEnd > -1 ? cardEnd : dashSrc.length,
);

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// ── 1. CardShell replaces local DashCard ────────────────────────────────────

describe("ScheduledRevenueCard — uses CardShell (Phase 2B)", () => {
  it("renders CardShell as the root element", () => {
    expect(CARD_SRC).toContain("CardShell");
  });

  it("does not use the local DashCard helper", () => {
    expect(CARD_SRC).not.toContain("<DashCard");
  });
});

// ── 2. CardShellHeader + CardShellTitle ──────────────────────────────────────

describe("ScheduledRevenueCard — uses CardShellHeader + CardShellTitle", () => {
  it("renders CardShellHeader", () => {
    expect(CARD_SRC).toContain("CardShellHeader");
  });

  it("renders CardShellTitle", () => {
    expect(CARD_SRC).toContain("CardShellTitle");
  });

  it("CardShellTitle carries the CalendarIcon + emerald color", () => {
    expect(CARD_SRC).toContain("CalendarIcon");
    expect(CARD_SRC).toContain("text-emerald-600");
  });
});

// ── 3. CardMetricBlock replaces ScheduledRevCell ────────────────────────────

describe("ScheduledRevenueCard — KPI strip uses CardMetricBlock align='start'", () => {
  it("ScheduledRevCell function is deleted", () => {
    expect(CARD_SRC).not.toContain("function ScheduledRevCell(");
  });

  it("KPI strip renders three CardMetricBlock instances", () => {
    const count = (CARD_SRC.match(/CardMetricBlock/g) ?? []).length;
    // 3 opening tags + at minimum the closing tags → at least 6 occurrences
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it("CardMetricBlock cells use align='start'", () => {
    expect(CARD_SRC).toContain('align="start"');
  });
});

// ── 4. Semantic border/divide tokens ────────────────────────────────────────

describe("ScheduledRevenueCard — semantic border tokens (no hex)", () => {
  it("KPI grid uses divide-card-border", () => {
    expect(CARD_SRC).toContain("divide-card-border");
  });

  it("KPI grid uses border-card-border", () => {
    expect(CARD_SRC).toContain("border-card-border");
  });

  it("does not use divide-[#e2e8f0]", () => {
    expect(CARD_SRC).not.toContain("divide-[#e2e8f0]");
  });

  it("does not use border-[#e2e8f0]", () => {
    expect(CARD_SRC).not.toContain("border-[#e2e8f0]");
  });
});

// ── 5. No hardcoded hex or text-slate-* ──────────────────────────────────────

describe("ScheduledRevenueCard — no hex color literals or text-slate-*", () => {
  it("no hex color class literals in code", () => {
    const code = stripComments(CARD_SRC);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it("no text-slate-* color classes", () => {
    expect(CARD_SRC).not.toMatch(/text-slate-/);
  });

  it("no hover:bg-[#...] hex hover", () => {
    expect(CARD_SRC).not.toContain("hover:bg-[#F0F5F0]");
    expect(CARD_SRC).not.toMatch(/hover:bg-\[#/);
  });
});

// ── 6. No raw text-[10px] ────────────────────────────────────────────────────

describe("ScheduledRevenueCard — no raw text-[10px] (replaced by text-label/CardMetricBlock)", () => {
  it("no text-[10px] in code", () => {
    expect(stripComments(CARD_SRC)).not.toMatch(/text-\[10px\]/);
  });
});

// ── 7. No raw text-base on currency values ───────────────────────────────────

describe("ScheduledRevenueCard — ScheduledRevCell (with text-base) is deleted", () => {
  it("ScheduledRevCell source does not appear (carries text-base currency value)", () => {
    expect(CARD_SRC).not.toContain("function ScheduledRevCell(");
  });
});

// ── 8. Job row compact density — py-1.5, not py-1 ───────────────────────────

describe("ScheduledRevenueCard — job rows use py-1.5 compact density", () => {
  it("job rows use py-1.5", () => {
    expect(CARD_SRC).toContain("py-1.5");
  });

  it("no bare py-1 density (use py-1.5 instead)", () => {
    // py-1 without a trailing decimal is the forbidden shorter density.
    // py-1.5, py-10, py-12, etc. must not be flagged.
    expect(CARD_SRC).not.toMatch(/py-1(?![.\d])/);
  });
});

// ── 9. Hover: primary/5 ──────────────────────────────────────────────────────

describe("ScheduledRevenueCard — job rows use hover:bg-primary/5", () => {
  it("uses hover:bg-primary/5 on job rows", () => {
    expect(CARD_SRC).toContain("hover:bg-primary/5");
  });
});

// ── 10. text-helper text-muted-foreground ────────────────────────────────────

describe("ScheduledRevenueCard — empty state and footer use canonical text-helper", () => {
  it("empty state uses text-helper text-muted-foreground", () => {
    expect(CARD_SRC).toContain("text-helper text-muted-foreground");
  });

  it("empty state preserves the existing copy", () => {
    expect(CARD_SRC).toContain("No upcoming jobs with reliable value.");
  });

  it("footer uses text-helper text-muted-foreground", () => {
    expect(CARD_SRC).toContain("Based on scheduled jobs.");
  });
});

// ── 11. Click behavior preserved ─────────────────────────────────────────────

describe("ScheduledRevenueCard — click behavior preserved", () => {
  it("job row onClick calls onOpenJob with the job id", () => {
    expect(CARD_SRC).toMatch(/onClick=\{.*?onOpenJob\(j\.id\)/);
  });
});

// ── 12. testid attributes preserved ─────────────────────────────────────────

describe("ScheduledRevenueCard — testid attributes preserved", () => {
  it("scheduled-today testid is present", () => {
    expect(CARD_SRC).toContain('data-testid="scheduled-today"');
  });

  it("scheduled-7d testid is present", () => {
    expect(CARD_SRC).toContain('data-testid="scheduled-7d"');
  });

  it("scheduled-30d testid is present", () => {
    expect(CARD_SRC).toContain('data-testid="scheduled-30d"');
  });

  it("scheduled-kpi-grid testid is present", () => {
    expect(CARD_SRC).toContain('data-testid="scheduled-kpi-grid"');
  });

  it("scheduled-revenue outer testid is present", () => {
    expect(CARD_SRC).toContain('data-testid="scheduled-revenue"');
  });

  it("scheduled-upcoming-list testid is present", () => {
    expect(CARD_SRC).toContain('data-testid="scheduled-upcoming-list"');
  });
});

// ── 13. Import guard ─────────────────────────────────────────────────────────

describe("FinancialDashboard — CardMetricBlock import", () => {
  it("imports CardMetricBlock from @/components/ui/card", () => {
    expect(dashSrc).toMatch(
      /import\s*\{[^}]*CardMetricBlock[^}]*\}\s*from\s*["']@\/components\/ui\/card["']/,
    );
  });
});
