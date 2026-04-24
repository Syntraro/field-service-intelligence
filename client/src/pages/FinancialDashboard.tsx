/**
 * Financial Dashboard — Solo / Owner-Operator command center.
 *
 * 2026-04-21: Canonical sibling to the Operations Dashboard. Every metric
 * comes from `GET /api/dashboard/financial` (server/storage/dashboard.ts:
 * getFinancialSummary) — zero mock data, zero client-side aggregation.
 *
 * 2026-04-23 (Solo layout): this tab is the owner-operator / small-team
 * view. Operations stays team-focused (TodaysOperationsCard workload rail
 * + PM / Quotes / Revenue cards). Financial is now:
 *   • 4-KPI strip: Revenue This Month, Outstanding A/R, Overdue Invoices,
 *     Ready to Invoice.
 *   • Left 2/3 — Today's Schedule (chronological, canonical
 *     `/api/dashboard/capacity`; click a booked block → canonical
 *     VisitEditorLauncher; click open slot or + Add Job → canonical
 *     SlotQuickCreateLauncher). Scope filter (All team / per-tech) keeps
 *     it usable on small teams.
 *   • Right 1/3 — stacked cards: Top Outstanding Invoices, Top Customers
 *     Owing (renamed from Top Customer Balances), Recent Payments.
 *
 * Link map — every clickable element routes to a canonical filtered list:
 *   Outstanding A/R     → /invoices?filter=awaiting_payment
 *   Overdue Invoices    → /invoices?filter=overdue
 *   Ready to Invoice    → /jobs?readyToInvoiceOnly=true
 *   Invoice rows        → /invoices/:id
 *   Customer rows       → /clients/:customerCompanyId
 *
 * NOTE: the Operations dashboard is fully decoupled. No shared widgets
 * between tabs — only the DashboardViewToggle is shared.
 */

import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign, AlertCircle, AlertTriangle, Wrench, ChevronRight,
  TrendingUp, Users, Receipt, Calendar as CalendarIcon, Plus,
  CreditCard, Clock, Briefcase,
} from "lucide-react";
import { DashboardViewToggle } from "@/components/dashboard/DashboardViewToggle";
import {
  VisitEditorLauncher,
  type VisitEditorState,
} from "@/components/dispatch/VisitEditorLauncher";
import {
  SlotQuickCreateLauncher,
  type QuickCreateSlot,
} from "@/components/dispatch/SlotQuickCreateLauncher";
// 2026-04-23: reuse the canonical Operations alert stack — same AlertRow
// JSX, same DashboardActionModal, same resolveDashboardNav fallback paths.
// See audit 2026-04-23 in TodaysOperationsCard for why AlertRow is a named
// export now instead of a module-local function.
import { AlertRow } from "@/components/TodaysOperationsCard";
import {
  DashboardActionModal,
  type DashboardActionMode,
} from "@/components/DashboardActionModal";
import { resolveDashboardNav } from "@/lib/dashboardNavigation";
// 2026-04-23: canonical trigger+popover shell shared with DispatchFiltersBar
// and TodaysOperationsCard. Generic children — we own what's inside.
import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";
// 2026-04-24: shared adapter that fills in the prop fields the canonical
// Edit Visit modal reads (customerName, jobNumber, locationId, ...) when
// the caller only holds visitId + jobId. Dispatch already passes the full
// payload and hits the adapter's fast-path no-op; the dashboard takes the
// fetch path so its click hydrates the modal identically.
import { enrichVisitEditorState } from "@/lib/visitEditorPayloadBuilder";

// ---------------------------------------------------------------------------
// Types — mirror server/storage/dashboard.ts FinancialSummary
// ---------------------------------------------------------------------------

interface FinancialSummary {
  revenue: { today: number; week: number; month: number; lastMonth: number };
  trend: { month: string; total: number }[];
  ar: {
    outstandingTotal: number;
    outstandingCount: number;
    pastDueTotal: number;
    pastDueCount: number;
    sentThisMonth: number;
    aging: {
      current: number;
      d1_30: number;
      d31_60: number;
      d61_90: number;
      d90plus: number;
    };
  };
  quotes: { sent: number; approved: number; conversionRate: number; avgValue: number; approvedTotal: number };
  pm: { contractCount: number; totalContractValue: number };
  draft: { count: number; total: number };
  pipeline: {
    readyToInvoiceCount: number;
    approvedQuotesNotConvertedCount: number;
  };
  topOutstandingInvoices: {
    id: string;
    invoiceNumber: string | null;
    customerName: string | null;
    locationName: string | null;
    dueDate: string | null;
    balance: number;
    status: string | null;
    daysLate: number | null;
  }[];
  topCustomerBalances: {
    customerCompanyId: string;
    name: string | null;
    outstanding: number;
    overdue: number;
    openCount: number;
  }[];
  draftInvoicesPreview: {
    id: string;
    invoiceNumber: string | null;
    customerName: string | null;
    locationName: string | null;
    total: number;
    createdAt: string | null;
  }[];
  readyToInvoiceJobsPreview: {
    id: string;
    jobNumber: number;
    summary: string | null;
    customerName: string | null;
    locationName: string | null;
    completedAt: string | null;
  }[];
  recentPayments: {
    id: string;
    amount: number;
    method: string | null;
    receivedAt: string | null;
    invoiceId: string;
    invoiceNumber: string | null;
    customerName: string | null;
    locationName: string | null;
  }[];
}

