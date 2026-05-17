/**
 * DashboardMetricRow — canonical metric row renderer for dashboard cards
 * (2026-05-10, Phase B).
 *
 * Single source of truth for row geometry, typography, hover/border
 * semantics, tone styling, and chevron rendering. Callers pass semantic
 * data only — this component owns all presentation decisions.
 *
 * Consumers: OperationalAlertsCard (density="compact"), RevenueCenterCard
 * (density="default").
 *
 * Typography contract:
 *   label:       compact → text-row; default → text-helper; + density-controlled weight
 *   description: text-helper text-muted-foreground (default density only)
 *   count:       text-row tabular-nums + density-controlled weight
 *   hover:       hover:bg-primary/5
 *   border:      border-b border-card-border (when !isLast)
 *
 * Tone semantics:
 *   default  — label/count text-foreground, hover:bg-primary/5
 *   danger   — label/count text-destructive, row bg-destructive/[0.05] hover:bg-destructive/10
 *              icon color unchanged (caller decides icon color for danger rows)
 *   positive — count text-emerald-700, label text-foreground, neutral hover;
 *              compact count badge bg-emerald-50 (caller provides emerald icon color)
 *   muted    — label/count/icon text-muted-foreground, icon opacity reduced,
 *              button disabled, cursor-default, no hover bg
 *
 * Density semantics:
 *   default — px-4 py-2, gap-3, h-3.5 w-3.5 icon, font-semibold label, font-bold count
 *             layout: (icon + label + description) | (count + chevron)
 *   compact — px-4 py-2, gap-3, h-3.5 w-3.5 icon, font-medium label, font-semibold count
 *             layout: icon | label (flex-1) | count badge [chevron]
 */

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DashboardMetricRowTone = "default" | "danger" | "positive" | "muted";
export type DashboardMetricRowDensity = "default" | "compact";

export interface DashboardMetricRowProps {
  icon: React.ComponentType<{ className?: string }>;
  /** Semantic Tailwind color class for the icon, e.g. "text-emerald-600".
   *  Ignored when tone="muted" (renderer applies muted icon color). */
  iconColor: string;
  label: string;
  /** Optional sub-line below the label. Rendered only in density="default". */
  description?: string;
  count: number | string;
  tone?: DashboardMetricRowTone;
  density?: DashboardMetricRowDensity;
  /** Renders a ChevronRight at the trailing edge. Only visible in density="default". */
  showChevron?: boolean;
  /** Click handler. When absent, the button is non-interactive (disabled). */
  onSelect?: () => void;
  /** When true, suppresses the bottom border. */
  isLast?: boolean;
  testId?: string;
}

// ── Density config (renderer-owned, not exported) ────────────────────────────

const DENSITY_CONFIG = {
  default: {
    padding:      "px-4 py-2",
    outerGap:     "gap-3",
    innerGap:     "gap-2.5",
    trailingGap:  "gap-1.5",
    iconSize:     "h-3.5 w-3.5",
    labelWeight:  "font-semibold",
    countWeight:  "font-bold",
  },
  compact: {
    padding:     "px-4 py-2",
    outerGap:    "gap-3",
    innerGap:    "gap-2",
    trailingGap: "gap-1.5",
    iconSize:    "h-3.5 w-3.5",
    labelWeight: "font-medium",
    countWeight: "font-semibold",
  },
} as const;

// ── Component ─────────────────────────────────────────────────────────────────

export function DashboardMetricRow({
  icon: Icon,
  iconColor,
  label,
  description,
  count,
  tone = "default",
  density = "default",
  showChevron = false,
  onSelect,
  isLast = false,
  testId,
}: DashboardMetricRowProps) {
  const d = DENSITY_CONFIG[density];
  const isMuted    = tone === "muted";
  const isDanger   = tone === "danger";
  const isPositive = tone === "positive";

  // Icon class — muted overrides the caller-provided iconColor.
  const iconClass = cn(
    "shrink-0",
    d.iconSize,
    isMuted ? "text-muted-foreground/30" : iconColor,
  );

  // Label color — renderer-owned per tone.
  const labelColor = isDanger ? "text-destructive" : isMuted ? "text-muted-foreground" : "text-foreground";

  // Count color — positive gets emerald; danger gets destructive; muted gets muted.
  const countColor = isDanger ? "text-destructive"
    : isPositive ? "text-emerald-700 dark:text-emerald-400"
    : isMuted ? "text-muted-foreground"
    : "text-foreground";

  // Soft badge background for the compact-density count chip.
  const countBadgeBg = isDanger
    ? "bg-destructive/10"
    : isPositive
      ? "bg-emerald-50 dark:bg-emerald-950/30"
      : "bg-muted/50";

  // Row background — renderer-owned per tone.
  const rowBg = isDanger
    ? "bg-destructive/[0.05] hover:bg-destructive/10"
    : isMuted
      ? "cursor-default"
      : onSelect
        ? "hover:bg-primary/5"
        : "";

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={isMuted || !onSelect}
      data-testid={testId}
      className={cn(
        "w-full flex items-center justify-between text-left transition-colors group",
        d.padding,
        d.outerGap,
        !isLast && "border-b border-card-border",
        rowBg,
      )}
    >
      {density === "default" ? (
        // Default layout: (icon + label/description) | (count + chevron)
        <>
          <div className={cn("flex items-center min-w-0", d.innerGap)}>
            <Icon className={iconClass} />
            <div className="min-w-0">
              <div className={cn("text-helper truncate", d.labelWeight, labelColor)}>
                {label}
              </div>
              {description && (
                <div className="text-helper text-muted-foreground truncate">
                  {description}
                </div>
              )}
            </div>
          </div>
          <div className={cn("flex items-center shrink-0", d.trailingGap)}>
            <span className={cn("text-row tabular-nums", d.countWeight, countColor)}>
              {count}
            </span>
            {showChevron && (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
            )}
          </div>
        </>
      ) : (
        // Compact layout: icon | label (flex-1) | count badge [chevron]
        <>
          <Icon className={iconClass} />
          <span className={cn("flex-1 text-row truncate", d.labelWeight, labelColor)}>
            {label}
          </span>
          <div className={cn("flex items-center shrink-0", d.trailingGap)}>
            <span className={cn(
              "inline-flex items-center justify-center tabular-nums",
              "h-5 min-w-[1.375rem] rounded px-1.5 leading-none",
              "text-xs",
              d.countWeight,
              countBadgeBg,
              countColor,
              isMuted && "opacity-60",
            )}>
              {count}
            </span>
            {showChevron && (
              <ChevronRight className="h-3 w-3 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
            )}
          </div>
        </>
      )}
    </button>
  );
}
