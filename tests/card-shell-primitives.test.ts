/**
 * card-shell-primitives.test.ts
 *
 * Phase 1 dashboard canonicalization guard tests for KpiRow and
 * CardMetricBlock in `client/src/components/ui/card.tsx`.
 *
 * Pins:
 *  1.  KpiRow label uses semantic text-helper (not raw text-xs)
 *  2.  KpiRow count/chevron styling preserved
 *  3.  KpiRow urgent state preserved
 *  4.  KpiRow border uses border-card-border
 *  5.  CardMetricBlock align prop is declared
 *  6.  CardMetricBlock default align is "end" (items-end — existing callers unaffected)
 *  7.  CardMetricBlock align="start" applies items-start
 *  8.  CardMetricBlock label/value token classes unchanged
 *  9.  No new dashboard typography tokens were added to card.tsx
 * 10.  No raw text-xs in KpiRow label (regression guard)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const CARD_PATH = resolve(__dirname, "..", "client", "src", "components", "ui", "card.tsx");
const CARD = readFileSync(CARD_PATH, "utf-8");

// ── Isolate KpiRow source region ─────────────────────────────────────────────
// Slice from the KpiRow component definition to the KpiRow.displayName line
// so assertions are scoped to that component, not the whole file.
const kpiRowStart = CARD.indexOf("const KpiRow = React.forwardRef");
const kpiRowEnd   = CARD.indexOf('KpiRow.displayName = "KpiRow"') + 40;
const KPI_ROW     = CARD.slice(kpiRowStart, kpiRowEnd);

// ── Isolate CardMetricBlock source region ─────────────────────────────────────
// Expand the slice to include the CardMetricBlockProps interface, which
// contains the `align?` prop declaration. The interface always precedes the
// forwardRef call in this file.
const cmbStart      = CARD.indexOf("export interface CardMetricBlockProps");
const cmbEnd        = CARD.indexOf('CardMetricBlock.displayName = "CardMetricBlock"') + 50;
const CARD_METRIC   = CARD.slice(cmbStart, cmbEnd);

// ── 1. KpiRow label uses text-helper ─────────────────────────────────────────

describe("KpiRow label typography", () => {
  it("label span uses text-helper (semantic token)", () => {
    expect(KPI_ROW).toContain("text-helper");
  });

  it("label span does NOT use raw text-xs", () => {
    // text-xs is a raw Tailwind size ramp class; text-helper is the
    // canonical 13px token. KpiRow must use text-helper on its label.
    // (Both resolve to 13px on this app's config — zero visual change.)
    const labelSpan = KPI_ROW.match(/<span[\s\S]*?{label}[\s\S]*?<\/span>/)?.[0] ?? KPI_ROW;
    expect(labelSpan).not.toContain("text-xs");
  });
});

// ── 2. KpiRow count + chevron preserved ──────────────────────────────────────

describe("KpiRow count and chevron preserved", () => {
  it("count span uses text-sm font-bold tabular-nums", () => {
    // Count styling is unchanged by the Phase 1 label-only fix.
    expect(KPI_ROW).toContain("text-sm font-bold tabular-nums");
  });

  it("count span uses tabular-nums", () => {
    expect(KPI_ROW).toContain("tabular-nums");
  });

  it("chevron renders ChevronRight", () => {
    expect(KPI_ROW).toContain("ChevronRight");
  });

  it("chevron guarded by showChevron", () => {
    expect(KPI_ROW).toContain("showChevron");
  });
});

// ── 3. KpiRow urgent state preserved ─────────────────────────────────────────

describe("KpiRow urgent state preserved", () => {
  it("urgent active tints row with bg-red-50/60", () => {
    expect(KPI_ROW).toContain("bg-red-50/60");
  });

  it("urgent active uses text-red-600 on label", () => {
    expect(KPI_ROW).toContain("text-red-600");
  });

  it("urgent active uses font-medium on label", () => {
    expect(KPI_ROW).toContain("font-medium");
  });
});

// ── 4. KpiRow border semantics ───────────────────────────────────────────────

describe("KpiRow border uses semantic token", () => {
  it("uses border-card-border for row dividers", () => {
    expect(KPI_ROW).toContain("border-card-border");
  });

  it("border suppressed on last row via !last", () => {
    expect(KPI_ROW).toContain("!last");
  });
});

// ── 5. CardMetricBlock align prop declared ────────────────────────────────────

describe("CardMetricBlock align prop", () => {
  it("interface declares align prop as optional", () => {
    expect(CARD_METRIC).toMatch(/align\?:\s*"start"\s*\|\s*"end"/);
  });

  it("component destructures align with default 'end'", () => {
    expect(CARD_METRIC).toMatch(/align\s*=\s*"end"/);
  });
});

// ── 6. CardMetricBlock default alignment is end ───────────────────────────────

describe("CardMetricBlock default align='end' is items-end", () => {
  it("applies items-end when align is 'end' (the default)", () => {
    expect(CARD_METRIC).toContain("items-end");
  });

  it("items-end is the fallback branch (align !== 'start')", () => {
    // The conditional must resolve items-end for any non-start value,
    // making it the safe default for existing callers.
    expect(CARD_METRIC).toMatch(/align.*start.*items-start.*items-end|items-end.*items-start/s);
  });
});

// ── 7. CardMetricBlock align='start' is items-start ──────────────────────────

describe("CardMetricBlock align='start' is items-start", () => {
  it("applies items-start when align is 'start'", () => {
    expect(CARD_METRIC).toContain("items-start");
  });

  it("items-start and items-end are both present (both branches exist)", () => {
    expect(CARD_METRIC).toContain("items-start");
    expect(CARD_METRIC).toContain("items-end");
  });
});

// ── 8. CardMetricBlock label/value tokens unchanged ───────────────────────────

describe("CardMetricBlock label/value token classes unchanged", () => {
  it("label uses text-[10px] font-bold uppercase tracking-[0.08em] text-text-muted", () => {
    expect(CARD_METRIC).toContain(
      "text-[10px] font-bold uppercase tracking-[0.08em] text-text-muted",
    );
  });

  it("value uses tabular-nums font-semibold", () => {
    expect(CARD_METRIC).toContain("tabular-nums font-semibold");
  });

  it("emphasis applies text-base on the value", () => {
    expect(CARD_METRIC).toContain("text-base");
  });

  it("default value falls back to text-text-primary", () => {
    expect(CARD_METRIC).toContain("text-text-primary");
  });
});

// ── 9. No new typography tokens ───────────────────────────────────────────────

describe("Phase 1 did not introduce new typography token declarations", () => {
  it("no new text-display-* token class in card.tsx", () => {
    // text-display already exists. This guard ensures no variant was added.
    expect(CARD).not.toMatch(/text-display-[a-z]/);
  });

  it("no new text-label-* token class in card.tsx", () => {
    expect(CARD).not.toMatch(/text-label-[a-z]/);
  });

  it("no text-annotation token class in card.tsx", () => {
    expect(CARD).not.toContain("text-annotation");
  });
});

// ── 10. KpiRow label raw text-xs regression guard ────────────────────────────

describe("KpiRow label does not regress to raw text-xs (regression guard)", () => {
  it("full KpiRow source has no text-xs on the label element (cn block)", () => {
    // The cn() block for the label span should contain text-helper, not text-xs.
    // This assertion checks the entire KpiRow source to catch any future
    // re-introduction of the raw size class on that element.
    const labelCnBlock = KPI_ROW.match(
      /className=\{cn\(\s*["']text-helper["']/,
    );
    expect(labelCnBlock).not.toBeNull();
  });
});
