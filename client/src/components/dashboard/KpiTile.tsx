/**
 * KpiTile — canonical renderer for standalone KPI stat tiles (2026-05-09).
 *
 * Single source of truth for top-of-page at-a-glance stat tiles.
 * Callers supply label, value, icon metadata, and optional tone/interactivity.
 * All typography, spacing, chrome, and tone mapping live here exclusively.
 *
 * Typography (Phase S1 semantic tokens):
 *   value — text-display leading-none tabular-nums  (32px/700 — "KPI hero")
 *   label — text-helper font-medium uppercase tracking-wide text-muted-foreground
 *   sub   — text-helper text-muted-foreground mt-1
 *
 * Semantic tokens (no hardcoded hex):
 *   bg-card             — KPI tile surface (default, white primary surface)
 *   border-card-border  — card border
 *   text-foreground     — default value color
 *   text-destructive    — danger tone value color
 *   hover:border-primary / focus:ring-primary/40 — interactive states
 *
 * Icon props (iconBg / iconColor) are intentionally per-tile palette utilities.
 * Each tile's icon color IS the domain semantic (revenue=green, A/R=amber, etc.).
 * No app-wide semantic token encodes per-domain icon identity.
 *
 * NOT for:
 *   • Embedded summary stats inside list cards (those are CardShell body stats)
 *   • List-row counts (those are text-sm font-semibold tabular-nums inline)
 *   • Bucket header counts (QuotePipelineCard pattern)
 */

import { type ReactNode } from "react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────

export type KpiTileTone = "default" | "danger" | "warning" | "success" | "info";

export interface KpiTileProps {
  label: string;
  value: ReactNode;
  /** Optional sub-line below the value (count annotation, unit, contextual hint). */
  sub?: ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  /** Tailwind bg utility for the icon block, e.g. "bg-emerald-100 dark:bg-emerald-950/30".
   *  When omitted, the icon renders without a rounded bg block. */
  iconBg?: string;
  /** Tailwind text utility for the icon, e.g. "text-emerald-600". */
  iconColor?: string;
  tone?: KpiTileTone;
  loading?: boolean;
  onClick?: () => void;
  href?: string;
  testId?: string;
}

// ── Tone maps (single canonical source) ──────────────────────────────────

const TONE_CARD_BG: Record<KpiTileTone, string> = {
  default: "bg-card",
  danger:  "bg-destructive/10 dark:bg-destructive/[0.15]",
  warning: "bg-warning/10 dark:bg-warning/[0.15]",
  success: "bg-success/10 dark:bg-success/[0.15]",
  info:    "bg-info/10 dark:bg-info/[0.15]",
};

const TONE_VALUE_COLOR: Record<KpiTileTone, string> = {
  default: "text-foreground",
  danger:  "text-destructive",
  warning: "text-warning-foreground",
  success: "text-success",
  info:    "text-info",
};

// ── Shell chrome constants ────────────────────────────────────────────────

const SHELL_BASE =
  "rounded-md overflow-hidden border border-card-border shadow-card";
const SHELL_INTERACTIVE =
  "hover:border-primary transition-all focus:outline-none focus:ring-2 focus:ring-primary/40";

// ── Component ─────────────────────────────────────────────────────────────

export function KpiTile({
  label,
  value,
  sub,
  icon: Icon,
  iconBg,
  iconColor,
  tone = "default",
  loading,
  onClick,
  href,
  testId,
}: KpiTileProps) {
  const inner = (
    <div className={cn("flex flex-col h-full px-4 py-3", TONE_CARD_BG[tone])}>
      <div className="flex items-center gap-2 mb-2">
        {iconBg ? (
          <div className={cn("p-2 rounded-md", iconBg)}>
            <Icon className={cn("h-3.5 w-3.5", iconColor)} />
          </div>
        ) : (
          <Icon className={cn("h-3.5 w-3.5", iconColor)} />
        )}
        <div className="text-helper font-medium text-muted-foreground uppercase tracking-wide truncate">
          {label}
        </div>
      </div>
      {loading ? (
        <Skeleton className="h-8 w-24" />
      ) : (
        <>
          <div className={cn("text-display leading-none tabular-nums", TONE_VALUE_COLOR[tone])}>
            {value}
          </div>
          {sub && (
            <div className="text-helper text-muted-foreground mt-1 truncate">{sub}</div>
          )}
        </>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href}>
        <a
          className={cn(SHELL_BASE, SHELL_INTERACTIVE, "block")}
          data-testid={testId}
        >
          {inner}
        </a>
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(SHELL_BASE, SHELL_INTERACTIVE, "text-left")}
        data-testid={testId}
      >
        {inner}
      </button>
    );
  }
  return (
    <div className={SHELL_BASE} data-testid={testId}>
      {inner}
    </div>
  );
}
