/**
 * Tests for the Reports Insights rule engine
 * (`client/src/lib/reportsInsights.ts`).
 *
 * The engine is a pure deterministic translator from the Snapshot
 * + Parts Forecast response payloads into a flat list of `Insight`
 * cards. These tests exercise the rule engine directly — no React,
 * no DB, no network. Every test feeds synthetic snapshot/forecast
 * payloads with controlled values and asserts:
 *
 *   - the rule fires when the threshold is crossed
 *   - the rule stays silent when below the threshold
 *   - severity is classified correctly (warning vs critical)
 *   - rules silently skip when source `hasData` is false
 *   - rules silently skip when the comparison value is null/undefined
 *   - no rule emits a hardcoded business value (the `description` strings
 *     are computed from the input numbers, never invented)
 *
 * Layers:
 *   1. Empty / no-data inputs produce zero insights.
 *   2. Per-rule threshold tests (warning + critical + below-threshold).
 *   3. Severity classification table.
 *   4. No-fake-data — the engine source carries no business literals.
 *   5. UI integration spot-check — Reports.tsx wires the rule engine
 *      output into the `snapshot-section-insights` SectionCard.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  computeInsights,
  type Insight,
  type InsightInputs,
  type InsightSeverity,
} from "../client/src/lib/reportsInsights";
import type {
  ARBucket,
  MetricCard,
  SnapshotResponse,
} from "../shared/reports/snapshot";
import type { PartsForecastResponse } from "../shared/reports/partsForecast";

// ---------------------------------------------------------------------------
// Synthetic-payload factories — keep tests terse + intent-aligned.
// ---------------------------------------------------------------------------

function makeMetric(overrides: Partial<MetricCard> = {}): MetricCard {
  return {
    key: overrides.key ?? "revenue",
    label: overrides.label ?? "Revenue",
    unit: overrides.unit ?? "currency",
    polarity: overrides.polarity ?? "higher_is_better",
    currentValue: overrides.currentValue ?? 0,
    previousMonthValue: overrides.previousMonthValue ?? 0,
    previousQuarterValue: overrides.previousQuarterValue ?? null,
    previousYearValue: overrides.previousYearValue ?? null,
    monthChangePercent: overrides.monthChangePercent ?? null,
    quarterChangePercent: overrides.quarterChangePercent ?? null,
    yearChangePercent: overrides.yearChangePercent ?? null,
    hasData: overrides.hasData ?? true,
  };
}

function makeBucket(overrides: Partial<ARBucket>): ARBucket {
  return {
    key: overrides.key ?? "current",
    label: overrides.label ?? "Current",
    amount: overrides.amount ?? 0,
    invoiceCount: overrides.invoiceCount ?? 0,
  };
}

function makeSnapshot(overrides: {
  revenue?: Partial<MetricCard>;
  paymentDays?: Partial<MetricCard>;
  avgJobValue?: Partial<MetricCard>;
  unbillable?: Partial<MetricCard>;
  leadConversion?: Partial<MetricCard>;
  quoteConversion?: Partial<MetricCard>;
  arBuckets?: ARBucket[];
} = {}): SnapshotResponse {
  return {
    range: "last_30_days",
    window: {
      currentFromISO: "2026-04-01T00:00:00.000Z",
      currentToISO: "2026-05-01T00:00:00.000Z",
      previousMonthFromISO: "2026-03-01T00:00:00.000Z",
      previousMonthToISO: "2026-04-01T00:00:00.000Z",
      previousQuarterFromISO: "2026-02-01T00:00:00.000Z",
      previousQuarterToISO: "2026-03-01T00:00:00.000Z",
      previousYearFromISO: "2025-04-01T00:00:00.000Z",
      previousYearToISO: "2025-05-01T00:00:00.000Z",
    },
    revenueCashFlow: {
      metrics: [
        makeMetric({ key: "revenue", ...overrides.revenue }),
        makeMetric({
          key: "avg_payment_days",
          unit: "days",
          polarity: "lower_is_better",
          ...overrides.paymentDays,
        }),
      ],
    },
    jobsOperations: {
      metrics: [
        makeMetric({
          key: "avg_job_value",
          ...overrides.avgJobValue,
        }),
        makeMetric({
          key: "unbillable_cost",
          polarity: "lower_is_better",
          ...overrides.unbillable,
        }),
      ],
    },
    sales: {
      metrics: [
        makeMetric({
          key: "lead_conversion",
          unit: "percent",
          ...overrides.leadConversion,
        }),
        makeMetric({
          key: "quote_conversion",
          unit: "percent",
          ...overrides.quoteConversion,
        }),
      ],
    },
    accountsReceivable: {
      asOfISO: "2026-05-01T00:00:00.000Z",
      buckets: overrides.arBuckets ?? [],
    },
  };
}

function makePartsForecast(overrides: {
  missingCount?: number;
  pmVisitsRequiringParts?: number;
} = {}): PartsForecastResponse {
  const missingCount = overrides.missingCount ?? 0;
  const pmVisitsRequiringParts = overrides.pmVisitsRequiringParts ?? 0;
  const items = Array.from({ length: missingCount }, (_, idx) => ({
    visitId: `visit-${idx}`,
    jobId: `job-${idx}`,
    scheduledAtISO: "2026-05-15T12:00:00.000Z",
    locationId: `loc-${idx}`,
    locationName: `Loc ${idx}`,
    customerName: null,
    jobRef: `Job #${idx}`,
  }));
  return {
    range: "next_30_days",
    asOfISO: "2026-05-03T00:00:00.000Z",
    window: {
      fromISO: "2026-05-03T00:00:00.000Z",
      toISO: "2026-06-02T00:00:00.000Z",
    },
    kpis: {
      totalPartsRequired: 0,
      uniquePartTypes: 0,
      locationsRequiringParts: 0,
      pmVisitsRequiringParts,
      hasData: pmVisitsRequiringParts > 0,
    },
    partsNeeded: { items: [], hasData: false },
    partsByLocation: { items: [], hasData: false },
    partsByTechnician: {
      items: [],
      hasData: false,
      reason: "test",
    },
    missingPartsData: { items, hasData: missingCount > 0 },
    orderingList: { items: [], hasData: false },
  };
}

const noInputs = (
  overrides: Partial<InsightInputs> = {},
): InsightInputs => ({
  snapshot: makeSnapshot(),
  partsForecast: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Layer 1 — empty / insufficient data
// ---------------------------------------------------------------------------

describe("Reports Insights — empty inputs produce zero insights", () => {
  it("baseline empty snapshot + null parts-forecast → no insights", () => {
    const out = computeInsights(noInputs());
    expect(out).toEqual([]);
  });

  it("metrics with hasData=false silently skip — never fabricate", () => {
    const out = computeInsights(
      noInputs({
        snapshot: makeSnapshot({
          revenue: {
            hasData: false,
            currentValue: 100,
            previousMonthValue: 1000,
            monthChangePercent: -90,
          },
        }),
      }),
    );
    expect(out.find((i) => i.id === "revenue-down")).toBeUndefined();
  });

  it("metric with null monthChangePercent (zero baseline) → no insight", () => {
    const out = computeInsights(
      noInputs({
        snapshot: makeSnapshot({
          revenue: {
            hasData: true,
            currentValue: 100,
            previousMonthValue: 0,
            monthChangePercent: null,
          },
        }),
      }),
    );
    expect(out.find((i) => i.id === "revenue-down")).toBeUndefined();
  });

  it("AR with all-zero buckets → no insight", () => {
    const out = computeInsights(
      noInputs({
        snapshot: makeSnapshot({
          arBuckets: [
            makeBucket({ key: "current", amount: 0 }),
            makeBucket({ key: "total_overdue", amount: 0 }),
          ],
        }),
      }),
    );
    expect(out.find((i) => i.id === "ar-overdue")).toBeUndefined();
  });

  it("missing parts data with hasData=false → no insight", () => {
    const pf = makePartsForecast({ missingCount: 0 });
    const out = computeInsights(
      noInputs({ snapshot: makeSnapshot(), partsForecast: pf }),
    );
    expect(out.find((i) => i.id === "parts-missing")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — per-rule threshold tests
// ---------------------------------------------------------------------------

describe("Insight #1 — Revenue trend", () => {
  const at = (pct: number, current = 7000, prev = 10000): InsightInputs =>
    noInputs({
      snapshot: makeSnapshot({
        revenue: {
          hasData: true,
          currentValue: current,
          previousMonthValue: prev,
          monthChangePercent: pct,
        },
      }),
    });

  it("does NOT fire when drop ≤ 10%", () => {
    expect(
      computeInsights(at(-10)).find((i) => i.id === "revenue-down"),
    ).toBeUndefined();
    expect(
      computeInsights(at(-5)).find((i) => i.id === "revenue-down"),
    ).toBeUndefined();
  });

  it("warning when 10% < drop ≤ 25%", () => {
    const i = computeInsights(at(-15)).find((x) => x.id === "revenue-down");
    expect(i?.severity).toBe("warning");
    expect(i?.metricKey).toBe("revenue");
  });

  it("critical when drop > 25%", () => {
    const i = computeInsights(at(-30)).find((x) => x.id === "revenue-down");
    expect(i?.severity).toBe("critical");
  });

  it("does NOT fire on positive growth", () => {
    expect(
      computeInsights(at(50)).find((i) => i.id === "revenue-down"),
    ).toBeUndefined();
  });

  it("title and description carry the actual values from input", () => {
    const i = computeInsights(at(-18, 8200, 10000)).find(
      (x) => x.id === "revenue-down",
    );
    expect(i?.title).toMatch(/18\.0%/);
    expect(i?.description).toMatch(/8,200/);
    expect(i?.description).toMatch(/10,000/);
  });
});

describe("Insight #2 — AR risk", () => {
  const arWith = (current: number, overdue: number): ARBucket[] => [
    makeBucket({ key: "current", amount: current }),
    makeBucket({ key: "total_overdue", amount: overdue }),
  ];
  const at = (current: number, overdue: number): InsightInputs =>
    noInputs({ snapshot: makeSnapshot({ arBuckets: arWith(current, overdue) }) });

  it("does NOT fire when overdue ≤ 20%", () => {
    expect(
      computeInsights(at(8000, 2000)).find((i) => i.id === "ar-overdue"),
    ).toBeUndefined();
    expect(
      computeInsights(at(9500, 500)).find((i) => i.id === "ar-overdue"),
    ).toBeUndefined();
  });

  it("warning when 20% < overdue ≤ 35%", () => {
    // 30% overdue = 3000 / 10000
    const i = computeInsights(at(7000, 3000)).find(
      (x) => x.id === "ar-overdue",
    );
    expect(i?.severity).toBe("warning");
    expect(i?.metricKey).toBe("ar_overdue_pct");
  });

  it("critical when overdue > 35%", () => {
    // 40% overdue
    const i = computeInsights(at(6000, 4000)).find(
      (x) => x.id === "ar-overdue",
    );
    expect(i?.severity).toBe("critical");
  });

  it("does NOT fire when overdue=0 even if current AR exists", () => {
    expect(
      computeInsights(at(50000, 0)).find((i) => i.id === "ar-overdue"),
    ).toBeUndefined();
  });
});

describe("Insight #3 — Payment slowdown", () => {
  const at = (current: number, prev: number): InsightInputs =>
    noInputs({
      snapshot: makeSnapshot({
        paymentDays: {
          hasData: true,
          currentValue: current,
          previousMonthValue: prev,
        },
      }),
    });

  it("does NOT fire when delta ≤ 5 days", () => {
    expect(
      computeInsights(at(35, 30)).find((i) => i.id === "payment-slowdown"),
    ).toBeUndefined();
  });

  it("warning when 5 < delta ≤ 10 days", () => {
    const i = computeInsights(at(38, 30)).find(
      (x) => x.id === "payment-slowdown",
    );
    expect(i?.severity).toBe("warning");
    expect(i?.metricKey).toBe("avg_payment_days");
  });

  it("critical when delta > 10 days", () => {
    const i = computeInsights(at(45, 30)).find(
      (x) => x.id === "payment-slowdown",
    );
    expect(i?.severity).toBe("critical");
  });

  it("does NOT fire on faster payments (negative delta)", () => {
    expect(
      computeInsights(at(20, 30)).find((i) => i.id === "payment-slowdown"),
    ).toBeUndefined();
  });

  it("does NOT fire when previous month is zero (uncomputable baseline)", () => {
    expect(
      computeInsights(at(25, 0)).find((i) => i.id === "payment-slowdown"),
    ).toBeUndefined();
  });
});

describe("Insight #4 — Job value drop", () => {
  const at = (pct: number): InsightInputs =>
    noInputs({
      snapshot: makeSnapshot({
        avgJobValue: {
          hasData: true,
          currentValue: 800,
          previousMonthValue: 1000,
          monthChangePercent: pct,
        },
      }),
    });

  it("does NOT fire when drop ≤ 10%", () => {
    expect(
      computeInsights(at(-8)).find((i) => i.id === "job-value-drop"),
    ).toBeUndefined();
  });

  it("warning when 10% < drop ≤ 20%", () => {
    const i = computeInsights(at(-15)).find((x) => x.id === "job-value-drop");
    expect(i?.severity).toBe("warning");
  });

  it("critical when drop > 20%", () => {
    const i = computeInsights(at(-25)).find((x) => x.id === "job-value-drop");
    expect(i?.severity).toBe("critical");
  });
});

describe("Insight #5 — Unbillable cost spike", () => {
  const at = (pct: number): InsightInputs =>
    noInputs({
      snapshot: makeSnapshot({
        unbillable: {
          hasData: true,
          currentValue: 1500,
          previousMonthValue: 1000,
          monthChangePercent: pct,
        },
      }),
    });

  it("does NOT fire when increase ≤ 15%", () => {
    expect(
      computeInsights(at(10)).find((i) => i.id === "unbillable-spike"),
    ).toBeUndefined();
  });

  it("warning when 15% < increase ≤ 30%", () => {
    const i = computeInsights(at(20)).find((x) => x.id === "unbillable-spike");
    expect(i?.severity).toBe("warning");
  });

  it("critical when increase > 30%", () => {
    const i = computeInsights(at(50)).find((x) => x.id === "unbillable-spike");
    expect(i?.severity).toBe("critical");
  });

  it("does NOT fire on cost decrease (negative pct)", () => {
    expect(
      computeInsights(at(-25)).find((i) => i.id === "unbillable-spike"),
    ).toBeUndefined();
  });
});

describe("Insight #6 — Sales conversion drop (lead AND quote independent)", () => {
  it("lead-only drop fires only the lead insight", () => {
    const out = computeInsights(
      noInputs({
        snapshot: makeSnapshot({
          leadConversion: {
            hasData: true,
            currentValue: 20,
            previousMonthValue: 30,
            monthChangePercent: -33,
          },
        }),
      }),
    );
    expect(out.find((i) => i.id === "lead-conversion-drop")?.severity).toBe(
      "critical",
    );
    expect(out.find((i) => i.id === "quote-conversion-drop")).toBeUndefined();
  });

  it("quote-only warning fires only the quote insight", () => {
    const out = computeInsights(
      noInputs({
        snapshot: makeSnapshot({
          quoteConversion: {
            hasData: true,
            currentValue: 25,
            previousMonthValue: 30,
            monthChangePercent: -15,
          },
        }),
      }),
    );
    expect(out.find((i) => i.id === "quote-conversion-drop")?.severity).toBe(
      "warning",
    );
    expect(out.find((i) => i.id === "lead-conversion-drop")).toBeUndefined();
  });

  it("both can fire together — independent cards", () => {
    const out = computeInsights(
      noInputs({
        snapshot: makeSnapshot({
          leadConversion: {
            hasData: true,
            currentValue: 10,
            previousMonthValue: 20,
            monthChangePercent: -50,
          },
          quoteConversion: {
            hasData: true,
            currentValue: 25,
            previousMonthValue: 30,
            monthChangePercent: -15,
          },
        }),
      }),
    );
    expect(out.find((i) => i.id === "lead-conversion-drop")?.severity).toBe(
      "critical",
    );
    expect(out.find((i) => i.id === "quote-conversion-drop")?.severity).toBe(
      "warning",
    );
  });
});

describe("Insight #7 — Parts setup issues", () => {
  it("does NOT fire when partsForecast is null", () => {
    const out = computeInsights(
      noInputs({ partsForecast: null }),
    );
    expect(out.find((i) => i.id === "parts-missing")).toBeUndefined();
  });

  it("does NOT fire when missingPartsData.hasData is false", () => {
    const out = computeInsights(
      noInputs({
        partsForecast: makePartsForecast({
          missingCount: 0,
          pmVisitsRequiringParts: 5,
        }),
      }),
    );
    expect(out.find((i) => i.id === "parts-missing")).toBeUndefined();
  });

  it("warning when some PM visits missing but ≤ 50% of total", () => {
    // 3 missing out of 10 total = 30%
    const out = computeInsights(
      noInputs({
        partsForecast: makePartsForecast({
          missingCount: 3,
          pmVisitsRequiringParts: 7,
        }),
      }),
    );
    const i = out.find((x) => x.id === "parts-missing");
    expect(i?.severity).toBe("warning");
    expect(i?.title).toMatch(/3 PM visits/);
  });

  it("critical when > 50% of upcoming PM visits missing", () => {
    // 6 missing out of 10 total = 60%
    const out = computeInsights(
      noInputs({
        partsForecast: makePartsForecast({
          missingCount: 6,
          pmVisitsRequiringParts: 4,
        }),
      }),
    );
    const i = out.find((x) => x.id === "parts-missing");
    expect(i?.severity).toBe("critical");
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — severity classification table (cross-rule sanity)
// ---------------------------------------------------------------------------

describe("Severity classification — every emitted severity is one of the 3 enum keys", () => {
  it("only emits info / warning / critical", () => {
    const validSeverities: InsightSeverity[] = ["info", "warning", "critical"];
    const out = computeInsights(
      noInputs({
        snapshot: makeSnapshot({
          revenue: {
            hasData: true,
            currentValue: 5000,
            previousMonthValue: 10000,
            monthChangePercent: -50,
          },
          paymentDays: {
            hasData: true,
            currentValue: 50,
            previousMonthValue: 30,
          },
          avgJobValue: {
            hasData: true,
            currentValue: 600,
            previousMonthValue: 1000,
            monthChangePercent: -40,
          },
          unbillable: {
            hasData: true,
            currentValue: 2000,
            previousMonthValue: 1000,
            monthChangePercent: 100,
          },
          leadConversion: {
            hasData: true,
            currentValue: 5,
            previousMonthValue: 25,
            monthChangePercent: -80,
          },
          quoteConversion: {
            hasData: true,
            currentValue: 10,
            previousMonthValue: 20,
            monthChangePercent: -50,
          },
          arBuckets: [
            makeBucket({ key: "current", amount: 1000 }),
            makeBucket({ key: "total_overdue", amount: 9000 }),
          ],
        }),
        partsForecast: makePartsForecast({
          missingCount: 8,
          pmVisitsRequiringParts: 2,
        }),
      }),
    );
    expect(out.length).toBeGreaterThan(0);
    for (const insight of out) {
      expect(validSeverities).toContain(insight.severity);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 4 — no fake data in the engine source
// ---------------------------------------------------------------------------

describe("Insights engine — no fabricated business values in source", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const enginePath = path.join(
    repoRoot,
    "client",
    "src",
    "lib",
    "reportsInsights.ts",
  );
  const source = fs.readFileSync(enginePath, "utf-8");

  it("has no hardcoded business-value placeholders in titles/descriptions", () => {
    // Forbid currency literals and "32%" style strings appearing as
    // string fragments — every value the engine renders must come from
    // the input payload, not a baked-in constant.
    const forbidden = [
      "$10,000",
      "$50,000",
      "$1,000,000",
      "32%",
      "fakeRevenue",
      "demoTotal",
      "lorem",
    ];
    for (const phrase of forbidden) {
      expect(source.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });

  it("threshold values match the spec table verbatim", () => {
    // Locks the canonical thresholds in the engine source. If a future
    // edit changes a threshold, this test must be updated alongside —
    // intentionally noisy.
    expect(source).toMatch(/monthChangePercent < -10/); // revenue / job value / lead conv / quote conv
    expect(source).toMatch(/dropPct > 25/); // revenue critical
    expect(source).toMatch(/dropPct > 20/); // job value / sales conversion critical
    expect(source).toMatch(/overduePct > 20/); // AR warning
    expect(source).toMatch(/overduePct > 35/); // AR critical
    expect(source).toMatch(/deltaDays > 5/); // payment warning
    expect(source).toMatch(/deltaDays > 10/); // payment critical
    expect(source).toMatch(/spikePct > 30/); // unbillable critical
    expect(source).toMatch(/missingPct > 50/); // parts critical
  });
});

// ---------------------------------------------------------------------------
// Layer 5 — UI integration spot-check
// ---------------------------------------------------------------------------

describe("Insights — Reports.tsx wires the engine into the Snapshot tab", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const reportsPath = path.join(
    repoRoot,
    "client",
    "src",
    "pages",
    "Reports.tsx",
  );
  const source = fs.readFileSync(reportsPath, "utf-8");

  it("imports the rule engine + types", () => {
    expect(source).toMatch(
      /from "@\/lib\/reportsInsights"/,
    );
    expect(source).toMatch(/computeInsights/);
  });

  it("fetches Parts Forecast in parallel with Snapshot for rule #7", () => {
    expect(source).toMatch(
      /\["\/api\/reports\/parts-forecast",\s*"next_30_days"\]/,
    );
  });

  it("renders the Insights section with canonical test ids", () => {
    expect(source).toMatch(/testId="snapshot-section-insights"/);
    expect(source).toMatch(/data-testid="snapshot-insights-list"/);
    expect(source).toMatch(/data-testid=\{`insight-\$\{i\.id\}`\}/);
    expect(source).toMatch(/data-severity=\{i\.severity\}/);
  });

  it("places the InsightsSection at the top of the snapshot body", () => {
    // The body opens with `<InsightsSection insights={insights} />` —
    // before the metric strips. Locking the order so future refactors
    // don't quietly bury the alerts under the KPI grid.
    const bodyMatch = source.match(
      /<div className="space-y-6" data-testid="snapshot-body">[\s\S]+?<MetricsSection/,
    );
    expect(bodyMatch, "snapshot-body opener must exist").not.toBeNull();
    expect(bodyMatch![0]).toMatch(/<InsightsSection insights=\{insights\}\s*\/>/);
  });

  it("hides the Insights section when the array is empty (no fake reassurance)", () => {
    // Engine returns []; the section component must short-circuit so
    // the user never sees an empty card or a "you're all caught up"
    // placeholder. The check lives in the source, locked here.
    expect(source).toMatch(/insights\.length === 0/);
  });
});
