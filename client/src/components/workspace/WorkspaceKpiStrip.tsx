import { cn } from "@/lib/utils";
import { WorkspaceKpiCard, type WorkspaceKpiDescriptor } from "./WorkspaceKpiCard";

export type { WorkspaceKpiDescriptor };

interface WorkspaceKpiStripProps {
  kpis: WorkspaceKpiDescriptor[];
  className?: string;
  "data-testid"?: string;
}

/**
 * Canonical KPI strip layout for operational workspace header areas.
 * Renders WorkspaceKpiCard for each descriptor in a fixed 4-column grid.
 *
 * min-w-[920px]: intentional — the strip is wider than most mobile viewports.
 * The parent workspace container handles horizontal scroll (overflow-x-auto).
 * Supports 1–6 KPI descriptors; layout is grid-driven so fewer cards just
 * leave empty columns (acceptable for the current 4-card workspaces).
 *
 * Rendering-only — no data fetching, no domain coupling.
 */
export function WorkspaceKpiStrip({
  kpis,
  className,
  "data-testid": testId,
}: WorkspaceKpiStripProps) {
  return (
    <div
      className={cn("grid grid-cols-4 gap-3 min-w-[920px]", className)}
      data-testid={testId}
    >
      {kpis.map((kpi) => (
        <WorkspaceKpiCard key={kpi.id} {...kpi} />
      ))}
    </div>
  );
}
