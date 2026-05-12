/**
 * ClientKpiStrip — 4-tile primary KPI strip for the client detail page.
 *
 * Renders the four highest-signal client metrics directly below the scope
 * selector bar. Active Jobs count comes from the already-loaded page data
 * (no extra fetch). The other three metrics come from the intelligence
 * endpoint, which is shared with the Overview tab via React Query's cache.
 *
 * Cards:
 *   1. Lifetime Revenue    — intelligence endpoint
 *   2. Outstanding Balance — intelligence endpoint
 *   3. Avg Days To Pay     — intelligence endpoint
 *   4. Active Jobs         — page prop (from loaded jobs, no extra fetch)
 *
 * Layout: 4 columns on desktop, 2 on tablet, 1 on mobile.
 * No sticky behavior — scrolls with the page.
 */

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  DollarSign,
  AlertCircle,
  Clock,
  Briefcase,
} from "lucide-react";
import { KpiTile } from "@/components/dashboard/KpiTile";
import { formatCurrency } from "@/lib/formatters";
import type { ClientIntelligenceData } from "@shared/clientIntelligence";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ClientKpiStripProps {
  customerCompanyId: string;
  /** Count of open jobs for this client — sourced from the already-loaded
   *  overview data; avoids a separate fetch. */
  activeJobsCount: number;
  /** Count of open-but-on-hold jobs for the subtext annotation. */
  onHoldJobsCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function activeJobsSub(active: number, onHold: number): string {
  if (active === 0) return "None active";
  if (onHold > 0)
    return `${onHold} on hold`;
  return `${active} active`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientKpiStrip({
  customerCompanyId,
  activeJobsCount,
  onHoldJobsCount,
}: ClientKpiStripProps) {
  const { data, isLoading } = useQuery<ClientIntelligenceData>({
    queryKey: ["/api/customer-companies", customerCompanyId, "intelligence"],
    queryFn: async () => {
      const res = await fetch(
        `/api/customer-companies/${customerCompanyId}/intelligence`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load client intelligence");
      return res.json();
    },
    refetchIntervalInBackground: false,
  });

  // Slow-payer annotation: client avg materially above company avg (20%+)
  const isSlowPayer =
    data?.avgDaysToPay != null &&
    data?.companyAvgDaysToPay != null &&
    data.avgDaysToPay > data.companyAvgDaysToPay * 1.2;

  const avgDaysSub = (() => {
    if (isLoading || !data) return undefined;
    const parts: string[] = [];
    if (data.companyAvgDaysToPay != null)
      parts.push(`Company avg: ${Math.round(data.companyAvgDaysToPay)} days`);
    if (isSlowPayer) parts.push("Slow payer");
    return parts.join(" · ") || undefined;
  })();

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
      data-testid="client-kpi-strip"
    >
      {/* 1 — Lifetime Revenue */}
      <KpiTile
        label="Lifetime Revenue"
        icon={DollarSign}
        iconBg="bg-emerald-100"
        iconColor="text-emerald-600"
        value={isLoading || !data ? "—" : formatCurrency(data.lifetimeRevenue)}
        sub={
          !isLoading && data?.customerSinceDate
            ? `Customer since ${format(new Date(data.customerSinceDate), "MMM yyyy")}`
            : undefined
        }
        loading={isLoading}
        data-testid="kpi-lifetime-revenue"
      />

      {/* 2 — Outstanding Balance */}
      <KpiTile
        label="Outstanding Balance"
        icon={AlertCircle}
        iconBg="bg-amber-100"
        iconColor="text-amber-600"
        tone={!isLoading && data && data.outstandingBalance > 0 ? "warning" : "default"}
        value={isLoading || !data ? "—" : formatCurrency(data.outstandingBalance)}
        sub={
          !isLoading && data
            ? data.outstandingInvoiceCount > 0
              ? `${data.outstandingInvoiceCount} unpaid invoice${data.outstandingInvoiceCount !== 1 ? "s" : ""}${data.largestOverdueAmount != null && data.largestOverdueAmount > 0 ? " · Needs attention" : ""}`
              : "No unpaid invoices"
            : undefined
        }
        loading={isLoading}
        data-testid="kpi-outstanding-balance"
      />

      {/* 3 — Avg Days To Pay */}
      <KpiTile
        label="Avg Days To Pay"
        icon={Clock}
        iconBg="bg-sky-100"
        iconColor="text-sky-600"
        value={
          isLoading || !data
            ? "—"
            : data.avgDaysToPay != null
              ? `${Math.round(data.avgDaysToPay)} days`
              : "—"
        }
        sub={avgDaysSub}
        loading={isLoading}
        data-testid="kpi-avg-days-to-pay"
      />

      {/* 4 — Active Jobs (sourced from page data, not endpoint) */}
      <KpiTile
        label="Active Jobs"
        icon={Briefcase}
        iconBg="bg-brand-green/10"
        iconColor="text-brand-green"
        value={activeJobsCount}
        sub={activeJobsSub(activeJobsCount, onHoldJobsCount)}
        data-testid="kpi-active-jobs"
      />
    </div>
  );
}
