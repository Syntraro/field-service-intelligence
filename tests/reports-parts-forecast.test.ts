/**
 * Tests for the Parts Forecast deep-report page
 * (`/reports/parts-forecast`) and its backing aggregator
 * (`/api/reports/parts-forecast`).
 *
 * Layers:
 *   1. Page source guards — KPI strip, all five sections, error path,
 *      no client-side aggregation duplication (no `.reduce()` over
 *      data — only the visual `Math.max` for relative-bar scaling
 *      is permitted).
 *   2. No-fake-data guards — neither the page, the contract, nor the
 *      aggregator carry hardcoded business numbers / placeholder
 *      copy.
 *   3. Server route + storage source guards — role gating, the
 *      aggregator is a pure orchestrator (no direct DB / schema
 *      imports), KPIs derive from helpers (no extra COUNT(*)), the
 *      forecast SQL only joins `location_pm_part_templates` (NEVER
 *      `equipment_catalog_items` or `client_parts`), the visit
 *      filter is consistent across helpers, the missing-parts
 *      query uses `NOT EXISTS` over the active-template predicate,
 *      and per-tech grouping is gated off (the contract's
 *      `PARTS_BY_TECHNICIAN_DISABLED_REASON` is the canonical
 *      reason string).
 *   4. Reuse canonicality — the three new shared helpers live in
 *      `reportsCommon`; the parts-forecast aggregator imports them.
 *   5. Quantity rule — visits are NOT deduplicated by location; the
 *      shared SQL relies on PRE-aggregated SUM over the (visit ×
 *      template) join, NOT a SELECT DISTINCT visit per location.
 *   6. App + library wiring — route mounted, library catalog has an
 *      active `parts-forecast` entry under the "operations"
 *      category pointing to `/reports/parts-forecast`.
 *   7. Forecast does NOT touch equipment-warranty / failure
 *      reporting tables — out of scope.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { REPORTS_LIBRARY } from "../client/src/lib/reportsLibrary";
import { PARTS_BY_TECHNICIAN_DISABLED_REASON } from "../shared/reports/partsForecast";

const repoRoot = path.resolve(__dirname, "..");
const pagePath = path.join(
  repoRoot,
  "client",
  "src",
  "pages",
  "ReportsPartsForecast.tsx",
);
const aggregatorPath = path.join(
  repoRoot,
  "server",
  "storage",
  "reportsPartsForecast.ts",
);
const sharedPath = path.join(
  repoRoot,
  "shared",
  "reports",
  "partsForecast.ts",
);
const routePath = path.join(repoRoot, "server", "routes", "reports.ts");
const commonPath = path.join(repoRoot, "server", "storage", "reportsCommon.ts");
const appPath = path.join(repoRoot, "client", "src", "App.tsx");

// ---------------------------------------------------------------------------
// Layer 1 — page source guards
// ---------------------------------------------------------------------------

describe("Reports Parts Forecast page (/reports/parts-forecast) — source guard", () => {
  const source = fs.readFileSync(pagePath, "utf-8");

  it("exports ReportsPartsForecast with title + range selector + back button", () => {
    expect(source).toMatch(/export default function ReportsPartsForecast\b/);
    expect(source).toMatch(/data-testid="reports-parts-forecast-page"/);
    expect(source).toMatch(/data-testid="reports-parts-forecast-title"/);
    expect(source).toMatch(/data-testid="select-parts-forecast-range"/);
    expect(source).toMatch(/data-testid="parts-forecast-back-to-reports"/);
    expect(source).toMatch(/setLocation\("\/reports"\)/);
  });

  it("threads the canonical /api/reports/parts-forecast endpoint into TanStack Query", () => {
    expect(source).toMatch(
      /\["\/api\/reports\/parts-forecast",\s*range\]/,
    );
    expect(source).toMatch(
      /`\/api\/reports\/parts-forecast\?range=\$\{range\}`/,
    );
  });

  it("renders all six section/KPI test ids", () => {
    for (const id of [
      "parts-forecast-section-kpis",
      "parts-forecast-section-parts-needed",
      "parts-forecast-section-parts-by-location",
      "parts-forecast-section-parts-by-technician",
      "parts-forecast-section-missing-parts",
      "parts-forecast-section-ordering-list",
    ]) {
      const propMatch = new RegExp(`testId="${id}"`).test(source);
      const attrMatch = new RegExp(`data-testid="${id}"`).test(source);
      expect(propMatch || attrMatch, `expected ${id} in source`).toBe(true);
    }
  });

  it("each section card short-circuits to SectionEmpty / disabled-reason when hasData is false", () => {
    const chunks = source.split(/\nfunction /);
    const cards = [
      "PartsNeededCard",
      "PartsByLocationCard",
      "MissingPartsCard",
      "OrderingListCard",
    ];
    for (const fn of cards) {
      const chunk = chunks.find(
        (c) => c.startsWith(`${fn}(`) || c.startsWith(`${fn} `),
      );
      expect(chunk, `${fn} must exist`).toBeDefined();
      expect(chunk!).toMatch(/!section\.hasData/);
      expect(chunk!).toContain("SectionEmpty");
    }
    // PartsByTechnicianCard surfaces the contract's `reason` string
    // verbatim instead of "Not enough data yet" — its inert state is
    // structural, not data-driven.
    const techChunk = chunks.find(
      (c) =>
        c.startsWith("PartsByTechnicianCard(") ||
        c.startsWith("PartsByTechnicianCard "),
    );
    expect(techChunk, "PartsByTechnicianCard must exist").toBeDefined();
    expect(techChunk!).toMatch(/section\.reason/);
    expect(techChunk!).toMatch(
      /data-testid="parts-forecast-section-parts-by-technician-disabled"/,
    );
  });

  it("KPI strip falls back to its own section-empty when kpis.hasData is false", () => {
    expect(source).toMatch(/!data\.kpis\.hasData/);
  });

  it("full-page error path triggers ONLY on (isError || !data)", () => {
    expect(source).toMatch(/isError\s*\|\|\s*!data/);
    expect(source).toContain('data-testid="parts-forecast-error"');
  });

  it("data-driven cards iterate backend items directly — no client-side aggregation", () => {
    const chunks = source.split(/\nfunction /);
    const dataCards = [
      "PartsNeededCard",
      "PartsByLocationCard",
      "MissingPartsCard",
      "OrderingListCard",
    ];
    for (const fn of dataCards) {
      const card = chunks.find(
        (c) => c.startsWith(`${fn}(`) || c.startsWith(`${fn} `),
      );
      expect(card, `${fn} must exist`).toBeDefined();
      expect(card!).toMatch(/section\.items\.map\(/);
      expect(card!).not.toMatch(/section\.items\.sort\(/);
      expect(card!).not.toMatch(/section\.items\.filter\(/);
      // Only the visual relative-bar `Math.max` reduce is permitted —
      // and only on PartsNeededCard (the only card with a relative-
      // scale visualization).
      const reduces = card!.match(/\.reduce\(/g) ?? [];
      if (fn === "PartsNeededCard") {
        expect(reduces.length).toBeLessThanOrEqual(1);
        if (reduces.length === 1) {
          const idx = card!.indexOf(".reduce(");
          const tail = card!.slice(idx, idx + 200);
          expect(tail).toContain("Math.max");
        }
      } else {
        expect(reduces.length).toBe(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — no-fake-data guards
// ---------------------------------------------------------------------------

describe("Parts Forecast deep-report — no fabricated metric values", () => {
  const sources = [
    fs.readFileSync(pagePath, "utf-8"),
    fs.readFileSync(aggregatorPath, "utf-8"),
    fs.readFileSync(sharedPath, "utf-8"),
  ];

  it("contains no hardcoded business-shaped placeholder strings", () => {
    const forbidden = [
      "Mock data",
      "mockMetrics",
      "fakeData",
      "$10,000",
      "$50,000",
      "demoTotal",
      "fakePart",
      "lorem ipsum",
    ];
    for (const src of sources) {
      for (const phrase of forbidden) {
        expect(src.toLowerCase()).not.toContain(phrase.toLowerCase());
      }
    }
  });

  it("contains no contract-shaped numeric literals (forecast values are computed)", () => {
    const forbidden = /\b(totalPartsRequired|uniquePartTypes|locationsRequiringParts|pmVisitsRequiringParts|totalQuantity|locationCount|visitCount|quantity):\s*[1-9]\d*(?:\.\d+)?/g;
    for (const src of sources) {
      expect(src.match(forbidden) ?? []).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — server route + aggregator wiring guards
// ---------------------------------------------------------------------------

describe("Parts Forecast — server route + aggregator wiring", () => {
  const routeSrc = fs.readFileSync(routePath, "utf-8");
  const aggSrc = fs.readFileSync(aggregatorPath, "utf-8");
  const commonSrc = fs.readFileSync(commonPath, "utf-8");

  it("registers GET /parts-forecast under requireRole(MANAGER_ROLES)", () => {
    expect(routeSrc).toMatch(
      /router\.get\(\s*"\/parts-forecast",\s*requireRole\(MANAGER_ROLES\)/,
    );
    expect(routeSrc).toMatch(/getCompanyPartsForecast/);
    expect(routeSrc).toMatch(/partsForecastQuerySchema/);
    // The route schema only accepts the forward-looking range key —
    // `last_30_days` would be incoherent for a forecast.
    expect(routeSrc).toMatch(/z\.enum\(\["next_30_days"\]\)/);
  });

  it("aggregator does NOT directly hit DB tables — pure orchestrator", () => {
    expect(aggSrc).not.toMatch(/from "@shared\/schema"/);
    expect(aggSrc).not.toMatch(/from "\.\.\/db"/);
    expect(aggSrc).not.toMatch(/mockMetrics|fakeData|HARDCODED_/i);
  });

  it("forecast helpers source ONLY from location_pm_part_templates — NEVER from client_parts or equipment_catalog_items", () => {
    // The three forecast helpers are forbidden from joining
    // client_parts (the legacy per-client SKU table) or
    // equipment_catalog_items (the equipment-aware catalog
    // associations). Per spec: "Only use real location parts" /
    // "no equipment warranty/failure reporting".
    const helpers = [
      "getForecastPartsNeededShared",
      "getForecastPartsByLocationShared",
      "getForecastMissingPartsShared",
    ];
    for (const sym of helpers) {
      const block = commonSrc.match(
        new RegExp(`export async function ${sym}[\\s\\S]+?\\n\\}`),
      );
      expect(block, `${sym} must exist`).not.toBeNull();
      const body = block![0];
      expect(body).not.toMatch(/clientParts/);
      expect(body).not.toMatch(/equipmentCatalogItems/);
    }
  });

  it("PM visit predicate is shared across forecast helpers (consistent visit set)", () => {
    // The DRY invariant: `pmVisitInWindowWhere` is the single visit
    // filter used by parts-needed, parts-by-location, and
    // missing-parts. Locks: jobType='maintenance', visit isActive,
    // archivedAt IS NULL, scheduledStart in window.
    expect(commonSrc).toMatch(/pmVisitInWindowWhere\s*=/);
    expect(commonSrc).toMatch(/eq\(jobs\.jobType,\s*"maintenance"\)/);
    expect(commonSrc).toMatch(/eq\(jobVisits\.isActive,\s*true\)/);
    expect(commonSrc).toMatch(/isNull\(jobVisits\.archivedAt\)/);
    expect(commonSrc).toMatch(/isNull\(jobs\.deletedAt\)/);
    // The three helpers must reference the predicate by name (no
    // ad-hoc duplication of the visit filter).
    const refs = (commonSrc.match(/pmVisitInWindowWhere\(/g) ?? []).length;
    expect(refs).toBeGreaterThanOrEqual(3);
  });

  it("active-template filter is also shared (no per-helper drift)", () => {
    expect(commonSrc).toMatch(/activePMPartWhere\s*=/);
    expect(commonSrc).toMatch(
      /eq\(locationPMPartTemplates\.isActive,\s*true\)/,
    );
    expect(commonSrc).toMatch(/isNull\(locationPMPartTemplates\.deletedAt\)/);
  });

  it("missing-parts query uses NOT EXISTS over the active-template predicate", () => {
    const block = commonSrc.match(
      /export async function getForecastMissingPartsShared[\s\S]+?\n\}/,
    );
    expect(block, "getForecastMissingPartsShared must exist").not.toBeNull();
    const body = block![0];
    expect(body).toMatch(/NOT EXISTS/);
    expect(body).toMatch(/lpt\.is_active = true/);
    expect(body).toMatch(/lpt\.deleted_at IS NULL/);
  });

  it("KPIs are derived from already-fetched rows (no extra COUNT(*) probe)", () => {
    // Aggregator runs exactly three Promise.all queries (parts-needed,
    // parts-by-location, missing-parts). KPI math happens in TS.
    const promiseAllMatch = aggSrc.match(/Promise\.all\(\[[\s\S]+?\]\)/);
    expect(promiseAllMatch, "aggregator must use Promise.all").not.toBeNull();
    const inside = promiseAllMatch![0];
    const helperCalls = (
      inside.match(/getForecast\w+Shared\(/g) ?? []
    ).length;
    expect(helperCalls).toBe(3);
    // KPIs derive from the helper outputs.
    expect(aggSrc).toMatch(/totalPartsRequired/);
    expect(aggSrc).toMatch(/uniquePartTypes/);
    expect(aggSrc).toMatch(/locationsRequiringParts/);
    expect(aggSrc).toMatch(/pmVisitsRequiringParts/);
  });

  it("parts-by-technician section is structurally inert (multi-tech reason)", () => {
    expect(aggSrc).toMatch(/PARTS_BY_TECHNICIAN_DISABLED_REASON/);
    // The contract carries the reason string; the aggregator must use
    // it (NOT redefine it inline).
    const sharedSrc = fs.readFileSync(sharedPath, "utf-8");
    expect(sharedSrc).toMatch(/PARTS_BY_TECHNICIAN_DISABLED_REASON\s*=/);
    // The reason must explicitly cite the multi-tech array — the
    // exact rule we are choosing not to fan-out across.
    expect(PARTS_BY_TECHNICIAN_DISABLED_REASON.toLowerCase()).toContain(
      "multi-tech",
    );
    expect(PARTS_BY_TECHNICIAN_DISABLED_REASON.toLowerCase()).toContain(
      "fan-out",
    );
  });

  it("does NOT reintroduce the failing GROUP BY alias bug", () => {
    expect(aggSrc).not.toMatch(/\.groupBy\(\s*sql`\s*[a-z_][a-z0-9_]*\s*`\s*\)/);
    expect(commonSrc).not.toMatch(
      /\.groupBy\(\s*sql`\s*[a-z_][a-z0-9_]*\s*`\s*\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// Layer 4 — reuse canonicality
// ---------------------------------------------------------------------------

describe("Parts Forecast — reuse canonicality", () => {
  const commonSrc = fs.readFileSync(commonPath, "utf-8");
  const aggSrc = fs.readFileSync(aggregatorPath, "utf-8");

  it("reportsCommon exports the three new forecast helpers", () => {
    for (const sym of [
      "getForecastPartsNeededShared",
      "getForecastPartsByLocationShared",
      "getForecastMissingPartsShared",
    ]) {
      expect(commonSrc).toMatch(
        new RegExp(`export async function ${sym}\\(`),
      );
    }
  });

  it("Parts Forecast aggregator imports the new shared helpers", () => {
    expect(aggSrc).toMatch(/from "\.\/reportsCommon"/);
    expect(aggSrc).toMatch(/getForecastPartsNeededShared/);
    expect(aggSrc).toMatch(/getForecastPartsByLocationShared/);
    expect(aggSrc).toMatch(/getForecastMissingPartsShared/);
  });
});

// ---------------------------------------------------------------------------
// Layer 5 — quantity rule (visits NOT deduplicated by location)
// ---------------------------------------------------------------------------

describe("Parts Forecast — per-visit quantity rule (no location dedupe)", () => {
  const commonSrc = fs.readFileSync(commonPath, "utf-8");

  it("parts-needed sums quantityPerVisit across the (visit × template) join — no DISTINCT-on-location", () => {
    const block = commonSrc.match(
      /export async function getForecastPartsNeededShared[\s\S]+?\n\}/,
    );
    expect(block, "getForecastPartsNeededShared must exist").not.toBeNull();
    const body = block![0];
    // The forecast SQL pattern is INNER JOIN job_visits → jobs →
    // locationPMPartTemplates, then SUM the quantity field. If a
    // location has 2 visits, both contribute (the inner-join
    // multiplies the row out per visit). DISTINCT on location_id
    // would break this rule.
    expect(body).toMatch(/\.from\(jobVisits\)/);
    expect(body).toMatch(/innerJoin\(jobs,\s*eq\(jobVisits\.jobId,\s*jobs\.id\)\)/);
    expect(body).toMatch(
      /innerJoin\(\s*locationPMPartTemplates,\s*eq\(locationPMPartTemplates\.locationId,\s*jobs\.locationId\),?\s*\)/,
    );
    expect(body).toMatch(
      /SUM\(CAST\(\$\{locationPMPartTemplates\.quantityPerVisit\}\s*AS\s*numeric\)\)/,
    );
    // Anti-regression: no DISTINCT on location/visit at the SUM
    // level — only DISTINCT on the count fields (locationCount /
    // visitCount).
    expect(body).not.toMatch(/SUM\s*\(\s*DISTINCT/);
  });

  it("parts-by-location yields one entry per visit (NOT one per location)", () => {
    const block = commonSrc.match(
      /export async function getForecastPartsByLocationShared[\s\S]+?\n\}/,
    );
    expect(block, "getForecastPartsByLocationShared must exist").not.toBeNull();
    const body = block![0];
    // The per-visit roll-up keys on `jobVisits.id`. If we keyed on
    // `jobs.locationId` instead we'd collapse multiple visits at the
    // same site into one entry — directly violating the spec rule.
    expect(body).toMatch(/byVisit\.set\(r\.visitId,/);
    expect(body).not.toMatch(/byVisit\.set\(r\.locationId,/);
  });

  it("KPIs derive `pmVisitsRequiringParts` from per-visit array length (not a SQL count)", () => {
    const aggSrc = fs.readFileSync(aggregatorPath, "utf-8");
    expect(aggSrc).toMatch(
      /pmVisitsRequiringParts:\s*partsByLocationRows\.length/,
    );
    expect(aggSrc).toMatch(/uniquePartTypes:\s*partsNeededRows\.length/);
    // Locations-requiring-parts is a Set over the per-visit rows —
    // distinct locationId across visits, NOT a fan-out of templates.
    expect(aggSrc).toMatch(
      /new Set\(\s*partsByLocationRows\.map\(\(v\)\s*=>\s*v\.locationId\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// Layer 6 — App + library wiring
// ---------------------------------------------------------------------------

describe("Parts Forecast — app route + library catalog wiring", () => {
  const appSrc = fs.readFileSync(appPath, "utf-8");

  it("imports ReportsPartsForecast and mounts /reports/parts-forecast under requireManager", () => {
    expect(appSrc).toMatch(
      /import ReportsPartsForecast from "@\/pages\/ReportsPartsForecast";/,
    );
    const block = appSrc.match(
      /<Route path="\/reports\/parts-forecast">[\s\S]+?<\/Route>/,
    );
    expect(block, "/reports/parts-forecast route must exist").not.toBeNull();
    expect(block![0]).toMatch(/<ProtectedRoute requireManager>/);
    expect(block![0]).toMatch(/<ReportsPartsForecast \/>/);
  });

  it("the library catalog includes an active Parts Forecast entry under Operations Reports", () => {
    const ops = REPORTS_LIBRARY.find((c) => c.id === "operations");
    expect(ops, "Operations category must exist").toBeDefined();
    const entry = ops!.reports.find((r) => r.id === "parts-forecast");
    expect(entry, "Parts Forecast entry must exist").toBeDefined();
    expect(entry!.status).toBe("active");
    expect(entry!.href).toBe("/reports/parts-forecast");
    expect(entry!.tab).toBe("operations");
    expect(entry!.title.toLowerCase()).toContain("parts forecast");
    expect(entry!.description.length).toBeGreaterThan(0);
    // Dedicated-page entries leave sectionTestId empty (deep-link
    // helper checks `href` first).
    expect(entry!.sectionTestId).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Layer 7 — equipment-warranty/failure tables are out of scope
// ---------------------------------------------------------------------------

describe("Parts Forecast — does NOT touch equipment warranty / failure tables", () => {
  const sources = [
    fs.readFileSync(pagePath, "utf-8"),
    fs.readFileSync(aggregatorPath, "utf-8"),
    fs.readFileSync(sharedPath, "utf-8"),
  ];

  it("never references warranty / failure / equipment-history surfaces", () => {
    // "rma" was excluded — it's a substring of `format` (date-fns), so
    // the broader equipment-warranty/failure intent is captured by the
    // more specific tokens below.
    const forbidden = [
      "warranty",
      "failure_log",
      "failureLog",
      "service_history",
      "serviceHistory",
      "maintenanceRecord",
      "equipmentLifecycle",
    ];
    for (const src of sources) {
      for (const phrase of forbidden) {
        expect(
          src.toLowerCase(),
          `Parts Forecast source must not reference "${phrase}"`,
        ).not.toContain(phrase.toLowerCase());
      }
    }
  });
});
