/**
 * dashboard-token-canonical.test.ts
 *
 * Phase A token cleanup assertions for the 5 dashboard card files.
 * Pins: no hex color literals, no legacy hover/border hex, no text-text-muted,
 * and typography normalization (text-xs → text-helper for labels/descriptions,
 * text-sm → text-row for count values).
 *
 * Does NOT cover KpiTile.tsx or TopKpiRow.tsx — pinned in kpi-tile-canonical.test.ts.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const DASH = resolve(ROOT, "client/src/components/dashboard");

const OPERATIONAL = readFileSync(resolve(DASH, "OperationalAlertsCard.tsx"), "utf-8");
const LOWER_OPS   = readFileSync(resolve(DASH, "LowerOpsCards.tsx"), "utf-8");
const REVENUE     = readFileSync(resolve(DASH, "RevenueCenterCard.tsx"), "utf-8");
const QUOTE       = readFileSync(resolve(DASH, "QuotePipelineCard.tsx"), "utf-8");
const RIGHT_COL   = readFileSync(resolve(DASH, "RightColumnFinancialCards.tsx"), "utf-8");

const ALL_FILES: Array<[string, string]> = [
  ["OperationalAlertsCard", OPERATIONAL],
  ["LowerOpsCards",         LOWER_OPS],
  ["RevenueCenterCard",     REVENUE],
  ["QuotePipelineCard",     QUOTE],
  ["RightColumnFinancialCards", RIGHT_COL],
];

// ── No hex color literals ─────────────────────────────────────────────────────

describe("No hex color literals in dashboard card files", () => {
  const HEX_PATTERN = /text-\[#[0-9a-fA-F]{3,6}\]|bg-\[#[0-9a-fA-F]{3,6}\]|border-\[#[0-9a-fA-F]{3,6}\]|divide-\[#[0-9a-fA-F]{3,6}\]/;

  for (const [name, src] of ALL_FILES) {
    it(`${name} has no hex color literals`, () => {
      expect(src).not.toMatch(HEX_PATTERN);
    });
  }
});

// ── No legacy hover hex ───────────────────────────────────────────────────────

describe("No legacy hover:bg-[#F0F5F0] in dashboard card files", () => {
  for (const [name, src] of ALL_FILES) {
    it(`${name} has no hover:bg-[#F0F5F0]`, () => {
      expect(src).not.toContain("hover:bg-[#F0F5F0]");
    });
  }
});

// ── No legacy border/divide hex ──────────────────────────────────────────────

describe("No legacy border/divide hex in dashboard card files", () => {
  for (const [name, src] of ALL_FILES) {
    it(`${name} has no border-[#e2e8f0] or divide-[#e2e8f0]`, () => {
      expect(src).not.toContain("border-[#e2e8f0]");
      expect(src).not.toContain("divide-[#e2e8f0]");
    });
  }
});

// ── No text-text-muted legacy alias ──────────────────────────────────────────

describe("No text-text-muted legacy alias in dashboard card files", () => {
  for (const [name, src] of ALL_FILES) {
    it(`${name} has no text-text-muted`, () => {
      expect(src).not.toContain("text-text-muted");
    });
  }
});

// ── Semantic token usage confirmed ───────────────────────────────────────────

describe("Semantic token usage in OperationalAlertsCard", () => {
  it("uses text-foreground for h3 title", () => {
    expect(OPERATIONAL).toContain("text-foreground");
  });
  // Row internals (hover, label, count typography) moved to DashboardMetricRow —
  // pinned in tests/dashboard-metric-row.test.ts.
  it("delegates row rendering to DashboardMetricRow", () => {
    expect(OPERATIONAL).toContain("<DashboardMetricRow");
  });
  it("passes density='compact' to DashboardMetricRow", () => {
    expect(OPERATIONAL).toContain('density="compact"');
  });
});

describe("Semantic token usage in LowerOpsCards", () => {
  it("ViewReportLink uses text-primary", () => {
    expect(LOWER_OPS).toContain("text-xs text-primary hover:underline");
  });
  it("summary stats use text-foreground", () => {
    expect(LOWER_OPS).toContain("text-2xl font-bold text-foreground tabular-nums leading-none");
  });
  it("empty state uses text-helper", () => {
    expect(LOWER_OPS).toContain("text-helper text-slate-400 italic");
  });
  it("OpenCapacity rows use text-helper and hover:bg-primary/5", () => {
    expect(LOWER_OPS).toContain("text-helper px-1.5 py-1 -mx-1.5 rounded hover:bg-primary/5");
  });
  it("OpenCapacity tech name uses text-foreground", () => {
    expect(LOWER_OPS).toContain("text-foreground truncate min-w-0 mr-2");
  });
  it("OpenCapacity hours uses text-muted-foreground", () => {
    expect(LOWER_OPS).toContain("text-muted-foreground tabular-nums shrink-0 font-medium");
  });
  it("JobsSnapshot rows use text-helper and hover:bg-primary/5", () => {
    expect(LOWER_OPS).toContain("text-helper px-1.5 py-1 -mx-1.5 rounded transition-colors");
    expect(LOWER_OPS).toContain("hover:bg-primary/5");
  });
  it("JobsSnapshot label uses text-muted-foreground", () => {
    expect(LOWER_OPS).toContain('"text-muted-foreground"');
  });
  it("JobsSnapshot count uses text-foreground", () => {
    expect(LOWER_OPS).toContain('"text-foreground"');
  });
});

describe("Semantic token usage in RevenueCenterCard", () => {
  it("CardShellTitle iconColor uses text-primary", () => {
    expect(REVENUE).toContain('iconColor="text-primary"');
  });
  it("header count uses text-muted-foreground", () => {
    expect(REVENUE).toContain("text-helper text-muted-foreground tabular-nums shrink-0");
  });
  it("Open financials button uses text-primary", () => {
    expect(REVENUE).toContain("text-helper font-semibold text-primary hover:underline");
  });
  it("loading and empty states use text-helper text-muted-foreground", () => {
    expect(REVENUE).toContain("text-helper text-muted-foreground");
  });
  // Row internals (border, hover, label/description/count typography, chevron)
  // moved to DashboardMetricRow — pinned in tests/dashboard-metric-row.test.ts.
  it("delegates row rendering to DashboardMetricRow", () => {
    expect(REVENUE).toContain("<DashboardMetricRow");
  });
  it("passes density='default' to DashboardMetricRow", () => {
    expect(REVENUE).toContain('density="default"');
  });
  it("passes showChevron to DashboardMetricRow", () => {
    expect(REVENUE).toContain("showChevron");
  });
});

describe("Semantic token usage in QuotePipelineCard", () => {
  it("header count uses text-muted-foreground", () => {
    expect(QUOTE).toContain("text-helper text-muted-foreground tabular-nums shrink-0");
  });
  it("View all button uses text-primary", () => {
    expect(QUOTE).toContain("text-helper font-semibold text-primary hover:underline");
  });
  it("bucket dividers use divide-card-border", () => {
    expect(QUOTE).toContain("divide-y divide-card-border");
  });
  it("bucket header hover uses hover:bg-primary/5", () => {
    expect(QUOTE).toContain("hover:bg-primary/5 transition-colors group");
  });
  it("bucket label uses text-muted-foreground", () => {
    expect(QUOTE).toContain("text-helper font-semibold uppercase tracking-wide text-muted-foreground truncate");
  });
  it("bucket count uses text-foreground", () => {
    expect(QUOTE).toContain("text-helper text-foreground font-bold tabular-nums shrink-0");
  });
  it("bucket ChevronRight uses text-muted-foreground group-hover:text-foreground", () => {
    expect(QUOTE).toContain("text-muted-foreground group-hover:text-foreground transition-colors shrink-0");
  });
  it("+N more link uses text-primary", () => {
    expect(QUOTE).toContain("text-helper text-primary hover:underline");
  });
  it("preview row hover uses hover:bg-primary/5", () => {
    expect(QUOTE).toContain("px-4 py-1.5 hover:bg-primary/5 transition-colors group");
  });
  it("customer name uses text-helper text-foreground", () => {
    expect(QUOTE).toContain("text-helper font-semibold text-foreground truncate");
  });
  it("amount uses text-muted-foreground", () => {
    expect(QUOTE).toContain("text-helper text-muted-foreground tabular-nums shrink-0");
  });
  it("timing row uses text-muted-foreground", () => {
    expect(QUOTE).toContain("text-helper text-muted-foreground min-w-0");
  });
  it("separator dot uses text-muted-foreground/50", () => {
    expect(QUOTE).toContain('className="text-muted-foreground/50"');
  });
  it("CTA link uses text-primary", () => {
    expect(QUOTE).toContain("text-helper font-semibold text-primary shrink-0 group-hover:underline");
  });
});

describe("Semantic token usage in RightColumnFinancialCards", () => {
  it("ViewAllLink uses text-primary", () => {
    expect(RIGHT_COL).toContain("text-xs text-primary hover:underline");
  });
  it("row hover uses hover:bg-primary/5", () => {
    expect(RIGHT_COL).toContain("hover:bg-primary/5 transition-colors group");
  });
  it("row dividers use border-card-border", () => {
    expect(RIGHT_COL).toContain("border-card-border");
  });
  it("entity name uses text-foreground", () => {
    expect(RIGHT_COL).toContain("text-sm font-normal text-foreground truncate");
  });
  it("sub-line uses text-helper", () => {
    expect(RIGHT_COL).toContain("text-helper text-slate-500 truncate");
  });
  it("amount uses text-row and text-foreground", () => {
    expect(RIGHT_COL).toContain("text-row font-semibold tabular-nums");
    expect(RIGHT_COL).toContain('"text-foreground"');
  });
  it("ChevronRight uses group-hover:text-foreground", () => {
    expect(RIGHT_COL).toContain("group-hover:text-foreground transition-colors");
  });
});

// ── KpiTile / TopKpiRow still pinned separately — not re-tested here ──────────
// See tests/kpi-tile-canonical.test.ts
