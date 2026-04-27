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
 * Rows (per spec):
 *   - Ready to invoice   → mode="ready_to_invoice"
 *   - Past due           → mode="scheduling_issues"
 *   - Unscheduled        → mode="scheduling_issues"
 *   - Requires attention → mode="action_required"
 *
 * Card chrome matches the rest of the right-rail stack (header band,
 * iconBg block, hover-green rows). Rows with zero count remain
 * visible but de-emphasized so the card height stays predictable —
 * the user wanted equalized heights across the right column.
 */

import { Link } from "wouter";
import {
  AlertTriangle,
  Briefcase,
  Calendar,
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
      mode: "scheduling_issues",
      urgent: pastDueCount > 0,
    },
    unscheduled: {
      key: "unscheduled",
      label: "Unscheduled",
      count: unscheduledCount,
      icon: Calendar,
      iconColor: "text-amber-600",
      mode: "scheduling_issues",
    },
    requires_attention: {
      key: "requires_attention",
      label: "Requires attention",
      count: requiresAttentionCount,
      icon: Briefcase,
      iconColor: "text-blue-600",
      mode: "action_required",
      urgent: requiresAttentionCount > 0,
    },
  };

  const rows: AlertRow[] = (order ?? DEFAULT_ALERT_ORDER)
    .map((k) => rowsByKey[k])
    .filter((r): r is AlertRow => Boolean(r));

  return (
    <div
      className="bg-white dark:bg-gray-900 rounded-md overflow-hidden border border-[#e2e8f0] dark:border-gray-700"
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
      data-testid="card-operational-alerts"
    >
      <div className="px-4 py-2.5 border-b border-[#e2e8f0] dark:border-gray-600 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-md bg-orange-100 dark:bg-orange-950/30 shrink-0">
            <AlertTriangle className="h-3.5 w-3.5 text-orange-600" />
          </div>
          <h3 className="text-sm font-semibold text-[#111827] dark:text-gray-100 truncate">
            Operational alerts
          </h3>
        </div>
      </div>
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
                <button
                  type="button"
                  onClick={() => onOpenActionModal(row.mode)}
                  data-testid={`alert-row-${row.key}`}
                  disabled={muted}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors group ${
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
                    className={`h-3.5 w-3.5 shrink-0 ${
                      muted ? "text-slate-300" : row.iconColor
                    }`}
                  />
                  <span
                    className={`flex-1 text-sm ${
                      muted
                        ? "text-slate-400"
                        : row.urgent
                          ? "text-red-700 font-medium"
                          : "text-[#111827] dark:text-gray-100"
                    }`}
                  >
                    {row.label}
                  </span>
                  <span
                    className={`tabular-nums font-semibold ${
                      muted
                        ? "text-slate-400"
                        : row.urgent
                          ? "text-red-700"
                          : "text-[#111827] dark:text-gray-100"
                    }`}
                  >
                    {row.count}
                  </span>
                  {!muted && (
                    <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-[#111827] transition-colors shrink-0" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
