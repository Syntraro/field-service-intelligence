/**
 * dashboard-metric-row.test.ts — guard tests for DashboardMetricRow (Phase B).
 *
 * Pins:
 *  1.  Primitive exports: types + component
 *  2.  Typography ownership (text-helper label, text-row count, text-helper description)
 *  3.  No banned legacy tokens inside the renderer
 *  4.  No hex color literals in the renderer
 *  5.  Density: compact vs default spacing/icon/weight
 *  6.  Tone: default styling
 *  7.  Tone: danger — text-destructive on label/count
 *  8.  Tone: muted — text-muted-foreground on label/count, icon opacity
 *  9.  Hover semantics: hover:bg-primary/5 (default tone)
 * 10.  Danger hover: bg-destructive/[0.05] hover:bg-destructive/10
 * 11.  Border: border-card-border (not hex)
 * 12.  Chevron: rendered with group-hover transition
 * 13.  Muted: button disabled, cursor-default
 * 14.  tabular-nums on count
 * 15.  OperationalAlertsCard migration: uses DashboardMetricRow, no raw row JSX
 * 16.  RevenueCenterCard migration: uses DashboardMetricRow, no raw row JSX
 * 17.  No hex color literals in migrated cards (post Phase A+B)
 * 18.  No text-slate-* in OperationalAlertsCard row rendering
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const DASH = resolve(__dirname, "..", "client", "src", "components", "dashboard");

const PRIMITIVE = readFileSync(resolve(DASH, "DashboardMetricRow.tsx"), "utf-8");
const OAC       = readFileSync(resolve(DASH, "OperationalAlertsCard.tsx"), "utf-8");
const RCC       = readFileSync(resolve(DASH, "RevenueCenterCard.tsx"), "utf-8");

// ── 1. Primitive exports ──────────────────────────────────────────────────────

describe("DashboardMetricRow exports", () => {
  it("exports DashboardMetricRowTone type", () => {
    expect(PRIMITIVE).toContain("DashboardMetricRowTone");
  });
  it("exports DashboardMetricRowDensity type", () => {
    expect(PRIMITIVE).toContain("DashboardMetricRowDensity");
  });
  it("exports DashboardMetricRowProps interface", () => {
    expect(PRIMITIVE).toContain("export interface DashboardMetricRowProps");
  });
  it("exports DashboardMetricRow function", () => {
    expect(PRIMITIVE).toContain("export function DashboardMetricRow");
  });
  it("tone union includes default, danger, muted", () => {
    expect(PRIMITIVE).toContain('"default" | "danger" | "muted"');
  });
  it("density union includes default and compact", () => {
    expect(PRIMITIVE).toContain('"default" | "compact"');
  });
});

// ── 2. Typography ownership ───────────────────────────────────────────────────

describe("DashboardMetricRow owns typography", () => {
  it("label uses text-helper", () => {
    expect(PRIMITIVE).toContain("text-helper");
  });
  it("count uses text-row", () => {
    expect(PRIMITIVE).toContain("text-row");
  });
  it("count uses tabular-nums", () => {
    expect(PRIMITIVE).toContain("tabular-nums");
  });
  it("description uses text-helper text-muted-foreground", () => {
    expect(PRIMITIVE).toContain("text-helper text-muted-foreground truncate");
  });
});

// ── 3. No banned legacy tokens ────────────────────────────────────────────────

describe("DashboardMetricRow has no banned legacy tokens", () => {
  it("no text-xs", () => {
    // text-xs is banned; text-helper (13px) is the canonical replacement
    const classNames = PRIMITIVE.match(/className=["`][^"`]*["`]/g) ?? [];
    for (const c of classNames) {
      expect(c).not.toContain("text-xs");
    }
  });
  it("no text-sm in className strings (text-row is the canonical count token)", () => {
    const classNames = PRIMITIVE.match(/className=["`][^"`]*["`]/g) ?? [];
    for (const c of classNames) {
      expect(c).not.toContain("text-sm");
    }
  });
  it("no text-text-muted legacy alias", () => {
    expect(PRIMITIVE).not.toContain("text-text-muted");
  });
});

// ── 4. No hex color literals ──────────────────────────────────────────────────

describe("DashboardMetricRow has no hex color literals", () => {
  it("no text-[#...] hex", () => {
    expect(PRIMITIVE).not.toMatch(/text-\[#[0-9a-fA-F]{3,6}\]/);
  });
  it("no bg-[#...] hex", () => {
    expect(PRIMITIVE).not.toMatch(/bg-\[#[0-9a-fA-F]{3,6}\]/);
  });
  it("no hover:bg-[#...] hex", () => {
    expect(PRIMITIVE).not.toContain("hover:bg-[#");
  });
});

// ── 5. Density variants ───────────────────────────────────────────────────────

describe("DashboardMetricRow density variants", () => {
  it("compact: px-3 py-1.5 padding", () => {
    expect(PRIMITIVE).toContain("px-3 py-1.5");
  });
  it("compact: h-3 w-3 icon size", () => {
    expect(PRIMITIVE).toContain("h-3 w-3");
  });
  it("compact: font-medium label weight", () => {
    expect(PRIMITIVE).toContain("font-medium");
  });
  it("compact: font-semibold count weight", () => {
    expect(PRIMITIVE).toContain("font-semibold");
  });
  it("default: px-4 py-2 padding", () => {
    expect(PRIMITIVE).toContain("px-4 py-2");
  });
  it("default: h-3.5 w-3.5 icon size", () => {
    expect(PRIMITIVE).toContain("h-3.5 w-3.5");
  });
  it("default: font-semibold label weight", () => {
    expect(PRIMITIVE).toContain("font-semibold");
  });
  it("default: font-bold count weight", () => {
    expect(PRIMITIVE).toContain("font-bold");
  });
});

// ── 6. Tone: default ─────────────────────────────────────────────────────────

describe("DashboardMetricRow default tone", () => {
  it("label uses text-foreground in default tone", () => {
    expect(PRIMITIVE).toContain('"text-foreground"');
  });
  it("count uses text-foreground in default tone", () => {
    // countColor shares the same text-foreground for default
    expect(PRIMITIVE).toContain("text-foreground");
  });
});

// ── 7. Tone: danger ───────────────────────────────────────────────────────────

describe("DashboardMetricRow danger tone", () => {
  it("label uses text-destructive for danger", () => {
    expect(PRIMITIVE).toContain('"text-destructive"');
  });
  it("count uses text-destructive for danger", () => {
    expect(PRIMITIVE).toMatch(/countColor[\s\S]{0,100}text-destructive/);
  });
  it("danger row has destructive background tint", () => {
    expect(PRIMITIVE).toContain("bg-destructive/[0.05]");
  });
  it("danger row has destructive hover", () => {
    expect(PRIMITIVE).toContain("hover:bg-destructive/10");
  });
  it("danger does not ban red-50 explicitly (bg-red-50 must not appear)", () => {
    expect(PRIMITIVE).not.toContain("bg-red-50");
  });
});

// ── 8. Tone: muted ────────────────────────────────────────────────────────────

describe("DashboardMetricRow muted tone", () => {
  it("muted icon uses text-muted-foreground/30", () => {
    expect(PRIMITIVE).toContain("text-muted-foreground/30");
  });
  it("muted label uses text-muted-foreground", () => {
    expect(PRIMITIVE).toContain('"text-muted-foreground"');
  });
  it("muted row has cursor-default", () => {
    expect(PRIMITIVE).toContain("cursor-default");
  });
  it("muted button is disabled", () => {
    expect(PRIMITIVE).toContain("disabled={isMuted");
  });
  it("muted row has no hover background", () => {
    // muted path must not include hover:bg-primary/5 or hover:bg-destructive
    const mutedSection = PRIMITIVE.slice(
      PRIMITIVE.indexOf("isMuted"),
      PRIMITIVE.indexOf("isMuted") + 300,
    );
    expect(mutedSection).not.toContain("hover:bg-primary");
  });
});

// ── 9. Hover semantics ────────────────────────────────────────────────────────

describe("DashboardMetricRow hover semantics", () => {
  it("default tone uses hover:bg-primary/5", () => {
    expect(PRIMITIVE).toContain("hover:bg-primary/5");
  });
  it("no hover:bg-[#F0F5F0] legacy hex hover", () => {
    expect(PRIMITIVE).not.toContain("hover:bg-[#F0F5F0]");
  });
});

// ── 10. Border semantics ──────────────────────────────────────────────────────

describe("DashboardMetricRow border semantics", () => {
  it("uses border-card-border (not hex)", () => {
    expect(PRIMITIVE).toContain("border-card-border");
  });
  it("no border-[#e2e8f0] hex border", () => {
    expect(PRIMITIVE).not.toContain("border-[#e2e8f0]");
  });
  it("border applied when !isLast", () => {
    expect(PRIMITIVE).toContain("!isLast");
    expect(PRIMITIVE).toContain("border-b border-card-border");
  });
});

// ── 11. Chevron ───────────────────────────────────────────────────────────────

describe("DashboardMetricRow chevron", () => {
  it("renders ChevronRight when showChevron=true", () => {
    expect(PRIMITIVE).toContain("ChevronRight");
    expect(PRIMITIVE).toContain("showChevron");
  });
  it("chevron uses group-hover:text-foreground transition", () => {
    expect(PRIMITIVE).toContain("group-hover:text-foreground transition-colors");
  });
  it("chevron default color is text-muted-foreground", () => {
    expect(PRIMITIVE).toContain("text-muted-foreground group-hover:text-foreground");
  });
  it("button has group class for chevron hover", () => {
    // group appears inline in the className cn() string
    expect(PRIMITIVE).toMatch(/transition-colors group/);
  });
});

// ── 12. OperationalAlertsCard migration ──────────────────────────────────────

describe("OperationalAlertsCard uses DashboardMetricRow", () => {
  it("imports DashboardMetricRow", () => {
    expect(OAC).toContain('from "@/components/dashboard/DashboardMetricRow"');
  });
  it("renders DashboardMetricRow in the row list", () => {
    expect(OAC).toContain("<DashboardMetricRow");
  });
  it("passes density='compact'", () => {
    expect(OAC).toContain('density="compact"');
  });
  it("no longer has raw row button JSX with px-3 py-1.5 gap-2", () => {
    // The raw button class string is gone — replaced by DashboardMetricRow
    expect(OAC).not.toContain("px-3 py-1.5 text-left transition-colors");
  });
  it("passes tone='danger' for urgent rows", () => {
    expect(OAC).toContain('"danger"');
  });
  it("passes tone='muted' for zero-count rows", () => {
    expect(OAC).toContain('"muted"');
  });
  it("no text-slate-700 legacy color in row rendering", () => {
    expect(OAC).not.toContain("text-slate-700");
  });
  it("no text-slate-400 legacy color in row rendering", () => {
    expect(OAC).not.toContain("text-slate-400");
  });
  it("no text-slate-300 legacy color in row rendering", () => {
    expect(OAC).not.toContain("text-slate-300");
  });
  it("no text-red-700 legacy color in row rendering", () => {
    expect(OAC).not.toContain("text-red-700");
  });
  it("no hex color literals in row rendering", () => {
    expect(OAC).not.toMatch(/text-\[#[0-9a-fA-F]{3,6}\]/);
  });
  it("preserves StatusChip count badge in header", () => {
    expect(OAC).toContain("StatusChip");
  });
  it("preserves isLoading skeleton state", () => {
    expect(OAC).toContain("isLoading");
    expect(OAC).toContain("Skeleton");
  });
});

// ── 13. RevenueCenterCard migration ──────────────────────────────────────────

describe("RevenueCenterCard uses DashboardMetricRow", () => {
  it("imports DashboardMetricRow", () => {
    expect(RCC).toContain('from "@/components/dashboard/DashboardMetricRow"');
  });
  it("renders DashboardMetricRow in the row list", () => {
    expect(RCC).toContain("<DashboardMetricRow");
  });
  it("passes density='default'", () => {
    expect(RCC).toContain('density="default"');
  });
  it("passes showChevron", () => {
    expect(RCC).toContain("showChevron");
  });
  it("passes description prop for sub-line", () => {
    expect(RCC).toContain("description={row.description}");
  });
  it("passes tone='danger' for overdue row", () => {
    expect(RCC).toContain('"danger"');
  });
  it("no longer has raw row button JSX with px-4 py-2 group", () => {
    // Raw button class string removed
    expect(RCC).not.toContain("justify-between gap-3 px-4 py-2 text-left transition-colors group");
  });
  it("no ChevronRight import (moved into renderer)", () => {
    // ChevronRight no longer imported directly in RCC
    expect(RCC).not.toContain('"ChevronRight"');
  });
  it("no text-red-600 in row rendering JSX (stays in data as iconColor — renderer owns the toning)", () => {
    // text-red-600 may appear in the row data definitions (iconColor) but
    // must not appear in the row-rendering JSX (inside the <ul> / DashboardMetricRow block).
    // The renderer's danger tone owns label/count/bg coloring — callers don't inline it.
    const rowRenderSection = RCC.slice(RCC.indexOf("<ul>"), RCC.indexOf("</ul>") + 6);
    expect(rowRenderSection).not.toContain("text-red-600");
  });
  it("no hex color literals", () => {
    expect(RCC).not.toMatch(/text-\[#[0-9a-fA-F]{3,6}\]/);
  });
  it("preserves loading state", () => {
    expect(RCC).toContain("isLoading");
  });
  it("preserves empty state", () => {
    expect(RCC).toContain("visibleRows.length === 0");
  });
  it("preserves navigation via setLocation", () => {
    expect(RCC).toContain("setLocation");
  });
  it("ChevronRight not in import list (owned by DashboardMetricRow)", () => {
    const importBlock = RCC.slice(0, RCC.indexOf("export function"));
    expect(importBlock).not.toContain("ChevronRight");
  });
});
