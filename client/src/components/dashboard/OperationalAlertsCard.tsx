/**
 * OperationalAlertsCard — right-rail triage card for the Operations
 * Dashboard.
 *
 * 2026-04-25 IA correction: Operational Alerts moved out of the top
 * KPI row (which now carries Jobs Ready to Invoice as a glanceable
 * count) and into a functional right-rail card. Each row drives the
 * canonical `<DashboardActionModal>` — same modal the legacy Jobs
 * card opens — keyed by mode. No duplicate alert system.
 *
 * Rows — one mode per row (2026-05-06 normalization):
 *   - Ready to invoice   → mode="ready_to_invoice"
 *   - Past due           → mode="past_due"
 *   - Unscheduled        → mode="unscheduled"
 *   - Requires attention → mode="requires_attention"
 *
 * Card chrome matches the rest of the right-rail stack (header band,
 * iconBg block, hover-green rows). Rows with zero count remain
 * visible but de-emphasized so the card height stays predictable —
 * the user wanted equalized heights across the right column.
 */

import { useRef, useState } from "react";
import {
  AlertTriangle,
  Briefcase,
  Calendar,
  ChevronDown,
  ChevronRight,
  Receipt,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardActionMode } from "@/components/DashboardActionModal";

/**
 * 2026-04-25 (Financial Dashboard layout refinement): row keys are now
 * a public union so callers can override row order via the `order` prop
 * without forking this component. The Operations Dashboard does NOT
 * pass `order` and continues to render the historical sequence.
 */
export type OperationalAlertRowKey =
  | "ready_to_invoice"
  | "past_due"
  | "unscheduled"
  | "requires_attention";

interface OperationalAlertsCardProps {
  readyToInvoiceCount: number;
  pastDueCount: number;
  unscheduledCount: number;
  requiresAttentionCount: number;
  isLoading?: boolean;
  /** Same handler the top KPI tile + Jobs card use — single modal instance. */
  onOpenActionModal: (mode: DashboardActionMode) => void;
  /**
   * Optional row order. When omitted, falls back to the historical
   * ["ready_to_invoice", "past_due", "unscheduled", "requires_attention"].
   * Unknown keys are ignored; missing keys are dropped.
   */
  order?: OperationalAlertRowKey[];
}

interface AlertRow {
  key: OperationalAlertRowKey;
  label: string;
  count: number;
  icon: React.ElementType;
  iconColor: string;
  mode: DashboardActionMode;
  urgent?: boolean;
}

const DEFAULT_ALERT_ORDER: OperationalAlertRowKey[] = [
  "ready_to_invoice",
  "past_due",
  "unscheduled",
  "requires_attention",
];

