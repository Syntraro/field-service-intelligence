/**
 * Financial Dashboard layout — 2026-05-06 restructure pins.
 *
 * Source-level guards over the approved layout:
 *   • Top row: Today's Schedule + Operational Alerts (unchanged).
 *   • Second row: 3 equal cards (Pipeline | Collections | Scheduled Revenue).
 *   • Third row: Needs Attention full-width.
 *   • Operational Alerts mount + props NOT modified.
 *   • Capacity indicators in Today's Schedule header.
 *   • No more Revenue Center / Top Outstanding / Top Customers cards.
 *   • Needs Attention does not include "completed jobs not invoiced"
 *     (Ready to Invoice stays exclusive to Operational Alerts).
 *   • Scheduled Revenue excludes jobs without reliable value
 *     (storage helper enforces COALESCE > 0).
 *   • New aggregates extend the existing /api/dashboard/financial payload
 *     (no new HTTP endpoint).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const DASHBOARD_PATH = join(ROOT, "client/src/pages/FinancialDashboard.tsx");
const STORAGE_PATH = join(ROOT, "server/storage/dashboard.ts");

const dashSrc = readFileSync(DASHBOARD_PATH, "utf-8");
const storeSrc = readFileSync(STORAGE_PATH, "utf-8");

// ── Layout: 3 cards in second row + full-width Needs Attention ──

describe("FinancialDashboard layout — registry-driven widget grid (2026-05-07 RALPH)", () => {
  it("mounts every dashboard widget through the framework's renderer map", () => {
    // The hardcoded 3-column / 1-column grid containers were replaced
    // with the canonical `<DashboardWidgetGrid>` driven by the
    // shared registry. Each widget renders inside the renderers map
    // keyed by its registry widgetKey, so the JSX-level pins now
    // anchor on the renderer-map keys rather than the row geometry.
    expect(dashSrc).toMatch(/<DashboardWidgetGrid\b/);
    expect(dashSrc).toMatch(/widgets=\{layout\.visibleWidgets\}/);
    // Every registered widget must appear in the renderers map by its
    // canonical key so the grid can render it.
    expect(dashSrc).toMatch(/todays_schedule:\s*\(/);
    expect(dashSrc).toMatch(/operational_alerts:\s*\(/);
    expect(dashSrc).toMatch(/pipeline_snapshot:\s*\(/);
    expect(dashSrc).toMatch(/collections_overview:\s*\(/);
    expect(dashSrc).toMatch(/scheduled_revenue:\s*\(/);
    // 2026-05-07: needs_attention renderer entry is intentionally GONE.
    // The card's only row ("Invoices not sent") was absorbed into
    // Operational Alerts. Inverse pin — no orphan renderer remains.
    expect(dashSrc).not.toMatch(/needs_attention:\s*\(/);
  });

  it("page no longer carries the prior hardcoded `md:grid-cols-3` / `xl:grid-cols-[…]` row containers", () => {
    // The pre-RALPH layout used three discrete grid wrappers with
    // hardcoded responsive templates. After the refactor the page
    // delegates layout to the registry-derived sizePresets — those
    // hardcoded JSX wrappers must be gone.
    expect(dashSrc).not.toMatch(/grid grid-cols-1 md:grid-cols-3 gap-3 mb-3/);
    expect(dashSrc).not.toMatch(
      /grid grid-cols-1 xl:grid-cols-\[minmax\(0,1fr\)_auto\] gap-3 mb-3/,
    );
    // The bare `grid grid-cols-1 gap-3` row that wrapped Needs
    // Attention is also gone — the framework grid replaces it.
    expect(dashSrc).not.toMatch(/grid grid-cols-1 gap-3"\s*>\s*\n\s*<NeedsAttentionCard/);
  });

  it("mounts the canonical customize affordance + drawer", () => {
    expect(dashSrc).toMatch(/data-testid="dashboard-customize-button"/);
    expect(dashSrc).toMatch(/<DashboardCustomizeDrawer\b[\s\S]+?dashboardKey="financial"/);
  });
});

// ── Removed cards stay removed ──

describe("FinancialDashboard — retired card definitions/mounts removed", () => {
  it("Revenue Center component is fully removed", () => {
    expect(dashSrc).not.toMatch(/RevenueCenterFinancialCard/);
    expect(dashSrc).not.toMatch(/<RevenueCenterFinancialCard\b/);
    expect(dashSrc).not.toMatch(/data-testid="revenue-center-financial"/);
  });

  it("Top Outstanding Invoices standalone card is fully removed", () => {
    expect(dashSrc).not.toMatch(/TopOutstandingInvoicesCard/);
    expect(dashSrc).not.toMatch(/data-testid="link-view-all-invoices"/);
  });

  it("Top Customers Owing standalone card is fully removed", () => {
    expect(dashSrc).not.toMatch(/TopCustomersOwingCard/);
    expect(dashSrc).not.toMatch(/data-testid="link-view-all-customers-owing"/);
  });
});

// ── Today's Schedule header capacity indicators ──

describe("Today's Schedule — compact capacity indicators in header", () => {
  it("renders the indicator container with the canonical testid", () => {
    expect(dashSrc).toMatch(/data-testid="todays-schedule-capacity-indicators"/);
    expect(dashSrc).toMatch(/data-testid="capacity-indicator-booked"/);
    expect(dashSrc).toMatch(/data-testid="capacity-indicator-unscheduled"/);
  });

  it("computes bookedPercent from real capacity data (no faked values)", () => {
    // The percent comes from a useMemo over `techs[].scheduleBlocks`.
    expect(dashSrc).toMatch(/const bookedPercent = useMemo/);
    expect(dashSrc).toMatch(/b\.kind === "booked"/);
    expect(dashSrc).toMatch(/b\.durationMinutes/);
  });

  it("threads unscheduledJobsCount as a prop (not re-fetched in the card)", () => {
    expect(dashSrc).toMatch(/unscheduledJobsCount={unscheduledJobsCount}/);
    expect(dashSrc).toMatch(/unscheduledJobsCount: number/);
  });

  it("does NOT render an Overbooked indicator (no reliable backend data yet)", () => {
    // Per spec: "Only show 'Z Overbooked' if backed by reliable backend data.
    // Do not add overbooked from guesses." Until /api/dashboard/capacity
    // surfaces per-tech workday minutes, the indicator must be absent.
    expect(dashSrc).not.toMatch(/data-testid="capacity-indicator-overbooked"/);
    expect(dashSrc).not.toMatch(/Overbooked/);
  });
});

// ── Operational Alerts (2026-05-07: now also carries Invoices Not Sent) ──

describe("Operational Alerts — extended with invoices_not_sent row", () => {
  it("OperationalAlertsCard mount preserves the four legacy props", () => {
    expect(dashSrc).toMatch(/<OperationalAlertsCard\b/);
    expect(dashSrc).toMatch(/requiresAttentionCount={requiresAttentionCount}/);
    expect(dashSrc).toMatch(/pastDueCount={pastDueCount}/);
    expect(dashSrc).toMatch(/unscheduledCount={unscheduledJobsCount}/);
    expect(dashSrc).toMatch(/readyToInvoiceCount={readyToInvoiceCount}/);
    expect(dashSrc).toMatch(/onOpenActionModal={openActionModal}/);
  });

  it("OperationalAlertsCard now threads invoicesNotSentCount + the 5-row order", () => {
    // 2026-05-07: the Needs Attention card was retired and its single
    // "Invoices not sent" row absorbed into Operational Alerts. The
    // count comes from the same financial-summary field the retired
    // card consumed — no new query, no new endpoint.
    expect(dashSrc).toMatch(
      /invoicesNotSentCount=\{data\?\.needsAttention\.invoicesNotSentCount\s*\?\?\s*0\}/,
    );
    // Canonical row ordering puts invoices_not_sent at the bottom
    // (lower operational urgency than scheduling/dispatch issues).
    expect(dashSrc).toMatch(
      /order=\{\["requires_attention", "past_due", "unscheduled", "ready_to_invoice", "invoices_not_sent"\]\}/,
    );
  });
});

// ── Today's Schedule body unchanged ──

describe("Today's Schedule body — unchanged regions", () => {
  it("still mounts the open-only toggle and scope filter (multi-tech path)", () => {
    expect(dashSrc).toMatch(/data-testid="schedule-open-only-toggle"/);
    expect(dashSrc).toMatch(/data-testid="schedule-scope-filter"/);
  });

  it("still uses the canonical /api/dashboard/capacity endpoint", () => {
    expect(dashSrc).toMatch(/queryKey: \["\/api\/dashboard\/capacity"\]/);
  });
});

// ── Pipeline Snapshot — renders, no fake values ──

// ── Collections — simplified 2-column summary strip ──

describe("Collections — summary strip is 2 columns (Outstanding + Overdue)", () => {
  it("renders Outstanding and Overdue cells", () => {
    expect(dashSrc).toMatch(/data-testid="collections-summary-outstanding"/);
    expect(dashSrc).toMatch(/data-testid="collections-summary-overdue"/);
  });

  it("does NOT render the Open invoices count cell", () => {
    // The third "Open invoices" metric was removed. The cell, its testid,
    // and the underlying `outstandingCount` derivation must all be gone
    // from this card so the dashboard can't quietly reintroduce it.
    expect(dashSrc).not.toMatch(/data-testid="collections-summary-open"/);
    // The card's local `outstandingCount` derivation was removed; the
    // schema field on `FinancialSummary` survives (other surfaces may
    // still consume it), but the card body must not reference it.
    const cardBlock = dashSrc.match(/function CollectionsOverviewCard\([\s\S]+?^}/m);
    expect(cardBlock).toBeTruthy();
    expect(cardBlock![0]).not.toMatch(/outstandingCount/);
    // No "Open" / "Open invoices" label inside the card body either.
    expect(cardBlock![0]).not.toMatch(/>\s*Open\s*</);
    expect(cardBlock![0]).not.toMatch(/>\s*Open invoices\s*</);
  });

  it("uses a 2-column grid for the summary strip", () => {
    expect(dashSrc).toMatch(
      /className="grid grid-cols-2 gap-2 px-3 py-2 border-b border-\[#e2e8f0\]"\s*\n\s*data-testid="collections-summary-strip"/,
    );
    // Defensive: the prior 3-column class string must not survive on the
    // collections strip wrapper.
    expect(dashSrc).not.toMatch(
      /grid grid-cols-3 gap-2 px-3 py-2 border-b border-\[#e2e8f0\]"\s*\n\s*data-testid="collections-summary-strip"/,
    );
  });
});

// ── Collections — strict overdue semantics ──

describe("Collections — Overdue invoices section is strictly overdue-only", () => {
  it("filters topOutstandingInvoices to daysLate > 0 before rendering", () => {
    // The "Overdue invoices" list must NEVER contain current / not-yet-due
    // invoices. The filter sits at the data-derivation site so the empty
    // state is the intended fallback — no backfill from the broader
    // outstanding list.
    expect(dashSrc).toMatch(
      /const overdueInvoices = \(data\?\.topOutstandingInvoices \?\? \[\]\)\s*[\s\S]*?\.filter\(\(inv\) => \(inv\.daysLate \?\? 0\) > 0\)\s*[\s\S]*?\.slice\(0, 3\)/,
    );
  });

  it("renders the strict empty-state copy when no rows pass the filter", () => {
    // The user-facing empty state must read "No overdue invoices." —
    // never "No outstanding invoices." (which would imply zero
    // outstanding total) or "None." (which is too generic).
    expect(dashSrc).toMatch(/EmptyState message="No overdue invoices\."/);
    // Negative pin: must not silently fall back to a generic message
    // inside the same `collections-invoices-list` block.
    const block = dashSrc.match(/data-testid="collections-invoices-list"[\s\S]+?<\/div>\s*\)?\}/m);
    expect(block).toBeTruthy();
    expect(block![0]).not.toMatch(/No outstanding invoices\./);
  });

  it("section heading remains 'Overdue invoices' (not 'Top overdue')", () => {
    // Header copy was clarified in the prior pass; this test pins it so
    // a future refactor can't quietly revert.
    expect(dashSrc).toMatch(/>\s*Overdue invoices\s*</);
    expect(dashSrc).not.toMatch(/>\s*Top overdue\s*</);
  });

  it("keeps Top customers source untouched (all open balances, overdue or not)", () => {
    // The Top customers row source is `data.topCustomerBalances` and must
    // NOT be filtered down to past-due-only — customers with current open
    // balances should still appear here.
    expect(dashSrc).toMatch(/const customerBalances = \(data\?\.topCustomerBalances \?\? \[\]\)\.slice\(0, 3\)/);
  });
});

describe("Pipeline Snapshot — actionable sales queue (2026-05-06 RALPH)", () => {
  it("mounts the four actionable Pipeline rows", () => {
    expect(dashSrc).toMatch(/data-testid="pipeline-snapshot"/);
    // Row testids — each row drives a DashboardActionMode.
    expect(dashSrc).toMatch(/testId=\{`pipeline-row-\$\{r\.key\}`\}/);
    expect(dashSrc).toMatch(/key:\s*"leads-followup"/);
    expect(dashSrc).toMatch(/key:\s*"quotes-not-sent"/);
    expect(dashSrc).toMatch(/key:\s*"quotes-awaiting-response"/);
    expect(dashSrc).toMatch(/key:\s*"stale-opportunities"/);
  });

  it("retired the legacy 4-column KPI grid + stale-leads bottom row", () => {
    expect(dashSrc).not.toMatch(/data-testid="pipeline-kpi-grid"/);
    expect(dashSrc).not.toMatch(/data-testid="pipeline-stale-leads"/);
    expect(dashSrc).not.toMatch(/testId="pipeline-leads"/);
    expect(dashSrc).not.toMatch(/testId="pipeline-quotes-sent"/);
    expect(dashSrc).not.toMatch(/testId="pipeline-conversion"/);
    // The legacy "Conversion" / "Follow-up Due" labels and the
    // PipelineKpiCell helper are gone.
    expect(dashSrc).not.toMatch(/function PipelineKpiCell\(/);
    expect(dashSrc).not.toMatch(/conversionRateMonth == null \?/);
  });

  it("renders the empty-state copy when no rows are actionable", () => {
    expect(dashSrc).toMatch(/No pipeline actions need attention\./);
    expect(dashSrc).toMatch(/data-testid="pipeline-empty"/);
  });
});

// ── Scheduled Revenue — excludes jobs without reliable value ──

describe("Scheduled Revenue — excludes jobs without reliable value", () => {
  it("renders today / 7d / 30d rows + upcoming list", () => {
    expect(dashSrc).toMatch(/data-testid="scheduled-revenue"/);
    expect(dashSrc).toMatch(/data-testid="scheduled-upcoming-list"/);
    // Per-row testids are passed via the `testId` prop on <ScheduledRevRow>.
    expect(dashSrc).toMatch(/testId="scheduled-today"/);
    expect(dashSrc).toMatch(/testId="scheduled-7d"/);
    expect(dashSrc).toMatch(/testId="scheduled-30d"/);
  });

  it("renders the \"Based on scheduled jobs\" helper text", () => {
    expect(dashSrc).toMatch(/Based on scheduled jobs/);
  });

  it("storage helper EXCLUDES jobs whose resolved value is null/zero", () => {
    // Per spec the SQL must filter `COALESCE(invoice.total, qualified-quote.total) > 0`.
    expect(storeSrc).toMatch(/getScheduledRevenue/);
    expect(storeSrc).toMatch(/q\.status IN \('approved', 'converted', 'sent'\)/);
    expect(storeSrc).toMatch(/COALESCE\([\s\S]+?CAST\(inv\.total AS numeric\)[\s\S]+?\) > 0/);
  });
});

// ── Needs Attention card — RETIRED (2026-05-07) ──

describe("Needs Attention card — removed; row absorbed into Operational Alerts", () => {
  it("the inline NeedsAttentionCard component is gone from the page source", () => {
    // The standalone card was a placeholder that duplicated the
    // operational-alert concept. Its single row ("Invoices not sent")
    // moved to the bottom of OperationalAlertsCard. Removing the
    // component declaration prevents accidental re-mount.
    expect(dashSrc).not.toMatch(/function NeedsAttentionCard\(/);
    expect(dashSrc).not.toMatch(/interface NeedsAttentionCardProps\b/);
    expect(dashSrc).not.toMatch(/<NeedsAttentionCard\b/);
  });

  it("the renderer map no longer carries the needs_attention key", () => {
    expect(dashSrc).not.toMatch(/needs_attention:\s*\(/);
  });

  it("the financial query gate now lists operational_alerts (so its new row's data still loads)", () => {
    // The Invoices-not-sent count comes from the financial summary;
    // when only Operational Alerts is visible, the financial query
    // must still fire so that row populates. Strip comments from the
    // matched block so explanatory prose doesn't false-trigger the
    // negative pin.
    const queryGateBlock = dashSrc.match(
      /FINANCIAL_QUERY_WIDGETS:[\s\S]+?\];/,
    );
    expect(queryGateBlock).toBeTruthy();
    const codeOnly = queryGateBlock![0]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).toMatch(/"operational_alerts"/);
    expect(codeOnly).not.toMatch(/"needs_attention"/);
  });

  it("the Invoices Not Sent dispatch still routes through OperationalAlertsCard's onOpenActionModal", () => {
    // The mode itself is unchanged. After consolidation the literal
    // `openActionModal("invoices_not_sent")` call on the page is gone
    // (it lived inside the now-deleted NeedsAttentionCard mount). The
    // dispatch path now goes:
    //   page.openActionModal → <OperationalAlertsCard onOpenActionModal=>
    //   row.mode === "invoices_not_sent"
    expect(dashSrc).toMatch(
      /<OperationalAlertsCard\b[\s\S]+?onOpenActionModal=\{openActionModal\}/,
    );
    // No router redirect fallback — the prior `?filter=draft` URL
    // path was retired in 2026-05-06 and must not return.
    expect(dashSrc).not.toMatch(/setLocation\("\/invoices\?filter=draft"\)/);
  });

  it("the financial summary endpoint + storage helper are unchanged", () => {
    // Hard pin: removing the card MUST NOT remove the underlying SQL
    // helper or the API field — Operational Alerts now consumes the
    // same `data.needsAttention.invoicesNotSentCount` shape.
    expect(storeSrc).toMatch(/async function getNeedsAttention/);
    expect(storeSrc).toMatch(/needsAttention:\s*\{/);
    expect(dashSrc).toMatch(
      /data\?\.needsAttention\.invoicesNotSentCount/,
    );
  });
});

// ── Backend: extension over a single canonical payload ──

describe("Backend — /api/dashboard/financial extended with new aggregates", () => {
  it("FinancialSummary interface declares pipelineSnapshot, scheduledRevenue, needsAttention", () => {
    expect(storeSrc).toMatch(/pipelineSnapshot:\s*\{/);
    expect(storeSrc).toMatch(/scheduledRevenue:\s*\{/);
    expect(storeSrc).toMatch(/needsAttention:\s*\{/);
  });

  it("getFinancialSummary calls all three new helpers in parallel", () => {
    expect(storeSrc).toMatch(/getPipelineSnapshot\(companyId/);
    expect(storeSrc).toMatch(/getScheduledRevenue\(companyId/);
    expect(storeSrc).toMatch(/getNeedsAttention\(companyId/);
    // Must be inside the existing Promise.all destructure.
    expect(storeSrc).toMatch(/pipelineSnapshotData[\s\S]+?scheduledRevenueData[\s\S]+?needsAttentionData/);
  });

  it("no NEW HTTP route was added — extends the existing /api/dashboard/financial only", () => {
    const routesSrc = readFileSync(
      join(ROOT, "server/routes/dashboard.ts"),
      "utf-8",
    );
    // Whitelist the four pre-existing routes; reject anything new.
    const routes = routesSrc.match(/router\.(get|post)\("[^"]+"/g) ?? [];
    const expected = new Set([
      `router.get("/financial"`,
      `router.get("/workflow"`,
      `router.get("/capacity"`,
      `router.get("/needs-attention"`,
      `router.get("/pm-due-instances"`,
      `router.get("/today-summary"`,
    ]);
    for (const r of routes) {
      expect(expected, `unexpected new route: ${r}`).toContain(r);
    }
  });

  it("getNeedsAttention storage helper does NOT count completed-jobs-not-invoiced", () => {
    // The SQL CTE must reference invoices/quotes/leads, NEVER `jobs.status='completed'`.
    expect(storeSrc).toMatch(/async function getNeedsAttention/);
    const naFn = storeSrc.match(/async function getNeedsAttention[\s\S]+?^\}/m);
    expect(naFn).toBeTruthy();
    expect(naFn![0]).not.toMatch(/jobs[\s\S]+?status\s*=\s*'completed'/);
    expect(naFn![0]).not.toMatch(/FROM jobs/);
  });
});
