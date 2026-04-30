/**
 * Financial Dashboard — owner-operator command center for cash flow,
 * receivables, billing actions, and today's schedule.
 *
 * 2026-04-26 Layout redesign: the 4-tile KPI strip was removed and the
 * page collapses to two stacked sections.
 *   • Top row: Today's Schedule (1fr left) + Revenue Center (360px right).
 *     Revenue Center is Financial-flavored (Cash received this month,
 *     Outstanding A/R, Overdue A/R, Draft invoices) — distinct from the
 *     Operations Dashboard's operations-flavored RevenueCenterCard. No
 *     shared component is mutated; this card is inline and Financial-only.
 *   • Second row: three equal-width cards — Operational Alerts (using the
 *     canonical OperationalAlertsCard with order=Requires attention / Past
 *     due / Unscheduled / Ready to invoice), Top Outstanding Invoices,
 *     Top Customers Owing.
 *   The Operations Dashboard (Dashboard.tsx) is untouched.
 *
 * 2026-04-23: every metric comes from `GET /api/dashboard/financial`
 * (server/storage/dashboard.ts) — zero mock data, zero client-side
 * aggregation. Today's schedule still uses `/api/dashboard/capacity`;
 * operational counts still use `/api/dashboard/workflow` (shared cache
 * with Operations).
 *
 * Link map — every clickable element routes to a canonical filtered list:
 *   Outstanding A/R     → /invoices?filter=awaiting_payment
 *   Overdue A/R         → /invoices?filter=overdue
 *   Draft invoices      → /invoices?filter=draft
 *   Invoice rows        → /invoices/:id
 *   Customer rows       → /clients/:customerCompanyId
 */

import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign, AlertCircle, ChevronDown, ChevronRight,
  TrendingUp, Users, Receipt, Calendar as CalendarIcon, Plus,
  FileEdit,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
// 2026-04-26: Operations / Financial mode toggle removed — there is now
// a single Business Dashboard. `DashboardViewToggle` is no longer
// imported by any surface.
import {
  VisitEditorLauncher,
  type VisitEditorState,
} from "@/components/dispatch/VisitEditorLauncher";
import {
  SlotQuickCreateLauncher,
  type QuickCreateSlot,
} from "@/components/dispatch/SlotQuickCreateLauncher";
// 2026-04-26: canonical Operational Alerts card with configurable row order.
// Replaces the previous inline AlertRow stack so the Financial dashboard
// shares the same alerts component the Operations dashboard already uses.
import { OperationalAlertsCard } from "@/components/dashboard/OperationalAlertsCard";
import {
  DashboardActionModal,
  type DashboardActionMode,
} from "@/components/DashboardActionModal";
// 2026-04-30: <MultiSelectDropdown> dropped from this file — its
// absolute-positioned popover gets clipped by DashCard's overflow-hidden.
// Today's Schedule now uses the canonical <Popover> primitive
// (`@/components/ui/popover`) which renders via <PopoverPrimitive.Portal>
// and escapes the card's overflow boundary. DispatchFiltersBar and
// TodaysOperationsCard still consume <MultiSelectDropdown> — they live
// inside surfaces without overflow-hidden parents and aren't affected.
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
 * Hours-and-minutes duration label for schedule rows.
 * Examples: "30m", "1h", "1h 15m", "2h 45m".
 *
 * 2026-04-26: replaces the prior `formatDurationHours` (decimal-hours
 * form) for the Today's Schedule card. The card row now reads
 * `9:00–10:00 • Basil Box (1h 15m)`, so a hh+mm split scans cleaner
 * than `1.25h` and aligns with how the rest of the app shows
 * durations (PM cards, capacity tooltips). The dashboard card was
 * the only consumer of the prior helper; nothing else needs migrating.
 */
function formatDurationLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0m";
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * 2026-04-23: compact 12-hour clock for the schedule card's time-range
 * gutter — drops the AM/PM suffix so a pair reads as a tight inline range
 * (e.g. "9:00–10:00", "12:00–2:00").
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
  // 2026-04-26: outer card is now `flex flex-col h-full` so a card with
  // a body wrapper marked `flex-1` fills its grid-row height. This is
  // what lets the per-tech column dividers in Today's Schedule paint
  // top-to-bottom even when the column's content is shorter than the
  // sibling card on the same row.
  return (
    <div
      className={`bg-white dark:bg-gray-900 rounded-md overflow-hidden border border-[#e2e8f0] dark:border-gray-700 flex flex-col h-full ${className}`}
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
// Main page — Financial Dashboard layout (2026-04-26 redesign)
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
  // clicking a schedule block or the Create button opens the SAME dialogs
  // the rest of the app uses. No forked create/edit flow.
  const [editorState, setEditorState] = useState<VisitEditorState | null>(null);
  const [slot, setSlot] = useState<QuickCreateSlot | null>(null);

  // Canonical alert modal — same state pattern Dashboard.tsx uses. Clicking
  // an alert row opens the SAME DashboardActionModal the Operations
  // dashboard opens; counts come from the shared `["dashboard", "workflow"]`
  // query cache.
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [actionModalMode, setActionModalMode] = useState<DashboardActionMode>("action_required");
  const openActionModal = (mode: DashboardActionMode) => {
    setActionModalMode(mode);
    setActionModalOpen(true);
  };

  // Same canonical workflow summary Operations uses. Shared TanStack Query
  // cache — both dashboards hit the same rowset, a refresh on either tab
  // benefits both.
  const workflowQuery = useQuery<WorkflowSummaryDto>({
    queryKey: ["dashboard", "workflow"],
    queryFn: () => apiRequest<WorkflowSummaryDto>("/api/dashboard/workflow"),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const workflow = workflowQuery.data;
  // 2026-04-26: Requires-attention now folds PM instances awaiting job
  // generation (`pm.awaitingGenerationCount`) into the same count as
  // on-hold jobs. The action modal's `action_required` mode renders
  // both sources in a single drilldown — see `DashboardActionModal`.
  const requiresAttentionCount =
    (workflow?.jobs.onHoldCount ?? 0) + (workflow?.pm?.awaitingGenerationCount ?? 0);
  const pastDueCount = workflow?.jobs.overdueCount ?? 0;
  const unscheduledJobsCount = workflow?.jobs.unscheduledCount ?? 0;
  const readyToInvoiceCount = workflow?.jobs.requiresInvoicingCount ?? 0;

  if (error) {
    return (
      <div className="bg-app-bg">
        <div className="mx-auto px-4 sm:px-5 lg:px-6 py-4">
          <div className="p-6 bg-white rounded-md border border-red-200">
            <div className="flex items-center gap-2 text-red-600 mb-2">
              <AlertCircle className="h-4 w-4" />
              <h2 className="font-semibold">Failed to load financial dashboard</h2>
            </div>
            <p className="text-sm text-slate-600">{(error as Error).message}</p>
          </div>
        </div>
      </div>
    );
  }

  // 2026-04-30 scrollbar audit: the page wrapper used `min-h-screen` and
  // nested `<main>` inside the app shell's own `<main>`. The shell already
  // owns the canonical vertical scroll (`<main className="flex-1
  // overflow-auto">` in `client/src/App.tsx`), so a child `min-h-screen`
  // forced page height ≥ 100vh — taller than the shell main's available
  // area (`100vh − header − banners`) — guaranteeing an always-on
  // scrollbar even when content is short. The nested `<main>` was also
  // HTML-invalid (two `<main>` landmarks per document). Fixes: drop
  // `min-h-screen` so content sizes to its own height, and replace the
  // inner `<main>` with a plain `<div>` to leave a single landmark on
  // the page.
  return (
    <div className="bg-app-bg" data-testid="financial-dashboard-page">
      <div className="mx-auto px-4 sm:px-5 lg:px-6 py-4">
        {/* Header */}
        <div
          className="mb-4"
          style={{ borderBottom: "1px solid #e5e7eb", paddingBottom: "8px" }}
        >
          <h1 className="text-lg font-semibold text-[#111827] dark:text-gray-100 tracking-tight">
            Business Dashboard
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Cash flow, receivables, and today's schedule — at a glance.
          </p>
        </div>

        {/* 2026-04-30 layout swap — Top row now: Today's Schedule (1fr)
            + Operational Alerts (auto). Operational Alerts surfaces
            urgent triage above the cash-flow rows so the user's first
            scan-line carries actionable items. The right column uses
            `auto` (was `360px`) so when the alerts card collapses to a
            48 px desktop rail, the schedule card grows into the freed
            horizontal space. The alerts card itself sets its outer
            width (`xl:w-[360px]` expanded, `xl:w-12` collapsed) — the
            grid cell tracks that width.

            2026-04-30 (responsive pass) — breakpoint moved from `lg`
            (1024 px) to `xl` (1280 px). With four schedule columns
            (~220 px each + gaps) plus the 360 px alerts rail, the
            side-by-side layout requires ~1280 px of usable content
            width before the schedule starts feeling cramped. Below
            `xl` the grid collapses to a single column: schedule
            renders full-width, alerts stacks below it as a
            full-width card (rail variant suppressed inside the
            alerts component). The alerts component's `xl:w-...`
            classes mirror this same breakpoint so the card width
            never drifts out of sync with the parent grid. */}
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-3 mb-3">
          <TodaysScheduleCard
            onOpenVisit={(visitState) => setEditorState(visitState)}
            onOpenSlot={(s) => setSlot(s)}
          />
          <OperationalAlertsCard
            requiresAttentionCount={requiresAttentionCount}
            pastDueCount={pastDueCount}
            unscheduledCount={unscheduledJobsCount}
            readyToInvoiceCount={readyToInvoiceCount}
            isLoading={workflowQuery.isLoading}
            onOpenActionModal={openActionModal}
            order={["requires_attention", "past_due", "unscheduled", "ready_to_invoice"]}
          />
        </div>

        {/* 2026-04-30 layout swap — Second row: Revenue Center moves
            here from the top-right slot it previously held, joining
            Top Outstanding Invoices + Top Customers Owing in the
            three-column receivables strip. The Revenue cell uses
            `self-start` so it does NOT stretch to match the heavier
            invoice/customer cards — Revenue is a compact summary
            (4 short rows) and looks visually wrong when stretched.
            The other two cells keep default `stretch` so they remain
            equal-height. Stacks vertically on mobile. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="self-start">
            <RevenueCenterFinancialCard
              data={data}
              isLoading={isLoading}
              onNavigate={(dest) => setLocation(dest)}
            />
          </div>

          <TopOutstandingInvoicesCard
            data={data}
            isLoading={isLoading}
            onOpenInvoice={(id) => setLocation(`/invoices/${id}`)}
            onViewAll={() => setLocation("/invoices?filter=awaiting_payment")}
          />

          <TopCustomersOwingCard
            data={data}
            isLoading={isLoading}
            onOpenCustomer={(id) => setLocation(`/clients/${id}`)}
            onViewAll={() => setLocation("/invoices?filter=awaiting_payment")}
          />
        </div>
      </div>

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
// RevenueCenterFinancialCard — top-right card for the Financial Dashboard.
// Distinct from the Operations Dashboard's RevenueCenterCard (which lists
// operations follow-ups). This card surfaces cash-flow and receivables
// totals only. Data already lives on /api/dashboard/financial — no new
// endpoint, no client aggregation.
// ---------------------------------------------------------------------------

interface RevenueCenterFinancialCardProps {
  data?: FinancialSummary;
  isLoading: boolean;
  onNavigate: (destination: string) => void;
}

function RevenueCenterFinancialCard({
  data,
  isLoading,
  onNavigate,
}: RevenueCenterFinancialCardProps) {
  const ar = data?.ar;
  const draftCount = data?.draft.count ?? 0;
  const draftTotal = data?.draft.total ?? 0;
  const cashThisMonth = data?.revenue.month ?? 0;

  // 2026-04-30 compact pass — labels shortened per spec, sub merged
  // into the right-aligned summary string with a `·` separator. Each
  // row is now a single horizontal line: icon + label left, summary
  // right. No more two-line stack of label-above-value.
  const rows: Array<{
    key: string;
    label: string;
    value: string;
    sub?: string;
    icon: React.ElementType;
    iconColor: string;
    iconBg: string;
    onClick?: () => void;
    urgent?: boolean;
  }> = [
    {
      key: "cash-this-month",
      label: "This month",
      value: formatCurrency(cashThisMonth),
      icon: TrendingUp,
      iconColor: "text-emerald-600",
      iconBg: "bg-emerald-100 dark:bg-emerald-950/30",
    },
    {
      key: "outstanding-ar",
      label: "Outstanding",
      value: formatCurrency(ar?.outstandingTotal ?? 0),
      sub:
        (ar?.outstandingCount ?? 0) > 0
          ? `${ar?.outstandingCount} invoice${ar?.outstandingCount === 1 ? "" : "s"}`
          : undefined,
      icon: DollarSign,
      iconColor: "text-amber-600",
      iconBg: "bg-amber-100 dark:bg-amber-950/30",
      onClick: () => onNavigate("/invoices?filter=awaiting_payment"),
    },
    {
      key: "overdue-ar",
      label: "Overdue",
      value: formatCurrency(ar?.pastDueTotal ?? 0),
      sub:
        (ar?.pastDueCount ?? 0) > 0
          ? `${ar?.pastDueCount} past due`
          : undefined,
      icon: AlertCircle,
      iconColor: "text-red-600",
      iconBg: "bg-red-100 dark:bg-red-950/30",
      onClick: () => onNavigate("/invoices?filter=overdue"),
      urgent: (ar?.pastDueTotal ?? 0) > 0,
    },
    {
      key: "draft-invoices",
      label: "Drafts",
      value: draftCount > 0 ? formatCurrency(draftTotal) : "$0",
      sub: draftCount > 0 ? `${draftCount} draft${draftCount === 1 ? "" : "s"}` : undefined,
      icon: FileEdit,
      iconColor: "text-slate-600",
      iconBg: "bg-slate-100 dark:bg-slate-800/40",
      onClick: () => onNavigate("/invoices?filter=draft"),
    },
  ];

  return (
    <DashCard>
      <CardHeader
        icon={DollarSign}
        color="text-[#76B054]"
        title="Revenue Center"
        action={
          <button
            type="button"
            onClick={() => onNavigate("/invoices?filter=awaiting_payment")}
            className="text-xs text-[#76B054] hover:underline"
            data-testid="revenue-center-open-financials"
          >
            Open A/R
          </button>
        }
      />
      <div data-testid="revenue-center-financial">
        {isLoading ? (
          <div className="p-3 space-y-1.5">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-7 w-full" />)}
          </div>
        ) : (
          <ul>
            {rows.map((row, idx) => {
              const Icon = row.icon;
              const isLast = idx === rows.length - 1;
              const interactive = !!row.onClick;
              // Right-aligned summary: when both `sub` and `value` are
              // present, render them on one line joined by a thin-space
              // bullet — e.g. "1 draft · $0", "3 past due · $300".
              // When only `value` exists, render just `$0`.
              const summary = row.sub ? `${row.sub} · ${row.value}` : row.value;
              const className = `w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                !isLast ? "border-b border-[#e2e8f0]" : ""
              } ${
                row.urgent
                  ? "bg-red-50/40 hover:bg-red-50"
                  : interactive
                    ? "hover:bg-[#F0F5F0]"
                    : ""
              }`;
              // 2026-04-30 micro-polish: trailing chevron dropped from
              // every Revenue row. Each row's right edge now ends with
              // the value/summary string so the four rows right-align
              // consistently with each other. Click affordance on
              // interactive rows is signaled solely by the existing
              // hover background — `hover:bg-[#F0F5F0]` (or
              // `hover:bg-red-50` for the urgent row) — and by the
              // `<button>` cursor.
              const inner = (
                <>
                  <div className={`p-1 rounded shrink-0 ${row.iconBg}`}>
                    <Icon className={`h-3 w-3 ${row.iconColor}`} />
                  </div>
                  <span
                    className={`flex-1 text-xs font-medium truncate ${
                      row.urgent ? "text-red-700" : "text-slate-700 dark:text-gray-200"
                    }`}
                  >
                    {row.label}
                  </span>
                  <span
                    className={`text-sm font-semibold tabular-nums shrink-0 ${
                      row.urgent ? "text-red-700" : "text-[#111827] dark:text-gray-100"
                    }`}
                  >
                    {summary}
                  </span>
                </>
              );
              return (
                <li key={row.key}>
                  {interactive ? (
                    <button
                      type="button"
                      onClick={row.onClick}
                      className={className}
                      data-testid={`revenue-row-${row.key}`}
                    >
                      {inner}
                    </button>
                  ) : (
                    <div className={className} data-testid={`revenue-row-${row.key}`}>{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </DashCard>
  );
}

// ---------------------------------------------------------------------------
// TopOutstandingInvoicesCard / TopCustomersOwingCard — Financial-only
// inline cards. Use the existing /api/dashboard/financial payload (zero
// new endpoints). Kept inline (not the components in
// `@/components/dashboard/RightColumnFinancialCards`) because those use
// USD formatting; the Financial dashboard standardizes on CAD.
// ---------------------------------------------------------------------------

interface TopOutstandingInvoicesCardProps {
  data?: FinancialSummary;
  isLoading: boolean;
  onOpenInvoice: (invoiceId: string) => void;
  onViewAll: () => void;
}

function TopOutstandingInvoicesCard({
  data,
  isLoading,
  onOpenInvoice,
  onViewAll,
}: TopOutstandingInvoicesCardProps) {
  return (
    <DashCard>
      <CardHeader
        icon={Receipt}
        color="text-amber-600"
        title="Top Outstanding Invoices"
        action={
          <button
            type="button"
            onClick={onViewAll}
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
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : !data?.topOutstandingInvoices.length ? (
          <div className="p-4"><EmptyState message="No outstanding invoices." /></div>
        ) : (
          <div>
            {data.topOutstandingInvoices.slice(0, 5).map((inv, idx, arr) => {
              const isLast = idx === arr.length - 1;
              const isOverdue = (inv.daysLate ?? 0) > 0;
              return (
                <button
                  key={inv.id}
                  type="button"
                  onClick={() => onOpenInvoice(inv.id)}
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
  );
}

interface TopCustomersOwingCardProps {
  data?: FinancialSummary;
  isLoading: boolean;
  onOpenCustomer: (customerCompanyId: string) => void;
  onViewAll: () => void;
}

function TopCustomersOwingCard({
  data,
  isLoading,
  onOpenCustomer,
  onViewAll,
}: TopCustomersOwingCardProps) {
  return (
    <DashCard>
      <CardHeader
        icon={Users}
        color="text-blue-600"
        title="Top Customers Owing"
        action={
          <button
            type="button"
            onClick={onViewAll}
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
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : !data?.topCustomerBalances.length ? (
          <div className="p-4"><EmptyState message="No customers with outstanding balances." /></div>
        ) : (
          <div>
            {data.topCustomerBalances.slice(0, 5).map((c, idx, arr) => {
              const isLast = idx === arr.length - 1;
              const hasOverdue = c.overdue > 0;
              return (
                <button
                  key={c.customerCompanyId}
                  type="button"
                  onClick={() => onOpenCustomer(c.customerCompanyId)}
                  className={`w-full text-left px-4 py-2 hover:bg-[#F0F5F0] transition-colors flex items-center gap-3 group ${!isLast ? "border-b border-[#e2e8f0]" : ""}`}
                  data-testid={`top-customer-${c.customerCompanyId}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-normal text-[#111827] truncate">
                      {c.name ?? "Unnamed customer"}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {c.openCount} open invoice{c.openCount === 1 ? "" : "s"}
                      {hasOverdue && (
                        <span className="ml-1.5 text-red-600 font-medium">
                          · {formatCurrency(c.overdue)} overdue
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <div className={`text-sm font-semibold tabular-nums ${hasOverdue ? "text-red-700" : "text-[#111827]"}`}>
                      {formatCurrency(c.outstanding)}
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
// TodaysScheduleCard — Financial dashboard's top-left panel.
// ---------------------------------------------------------------------------
// Data: GET /api/dashboard/capacity (same canonical endpoint Operations
// uses). Scope filter lets small teams switch between All team / per-tech.
// Row click → VisitEditorLauncher (booked) or SlotQuickCreateLauncher
// (open slot). Create button → SlotQuickCreateLauncher with the first
// available open slot (or right-now fallback if all booked).
//
// All modal logic routes through canonical launchers — zero duplication.
// 2026-04-26: schedule fonts/sizing intentionally unchanged from the
// 2026-04-23 version per the redesign brief ("Keep original smaller font
// sizes — do NOT enlarge names or rows").
// ---------------------------------------------------------------------------

interface CapacityBlockDto {
  kind: "booked" | "open";
  startISO: string;
  endISO: string;
  durationMinutes: number;
  title?: string;
  /** Short job/visit description threaded through the capacity feed from
   *  jobs.summary / jobs.description. */
  description?: string;
  visitId?: string;
  jobId?: string;
  visitStatus?: string;
}
interface CapacityTechDto {
  technicianId: string;
  name: string;
  /** 2026-04-26: surfaced from /api/dashboard/capacity. "off_today" means
   *  the tech has no working hours configured today. The card uses this
   *  to label them `(off shift)` while still rendering any assigned blocks. */
  state?: "open" | "no_open_today" | "fully_booked" | "day_over" | "off_today";
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
  const [scopeIds, setScopeIds] = useState<string[]>([]);
  // 2026-04-30 — open-only filter for the schedule card. State is local to
  // this card so it doesn't bleed into Operational Alerts / Revenue /
  // anywhere else on the dashboard. Composes with `scopeIds` (team filter)
  // by filtering the per-tech `scheduleBlocks` AFTER the team filter has
  // already produced `activeTechs` — both filters layer cleanly in a
  // single derivation step downstream.
  const [openOnly, setOpenOnly] = useState(false);

  const capacityQuery = useQuery<CapacityResponseDto>({
    queryKey: ["/api/dashboard/capacity"],
    queryFn: () => apiRequest<CapacityResponseDto>("/api/dashboard/capacity"),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const techs = capacityQuery.data?.technicians ?? [];
  const isMultiTech = techs.length > 1;

  const isAllTeam =
    !isMultiTech ||
    scopeIds.length === 0 ||
    scopeIds.length === techs.length;

  const activeTechs = useMemo(() => {
    if (!isMultiTech) return techs;
    if (isAllTeam) return techs;
    return techs.filter((t) => scopeIds.includes(t.technicianId));
  }, [techs, scopeIds, isMultiTech, isAllTeam]);

  // Per-column row filter. When `openOnly` is on, every visible tech keeps
  // its column slot but the booked rows are dropped. A column with zero
  // open slots renders the per-state empty copy below ("No open slots")
  // instead of disappearing — this preserves layout stability when the
  // user toggles the filter on/off, and gives selected technicians
  // explicit "nothing for you to take" feedback rather than silently
  // hiding them.
  const visibleTechs = useMemo(() => {
    if (!openOnly) return activeTechs;
    return activeTechs.map((t) => ({
      ...t,
      scheduleBlocks: t.scheduleBlocks.filter((b) => b.kind === "open"),
    }));
  }, [activeTechs, openOnly]);

  const isSingleTechView = visibleTechs.length === 1;

  const scopeLabel = useMemo(() => {
    if (isAllTeam) return "All team";
    if (scopeIds.length === 1) {
      return techs.find((t) => t.technicianId === scopeIds[0])?.name ?? "Team";
    }
    return `${scopeIds.length} technicians`;
  }, [isAllTeam, scopeIds, techs]);

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
  const selectAll = () => setScopeIds([]);

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
        {/*
          2026-04-30 — header controls cluster:
            • Open-only toggle (left of team dropdown per spec)
            • Team scope dropdown (multi-tech only, canonical Popover)
            • Create button (right edge)

          `flex-wrap` lets the cluster wrap onto a second row at narrow
          tablet widths instead of horizontally overflowing the card or
          crushing the title beside it.
        */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            type="button"
            onClick={() => setOpenOnly((v) => !v)}
            aria-pressed={openOnly}
            className={`inline-flex items-center h-8 px-3 text-xs font-medium rounded-md border transition-colors ${
              openOnly
                ? "border-[#76B054] bg-[#76B054]/10 text-[#76B054]"
                : "border-[#e2e8f0] bg-white text-slate-700 hover:bg-slate-50"
            }`}
            data-testid="schedule-open-only-toggle"
          >
            {openOnly ? "Showing open" : "Open only"}
          </button>
          {isMultiTech && (
            // 2026-04-30 — switched from <MultiSelectDropdown> (absolute-
            // positioned popover that gets clipped by DashCard's
            // overflow-hidden) to the canonical <Popover> primitive,
            // which renders inside <PopoverPrimitive.Portal> and escapes
            // every parent overflow boundary. The popover content is now
            // a flex column with a scrollable team list (`max-h-72
            // overflow-y-auto`) and a pinned, non-scrolling
            // "Manage team →" footer below it.
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md border border-[#e2e8f0] bg-white text-slate-700 hover:bg-slate-50"
                  data-testid="schedule-scope-filter"
                >
                  {scopeLabel}
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">
                    {isAllTeam ? "All" : scopeIds.length}
                  </span>
                  <ChevronDown className="h-3 w-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={4}
                className="w-60 p-0"
              >
                <div className="flex flex-col">
                  <div className="py-1 max-h-72 overflow-y-auto">
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
                  </div>
                  <div className="border-t border-[#e2e8f0]">
                    <button
                      type="button"
                      onClick={() => setLocation("/settings/team")}
                      className="w-full text-left px-3 py-2 text-xs text-[#76B054] font-medium hover:bg-slate-50 hover:underline"
                      data-testid="schedule-manage-team"
                    >
                      Manage team →
                    </button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
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
      {/* 2026-04-26: body wrapper is `flex-1 flex flex-col` so the
          multi-tech grid below can stretch to the card's full height.
          Together with `DashCard`'s `h-full flex flex-col` this lets
          per-tech column dividers paint top-to-bottom regardless of
          how much content each column has. */}
      <div className="flex-1 flex flex-col min-h-0">
        {capacityQuery.isLoading ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : visibleTechs.length === 0 ? (
          <div className="p-4">
            <EmptyState message="No technicians in the selected scope." />
          </div>
        ) : isSingleTechView ? (
          <div data-testid="schedule-single-tech-view">
            {visibleTechs[0].scheduleBlocks.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  message={
                    openOnly
                      ? "No open slots."
                      : "No scheduled work for this tech today."
                  }
                />
              </div>
            ) : (
              visibleTechs[0].scheduleBlocks.map((block, idx, arr) => {
                const tech = visibleTechs[0];
                const timeRange = formatTimeRange(block.startISO, block.endISO);
                const isOpen = block.kind === "open";
                const isLast = idx === arr.length - 1;
                const duration = formatDurationLabel(block.durationMinutes);
                const nameLabel = isOpen ? "Open Slot" : (block.title ?? "Visit");
                return (
                  <button
                    key={`${tech.technicianId}-${block.startISO}-${block.visitId ?? "open"}-${idx}`}
                    type="button"
                    onClick={() => handleBlockClick(tech, block)}
                    className={`w-full text-left px-4 py-1.5 transition-colors flex items-center gap-3 group hover:bg-[#F0F5F0] ${!isLast ? "border-b border-[#e2e8f0]" : ""}`}
                    data-testid={`schedule-block-${block.visitId ?? `${tech.technicianId}-${block.startISO}`}`}
                  >
                    {/* 2026-04-26 v2: rigid 3-column grid for row
                        alignment. The prior flex+tabular-nums layout
                        only normalized digit widths, so rows with
                        different time-string character counts (e.g.
                        `9:00–10:00` vs `10:00–11:00`) drifted the
                        bullet/name/duration positions. Grid columns
                        are: 110px time gutter | 1fr name (the only
                        flex column — ellipsizes first) | auto duration
                        (right-aligned). The bullet sits at the start
                        of the name column so it lands at the same x
                        position on every row regardless of name length. */}
                    <div
                      className={`flex-1 min-w-0 grid items-baseline gap-2 text-sm ${isOpen ? "text-emerald-700" : "text-[#111827]"}`}
                      style={{ gridTemplateColumns: "110px minmax(0, 1fr) auto" }}
                    >
                      <span className={`tabular-nums font-medium ${isOpen ? "text-emerald-700" : "text-slate-600"}`}>
                        {timeRange}
                      </span>
                      <span className="flex items-baseline gap-1.5 min-w-0">
                        <span className={`shrink-0 ${isOpen ? "text-emerald-400" : "text-slate-300"}`} aria-hidden>•</span>
                        <span className="font-semibold truncate">{nameLabel}</span>
                      </span>
                      <span className={`tabular-nums font-normal text-right ${isOpen ? "text-emerald-600" : "text-slate-500"}`}>({duration})</span>
                    </div>
                    <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-colors ${isOpen ? "text-emerald-600 group-hover:text-emerald-800" : "text-slate-400 group-hover:text-[#111827]"}`} />
                  </button>
                );
              })
            )}
          </div>
        ) : (
          // 2026-04-26: column width is now responsive to visible tech count.
          //   ≤ 4 techs → CSS grid `repeat(N, minmax(0, 1fr))` so columns
          //               always fill the card width (no dead space).
          //   ≥ 5 techs → horizontal scroll inside the card with a 220px
          //               readable min-width per column. Page itself never
          //               horizontally scrolls — only the rail does.
          // The column body is identical in both modes; only the container
          // and per-column width class differ.
          (() => {
            const useGrid = visibleTechs.length <= 4;
            const renderColumn = (tech: CapacityTechDto, isLastCol: boolean, widthClass: string) => {
              // 2026-04-26 polish v6: off-shift technicians can still have
              // assigned visits (e.g. accidental booking on a day-off). The
              // server now returns those blocks for off_today techs; the
              // column labels the name `(off shift)` and renders the
              // blocks below. The "No work" copy fires only when the tech
              // truly has nothing assigned today.
              // 2026-04-30: when the open-only filter is on, the per-column
              // empty copy switches to "No open slots" so a tech the user
              // has explicitly selected doesn't read as "off shift" or
              // "no work" when they actually do have booked visits — just
              // none of them are open slots to claim.
              const isOffShift = tech.state === "off_today";
              const emptyLabel = openOnly
                ? "No open slots"
                : isOffShift
                  ? "Off shift"
                  : "No work";
              return (
              <div
                key={tech.technicianId}
                className={`${widthClass} ${!isLastCol ? "border-r border-[#e2e8f0]" : ""}`}
              >
                <div className="px-3 py-2 text-[13px] font-semibold text-[#111827] border-b border-[#e2e8f0] bg-slate-50/50 truncate">
                  {tech.name}
                  {isOffShift && (
                    <span className="ml-1.5 text-[10px] font-medium text-amber-700 align-middle">
                      (off shift)
                    </span>
                  )}
                </div>
                <div className="py-0.5">
                  {tech.scheduleBlocks.length === 0 ? (
                    <div className="px-3 py-3 text-[11px] text-slate-500 italic">
                      {emptyLabel}
                    </div>
                  ) : (
                    tech.scheduleBlocks.map((block, bIdx, bArr) => {
                      const timeRange = formatTimeRange(block.startISO, block.endISO);
                      const isOpen = block.kind === "open";
                      const isLastBlock = bIdx === bArr.length - 1;
                      const duration = formatDurationLabel(block.durationMinutes);
                      const nameLabel = isOpen ? "Open Slot" : (block.title ?? "Visit");
                      return (
                        <button
                          key={`${tech.technicianId}-${block.startISO}-${block.visitId ?? "open"}`}
                          type="button"
                          onClick={() => handleBlockClick(tech, block)}
                          className={`w-full text-left px-3 py-1.5 transition-colors hover:bg-[#F0F5F0] ${
                            !isLastBlock ? "border-b border-slate-100" : ""
                          }`}
                          data-testid={`schedule-block-${block.visitId ?? `${tech.technicianId}-${block.startISO}`}`}
                        >
                          {/* 2026-04-26 v2: rigid 3-column grid mirroring
                              the single-tech view, with a tighter time
                              gutter (96px) sized for the smaller text-xs
                              font and the multi-tech column constraints
                              (full-width grid for ≤4 techs; 220px-wide
                              scrolling columns for ≥5 techs). On a 220px
                              column the layout is: 96px time + ~12px
                              gap + name (ellipsized) + ~50px duration.
                              The name column is the only flex element
                              so it absorbs the remaining width and
                              truncates first per spec. */}
                          <div
                            className={`grid items-baseline gap-1.5 text-xs ${isOpen ? "text-emerald-700" : "text-[#111827]"}`}
                            style={{ gridTemplateColumns: "96px minmax(0, 1fr) auto" }}
                          >
                            <span className={`tabular-nums font-medium ${isOpen ? "text-emerald-700" : "text-slate-600"}`}>
                              {timeRange}
                            </span>
                            <span className="flex items-baseline gap-1 min-w-0">
                              <span className={`shrink-0 ${isOpen ? "text-emerald-400" : "text-slate-300"}`} aria-hidden>•</span>
                              <span className="font-semibold truncate">{nameLabel}</span>
                            </span>
                            <span className={`tabular-nums font-normal text-right ${isOpen ? "text-emerald-600" : "text-slate-500"}`}>({duration})</span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
              );
            };

            // 2026-04-26: both layouts now stretch full-height
            // (`flex-1` on the grid / scroll wrapper, `h-full` on the
            // inner column row) so the per-tech `border-r` dividers
            // paint to the bottom of the card body. Empty columns
            // (or columns with fewer rows than their neighbour) still
            // render their full-height boundary.
            return useGrid ? (
              <div
                className="grid flex-1"
                style={{ gridTemplateColumns: `repeat(${visibleTechs.length}, minmax(0, 1fr))` }}
                data-testid="schedule-multi-column-view"
              >
                {visibleTechs.map((tech, i) =>
                  renderColumn(tech, i === visibleTechs.length - 1, "min-w-0"),
                )}
              </div>
            ) : (
              <div
                className="overflow-x-auto flex-1"
                data-testid="schedule-multi-column-view"
              >
                <div className="flex h-full" style={{ minWidth: "min-content" }}>
                  {visibleTechs.map((tech, i) =>
                    renderColumn(tech, i === visibleTechs.length - 1, "flex-none w-[220px]"),
                  )}
                </div>
              </div>
            );
          })()
        )}
      </div>
    </DashCard>
  );
}

// ---------------------------------------------------------------------------
// WorkflowSummaryDto — mirrors server/storage/dashboard.ts:58 WorkflowSummary
// (only the fields the Business Dashboard needs for the alerts row).
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
  // 2026-04-26: PM counts already populated by `getPMCounts` server-side.
  // Only `awaitingGenerationCount` is read by the dashboard alerts row;
  // the others are kept optional for forward-compat with the PM Health
  // surface. Optional because legacy responses (and tests / mocks) may
  // omit the section.
  pm?: {
    awaitingGenerationCount: number;
    overdueCount?: number;
    comingDueCount?: number;
    upcomingCount?: number;
    hasAnyData?: boolean;
  };
}
