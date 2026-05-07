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

describe("FinancialDashboard layout — second row is 3 equal cards", () => {
  it("mounts <PipelineSnapshotCard>, <CollectionsOverviewCard>, <ScheduledRevenueCard> in a 3-column grid", () => {
    expect(dashSrc).toMatch(/<PipelineSnapshotCard\b/);
    expect(dashSrc).toMatch(/<CollectionsOverviewCard\b/);
    expect(dashSrc).toMatch(/<ScheduledRevenueCard\b/);
    // The grid container that wraps all three.
    expect(dashSrc).toMatch(/grid grid-cols-1 md:grid-cols-3 gap-3 mb-3/);
  });

  it("mounts <NeedsAttentionCard> as a full-width row below the 3-card grid", () => {
    expect(dashSrc).toMatch(/<NeedsAttentionCard\b/);
    // Single-column grid wrapping the full-width Needs Attention row.
    expect(dashSrc).toMatch(/grid grid-cols-1 gap-3"\s*>\s*\n\s*<NeedsAttentionCard/);
  });

  it("does NOT make Collections Overview full-width", () => {
    // The Collections card sits inside the 3-column grid, not the 1-column
    // wrapper that holds Needs Attention. Defensive pin: it must not be
    // wrapped in `grid grid-cols-1 gap-3` directly above its mount.
    expect(dashSrc).not.toMatch(/grid grid-cols-1 gap-3"\s*>\s*\n\s*<CollectionsOverviewCard/);
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

// ── Operational Alerts unchanged ──

describe("Operational Alerts — unchanged contract", () => {
  it("OperationalAlertsCard mount preserves its prop set", () => {
    expect(dashSrc).toMatch(/<OperationalAlertsCard\b/);
    expect(dashSrc).toMatch(/requiresAttentionCount={requiresAttentionCount}/);
    expect(dashSrc).toMatch(/pastDueCount={pastDueCount}/);
    expect(dashSrc).toMatch(/unscheduledCount={unscheduledJobsCount}/);
    expect(dashSrc).toMatch(/readyToInvoiceCount={readyToInvoiceCount}/);
    expect(dashSrc).toMatch(/onOpenActionModal={openActionModal}/);
    expect(dashSrc).toMatch(/order=\{\["requires_attention", "past_due", "unscheduled", "ready_to_invoice"\]\}/);
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

// ── Needs Attention — narrowed to billing/admin (2026-05-06 RALPH) ──

describe("Needs Attention — narrowed to actionable billing/admin only", () => {
  it("renders ONLY the invoices-not-sent bucket", () => {
    expect(dashSrc).toMatch(/data-testid="needs-attention"/);
    // Per-item keys feed the rendered testid via `needs-attention-${it.key}`.
    expect(dashSrc).toMatch(/key:\s*"invoices-not-sent"/);
    // Negative pins for the dropped buckets — these MUST NOT come back.
    expect(dashSrc).not.toMatch(/key:\s*"quotes-stale"/);
    expect(dashSrc).not.toMatch(/key:\s*"leads-stale"/);
    expect(dashSrc).not.toMatch(/key:\s*"payments-pending"/);
    // Must NOT introduce a "ready to invoice" / "completed jobs not invoiced" key here.
    expect(dashSrc).not.toMatch(/key:\s*"ready-to-invoice"/);
    expect(dashSrc).not.toMatch(/key:\s*"completed-not-invoiced"/);
  });

  it("Ready to Invoice remains exclusive to Operational Alerts", () => {
    // The OperationalAlertsCard is the ONLY consumer of readyToInvoiceCount.
    const matches = dashSrc.match(/readyToInvoiceCount/g) ?? [];
    // Expected refs: declaration + OperationalAlertsCard prop. NOT in NeedsAttentionCard.
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // Cross-check: NeedsAttentionCard's items array doesn't reference it.
    const naBlock = dashSrc.match(/function NeedsAttentionCard\([\s\S]+?^}/m);
    expect(naBlock).toBeTruthy();
    expect(naBlock![0]).not.toMatch(/readyToInvoice/i);
    expect(naBlock![0]).not.toMatch(/completedNotInvoiced/i);
  });

  it("does NOT mount a stale-quotes / stale-leads / payments view handler on the card", () => {
    // The dropped rows had dedicated `onViewStaleQuotes` / `onViewStaleLeads`
    // / `onViewPaymentsPending` props — those props must not reappear.
    expect(dashSrc).not.toMatch(/onViewStaleQuotes/);
    expect(dashSrc).not.toMatch(/onViewStaleLeads/);
    expect(dashSrc).not.toMatch(/onViewPaymentsPending/);
    // The card mount supplies only the invoices-not-sent handler.
    expect(dashSrc).toMatch(/<NeedsAttentionCard\b[\s\S]+?onViewInvoicesNotSent=\{[^}]+\}\s*\/>/);
  });

  it("renders the empty state when there are no actionable billing/admin items", () => {
    // The new copy is a hard pin — the empty state is what the user sees
    // when their billing inbox is clear.
    expect(dashSrc).toMatch(/No billing\/admin items need attention\./);
    expect(dashSrc).toMatch(/data-testid="needs-attention-empty"/);
  });

  it("Invoices not sent View opens the shared DashboardActionModal", () => {
    // The handler must route through the page-level openActionModal —
    // NOT a router redirect to /invoices?filter=draft (the prior behavior).
    expect(dashSrc).toMatch(
      /onViewInvoicesNotSent=\{\(\)\s*=>\s*openActionModal\("invoices_not_sent"\)\}/,
    );
    expect(dashSrc).not.toMatch(/setLocation\("\/invoices\?filter=draft"\)/);
  });

  it("typography uses readable tokens (no text-[10px] / text-[11px] in NeedsAttentionCard)", () => {
    const naBlock = dashSrc.match(/function NeedsAttentionCard\([\s\S]+?^}/m);
    expect(naBlock).toBeTruthy();
    // Per the brief: avoid the sub-12px arbitrary sizes — use `text-xs`
    // and `text-sm` so the card matches Operational Alerts /
    // Collections readability.
    expect(naBlock![0]).not.toMatch(/text-\[10px\]/);
    expect(naBlock![0]).not.toMatch(/text-\[11px\]/);
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
