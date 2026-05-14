/**
 * dashboard-collections-canonical.test.ts
 *
 * Phase 2C dashboard canonicalization guard tests for CollectionsOverviewCard
 * in `client/src/pages/FinancialDashboard.tsx`.
 *
 * Pins:
 *  1.  Uses CardShell (not local DashCard)
 *  2.  Uses CardShellHeader + CardShellTitle for the header
 *  3.  Summary strip uses CardMetricBlock align="start" (ScheduledRevCell deleted)
 *  4.  Summary strip uses divide-card-border / border-card-border (not hex)
 *  5.  No hardcoded hex colors or text-slate-* / text-red-*
 *  6.  No raw text-[10px] usage
 *  7.  Section labels use text-label text-muted-foreground
 *  8.  Row labels use text-helper (not text-xs)
 *  9.  Row values use text-row (not text-xs / text-sm)
 * 10.  Overdue values use text-destructive (not text-red-700)
 * 11.  No py-1 row density (must be py-1.5)
 * 12.  Rows use hover:bg-primary/5 (not hex hover)
 * 13.  Empty states use text-helper text-muted-foreground inline (no local EmptyState)
 * 14.  onOpenCustomer and onOpenInvoice click behavior preserved
 * 15.  testid attributes preserved
 * 16.  TodaysScheduleCard still uses DashCard (not touched)
 * 17.  EmptyState helper function still present (used by TodaysScheduleCard)
 * 18.  CardHeader function deleted (last caller was CollectionsOverviewCard)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT    = resolve(__dirname, "..");
const dashSrc = readFileSync(resolve(ROOT, "client/src/pages/FinancialDashboard.tsx"), "utf-8");

// Slice the CollectionsOverviewCard region: from section comment to the
// ScheduledRevenueCard section comment that immediately follows.
const cardStart = dashSrc.indexOf("// ── CollectionsOverviewCard");
const cardEnd   = dashSrc.indexOf("// ── ScheduledRevenueCard");
const CARD_SRC  = dashSrc.slice(
  cardStart,
  cardEnd > -1 ? cardEnd : dashSrc.length,
);

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// ── 1. CardShell replaces local DashCard ────────────────────────────────────

describe("CollectionsOverviewCard — uses CardShell (Phase 2C)", () => {
  it("renders CardShell as the root element", () => {
    expect(CARD_SRC).toContain("CardShell");
  });

  it("does not use the local DashCard helper", () => {
    expect(CARD_SRC).not.toContain("<DashCard");
  });
});

// ── 2. CardShellHeader + CardShellTitle ──────────────────────────────────────

describe("CollectionsOverviewCard — uses CardShellHeader + CardShellTitle", () => {
  it("renders CardShellHeader", () => {
    expect(CARD_SRC).toContain("CardShellHeader");
  });

  it("renders CardShellTitle with Receipt icon and amber color", () => {
    expect(CARD_SRC).toContain("CardShellTitle");
    expect(CARD_SRC).toContain("Receipt");
    expect(CARD_SRC).toContain("text-amber-600");
  });
});

// ── 3. CardMetricBlock in summary strip ─────────────────────────────────────

describe("CollectionsOverviewCard — summary strip uses CardMetricBlock align='start'", () => {
  it("renders at least two CardMetricBlock instances (Outstanding + Overdue)", () => {
    const count = (CARD_SRC.match(/CardMetricBlock/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("CardMetricBlock cells use align='start'", () => {
    expect(CARD_SRC).toContain('align="start"');
  });

  it("Overdue cell uses valueClassName for conditional text-destructive", () => {
    expect(CARD_SRC).toMatch(/valueClassName=\{pastDueTotal > 0 \? "text-destructive" : undefined\}/);
  });
});

// ── 4. Semantic border/divide tokens ────────────────────────────────────────

describe("CollectionsOverviewCard — semantic border tokens", () => {
  it("summary strip uses border-card-border", () => {
    expect(CARD_SRC).toContain("border-card-border");
  });

  it("two-panel divider uses divide-card-border", () => {
    expect(CARD_SRC).toContain("divide-card-border");
  });

  it("no hex border on summary strip", () => {
    expect(CARD_SRC).not.toContain("border-[#e2e8f0]");
  });

  it("no hex divide on lower panel", () => {
    expect(CARD_SRC).not.toContain("divide-[#e2e8f0]");
  });
});

// ── 5. No hex colors or text-slate-* / text-red-* ───────────────────────────

describe("CollectionsOverviewCard — no hex color literals", () => {
  it("no hex color class literals in code", () => {
    expect(stripComments(CARD_SRC)).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it("no text-slate-* classes", () => {
    expect(CARD_SRC).not.toMatch(/text-slate-/);
  });

  it("no text-red-* raw red classes (replaced by text-destructive)", () => {
    expect(CARD_SRC).not.toMatch(/text-red-/);
  });

  it("no hover:bg-[#...] hex hover", () => {
    expect(CARD_SRC).not.toMatch(/hover:bg-\[#/);
  });
});

// ── 6. No raw text-[10px] ────────────────────────────────────────────────────

describe("CollectionsOverviewCard — no raw text-[10px]", () => {
  it("no text-[10px] in code", () => {
    expect(stripComments(CARD_SRC)).not.toMatch(/text-\[10px\]/);
  });
});

// ── 7. Section labels use text-label ────────────────────────────────────────

describe("CollectionsOverviewCard — section labels use text-label", () => {
  it("'Top customers' label uses text-label", () => {
    expect(CARD_SRC).toMatch(/text-label[\s\S]{0,60}Top customers/);
  });

  it("'Overdue invoices' label uses text-label", () => {
    expect(CARD_SRC).toMatch(/text-label[\s\S]{0,60}Overdue invoices/);
  });

  it("section labels use text-muted-foreground", () => {
    expect(CARD_SRC).toMatch(/text-label text-muted-foreground/);
  });
});

// ── 8. Row labels use text-row ───────────────────────────────────────────────

describe("CollectionsOverviewCard — row labels use text-row text-foreground (Phase Row Typography)", () => {
  it("customer label span uses text-row text-foreground truncate", () => {
    // Phase Row Typography: primary row content uses text-row (14px), not text-helper (13px).
    expect(CARD_SRC).toContain("text-row text-foreground truncate");
  });
  it("no text-helper text-foreground pattern (label is now text-row)", () => {
    expect(CARD_SRC).not.toContain("text-helper text-foreground truncate");
  });
});

// ── 9. Row values use text-row ───────────────────────────────────────────────

describe("CollectionsOverviewCard — row values use text-row font-semibold tabular-nums", () => {
  it("row value spans use text-row font-semibold tabular-nums", () => {
    expect(CARD_SRC).toContain("text-row font-semibold tabular-nums");
  });
});

// ── 10. Overdue uses text-destructive ───────────────────────────────────────

describe("CollectionsOverviewCard — overdue values use text-destructive", () => {
  it("summary strip Overdue cell uses text-destructive via valueClassName", () => {
    expect(CARD_SRC).toContain("text-destructive");
  });

  it("customer row value uses text-destructive for hasOverdue", () => {
    expect(CARD_SRC).toMatch(/hasOverdue \? "text-destructive"/);
  });

  it("invoice row value uses text-destructive for isOverdue", () => {
    expect(CARD_SRC).toMatch(/isOverdue \? "text-destructive"/);
  });
});

// ── 11. Row density — py-1.5, not py-1 ──────────────────────────────────────

describe("CollectionsOverviewCard — rows use py-1.5 compact density", () => {
  it("rows use py-1.5", () => {
    expect(CARD_SRC).toContain("py-1.5");
  });

  it("no bare py-1 density", () => {
    expect(CARD_SRC).not.toMatch(/py-1(?![.\d])/);
  });
});

// ── 12. Hover canonical ──────────────────────────────────────────────────────

describe("CollectionsOverviewCard — hover:bg-primary/5", () => {
  it("rows use hover:bg-primary/5", () => {
    expect(CARD_SRC).toContain("hover:bg-primary/5");
  });
});

// ── 13. Empty states — inline canonical, not local EmptyState ────────────────

describe("CollectionsOverviewCard — empty states use inline canonical markup", () => {
  it("empty customers state uses text-helper text-muted-foreground", () => {
    expect(CARD_SRC).toContain("text-helper text-muted-foreground");
  });

  it("empty invoices state preserves 'No overdue invoices.' copy", () => {
    expect(CARD_SRC).toContain("No overdue invoices.");
  });

  it("empty customers state preserves 'None.' copy", () => {
    expect(CARD_SRC).toContain("None.");
  });

  it("does not use local EmptyState helper for its own empty states", () => {
    expect(CARD_SRC).not.toContain("<EmptyState");
  });
});

// ── 14. Click behavior preserved ─────────────────────────────────────────────

describe("CollectionsOverviewCard — click behavior preserved", () => {
  it("customer row onClick calls onOpenCustomer with the company id", () => {
    expect(CARD_SRC).toMatch(/onClick=\{.*?onOpenCustomer\(c\.customerCompanyId\)/);
  });

  it("invoice row onClick calls onOpenInvoice with the invoice id", () => {
    // 2-arg call: onOpenInvoice(inv.id, inv.customerCompanyId ?? null) — don't pin the closing paren.
    expect(CARD_SRC).toMatch(/onClick=\{.*?onOpenInvoice\(inv\.id/);
  });
});

// ── 15. testid attributes preserved ─────────────────────────────────────────

describe("CollectionsOverviewCard — testid attributes preserved", () => {
  it("collections-summary-strip testid present", () => {
    expect(CARD_SRC).toContain('data-testid="collections-summary-strip"');
  });

  it("collections-summary-outstanding testid present", () => {
    expect(CARD_SRC).toContain('data-testid="collections-summary-outstanding"');
  });

  it("collections-summary-overdue testid present", () => {
    expect(CARD_SRC).toContain('data-testid="collections-summary-overdue"');
  });

  it("collections-customers-list testid present", () => {
    expect(CARD_SRC).toContain('data-testid="collections-customers-list"');
  });

  it("collections-invoices-list testid present", () => {
    expect(CARD_SRC).toContain('data-testid="collections-invoices-list"');
  });
});

// ── 16. TodaysScheduleCard uses CardShell (Phase 2D) ────────────────────────

describe("TodaysScheduleCard — migrated to CardShell (Phase 2D)", () => {
  it("TodaysScheduleCard function uses CardShell", () => {
    const schedStart = dashSrc.indexOf("function TodaysScheduleCard(");
    const schedSrc = dashSrc.slice(schedStart);
    expect(schedSrc).toContain("<CardShell");
  });

  it("TodaysScheduleCard does not use local DashCard", () => {
    const schedStart = dashSrc.indexOf("function TodaysScheduleCard(");
    const schedSrc = dashSrc.slice(schedStart);
    expect(schedSrc).not.toContain("<DashCard");
  });
});

// ── 16b. DashCard deleted ────────────────────────────────────────────────────

describe("DashCard local helper — deleted (Phase 2D)", () => {
  it("function DashCard definition is gone", () => {
    expect(dashSrc).not.toContain("function DashCard(");
  });

  it("no <DashCard usage remains in the file", () => {
    expect(dashSrc).not.toContain("<DashCard");
  });
});

// ── 17. EmptyState helper still present ─────────────────────────────────────

describe("EmptyState local helper — still present for TodaysScheduleCard", () => {
  it("function EmptyState still exists in the file", () => {
    expect(dashSrc).toContain("function EmptyState(");
  });

  it("TodaysScheduleCard still uses EmptyState", () => {
    const schedStart = dashSrc.indexOf("function TodaysScheduleCard(");
    const schedSrc = dashSrc.slice(schedStart);
    expect(schedSrc).toContain("EmptyState");
  });
});

// ── 18. CardHeader deleted ───────────────────────────────────────────────────

describe("CardHeader local helper — deleted (last caller was CollectionsOverviewCard)", () => {
  it("function CardHeader definition is gone", () => {
    expect(dashSrc).not.toContain("function CardHeader(");
  });

  it("no <CardHeader usage remains in the file", () => {
    expect(dashSrc).not.toContain("<CardHeader");
  });
});
