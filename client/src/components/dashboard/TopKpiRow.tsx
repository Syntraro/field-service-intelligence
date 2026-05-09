/**
 * TopKpiRow — 4-tile KPI strip at the top of the Business Dashboard.
 *
 * 2026-04-25 Phase 2 polish: tile chrome aligned with the Financial
 * dashboard's KpiTile (iconBg color block, label above value, large
 * value, optional sub line, warn variant). Every tile renders from data
 * ALREADY fetched by the dashboard's existing queries — no new endpoints.
 *
 * 2026-05-09 canonicalization: local KpiTile removed. Tiles now render
 * through the canonical <KpiTile> primitive in ./KpiTile.tsx. Arbitrary
 * hex (#111827, #e2e8f0, #76B054) replaced with semantic tokens.
 *
 * Tiles:
 *   1. Revenue this month   ← /api/dashboard/financial → revenue.month
 *   2. Outstanding A/R      ← /api/dashboard/financial → ar.outstandingTotal
 *   3. Overdue invoices     ← /api/dashboard/financial → ar.pastDueCount + total
 *   4. Operational alerts   ← /api/dashboard/workflow  → jobs.{onHold, overdue, unscheduled, requiresInvoicing}
 *
 * "Ready to Invoice" is intentionally NOT a top-row KPI — it remains a
 * row inside the right-column Revenue Center card and a row inside the
 * Operational Alerts drilldown.
 */

import { CheckCircle2, DollarSign, Receipt, TrendingUp } from "lucide-react";
import type { DashboardActionMode } from "@/components/DashboardActionModal";
import { KpiTile } from "@/components/dashboard/KpiTile";

// ============================================================================
// Currency formatting — module-local; matches existing dashboard cards.
// ============================================================================

function formatCurrencyCompact(amount: number): string {
  if (!Number.isFinite(amount)) return "$0";
  if (Math.abs(amount) >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(amount) >= 10_000) {
    return `$${Math.round(amount / 1000)}k`;
  }
  if (Math.abs(amount) >= 1_000) {
    return `$${(amount / 1000).toFixed(1)}k`;
  }
  return `$${Math.round(amount).toLocaleString()}`;
}

// ============================================================================
// Top row
// ============================================================================

export interface TopKpiRowProps {
  /** /api/dashboard/financial — when undefined the tiles render skeletons. */
  revenueThisMonth?: number;
  outstandingAr?: number;
  outstandingArCount?: number;
  overdueInvoiceTotal?: number;
  overdueInvoiceCount?: number;
  /** 2026-04-25 IA correction: 4th tile flipped from "Operational alerts"
   *  (which moved to a right-rail card with rows) to "Jobs Ready to
   *  Invoice" — a glanceable KPI that links into the canonical
   *  ready-to-invoice action modal. Operational Alerts and Ready to
   *  Invoice serve different purposes: KPI = at-a-glance count;
   *  Alerts card row = actionable triage entry. */
  jobsReadyToInvoiceCount: number;
  isLoading?: boolean;
  /** Opens DashboardActionModal — same handler the right-column rows use. */
  onOpenActionModal: (mode: DashboardActionMode) => void;
}

export function TopKpiRow({
  revenueThisMonth,
  outstandingAr,
  outstandingArCount,
  overdueInvoiceTotal,
  overdueInvoiceCount,
  jobsReadyToInvoiceCount,
  isLoading,
  onOpenActionModal,
}: TopKpiRowProps) {
  const overdueWarn = (overdueInvoiceCount ?? 0) > 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiTile
        label="Revenue this month"
        value={formatCurrencyCompact(revenueThisMonth ?? 0)}
        icon={TrendingUp}
        iconColor="text-emerald-600"
        iconBg="bg-emerald-100 dark:bg-emerald-950/30"
        loading={isLoading}
        href="/financials"
        testId="kpi-revenue-month"
      />
      <KpiTile
        label="Outstanding A/R"
        value={formatCurrencyCompact(outstandingAr ?? 0)}
        sub={
          outstandingArCount && outstandingArCount > 0
            ? `${outstandingArCount} open invoice${outstandingArCount === 1 ? "" : "s"}`
            : undefined
        }
        icon={DollarSign}
        iconColor="text-amber-600"
        iconBg="bg-amber-100 dark:bg-amber-950/30"
        loading={isLoading}
        href="/financials"
        testId="kpi-outstanding-ar"
      />
      <KpiTile
        label="Overdue invoices"
        value={
          overdueInvoiceCount !== undefined && overdueInvoiceCount > 0
            ? `${overdueInvoiceCount}`
            : formatCurrencyCompact(overdueInvoiceTotal ?? 0)
        }
        sub={
          overdueInvoiceCount && overdueInvoiceCount > 0
            ? formatCurrencyCompact(overdueInvoiceTotal ?? 0)
            : undefined
        }
        icon={Receipt}
        iconColor="text-red-600"
        iconBg="bg-red-100 dark:bg-red-950/30"
        tone={overdueWarn ? "danger" : "default"}
        loading={isLoading}
        href="/invoices?filter=overdue"
        testId="kpi-overdue-invoices"
      />
      <KpiTile
        label="Jobs ready to invoice"
        value={String(jobsReadyToInvoiceCount)}
        sub={jobsReadyToInvoiceCount === 0 ? "Nothing waiting" : undefined}
        icon={CheckCircle2}
        iconColor="text-violet-600"
        iconBg="bg-violet-100 dark:bg-violet-950/30"
        loading={isLoading}
        onClick={() => onOpenActionModal("ready_to_invoice")}
        testId="kpi-jobs-ready-to-invoice"
      />
    </div>
  );
}
