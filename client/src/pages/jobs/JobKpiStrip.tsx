import { useQuery } from "@tanstack/react-query";
import { Calendar, CalendarDays, Clock, TrendingUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { WorkspaceKpiStrip, type WorkspaceKpiDescriptor } from "@/components/workspace/WorkspaceKpiStrip";

// ── Local types ───────────────────────────────────────────────────────────────

interface VisitSummary { scheduledThisWeek: number; scheduledThisMonth: number; scheduledFromNow: number }
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

export function JobKpiStrip() {
  // Single aggregate query — server computes all three counts in one SQL pass.
  // Key is stable (no date params) so React Query cache never drifts on re-render.
  // SSE invalidation via useDispatchStream covers the ["visits"] prefix.
  const { data: visitSummary } = useQuery<VisitSummary>({
    queryKey: ["visits", "summary"],
    queryFn: () => apiRequest("/api/visits/summary"),
    staleTime: 60_000,
    refetchIntervalInBackground: false,
  });

  const { data: financialData } = useQuery<FinancialSummary>({
    queryKey: ["dashboard", "financial"],
    queryFn: () => apiRequest("/api/dashboard/financial"),
    staleTime: 60_000,
    refetchIntervalInBackground: false,
  });

  // ── Derived values ────────────────────────────────────────────────────────

  const visitsThisWeek   = visitSummary?.scheduledThisWeek  ?? 0;
  const visitsThisMonth  = visitSummary?.scheduledThisMonth ?? 0;
  const scheduledCount   = visitSummary?.scheduledFromNow   ?? 0;
  const revenueMonth     = financialData?.revenue.month     ?? 0;
  const revenueLastMonth = financialData?.revenue.lastMonth ?? 0;

  const revenueNote =
    revenueLastMonth > 0
      ? `${revenueMonth >= revenueLastMonth ? "+" : ""}${Math.round(((revenueMonth - revenueLastMonth) / revenueLastMonth) * 100)}% vs last month`
      : "From completed + invoiced work";

  const loading = visitSummary === undefined || financialData === undefined;

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
