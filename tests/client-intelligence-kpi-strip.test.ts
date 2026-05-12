/**
 * client-intelligence-kpi-strip.test.ts
 *
 * Static-analysis assertions for the Client Detail page layout (2026-05-11
 * redesign): action buttons in header, 4-card KPI strip, no sticky classes,
 * removed cards absent from strip.
 */

import * as fs from "fs";
import * as path from "path";

// ── Helpers ──────────────────────────────────────────────────────────────────

function read(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, "..", rel), "utf-8");
}

// ── Files under test ─────────────────────────────────────────────────────────

const stripFile = read("client/src/components/client-intelligence/ClientKpiStrip.tsx");
const detailPage = read("client/src/pages/ClientDetailPage.tsx");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ClientKpiStrip — 4-card layout", () => {
  it("renders exactly 4 KpiTile cards", () => {
    const matches = [...stripFile.matchAll(/<KpiTile\b/g)];
    expect(matches.length).toBe(4);
  });

  it("includes Lifetime Revenue tile", () => {
    expect(stripFile).toContain("Lifetime Revenue");
  });

  it("includes Outstanding Balance tile", () => {
    expect(stripFile).toContain("Outstanding Balance");
  });

  it("includes Avg Days To Pay tile", () => {
    expect(stripFile).toContain("Avg Days To Pay");
  });

  it("includes Active Jobs tile", () => {
    expect(stripFile).toContain("Active Jobs");
  });

  it("does NOT contain removed card labels", () => {
    const removed = [
      "Lifetime Gross Margin",
      "Quote Approval Rate",
      "Last Service Date",
      "Maintenance Plan",
    ];
    for (const label of removed) {
      expect(stripFile).not.toContain(label);
    }
  });

  it("uses 4-column desktop grid", () => {
    expect(stripFile).toContain("lg:grid-cols-4");
  });

  it("has no sticky class", () => {
    expect(stripFile).not.toMatch(/\bsticky\b/);
  });

  it("accepts activeJobsCount and onHoldJobsCount props", () => {
    expect(stripFile).toContain("activeJobsCount");
    expect(stripFile).toContain("onHoldJobsCount");
  });

  it("has data-testid on the wrapper", () => {
    expect(stripFile).toContain('data-testid="client-kpi-strip"');
  });
});

describe("ClientDetailPage — header restructure", () => {
  it("action buttons are in the right-aligned header block", () => {
    expect(detailPage).toContain('data-testid="header-actions"');
  });

  it("Create Job button exists in header", () => {
    expect(detailPage).toContain('data-testid="header-create-job"');
  });

  it("Create Quote button exists in header", () => {
    expect(detailPage).toContain('data-testid="header-create-quote"');
  });

  it("Create Invoice button exists in header", () => {
    expect(detailPage).toContain('data-testid="header-create-invoice"');
  });

  it("overflow menu exists in header", () => {
    expect(detailPage).toContain('data-testid="header-overflow"');
  });

  it("old action-button row (mt-4 pt-3 border-t) is removed", () => {
    expect(detailPage).not.toContain("mt-4 pt-3 border-t border-slate-100");
  });

  it("old mini-KPI block (inline KPI pill) is removed", () => {
    // Old block used pl-12 pt-1 flex layout with an inline bordered KPI strip
    expect(detailPage).not.toContain("pl-12 pt-1");
    // Old block had this exact structure: flex-1 flex justify-start items-center pl-12
    expect(detailPage).not.toContain("flex-1 flex justify-start items-center pl-12");
  });

  it("KpiStrip receives activeJobsCount and onHoldJobsCount props", () => {
    expect(detailPage).toContain("activeJobsCount={activeJobsCount}");
    expect(detailPage).toContain("onHoldJobsCount={onHoldJobsCount}");
  });

  it("onHoldJobsCount is computed from companyJobs", () => {
    expect(detailPage).toContain("onHoldJobsCount");
    expect(detailPage).toContain("on_hold");
  });

  it("page header has no sticky class", () => {
    // Scope: header and KPI strip sections only (before the scope bar)
    const headerSection = detailPage.slice(
      detailPage.indexOf("PAGE HEADER"),
      detailPage.indexOf("SCOPE BAR"),
    );
    expect(headerSection).not.toMatch(/\bsticky\b/);
  });
});