// ---------------------------------------------------------------------------
// Formatting helpers (match Jobs.tsx / Dashboard.tsx conventions)
// ---------------------------------------------------------------------------

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatCurrencyPrecise(amount: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Compact hours duration label for schedule rows. Integer hours → "Nh";
 * fractional → stripped-decimal form ("1.5h", "2.5h", "0.75h"). Replaces
 * the raw "60m" format the card previously used per the 2026-04-23 UX
 * refinement brief.
 */
function formatDurationHours(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0h";
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `${hours}h`;
  return `${hours.toFixed(2).replace(/\.?0+$/, "")}h`;
}

/**
 * 2026-04-23: compact 12-hour clock for the schedule card's time-range
 * gutter — drops the AM/PM suffix so a pair reads as a tight inline range
 * (e.g. "9:00–10:00", "12:00–2:00"). The dashboard shows today's schedule
 * only, so AM/PM disambiguation is implicit. Midnight renders as "12:00",
 * noon as "12:00" too — same convention the tech-app's formatClockTime uses.
 */
function formatClock12Short(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  let h = d.getHours();
  const m = d.getMinutes();
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m.toString().padStart(2, "0")}`;
}

/** Compact 12h time range — "9:00–10:00", used in the schedule-card gutter. */
function formatTimeRange(startISO: string, endISO: string): string {
  return `${formatClock12Short(startISO)}–${formatClock12Short(endISO)}`;
}

// ---------------------------------------------------------------------------
// Shared card primitive — matches Dashboard.tsx DashCard rhythm
// ---------------------------------------------------------------------------

function DashCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`bg-white dark:bg-gray-900 rounded-md overflow-hidden border border-[#e2e8f0] dark:border-gray-700 ${className}`}
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
    >
      {children}
    </div>
  );
}

