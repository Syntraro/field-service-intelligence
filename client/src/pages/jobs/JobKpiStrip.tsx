import { useQuery } from "@tanstack/react-query";
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { Calendar, CalendarDays, Clock, TrendingUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { WorkspaceKpiStrip, type WorkspaceKpiDescriptor } from "@/components/workspace/WorkspaceKpiStrip";

// ── Local types ───────────────────────────────────────────────────────────────

interface VisitFeedResponse { visits: unknown[]; count: number }
interface FinancialSummary {
  revenue: { today: number; week: number; month: number; lastMonth: number };
  [key: string]: unknown;
}

function formatRevenue(amount: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// ── JobKpiStrip ───────────────────────────────────────────────────────────────

/**
 * Jobs-specific KPI data adapter → WorkspaceKpiStrip.
 * Fetches the same four data sources as the previous inline SummaryCard block.
 * No new endpoints; no metric changes.
 */
export function JobKpiStrip() {
  const weekStart  = startOfWeek(new Date(), { weekStartsOn: 1 }).toISOString();
  const weekEnd    = endOfWeek(new Date(), { weekStartsOn: 1 }).toISOString();
  const monthStart = startOfMonth(new Date()).toISOString();
  const monthEnd   = endOfMonth(new Date()).toISOString();
  const nowIso     = new Date().toISOString();

  const { data: weekVisits } = useQuery<VisitFeedResponse>({
    queryKey: ["visits", "summary-week", weekStart, weekEnd],
    queryFn: () =>
      apiRequest(`/api/visits?from=${encodeURIComponent(weekStart)}&to=${encodeURIComponent(weekEnd)}&excludeStatuses=cancelled`),
    staleTime: 60_000,
    refetchIntervalInBackground: false,
  });

  const { data: monthVisits } = useQuery<VisitFeedResponse>({
    queryKey: ["visits", "summary-month", monthStart, monthEnd],
    queryFn: () =>
      apiRequest(`/api/visits?from=${encodeURIComponent(monthStart)}&to=${encodeURIComponent(monthEnd)}&excludeStatuses=cancelled`),
    staleTime: 60_000,
    refetchIntervalInBackground: false,
  });

  const { data: scheduledVisits } = useQuery<VisitFeedResponse>({
    queryKey: ["visits", "summary-scheduled", nowIso],
    queryFn: () =>
      apiRequest(`/api/visits?from=${encodeURIComponent(nowIso)}&excludeStatuses=cancelled,completed`),
    staleTime: 60_000,
    refetchIntervalInBackground: false,
  });

  const { data: financialData } = useQuery<FinancialSummary>({
    queryKey: ["dashboard", "financial"],
    queryFn: () => apiRequest("/api/dashboard/financial"),
    staleTime: 60_000,
    refetchIntervalInBackground: false,
  });

  // ── Derived values (identical logic to the previous inline block) ──────────

  const visitsThisWeek  = weekVisits?.count      ?? 0;
  const visitsThisMonth = monthVisits?.count      ?? 0;
  const scheduledCount  = scheduledVisits?.count  ?? 0;
  const revenueMonth    = financialData?.revenue.month     ?? 0;
  const revenueLastMonth = financialData?.revenue.lastMonth ?? 0;

  const revenueNote =
    revenueLastMonth > 0
      ? `${revenueMonth >= revenueLastMonth ? "+" : ""}${Math.round(((revenueMonth - revenueLastMonth) / revenueLastMonth) * 100)}% vs last month`
      : "From completed + invoiced work";

  const loading =
    weekVisits === undefined ||
    monthVisits === undefined ||
    scheduledVisits === undefined ||
    financialData === undefined;

  // ── Descriptor map ────────────────────────────────────────────────────────

  const kpis: WorkspaceKpiDescriptor[] = [
    {
      id: "visits-week",
      label: "Visits This Week",
      value: String(visitsThisWeek),
      sub: "Current week scheduled visits",
      icon: Calendar,
      iconColor: "text-blue-600",
      iconBg: "bg-blue-100",
      loading,
      testId: "kpi-visits-week",
    },
    {
      id: "visits-month",
      label: "Visits This Month",
      value: String(visitsThisMonth),
      sub: "Current month scheduled visits",
      icon: CalendarDays,
      iconColor: "text-teal-600",
      iconBg: "bg-teal-100",
      loading,
      testId: "kpi-visits-month",
    },
    {
      id: "scheduled",
      label: "Scheduled",
      value: String(scheduledCount),
      sub: "Upcoming booked visits",
      icon: Clock,
      iconColor: "text-violet-600",
      iconBg: "bg-violet-100",
      loading,
      testId: "kpi-scheduled",
    },
    {
      id: "projected-revenue",
      label: "Projected Revenue",
      value: formatRevenue(revenueMonth),
      sub: revenueNote,
      icon: TrendingUp,
      iconColor: "text-emerald-600",
      iconBg: "bg-emerald-100",
      loading,
      testId: "kpi-projected-revenue",
    },
  ];

  return <WorkspaceKpiStrip kpis={kpis} data-testid="job-kpi-strip" />;
}
