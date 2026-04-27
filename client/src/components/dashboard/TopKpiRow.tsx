/**
 * TopKpiRow — 4-tile KPI strip at the top of the Business Dashboard.
 *
 * 2026-04-25 Phase 2 polish: tile chrome aligned with the Financial
 * dashboard's KpiTile (iconBg color block, label above value, large
 * `text-2xl font-bold tabular-nums` value, optional sub line, warn
 * variant). Every tile renders from data ALREADY fetched by the
 * dashboard's existing queries — no new endpoints.
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

import { Link } from "wouter";
import { CheckCircle2, DollarSign, Receipt, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardActionMode } from "@/components/DashboardActionModal";

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
// Single tile — Financial dashboard chrome
// ============================================================================

interface KpiTileProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  warn?: boolean;
  isLoading?: boolean;
  onClick?: () => void;
  href?: string;
  testId?: string;
}

function KpiTile({
  label,
  value,
  sub,
  icon: Icon,
  iconColor,
  iconBg,
  warn,
  isLoading,
  onClick,
  href,
  testId,
}: KpiTileProps) {
  // 2026-04-25 polish pass — tighter vertical rhythm. Padding dropped
  // from `px-4 py-3` to `px-3.5 py-2.5` (~13% shorter) and label→value
  // gap from `mb-2` to `mb-1.5`. The value still uses `text-2xl
  // font-bold` so scanability is unchanged; the tile just reads
  // denser and aligns better with the header bands on the cards
  // below it.
  const inner = (
    <div
      className={`flex flex-col h-full px-3.5 py-2.5 ${
        warn
          ? "bg-red-50/60 dark:bg-red-950/15"
          : "bg-white dark:bg-gray-900"
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`p-1 rounded-md ${iconBg}`}>
          <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
        </div>
        <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide truncate">
          {label}
        </div>
      </div>
      {isLoading ? (
        <Skeleton className="h-7 w-24" />
      ) : (
        <>
          <div
            className={`text-2xl font-bold tabular-nums leading-none ${
              warn
                ? "text-red-600 dark:text-red-400"
                : "text-[#111827] dark:text-gray-100"
            }`}
          >
            {value}
          </div>
          {sub && (
            <div className="text-[11px] text-slate-500 mt-1 truncate">{sub}</div>
          )}
        </>
      )}
    </div>
  );

  const shellBase =
    "rounded-md overflow-hidden border border-[#e2e8f0] dark:border-gray-700";
  const shellInteractive =
    " hover:border-[#76B054] hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-[#76B054]/40";

  if (href) {
    return (
      <Link href={href}>
        <a
          className={`${shellBase}${shellInteractive} block`}
          style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
          data-testid={testId}
        >
          {inner}
        </a>
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${shellBase}${shellInteractive} text-left`}
        style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
        data-testid={testId}
      >
        {inner}
      </button>
    );
  }
  return (
    <div
      className={shellBase}
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
      data-testid={testId}
    >
      {inner}
    </div>
  );
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
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiTile
        label="Revenue this month"
        value={formatCurrencyCompact(revenueThisMonth ?? 0)}
        icon={TrendingUp}
        iconColor="text-emerald-600"
        iconBg="bg-emerald-100 dark:bg-emerald-950/30"
        isLoading={isLoading}
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
        isLoading={isLoading}
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
        warn={(overdueInvoiceCount ?? 0) > 0}
        isLoading={isLoading}
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
        isLoading={isLoading}
        onClick={() => onOpenActionModal("ready_to_invoice")}
        testId="kpi-jobs-ready-to-invoice"
      />
    </div>
  );
}