function CardHeader({ icon: Icon, color, title, action }: {
  icon: React.ElementType;
  color: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-2.5 border-b border-[#e2e8f0] dark:border-gray-600 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        <h3 className="text-sm font-semibold text-[#111827] dark:text-gray-100">{title}</h3>
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI tile
// ---------------------------------------------------------------------------

interface KpiTileProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  warn?: boolean;
  onClick?: () => void;
  testId?: string;
}

function KpiTile({ label, value, sub, icon: Icon, iconColor, iconBg, warn, onClick, testId }: KpiTileProps) {
  const Content = (
    <div className={`flex flex-col h-full px-4 py-3 ${warn ? "bg-red-50/60 dark:bg-red-950/15" : "bg-white dark:bg-gray-900"}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`p-1.5 rounded-md ${iconBg}`}>
          <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
        </div>
        <div className="text-xs font-medium text-slate-500">{label}</div>
      </div>
      <div className={`text-2xl font-bold tabular-nums ${warn ? "text-red-600 dark:text-red-400" : "text-[#111827] dark:text-gray-100"}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="text-left rounded-md overflow-hidden border border-[#e2e8f0] dark:border-gray-700 hover:border-[#76B054] hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-[#76B054]/40"
        style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
        data-testid={testId}
      >
        {Content}
      </button>
    );
  }
  return (
    <div
      className="rounded-md overflow-hidden border border-[#e2e8f0] dark:border-gray-700"
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
      data-testid={testId}
    >
      {Content}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page — Solo / Owner-Operator layout
// ---------------------------------------------------------------------------

export default function FinancialDashboard() {
  const [, setLocation] = useLocation();

  const { data, isLoading, error } = useQuery<FinancialSummary>({
    queryKey: ["dashboard", "financial"],
    queryFn: () => apiRequest<FinancialSummary>("/api/dashboard/financial"),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  // Canonical scheduling launchers — identical mounts to Dashboard.tsx so
  // clicking a schedule block or the "Add Job" button opens the SAME
  // dialogs the rest of the app uses. No forked create/edit flow.
  const [editorState, setEditorState] = useState<VisitEditorState | null>(null);
  const [slot, setSlot] = useState<QuickCreateSlot | null>(null);

  // 2026-04-23: canonical alert modal — same state pattern Dashboard.tsx
  // uses (lines 165–170). Clicking an alert row opens the SAME
  // DashboardActionModal the Operations dashboard opens; counts come from
  // the shared `["dashboard", "workflow"]` query cache.
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [actionModalMode, setActionModalMode] = useState<DashboardActionMode>("action_required");
  const openActionModal = (mode: DashboardActionMode) => {
    setActionModalMode(mode);
    setActionModalOpen(true);
  };
  const handleAlertClick = (mode: DashboardActionMode, fallbackPath: string) => {
    openActionModal(mode);
    // `fallbackPath` is the canonical deep-link URL from resolveDashboardNav;
    // kept for parity with Operations so tests / non-modal contexts behave
    // the same. Unused when the modal opens successfully.
    void fallbackPath;
  };

  // Same canonical workflow summary Operations uses. Shared TanStack
  // Query cache — both dashboards hit the same rowset, a refresh on
  // either tab benefits both.
  const workflowQuery = useQuery<WorkflowSummaryDto>({
    queryKey: ["dashboard", "workflow"],
    queryFn: () => apiRequest<WorkflowSummaryDto>("/api/dashboard/workflow"),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const workflow = workflowQuery.data;
  const actionRequiredCount = workflow?.jobs.onHoldCount ?? 0;
  const pastDueCount = workflow?.jobs.overdueCount ?? 0;
  const unscheduledJobsCount = workflow?.jobs.unscheduledCount ?? 0;
  const readyForInvoiceCount = workflow?.jobs.requiresInvoicingCount ?? 0;

  if (error) {
    return (
      <div className="min-h-screen bg-[#F4F8F4]">
        <main className="mx-auto px-4 sm:px-5 lg:px-6 py-4">
          <div className="p-6 bg-white rounded-md border border-red-200">
            <div className="flex items-center gap-2 text-red-600 mb-2">
              <AlertCircle className="h-4 w-4" />
              <h2 className="font-semibold">Failed to load financial dashboard</h2>
            </div>
            <p className="text-sm text-slate-600">{(error as Error).message}</p>
          </div>
        </main>
      </div>
    );
  }

  const ar = data?.ar;
  const readyCount = data?.pipeline?.readyToInvoiceCount ?? 0;

  return (
    <div className="min-h-screen bg-[#F4F8F4]" data-testid="financial-dashboard-page">
      <main className="mx-auto px-4 sm:px-5 lg:px-6 py-4">
        {/* Header */}
        <div
          className="flex items-center justify-between gap-3 mb-4"
          style={{ borderBottom: "1px solid #e5e7eb", paddingBottom: "8px" }}
        >
          <div>
            <h1 className="text-lg font-semibold text-[#111827] dark:text-gray-100 tracking-tight">
              Business Dashboard
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Today's schedule, outstanding money, and operational alerts — at a glance.
            </p>
          </div>
          <DashboardViewToggle active="financial" />
        </div>

        {/* 4-KPI strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <KpiTile
            label="Revenue This Month"
            value={isLoading ? "—" : formatCurrency(data?.revenue.month ?? 0)}
            sub={
              data && data.revenue.lastMonth > 0
                ? `Last month: ${formatCurrency(data.revenue.lastMonth)}`
                : "Cash basis"
            }
            icon={TrendingUp}
            iconColor="text-emerald-600"
            iconBg="bg-emerald-100 dark:bg-emerald-950/30"
            testId="kpi-revenue-month"
          />
          <KpiTile
            label="Outstanding A/R"
            value={isLoading ? "—" : formatCurrency(ar?.outstandingTotal ?? 0)}
            sub={`${ar?.outstandingCount ?? 0} invoice${ar?.outstandingCount === 1 ? "" : "s"}`}
            icon={DollarSign}
            iconColor="text-amber-600"
            iconBg="bg-amber-100 dark:bg-amber-950/30"
            onClick={() => setLocation("/invoices?filter=awaiting_payment")}
            testId="kpi-outstanding"
          />
          <KpiTile
            label="Overdue Invoices"
            value={isLoading ? "—" : formatCurrency(ar?.pastDueTotal ?? 0)}
            sub={`${ar?.pastDueCount ?? 0} past due`}
            icon={AlertCircle}
            iconColor="text-red-600"
            iconBg="bg-red-100 dark:bg-red-950/30"
            warn={(ar?.pastDueTotal ?? 0) > 0}
            onClick={() => setLocation("/invoices?filter=overdue")}
            testId="kpi-overdue"
          />
          <KpiTile
            label="Ready to Invoice"
            value={isLoading ? "—" : String(readyCount)}
            sub={readyCount === 1 ? "Job awaiting billing" : "Jobs awaiting billing"}
            icon={Wrench}
            iconColor="text-violet-600"
            iconBg="bg-violet-100 dark:bg-violet-950/30"
            onClick={() => setLocation("/jobs?readyToInvoiceOnly=true")}
            testId="kpi-ready-to-invoice"
          />
        </div>

        {/* Main 2:1 grid — schedule on the left takes 2/3, oversight rail on the right. */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Today's Schedule — 2 cols on lg */}
          <div className="lg:col-span-2">
            <TodaysScheduleCard
              onOpenVisit={(visitState) => setEditorState(visitState)}
              onOpenSlot={(s) => setSlot(s)}
            />
          </div>

          {/* Right rail — 4 stacked cards. 2026-04-23 order: alerts first
              (most time-sensitive), then receivables, then recent payments
              at the bottom so cash-in doesn't shout louder than action items. */}
          <div className="space-y-3" data-testid="column-oversight">
            {/* Operational Alerts — reuses the SAME AlertRow + DashboardActionModal
                Operations uses. Click handlers route through the exact same
                `handleAlertClick(mode, fallbackPath)` pattern; counts come from
                the shared ["dashboard", "workflow"] query cache. */}
            <DashCard>
              <CardHeader
                icon={AlertCircle}
                color="text-orange-600"
                title="Operational Alerts"
              />
              <div className="px-2 py-1.5 space-y-0.5" data-testid="business-alerts-rail">
                <AlertRow
                  icon={AlertTriangle}
                  label="Action Required"
                  count={actionRequiredCount}
                  onClick={() =>
                    handleAlertClick("action_required", resolveDashboardNav("ops.onHold"))
                  }
                  urgent={actionRequiredCount > 0}
                />
                <AlertRow
                  icon={Clock}
                  label="Past Due"
                  count={pastDueCount}
                  onClick={() =>
                    handleAlertClick("scheduling_issues", resolveDashboardNav("alerts.overdueJobs"))
                  }
                  urgent={pastDueCount > 0}
                />
                <AlertRow
                  icon={Briefcase}
                  label="Unscheduled"
                  count={unscheduledJobsCount}
                  onClick={() =>
                    handleAlertClick("scheduling_issues", resolveDashboardNav("jobs.unscheduled"))
                  }
                />
                <AlertRow
                  icon={Receipt}
                  label="Ready for Invoice"
                  count={readyForInvoiceCount}
                  onClick={() =>
                    handleAlertClick("ready_to_invoice", resolveDashboardNav("jobs.needsInvoicing"))
                  }
                />
              </div>
            </DashCard>

            {/* Top Outstanding Invoices */}
            <DashCard>
              <CardHeader
                icon={Receipt}
                color="text-amber-600"
                title="Top Outstanding Invoices"
                action={
                  <button
                    type="button"
                    onClick={() => setLocation("/invoices?filter=awaiting_payment")}
                    className="text-xs text-[#76B054] hover:underline"
                    data-testid="link-view-all-invoices"
                  >
                    View all
                  </button>
                }
              />
              <div>
                {isLoading ? (
                  <div className="p-4 space-y-2">
                    {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8" />)}
                  </div>
                ) : !data?.topOutstandingInvoices.length ? (
                  <div className="p-4"><EmptyState message="No outstanding invoices." /></div>
                ) : (
                  <div>
                    {data.topOutstandingInvoices.slice(0, 4).map((inv, idx, arr) => {
                      const isLast = idx === arr.length - 1;
                      const isOverdue = (inv.daysLate ?? 0) > 0;
                      return (
                        <button
                          key={inv.id}
                          type="button"
                          onClick={() => setLocation(`/invoices/${inv.id}`)}
                          className={`w-full text-left px-4 py-2 hover:bg-[#F0F5F0] transition-colors flex items-center gap-3 group ${!isLast ? "border-b border-[#e2e8f0]" : ""}`}
                          data-testid={`top-invoice-${inv.id}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-normal text-[#111827] truncate">
                              {inv.customerName ?? inv.locationName ?? "Unknown customer"}
                            </div>
                            <div className="text-xs text-slate-500 truncate">
                              {inv.invoiceNumber ? `#${inv.invoiceNumber}` : "(no number)"} · Due {formatDate(inv.dueDate)}
                            </div>
                          </div>
                          <div className="text-right whitespace-nowrap">
                            <div className="text-sm font-semibold tabular-nums text-[#111827]">
                              {formatCurrencyPrecise(inv.balance)}
                            </div>
                            {isOverdue && (
                              <div className="text-xs text-red-600 font-medium">
                                {inv.daysLate} day{inv.daysLate === 1 ? "" : "s"} late
                              </div>
                            )}
                          </div>
                          <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-[#111827] transition-colors" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </DashCard>

            {/* Top Customers Owing (renamed from "Top Customer Balances") */}
            <DashCard>
              <CardHeader
                icon={Users}
                color="text-blue-600"
                title="Top Customers Owing"
                action={
                  <button
                    type="button"
                    onClick={() => setLocation("/invoices?filter=awaiting_payment")}
                    className="text-xs text-[#76B054] hover:underline"
                    data-testid="link-view-all-customers-owing"
                  >
                    View all
                  </button>
                }
              />
              <div>
                {isLoading ? (
                  <div className="p-4 space-y-2">
                    {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8" />)}
                  </div>
                ) : !data?.topCustomerBalances.length ? (
                  <div className="p-4"><EmptyState message="No customers with outstanding balances." /></div>
                ) : (
                  <div>
                    <div className="grid grid-cols-12 gap-3 px-4 py-2 text-xs font-medium text-slate-500 border-b border-[#e2e8f0] bg-slate-50/50">
                      <div className="col-span-6">Customer</div>
                      <div className="col-span-2 text-right">Open</div>
                      <div className="col-span-2 text-right">Overdue</div>
                      <div className="col-span-2 text-right">Outstanding</div>
                    </div>
                    {data.topCustomerBalances.slice(0, 4).map((c, idx, arr) => {
                      const isLast = idx === arr.length - 1;
                      return (
                        <button
                          key={c.customerCompanyId}
                          type="button"
                          onClick={() => setLocation(`/clients/${c.customerCompanyId}`)}
                          className={`w-full text-left px-4 py-2 hover:bg-[#F0F5F0] transition-colors grid grid-cols-12 gap-3 items-center group ${!isLast ? "border-b border-[#e2e8f0]" : ""}`}
                          data-testid={`top-customer-${c.customerCompanyId}`}
                        >
                          <div className="col-span-6 text-sm font-normal text-[#111827] truncate">
                            {c.name ?? "Unnamed customer"}
                          </div>
                          <div className="col-span-2 text-right text-sm tabular-nums text-slate-700">
                            {c.openCount}
                          </div>
                          <div className={`col-span-2 text-right text-sm tabular-nums ${c.overdue > 0 ? "text-red-600 font-medium" : "text-slate-500"}`}>
                            {c.overdue > 0 ? formatCurrency(c.overdue) : "—"}
                          </div>
                          <div className="col-span-2 text-right text-sm font-semibold tabular-nums text-[#111827]">
                            {formatCurrency(c.outstanding)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </DashCard>

            {/* Recent Payments */}
            <RecentPaymentsCard
              data={data}
              isLoading={isLoading}
              onOpenInvoice={(id) => setLocation(`/invoices/${id}`)}
            />
          </div>
        </div>
      </main>

      {/* Canonical launchers — identical mounts to Dashboard.tsx. */}
      <VisitEditorLauncher
        state={editorState}
        onClose={() => setEditorState(null)}
      />
      <SlotQuickCreateLauncher
        slot={slot}
        onClose={() => setSlot(null)}
      />
      {/* Canonical alert modal — same one Operations opens. Single modal
          instance per page; mode switches in place when a different alert
          row is clicked. */}
      <DashboardActionModal
        open={actionModalOpen}
        onOpenChange={setActionModalOpen}
        mode={actionModalMode}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local subcomponents
// ---------------------------------------------------------------------------

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-6 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TodaysScheduleCard — Solo dashboard's left panel
// ---------------------------------------------------------------------------
// Data: GET /api/dashboard/capacity (same canonical endpoint Operations
// uses). Scope filter lets small teams switch between All team / per-tech.
// Row click → VisitEditorLauncher (booked) or SlotQuickCreateLauncher
// (open slot). Add Job button → SlotQuickCreateLauncher with the first
// available open slot (or right-now fallback if all booked).
//
// All modal logic routes through canonical launchers — zero duplication.
// ---------------------------------------------------------------------------

interface CapacityBlockDto {
  kind: "booked" | "open";
  startISO: string;
  endISO: string;
  durationMinutes: number;
  title?: string;
  /** 2026-04-23: short job/visit description threaded through the
   *  capacity feed from jobs.summary / jobs.description. */
  description?: string;
  visitId?: string;
  jobId?: string;
  visitStatus?: string;
}
interface CapacityTechDto {
  technicianId: string;
  name: string;
  scheduleBlocks: CapacityBlockDto[];
}
interface CapacityResponseDto {
  timezone: string;
  technicians: CapacityTechDto[];
}

function TodaysScheduleCard({
  onOpenVisit,
  onOpenSlot,
}: {
  onOpenVisit: (state: VisitEditorState) => void;
  onOpenSlot: (slot: QuickCreateSlot) => void;
}) {
  const [, setLocation] = useLocation();
  // 2026-04-23: scope is a set of technicianIds. Empty array OR "one item
  // per tech in the tenant" both render as "All team" (same effective set).
  // On single-tech tenants the scope control is hidden entirely — the one
  // tech always shows with the dense single-column view.
  const [scopeIds, setScopeIds] = useState<string[]>([]);

  const capacityQuery = useQuery<CapacityResponseDto>({
    queryKey: ["/api/dashboard/capacity"],
    queryFn: () => apiRequest<CapacityResponseDto>("/api/dashboard/capacity"),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const techs = capacityQuery.data?.technicians ?? [];
  const isMultiTech = techs.length > 1;

  // Scope resolution:
  //   solo tenant             → always the one tech (scope control hidden)
  //   multi-tech, empty scope → every tech (All team)
  //   multi-tech, full scope  → every tech (same All-team semantics as empty)
  //   multi-tech, subset      → just the selected techs
  const isAllTeam =
    !isMultiTech ||
    scopeIds.length === 0 ||
    scopeIds.length === techs.length;

  const activeTechs = useMemo(() => {
    if (!isMultiTech) return techs;
    if (isAllTeam) return techs;
    return techs.filter((t) => scopeIds.includes(t.technicianId));
  }, [techs, scopeIds, isMultiTech, isAllTeam]);

  // Rendering mode: one tech → dense single-column; >1 tech → columns.
  const isSingleTechView = activeTechs.length === 1;

  // Compact trigger label for the MultiSelectDropdown button.
  const scopeLabel = useMemo(() => {
    if (isAllTeam) return "All team";
    if (scopeIds.length === 1) {
      return techs.find((t) => t.technicianId === scopeIds[0])?.name ?? "Team";
    }
    return `${scopeIds.length} technicians`;
  }, [isAllTeam, scopeIds, techs]);

  // 2026-04-23: Header suffix reflecting the CURRENT scope so the card
  // title reads as "Today's Schedule / Team" or "…/ Nadeem Samaha" or
  // "…/ Mikel Elias, Solomon Rahimi". Long lists truncate after two
  // names with "+N more" so the header stays single-line at the usual
  // card width. Solo tenants get no suffix — their schedule isn't
  // scoped.
  const scopeHeaderSuffix = useMemo(() => {
    if (!isMultiTech) return null;
    if (isAllTeam) return "Team";
    const names = scopeIds
      .map((id) => techs.find((t) => t.technicianId === id)?.name)
      .filter((n): n is string => !!n);
    if (names.length === 1) return names[0];
    if (names.length <= 3) return names.join(", ");
    return `${names.slice(0, 2).join(", ")} +${names.length - 2} more`;
  }, [isMultiTech, isAllTeam, scopeIds, techs]);

  const toggleTechId = (id: string) => {
    setScopeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };
  // "All team" clears the set; any individual subsequent pick replaces it.
  const selectAll = () => setScopeIds([]);

  // Prefer an open slot from the active scope for the Create button's
  // prefill. Falls back to any active tech + "now" when the day is fully
  // booked. Always canonical → SlotQuickCreateLauncher handles the rest.
  const firstOpen = useMemo(() => {
    const pool = activeTechs.length > 0 ? activeTechs : techs;
    for (const t of pool) {
      for (const b of t.scheduleBlocks) {
        if (b.kind === "open") return { tech: t, block: b };
      }
    }
    return null;
  }, [activeTechs, techs]);

  const openAdd = () => {
    const baseTech = firstOpen?.tech ?? activeTechs[0] ?? techs[0];
    if (!baseTech) return;
    const start = firstOpen?.block ? new Date(firstOpen.block.startISO) : new Date();
    const hh = String(start.getHours()).padStart(2, "0");
    const mm = String(start.getMinutes()).padStart(2, "0");
    onOpenSlot({
      technicianId: baseTech.technicianId,
      technicianName: baseTech.name,
      date: start,
      startTime: `${hh}:${mm}`,
      durationMinutes: firstOpen?.block?.durationMinutes,
    });
  };

  const handleBlockClick = async (tech: CapacityTechDto, block: CapacityBlockDto) => {
    if (block.kind === "booked" && block.visitId && block.jobId) {
      // 2026-04-24: hydrate the Edit Visit modal's prop fields via the
      // canonical adapter. The capacity feed ships visitId + jobId only;
      // without this the modal renders a generic "Job #" header and an
      // empty "Select location first" equipment section.
      const state = await enrichVisitEditorState(block.visitId, block.jobId);
      onOpenVisit(state);
      return;
    }
    if (block.kind === "open") {
      const start = new Date(block.startISO);
      const hh = String(start.getHours()).padStart(2, "0");
      const mm = String(start.getMinutes()).padStart(2, "0");
      onOpenSlot({
        technicianId: tech.technicianId,
        technicianName: tech.name,
        date: start,
        startTime: `${hh}:${mm}`,
        durationMinutes: block.durationMinutes,
      });
    }
  };

  return (
    // 2026-04-23: no `h-full` — the card height tracks its content, so
    // short days don't leave a tall empty column under the last visit.
    <DashCard>
      <div className="px-4 py-2.5 border-b border-[#e2e8f0] dark:border-gray-600 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarIcon className="h-3.5 w-3.5 text-[#76B054] shrink-0" />
          <h3 className="text-sm font-semibold text-[#111827] dark:text-gray-100 truncate">
            Today&apos;s Schedule
            {scopeHeaderSuffix && (
              <>
                {" "}
                <span className="text-xs font-normal text-slate-500">
                  / {scopeHeaderSuffix}
                </span>
              </>
            )}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {/* 2026-04-23: scope control only renders on multi-tech tenants.
              Solo tenants see a clean header with just the Create button. */}
          {isMultiTech && (
            <MultiSelectDropdown
              label={scopeLabel}
              count={isAllTeam ? techs.length : scopeIds.length}
              total={techs.length}
              align="right"
              width="w-60"
              testId="schedule-scope-filter"
            >
              <div className="py-1 max-h-80 overflow-y-auto">
                <button
                  type="button"
                  onClick={selectAll}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-slate-50 ${
                    isAllTeam ? "font-semibold text-[#111827]" : "text-[#4b5563]"
                  }`}
                  data-testid="schedule-scope-all"
                >
                  <input type="checkbox" readOnly checked={isAllTeam} className="pointer-events-none" />
                  All team
                </button>
                <div className="border-t border-[#e2e8f0] my-1" />
                {techs.map((t) => {
                  const checked = !isAllTeam && scopeIds.includes(t.technicianId);
                  return (
                    <button
                      key={t.technicianId}
                      type="button"
                      onClick={() => toggleTechId(t.technicianId)}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-slate-50 ${
                        checked ? "font-medium text-[#111827]" : "text-[#4b5563]"
                      }`}
                      data-testid={`schedule-scope-${t.technicianId}`}
                    >
                      <input type="checkbox" readOnly checked={checked} className="pointer-events-none" />
                      <span className="truncate">{t.name}</span>
                    </button>
                  );
                })}
                <div className="border-t border-[#e2e8f0] my-1" />
                {/* Canonical Manage Team route — /settings/team resolves to
                    TeamHubPage (see client/src/App.tsx:448). No new route. */}
                <button
                  type="button"
                  onClick={() => setLocation("/settings/team")}
                  className="w-full text-left px-3 py-1.5 text-xs text-[#76B054] hover:underline font-medium"
                  data-testid="schedule-manage-team"
                >
                  Manage team →
                </button>
              </div>
            </MultiSelectDropdown>
          )}
          <button
            type="button"
            onClick={openAdd}
            disabled={techs.length === 0}
            className="inline-flex items-center gap-1 h-8 px-3 text-xs font-medium rounded-md bg-[#76B054] text-white hover:bg-[#68a14a] disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="schedule-create"
          >
            <Plus className="h-3.5 w-3.5" />
            Create
          </button>
        </div>
      </div>
      <div>
        {capacityQuery.isLoading ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : activeTechs.length === 0 ? (
          <div className="p-4">
            <EmptyState message="No technicians in the selected scope." />
          </div>
        ) : isSingleTechView ? (
          // ── Dense single-tech view — rich rows with description + duration.
          //    Same interactions as before: click booked → editor, click
          //    open slot → quick-create. Time range in the left gutter.
          //    2026-04-23: no max-height — row stack is content-driven.
          <div data-testid="schedule-single-tech-view">
            {activeTechs[0].scheduleBlocks.length === 0 ? (
              <div className="p-4">
                <EmptyState message="No scheduled work for this tech today." />
              </div>
            ) : (
              activeTechs[0].scheduleBlocks.map((block, idx, arr) => {
                const tech = activeTechs[0];
                const timeRange = formatTimeRange(block.startISO, block.endISO);
                const isOpen = block.kind === "open";
                const isLast = idx === arr.length - 1;
                const duration = formatDurationHours(block.durationMinutes);
                const clientLabel = block.title ?? "Visit";
                const primary = isOpen
                  ? `Open slot · ${duration}`
                  : block.description
                    ? `${clientLabel} · ${block.description} · ${duration}`
                    : `${clientLabel} · ${duration}`;
                return (
                  <button
                    key={`${tech.technicianId}-${block.startISO}-${block.visitId ?? "open"}-${idx}`}
                    type="button"
                    onClick={() => handleBlockClick(tech, block)}
                    className={`w-full text-left px-4 py-2 transition-colors flex items-center gap-3 group ${!isLast ? "border-b border-[#e2e8f0]" : ""} ${
                      isOpen
                        ? "bg-emerald-50/40 hover:bg-emerald-50/80"
                        : "hover:bg-[#F0F5F0]"
                    }`}
                    data-testid={`schedule-block-${block.visitId ?? `${tech.technicianId}-${block.startISO}`}`}
                  >
                    <div className={`w-24 tabular-nums text-xs font-medium shrink-0 ${isOpen ? "text-emerald-700" : "text-slate-500"}`}>
                      {timeRange}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm truncate ${isOpen ? "text-emerald-700 font-medium" : "text-[#111827]"}`}>
                        {primary}
                      </div>
                    </div>
                    <ChevronRight className={`h-3.5 w-3.5 transition-colors ${isOpen ? "text-emerald-600 group-hover:text-emerald-800" : "text-slate-400 group-hover:text-[#111827]"}`} />
                  </button>
                );
              })
            )}
          </div>
        ) : (
          // ── Multi-column team view — one column per active tech, compact
          //    blocks (time range + company/client only). Description is
          //    intentionally omitted here; full detail is one click away in
          //    the canonical visit editor. Horizontal scroll kicks in when
          //    column count exceeds the card width (~4 columns comfortably).
          <div
            className="overflow-x-auto"
            data-testid="schedule-multi-column-view"
          >
            <div className="flex" style={{ minWidth: "min-content" }}>
              {activeTechs.map((tech, i) => {
                const isLastCol = i === activeTechs.length - 1;
                return (
                  <div
                    key={tech.technicianId}
                    className={`flex-none w-[220px] ${!isLastCol ? "border-r border-[#e2e8f0]" : ""}`}
                  >
                    {/* 2026-04-23: tech name size bumped from 11px → 13px
                        for readability. Still one tier smaller than the
                        card title (text-sm). */}
                    <div className="px-3 py-2 text-[13px] font-semibold text-[#111827] border-b border-[#e2e8f0] bg-slate-50/50 truncate">
                      {tech.name}
                    </div>
                    {/* 2026-04-23: content-driven height (no max-h cap) and
                        a very light bottom divider between blocks so
                        consecutive booked visits don't blur together. */}
                    <div className="py-0.5">
                      {tech.scheduleBlocks.length === 0 ? (
                        <div className="px-3 py-3 text-[11px] text-slate-500 italic">
                          No work
                        </div>
                      ) : (
                        tech.scheduleBlocks.map((block, bIdx, bArr) => {
                          const timeRange = formatTimeRange(block.startISO, block.endISO);
                          const isOpen = block.kind === "open";
                          const isLastBlock = bIdx === bArr.length - 1;
                          return (
                            <button
                              key={`${tech.technicianId}-${block.startISO}-${block.visitId ?? "open"}`}
                              type="button"
                              onClick={() => handleBlockClick(tech, block)}
                              className={`w-full text-left px-3 py-2 transition-colors ${
                                !isLastBlock ? "border-b border-slate-100" : ""
                              } ${
                                isOpen
                                  ? "bg-emerald-50/60 hover:bg-emerald-50"
                                  : "hover:bg-[#F0F5F0]"
                              }`}
                              data-testid={`schedule-block-${block.visitId ?? `${tech.technicianId}-${block.startISO}`}`}
                            >
                              <div className={`tabular-nums text-[11px] font-medium ${isOpen ? "text-emerald-700" : "text-slate-500"}`}>
                                {timeRange}
                              </div>
                              <div className={`text-xs truncate ${isOpen ? "text-emerald-700 font-medium" : "text-[#111827]"}`}>
                                {isOpen ? "Open slot" : (block.title ?? "Visit")}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </DashCard>
  );
}

// ---------------------------------------------------------------------------
// RecentPaymentsCard — Solo dashboard right-rail card
// ---------------------------------------------------------------------------

function RecentPaymentsCard({
  data,
  isLoading,
  onOpenInvoice,
}: {
  data?: FinancialSummary;
  isLoading: boolean;
  onOpenInvoice: (invoiceId: string) => void;
}) {
  const payments = data?.recentPayments ?? [];
  return (
    <DashCard>
      <CardHeader
        icon={CreditCard}
        color="text-emerald-600"
        title="Recent Payments"
      />
      <div>
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : payments.length === 0 ? (
          <div className="p-4"><EmptyState message="No payments received yet." /></div>
        ) : (
          <div>
            {payments.map((p, idx, arr) => {
              const isLast = idx === arr.length - 1;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onOpenInvoice(p.invoiceId)}
                  className={`w-full text-left px-4 py-2 hover:bg-[#F0F5F0] transition-colors flex items-center gap-3 group ${!isLast ? "border-b border-[#e2e8f0]" : ""}`}
                  data-testid={`recent-payment-${p.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-normal text-[#111827] truncate">
                      {p.customerName ?? p.locationName ?? "Unknown customer"}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {p.invoiceNumber ? `#${p.invoiceNumber}` : "(no number)"}
                      {p.method ? ` · ${p.method}` : ""}
                      {p.receivedAt ? ` · ${formatDate(p.receivedAt)}` : ""}
                    </div>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <div className="text-sm font-semibold tabular-nums text-emerald-700">
                      {formatCurrencyPrecise(p.amount)}
                    </div>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-[#111827] transition-colors" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </DashCard>
  );
}

// ---------------------------------------------------------------------------
// WorkflowSummaryDto — mirrors server/storage/dashboard.ts:58 WorkflowSummary
// (only the fields the Business Dashboard needs for the alerts rail).
// Same query key as Operations → shared cache.
// ---------------------------------------------------------------------------

interface WorkflowSummaryDto {
  jobs: {
    overdueCount: number;
    onHoldCount: number;
    unscheduledCount: number;
    requiresInvoicingCount: number;
    activeCount: number;
  };
  invoices: { outstandingCount: number; pastDueCount: number; draftCount: number };
}
