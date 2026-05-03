/**
 * Tests for the Reports → Snapshot foundation (2026-05-02).
 *
 * Three layers:
 *   1. Pure helpers (formatMetricValue / formatPercentChange /
 *      trendColorClass) — exhaustive cases for the trend-color rule
 *      since the spec is explicit about red/green polarity per metric.
 *   2. Source-grep regression guards on `client/src/pages/Reports.tsx`
 *      so future refactors can't silently drop tabs, the date range
 *      selector, or the View-all-reports button. Mirrors the pattern
 *      used by `find-next-available-slot.test.ts`.
 *   3. No-fake-data guard: scan the page source for hardcoded numeric
 *      mock metrics. Any number-token that looks like a fabricated
 *      KPI fails the test.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  formatMetricValue,
  formatPercentChange,
  trendColorClass,
} from "../client/src/lib/reportsFormatters";

// ---------------------------------------------------------------------------
// Layer 1 — pure formatter / trend rules
// ---------------------------------------------------------------------------

describe("Reports formatters — formatMetricValue", () => {
  it("renders currency with no decimal places", () => {
    expect(formatMetricValue(1234.56, "currency")).toMatch(/\$1,235/);
  });
  it("renders percent with one decimal", () => {
    expect(formatMetricValue(12.345, "percent")).toBe("12.3%");
  });
  it("renders days as an integer with a 'd' suffix", () => {
    expect(formatMetricValue(35.4, "days")).toBe("35d");
    expect(formatMetricValue(35.6, "days")).toBe("36d");
  });
  it("renders count with locale separators", () => {
    expect(formatMetricValue(12345, "count")).toMatch(/12,345/);
  });
  it("renders hours with one decimal", () => {
    expect(formatMetricValue(7.25, "hours")).toBe("7.3h");
  });
  it("renders an em dash for null (the empty-state value)", () => {
    expect(formatMetricValue(null, "currency")).toBe("—");
    expect(formatMetricValue(null, "percent")).toBe("—");
    expect(formatMetricValue(null, "days")).toBe("—");
    expect(formatMetricValue(null, "count")).toBe("—");
    expect(formatMetricValue(null, "hours")).toBe("—");
  });
});

describe("Reports formatters — formatPercentChange", () => {
  it("renders null as an em dash (no fabricated 'Infinity%' or '0%')", () => {
    expect(formatPercentChange(null)).toBe("—");
  });
  it("prefixes positive changes with +", () => {
    expect(formatPercentChange(17)).toBe("+17%");
    expect(formatPercentChange(8.5)).toBe("+8.5%");
  });
  it("renders negative changes with the native minus sign", () => {
    expect(formatPercentChange(-12)).toBe("-12%");
    expect(formatPercentChange(-3.2)).toBe("-3.2%");
  });
  it("rounds large magnitudes to whole percent (≥10), keeps one decimal under that", () => {
    expect(formatPercentChange(12.7)).toBe("+13%");
    expect(formatPercentChange(9.49)).toBe("+9.5%");
  });
});

describe("Reports formatters — trendColorClass (polarity rules)", () => {
  // Spec: revenue/jobs/leads/quotes/conversion → up is good
  //       payment time / AR / overdue / unbillable → up is bad
  describe("higher_is_better (revenue, jobs, leads, quotes, conversion)", () => {
    it("up = green", () => {
      expect(trendColorClass(17, "higher_is_better")).toBe("text-emerald-600");
    });
    it("down = red", () => {
      expect(trendColorClass(-12, "higher_is_better")).toBe("text-rose-600");
    });
  });
  describe("lower_is_better (payment time, AR, overdue, unbillable cost)", () => {
    it("up = red (more days outstanding is bad)", () => {
      expect(trendColorClass(17, "lower_is_better")).toBe("text-rose-600");
    });
    it("down = green (fewer days outstanding is good)", () => {
      expect(trendColorClass(-12, "lower_is_better")).toBe("text-emerald-600");
    });
  });
  it("null change is neutral (the comparison baseline was zero)", () => {
    expect(trendColorClass(null, "higher_is_better")).toBe("text-muted-foreground");
    expect(trendColorClass(null, "lower_is_better")).toBe("text-muted-foreground");
  });
  it("zero change is neutral", () => {
    expect(trendColorClass(0, "higher_is_better")).toBe("text-muted-foreground");
    expect(trendColorClass(0, "lower_is_better")).toBe("text-muted-foreground");
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — Reports.tsx source-level regression guards
// ---------------------------------------------------------------------------

describe("Reports page (source-level guard)", () => {
  const filePath = path.resolve(__dirname, "..", "client", "src", "pages", "Reports.tsx");
  const source = fs.readFileSync(filePath, "utf-8");

  it("renders the page title with the canonical test id", () => {
    expect(source).toMatch(/data-testid="reports-title"/);
    expect(source).toMatch(/Reports/);
  });

  it("exposes a date range selector defaulting to last_30_days", () => {
    expect(source).toMatch(/data-testid="select-reports-range"/);
    // Default state initialiser is `useState<RangeKey>("last_30_days")`.
    expect(source).toMatch(/useState<RangeKey>\("last_30_days"\)/);
  });

  it("exposes a View all reports button that navigates to the library page", () => {
    // 2026-05-02 phase 5: the in-page library sheet was replaced with
    // a dedicated `/reports/library` page. The button now navigates
    // there instead of toggling sheet state.
    expect(source).toMatch(/data-testid="button-view-all-reports"/);
    expect(source).toMatch(/setLocation\("\/reports\/library"\)/);
    expect(source).not.toMatch(/setLibraryOpen/);
  });

  it("renders all six tabs in the canonical order with Snapshot first", () => {
    const tabIds = [
      "tab-snapshot",
      "tab-financial",
      "tab-operations",
      "tab-sales",
      "tab-team",
      "tab-equipment",
    ];
    let lastIdx = -1;
    for (const id of tabIds) {
      const idx = source.indexOf(`data-testid="${id}"`);
      expect(idx, `expected ${id} in source`).toBeGreaterThan(-1);
      expect(idx, `expected ${id} after the previous tab`).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it("defaults the active tab to Snapshot", () => {
    expect(source).toMatch(/useState<ReportsTab>\("snapshot"\)/);
  });

  it("renders all four Snapshot sections (revenue / jobs / sales / AR)", () => {
    // SectionCard receives the testId via prop, then renders it as
    // `data-testid={testId}`. Source-grepping for the prop literal
    // is the canonical static check.
    expect(source).toMatch(/testId="snapshot-section-revenue"/);
    expect(source).toMatch(/testId="snapshot-section-jobs"/);
    expect(source).toMatch(/testId="snapshot-section-sales"/);
    expect(source).toMatch(/testId="snapshot-section-ar"/);
  });

  it("threads the canonical /api/reports/snapshot endpoint into TanStack Query", () => {
    expect(source).toMatch(/\["\/api\/reports\/snapshot",\s*range\]/);
    expect(source).toMatch(/`\/api\/reports\/snapshot\?range=\$\{range\}`/);
  });

  it("renders an empty-state slot when a metric reports hasData=false", () => {
    // The MetricTile has both branches gated on metric.hasData; the
    // false branch ships the canonical "Not enough data yet" copy.
    expect(source).toMatch(/Not enough data yet/);
    expect(source).toMatch(/data-testid=\{`metric-empty-/);
  });

  it("offers the canonical report categories via the library page catalog", () => {
    // 2026-05-02 phase 5: categories live in the canonical catalog
    // (`client/src/lib/reportsLibrary.ts`) consumed by both the
    // library page and the deep-link logic. The five user-facing
    // categories — financial / operations / sales / team / equipment —
    // are asserted there in the dedicated `reports-library.test.ts`
    // suite. Reports.tsx no longer carries the catalog inline.
    const catalogPath = path.resolve(
      __dirname,
      "..",
      "client",
      "src",
      "lib",
      "reportsLibrary.ts",
    );
    const catalog = fs.readFileSync(catalogPath, "utf-8");
    for (const key of ["financial", "operations", "sales", "team", "equipment"]) {
      expect(catalog).toMatch(new RegExp(`id:\\s*"${key}"`));
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — no-fake-data guard
// ---------------------------------------------------------------------------

describe("Reports page — no fabricated metric values", () => {
  const filePath = path.resolve(__dirname, "..", "client", "src", "pages", "Reports.tsx");
  const source = fs.readFileSync(filePath, "utf-8");

  it("does not contain hardcoded business-shaped placeholder strings", () => {
    // The user explicitly forbade fake interpretive copy. These are
    // example phrases from the brief; they must NEVER appear in the
    // page source — every metric must come from the backend.
    const forbiddenPhrases = [
      "commercial jobs are driving",
      "$10,000",
      "$50,000",
      "Mock data",
      "mockMetrics",
      "fakeData",
    ];
    for (const phrase of forbiddenPhrases) {
      expect(source.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });

  it("does not declare a hardcoded metric array literal", () => {
    // Catches the easy regression of someone shipping
    //   const mockMetrics = [{ value: 41, ... }, { value: 35, ... }]
    // Anything matching `currentValue: <number>` outside a type
    // signature (TS interface) would have to come from the backend
    // response in our architecture.
    const literalCurrentValue = source.match(/currentValue:\s*\d+(?:\.\d+)?/g);
    expect(literalCurrentValue ?? []).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Layer 4 — server route + storage source guards
// ---------------------------------------------------------------------------

describe("Reports snapshot — server route + aggregator wiring", () => {
  const routePath = path.resolve(__dirname, "..", "server", "routes", "reports.ts");
  const storagePath = path.resolve(__dirname, "..", "server", "storage", "reportsSnapshot.ts");

  it("registers GET /snapshot with role gating", () => {
    const src = fs.readFileSync(routePath, "utf-8");
    expect(src).toMatch(/router\.get\(\s*"\/snapshot",\s*requireRole\(MANAGER_ROLES\)/);
    expect(src).toMatch(/getCompanySnapshot/);
  });

  it("aggregator reads the canonical real-data tables only (no mock import)", () => {
    // Snapshot-specific tables live in reportsSnapshot.ts; revenue /
    // payments / AR primitives now live in reportsCommon.ts (shared
    // with the Financial tab). Check the union of the two so a future
    // refactor can't introduce a mocks file in either place.
    const src = fs.readFileSync(storagePath, "utf-8");
    const commonSrc = fs.readFileSync(
      path.resolve(__dirname, "..", "server", "storage", "reportsCommon.ts"),
      "utf-8",
    );
    const union = src + "\n" + commonSrc;
    for (const table of [
      "invoices",
      "payments",
      "jobs",
      "jobStatusEvents",
      "quotes",
      "leads",
      "timeEntries",
    ]) {
      expect(union).toContain(table);
    }
    expect(src).not.toMatch(/mockMetrics|fakeData|HARDCODED_/i);
    expect(commonSrc).not.toMatch(/mockMetrics|fakeData|HARDCODED_/i);
  });

  it("aggregator emits every metric with hasData and polarity", () => {
    const src = fs.readFileSync(storagePath, "utf-8");
    // Every buildMetric call site MUST pass polarity + hasData. We
    // grep for the literal call sites; absence of either field on a
    // call would be visible here.
    // Post 2026-05-02 refinement: 10 metrics total
    //   Revenue & Cash Flow: revenue, avg_payment_days, ar_30_plus  (3)
    //   Jobs & Operations:   jobs_completed, avg_job_value, unbillable_cost  (3)
    //   Sales:               leads_created, lead_conversion, quotes_created, quote_conversion  (4)
    const buildCount = (src.match(/buildMetric\(\{/g) ?? []).length;
    const polarityCount = (src.match(/polarity:\s*"(higher|lower)_is_better"/g) ?? []).length;
    const hasDataCount = (src.match(/hasData:/g) ?? []).length;
    expect(buildCount).toBe(10);
    expect(polarityCount).toBeGreaterThanOrEqual(buildCount);
    expect(hasDataCount).toBeGreaterThanOrEqual(buildCount);
  });

  it("percent change is null-safe (no fabricated 'Infinity%' on zero baselines)", () => {
    // The percentChange helper now lives in reportsCommon.ts (shared
    // with the Financial tab). The short-circuit on prev === 0 must
    // be in that module so both tabs inherit it.
    const commonSrc = fs.readFileSync(
      path.resolve(__dirname, "..", "server", "storage", "reportsCommon.ts"),
      "utf-8",
    );
    expect(commonSrc).toMatch(/if\s*\(\s*prev\s*===\s*0\s*\)\s*return\s*null/);
  });

  it("exposes the canonical AR bucket keys including Total overdue", () => {
    const src = fs.readFileSync(storagePath, "utf-8");
    for (const key of [`"current"`, `"d30"`, `"d60_plus"`, `"total_overdue"`]) {
      expect(src).toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 5 — 2026-05-02 refinement pass guards.
//
// "Revenue per job" was removed because it overlapped with avg job
// invoice value. Lock that removal in: zero references in any source
// file. Also lock in the Jobs & Operations section's final shape
// (exactly 3 metrics, in a max-3-column grid, in the spec order
// "output + value + efficiency loss").
// ---------------------------------------------------------------------------

describe("Reports snapshot — refinement (revenue per job removed, jobs simplified)", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const pagePath = path.join(repoRoot, "client", "src", "pages", "Reports.tsx");
  const storagePath = path.join(repoRoot, "server", "storage", "reportsSnapshot.ts");
  const sharedPath = path.join(repoRoot, "shared", "reports", "snapshot.ts");
  const formatterPath = path.join(repoRoot, "client", "src", "lib", "reportsFormatters.ts");

  it("revenue per job has zero references across the snapshot surface files", () => {
    const sources = [pagePath, storagePath, sharedPath, formatterPath].map((p) =>
      fs.readFileSync(p, "utf-8"),
    );
    const forbidden = [/revenue_per_job/i, /revenuePerJob/, /Revenue per job/i];
    for (const src of sources) {
      for (const re of forbidden) {
        expect(src).not.toMatch(re);
      }
    }
  });

  it("aggregator declares the final Jobs & Operations metric set in the spec order", () => {
    const src = fs.readFileSync(storagePath, "utf-8");
    // The three keys must appear in this order: output → value → loss.
    const orderRegex = new RegExp(
      'key:\\s*"jobs_completed"[\\s\\S]+?key:\\s*"avg_job_value"[\\s\\S]+?key:\\s*"unbillable_cost"',
    );
    expect(src).toMatch(orderRegex);
  });

  it("avg_job_value is invoice-based — uses invoices.total + invoices.issueDate, NOT payments", () => {
    // 2026-05-02 phase 3: this lambda was lifted from reportsSnapshot.ts
    // into reportsCommon.ts::sharedQueries so the Operations tab can
    // reuse it. The shape assertions follow it to its new home.
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "server", "storage", "reportsCommon.ts"),
      "utf-8",
    );
    const block = src.match(
      /avgJobInvoiceValue:[\s\S]+?return parseFloat[\s\S]+?\}\s*,/,
    );
    expect(block, "avgJobInvoiceValue lambda must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/\.from\(invoices\)/);
    expect(body).toMatch(/CAST\(\$\{invoices\.total\}/);
    expect(body).toMatch(/invoices\.issueDate/);
    expect(body).toMatch(/isNotNull\(invoices\.jobId\)/);
    // No payment cross-contamination — avg job value must NOT join payments.
    expect(body).not.toMatch(/\bpayments\b/);
  });

  it("unbillable_cost is cost-only (no ratio variants), excludes entries without a cost rate", () => {
    // Same lift as avg_job_value — query lambda lives in reportsCommon
    // now. The "no ratio metric" guard still applies repository-wide.
    const commonSrc = fs.readFileSync(
      path.resolve(__dirname, "..", "server", "storage", "reportsCommon.ts"),
      "utf-8",
    );
    const block = commonSrc.match(
      /unbillableCost:[\s\S]+?return parseFloat[\s\S]+?\}\s*,/,
    );
    expect(block, "unbillableCost lambda must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/durationMinutes\}::numeric \/ 60\.0/);
    expect(body).toMatch(/CAST\(\$\{timeEntries\.costRateSnapshot\}/);
    expect(body).toMatch(/isNotNull\(timeEntries\.costRateSnapshot\)/);
    expect(body).toMatch(/eq\(timeEntries\.billable, false\)/);
    // No ratio-based companion metric anywhere in the snapshot file.
    const snapshotSrc = fs.readFileSync(storagePath, "utf-8");
    expect(snapshotSrc).not.toMatch(/unbillable_ratio|unbillable_pct|unbillablePercent/i);
  });

  it("Jobs section UI: exactly 3 metrics, capped at md:grid-cols-3 (output + value + loss)", () => {
    const src = fs.readFileSync(pagePath, "utf-8");
    // Find the MetricsSection block for Jobs & Operations.
    const block = src.match(
      /testId="snapshot-section-jobs"[\s\S]+?gridClassName="([^"]+)"/,
    );
    expect(block, "Jobs MetricsSection block must exist").not.toBeNull();
    const grid = block![1];
    expect(grid).toMatch(/md:grid-cols-3/);
    // 4-col layouts are forbidden for the Jobs section in this pass.
    expect(grid).not.toMatch(/lg:grid-cols-4|md:grid-cols-4/);
    // Spec rule: "2–3 metrics max per row" — no 5+ either, of course.
    expect(grid).not.toMatch(/grid-cols-5|grid-cols-6/);
  });

  it("snapshot empty payload renders per-section empty states, NOT a full-page error", () => {
    const src = fs.readFileSync(pagePath, "utf-8");
    // The full-page error branch must trigger ONLY on `isError || !data`
    // and the in-page sections must each render their own empty state
    // when every metric in that section reports hasData=false.
    expect(src).toMatch(/if\s*\(isError\s*\|\|\s*!data\)/);
    // The full-page branch must NOT also gate on metric content
    // (e.g. it must NOT short-circuit when sections are merely empty).
    const errorBranch = src.match(/if\s*\(isError\s*\|\|\s*!data\)\s*\{[\s\S]+?\}/);
    expect(errorBranch).not.toBeNull();
    expect(errorBranch![0]).not.toMatch(/metrics\.length|hasData/);
    // Per-section empty state is wired up via SectionEmpty + the
    // `allEmpty` guard inside MetricsSection / ARSection.
    expect(src).toMatch(/function SectionEmpty/);
    expect(src).toMatch(/const allEmpty\s*=/);
    expect(src).toMatch(/metrics\.every\(\(m\)\s*=>\s*!m\.hasData\)/);
    // The deprecated copy "Snapshot unavailable." must not return.
    expect(src).not.toMatch(/Snapshot unavailable/);
  });

  it("AR section degrades to a section-level empty when every bucket has 0 amount + 0 invoices", () => {
    const src = fs.readFileSync(pagePath, "utf-8");
    const block = src.match(/function ARSection[\s\S]+?\n\}/);
    expect(block, "ARSection must exist").not.toBeNull();
    expect(block![0]).toMatch(/b\.amount === 0 && b\.invoiceCount === 0/);
    expect(block![0]).toMatch(/SectionEmpty/);
  });
});

// ---------------------------------------------------------------------------
// Layer 6 — repository-wide grep guard for the removed metric.
// ---------------------------------------------------------------------------

describe("Repository-wide guard — 'revenue per job' has been fully removed", () => {
  it("does not appear in any tracked source file under client/, server/, or shared/", () => {
    // Walk a small set of allow-listed roots (avoids node_modules / build
    // artefacts). If a future commit re-introduces the metric anywhere,
    // this fails the build.
    const repoRoot = path.resolve(__dirname, "..");
    const roots = [
      path.join(repoRoot, "client", "src"),
      path.join(repoRoot, "server"),
      path.join(repoRoot, "shared"),
    ];
    const matches: string[] = [];
    const visit = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(full);
        } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
          const txt = fs.readFileSync(full, "utf-8");
          if (
            /revenue_per_job/i.test(txt) ||
            /revenuePerJob/.test(txt) ||
            /Revenue per job/i.test(txt)
          ) {
            matches.push(path.relative(repoRoot, full));
          }
        }
      }
    };
    for (const r of roots) visit(r);
    expect(matches, `Found references in: ${matches.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Layer 7 — 2026-05-02 GROUP BY alias regression guard.
//
// Both Reports endpoints went down because `getCurrentARBuckets` /
// `getARAging` did `.groupBy(sql\`bucket\`)` against an unaliased SELECT
// expression. Drizzle does NOT emit `AS "bucket"` for `select({ bucket:
// sql\`CASE…\` })`, so the bare `bucket` reference in GROUP BY hit
// Postgres as a column name lookup (`column "bucket" does not exist`).
//
// Fix: define the CASE expression once as a const and pass the SAME
// reference into both `.select(...)` and `.groupBy(...)` — the canonical
// pattern used by `server/storage/reports.ts::agingBucketExpr`.
//
// These guards lock the fix in. They run synchronously (source-grep +
// Drizzle's own `toSQL()`) — no DB round-trip required.
// ---------------------------------------------------------------------------

describe("Reports — GROUP BY alias regression guard", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const reportsStorageRoots = [
    path.join(repoRoot, "server", "storage", "reportsSnapshot.ts"),
    path.join(repoRoot, "server", "storage", "reportsFinancial.ts"),
    path.join(repoRoot, "server", "storage", "reportsCommon.ts"),
  ];

  it("no Reports storage file groups by a bare single-word SQL alias", () => {
    // `.groupBy(sql\`bucket\`)` and friends are forbidden — Drizzle won't
    // emit the alias and Postgres will reject the query. Real columns
    // (Drizzle column refs) and full SQL expressions are both fine.
    const offenders: string[] = [];
    for (const file of reportsStorageRoots) {
      const src = fs.readFileSync(file, "utf-8");
      // `.groupBy(sql\`<single identifier>\`)` — naked alias reference.
      const re = /\.groupBy\(\s*sql`\s*[a-z_][a-z0-9_]*\s*`\s*\)/gi;
      const matches = src.match(re) ?? [];
      for (const m of matches) offenders.push(`${path.basename(file)}: ${m}`);
    }
    expect(offenders, `Forbidden GROUP BY alias pattern found:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("snapshot AR query emits a GROUP BY containing the CASE expression", async () => {
    // Drizzle's toSQL() reflects the actual SQL the driver will send.
    // We can't easily build the same query in the test (it'd duplicate
    // the storage-layer logic), but we CAN grep the storage source for
    // the canonical "define-once / use-twice" shape: a `bucketExpr`
    // const that appears in both .select() and .groupBy().
    const src = fs.readFileSync(
      path.join(repoRoot, "server", "storage", "reportsSnapshot.ts"),
      "utf-8",
    );
    // The function body must:
    //   (a) declare a `bucketExpr` const (or equivalent name)
    //   (b) reference it inside `select({ bucket: <expr>, ...`
    //   (c) reference it inside `.groupBy(<expr>)`
    const fnBlock = src.match(/async function getCurrentARBuckets[\s\S]+?\n\}/);
    expect(fnBlock, "getCurrentARBuckets must exist").not.toBeNull();
    const body = fnBlock![0];
    expect(body).toMatch(/const bucketExpr\s*=\s*sql/);
    expect(body).toMatch(/bucket:\s*bucketExpr/);
    expect(body).toMatch(/\.groupBy\(\s*bucketExpr\s*\)/);
    // And the BAD pattern must NOT be present.
    expect(body).not.toMatch(/\.groupBy\(\s*sql`\s*bucket\s*`\s*\)/);
  });

  it("financial AR query follows the same pattern", () => {
    const src = fs.readFileSync(
      path.join(repoRoot, "server", "storage", "reportsFinancial.ts"),
      "utf-8",
    );
    const fnBlock = src.match(/async function getARAging[\s\S]+?\n\}/);
    expect(fnBlock, "getARAging must exist").not.toBeNull();
    const body = fnBlock![0];
    expect(body).toMatch(/const bucketExpr\s*=\s*sql/);
    expect(body).toMatch(/bucket:\s*bucketExpr/);
    expect(body).toMatch(/\.groupBy\(\s*bucketExpr\s*\)/);
    expect(body).not.toMatch(/\.groupBy\(\s*sql`\s*bucket\s*`\s*\)/);
  });

  // toSQL snapshot test — proves Drizzle generates the GROUP BY clause
  // with the CASE expression body, NOT a bare alias reference. Builds
  // a representative query out-of-band so we don't need to call into
  // the storage layer (which would require a DB round-trip on the
  // .execute step we don't actually need).
  it("Drizzle emits GROUP BY <CASE…END>, not GROUP BY bucket", async () => {
    const { sql: drizzleSql, eq, inArray, and } = await import("drizzle-orm");
    const { db } = await import("../server/db");
    const { invoices } = await import("../shared/schema");
    const { UNPAID_INVOICE_STATUSES } = await import("../shared/invoiceStatus");

    const bucketExpr = drizzleSql`
      CASE
        WHEN ${invoices.dueDate} IS NULL OR ${invoices.dueDate} >= CURRENT_DATE THEN 'current'
        WHEN (CURRENT_DATE - ${invoices.dueDate}::date) <= 30 THEN 'd30'
        ELSE 'd60_plus'
      END
    `;
    const q = db
      .select({
        bucket: bucketExpr,
        count: drizzleSql<number>`COUNT(*)::int`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, "00000000-0000-0000-0000-000000000000"),
          inArray(invoices.status, UNPAID_INVOICE_STATUSES),
        ),
      )
      .groupBy(bucketExpr);
    const built = (q as unknown as { toSQL: () => { sql: string } }).toSQL();
    // The GROUP BY clause must contain the CASE keyword (our expression),
    // not a naked `GROUP BY bucket` alias reference.
    expect(built.sql).toMatch(/group by[\s\S]+?case[\s\S]+?end/i);
    expect(built.sql).not.toMatch(/group by\s+bucket\b/i);
  });
});
