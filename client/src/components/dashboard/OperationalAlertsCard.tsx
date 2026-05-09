/**
 * OperationalAlertsCard — triage card on the customizable Financial
 * Dashboard.
 *
 * 2026-05-07 RALPH: this card is now mounted exclusively from
 * `DashboardWidgetGrid` and lives inside a 1/3-width × 300 px-tall
 * grid cell. It fills its cell (`w-full h-full`) so its visual
 * height matches every other dashboard widget. The previous
 * "right-rail at xl+" variant (collapsed-to-vertical-strip) was
 * built for the legacy Operations Dashboard side rail, which no
 * longer exists — that branch was deleted with this change. The
 * full-card layout is the only render path now.
 *
 * Rows — one mode per row (2026-05-06 normalization):
 *   - Ready to invoice   → mode="ready_to_invoice"
 *   - Past due           → mode="past_due"
 *   - Unscheduled        → mode="unscheduled"
 *   - Requires attention → mode="requires_attention"
 *   - Invoices not sent  → mode="invoices_not_sent"  (2026-05-07 — absorbed
 *     from the retired Needs Attention card; routed through the same
 *     shared DashboardActionModal. Lower operational urgency, so it
 *     renders at the bottom of the canonical row order.)
 *
 * Card chrome routes through the canonical `<CardShell>`. Rows with
 * zero count remain visible but de-emphasized so the card height
 * stays predictable. Auto-collapse (when total count is zero) and
 * the user-toggle that overrides it are preserved — collapsing now
 * just hides the body within the fixed-height card; the card itself
 * keeps its canonical height.
 */

import {
  AlertTriangle,
  Briefcase,
  Calendar,
  FileText,
  Receipt,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { CardShell } from "@/components/ui/card";
// 2026-05-08 chip Phase 2: severity-tinted count badge → StatusChip.
import { StatusChip } from "@/components/ui/chip";
import type { ChipTone } from "@/lib/chipVariants";
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
  | "requires_attention"
  | "invoices_not_sent";

interface OperationalAlertsCardProps {
  readyToInvoiceCount: number;
  pastDueCount: number;
  unscheduledCount: number;
  requiresAttentionCount: number;
  /**
   * 2026-05-07: count of draft invoices waiting to be sent. Absorbed
   * from the retired Needs Attention card. Optional so callers that
   * don't have the financial-summary query in scope can omit it (the
   * row simply renders muted at 0).
   */
  invoicesNotSentCount?: number;
  isLoading?: boolean;
  /** Same handler the top KPI tile + Jobs card use — single modal instance. */
  onOpenActionModal: (mode: DashboardActionMode) => void;
  /**
   * Optional row order. When omitted, falls back to the historical
   * ["ready_to_invoice", "past_due", "unscheduled", "requires_attention",
   * "invoices_not_sent"]. Unknown keys are ignored; missing keys are
   * dropped.
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
  "invoices_not_sent",
];

export function OperationalAlertsCard({
  readyToInvoiceCount,
  pastDueCount,
  unscheduledCount,
  requiresAttentionCount,
  invoicesNotSentCount = 0,
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
    // 2026-05-07: absorbed from the retired Needs Attention card.
    // Lower operational urgency than scheduling/dispatch issues, so it
    // sits at the bottom of the canonical order. Slate icon (not red /
    // amber) signals "billing inbox" rather than "field operations
    // needs help right now".
    invoices_not_sent: {
      key: "invoices_not_sent",
      label: "Invoices not sent",
      count: invoicesNotSentCount,
      icon: FileText,
      iconColor: "text-slate-500",
      mode: "invoices_not_sent",
    },
  };

  const rows: AlertRow[] = (order ?? DEFAULT_ALERT_ORDER)
    .map((k) => rowsByKey[k])
    .filter((r): r is AlertRow => Boolean(r));

  const totalCount =
    readyToInvoiceCount + pastDueCount + unscheduledCount + requiresAttentionCount + invoicesNotSentCount;

  // Badge severity → canonical StatusChip tone:
  //   • Requires attention > 0 → danger (red soft-tint).
  //   • Else past due > 0      → warning (amber soft-tint, replaces
  //                              the orange tint — semantic match).
  //   • Else                   → neutral slate.
  const badgeTone: ChipTone =
    requiresAttentionCount > 0
      ? "danger"
      : pastDueCount > 0
        ? "warning"
        : "neutral";

  // 2026-05-07 RALPH (height fix):
  //   • `w-full h-full` lets the card fill the dashboard grid cell
  //     (which owns the canonical `h-[300px]` height + `col-span-*`
  //     width). The previous `xl:w-[360px]` constraint forced the
  //     card to a fixed 360 px wide regardless of cell width, leaving
  //     trailing whitespace inside the cell at xl+; the previous
  //     content-sized height made it shorter than its peers.
  //   • `flex flex-col` so the body region can flex-1 + scroll the
  //     overflow if a future row count exceeds the card height.
  //   • The legacy "rail at xl+" variant (vertical-strip collapsed
  //     mode for the old Operations Dashboard right rail) is gone —
  //     this card has only one consumer today (FinancialDashboard,
  //     mounted via DashboardWidgetGrid), and the rail variant did
  //     not fit the 1/3-width grid cell model.
  return (
    <CardShell
      className="w-full h-full flex flex-col"
      data-testid="card-operational-alerts"
    >
      <div
        className="w-full px-4 py-2.5 flex items-center gap-2 shrink-0 border-b border-card-border"
        data-testid="operational-alerts-header"
      >
        <div className="p-1.5 rounded-md bg-orange-100 dark:bg-orange-950/30 shrink-0">
          <AlertTriangle className="h-3.5 w-3.5 text-orange-600" />
        </div>
        <h3 className="text-sm font-semibold text-[#111827] dark:text-gray-100 truncate">
          Operational alerts
        </h3>
        {!isLoading && (
          <StatusChip
            tone={badgeTone}
            className="tabular-nums shrink-0"
            data-testid="operational-alerts-count-badge"
          >
            {totalCount}
          </StatusChip>
        )}
      </div>
      <div
        id="operational-alerts-body"
        className="flex-1 min-h-0 overflow-y-auto"
      >
          {isLoading ? (
            <div className="px-4 py-3 space-y-2">
              {/* 2026-05-07: 5 skeleton rows match the canonical row count
                  after Needs Attention's "Invoices not sent" row was
                  absorbed into this card. */}
              {[0, 1, 2, 3, 4].map((i) => (
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
                      `text-sm font-semibold tabular-nums`. Click
                      affordance comes from the hover background, same
                      as Revenue.
                    */}
                    <button
                      type="button"
                      onClick={() => onOpenActionModal(row.mode)}
                      data-testid={`alert-row-${row.key}`}
                      disabled={muted}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                        !isLast ? "border-b border-card-border" : ""
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
    </CardShell>
  );
}
