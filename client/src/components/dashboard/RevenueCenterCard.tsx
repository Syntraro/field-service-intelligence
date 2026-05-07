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
  ChevronRight,
  DollarSign,
} from "lucide-react";
import { resolveDashboardNav } from "@/lib/dashboardNavigation";
import {
  CardShell,
  CardShellHeader,
  CardShellTitle,
  CardShellAction,
} from "@/components/ui/card";

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
  icon: React.ElementType;
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
          <CardShellTitle icon={DollarSign} iconColor="text-[#76B054]">
            Revenue Center
          </CardShellTitle>
          {totalCount > 0 && (
            <span className="text-helper text-text-muted tabular-nums shrink-0">
              {totalCount} action{totalCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <CardShellAction>
          <button
            type="button"
            onClick={() => setLocation("/financials")}
            className="text-helper font-semibold text-[#76B054] hover:underline"
            data-testid="revenue-center-view-financial"
          >
            Open financials
          </button>
        </CardShellAction>
      </CardShellHeader>

      <div className="flex-1">
        {isLoading ? (
          <div className="p-4 text-xs text-[#4b5563]">Loading revenue actions…</div>
        ) : visibleRows.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-[#4b5563]">
              No outstanding revenue actions. Everything's invoiced and sent.
            </p>
          </div>
        ) : (
          <ul>
            {visibleRows.map((row, i) => {
              const Icon = row.icon;
              const isLast = i === visibleRows.length - 1;
              return (
                <li key={row.key}>
                  <button
                    type="button"
                    onClick={() => setLocation(row.destination)}
                    data-testid={`revenue-row-${row.key}`}
                    className={`w-full flex items-center justify-between gap-3 px-4 py-2 text-left transition-colors group ${
                      row.urgent && row.count > 0
                        ? "bg-red-50/60 hover:bg-red-50"
                        : "hover:bg-[#F0F5F0]"
                    } ${!isLast ? "border-b border-[#e2e8f0]" : ""}`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon className={`h-3.5 w-3.5 shrink-0 ${row.urgent && row.count > 0 ? "text-red-600" : row.iconColor}`} />
                      <div className="min-w-0">
                        <div className={`text-xs font-semibold truncate ${row.urgent && row.count > 0 ? "text-red-600" : "text-[#111827]"}`}>
                          {row.label}
                        </div>
                        <div className="text-helper text-[#6b7280] truncate">
                          {row.description}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`text-sm font-bold tabular-nums ${row.urgent && row.count > 0 ? "text-red-600" : "text-[#111827]"}`}>
                        {row.count}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-[#94a3b8] group-hover:text-[#111827] transition-colors" />
                    </div>
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
