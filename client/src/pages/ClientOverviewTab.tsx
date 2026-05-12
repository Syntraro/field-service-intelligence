/**
 * ClientOverviewTab — full analytics dashboard tab for a client detail page.
 *
 * Fetches intelligence data from
 * GET /api/customer-companies/:customerCompanyId/intelligence
 * and renders six sub-sections:
 *   1. FinancialPerformanceCard  — last 30d / last 12m stats + revenue trend bar chart
 *   2. ClientHealthCard          — health metrics + maintenance plan warning
 *   3. PaymentBehaviorCard       — avg days to pay + payment trend line chart
 *   4. RevenueCategoriesCard     — donut chart of revenue by service category
 *   5. InsightsCard              — auto-generated insight bullets
 *   6. AtAGlanceStrip            — 5 compact stat tiles
 *
 * React Query shares the response with `ClientKpiStrip` via the same cache key.
 */

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import type { LucideIcon } from "lucide-react";
import {
  TrendingDown,
  TrendingUp,
  Clock,
  DollarSign,
  Calendar,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  CreditCard,
  Users,
  Lightbulb,
  BarChart3,
  PieChart as PieChartIcon,
  Wrench,
  Package,
  FileText,
  Receipt,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
  PieChart,
  Pie,
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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ClientOverviewTabProps {
  customerCompanyId: string;
  companyName: string;
  onNavigate: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const PIE_COLORS = ["#76B054", "#3b82f6", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];

// Minimum outstanding balance (CAD) before surfacing the "Large Outstanding Balance" insight.
const LARGE_BALANCE_THRESHOLD_CAD = 5000;

// ---------------------------------------------------------------------------
// FinancialPerformanceCard
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

  return (
    <CardShell className={cn("flex flex-col", className)}>
      <CardShellHeader>
        <CardShellTitle icon={BarChart3} iconColor="text-slate-600">
          Financial Performance
        </CardShellTitle>
      </CardShellHeader>
      <CardShellBody className="flex-1">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-0 divide-y md:divide-y-0 md:divide-x divide-card-border">
          {/* Column 1 — Last 30 Days */}
          <div className="px-4 py-3">
            <p className={cn(SECTION_LABEL_CLASS, "mb-2")}>Last 30 Days</p>
            <MetricRow label="Gross Revenue" value={formatCurrency(l30.grossRevenue)} />
            <MetricRow label="Invoice Count" value={l30.invoiceCount.toString()} />
            <MetricRow
              label="Avg Invoice Value"
              value={l30.avgInvoiceValue != null ? formatCurrency(l30.avgInvoiceValue) : "—"}
            />
            <MetricRow
              label="Gross Margin %"
              value={l30.grossMarginPct != null ? l30.grossMarginPct.toFixed(1) + "%" : "—"}
            />
          </div>

          {/* Column 2 — Last 12 Months */}
          <div className="px-4 py-3">
            <p className={cn(SECTION_LABEL_CLASS, "mb-2")}>Last 12 Months</p>
            <div>
              <div className="flex items-center justify-between py-1 border-b border-card-border last:border-0">
                <span className={ENTITY_META_CLASS}>Gross Revenue</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-caption font-medium tabular-nums text-foreground">
                    {formatCurrency(l12.grossRevenue)}
                  </span>
                  {revDelta != null && (
                    <span
                      className={cn(
                        "text-helper",
                        revDelta >= 0 ? "text-emerald-600" : "text-destructive",
                      )}
                    >
                      {revDelta >= 0 ? `↑ +${revDelta.toFixed(1)}%` : `↓ ${revDelta.toFixed(1)}%`}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <MetricRow label="Invoice Count" value={l12.invoiceCount.toString()} />
            <MetricRow
              label="Avg Invoice Value"
              value={l12.avgInvoiceValue != null ? formatCurrency(l12.avgInvoiceValue) : "—"}
            />
            <MetricRow
              label="Gross Margin %"
              value={l12.grossMarginPct != null ? l12.grossMarginPct.toFixed(1) + "%" : "—"}
            />
          </div>

          {/* Column 3 — Revenue Trend Chart */}
          <div className="px-4 py-3">
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
// PaymentBehaviorCard
// ---------------------------------------------------------------------------

interface PaymentBehaviorCardProps {
  data: ClientIntelligenceData;
}

function PaymentBehaviorCard({ data }: PaymentBehaviorCardProps) {
  return (
    <CardShell className="flex flex-col">
      <CardShellHeader>
        <CardShellTitle icon={CreditCard} iconColor="text-slate-600">
          Payment Behavior
        </CardShellTitle>
      </CardShellHeader>
      <CardShellBody padded className="flex-1">
        <HealthRow
          label="Avg Days to Pay"
          value={data.avgDaysToPay != null ? Math.round(data.avgDaysToPay) + " days" : "—"}
        />
        <HealthRow
          label="% Overdue"
          value={data.pctInvoicesOverdue != null ? data.pctInvoicesOverdue.toFixed(1) + "%" : "—"}
        />
        <HealthRow
          label="Largest Overdue"
          value={data.largestOverdueAmount != null ? formatCurrency(data.largestOverdueAmount) : "—"}
          last
        />

        <p className={cn(SECTION_LABEL_CLASS, "mt-3 mb-1")}>Payment Trend (Avg Days To Pay)</p>
        {data.paymentTrend.length === 0 ? (
          <p className={cn(ENTITY_META_CLASS, "py-4 text-center")}>No payment data</p>
        ) : (
          <ResponsiveContainer width="100%" height={100}>
            <LineChart
              data={data.paymentTrend.map((p) => ({
                label: format(new Date(p.month + "-01"), "MMM"),
                avgDays: p.avgDays,
              }))}
              margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
            >
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis hide />
              <Tooltip
                formatter={(value) => [`${Number(value)} days`, "Avg Days"]}
                contentStyle={{ fontSize: 12 }}
              />
              <Line
                type="monotone"
                dataKey="avgDays"
                stroke="#76B054"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardShellBody>
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// RevenueCategoriesCard
// ---------------------------------------------------------------------------

interface RevenueCategoriesCardProps {
  data: ClientIntelligenceData;
}

function RevenueCategoriesCard({ data }: RevenueCategoriesCardProps) {
  const cats = data.revenueByCategory;
  const total = cats.reduce((acc, c) => acc + c.amount, 0);

  return (
    <CardShell className="flex flex-col">
      <CardShellHeader>
        <CardShellTitle icon={PieChartIcon} iconColor="text-slate-600">
          Revenue Categories
        </CardShellTitle>
      </CardShellHeader>
      <CardShellBody padded className="flex-1">
        <p className={cn(ENTITY_META_CLASS, "mb-2")}>Last 12 Months</p>
        {cats.length === 0 ? (
          <p className={cn(ENTITY_META_CLASS, "py-4 text-center")}>No revenue data</p>
        ) : (
          <div className="flex flex-col md:flex-row items-center gap-4">
            <div className="shrink-0 w-[160px] h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={cats}
                  dataKey="amount"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={75}
                >
                  {cats.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => [formatCurrency(Number(value)), "Revenue"]}
                  contentStyle={{ fontSize: 12 }}
                />
              </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="flex-1 min-w-0 w-full">
              {cats.map((cat, i) => (
                <div
                  key={cat.category}
                  className="flex items-center justify-between py-1 border-b border-card-border last:border-0"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                    />
                    <span className={cn(ENTITY_META_CLASS, "truncate")}>{cat.category}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    <span className="text-caption font-medium tabular-nums text-foreground">
                      {formatCurrency(cat.amount)}
                    </span>
                    <span className={ENTITY_META_CLASS}>{cat.pct.toFixed(0)}%</span>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1.5">
                <span className={SECTION_LABEL_CLASS}>Total</span>
                <span className="text-caption font-medium tabular-nums text-foreground">
                  {formatCurrency(total)}
                </span>
              </div>
            </div>
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
      title: "Recent Service Gap",
      body: `No service activity in ${data.lastServiceDaysAgo} days.`,
    });
  }

  if (data.quoteApprovalRate != null && data.quoteApprovalRate >= 70) {
    insights.push({
      icon: CheckCircle2,
      title: "High Quote Approval",
      body: `${data.quoteApprovalRate.toFixed(0)}% quote approval rate — strong upsell candidate.`,
    });
  }

  if (data.outstandingBalance > LARGE_BALANCE_THRESHOLD_CAD) {
    insights.push({
      icon: AlertCircle,
      title: "Large Outstanding Balance",
      body: `${formatCurrency(data.outstandingBalance)} outstanding across ${data.outstandingInvoiceCount} invoice${data.outstandingInvoiceCount !== 1 ? "s" : ""}.`,
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
// AtAGlanceStrip
// ---------------------------------------------------------------------------

interface AtAGlanceStripProps {
  data: ClientIntelligenceData;
}

function AtAGlanceStrip({ data }: AtAGlanceStripProps) {
  const tiles: { icon: LucideIcon; label: string; value: string }[] = [
    {
      icon: Wrench,
      label: "Most Common Service",
      value: data.mostCommonJobType
        ? data.mostCommonJobType.charAt(0).toUpperCase() + data.mostCommonJobType.slice(1)
        : "—",
    },
    {
      icon: Package,
      label: "Total Equipment",
      value: data.totalEquipment.toString(),
    },
    {
      icon: FileText,
      label: "Open Quotes Value",
      value: formatCurrency(data.openQuotesValue),
    },
    {
      icon: CheckCircle2,
      label: "Work Completion",
      value: data.workCompletionPct != null ? data.workCompletionPct.toFixed(0) + "%" : "—",
    },
    {
      icon: Receipt,
      label: "Total Invoices",
      value: data.totalInvoices.toString(),
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      {tiles.map((tile) => {
        const TileIcon = tile.icon;
        return (
          <div
            key={tile.label}
            className="rounded-md border border-card-border bg-card px-3 py-2 flex items-center gap-2.5"
          >
            <div className="p-1.5 rounded bg-slate-100 shrink-0">
              <TileIcon className="h-4 w-4 text-slate-600" />
            </div>
            <div className="min-w-0">
              <p className={SECTION_LABEL_CLASS}>{tile.label}</p>
              <p className="text-caption font-medium text-foreground tabular-nums truncate">
                {tile.value}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared primitive helpers (internal only)
// ---------------------------------------------------------------------------

/** Simple label + value row used in health / payment cards. */
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

/** Simple label + value row used in the financial performance card. */
function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-card-border last:border-0">
      <span className={ENTITY_META_CLASS}>{label}</span>
      <span className="text-caption font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function OverviewSkeleton() {
  return (
    <div className="space-y-3">
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <CardShell key={i}>
            <CardShellBody padded className="py-4">
              <Skeleton className="h-40 w-full" />
            </CardShellBody>
          </CardShell>
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-md" />
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
  onNavigate: _onNavigate,
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
      {/* Row 1: Financial Performance (2fr) + Client Health (1fr) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <FinancialPerformanceCard data={data} className="lg:col-span-2" />
        <ClientHealthCard data={data} />
      </div>

      {/* Row 2: Payment Behavior | Revenue Categories | Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <PaymentBehaviorCard data={data} />
        <RevenueCategoriesCard data={data} />
        <InsightsCard data={data} />
      </div>

      {/* Row 3: At A Glance strip */}
      <AtAGlanceStrip data={data} />
    </div>
  );
}
