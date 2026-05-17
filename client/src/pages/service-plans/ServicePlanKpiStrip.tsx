import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarCheck, CheckCircle2, Clock } from "lucide-react";
import { WorkspaceKpiStrip, type WorkspaceKpiDescriptor } from "@/components/workspace/WorkspaceKpiStrip";
import { applyViewPredicate, type RecurringPlanItem } from "./ServicePlanListPanel";

/**
 * Service Plans KPI strip — client-side counts derived from the plan list.
 * Subscribes to the same query key as ServicePlansWorkspaceTab so React Query
 * deduplicates the fetch; no extra network request is made.
 */
export function ServicePlanKpiStrip() {
  const { data: plans } = useQuery<RecurringPlanItem[]>({
    queryKey: ["/api/recurring-templates"],
    queryFn: async () => {
      const res = await fetch("/api/recurring-templates", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load service plans");
      return res.json();
    },
    staleTime: 30_000,
    refetchIntervalInBackground: false,
  });

  const loading = plans === undefined;

  const active       = useMemo(() => plans ? applyViewPredicate(plans, "active").length       : 0, [plans]);
  const workDue      = useMemo(() => plans ? applyViewPredicate(plans, "work_due").length      : 0, [plans]);
  const overdue      = useMemo(() => plans ? applyViewPredicate(plans, "overdue").length       : 0, [plans]);
  const expiringSoon = useMemo(() => plans ? applyViewPredicate(plans, "expiring_soon").length : 0, [plans]);

  const kpis: WorkspaceKpiDescriptor[] = [
    {
      id: "active",
      label: "Active Plans",
      value: loading ? "—" : String(active),
      sub: loading ? "Loading…" : active === 1 ? "1 plan running" : `${active} plans running`,
      icon: CheckCircle2,
      iconColor: "text-emerald-600",
      iconBg: "bg-emerald-100",
      loading,
      testId: "kpi-sp-active",
    },
    {
      id: "work-due",
      label: "Work Due",
      value: loading ? "—" : String(workDue),
      sub: loading ? "Loading…" : workDue === 0 ? "Nothing due soon" : "Due within 7 days",
      icon: CalendarCheck,
      iconColor: "text-amber-600",
      iconBg: "bg-amber-100",
      loading,
      testId: "kpi-sp-work-due",
    },
    {
      id: "overdue",
      label: "Overdue",
      value: loading ? "—" : String(overdue),
      sub: loading ? "Loading…" : overdue === 0 ? "All schedules on track" : overdue === 1 ? "1 plan past due" : `${overdue} plans past due`,
      icon: AlertTriangle,
      iconColor: "text-red-600",
      iconBg: "bg-red-100",
      loading,
      testId: "kpi-sp-overdue",
    },
    {
      id: "expiring-soon",
      label: "Expiring Soon",
      value: loading ? "—" : String(expiringSoon),
      sub: loading ? "Loading…" : expiringSoon === 0 ? "No expiring agreements" : "Expire within 90 days",
      icon: Clock,
      iconColor: "text-orange-600",
      iconBg: "bg-orange-100",
      loading,
      testId: "kpi-sp-expiring-soon",
    },
  ];

  return <WorkspaceKpiStrip kpis={kpis} data-testid="service-plan-kpi-strip" />;
}
