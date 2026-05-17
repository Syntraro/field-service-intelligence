import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface OperationalWorkspaceHeaderProps {
  icon: React.ElementType;
  /** Tailwind text-color class for the icon, e.g. "text-violet-600". */
  iconColor: string;
  /** Tailwind bg-color class for the icon container, e.g. "bg-violet-50". */
  iconBg: string;
  title: string;
  subtitle?: string;
  /** Search widget slot — caller owns Input, value, onChange, and data-testid. */
  search?: ReactNode;
  /** Secondary action slot (e.g. Export button). Rendered before the divider. */
  actions?: ReactNode;
  /** Primary CTA slot (e.g. New Invoice button). Rendered after the divider. */
  primaryAction?: ReactNode;
  /** KPI strip slot — rendered below the title row with mt-4 spacing. */
  kpis?: ReactNode;
  className?: string;
  testId?: string;
}

/**
 * Canonical elevated header card for operational workspace / list pages.
 *
 * Slot-based — owns only the card chrome, layout, and icon badge.
 * All entity-specific content (icon, title, subtitle, search, actions, KPIs)
 * is provided by the caller. No domain coupling, no data fetching.
 *
 * Not for entity detail pages — use CanonicalDetailHeader for those.
 */
export function OperationalWorkspaceHeader({
  icon: Icon,
  iconColor,
  iconBg,
  title,
  subtitle,
  search,
  actions,
  primaryAction,
  kpis,
  className,
  testId,
}: OperationalWorkspaceHeaderProps) {
  const hasUtilityBar = search != null || actions != null || primaryAction != null;
  const showDivider = actions != null && primaryAction != null;

  return (
    <div className={cn("shrink-0 px-4 pt-5 pb-3", className)} data-testid={testId}>
      <div className="bg-white rounded-md border border-slate-100 shadow-[0_1px_8px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.03)] p-5">

        {/* Title row: icon + text left, utility actions right */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={cn("h-10 w-10 shrink-0 rounded-xl flex items-center justify-center", iconBg)}>
              <Icon className={cn("h-5 w-5", iconColor)} aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-title text-slate-900">{title}</h1>
              {subtitle && (
                <p className="text-helper text-muted-foreground mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>

          {hasUtilityBar && (
            <div className="flex items-center gap-2">
              {search}
              {actions}
              {showDivider && (
                <div className="h-5 w-px bg-slate-200 mx-0.5" aria-hidden="true" />
              )}
              {primaryAction}
            </div>
          )}
        </div>

        {/* KPI strip — 16px below the title row */}
        {kpis != null && (
          <div className="mt-4">{kpis}</div>
        )}

      </div>
    </div>
  );
}
