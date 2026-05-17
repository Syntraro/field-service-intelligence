import { cn } from "@/lib/utils";

/**
 * Descriptor for a single KPI card in an operational workspace.
 * All values are pre-formatted strings — no formatting logic lives here.
 */
export interface WorkspaceKpiDescriptor {
  /** Stable key used by WorkspaceKpiStrip as the React list key. */
  id: string;
  label: string;
  /** Pre-formatted display value, e.g. "$12,450" or "14 days" or "—". */
  value: string;
  /** Optional helper text rendered below the value. */
  sub?: string;
  icon: React.ElementType;
  /** Tailwind text-color class, e.g. "text-violet-600". */
  iconColor: string;
  /** Tailwind bg-color class for the icon container, e.g. "bg-violet-100". */
  iconBg: string;
  /** True while the backing query is loading. Card renders normally with its
   *  current value string; this flag is reserved for future skeleton treatment. */
  loading?: boolean;
  testId?: string;
}

export type WorkspaceKpiCardProps = WorkspaceKpiDescriptor;

/**
 * Canonical KPI card for operational workspace header strips.
 * Rendering-only — no data fetching, no calculations, no domain coupling.
 *
 * Visual spec: inset-surface card with icon badge, large value, muted label/sub.
 */
export function WorkspaceKpiCard({
  icon: Icon,
  iconColor,
  iconBg,
  label,
  value,
  sub,
  testId,
}: WorkspaceKpiCardProps) {
  return (
    <div
      className="bg-inset-surface rounded-md px-4 py-3 flex items-start gap-3 min-h-[80px] min-w-[220px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.04),0_0_0_1px_rgba(0,0,0,0.04)]"
      data-testid={testId}
    >
      <div className={cn("shrink-0 rounded-lg p-2.5 mt-0.5", iconBg)}>
        <Icon className={cn("h-4 w-4", iconColor)} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-helper text-muted-foreground truncate">{label}</div>
        {/* text-[22px]: intentionally centralized here until a workspace-kpi typography
            token is introduced. Do not replicate this size ad-hoc elsewhere. */}
        <div className="text-[22px] font-semibold tabular-nums text-slate-900 leading-tight mt-0.5">
          {value}
        </div>
        {sub && (
          <div className="text-helper text-muted-foreground mt-0.5 truncate">{sub}</div>
        )}
      </div>
    </div>
  );
}
