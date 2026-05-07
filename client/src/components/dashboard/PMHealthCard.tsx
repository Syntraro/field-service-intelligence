/**
 * PMHealthCard — preventive-maintenance health rollup for the Operations
 * Dashboard. Replaces the in-file WorklistCard clone previously inlined
 * in Dashboard.tsx.
 *
 * 2026-04-22: the card is only rendered by Dashboard.tsx when the tenant
 * has any PM data at all (`workflow.pm.hasAnyData` on the server). Tenants
 * that don't use PM never see this section — no empty shells, no dead real
 * estate.
 *
 * Shape and navigation kept identical to the legacy inline card so behavior
 * is unchanged for PM-using tenants.
 */

import { useLocation } from "wouter";
import { Wrench } from "lucide-react";
import { resolveDashboardNav, type DashboardAction } from "@/lib/dashboardNavigation";
import { KpiShell, KpiRow } from "@/components/ui/card";

interface PMHealthCardProps {
  overdueCount: number;
  comingDueCount: number;
  upcomingCount: number;
  awaitingGenerationCount: number;
  isLoading?: boolean;
  className?: string;
}

interface PMRow {
  label: string;
  count: number;
  action: DashboardAction;
  urgent?: boolean;
}

export function PMHealthCard({
  overdueCount,
  comingDueCount,
  upcomingCount,
  awaitingGenerationCount,
  isLoading,
  className = "",
}: PMHealthCardProps) {
  const [, setLocation] = useLocation();

  const rows: PMRow[] = [
    { label: "Overdue PM work", count: overdueCount, action: "pm.overdue", urgent: true },
    { label: "PM due in next 7 days", count: comingDueCount, action: "pm.comingDue" },
    { label: "Upcoming PM (7–30 days)", count: upcomingCount, action: "pm.upcoming" },
    { label: "PM instances awaiting generation", count: awaitingGenerationCount, action: "pipeline.pmAwaiting" },
  ];

  // 2026-05-07 Card canonicalization (Tier 1): outer chrome + header band
  // + row geometry replaced with the canonical KpiShell + KpiRow
  // primitives. Behavior, click handlers, urgent state, and chevron
  // affordance are preserved exactly.
  return (
    <KpiShell
      title="PM Health"
      icon={Wrench}
      iconColor="text-violet-600"
      className={className}
      data-testid="pm-health-card"
    >
      {isLoading ? (
        <div className="p-4 text-xs text-text-muted">Loading PM status…</div>
      ) : (
        <ul>
          {rows.map((row, i) => {
            const isLast = i === rows.length - 1;
            return (
              <li key={row.label}>
                <KpiRow
                  label={row.label}
                  count={row.count}
                  urgent={row.urgent}
                  last={isLast}
                  onClick={() => setLocation(resolveDashboardNav(row.action))}
                />
              </li>
            );
          })}
        </ul>
      )}
    </KpiShell>
  );
}
