/**
 * Financial Dashboard — owner/management financial health overview.
 *
 * Revenue is cash-basis (payments received), not invoiced amounts.
 * All metrics sourced from GET /api/dashboard/financial + GET /api/reports/ar-aging.
 */

import { useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft, DollarSign, TrendingUp, FileText, Wrench, ChevronRight,
  Receipt, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

// ============================================================================
// Types
// ============================================================================

interface FinancialData {
  revenue: { today: number; week: number; month: number; lastMonth: number };
  trend: { month: string; total: number }[];
  ar: { outstandingTotal: number; outstandingCount: number; pastDueTotal: number; pastDueCount: number; sentThisMonth: number };
  quotes: { sent: number; approved: number; conversionRate: number; avgValue: number };
  pm: { contractCount: number; totalContractValue: number };
}

interface ARAgingData {
  summary: { totalOutstanding: number; totalInvoices: number; averageDaysOutstanding: number };
  buckets: { bucket: string; count: number; totalBalance: number }[];
}

// ============================================================================
// Shared helpers — aligned with operational dashboard primitives
// ============================================================================

function formatCurrency(amount: number, compact = false): string {
  if (compact && Math.abs(amount) >= 1000) {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", notation: "compact", maximumFractionDigits: 1 }).format(amount);
  }
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}

/** Card wrapper — matches operational dashboard DashCard */
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white dark:bg-gray-900 rounded-lg border border-border/60 shadow-sm ${className}`}>{children}</div>;
}

/** Section header — matches operational dashboard CardHeader */
function SectionHeader({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children?: React.ReactNode }) {
  return (
    <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

// ============================================================================
// Page Component
// ============================================================================

export default function FinancialDashboard() {
  const [, setLocation] = useLocation();

  const { data, isLoading } = useQuery<FinancialData>({
    queryKey: ["dashboard", "financial"],
    queryFn: () => apiRequest("/api/dashboard/financial"),
    staleTime: 60_000,
  });

  const { data: arData, isLoading: arLoading } = useQuery<ARAgingData>({
    queryKey: ["reports", "ar-aging"],
    queryFn: () => apiRequest("/api/reports/ar-aging"),
    staleTime: 120_000,
  });

  const trendData = useMemo(() => {
    if (!data?.trend) return [];
    return data.trend.map(t => {
      const [y, m] = t.month.split("-");
      const d = new Date(parseInt(y), parseInt(m) - 1);
      return { name: d.toLocaleDateString("en-CA", { month: "short" }), total: t.total };
    });
  }, [data?.trend]);

  const agingData = useMemo(() => {
    if (!arData?.buckets) return [];
    const colors: Record<string, string> = { "0-30": "#22c55e", "31-60": "#f59e0b", "61-90": "#f97316", "90+": "#ef4444" };
    return arData.buckets.map(b => ({ name: b.bucket, value: b.totalBalance, count: b.count, fill: colors[b.bucket] ?? "#94a3b8" }));
  }, [arData?.buckets]);

  const monthPctChange = data && data.revenue.month > 0 && data.revenue.lastMonth > 0
    ? Math.round((data.revenue.month / data.revenue.lastMonth - 1) * 100) : null;

  return (
    <div className="min-h-screen bg-[#F4F8F4]">
      <main className="mx-auto max-w-6xl px-3 sm:px-4 lg:px-6 py-3 space-y-3">
        {/* Page header — compact */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLocation("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-bold">Financial Dashboard</h1>
            <p className="text-xs text-muted-foreground">Cash-basis revenue, accounts receivable, and pipeline health</p>
          </div>
        </div>

        {/* ── Row 1: Revenue Snapshot — matches operational dashboard top row card style ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {isLoading ? (
            [1,2,3,4].map(i => <Skeleton key={i} className="h-[76px] rounded-lg" />)
          ) : (
            [
              { label: "Revenue Today", value: data?.revenue.today ?? 0, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
              { label: "This Week", value: data?.revenue.week ?? 0, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/30" },
              { label: "This Month", value: data?.revenue.month ?? 0, color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-950/30" },
              { label: "Last Month", value: data?.revenue.lastMonth ?? 0, color: "text-slate-600", bg: "bg-slate-100 dark:bg-slate-800/30", sub: monthPctChange !== null ? `${monthPctChange >= 0 ? "+" : ""}${monthPctChange}% vs prior` : undefined },
            ].map(card => (
              <Card key={card.label}>
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`p-1.5 rounded-md ${card.bg}`}>
                      <DollarSign className={`h-3.5 w-3.5 ${card.color}`} />
                    </div>
                    <span className={`text-xs font-semibold uppercase tracking-wider ${card.color}`}>{card.label}</span>
                  </div>
                  <p className="text-lg font-bold tabular-nums">{formatCurrency(card.value)}</p>
                  {card.sub && <p className="text-[11px] text-muted-foreground mt-0.5">{card.sub}</p>}
                </div>
              </Card>
            ))
          )}
        </div>

        {/* ── Row 2: Monthly Revenue Trend — compact chart ── */}
        <Card>
          <SectionHeader icon={TrendingUp} title="Monthly Revenue Trend" />
          <div className="px-4 py-3">
            {isLoading ? (
              <Skeleton className="h-[140px] w-full" />
            ) : trendData.length === 0 ? (
              <div className="flex items-center justify-center h-[140px]">
                <p className="text-xs text-muted-foreground">Revenue will appear once invoices begin receiving payments.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={trendData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCurrency(v, true)} width={50} />
                  <Tooltip
                    formatter={(value) => [formatCurrency(Number(value ?? 0)), "Revenue"]}
                    contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid #e5e7eb", padding: "4px 8px" }}
                  />
                  <Bar dataKey="total" radius={[3, 3, 0, 0]} fill="#22c55e" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* ── Row 3: Cash Flow & AR Aging — side by side ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Cash Flow & AR */}
          <Card className="flex flex-col">
            <SectionHeader icon={Receipt} title="Cash Flow & A/R" />
            <div className="px-4 py-2 flex-1">
              {isLoading ? (
                <div className="space-y-2 py-1">{[1,2,3,4].map(i => <Skeleton key={i} className="h-8" />)}</div>
              ) : (
                <>
                  {[
                    { label: "Outstanding Invoices", value: formatCurrency(data?.ar.outstandingTotal ?? 0), sub: `${data?.ar.outstandingCount ?? 0} invoices` },
                    { label: "Past Due", value: formatCurrency(data?.ar.pastDueTotal ?? 0), sub: `${data?.ar.pastDueCount ?? 0} invoices`, warn: true },
                    { label: "Avg Days Outstanding", value: `${arData?.summary.averageDaysOutstanding ?? "—"} days` },
                    { label: "Sent This Month", value: String(data?.ar.sentThisMonth ?? 0) },
                  ].map((row, i) => (
                    <div key={row.label} className={`flex items-center justify-between py-2 ${i > 0 ? "border-t border-border/30" : ""}`}>
                      <span className="text-xs text-muted-foreground">{row.label}</span>
                      <div className="text-right">
                        <span className={`text-sm font-bold tabular-nums ${row.warn ? "text-red-600 dark:text-red-400" : ""}`}>{row.value}</span>
                        {row.sub && <p className="text-[10px] text-muted-foreground">{row.sub}</p>}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </Card>

          {/* AR Aging */}
          <Card className="flex flex-col">
            <SectionHeader icon={Clock} title="A/R Aging" />
            <div className="px-4 py-3 flex-1">
              {arLoading ? (
                <Skeleton className="h-[120px] w-full" />
              ) : agingData.length === 0 ? (
                <div className="flex items-center justify-center h-[120px]">
                  <p className="text-xs text-muted-foreground">Aging data will appear once invoices are issued.</p>
                </div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={110}>
                    <BarChart data={agingData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCurrency(v, true)} width={48} />
                      <Tooltip
                        formatter={(value, _name, entry) => [formatCurrency(Number(value ?? 0)), `${(entry as any)?.payload?.count ?? 0} invoices`]}
                        contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid #e5e7eb", padding: "4px 8px" }}
                      />
                      <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                        {agingData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="grid grid-cols-4 gap-1.5 mt-2">
                    {agingData.map(b => (
                      <div key={b.name} className="text-center">
                        <p className="text-[10px] text-muted-foreground font-medium">{b.name}d</p>
                        <p className="text-xs font-bold tabular-nums">{formatCurrency(b.value)}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>

        {/* ── Row 4: Quotes & PM Health — side by side, compact grid KPIs ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Quote Pipeline */}
          <Card className="flex flex-col">
            <SectionHeader icon={FileText} title="Quote & Sales Pipeline" />
            <div className="p-4 flex-1">
              {isLoading ? (
                <div className="grid grid-cols-2 gap-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-14" />)}</div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Quotes Sent", value: String(data?.quotes.sent ?? 0) },
                    { label: "Approved", value: String(data?.quotes.approved ?? 0) },
                    { label: "Conversion Rate", value: `${data?.quotes.conversionRate ?? 0}%` },
                    { label: "Avg Quote Value", value: formatCurrency(data?.quotes.avgValue ?? 0) },
                  ].map(kpi => (
                    <div key={kpi.label} className="rounded-md border border-border/40 p-3">
                      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">{kpi.label}</p>
                      <p className="text-sm font-bold tabular-nums">{kpi.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* PM Financial Health */}
          <Card className="flex flex-col">
            <SectionHeader icon={Wrench} title="PM Financial Health" />
            <div className="p-4 flex-1">
              {isLoading ? (
                <div className="grid grid-cols-2 gap-2">{[1,2].map(i => <Skeleton key={i} className="h-14" />)}</div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-border/40 p-3">
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">Active Contracts</p>
                    <p className="text-sm font-bold tabular-nums">{data?.pm.contractCount ?? 0}</p>
                  </div>
                  <div className="rounded-md border border-border/40 p-3">
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">Contract Value</p>
                    <p className="text-sm font-bold tabular-nums">{formatCurrency(data?.pm.totalContractValue ?? 0)}</p>
                  </div>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground mt-2">
                Per-month PM revenue and visit completion tracking coming in a future update.
              </p>
            </div>
          </Card>
        </div>

        {/* ── Navigation footer — compact ── */}
        <div className="flex items-center justify-between pb-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setLocation("/reports/accounts-receivable")}>
            <Receipt className="h-3 w-3" /> A/R Detail <ChevronRight className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setLocation("/reports")}>
            All Reports <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </main>
    </div>
  );
}
