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
import { Wrench, ChevronRight } from "lucide-react";
import { resolveDashboardNav, type DashboardAction } from "@/lib/dashboardNavigation";

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

  return (
    <div
      className={`bg-white rounded-md border border-[#e2e8f0] flex flex-col ${className}`}
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
      data-testid="pm-health-card"
    >
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-[#e2e8f0]">
        <Wrench className="h-3.5 w-3.5 text-violet-600" />
        <h3 className="text-sm font-semibold text-[#111827]">PM Health</h3>
      </header>
      <div className="flex-1">
        {isLoading ? (
          <div className="p-4 text-xs text-[#4b5563]">Loading PM status…</div>
        ) : (
          <ul>
            {rows.map((row, i) => {
              const isLast = i === rows.length - 1;
              const isWarn = row.urgent && row.count > 0;
              return (
                <li key={row.label}>
                  <button
                    type="button"
                    onClick={() => setLocation(resolveDashboardNav(row.action))}
                    className={`w-full flex items-center justify-between px-4 py-1.5 text-left transition-colors group ${
                      isWarn ? "bg-red-50/60 hover:bg-red-50" : "hover:bg-[#F0F5F0]"
                    } ${!isLast ? "border-b border-[#e2e8f0]" : ""}`}
                  >
                    <span className={`text-xs ${isWarn ? "text-red-600 font-medium" : "text-[#4b5563]"}`}>
                      {row.label}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-sm font-bold tabular-nums ${
                        isWarn ? "text-red-600" : row.count > 0 ? "text-[#111827]" : "text-[#4b5563]"
                      }`}>
                        {row.count}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-[#94a3b8] group-hover:text-[#111827] transition-colors" />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