export function OperationalAlertsCard({
  readyToInvoiceCount,
  pastDueCount,
  unscheduledCount,
  requiresAttentionCount,
  isLoading,
  onOpenActionModal,
  order,
}: OperationalAlertsCardProps) {
  const rowsByKey: Record<OperationalAlertRowKey, AlertRow> = {
    ready_to_invoice: {
      key: "ready_to_invoice",
      label: "Ready to invoice",
      count: readyToInvoiceCount,
      icon: Receipt,
      iconColor: "text-emerald-600",
      mode: "ready_to_invoice",
    },
    past_due: {
      key: "past_due",
      label: "Past due",
      count: pastDueCount,
      icon: AlertTriangle,
      iconColor: "text-red-600",
      mode: "past_due",
      urgent: pastDueCount > 0,
    },
    unscheduled: {
      key: "unscheduled",
      label: "Unscheduled",
      count: unscheduledCount,
      icon: Calendar,
      iconColor: "text-amber-600",
      mode: "unscheduled",
    },
    requires_attention: {
      key: "requires_attention",
      label: "Requires attention",
      count: requiresAttentionCount,
      icon: Briefcase,
      iconColor: "text-blue-600",
      mode: "requires_attention",
      urgent: requiresAttentionCount > 0,
    },
  };

  const rows: AlertRow[] = (order ?? DEFAULT_ALERT_ORDER)
    .map((k) => rowsByKey[k])
    .filter((r): r is AlertRow => Boolean(r));

  // 2026-04-30 collapsible behavior. The card auto-collapses when there
  // are zero alerts — empty triage is signal noise on a glance dashboard.
  // Once the user toggles the chevron, their preference sticks for the
  // session and the auto-rule no longer applies (no fight between user
  // intent and incoming SSE updates).
  const totalCount =
    readyToInvoiceCount + pastDueCount + unscheduledCount + requiresAttentionCount;
  const hasAlerts = totalCount > 0;
  const userToggledRef = useRef(false);
  const [manualCollapsed, setManualCollapsed] = useState(false);
  const autoCollapsed = !isLoading && !hasAlerts;
  const isCollapsed = userToggledRef.current ? manualCollapsed : autoCollapsed;

  const handleToggle = () => {
    const next = !isCollapsed;
    userToggledRef.current = true;
    setManualCollapsed(next);
  };

  // Badge severity:
  //   • Requires attention > 0 → red.
  //   • Else past due > 0      → orange.
  //   • Else                   → neutral slate.
  const badgeColor =
    requiresAttentionCount > 0
      ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
      : pastDueCount > 0
        ? "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"
        : "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300";

  // Outer width is responsive AND state-driven so the parent grid's
  // `auto` column tracks the card. Below `xl` (< 1280 px): always
  // full-width and rail-suppressed — the parent grid stacks at the
  // same breakpoint so the card flows naturally beneath the schedule.
  // At `xl+`: 360 px expanded, 48 px collapsed (the rail). The
  // conditional render below hides the full layout at `xl+` when
  // collapsed and hides the rail entirely below `xl`, so the user
  // only ever sees one variant per viewport.
  // 2026-04-30 (responsive pass) — breakpoint moved from `lg` to `xl`
  // to stay in lockstep with the FinancialDashboard top row's grid
  // template. At narrower widths the schedule was getting cramped
  // because the 360 px alerts rail co-existed with 4×220 px tech
  // columns — the new breakpoint stacks earlier so neither card has
  // to compete for horizontal room.
  const outerWidth = isCollapsed
    ? "w-full xl:w-12"
    : "w-full xl:w-[360px]";

  return (
    <div
      className={`bg-white dark:bg-gray-900 rounded-md overflow-hidden border border-[#e2e8f0] dark:border-gray-700 ${outerWidth}`}
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
      data-testid="card-operational-alerts"
    >
      {/*
        Full-card / header-only variant. Always rendered below `xl`;
        rendered at `xl+` only when expanded. Layout responds to
        `isCollapsed`:
          • !isCollapsed → header bar + body (standard full card).
          • isCollapsed at `< xl` → header-only bar (body branch
            omitted). This is the regression fix: previously the body
            kept rendering below `xl` when `isCollapsed` was true, so
            clicking the chevron flipped state but didn't change what
            the user saw. Now collapse always produces a meaningful
            visible state at every viewport.
          • isCollapsed at `xl+` → entire variant hidden by `xl:hidden`;
            the rail variant below takes over.

        The chevron is dual: `<ChevronDown>` below `xl` rotates with
        `isCollapsed` (down = expand body, up = collapse body);
        `<ChevronRight>` at `xl+` indicates horizontal collapse to the
        rail. CSS responsive classes show one and hide the other so the
        affordance always matches the collapse direction the click
        actually triggers.
      */}
      <div className={isCollapsed ? "xl:hidden" : "block"}>
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={!isCollapsed}
          aria-controls="operational-alerts-body"
          data-testid="operational-alerts-toggle"
          className={`w-full px-4 py-2.5 flex items-center justify-between text-left transition-colors hover:bg-[#FAFAF7] ${
            !isCollapsed ? "border-b border-[#e2e8f0] dark:border-gray-600" : ""
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded-md bg-orange-100 dark:bg-orange-950/30 shrink-0">
              <AlertTriangle className="h-3.5 w-3.5 text-orange-600" />
            </div>
            <h3 className="text-sm font-semibold text-[#111827] dark:text-gray-100 truncate">
              Operational alerts
            </h3>
            {!isLoading && (
              <span
                className={`text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full shrink-0 ${badgeColor}`}
                data-testid="operational-alerts-count-badge"
              >
                {totalCount}
              </span>
            )}
          </div>
          {/* Stacked-mode chevron: down = expand body, up = collapse body. */}
          <ChevronDown
            className={`h-4 w-4 text-slate-400 shrink-0 xl:hidden transition-transform ${
              isCollapsed ? "" : "rotate-180"
            }`}
          />
          {/* Side-by-side chevron: rightward indicates "collapse to rail".
              Only visible at `xl+`; at `xl+` collapsed, the entire
              variant is hidden by the parent's `xl:hidden`, so this
              chevron is effectively only seen at `xl+ expanded`. */}
          <ChevronRight className="h-4 w-4 text-slate-400 shrink-0 hidden xl:block" />
        </button>
        {!isCollapsed && (
        <div id="operational-alerts-body">
          {isLoading ? (
            <div className="px-4 py-3 space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : (
            <ul>
              {rows.map((row, idx) => {
                const isLast = idx === rows.length - 1;
                const Icon = row.icon;
                const muted = row.count === 0;
                return (
                  <li key={row.key}>
                    {/*
                      2026-04-30 micro-polish: row geometry mirrors
                      `<RevenueCenterFinancialCard>` exactly —
                      `px-3 py-1.5 gap-2`, `h-3 w-3` icon, label
                      `text-xs font-medium`, count
                      `text-sm font-semibold tabular-nums`. The trailing
                      chevron + the dependent `group` /
                      `group-hover:` class were dropped so the count
                      right-aligns flush to the row edge, matching the
                      Revenue card's right edge. Click affordance comes
                      from the hover background alone, same as Revenue.
                    */}
                    <button
                      type="button"
                      onClick={() => onOpenActionModal(row.mode)}
                      data-testid={`alert-row-${row.key}`}
                      disabled={muted}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                        !isLast ? "border-b border-[#e2e8f0]" : ""
                      } ${
                        row.urgent
                          ? "bg-red-50/40 hover:bg-red-50"
                          : muted
                            ? "cursor-default"
                            : "hover:bg-[#F0F5F0]"
                      }`}
                    >
                      <Icon
                        className={`h-3 w-3 shrink-0 ${
                          muted ? "text-slate-300" : row.iconColor
                        }`}
                      />
                      <span
                        className={`flex-1 text-xs font-medium truncate ${
                          muted
                            ? "text-slate-400"
                            : row.urgent
                              ? "text-red-700"
                              : "text-slate-700 dark:text-gray-200"
                        }`}
                      >
                        {row.label}
                      </span>
                      <span
                        className={`text-sm font-semibold tabular-nums shrink-0 ${
                          muted
                            ? "text-slate-400"
                            : row.urgent
                              ? "text-red-700"
                              : "text-[#111827] dark:text-gray-100"
                        }`}
                      >
                        {row.count}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        )}
      </div>

      {/* Rail — only shown at `xl+` when collapsed. Single button fills
          the grid cell vertically (cell stretches to match Today's
          Schedule height by default), distributing icon + count badge
          + vertical "Alerts" label + expand chevron from top to
          bottom. Click anywhere on the rail to expand. Below `xl` the
          parent grid stacks and the full-card variant takes over —
          this rail variant never renders. */}
      <div className={isCollapsed ? "hidden xl:flex h-full" : "hidden"}>
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={false}
          aria-controls="operational-alerts-body"
          aria-label="Expand operational alerts"
          data-testid="operational-alerts-toggle-collapsed"
          className="w-full h-full min-h-[140px] flex flex-col items-center justify-between gap-3 px-2 py-3 hover:bg-[#FAFAF7] transition-colors"
        >
          <div className="flex flex-col items-center gap-2">
            <div className="p-1.5 rounded-md bg-orange-100 dark:bg-orange-950/30 shrink-0">
              <AlertTriangle className="h-3.5 w-3.5 text-orange-600" />
            </div>
            {!isLoading && (
              <span
                className={`text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full ${badgeColor}`}
                data-testid="operational-alerts-count-badge-collapsed"
              >
                {totalCount}
              </span>
            )}
          </div>
          <span
            className="text-[10px] font-bold uppercase tracking-wider text-slate-500"
            style={{ writingMode: "vertical-rl" }}
          >
            Alerts
          </span>
          {/* Chevron points left (rotate-180) — clicking expands the
              card back to the left, restoring its full-card layout. */}
          <ChevronRight className="h-4 w-4 text-slate-400 rotate-180 shrink-0" />
        </button>
      </div>
    </div>
  );
}
