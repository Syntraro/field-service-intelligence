/**
 * RevenueCenterCard — stacked list of money-related follow-up rows.
 *
 * Operations-flavored, not accounting — surfaces revenue-leakage work
 * (jobs ready to invoice, drafts sitting, overdue receivables, approved
 * quotes that haven't been converted, unscheduled work). Each row is
 * click-through to the canonical filtered list.
 *
 * 2026-04-22 — created for the Operations Dashboard upgrade. Pulls from
 * the extended `/api/dashboard/workflow` response; no new endpoints.
 *
 * Rows with zero count are hidden. If every row is zero, the card shows
 * a compact positive empty state instead of padding with dead counters.
 */

import { useLocation } from "wouter";
import {
  Receipt,
  FileEdit,
  AlertOctagon,
  CheckCircle2,
  Calendar,
  DollarSign,
} from "lucide-react";
import { resolveDashboardNav } from "@/lib/dashboardNavigation";
import {
  CardShell,
  CardShellHeader,
  CardShellTitle,
  CardShellAction,
} from "@/components/ui/card";
import { DashboardMetricRow } from "@/components/dashboard/DashboardMetricRow";

interface RevenueCenterCardProps {
  readyToInvoiceCount: number;
  draftInvoiceCount: number;
  overdueInvoiceCount: number;
  approvedQuotesNotConvertedCount: number;
  unscheduledCount: number;
  isLoading?: boolean;
  className?: string;
}

interface RevenueRow {
  key: string;
  label: string;
  description: string;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  destination: string;
  urgent?: boolean;
}

export function RevenueCenterCard({
  readyToInvoiceCount,
  draftInvoiceCount,
  overdueInvoiceCount,
  approvedQuotesNotConvertedCount,
  unscheduledCount,
  isLoading,
  className = "",
}: RevenueCenterCardProps) {
  const [, setLocation] = useLocation();

  const rows: RevenueRow[] = [
    {
      key: "ready-to-invoice",
      label: "Jobs ready to invoice",
      description: "Completed jobs not yet billed",
      count: readyToInvoiceCount,
      icon: Receipt,
      iconColor: "text-emerald-600",
      destination: resolveDashboardNav("jobs.needsInvoicing"),
    },
    {
      key: "draft-invoices",
      label: "Draft invoices",
      description: "Invoices waiting to be sent",
      count: draftInvoiceCount,
      icon: FileEdit,
      iconColor: "text-slate-600",
      destination: resolveDashboardNav("invoices.draft"),
    },
    {
      key: "overdue-invoices",
      label: "Overdue invoices",
      description: "Past due — collect payment",
      count: overdueInvoiceCount,
      icon: AlertOctagon,
      iconColor: "text-red-600",
      destination: resolveDashboardNav("invoices.pastDue"),
      urgent: true,
    },
    {
      key: "approved-not-converted",
      label: "Approved quotes · not converted",
      description: "Approved and ready to become jobs",
      count: approvedQuotesNotConvertedCount,
      icon: CheckCircle2,
      iconColor: "text-teal-600",
      destination: resolveDashboardNav("pipeline.approvedNotConverted"),
    },
    {
      key: "unscheduled-work",
      label: "Unscheduled approved work",
      description: "Open jobs without a date",
      count: unscheduledCount,
      icon: Calendar,
      iconColor: "text-amber-600",
      destination: resolveDashboardNav("jobs.unscheduled"),
    },
  ];

  const visibleRows = rows.filter((r) => r.count > 0);
  const totalCount = visibleRows.reduce((acc, r) => acc + r.count, 0);

  // 2026-05-07 Card canonicalization (Tier 1): outer chrome + header band
  // routed through CardShell + CardShellHeader. Row internals (icon +
  // label + description + count + chevron) intentionally untouched.
  return (
    <CardShell
      className={`flex flex-col ${className}`}
      data-testid="revenue-center-card"
    >
      <CardShellHeader>
        <div className="flex items-center gap-2 min-w-0">
          <CardShellTitle icon={DollarSign} iconColor="text-primary">
            Revenue Center
          </CardShellTitle>
          {totalCount > 0 && (
            <span className="text-helper text-muted-foreground tabular-nums shrink-0">
              {totalCount} action{totalCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <CardShellAction>
          <button
            type="button"
            onClick={() => setLocation("/financials")}
            className="text-helper font-semibold text-primary hover:underline"
            data-testid="revenue-center-view-financial"
          >
            Open financials
          </button>
        </CardShellAction>
      </CardShellHeader>

      <div className="flex-1">
        {isLoading ? (
          <div className="p-4 text-helper text-muted-foreground">Loading revenue actions…</div>
        ) : visibleRows.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <p className="text-helper text-muted-foreground">
              No outstanding revenue actions. Everything's invoiced and sent.
            </p>
          </div>
        ) : (
          <ul>
            {visibleRows.map((row, i) => {
              const isLast = i === visibleRows.length - 1;
              return (
                <li key={row.key}>
                  <DashboardMetricRow
                    icon={row.icon}
                    iconColor={row.iconColor}
                    label={row.label}
                    description={row.description}
                    count={row.count}
                    tone={row.urgent ? "danger" : "default"}
                    density="default"
                    showChevron
                    onSelect={() => setLocation(row.destination)}
                    isLast={isLast}
                    testId={`revenue-row-${row.key}`}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </CardShell>
  );
}
