/**
 * Tests for the Reports Library page (/reports/library) and the
 * deep-link wiring back into the Reports page (2026-05-02).
 *
 * Layers:
 *   1. Catalog integrity — `client/src/lib/reportsLibrary.ts` is the
 *      single source of truth. Every active entry must point at a
 *      `tab` value the Reports page recognizes AND a `sectionTestId`
 *      that actually exists in `Reports.tsx`. Coming-soon entries
 *      MUST have an empty `sectionTestId` (so the deep-link helper
 *      cannot navigate to a non-existent anchor).
 *   2. Library page source — `/reports/library` renders one
 *      `library-category-*` per catalog entry, one
 *      `library-report-*` row per report, marks `coming_soon` rows
 *      disabled, and navigates to `/reports?tab=…&section=…` on
 *      active rows.
 *   3. Reports page wiring — the "View all reports" button now
 *      navigates to `/reports/library` (not the old in-page sheet),
 *      the page reads `?tab=` + `?section=` from the URL, switches
 *      the active tab, and scrolls the section into view via the
 *      `data-testid` query.
 *   4. App.tsx route — `/reports/library` is mounted under
 *      `<ProtectedRoute requireManager>` like the rest of the Reports
 *      surface.
 *   5. No fake data — neither the catalog nor the library page
 *      contains hardcoded business numbers / placeholder copy.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  REPORTS_LIBRARY,
  reportLinkFor,
  type LibraryReport,
} from "../client/src/lib/reportsLibrary";

const repoRoot = path.resolve(__dirname, "..");
const libraryPagePath = path.join(repoRoot, "client", "src", "pages", "ReportsLibrary.tsx");
const reportsPagePath = path.join(repoRoot, "client", "src", "pages", "Reports.tsx");
const appPath = path.join(repoRoot, "client", "src", "App.tsx");
const catalogPath = path.join(repoRoot, "client", "src", "lib", "reportsLibrary.ts");

// ---------------------------------------------------------------------------
// Layer 1 — catalog integrity
// ---------------------------------------------------------------------------

describe("Reports library — catalog integrity", () => {
  const reportsSrc = fs.readFileSync(reportsPagePath, "utf-8");

  it("declares the five required categories in spec order", () => {
    expect(REPORTS_LIBRARY.map((c) => c.id)).toEqual([
      "financial",
      "operations",
      "sales",
      "team",
      "equipment",
    ]);
  });

  it("each category has a non-empty label and at least one report", () => {
    for (const cat of REPORTS_LIBRARY) {
      expect(cat.label.length).toBeGreaterThan(0);
      expect(cat.reports.length).toBeGreaterThan(0);
    }
  });

  it("every report id is unique repository-wide", () => {
    const ids = REPORTS_LIBRARY.flatMap((c) => c.reports.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every active report either references a real section or has its own page href", () => {
    // 2026-05-03: catalog grew an `href` field for reports that have
    // their own dedicated route (e.g. AR deep-report at `/reports/ar`).
    // Such entries intentionally carry an empty `sectionTestId` and
    // navigate directly. The active-report integrity rule splits
    // accordingly:
    //   - href set    → href must look like an absolute path under /reports
    //   - href unset  → sectionTestId must exist in Reports.tsx
    const missing: string[] = [];
    for (const cat of REPORTS_LIBRARY) {
      for (const r of cat.reports) {
        if (r.status !== "active") continue;
        if (r.href) {
          if (!/^\/reports(\/|\?|$)/.test(r.href)) {
            missing.push(`${r.id} → href ${r.href} is not under /reports`);
          }
          continue;
        }
        const propMatch = new RegExp(`testId="${r.sectionTestId}"`).test(reportsSrc);
        const attrMatch = new RegExp(`data-testid="${r.sectionTestId}"`).test(reportsSrc);
        if (!propMatch && !attrMatch) {
          missing.push(`${r.id} → ${r.sectionTestId}`);
        }
      }
    }
    expect(missing, `Active reports point at unknown targets:\n${missing.join("\n")}`).toEqual([]);
  });

  it("every active report's tab is one of the six canonical tab keys", () => {
    const VALID = new Set(["snapshot", "financial", "operations", "sales", "team", "equipment"]);
    for (const cat of REPORTS_LIBRARY) {
      for (const r of cat.reports) {
        expect(VALID.has(r.tab), `${r.id}: tab=${r.tab}`).toBe(true);
      }
    }
  });

  it("coming-soon reports have an EMPTY sectionTestId — the deep-link helper falls back safely", () => {
    for (const cat of REPORTS_LIBRARY) {
      for (const r of cat.reports) {
        if (r.status === "coming_soon") {
          expect(r.sectionTestId).toBe("");
        }
      }
    }
  });

  it("reportLinkFor: href > tab+section > coming-soon fallback", () => {
    // (a) active + tab + section → deep-link query string.
    const active: LibraryReport = {
      id: "x",
      title: "X",
      description: "x",
      tab: "financial",
      sectionTestId: "financial-section-revenue-trend",
      status: "active",
    };
    expect(reportLinkFor(active)).toBe(
      "/reports?tab=financial&section=financial-section-revenue-trend",
    );
    // (b) active + href set → navigate directly to the dedicated page.
    //     `tab` and `sectionTestId` are intentionally ignored.
    const dedicated: LibraryReport = {
      id: "ar-deep",
      title: "AR",
      description: "AR",
      tab: "financial",
      sectionTestId: "",
      href: "/reports/ar",
      status: "active",
    };
    expect(reportLinkFor(dedicated)).toBe("/reports/ar");
    // (c) coming-soon → bare `/reports` fallback.
    const soon: LibraryReport = {
      id: "y",
      title: "Y",
      description: "y",
      tab: "team",
      sectionTestId: "",
      status: "coming_soon",
    };
    expect(reportLinkFor(soon)).toBe("/reports");
  });

  // Surface-coverage guard: once a section is rendered in Reports.tsx,
  // it should also appear in the library catalog. This protects against
  // drift in the OTHER direction — adding a new tab section but
  // forgetting to register it under the library.
  it("every Snapshot/Financial/Operations/Sales SectionCard is registered in the library", () => {
    // Pull every `testId="<tab>-section-…"` propname from Reports.tsx.
    // Snapshot is intentionally excluded — its sections are entry points
    // that already get covered by the deeper drill-down tabs (e.g. the
    // Snapshot Revenue card → the Financial Revenue trend report).
    const testIds = new Set<string>();
    const re = /testId="((financial|operations|sales)-section-[^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(reportsSrc)) !== null) {
      testIds.add(m[1]);
    }
    const catalogIds = new Set<string>(
      REPORTS_LIBRARY.flatMap((c) => c.reports.map((r) => r.sectionTestId)).filter(
        (s) => s.length > 0,
      ),
    );
    // KPI strips are aggregate cards rather than individual reports,
    // so the library doesn't list them. `financial-section-top-clients`
    // is an aggregate "supporting view" that the spec for the library
    // catalog does NOT list (the user enumerated exactly five Financial
    // reports — revenue trend, payments breakdown, AR, invoice status,
    // payment time). Including it would expand scope.
    const allowedToSkip = new Set([
      "financial-section-kpis",
      "financial-section-top-clients",
      "operations-section-kpis",
      "sales-section-kpis",
    ]);
    const missing = Array.from(testIds).filter(
      (id) => !catalogIds.has(id) && !allowedToSkip.has(id),
    );
    expect(missing, `Sections rendered but not in library catalog:\n${missing.join("\n")}`).toEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — library page source guards
// ---------------------------------------------------------------------------

describe("Reports library page — source guards", () => {
  const source = fs.readFileSync(libraryPagePath, "utf-8");

  it("exports a default React component named ReportsLibrary", () => {
    expect(source).toMatch(/export default function ReportsLibrary\b/);
  });

  it("renders the canonical page title + back-to-reports button", () => {
    expect(source).toMatch(/data-testid="reports-library-page"/);
    expect(source).toMatch(/data-testid="reports-library-title"/);
    expect(source).toMatch(/data-testid="library-back-to-reports"/);
    expect(source).toMatch(/setLocation\("\/reports"\)/);
  });

  it("iterates REPORTS_LIBRARY for categories and reports — no inline literals", () => {
    expect(source).toMatch(/REPORTS_LIBRARY\.map\(/);
    // Categories rendered via CategoryCard mount one row per report.
    expect(source).toMatch(/category\.reports\.map\(/);
  });

  it("emits per-category and per-report test ids derived from the catalog", () => {
    expect(source).toMatch(/data-testid=\{`library-category-\$\{category\.id\}`\}/);
    expect(source).toMatch(/data-testid=\{`library-report-\$\{report\.id\}`\}/);
  });

  it("renders an active row as a clickable button and a coming-soon row as disabled", () => {
    // The button declares `disabled={!isActive}` and `onClick` only
    // fires when the report is active.
    expect(source).toMatch(/disabled=\{!isActive\}/);
    expect(source).toMatch(/isActive\s*\?\s*\(\)\s*=>\s*onSelect\(report\)\s*:\s*undefined/);
    expect(source).toMatch(/aria-disabled=\{!isActive\}/);
    // Visible "Coming soon" badge for non-active rows.
    expect(source).toMatch(/Coming soon/);
  });

  it("navigates to the deep-link returned by reportLinkFor when a row is clicked", () => {
    expect(source).toMatch(/setLocation\(reportLinkFor\(report\)\)/);
  });

  it("guards against non-active rows even if a caller bypasses the disabled attr", () => {
    // Defense-in-depth: the click handler still short-circuits when
    // `report.status !== "active"`.
    expect(source).toMatch(/if\s*\(report\.status\s*!==\s*"active"\)\s*return/);
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — Reports page wiring (button + deep-link)
// ---------------------------------------------------------------------------

describe("Reports page — View-all button + deep-link wiring", () => {
  const source = fs.readFileSync(reportsPagePath, "utf-8");

  it("the View all reports button navigates to /reports/library", () => {
    // Button block must call setLocation("/reports/library"), not open
    // an in-page sheet.
    expect(source).toMatch(/data-testid="button-view-all-reports"/);
    const buttonBlock = (() => {
      const start = source.indexOf('data-testid="button-view-all-reports"');
      if (start < 0) return "";
      const open = source.lastIndexOf("<Button", start);
      const close = source.indexOf("</Button>", start);
      return source.slice(open, close + "</Button>".length);
    })();
    expect(buttonBlock).toContain('setLocation("/reports/library")');
    // The legacy sheet path is gone — button must NOT open a state-
    // tracked sheet anymore.
    expect(buttonBlock).not.toContain("setLibraryOpen");
  });

  it("the in-page library Sheet has been removed", () => {
    expect(source).not.toContain("ReportsLibrarySheet");
    expect(source).not.toContain("from \"@/components/ui/sheet\"");
  });

  it("reads ?tab=&?section= from the URL and switches the active tab", () => {
    expect(source).toMatch(/URLSearchParams\(window\.location\.search\)/);
    expect(source).toMatch(/params\.get\("tab"\)/);
    expect(source).toMatch(/params\.get\("section"\)/);
    // Active tab is mutated to whatever the URL says (after enum check).
    expect(source).toMatch(/setActiveTab\(tabParam as ReportsTab\)/);
    // Tab whitelist: only one of the six canonical keys is accepted.
    expect(source).toMatch(/validTabs:\s*ReportsTab\[\]\s*=\s*\[\s*"snapshot"/);
  });

  it("scrolls the requested section into view using its testId", () => {
    // The scroll handler uses `document.querySelector` with a template
    // literal that interpolates the URL `section` param, then calls
    // `scrollIntoView` on the result. We assert each piece separately
    // so trailing-comma / line-break formatting differences don't
    // break the test.
    expect(source).toMatch(/document\.querySelector<HTMLElement>\(/);
    expect(source).toMatch(/`\[data-testid="\$\{sectionParam\}"\]`/);
    expect(source).toMatch(/scrollIntoView\(\{\s*behavior:\s*"smooth"/);
  });
});

// ---------------------------------------------------------------------------
// Layer 4 — App.tsx route
// ---------------------------------------------------------------------------

describe("App.tsx — /reports/library route", () => {
  const source = fs.readFileSync(appPath, "utf-8");

  it("imports ReportsLibrary and mounts /reports/library under requireManager", () => {
    expect(source).toMatch(/import ReportsLibrary from "@\/pages\/ReportsLibrary";/);
    const block = source.match(
      /<Route path="\/reports\/library">[\s\S]+?<\/Route>/,
    );
    expect(block, "/reports/library route must exist").not.toBeNull();
    expect(block![0]).toMatch(/<ProtectedRoute requireManager>/);
    expect(block![0]).toMatch(/<ReportsLibrary \/>/);
  });
});

// ---------------------------------------------------------------------------
// Layer 5 — no fake data
// ---------------------------------------------------------------------------

describe("Reports library — no fabricated metrics", () => {
  const sources = [
    fs.readFileSync(catalogPath, "utf-8"),
    fs.readFileSync(libraryPagePath, "utf-8"),
  ];

  it("contains no hardcoded business numbers / placeholder values", () => {
    const forbidden = [
      "Mock data",
      "mockMetrics",
      "fakeData",
      "$10,000",
      "$50,000",
      "demoTotal",
      "lorem ipsum",
    ];
    for (const src of sources) {
      for (const phrase of forbidden) {
        expect(src.toLowerCase()).not.toContain(phrase.toLowerCase());
      }
    }
  });

  it("contains no MetricCard / output-shape numeric literals", () => {
    const forbidden = /\b(currentValue|previousMonthValue|previousQuarterValue|previousYearValue|totalAmount|totalCost|conversionPercent|percentOfTotal):\s*[1-9]\d*(?:\.\d+)?/g;
    for (const src of sources) {
      expect(src.match(forbidden) ?? []).toEqual([]);
    }
  });
});
