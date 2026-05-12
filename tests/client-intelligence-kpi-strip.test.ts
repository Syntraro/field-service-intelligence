/**
 * client-intelligence-kpi-strip.test.ts
 *
 * Static-analysis assertions for the Client Detail page layout:
 * - Action buttons live in the header (right side)
 * - Standalone KPI strip is removed from between scope/tabs
 * - 4-metric compact KPI summary lives inside the Overview tab content
 * - No sticky classes on the client header / scope / tabs / overview KPI path
 * - Intelligence endpoint is not fetched twice (single queryKey)
 *
 * Overview analytics layout assertions (2026-05-12 simplification pass):
 * - Payment Behavior card removed
 * - Revenue Categories card removed
 * - At A Glance strip removed
 * - Financial Performance uses comparison table (one metric-label column + period columns)
 * - Top Items Sold card added (invoice line items, max 5)
 * - Insights card retained
 * - Compact KPI summary retained at top
 *
 * Tab restructure assertions (2026-05-12):
 * - Pricing tab removed from COMPANY_TABS + LOCATION_TABS
 * - WorkspaceTab type no longer includes "pricing"
 * - Historical Pricing renders inside Overview via HistoricalPricingSection
 * - Recent Activity card removed from ClientDetailPage
 * - locationId prop passed to ClientOverviewTab from both scopes
 */

import * as fs from "fs";
import * as path from "path";

// ── Helpers ──────────────────────────────────────────────────────────────────

function read(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, "..", rel), "utf-8");
}

// ── Files under test ─────────────────────────────────────────────────────────

const detailPage = read("client/src/pages/ClientDetailPage.tsx");
const overviewTab = read("client/src/pages/ClientOverviewTab.tsx");

// ── ClientDetailPage — header + layout ───────────────────────────────────────

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

  it("old mini-KPI pill block is removed", () => {
    expect(detailPage).not.toContain("flex-1 flex justify-start items-center pl-12");
  });

  it("onHoldJobsCount is computed from companyJobs", () => {
    expect(detailPage).toContain("onHoldJobsCount");
    expect(detailPage).toContain("on_hold");
  });

  it("page header has no sticky class", () => {
    const headerSection = detailPage.slice(
      detailPage.indexOf("PAGE HEADER"),
      detailPage.indexOf("SCOPE BAR"),
    );
    expect(headerSection).not.toMatch(/\bsticky\b/);
  });
});

describe("ClientDetailPage — standalone KPI strip removed", () => {
  it("does NOT import ClientKpiStrip", () => {
    expect(detailPage).not.toContain("ClientKpiStrip");
  });

  it("does NOT render a standalone KPI strip between scope bar and tabs", () => {
    expect(detailPage).not.toContain("KPI STRIP");
    expect(detailPage).not.toContain("<ClientKpiStrip");
  });

  it("passes activeJobsCount and onHoldJobsCount to ClientOverviewTab", () => {
    expect(detailPage).toContain("activeJobsCount={activeJobsCount}");
    expect(detailPage).toContain("onHoldJobsCount={onHoldJobsCount}");
  });
});

// ── ClientOverviewTab — compact KPI summary ───────────────────────────────────

describe("ClientOverviewTab — compact KPI summary", () => {
  it("renders CompactKpiSummary component", () => {
    expect(overviewTab).toContain("CompactKpiSummary");
  });

  it("has data-testid on the KPI summary container", () => {
    expect(overviewTab).toContain('data-testid="overview-kpi-summary"');
  });

  it("includes Lifetime Revenue label", () => {
    expect(overviewTab).toContain("Lifetime Revenue");
  });

  it("includes Outstanding Balance label", () => {
    expect(overviewTab).toContain("Outstanding Balance");
  });

  it("includes Avg Days To Pay label", () => {
    expect(overviewTab).toContain("Avg Days To Pay");
  });

  it("includes Active Jobs label", () => {
    expect(overviewTab).toContain("Active Jobs");
  });

  it("accepts activeJobsCount and onHoldJobsCount props", () => {
    expect(overviewTab).toContain("activeJobsCount");
    expect(overviewTab).toContain("onHoldJobsCount");
  });

  it("uses 4-column desktop grid for KPI summary", () => {
    expect(overviewTab).toContain("lg:grid-cols-4");
  });

  it("has no sticky class anywhere in the overview tab", () => {
    expect(overviewTab).not.toMatch(/\bsticky\b/);
  });

  it("does NOT duplicate the intelligence query key", () => {
    const matches = [...overviewTab.matchAll(/queryKey.*intelligence/g)];
    expect(matches.length).toBe(1);
  });
});

