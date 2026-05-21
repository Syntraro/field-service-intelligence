/**
 * OperationalAlertsCard — grouped operational command-center widget on the
 * customizable Financial Dashboard.
 *
 * 2026-05-07 RALPH: mounted exclusively from DashboardWidgetGrid in a
 * 1/3-width × 300px-tall cell. Fills its cell (w-full h-full) so its visual
 * height matches every other dashboard widget.
 *
 * 2026-05-16 structural refinement:
 *   - Flat row list replaced by two grouped sections — REVENUE and SCHEDULING —
 *     using canonical SectionLabel (text-label token) headers.
 *   - Row tones updated: ready_to_invoice → "positive"; requires_attention
 *     reclassified from "danger" to "default" (WARNING tier, amber icon).
 *   - Compact rows now render count badge + chevron via DashboardMetricRow.
 *   - Empty state replaced with a structured "Pipeline clear" panel.
 *   - `order` prop removed; section grouping owns row order.
 */

import {
  AlertTriangle,
  Briefcase,
  Calendar,
  CheckCircle2,
  FileText,
  Receipt,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CardShell,
  CardShellHeader,
  CardShellTitle,
  CardShellAction,
} from "@/components/ui/card";
import { StatusChip } from "@/components/ui/chip";
import { SectionLabel } from "@/components/ui/typography";
import type { ChipTone } from "@/lib/chipVariants";
import type { DashboardActionMode } from "@/components/DashboardActionModal";
import {
  DashboardMetricRow,
  type DashboardMetricRowTone,
} from "@/components/dashboard/DashboardMetricRow";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OperationalAlertsCardProps {
  readyToInvoiceCount: number;
  pastDueCount: number;
  unscheduledCount: number;
  requiresAttentionCount: number;
  /**
   * Count of draft invoices waiting to be sent. Absorbed from the retired
   * Needs Attention card (2026-05-07). Optional — renders muted at 0 when omitted.
   */
  invoicesNotSentCount?: number;
  isLoading?: boolean;
  onOpenActionModal: (mode: DashboardActionMode) => void;
}

interface AlertRow {
  key: string;
  label: string;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  mode: DashboardActionMode;
  tone: DashboardMetricRowTone;
}

interface AlertSection {
  key: string;
  label: string;
  rows: AlertRow[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OperationalAlertsCard({
  readyToInvoiceCount,
  pastDueCount,
  unscheduledCount,
  requiresAttentionCount,
  invoicesNotSentCount = 0,
  isLoading,
  onOpenActionModal,
}: OperationalAlertsCardProps) {
  const sections: AlertSection[] = [
    {
      key: "revenue",
      label: "Revenue",
      rows: [
        {
          key: "past_due",
          label: "Past due invoices",
          count: pastDueCount,
          icon: AlertTriangle,
          iconColor: "text-red-600",
          mode: "past_due",
          tone: pastDueCount > 0 ? "danger" : "muted",
        },
        {
          key: "invoices_not_sent",
          label: "Invoices not sent",
          count: invoicesNotSentCount,
          icon: FileText,
          iconColor: "text-slate-500",
          mode: "invoices_not_sent",
          tone: invoicesNotSentCount > 0 ? "default" : "muted",
        },
        {
          key: "ready_to_invoice",
          label: "Ready to invoice",
          count: readyToInvoiceCount,
          icon: Receipt,
          iconColor: "text-emerald-600",
          mode: "ready_to_invoice",
          tone: readyToInvoiceCount > 0 ? "positive" : "muted",
        },
      ],
    },
    {
      key: "scheduling",
      label: "Scheduling",
      rows: [
        {
          key: "unscheduled",
          label: "Unscheduled visits",
          count: unscheduledCount,
          icon: Calendar,
          iconColor: "text-amber-500",
          mode: "unscheduled",
          tone: unscheduledCount > 0 ? "default" : "muted",
        },
        {
          key: "requires_attention",
          label: "Requires attention",
          count: requiresAttentionCount,
          icon: Briefcase,
          iconColor: "text-amber-600",
          mode: "requires_attention",
          tone: requiresAttentionCount > 0 ? "default" : "muted",
        },
      ],
    },
  ];

  const totalCount =
    pastDueCount + invoicesNotSentCount + readyToInvoiceCount +
    unscheduledCount + requiresAttentionCount;

  // Header badge severity — unchanged from pre-2026-05-16 logic.
  const badgeTone: ChipTone =
    requiresAttentionCount > 0
      ? "danger"
      : pastDueCount > 0
        ? "warning"
        : "neutral";

  return (
    <CardShell
      className="w-full h-full flex flex-col"
      data-testid="card-operational-alerts"
    >
      <CardShellHeader data-testid="operational-alerts-header">
        <CardShellTitle
          icon={AlertTriangle}
          iconColor="text-orange-600"
          iconBg="bg-orange-100 dark:bg-orange-950/30"
        >
          Operational alerts
        </CardShellTitle>
        {!isLoading && (
          <CardShellAction>
            <StatusChip
              tone={badgeTone}
              className="tabular-nums shrink-0"
              data-testid="operational-alerts-count-badge"
            >
              {totalCount}
            </StatusChip>
          </CardShellAction>
        )}
      </CardShellHeader>

      <div
        id="operational-alerts-body"
        className="flex-1 min-h-0 overflow-y-auto"
      >
        {isLoading ? (
          <div className="px-4 py-3 space-y-2.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : totalCount === 0 ? (
          // All categories clear — structured empty state.
          <div className="flex flex-col items-center justify-center min-h-[180px] h-full py-10 px-6 text-center">
            <div className="h-9 w-9 rounded-full bg-emerald-50 dark:bg-emerald-950/25 flex items-center justify-center mb-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>
            <p className="text-row font-semibold text-foreground mb-1">Pipeline clear</p>
            <p className="text-helper text-muted-foreground">
              No actions currently blocking workflow.
            </p>
          </div>
        ) : (
          // Grouped operational sections.
          sections.map((section, sectionIdx) => (
            <div key={section.key}>
              {sectionIdx > 0 && (
                <div className="mx-4 border-t border-card-border/60" />
              )}
              <div className={cn("px-4 pb-2", sectionIdx === 0 ? "pt-3" : "pt-4")}>
                <SectionLabel>{section.label}</SectionLabel>
              </div>
              <ul>
                {section.rows.map((row, rowIdx) => (
                  <li key={row.key}>
                    <DashboardMetricRow
                      icon={row.icon}
                      iconColor={row.iconColor}
                      label={row.label}
                      count={row.count}
                      tone={row.tone}
                      density="compact"
                      showChevron
                      onSelect={() => onOpenActionModal(row.mode)}
                      isLast={rowIdx === section.rows.length - 1}
                      testId={`alert-row-${row.key}`}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </CardShell>
  );
}
