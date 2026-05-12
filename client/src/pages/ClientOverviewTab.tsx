/**
 * ClientOverviewTab — analytics dashboard tab for a client detail page.
 *
 * Layout:
 *   1. CompactKpiSummary        — Lifetime Revenue / Outstanding Balance / Avg Days To Pay / Active Jobs
 *   2. FinancialPerformanceCard — comparison table (L30 / L12M / Change) + revenue trend chart
 *   3. ClientHealthCard         — health metrics
 *   4. TopItemsSoldCard         — top 5 invoice line items by revenue (last 12 months)
 *   5. InsightsCard             — auto-generated insight bullets
 *   6. HistoricalPricingSection — pricing history from LocPricingTab (location scope only)
 */

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import type { LucideIcon } from "lucide-react";
import {
  TrendingDown,
  Clock,
  DollarSign,
  Calendar,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Users,
  Lightbulb,
  BarChart3,
  Briefcase,
  ShoppingBag,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

import {
  CardShell,
  CardShellHeader,
  CardShellTitle,
  CardShellBody,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ENTITY_META_CLASS, SECTION_LABEL_CLASS } from "@/components/ui/typography";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { ClientIntelligenceData } from "@shared/clientIntelligence";
import LocPricingTab from "@/components/LocPricingTab";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ClientOverviewTabProps {
  customerCompanyId: string;
  companyName: string;
  onNavigate: (path: string) => void;
  activeJobsCount: number;
  onHoldJobsCount: number;
  /** When non-null the overview is in location scope: pricing history
   *  renders below the analytics cards. Null = company/all-locations scope. */
  locationId: string | null;
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

// Minimum outstanding balance (CAD) before surfacing the "Large Outstanding Balance" insight.
const LARGE_BALANCE_THRESHOLD_CAD = 5000;

// ---------------------------------------------------------------------------
// FinancialPerformanceCard — comparison table + trend chart
// ---------------------------------------------------------------------------

interface FinancialPerformanceCardProps {
  data: ClientIntelligenceData;
  className?: string;
}

function FinancialPerformanceCard({ data, className }: FinancialPerformanceCardProps) {
  const l30 = data.last30Days;
  const l12 = data.last12Months;

  const revDelta =
    l12.prev12GrossRevenue > 0
      ? ((l12.grossRevenue - l12.prev12GrossRevenue) / l12.prev12GrossRevenue) * 100
      : null;

  const trendData = data.revenueTrend.map((r) => ({
    label: format(new Date(r.month + "-01"), "MMM"),
    gross: r.gross,
  }));

  const rows: {
    label: string;
    l30: string;
    l12: string;
    change?: string | null;
    changePositive?: boolean | null;
  }[] = [
    {
      label: "Gross Revenue",
      l30: formatCurrency(l30.grossRevenue),
      l12: formatCurrency(l12.grossRevenue),
      change: revDelta != null ? (revDelta >= 0 ? `+${revDelta.toFixed(1)}%` : `${revDelta.toFixed(1)}%`) : null,
      changePositive: revDelta != null ? revDelta >= 0 : null,
    },
    {
      label: "Net Revenue",
      l30: formatCurrency(l30.netRevenue),
      l12: formatCurrency(l12.netRevenue),
    },
    {
      label: "Gross Margin %",
      l30: l30.grossMarginPct != null ? l30.grossMarginPct.toFixed(1) + "%" : "—",
      l12: l12.grossMarginPct != null ? l12.grossMarginPct.toFixed(1) + "%" : "—",
    },
    {
      label: "Invoice Count",
      l30: l30.invoiceCount.toString(),
      l12: l12.invoiceCount.toString(),
    },
    {
      label: "Avg Invoice Value",
      l30: l30.avgInvoiceValue != null ? formatCurrency(l30.avgInvoiceValue) : "—",
      l12: l12.avgInvoiceValue != null ? formatCurrency(l12.avgInvoiceValue) : "—",
    },
  ];

  return (
    <CardShell className={cn("flex flex-col", className)}>
      <CardShellHeader>
        <CardShellTitle icon={BarChart3} iconColor="text-slate-600">
          Financial Performance
        </CardShellTitle>
      </CardShellHeader>
      <CardShellBody className="flex-1">
        <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-card-border">
          {/* Left: comparison table */}
          <div className="flex-1 px-4 py-3">
            {/* Column headers */}
            <div className="grid grid-cols-4 gap-2 mb-1">
              <span className={cn(SECTION_LABEL_CLASS, "col-span-1")} />
              <span className={cn(SECTION_LABEL_CLASS, "text-right")}>Last 30 Days</span>
              <span className={cn(SECTION_LABEL_CLASS, "text-right")}>Last 12 Months</span>
              <span className={cn(SECTION_LABEL_CLASS, "text-right")}>Change</span>
            </div>
            {rows.map((row) => (
              <div
                key={row.label}
                className="grid grid-cols-4 gap-2 py-1.5 border-b border-card-border last:border-0 items-center"
              >
                <span className={cn(ENTITY_META_CLASS, "col-span-1")}>{row.label}</span>
                <span className="text-caption font-medium tabular-nums text-foreground text-right">
                  {row.l30}
                </span>
                <span className="text-caption font-medium tabular-nums text-foreground text-right">
                  {row.l12}
                </span>
                <span
                  className={cn(
                    "text-helper text-right",
                    row.changePositive === true && "text-emerald-600",
                    row.changePositive === false && "text-destructive",
                    row.changePositive == null && "text-muted-foreground",
                  )}
                >
                  {row.change ?? "—"}
                </span>
              </div>
            ))}
          </div>

          {/* Right: revenue trend chart */}
          <div className="md:w-[200px] px-4 py-3 shrink-0">
            <p className={cn(SECTION_LABEL_CLASS, "mb-2")}>Revenue Trend (Gross)</p>
            {trendData.length === 0 ? (
              <p className={cn(ENTITY_META_CLASS, "py-4 text-center")}>No trend data</p>
            ) : (
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={trendData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis hide />
                  <Tooltip
                    formatter={(value) => [formatCurrency(Number(value)), "Revenue"]}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Bar dataKey="gross" radius={[2, 2, 0, 0]}>
                    {trendData.map((_, i) => (
                      <Cell key={i} fill="#76B054" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </CardShellBody>
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// ClientHealthCard
// ---------------------------------------------------------------------------

interface ClientHealthCardProps {
  data: ClientIntelligenceData;
}

function ClientHealthCard({ data }: ClientHealthCardProps) {
  return (
    <CardShell className="flex flex-col">
      <CardShellHeader>
        <CardShellTitle icon={Users} iconColor="text-slate-600">
          Client Health
        </CardShellTitle>
      </CardShellHeader>
      <CardShellBody padded className="flex-1">
        <HealthRow label="Customer Since" value={data.customerSinceDate ? format(new Date(data.customerSinceDate), "MMM d, yyyy") : "—"} />
        <HealthRow label="Total Jobs" value={data.totalJobs.toString()} />
        <HealthRow label="Total Invoices" value={data.totalInvoices.toString()} />
        <HealthRow label="Last Job" value={data.lastJobDate ? format(new Date(data.lastJobDate), "MMM d, yyyy") : "—"} />
        <HealthRow label="Last Invoice" value={data.lastInvoiceDate ? format(new Date(data.lastInvoiceDate), "MMM d, yyyy") : "—"} />
        <HealthRow
          label="Avg Service Freq"
          value={
            data.avgServiceFrequencyMonths != null
              ? `1 job every ${data.avgServiceFrequencyMonths.toFixed(1)} months`
              : "—"
          }
        />
        <HealthRow
          label="Avg Invoice Value"
          value={data.avgJobValue != null ? formatCurrency(data.avgJobValue) : "—"}
          last
        />
      </CardShellBody>
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// TopItemsSoldCard
// ---------------------------------------------------------------------------

interface TopItemsSoldCardProps {
  data: ClientIntelligenceData;
}

function TopItemsSoldCard({ data }: TopItemsSoldCardProps) {
  const items = data.topItemsSold;

  return (
    <CardShell className="flex flex-col">
      <CardShellHeader>
        <CardShellTitle icon={ShoppingBag} iconColor="text-slate-600">
          Top Items Sold
        </CardShellTitle>
      </CardShellHeader>
      <CardShellBody padded className="flex-1">
        <p className={cn(ENTITY_META_CLASS, "mb-2")}>Last 12 Months</p>
        {items.length === 0 ? (
          <p className={cn(ENTITY_META_CLASS, "py-4 text-center")}>No item history yet.</p>
        ) : (
          <div>
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 pb-1 mb-0.5 border-b border-card-border">
              <span className={SECTION_LABEL_CLASS}>Item / Service</span>
              <span className={cn(SECTION_LABEL_CLASS, "text-right")}>Qty</span>
              <span className={cn(SECTION_LABEL_CLASS, "text-right")}>Revenue</span>
            </div>
            {items.map((item, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_auto_auto] gap-x-3 py-1.5 border-b border-card-border last:border-0 items-center"
              >
                <span className={cn(ENTITY_META_CLASS, "truncate")} title={item.name}>
                  {item.name || "—"}
                </span>
                <span className="text-caption font-medium tabular-nums text-foreground text-right">
                  {item.quantity}
                </span>
                <span className="text-caption font-medium tabular-nums text-foreground text-right">
                  {formatCurrency(item.revenue)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardShellBody>
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// InsightsCard
// ---------------------------------------------------------------------------

interface InsightsCardProps {
  data: ClientIntelligenceData;
}

function InsightsCard({ data }: InsightsCardProps) {
  const insights: { icon: LucideIcon; title: string; body: string }[] = [];

  if (!data.maintenancePlanActive) {
    insights.push({
      icon: ShieldCheck,
      title: "No Maintenance Plan",
      body: "This client does not have an active preventive maintenance plan.",
    });
  }

  if (data.outstandingBalance > LARGE_BALANCE_THRESHOLD_CAD) {
    insights.push({
      icon: AlertCircle,
      title: "Outstanding Balance Needs Attention",
      body: `${formatCurrency(data.outstandingBalance)} outstanding across ${data.outstandingInvoiceCount} invoice${data.outstandingInvoiceCount !== 1 ? "s" : ""}.`,
    });
  }

  if (
    data.avgDaysToPay != null &&
    data.companyAvgDaysToPay != null &&
    data.avgDaysToPay > data.companyAvgDaysToPay * 1.2
  ) {
    insights.push({
      icon: Clock,
      title: "Slow Payment",
      body: `Avg days to pay (${Math.round(data.avgDaysToPay)}) is above company average (${Math.round(data.companyAvgDaysToPay)}).`,
    });
  }

  if (
    data.last12Months.grossRevenue < data.last12Months.prev12GrossRevenue * 0.85 &&
    data.last12Months.prev12GrossRevenue > 0
  ) {
    insights.push({
      icon: TrendingDown,
      title: "Declining Revenue",
      body: "Revenue this year is more than 15% below the prior year.",
    });
  }

  if (data.lastServiceDaysAgo != null && data.lastServiceDaysAgo > 90) {
    insights.push({
      icon: Calendar,
      title: "No Recent Service",
      body: `No service activity in ${data.lastServiceDaysAgo} days.`,
    });
  }

  if (data.totalInvoices === 0) {
    insights.push({
      icon: AlertCircle,
      title: "No Invoice History",
      body: "No invoices have been issued for this client.",
    });
  } else if (data.avgDaysToPay == null) {
    insights.push({
      icon: Clock,
      title: "No Payment History",
      body: "No payments on record for this client.",
    });
  }

  if (
    data.quoteApprovalRate != null &&
    data.quoteApprovalRate >= 70 &&
    // only surface if we haven't filled the card with alerts
    insights.length < 4
  ) {
    insights.push({
      icon: CheckCircle2,
      title: "High Quote Approval",
      body: `${data.quoteApprovalRate.toFixed(0)}% quote approval rate — strong upsell candidate.`,
    });
  }

  return (
    <CardShell className="flex flex-col">
      <CardShellHeader>
        <CardShellTitle icon={Lightbulb} iconColor="text-slate-600">
          Insights
        </CardShellTitle>
      </CardShellHeader>
      <CardShellBody padded className="flex-1">
        {insights.length === 0 ? (
          <p className={cn(ENTITY_META_CLASS, "py-4 text-center")}>No insights at this time.</p>
        ) : (
          insights.map((insight, i) => {
            const InsightIcon = insight.icon;
            return (
              <div
                key={i}
                className="flex items-start gap-2.5 py-2 border-b border-card-border last:border-0"
              >
                <div className="p-1 rounded bg-slate-100 mt-0.5 shrink-0">
                  <InsightIcon className="h-3.5 w-3.5 text-slate-600" />
                </div>
                <div>
                  <p className="text-caption font-medium text-foreground">{insight.title}</p>
                  <p className={cn(ENTITY_META_CLASS, "mt-0.5")}>{insight.body}</p>
                </div>
              </div>
            );
          })
        )}
      </CardShellBody>
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// CompactKpiSummary — 4-metric strip inside the Overview tab
// ---------------------------------------------------------------------------

interface CompactKpiSummaryProps {
  data: ClientIntelligenceData;
  activeJobsCount: number;
  onHoldJobsCount: number;
}

function CompactKpiSummary({ data, activeJobsCount, onHoldJobsCount }: CompactKpiSummaryProps) {
  const isSlowPayer =
    data.avgDaysToPay != null &&
    data.companyAvgDaysToPay != null &&
    data.avgDaysToPay > data.companyAvgDaysToPay * 1.2;

  function activeSub(): string {
    if (activeJobsCount === 0) return "None active";
    if (onHoldJobsCount > 0) return `${onHoldJobsCount} on hold`;
    return `${activeJobsCount} active`;
  }

  const avgDaysSub = (() => {
    const parts: string[] = [];
    if (data.companyAvgDaysToPay != null)
      parts.push(`Company avg: ${Math.round(data.companyAvgDaysToPay)} days`);
    if (isSlowPayer) parts.push("Slow payer");
    return parts.join(" · ") || undefined;
  })();

  const metrics: {
    icon: typeof DollarSign;
    iconBg: string;
    iconColor: string;
    label: string;
    value: string;
    sub: string | undefined;
  }[] = [
    {
      icon: DollarSign,
      iconBg: "bg-emerald-100",
      iconColor: "text-emerald-600",
      label: "Lifetime Revenue",
      value: formatCurrency(data.lifetimeRevenue),
      sub: data.customerSinceDate
        ? `Customer since ${format(new Date(data.customerSinceDate), "MMM yyyy")}`
        : undefined,
    },
    {
      icon: AlertCircle,
      iconBg: "bg-amber-100",
      iconColor: "text-amber-600",
      label: "Outstanding Balance",
      value: formatCurrency(data.outstandingBalance),
      sub: data.outstandingInvoiceCount > 0
        ? `${data.outstandingInvoiceCount} unpaid invoice${data.outstandingInvoiceCount !== 1 ? "s" : ""}${data.largestOverdueAmount != null && data.largestOverdueAmount > 0 ? " · Needs attention" : ""}`
        : "No unpaid invoices",
    },
    {
      icon: Clock,
      iconBg: "bg-sky-100",
      iconColor: "text-sky-600",
      label: "Avg Days To Pay",
      value: data.avgDaysToPay != null ? `${Math.round(data.avgDaysToPay)} days` : "—",
      sub: avgDaysSub,
    },
    {
      icon: Briefcase,
      iconBg: "bg-brand-green/10",
      iconColor: "text-brand-green",
      label: "Active Jobs",
      value: activeJobsCount.toString(),
      sub: activeSub(),
    },
  ];

  return (
    <CardShell data-testid="overview-kpi-summary">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-card-border">
        {metrics.map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.label} className="flex items-start gap-2.5 px-4 py-3">
              <div className={cn("p-1.5 rounded-md shrink-0 mt-0.5", m.iconBg)}>
                <Icon className={cn("h-3.5 w-3.5", m.iconColor)} />
              </div>
              <div className="min-w-0">
                <p className={SECTION_LABEL_CLASS}>{m.label}</p>
                <p className="text-caption font-medium tabular-nums text-foreground">{m.value}</p>
                {m.sub && <p className={ENTITY_META_CLASS}>{m.sub}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// Shared primitive helpers (internal only)
// ---------------------------------------------------------------------------

function HealthRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between py-1.5",
        !last && "border-b border-card-border",
      )}
    >
      <span className={ENTITY_META_CLASS}>{label}</span>
      <span className="text-caption font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HistoricalPricingSection
// ---------------------------------------------------------------------------

interface HistoricalPricingSectionProps {
  locationId: string | null;
  onNavigate: (path: string) => void;
}

function HistoricalPricingSection({ locationId, onNavigate }: HistoricalPricingSectionProps) {
  return (
    <CardShell data-testid="historical-pricing-section">
      <CardShellHeader>
        <CardShellTitle icon={Briefcase} iconColor="text-slate-600">
          Historical Pricing
        </CardShellTitle>
      </CardShellHeader>
      <CardShellBody padded>
        <p className={cn(ENTITY_META_CLASS, "mb-3")}>
          Prices previously used for this client.
        </p>
        {locationId ? (
          <LocPricingTab locationId={locationId} onNavigate={onNavigate} />
        ) : (
          <p className={cn(ENTITY_META_CLASS, "py-4 text-center")} data-testid="pricing-scope-prompt">
            Select a specific location from the scope selector to view its pricing history.
          </p>
        )}
      </CardShellBody>
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function OverviewSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-[72px] w-full rounded-md" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <CardShell className="lg:col-span-2">
          <CardShellBody padded className="py-4">
            <Skeleton className="h-48 w-full" />
          </CardShellBody>
        </CardShell>
        <CardShell>
          <CardShellBody padded className="py-4">
            <Skeleton className="h-48 w-full" />
          </CardShellBody>
        </CardShell>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <CardShell key={i}>
            <CardShellBody padded className="py-4">
              <Skeleton className="h-40 w-full" />
            </CardShellBody>
          </CardShell>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function ClientOverviewTab({
  customerCompanyId,
  companyName: _companyName,
  onNavigate,
  activeJobsCount,
  onHoldJobsCount,
  locationId,
}: ClientOverviewTabProps) {
  const { data, isLoading, isError } = useQuery<ClientIntelligenceData>({
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

  if (isLoading) {
    return <OverviewSkeleton />;
  }

  if (isError || !data) {
    return (
      <div className="py-12 text-center">
        <p className={ENTITY_META_CLASS}>Unable to load client intelligence data.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Compact KPI summary strip */}
      <CompactKpiSummary
        data={data}
        activeJobsCount={activeJobsCount}
        onHoldJobsCount={onHoldJobsCount}
      />

      {/* Row 1: Financial Performance (2fr) + Client Health (1fr) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <FinancialPerformanceCard data={data} className="lg:col-span-2" />
        <ClientHealthCard data={data} />
      </div>

      {/* Row 2: Top Items Sold + Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <TopItemsSoldCard data={data} />
        <InsightsCard data={data} />
      </div>

      {/* Row 3: Historical Pricing */}
      <HistoricalPricingSection locationId={locationId} onNavigate={onNavigate} />
    </div>
  );
}