// ── ClientOverviewTab — removed sections ─────────────────────────────────────

describe("ClientOverviewTab — removed cards", () => {
  it("Payment Behavior card is removed", () => {
    expect(overviewTab).not.toContain("Payment Behavior");
    expect(overviewTab).not.toContain("PaymentBehaviorCard");
  });

  it("Revenue Categories card is removed", () => {
    expect(overviewTab).not.toContain("Revenue Categories");
    expect(overviewTab).not.toContain("RevenueCategoriesCard");
  });

  it("At A Glance strip is removed", () => {
    expect(overviewTab).not.toContain("At A Glance");
    expect(overviewTab).not.toContain("AtAGlanceStrip");
    expect(overviewTab).not.toContain("Most Common Service");
    expect(overviewTab).not.toContain("Total Equipment");
    expect(overviewTab).not.toContain("Open Quotes Value");
    expect(overviewTab).not.toContain("Work Completion");
  });
});

// ── ClientOverviewTab — Financial Performance restructure ─────────────────────

describe("ClientOverviewTab — Financial Performance comparison table", () => {
  it("Financial Performance card is present", () => {
    expect(overviewTab).toContain("Financial Performance");
  });

  it("uses a single metric-label column structure (not two separate label blocks)", () => {
    // The comparison table has metric labels once on the left
    expect(overviewTab).toContain("Gross Revenue");
    expect(overviewTab).toContain("Net Revenue");
    expect(overviewTab).toContain("Invoice Count");
    expect(overviewTab).toContain("Avg Invoice Value");
    expect(overviewTab).toContain("Gross Margin %");
  });

  it("has Last 30 Days column header", () => {
    expect(overviewTab).toContain("Last 30 Days");
  });

  it("has Last 12 Months column header", () => {
    expect(overviewTab).toContain("Last 12 Months");
  });

  it("does not repeat 'Gross Revenue' in separate card-header blocks (no duplicate section headers)", () => {
    // In the old layout, "Gross Revenue" appeared in two separate column headers.
    // In the new layout it appears once as a row label.
    const count = (overviewTab.match(/"Gross Revenue"/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("revenue trend chart is still inside FinancialPerformanceCard", () => {
    expect(overviewTab).toContain("Revenue Trend");
  });
});

// ── ClientOverviewTab — Top Items Sold ───────────────────────────────────────

describe("ClientOverviewTab — Top Items Sold", () => {
  it("Top Items Sold card renders", () => {
    expect(overviewTab).toContain("Top Items Sold");
    expect(overviewTab).toContain("TopItemsSoldCard");
  });

  it("shows empty state message", () => {
    expect(overviewTab).toContain("No item history yet.");
  });

  it("displays Item / Service column", () => {
    expect(overviewTab).toContain("Item / Service");
  });

  it("displays Qty column", () => {
    expect(overviewTab).toContain("Qty");
  });

  it("displays Revenue column", () => {
    expect(overviewTab).toContain("Revenue");
  });

  it("uses topItemsSold from data (invoice line items, not service/product categories)", () => {
    expect(overviewTab).toContain("data.topItemsSold");
  });

  it("limits display to 5 rows (limit enforced in backend query)", () => {
    // The backend query has .limit(5); verify the frontend iterates topItemsSold (no client-side slice needed)
    expect(overviewTab).toContain("topItemsSold");
    // And does NOT use revenueByCategory
    expect(overviewTab).not.toContain("revenueByCategory");
  });

  it("does NOT use a donut/pie chart", () => {
    expect(overviewTab).not.toContain("PieChart");
    expect(overviewTab).not.toContain("<Pie");
  });
});

// ── ClientOverviewTab — Insights card retained ───────────────────────────────

describe("ClientOverviewTab — Insights card", () => {
  it("Insights card is present", () => {
    expect(overviewTab).toContain("Insights");
    expect(overviewTab).toContain("InsightsCard");
  });

  it("shows empty state when no insights", () => {
    expect(overviewTab).toContain("No insights at this time.");
  });

  it("includes deterministic insight checks", () => {
    expect(overviewTab).toContain("No Maintenance Plan");
    expect(overviewTab).toContain("Declining Revenue");
    expect(overviewTab).toContain("No Recent Service");
  });
});

// ── ClientDetailPage — Pricing tab removed ───────────────────────────────────

describe("ClientDetailPage — Pricing tab removed", () => {
  it("WorkspaceTab type does NOT include 'pricing'", () => {
    // The type union block should not contain "pricing" as a member
    const typeStart = detailPage.indexOf("type WorkspaceTab");
    const typeEnd = detailPage.indexOf(";", typeStart);
    const typeSlice = detailPage.slice(typeStart, typeEnd + 1);
    expect(typeSlice).not.toContain('"pricing"');
  });

  it("COMPANY_TABS does NOT include a pricing entry", () => {
    const startIdx = detailPage.indexOf("const COMPANY_TABS:");
    const endIdx = detailPage.indexOf("];", startIdx);
    expect(startIdx).toBeGreaterThan(-1);
    const slice = detailPage.slice(startIdx, endIdx);
    expect(slice).not.toMatch(/key:\s*"pricing"/);
  });

  it("LOCATION_TABS does NOT include a pricing entry", () => {
    const startIdx = detailPage.indexOf("const LOCATION_TABS:");
    const endIdx = detailPage.indexOf("];", startIdx);
    expect(startIdx).toBeGreaterThan(-1);
    const slice = detailPage.slice(startIdx, endIdx);
    expect(slice).not.toMatch(/key:\s*"pricing"/);
  });

  it("no workspaceTab === 'pricing' content branch exists", () => {
    expect(detailPage).not.toMatch(/workspaceTab\s*===\s*"pricing"/);
  });

  it("data-testid workspace-tab-pricing does NOT exist", () => {
    expect(detailPage).not.toContain('data-testid="workspace-tab-pricing"');
  });
});

// ── ClientDetailPage — Recent Activity removed ───────────────────────────────

describe("ClientDetailPage — Recent Activity removed", () => {
  it("client-recent-activity testid is gone", () => {
    expect(detailPage).not.toContain('data-testid="client-recent-activity"');
  });

  it("Recent Activity heading is removed", () => {
    expect(detailPage).not.toContain("Recent Activity");
  });
});

// ── ClientOverviewTab — Historical Pricing section ───────────────────────────

describe("ClientOverviewTab — Historical Pricing section", () => {
  it("HistoricalPricingSection component exists", () => {
    expect(overviewTab).toContain("HistoricalPricingSection");
  });

  it("Historical Pricing title is present", () => {
    expect(overviewTab).toContain("Historical Pricing");
  });

  it("subtitle text is present", () => {
    expect(overviewTab).toContain("Prices previously used for this client");
  });

  it("renders LocPricingTab when locationId is provided", () => {
    expect(overviewTab).toContain("LocPricingTab");
    expect(overviewTab).toContain("locationId");
  });

  it("shows scope prompt when locationId is null", () => {
    expect(overviewTab).toContain("data-testid=\"pricing-scope-prompt\"");
  });

  it("uses canonical CardShell styling", () => {
    expect(overviewTab).toContain("CardShell");
    expect(overviewTab).toContain("CardShellHeader");
    expect(overviewTab).toContain("CardShellBody");
  });

  it("locationId prop is accepted by ClientOverviewTab", () => {
    expect(overviewTab).toContain("locationId:");
  });
});

// ── ClientDetailPage — locationId passed to ClientOverviewTab ────────────────

describe("ClientDetailPage — locationId passed to ClientOverviewTab", () => {
  it("company scope passes locationId={null}", () => {
    expect(detailPage).toContain("locationId={null}");
  });

  it("location scope passes locationId={selectedLocationId}", () => {
    expect(detailPage).toContain("locationId={selectedLocationId}");
  });
});
