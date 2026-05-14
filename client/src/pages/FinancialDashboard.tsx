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

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign, AlertCircle, ChevronDown, ChevronRight,
  TrendingUp, Users, Receipt, Calendar as CalendarIcon, Plus,
  FileEdit, LayoutGrid, Columns,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  VisitEditorLauncher,
  type VisitEditorState,
} from "@/components/dispatch/VisitEditorLauncher";
import {
  SlotQuickCreateLauncher,
  type QuickCreateSlot,
} from "@/components/dispatch/SlotQuickCreateLauncher";
// 2026-05-07 RALPH: the schedule card's "+ Create" button was removed
// (users create from open slots or the global "+ New" button), so the
// no-prefill CreateNewDialog import previously mounted from this page
// is no longer needed.
// 2026-04-26: canonical Operational Alerts card with configurable row order.
// Replaces the previous inline AlertRow stack so the Financial dashboard
// shares the same alerts component the Operations dashboard already uses.
import { OperationalAlertsCard } from "@/components/dashboard/OperationalAlertsCard";
import { TasksOverviewCard } from "@/components/dashboard/TasksOverviewCard";
import { ClientCollectionsModal } from "@/components/collections/ClientCollectionsModal";
import {
  DashboardActionModal,
  type DashboardActionMode,
} from "@/components/DashboardActionModal";
// 2026-04-30: <MultiSelectDropdown> dropped from this file — its
// absolute-positioned popover gets clipped by CardShell's overflow-hidden.
// Today's Schedule now uses the canonical <Popover> primitive
// (`@/components/ui/popover`) which renders via <PopoverPrimitive.Portal>
// and escapes the card's overflow boundary. Other consumers
// (e.g. DispatchFiltersBar) live inside surfaces without
// overflow-hidden parents and aren't affected.
// 2026-04-24: shared adapter that fills in the prop fields the canonical
// Edit Visit modal reads (customerName, jobNumber, locationId, ...) when
// the caller only holds visitId + jobId. Dispatch already passes the full
// payload and hits the adapter's fast-path no-op; the dashboard takes the
// fetch path so its click hydrates the modal identically.
import { enrichVisitEditorState } from "@/lib/visitEditorPayloadBuilder";
// 2026-05-01 — clamp helper used to drop / shrink past-time portions of
// today's open slots so the row label and the click-prefilled start
// time can never disagree. See clampOpenBlockToNow's docstring for the
// exact contract; the dashboard applies it once per render so display +
// click consume the same clamped block.
import { clampOpenBlockToNow, roundUpToNextInterval } from "@/lib/findNextAvailableSlot";
// 2026-05-07 RALPH: customizable dashboard framework. The page still
// owns data-fetching + handler wiring; the framework owns the resolved
// widget order, visibility, and the right-side customize drawer.
import { useDashboardLayout } from "@/dashboard/useDashboardLayout";
import { DashboardWidgetGrid } from "@/dashboard/DashboardWidgetGrid";
import { DashboardCustomizeDrawer } from "@/dashboard/DashboardCustomizeDrawer";
import { TechnicianTimeOffModal } from "@/components/team/TechnicianTimeOffModal";
import { Sliders } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardShell, CardShellHeader, CardShellTitle, CardMetricBlock } from "@/components/ui/card";

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
    customerCompanyId: string | null;
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
  pipelineSnapshot: {
    // Legacy fields — kept so other consumers don't break, but the
    // Pipeline card no longer reads them after the 2026-05-06 RALPH
    // redesign.
    leadsCount: number;
    leadsValue: number;
    quotesSentCount: number;
    quotesSentValue: number;
    awaitingFollowUpCount: number;
    awaitingFollowUpValue: number;
    /** null when this-month leads-created denominator is zero — UI renders "—". */
    conversionRateMonth: number | null;
    staleLeadsCount: number;
    staleLeadsValue: number;
    // 2026-05-06 RALPH actionable buckets (server: getPipelineSnapshot).
    leadsFollowUpCount: number;
    leadsFollowUpValue: number;
    quotesNotSentCount: number;
    quotesNotSentValue: number;
    quotesAwaitingResponseCount: number;
    quotesAwaitingResponseValue: number;
    staleOpportunitiesCount: number;
    staleOpportunitiesValue: number;
  };
  scheduledRevenue: {
    todayValue: number;
    next7DaysValue: number;
    next30DaysValue: number;
    upcomingHighValueJobs: {
      id: string;
      jobNumber: number;
      summary: string | null;
      customerName: string | null;
      locationName: string | null;
      scheduledStart: string | null;
      value: number;
    }[];
  };
  needsAttention: {
    invoicesNotSentCount: number;
    invoicesNotSentValue: number;
    quotesNotFollowedUpCount: number;
    quotesNotFollowedUpValue: number;
    leadsNotConvertedCount: number;
    leadsNotConvertedValue: number;
  };
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
// Main page — Financial Dashboard layout (2026-04-26 redesign)
// ---------------------------------------------------------------------------

export default function FinancialDashboard() {
  const [, setLocation] = useLocation();

  // 2026-05-07 RALPH (hidden widget query gating): the framework hook
  // owns the resolved widget list. Page-level useQuery calls below
  // only fire when at least one widget consuming that data shape is
  // visible. Hidden widgets DO NOT trigger their underlying fetches.
  // Layout-loading state is the canonical loading indicator until the
  // first GET resolves — until then, every `enabled` flag is false to
  // avoid a flash of "fetch everything because nothing is visible
  // yet."
  const layout = useDashboardLayout("financial");
  const visibleSet = useMemo(
    () => new Set(layout.visibleWidgets.map((w) => w.widgetKey)),
    [layout.visibleWidgets],
  );
  // Each map below records WHICH widgets consume a given page-level
  // query. When zero widgets in a query's set are visible, the
  // `enabled` flag is false → useQuery stays idle and never hits the
  // network for that data shape.
  const FINANCIAL_QUERY_WIDGETS: readonly string[] = [
    "pipeline_snapshot",
    "collections_overview",
    "scheduled_revenue",
    // 2026-05-07: operational_alerts joined this set because its new
    // bottom row ("Invoices not sent") consumes
    // data.needsAttention.invoicesNotSentCount from the financial
    // summary. The retired needs_attention widget is gone from the
    // registry; persisted layouts referencing it degrade safely
    // (resolver iterates the registry, not the override rows).
    "operational_alerts",
  ];
  const WORKFLOW_QUERY_WIDGETS: readonly string[] = [
    "operational_alerts",
  ];
  const financialQueryEnabled =
    !layout.isLoading &&
    FINANCIAL_QUERY_WIDGETS.some((k) => visibleSet.has(k));
  const workflowQueryEnabled =
    !layout.isLoading &&
    WORKFLOW_QUERY_WIDGETS.some((k) => visibleSet.has(k));

  const { data, isLoading, error } = useQuery<FinancialSummary>({
    queryKey: ["dashboard", "financial"],
    queryFn: () => apiRequest<FinancialSummary>("/api/dashboard/financial"),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    enabled: financialQueryEnabled,
  });

  // Canonical scheduling launchers — identical mounts to Dashboard.tsx so
  // clicking a schedule block or the Create button opens the SAME dialogs
  // the rest of the app uses. No forked create/edit flow.
  const [editorState, setEditorState] = useState<VisitEditorState | null>(null);
  const [slot, setSlot] = useState<QuickCreateSlot | null>(null);
  // 2026-05-07 RALPH: Today's Schedule's "+ Create" button is gone —
  // users create from open slots (`slot` above) or the global "+ New"
  // button in the top nav. The CreateNewDialog launcher is no longer
  // mounted from this page.

  // Canonical alert modal — same state pattern Dashboard.tsx uses. Clicking
  // an alert row opens the SAME DashboardActionModal the Operations
  // dashboard opens; counts come from the shared `["dashboard", "workflow"]`
  // query cache.
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [actionModalMode, setActionModalMode] = useState<DashboardActionMode>("requires_attention");
  const [collectionsModalCustomerCompanyId, setCollectionsModalCustomerCompanyId] = useState<string | null>(null);
  // 2026-05-07 RALPH: customize-drawer open state. The framework hook
  // (`useDashboardLayout`) owns the resolved widget list + persistence;
  // this state just toggles the right-side Sheet.
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const openActionModal = (mode: DashboardActionMode) => {
    setActionModalMode(mode);
    setActionModalOpen(true);
  };

  // Same canonical workflow summary Operations uses. Shared TanStack Query
  // cache — both dashboards hit the same rowset, a refresh on either tab
  // benefits both. Gated on visibility so hidden widgets don't trigger
  // their underlying data fetch.
  const workflowQuery = useQuery<WorkflowSummaryDto>({
    queryKey: ["dashboard", "workflow"],
    queryFn: () => apiRequest<WorkflowSummaryDto>("/api/dashboard/workflow"),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    enabled: workflowQueryEnabled,
  });
  const workflow = workflowQuery.data;
  // 2026-04-26: Requires-attention now folds PM instances awaiting job
  // generation (`pm.awaitingGenerationCount`) into the same count as
  // on-hold jobs. The action modal's `requires_attention` mode renders
  // both sources in a single drilldown — see `DashboardActionModal`.
  const requiresAttentionCount =
    (workflow?.jobs.onHoldCount ?? 0) + (workflow?.pm?.awaitingGenerationCount ?? 0);
  const pastDueCount = workflow?.jobs.overdueCount ?? 0;
  const unscheduledJobsCount = workflow?.jobs.unscheduledCount ?? 0;
  const readyToInvoiceCount = workflow?.jobs.requiresInvoicingCount ?? 0;

  // 2026-05-07 RALPH (3-col grid) — Today's Schedule width is dynamic
  // based on the number of visible team columns inside the schedule
  // card. Lifting the team-scope state to the page lets the grid size
  // the schedule cell to match the data inside it (1 tech → 1-col,
  // 2 → 2-col, 3+ → 3-col). The capacity query reuses the SAME
  // queryKey the schedule card consumes — TanStack Query dedupes the
  // network round-trip, so this is a free read from the same cache.
  const [scheduleScopeIds, setScheduleScopeIds] = useState<string[]>([]);
  const scheduleCapacityQuery = useQuery<CapacityResponseDto>({
    queryKey: ["/api/dashboard/capacity"],
    queryFn: () => apiRequest<CapacityResponseDto>("/api/dashboard/capacity"),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    enabled: visibleSet.has("todays_schedule"),
  });
  const scheduleTechs = scheduleCapacityQuery.data?.technicians ?? [];
  const scheduleVisibleTechCount = useMemo(() => {
    if (scheduleTechs.length <= 1) return Math.max(1, scheduleTechs.length);
    if (
      scheduleScopeIds.length === 0 ||
      scheduleScopeIds.length === scheduleTechs.length
    ) {
      return scheduleTechs.length;
    }
    return scheduleScopeIds.length;
  }, [scheduleTechs, scheduleScopeIds]);
  // Filter the capacity techs by the user's scope selection — same
  // logic the schedule card uses internally to derive `visibleTechs`.
  // Lifted here so the page can estimate stacked content size for the
  // row-span heuristic without duplicating the filter inside the card.
  // Declared before `scheduleActiveTechCount` because that memo reads
  // it (the prior order produced a TS2448 use-before-declare).
  const scheduleVisibleTechs = useMemo(() => {
    if (scheduleTechs.length <= 1) return scheduleTechs;
    if (
      scheduleScopeIds.length === 0 ||
      scheduleScopeIds.length === scheduleTechs.length
    ) {
      return scheduleTechs;
    }
    return scheduleTechs.filter((t) => scheduleScopeIds.includes(t.technicianId));
  }, [scheduleTechs, scheduleScopeIds]);
  // 2026-05-07 RALPH (idle grouping): width is now derived from
  // the count of ACTIVE technicians (those with at least one
  // booked block today). Idle technicians (no booked work) are
  // collapsed into a single grouped "Available" column inside the
  // card and DO NOT widen the dashboard cell. This keeps the
  // dashboard dense — a team of 5 with 2 actively booked techs
  // renders in a 2-unit cell with a grouped "Available" column
  // tucked alongside, instead of forcing the schedule to full
  // width to host 3 empty columns.
  //
  // Mapping:
  //   • 0 active (all idle)  → 1 unit (compact)
  //   • 1 active             → 1 unit
  //   • 2–3 active           → 2 units
  //   • 4+ active            → 3 units (full width)
  const scheduleActiveTechCount = useMemo(
    () =>
      scheduleVisibleTechs.filter((t) =>
        t.scheduleBlocks.some((b) => b.kind === "booked"),
      ).length,
    [scheduleVisibleTechs],
  );
  const todaysScheduleWidthUnits: 1 | 2 | 3 =
    scheduleActiveTechCount <= 1
      ? 1
      : scheduleActiveTechCount <= 3
        ? 2
        : 3;
  // 2026-05-07 RALPH: schedule display mode lifted to the page so the
  // page can derive the width + row-span overrides for the Today's
  // Schedule grid cell. Stacked mode forces a 1-column width (the
  // techs are already arranged vertically inside the card, so a wide
  // 2/3 or 3/3 cell would just leave empty horizontal space). Row
  // span doubles when the stacked content is large enough that the
  // standard 300 px card would clip too much (heuristic below).
  const [scheduleDisplayMode, setScheduleDisplayMode] = useState<
    "column" | "stacked"
  >("column");
  // Heuristic for "stacked content exceeds standard card height".
  // Each tech section in stacked mode is ≈ 1 header row + N slot
  // rows × ~30 px each, plus the card chrome (~46 px header). 7+
  // total content rows pushes the visible content past the 300 px
  // card, triggering a row-span-2 (≈ 612 px) cell.
  const scheduleStackedContentRows = useMemo(
    () =>
      scheduleVisibleTechs.reduce(
        (sum, t) => sum + 1 + t.scheduleBlocks.length,
        0,
      ),
    [scheduleVisibleTechs],
  );
  const scheduleStackedNeedsDoubleHeight =
    scheduleDisplayMode === "stacked" && scheduleStackedContentRows > 6;
  // In stacked mode, force 1-column width (the brief: "Set width to
  // 1-column (one-third)"). In column mode, fall back to the
  // tech-count → unit mapping from the previous iteration.
  const todaysScheduleWidthUnitsResolved: 1 | 2 | 3 =
    scheduleDisplayMode === "stacked" ? 1 : todaysScheduleWidthUnits;
  const widgetWidthOverrides = useMemo<Record<string, 1 | 2 | 3>>(
    () => ({ todays_schedule: todaysScheduleWidthUnitsResolved }),
    [todaysScheduleWidthUnitsResolved],
  );
  const widgetRowSpanOverrides = useMemo<Record<string, 1 | 2>>(
    () => ({
      todays_schedule: scheduleStackedNeedsDoubleHeight ? 2 : 1,
    }),
    [scheduleStackedNeedsDoubleHeight],
  );
  // 2026-05-07 RALPH: card HEIGHT no longer depends on visible
  // technician count. All dashboard cards use the canonical `summary`
  // heightPreset; Today's Schedule scrolls its body internally if
  // content overflows. The previous height-override mechanism is
  // intentionally NOT used for Today's Schedule — width stays
  // dynamic, height stays fixed.
  //
  // The compact-header flag still tracks the 1-column case so the
  // card header stays readable in a 1/3 cell.
  const todaysScheduleCompact = todaysScheduleWidthUnits === 1;

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
        <div className="mb-4 flex items-start justify-between gap-3 border-b border-card-border pb-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground tracking-tight">
              Business Dashboard
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Pipeline, collections, scheduled revenue, and today's schedule — at a glance.
            </p>
          </div>
          {/* 2026-05-07 RALPH: customize affordance opens the right-side
              Sheet that backs the customizable dashboard framework.
              Compact `size="sm"` button, ghost variant — same density
              as the existing `View all` controls elsewhere on the page. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 h-8 text-xs"
            onClick={() => setCustomizeOpen(true)}
            data-testid="dashboard-customize-button"
          >
            <Sliders className="h-3.5 w-3.5 mr-1.5" />
            Customize
          </Button>
        </div>

        {/* 2026-05-07 RALPH — registry-driven dashboard widget grid.
            The page still owns data-fetching + handler wiring; the
            `renderers` map binds each widget key to a fully-prepared
            ReactNode. The framework's `<DashboardWidgetGrid>` resolves
            the visible widgets in user-saved order and lays them out
            on a 12-column grid keyed off each widget's registry-
            declared `sizePreset`. The previous three hardcoded grid
            rows (Top: Schedule + Alerts / Middle: Pipeline + Collections
            + Scheduled / Bottom: Needs Attention) are recreated as
            sizePresets in `shared/dashboardWidgetRegistry.ts`. */}
        <DashboardWidgetGrid
          widgets={layout.visibleWidgets}
          widthOverrides={widgetWidthOverrides}
          rowSpanOverrides={widgetRowSpanOverrides}
          onReorder={layout.setOrder}
          renderers={{
            todays_schedule: (
              <TodaysScheduleCard
                onOpenVisit={(visitState) => setEditorState(visitState)}
                onOpenSlot={(s) => setSlot(s)}
                unscheduledJobsCount={unscheduledJobsCount}
                scopeIds={scheduleScopeIds}
                onScopeIdsChange={setScheduleScopeIds}
                compact={todaysScheduleCompact}
                displayMode={scheduleDisplayMode}
                onDisplayModeChange={setScheduleDisplayMode}
              />
            ),
            operational_alerts: (
              <OperationalAlertsCard
                requiresAttentionCount={requiresAttentionCount}
                pastDueCount={pastDueCount}
                unscheduledCount={unscheduledJobsCount}
                readyToInvoiceCount={readyToInvoiceCount}
                invoicesNotSentCount={data?.needsAttention.invoicesNotSentCount ?? 0}
                isLoading={workflowQuery.isLoading || isLoading}
                onOpenActionModal={openActionModal}
                order={["requires_attention", "past_due", "unscheduled", "ready_to_invoice", "invoices_not_sent"]}
              />
            ),
            pipeline_snapshot: (
              <PipelineSnapshotCard
                data={data}
                isLoading={isLoading}
                onOpenActionModal={openActionModal}
              />
            ),
            collections_overview: (
              <CollectionsOverviewCard
                data={data}
                isLoading={isLoading}
                onOpenInvoice={(invoiceId, customerCompanyId) => {
                  if (customerCompanyId) {
                    setCollectionsModalCustomerCompanyId(customerCompanyId);
                  } else {
                    setLocation(`/invoices/${invoiceId}`);
                  }
                }}
                onOpenCustomer={(id) => setCollectionsModalCustomerCompanyId(id)}
              />
            ),
            scheduled_revenue: (
              <ScheduledRevenueCard
                data={data}
                isLoading={isLoading}
                onOpenJob={(id) => setLocation(`/jobs/${id}`)}
              />
            ),
            // 2026-05-07: needs_attention renderer entry intentionally
            // removed. The card's only row ("Invoices not sent") was
            // absorbed into OperationalAlertsCard; see the
            // invoicesNotSentCount prop threaded into operational_alerts above.
            tasks_overview: (
              <TasksOverviewCard />
            ),
          }}
        />
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
      {/* 2026-05-07 RALPH: customizable dashboard framework drawer.
          Right-side Sheet with widget visibility toggles + drag-handle
          reorder + reset. Single instance per page; the framework
          owns its own data fetch + persistence via useDashboardLayout. */}
      <DashboardCustomizeDrawer
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        dashboardKey="financial"
      />
      {/* Canonical alert modal — same one Operations opens. Single modal
          instance per page; mode switches in place when a different alert
          row is clicked. */}
      <DashboardActionModal
        open={actionModalOpen}
        onOpenChange={setActionModalOpen}
        mode={actionModalMode}
      />
      {collectionsModalCustomerCompanyId && (
        <ClientCollectionsModal
          open={!!collectionsModalCustomerCompanyId}
          onOpenChange={(open) => {
            if (!open) setCollectionsModalCustomerCompanyId(null);
          }}
          customerCompanyId={collectionsModalCustomerCompanyId}
          variant="modal"
        />
      )}
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

// ---------------------------------------------------------------------------
// Card definitions for the financial dashboard.
//   PipelineSnapshotCard, CollectionsOverviewCard, ScheduledRevenueCard
//   compose the second row (3-column grid via the canonical widget grid).
//
//   All consume `/api/dashboard/financial` (the canonical summary
//   endpoint, extended with `pipelineSnapshot`, `scheduledRevenue`, and
//   `needsAttention` fields in `server/storage/dashboard.ts`). No new
//   HTTP endpoint, no client-side aggregation, no fake data.
//
//   2026-05-07: the standalone NeedsAttentionCard was removed and its
//   sole row ("Invoices not sent") absorbed into OperationalAlertsCard.
//   The `needsAttention.invoicesNotSentCount` field on the financial
//   summary is still consumed — by Operational Alerts now — so the
//   storage helper + endpoint stay unchanged.
// ---------------------------------------------------------------------------

// ── PipelineSnapshotCard ────────────────────────────────────────────────────

// 2026-05-06 RALPH redesign: Pipeline is now an actionable sales queue.
// Each row maps 1:1 to a DashboardActionMode — clicking a row's View
// button opens the same shared dashboard action modal the Operational
// Alerts and Needs Attention rows use. Counts come from the same
// /api/dashboard/financial aggregate (no parallel data source). Closed
// / lost / converted records are excluded by the underlying SQL.
interface PipelineSnapshotCardProps {
  data?: FinancialSummary;
  isLoading: boolean;
  onOpenActionModal: (mode: DashboardActionMode) => void;
}

function PipelineSnapshotCard({
  data,
  isLoading,
  onOpenActionModal,
}: PipelineSnapshotCardProps) {
  const p = data?.pipelineSnapshot;
  const rows = [
    {
      key: "leads-followup",
      label: "Leads needing follow-up",
      count: p?.leadsFollowUpCount ?? 0,
      mode: "pipeline_leads_followup" as const,
    },
    {
      key: "quotes-not-sent",
      label: "Quotes not sent",
      count: p?.quotesNotSentCount ?? 0,
      mode: "pipeline_quotes_not_sent" as const,
    },
    {
      key: "quotes-awaiting-response",
      label: "Quotes awaiting response",
      count: p?.quotesAwaitingResponseCount ?? 0,
      mode: "pipeline_quotes_awaiting_response" as const,
    },
    {
      key: "stale-opportunities",
      label: "Stale opportunities",
      count: p?.staleOpportunitiesCount ?? 0,
      mode: "pipeline_stale_opportunities" as const,
    },
  ];
  const totalActionable = rows.reduce((sum, r) => sum + r.count, 0);
  const showEmpty = !isLoading && totalActionable === 0;

  return (
    <CardShell className="flex flex-col h-full">
      <CardShellHeader>
        <CardShellTitle icon={TrendingUp} iconColor="text-indigo-600">Pipeline</CardShellTitle>
      </CardShellHeader>
      <div data-testid="pipeline-snapshot">
        {isLoading ? (
          <div className="p-3 space-y-1.5">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-6 w-full" />)}
          </div>
        ) : showEmpty ? (
          <div
            className="px-4 py-3 text-sm text-muted-foreground"
            data-testid="pipeline-empty"
          >
            No pipeline actions need attention.
          </div>
        ) : (
          <ul>
            {rows.map((r, idx) => (
              <li key={r.key}>
                <PipelineActionRow
                  testId={`pipeline-row-${r.key}`}
                  label={r.label}
                  count={r.count}
                  isLast={idx === rows.length - 1}
                  onView={() => onOpenActionModal(r.mode)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </CardShell>
  );
}

// 2026-05-06 RALPH polish: row geometry + typography mirror
// `<OperationalAlertsCard>` exactly — `px-3 py-1.5 gap-2`, label
// `text-xs font-medium`, count `text-sm font-semibold tabular-nums` on
// the right. The whole row is the click target (no inner View
// button); `<button>` element handles tabIndex / Enter / Space and
// gives a free `disabled` muted state when the bucket is empty.
function PipelineActionRow({
  label,
  count,
  onView,
  testId,
  isLast,
}: {
  label: string;
  count: number;
  onView: () => void;
  testId: string;
  isLast: boolean;
}) {
  const hasItems = count > 0;
  return (
    <button
      type="button"
      onClick={onView}
      disabled={!hasItems}
      data-testid={testId}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors",
        !isLast && "border-b border-card-border",
        hasItems
          ? "hover:bg-primary/5 focus-visible:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-300"
          : "cursor-default",
      )}
    >
      <span
        className={cn(
          "flex-1 text-xs font-medium truncate",
          hasItems ? "text-slate-700" : "text-slate-400",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "text-sm font-semibold tabular-nums shrink-0",
          hasItems ? "text-foreground" : "text-slate-400",
        )}
      >
        {count}
      </span>
    </button>
  );
}

// ── CollectionsOverviewCard ─────────────────────────────────────────────────

interface CollectionsOverviewCardProps {
  data?: FinancialSummary;
  isLoading: boolean;
  /** Second arg is customerCompanyId — present when the invoice row has it. */
  onOpenInvoice: (invoiceId: string, customerCompanyId: string | null) => void;
  onOpenCustomer: (customerCompanyId: string) => void;
}

function CollectionsOverviewCard({
  data,
  isLoading,
  onOpenInvoice,
  onOpenCustomer,
}: CollectionsOverviewCardProps) {
  const ar = data?.ar;
  const outstandingTotal = ar?.outstandingTotal ?? 0;
  const pastDueTotal = ar?.pastDueTotal ?? 0;
  const customerBalances = (data?.topCustomerBalances ?? []).slice(0, 3);
  // 2026-05-06 — strict overdue filter. The "Overdue invoices" list is
  // semantically OVERDUE-only: drop any unpaid invoice whose due date has
  // not yet passed (`daysLate <= 0` or null). The empty state below is the
  // intended fallback when nothing is past due — we never backfill with
  // current/not-yet-due rows from `topOutstandingInvoices`.
  const overdueInvoices = (data?.topOutstandingInvoices ?? [])
    .filter((inv) => (inv.daysLate ?? 0) > 0)
    .slice(0, 3);

  return (
    <CardShell className="flex flex-col h-full">
      <CardShellHeader>
        <CardShellTitle icon={Receipt} iconColor="text-amber-600">Collections</CardShellTitle>
      </CardShellHeader>
      {/* Compact summary strip — Outstanding + Overdue stacked single-column.
          Phase 1 responsive: 2-column removed to prevent crowding at iPad card widths. */}
      <div
        className="grid grid-cols-1 gap-1.5 px-3 py-2 border-b border-card-border"
        data-testid="collections-summary-strip"
      >
        <CardMetricBlock
          align="start"
          label="Outstanding"
          value={isLoading ? <Skeleton className="h-4 w-16" /> : formatCurrency(outstandingTotal)}
          data-testid="collections-summary-outstanding"
        />
        <CardMetricBlock
          align="start"
          label="Overdue"
          value={isLoading ? <Skeleton className="h-4 w-16" /> : formatCurrency(pastDueTotal)}
          valueClassName={pastDueTotal > 0 ? "text-destructive" : undefined}
          data-testid="collections-summary-overdue"
        />
      </div>

      {/* Lower section — single column for readability at all card widths.
          The 2-column side-by-side layout was removed because it crowded
          customer name + balance rows at iPad card widths (≤512px). */}
      <div className="grid grid-cols-1 divide-y divide-card-border">
        <div>
          <div className="px-3 pt-2 pb-1 text-label text-muted-foreground">
            Top customers
          </div>
          <div data-testid="collections-customers-list">
            {isLoading ? (
              <div className="px-3 pb-2 space-y-1">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-5" />)}
              </div>
            ) : customerBalances.length === 0 ? (
              <div className="px-3 pb-2 text-helper text-muted-foreground">None.</div>
            ) : (
              <div>
                {customerBalances.map((c) => {
                  const hasOverdue = c.overdue > 0;
                  return (
                    <button
                      key={c.customerCompanyId}
                      type="button"
                      onClick={() => onOpenCustomer(c.customerCompanyId)}
                      className="w-full text-left px-3 py-1.5 hover:bg-primary/5 transition-colors flex items-center gap-2"
                      data-testid={`collections-customer-${c.customerCompanyId}`}
                    >
                      <span className="flex-1 text-row text-foreground truncate">
                        {c.name ?? "Unnamed"}
                      </span>
                      <span className={cn(
                        "text-row font-semibold tabular-nums shrink-0",
                        hasOverdue ? "text-destructive" : "text-foreground",
                      )}>
                        {formatCurrency(c.outstanding)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="px-3 pt-2 pb-1 text-label text-muted-foreground">
            Overdue invoices
          </div>
          <div data-testid="collections-invoices-list">
            {isLoading ? (
              <div className="px-3 pb-2 space-y-1">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-5" />)}
              </div>
            ) : overdueInvoices.length === 0 ? (
              <div className="px-3 pb-2 text-helper text-muted-foreground">No overdue invoices.</div>
            ) : (
              <div>
                {overdueInvoices.map((inv) => {
                  const isOverdue = (inv.daysLate ?? 0) > 0;
                  return (
                    <button
                      key={inv.id}
                      type="button"
                      onClick={() => onOpenInvoice(inv.id, inv.customerCompanyId ?? null)}
                      className="w-full text-left px-3 py-1.5 hover:bg-primary/5 transition-colors flex items-center gap-2"
                      data-testid={`collections-invoice-${inv.id}`}
                    >
                      <span className="flex-1 text-row text-foreground truncate">
                        {inv.customerName ?? inv.locationName ?? "Unknown"}
                        {inv.invoiceNumber && (
                          <span className="text-helper text-muted-foreground"> · #{inv.invoiceNumber}</span>
                        )}
                      </span>
                      <span className={cn(
                        "text-row font-semibold tabular-nums shrink-0",
                        isOverdue ? "text-destructive" : "text-foreground",
                      )}>
                        {formatCurrencyPrecise(inv.balance)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </CardShell>
  );
}

// ── ScheduledRevenueCard ────────────────────────────────────────────────────

interface ScheduledRevenueCardProps {
  data?: FinancialSummary;
  isLoading: boolean;
  onOpenJob: (jobId: string) => void;
}

function ScheduledRevenueCard({
  data,
  isLoading,
  onOpenJob,
}: ScheduledRevenueCardProps) {
  const sr = data?.scheduledRevenue;
  return (
    <CardShell className="flex flex-col h-full">
      <CardShellHeader>
        <CardShellTitle icon={CalendarIcon} iconColor="text-emerald-600">Scheduled Revenue</CardShellTitle>
      </CardShellHeader>
      <div data-testid="scheduled-revenue">
        {isLoading ? (
          <div className="p-3 space-y-1.5">
            {[0, 1].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : (
          <>
            {/* KPI strip — Today / Next 7d / Next 30d. Stacked by default;
                switches to 3-column at xl (≥1280px) where each cell has
                sufficient width for currency values without wrapping. */}
            <div
              className="grid grid-cols-1 xl:grid-cols-3 divide-y xl:divide-y-0 xl:divide-x divide-card-border border-b border-card-border"
              data-testid="scheduled-kpi-grid"
            >
              <CardMetricBlock align="start" emphasis className="px-2.5 py-2" label="Today" value={formatCurrency(sr?.todayValue ?? 0)} data-testid="scheduled-today" />
              <CardMetricBlock align="start" emphasis className="px-2.5 py-2" label="Next 7 days" value={formatCurrency(sr?.next7DaysValue ?? 0)} data-testid="scheduled-7d" />
              <CardMetricBlock align="start" emphasis className="px-2.5 py-2" label="Next 30 days" value={formatCurrency(sr?.next30DaysValue ?? 0)} data-testid="scheduled-30d" />
            </div>
            <div className="px-3 pt-2 pb-1 text-label text-muted-foreground">
              Upcoming high-value
            </div>
            <div data-testid="scheduled-upcoming-list">
              {!sr || sr.upcomingHighValueJobs.length === 0 ? (
                <div className="px-3 pb-2 text-helper text-muted-foreground">No upcoming jobs with reliable value.</div>
              ) : (
                <div>
                  {sr.upcomingHighValueJobs.map((j) => {
                    return (
                      <button
                        key={j.id}
                        type="button"
                        onClick={() => onOpenJob(j.id)}
                        className="w-full text-left px-3 py-1.5 hover:bg-primary/5 transition-colors flex items-center gap-2"
                        data-testid={`scheduled-job-${j.id}`}
                      >
                        <span className="flex-1 text-xs text-foreground truncate">
                          #{j.jobNumber}
                          {j.customerName && (
                            <span className="text-muted-foreground"> · {j.customerName}</span>
                          )}
                        </span>
                        <span className="text-xs font-semibold tabular-nums shrink-0 text-foreground">
                          {formatCurrency(j.value)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="px-3 py-1.5 text-helper text-muted-foreground border-t border-card-border">
              Based on scheduled jobs.
            </div>
          </>
        )}
      </div>
    </CardShell>
  );
}


// 2026-05-07 — NeedsAttentionCard removed. Its sole row ("Invoices not
// sent") was absorbed into the bottom of OperationalAlertsCard via the
// new `invoices_not_sent` row + mode. The standalone card was effectively
// a placeholder duplicating the operational-alert concept; consolidating
// removes the empty-card / mismatched-card-row visual artifact and keeps
// every triage signal in one place. Persisted user layouts that
// referenced the retired `needs_attention` widget degrade safely — the
// resolver iterates the registry, not the override rows. The migration
// `2026_05_07_drop_needs_attention_widget.sql` sweeps the orphan rows
// for hygiene.

interface CapacityBlockDto {
  kind: "booked" | "open" | "time_off" | "task";
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
  /** 2026-05-07 RALPH (technician time off): present on time_off
   *  blocks only. Reason from the canonical
   *  TECHNICIAN_TIME_OFF_REASONS union. */
  reason?: string;
  note?: string | null;
  timeOffId?: string;
  allDay?: boolean;
  /** 2026-05-12 RALPH: present on task blocks only. */
  taskId?: string;
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
interface OffRosterAssignmentDto {
  /** Set for visit rows. Absent for task rows. */
  visitId?: string;
  /** Set for visit rows. Absent for task rows. */
  jobId?: string;
  /** Set for task rows. Absent for visit rows. */
  taskId?: string;
  title: string;
  companyName: string | null;
  technicianName: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
}
interface CapacityResponseDto {
  timezone: string;
  technicians: CapacityTechDto[];
  /** 2026-05-04: visits assigned to non-schedulable technicians.
   *  Capacity math (capacity %, available minutes, open slots) is
   *  unaffected — these are listed separately so dispatchers still see
   *  every booked visit even when the assignee is disabled / off-roster. */
  offRosterAssignments?: OffRosterAssignmentDto[];
}

function TodaysScheduleCard({
  onOpenVisit,
  onOpenSlot,
  unscheduledJobsCount,
  scopeIds,
  onScopeIdsChange,
  compact = false,
  displayMode,
  onDisplayModeChange,
}: {
  onOpenVisit: (state: VisitEditorState) => void;
  onOpenSlot: (slot: QuickCreateSlot) => void;
  /** 2026-05-06 Phase 1 — feeds the compact "N Unscheduled" indicator next to
   *  the title. Sourced from `/api/dashboard/workflow.jobs.unscheduledCount` —
   *  the same value `OperationalAlertsCard` already consumes; passed in here
   *  rather than re-fetched so the two surfaces stay in lockstep. */
  unscheduledJobsCount: number;
  /** 2026-05-07 RALPH (3-col grid) — schedule scope is now CONTROLLED
   *  by the page so the page can compute Today's Schedule's runtime
   *  width unit (1 / 2 / 3) from the visible team count and pass it
   *  to <DashboardWidgetGrid> as a width override. */
  scopeIds: string[];
  onScopeIdsChange: (next: string[] | ((prev: string[]) => string[])) => void;
  /** 2026-05-07 RALPH: page-supplied flag set to `true` when the grid
   *  cell is only 1 column wide (1 visible team member). The header
   *  collapses to "Today" + the team filter only — booked %, scope
   *  suffix, and the Create button are all suppressed so the title
   *  row never wraps in a 1/3-width card. */
  compact?: boolean;
  /** 2026-05-07 RALPH: display mode is CONTROLLED by the page so the
   *  page can derive the schedule cell's width / row-span overrides.
   *  `"column"` → side-by-side per-tech columns (default).
   *  `"stacked"` → vertical tech sections; the page narrows the cell
   *  to 1 column wide and conditionally row-spans 2 when content is
   *  large enough to need it. */
  displayMode: "column" | "stacked";
  onDisplayModeChange: (next: "column" | "stacked") => void;
}) {
  const [, setLocation] = useLocation();
  const setScopeIds = onScopeIdsChange;
  // 2026-04-30 — open-only filter for the schedule card. State is local to
  // this card so it doesn't bleed into Operational Alerts / Revenue /
  // anywhere else on the dashboard. Composes with `scopeIds` (team filter)
  // by filtering the per-tech `scheduleBlocks` AFTER the team filter has
  // already produced `activeTechs` — both filters layer cleanly in a
  // single derivation step downstream.
  const [openOnly, setOpenOnly] = useState(false);
  // 2026-05-07 RALPH (technician time off): modal state for the
  // "Add time off" entry point in the team-filter Popover footer.
  // The modal posts to /api/technician-time-off and invalidates the
  // capacity query so the schedule card reflects the new entry on
  // the next refetch (no manual refresh required).
  const [timeOffModalOpen, setTimeOffModalOpen] = useState(false);
  const [timeOffDefaultTechId, setTimeOffDefaultTechId] = useState<
    string | undefined
  >(undefined);
  // 2026-05-07 RALPH: display mode is CONTROLLED by the page (props).
  // Local aliases below keep the rest of this component readable.
  const scheduleDisplayMode = displayMode;

  const capacityQuery = useQuery<CapacityResponseDto>({
    queryKey: ["/api/dashboard/capacity"],
    queryFn: () => apiRequest<CapacityResponseDto>("/api/dashboard/capacity"),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    // 2026-05-07 RALPH (regression fix): cap retries at 1 so a
    // backend error (e.g., missing time_off table) surfaces in
    // ~1-2 s instead of ~30 s through React Query's default
    // exponential-backoff retry chain. Users see the inline error
    // state + Retry button immediately and can refetch once the
    // backend recovers.
    retry: 1,
  });

  const techs = capacityQuery.data?.technicians ?? [];
  const isMultiTech = techs.length > 1;

  // 2026-05-06 Phase 1 — compact capacity indicators in the header.
  const isAllTeam =
    !isMultiTech ||
    scopeIds.length === 0 ||
    scopeIds.length === techs.length;

  const activeTechs = useMemo(() => {
    if (!isMultiTech) return techs;
    if (isAllTeam) return techs;
    return techs.filter((t) => scopeIds.includes(t.technicianId));
  }, [techs, scopeIds, isMultiTech, isAllTeam]);

  // 2026-05-01: dashboard re-clamp tick. The server's
  // `/api/dashboard/capacity` returns each tech's full workday
  // (`scheduleBlocks` is unclamped), so the row label and the
  // click-prefilled start time must both be derived from a clamped
  // copy here. We anchor the clamp to `nowTickMs` (state) instead of
  // `Date.now()` so the schedule rows refresh on a known cadence
  // even if no other event triggers a re-render. The `useEffect`
  // below aligns the FIRST tick to the next 15-minute wall-clock
  // boundary, then ticks every 15 minutes — exactly when a new
  // open-slot start is unlocked / the prior one rolls off.
  const [nowTickMs, setNowTickMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const initialDelay = roundUpToNextInterval(Date.now(), 15) - Date.now();
    let interval: ReturnType<typeof setInterval> | null = null;
    const timeout = setTimeout(() => {
      setNowTickMs(Date.now());
      interval = setInterval(() => setNowTickMs(Date.now()), 15 * 60_000);
    }, Math.max(initialDelay, 1));
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);
  const nowMs = nowTickMs;

  // Per-column row filter. When `openOnly` is on, every visible tech keeps
  // its column slot but the booked rows are dropped. A column with zero
  // open slots renders the per-state empty copy below ("No open slots")
  // instead of disappearing — this preserves layout stability when the
  // user toggles the filter on/off, and gives selected technicians
  // explicit "nothing for you to take" feedback rather than silently
  // hiding them.
  //
  // 2026-05-01: open blocks are also clamped via `clampOpenBlockToNow`
  // here so EVERY consumer downstream (display row, click handler) sees
  // the same already-clamped block. The helper is a no-op for booked
  // blocks and for open blocks whose start is already at/after the next
  // 15-minute boundary, so future-day slots and entirely-future "today"
  // slots pass through unchanged. Open blocks whose entire window is in
  // the past return `null` and are dropped from the column.
  const visibleTechs = useMemo(() => {
    const mapped = activeTechs.map((t) => {
      const filtered = openOnly
        ? t.scheduleBlocks.filter((b) => b.kind === "open")
        : t.scheduleBlocks;
      const clamped: CapacityBlockDto[] = [];
      for (const block of filtered) {
        const next = clampOpenBlockToNow(block, nowMs, 15);
        if (next === null) continue;
        clamped.push(next);
      }
      return { ...t, scheduleBlocks: clamped };
    });
    // 2026-05-07 RALPH: workload-driven ordering. The capacity
    // payload returns techs in source/alphabetic order; for the
    // dashboard's information flow we want the busiest tech leftmost
    // (column mode) / topmost (stacked mode). Sort priority:
    //   1. Booked-visit count desc — tasks and open slots do NOT count.
    //      Task-only techs rank below techs with at least one visit.
    //   2. Total booked+task duration desc — tasks act as secondary
    //      weight only, breaking ties between techs with equal visit counts.
    //   3. Earliest booked/task start time asc — earlier = earlier
    //      visible signal of the day.
    //   4. Display name asc — stable tie-breaker.
    // This is DISPLAY-ORDER ONLY: assignment data, per-tech capacity
    // blocks, and slot availability are all unchanged — they read from
    // `techs` / `activeTechs` upstream of this sort.
    return mapped.slice().sort((a, b) => {
      // Primary: customer visit count desc — open slots and tasks excluded.
      const aBooked = a.scheduleBlocks.filter((x) => x.kind === "booked");
      const bBooked = b.scheduleBlocks.filter((x) => x.kind === "booked");
      if (aBooked.length !== bBooked.length) {
        return bBooked.length - aBooked.length;
      }
      // Secondary: total booked+task duration desc — tasks secondary weight.
      const aWork = a.scheduleBlocks.filter((x) => x.kind === "booked" || x.kind === "task");
      const bWork = b.scheduleBlocks.filter((x) => x.kind === "booked" || x.kind === "task");
      const aDur = aWork.reduce((s, x) => s + (x.durationMinutes ?? 0), 0);
      const bDur = bWork.reduce((s, x) => s + (x.durationMinutes ?? 0), 0);
      if (aDur !== bDur) return bDur - aDur;
      const aStart =
        aWork.length > 0
          ? Math.min(...aWork.map((x) => Date.parse(x.startISO)))
          : Number.POSITIVE_INFINITY;
      const bStart =
        bWork.length > 0
          ? Math.min(...bWork.map((x) => Date.parse(x.startISO)))
          : Number.POSITIVE_INFINITY;
      if (aStart !== bStart) return aStart - bStart;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
  }, [activeTechs, openOnly, nowMs]);

  // 2026-05-07 RALPH (idle grouping): classify techs by whether
  // their RAW capacity (pre-`openOnly` filter, post-team-scope
  // filter) contains any booked blocks. Open slots do NOT count.
  // The classification reads from `activeTechs` (the upstream
  // scope-filtered slice) so it stays stable even when the user
  // toggles the open-only filter — flipping the display filter
  // shouldn't reclassify an actively booked tech as "available."
  const techActiveSet = useMemo(() => {
    const set = new Set<string>();
    for (const t of activeTechs) {
      if (t.scheduleBlocks.some((b) => b.kind === "booked" || b.kind === "task")) {
        set.add(t.technicianId);
      }
    }
    return set;
  }, [activeTechs]);

  // Partition the sorted-by-workload `visibleTechs` for column-mode
  // rendering. Active techs keep their workload order (busiest
  // leftmost); idle techs get re-sorted alphabetically because
  // workload is uniformly zero among them.
  const activeTechsForRender = useMemo(
    () => visibleTechs.filter((t) => techActiveSet.has(t.technicianId)),
    [visibleTechs, techActiveSet],
  );
  const idleTechsForRender = useMemo(
    () =>
      visibleTechs
        .filter((t) => !techActiveSet.has(t.technicianId))
        .slice()
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    [visibleTechs, techActiveSet],
  );
  const hasIdleGroup = idleTechsForRender.length > 0;
  const hasUnassigned = (capacityQuery.data?.offRosterAssignments?.length ?? 0) > 0;
  // Effective column count for the column-mode multi-tech grid:
  // each active tech is one column, plus ONE column for the
  // grouped "Available" pile if any idle tech exists, plus ONE
  // for "Unassigned" when off-roster visits are present.
  const effectiveColumnCount =
    activeTechsForRender.length + (hasIdleGroup ? 1 : 0) + (hasUnassigned ? 1 : 0);

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

  // 2026-05-07 RALPH: `openAdd` (and its predecessor "+ Create"
  // button) was removed. The slot-click handler below remains the
  // canonical create path — clicking an open slot still launches the
  // tech/time-prefilled create flow via `onOpenSlot`. Users wanting
  // an unprefilled create use the global "+ New" button in the top
  // nav.

  const handleBlockClick = async (tech: CapacityTechDto, block: CapacityBlockDto) => {
    if (block.kind === "task") return; // task blocks are display-only in the dashboard tile
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

  // 2026-05-04: off-roster row click reuses the canonical visit-editor
  // path so editing flows through one launcher (no duplicate modal logic).
  // 2026-05-12: task rows have no visitId/jobId — skip the editor for them.
  const handleOffRosterClick = async (row: OffRosterAssignmentDto) => {
    if (!row.visitId || !row.jobId) return;
    const state = await enrichVisitEditorState(row.visitId, row.jobId);
    onOpenVisit(state);
  };

  const offRosterRows = capacityQuery.data?.offRosterAssignments ?? [];

  // 2026-05-07 RALPH: stacked-mode header layout flag. In stacked
  // mode the title becomes "Schedule" (instead of "Today"), the
  // booked-% / unscheduled chip is suppressed, the scope-suffix is
  // suppressed, and the controls cluster moves to a second row so
  // it never has to wrap inside the 1/3-width card. The
  // display-mode toggle is also force-shown in stacked mode (even
  // though `compact` is true, since stacked drops the cell to 1
  // unit wide) so the user can switch back.
  const isStackedMode = scheduleDisplayMode === "stacked";
  // 2026-05-07 RALPH (regression fix): toggle visibility now gates
  // on `isMultiTech` (the company has ≥ 2 schedulable techs), NOT
  // on `!compact`. The previous rule hid the toggle whenever the
  // page reduced widthUnits to 1, which (after idle-grouping +
  // ACTIVE-driven width derivation) happens whenever zero techs are
  // currently active — leaving the user stuck in stacked mode with
  // no way to switch back. Stacked mode itself is also a "show the
  // toggle" trigger so the user can always reach the column option
  // even if they're solo-tech (defensive).
  //
  // The brief: "Display-mode toggle should be hidden only when truly
  // invalid, not while loading or after a data issue."
  const showDisplayModeToggle = isStackedMode || isMultiTech;

  // Extracted control JSX — shared between the stacked 2-row header
  // and the default single-row header so we don't duplicate it.
  const openOnlyToggleControl = (
    <button
      type="button"
      onClick={() => setOpenOnly((v) => !v)}
      aria-pressed={openOnly}
      className={`inline-flex items-center h-8 px-3 text-xs font-medium rounded-md border transition-colors ${
        openOnly
          ? "border-[#76B054] bg-[#76B054] text-white hover:bg-[#68a14a]"
          : "border-[#e2e8f0] bg-white text-slate-700 hover:bg-slate-50"
      }`}
      data-testid="schedule-open-only-toggle"
    >
      Open
    </button>
  );
  const teamFilterControl = isMultiTech ? (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md border border-[#e2e8f0] bg-white text-slate-700 hover:bg-slate-50"
          data-testid="schedule-scope-filter"
        >
          {/* In stacked mode, suppress the verbose `scopeLabel` (which
              can be a comma-separated list of names) so the trigger
              fits the narrower layout. The count badge to the right
              still communicates how many techs are selected. */}
          <span className="truncate max-w-[6rem]">
            {isStackedMode ? "Team" : scopeLabel}
          </span>
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
            {/* 2026-05-07 RALPH (technician time off): canonical
                entry point for the Add Time Off modal. Sits next to
                Manage Team because both are team-availability admin
                actions. The modal preselects no specific tech here
                — the user picks one inside the form. */}
            <button
              type="button"
              onClick={() => {
                setTimeOffDefaultTechId(undefined);
                setTimeOffModalOpen(true);
              }}
              className="w-full text-left px-3 py-2 text-xs text-[#76B054] font-medium hover:bg-slate-50 hover:underline border-t border-[#e2e8f0]"
              data-testid="schedule-add-time-off"
            >
              Add time off →
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  ) : null;
  const displayModeToggleControl = showDisplayModeToggle ? (
    <button
      type="button"
      onClick={() =>
        onDisplayModeChange(
          scheduleDisplayMode === "column" ? "stacked" : "column",
        )
      }
      data-testid="schedule-display-mode-toggle"
      data-display-mode={scheduleDisplayMode}
      aria-label="Column display"
      title="Column display"
      className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-[#e2e8f0] bg-white text-slate-700 hover:bg-slate-50"
    >
      {isStackedMode ? (
        <LayoutGrid className="h-3.5 w-3.5" />
      ) : (
        <Columns className="h-3.5 w-3.5" />
      )}
    </button>
  ) : null;

  return (
    <CardShell className="flex flex-col h-full">
      {isStackedMode ? (
        // 2026-05-07 RALPH — stacked-mode header layout. Two rows
        // inside the same px-4 py-2 band so the header stays
        // visually compact:
        //   row 1: calendar icon + "Schedule" + icon-only mode
        //          toggle (right-aligned)
        //   row 2: Open + Team filter (only rendered if either
        //          control is meaningful for the current state)
        // The 1-tech case skips the toggle entirely (same rule as
        // the default header). Booked% / Unscheduled chips and the
        // scope suffix are dropped because they don't fit the narrow
        // 1/3-width card.
        <div
          className="px-4 py-2 border-b border-card-border flex flex-col gap-2"
          data-testid="todays-schedule-header"
          data-header-variant="stacked"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <CalendarIcon className="h-3.5 w-3.5 text-[#76B054] shrink-0" />
              <h3 className="text-sm font-semibold text-foreground truncate">
                Schedule
              </h3>
            </div>
            {displayModeToggleControl}
          </div>
          {(openOnlyToggleControl || teamFilterControl) && (
            <div className="flex items-center gap-2 flex-wrap">
              {openOnlyToggleControl}
              {teamFilterControl}
            </div>
          )}
        </div>
      ) : (
        // Default single-row header — preserved verbatim from the
        // pre-stacked layout so column mode stays untouched.
        <div
          className="px-4 py-2.5 border-b border-card-border flex items-center justify-between gap-3"
          data-testid="todays-schedule-header"
          data-header-variant="default"
        >
          <div className="flex items-center gap-2 min-w-0">
            <CalendarIcon className="h-3.5 w-3.5 text-[#76B054] shrink-0" />
            {/* 2026-05-07 RALPH: "Today" instead of "Today's Schedule".
                Shorter, fits cleanly in 1-column mode, and reads the
                same in 2/3-column mode for visual consistency. The
                `/ <scope>` suffix and the booked-% chip are suppressed
                entirely in compact mode so the header never wraps in
                a 1/3-width card. */}
            <h3 className="text-sm font-semibold text-foreground truncate">
              Today
              {!compact && scopeHeaderSuffix && (
                <>
                  {" "}
                  <span className="text-xs font-normal text-slate-500">
                    / {scopeHeaderSuffix}
                  </span>
                </>
              )}
            </h3>
            {/* Compact capacity indicator — unscheduled count only.
                Suppressed in compact mode so the 1-column header fits
                cleanly. */}
            {!compact && unscheduledJobsCount > 0 && (
              <div
                className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 shrink-0"
                data-testid="todays-schedule-capacity-indicators"
              >
                <span data-testid="capacity-indicator-unscheduled">
                  <span className="font-semibold tabular-nums text-slate-700">
                    {unscheduledJobsCount}
                  </span>{" "}
                  Unscheduled
                </span>
              </div>
            )}
          </div>
          {/* Header controls cluster — preserved single-row layout for
              column mode. `flex-wrap` lets the cluster wrap onto a
              second row at narrow tablet widths instead of
              horizontally overflowing the card. */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {openOnlyToggleControl}
            {teamFilterControl}
            {displayModeToggleControl}
          </div>
        </div>
      )}
      {/* 2026-04-26: body wrapper is `flex-1 flex flex-col` so the
          multi-tech grid below can stretch to the card's full height.
          Together with `DashCard`'s `h-full flex flex-col` this lets
          per-tech column dividers paint top-to-bottom regardless of
          how much content each column has.
          2026-05-07 RALPH: card height is now FIXED at the canonical
          `summary` preset (`h-[420px]`) regardless of technician
          count, so the body must scroll internally when a busy day
          has more rows than fit. `overflow-y-auto` + `min-h-0` lets
          the body claim its share of the fixed card height and
          scroll the surplus rows. */}
      <div
        className="flex-1 flex flex-col min-h-0 overflow-y-auto"
        data-testid="schedule-body-scroll"
      >
        {capacityQuery.isLoading ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : capacityQuery.isError ? (
          // 2026-05-07 RALPH (regression fix): explicit error state
          // when the capacity endpoint fails (e.g., a downstream
          // table is missing or the backend is restarting). Without
          // this branch, React Query's retry-with-backoff burned
          // ~30 s before the card settled on "No technicians in the
          // selected scope" — indistinguishable from a legitimate
          // empty-team scenario. The retry button calls refetch()
          // directly so the user can recover immediately once the
          // backend is healthy.
          <div className="p-4" data-testid="schedule-error-state">
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-row text-red-700 flex items-center justify-between gap-3">
              <span className="truncate">
                Couldn't load today's schedule.
                {capacityQuery.error instanceof Error
                  ? ` ${capacityQuery.error.message}`
                  : ""}
              </span>
              <button
                type="button"
                onClick={() => capacityQuery.refetch()}
                className="shrink-0 inline-flex items-center h-8 px-3 text-xs font-medium rounded-md border border-red-300 bg-white text-red-700 hover:bg-red-100"
                data-testid="schedule-error-retry"
              >
                Retry
              </button>
            </div>
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
                const isTask = block.kind === "task";
                const isTimeOff = block.kind === "time_off";
                const isLast = idx === arr.length - 1;
                const duration = formatDurationLabel(block.durationMinutes);
                const nameLabel = isTimeOff
                  ? `Time off${block.reason ? ` · ${block.reason}` : ""}`
                  : isTask
                    ? (block.title ?? "Task")
                    : isOpen
                      ? "Open Slot"
                      : (block.title ?? "Visit");
                // 2026-04-30: muted-state markers — see top-of-component
                // comment on `nowMs`. `isPastOpen` strikes past
                // availability; `isCompleted` strikes finished work
                // (status-driven, time-independent per spec).
                const isPastOpen = isOpen && Date.parse(block.endISO) < nowMs;
                const isCompleted = !isOpen && block.visitStatus === "completed";
                const isMuted = isPastOpen || isCompleted;
                return (
                  <button
                    key={`${tech.technicianId}-${block.startISO}-${block.visitId ?? block.timeOffId ?? block.taskId ?? "open"}-${idx}`}
                    type="button"
                    onClick={() => handleBlockClick(tech, block)}
                    disabled={isTask || isTimeOff}
                    className={`w-full text-left px-4 py-1.5 transition-colors flex items-center gap-3 group ${isTimeOff ? "bg-amber-50/60 cursor-default" : isTask ? "bg-indigo-50/60 cursor-default" : "hover:bg-[#F0F5F0]"} ${!isLast ? "border-b border-[#e2e8f0]" : ""} ${isPastOpen ? "opacity-60" : isCompleted ? "opacity-70" : ""}`}
                    data-testid={isTask ? `schedule-block-task-${block.taskId ?? `${tech.technicianId}-${block.startISO}`}` : isTimeOff ? `schedule-block-time-off-${block.timeOffId ?? `${tech.technicianId}-${block.startISO}`}` : `schedule-block-${block.visitId ?? `${tech.technicianId}-${block.startISO}`}`}
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
                        position on every row regardless of name length.
                        2026-04-30: when muted (past open / completed),
                        the inline emerald color ternaries fall back to
                        `text-text-muted` and `line-through` is applied
                        on the grid container so it cascades to time /
                        name / duration via inherited
                        `text-decoration-line`. */}
                    <div
                      className={`flex-1 min-w-0 grid items-baseline gap-2 text-sm ${isMuted ? "text-text-muted line-through" : isTimeOff ? "text-amber-800" : isTask ? "text-indigo-800" : isOpen ? "text-emerald-700" : "text-[#111827]"}`}
                      style={{ gridTemplateColumns: "110px minmax(0, 1fr) auto" }}
                    >
                      <span className={`tabular-nums font-medium ${isMuted ? "text-text-muted" : isTimeOff ? "text-amber-700" : isTask ? "text-indigo-700" : isOpen ? "text-emerald-700" : "text-slate-600"}`}>
                        {timeRange}
                      </span>
                      <span className="flex items-baseline gap-1.5 min-w-0">
                        <span className={`shrink-0 ${isMuted ? "text-text-muted" : isTimeOff ? "text-amber-400" : isTask ? "text-indigo-400" : isOpen ? "text-emerald-400" : "text-slate-300"}`} aria-hidden>•</span>
                        <span className="font-semibold truncate">{nameLabel}</span>
                      </span>
                      <span className={`tabular-nums font-normal text-right ${isMuted ? "text-text-muted" : isTimeOff ? "text-amber-600" : isTask ? "text-indigo-600" : isOpen ? "text-emerald-600" : "text-slate-500"}`}>({duration})</span>
                    </div>
                    {!isTask && !isTimeOff && (
                      <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-colors ${isMuted ? "text-text-muted" : isOpen ? "text-emerald-600 group-hover:text-emerald-800" : "text-slate-400 group-hover:text-[#111827]"}`} />
                    )}
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
            // 2026-05-07 RALPH: stacked mode forces the vertical
            // layout regardless of breakpoint or tech count. Column
            // mode keeps the existing rule (grid for ≤4 techs;
            // horizontal scroll for ≥5).
            const isStacked = scheduleDisplayMode === "stacked";
            // 2026-05-07 RALPH (idle grouping): column mode now uses
            // `effectiveColumnCount` (active tech columns + the
            // grouped "Available" column when idle techs exist) so
            // the grid threshold reflects the actual rendered column
            // count, not the raw `visibleTechs.length`. Stacked mode
            // continues to iterate `visibleTechs` directly — no
            // grouping in stacked, every tech gets their own section.
            const useGrid = !isStacked && effectiveColumnCount <= 4;
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
                className={`${widthClass} ${
                  !isLastCol
                    ? "border-b xl:border-b-0 xl:border-r border-[#e2e8f0]"
                    : ""
                }`}
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
                      // 2026-05-07 RALPH: time_off blocks render with
                      // a muted amber palette and a "Time off" label
                      // (or the reason if present). Click is no-op
                      // for now — editing is wired via the API but
                      // the dashboard doesn't expose an inline edit
                      // entry point yet (follow-up).
                      const isTimeOff = block.kind === "time_off";
                      // 2026-05-12 RALPH: scheduled task blocks render
                      // with a blue palette and the task title. They are
                      // display-only in the dashboard tile (no click-
                      // through) — same pattern as time_off.
                      const isTask = block.kind === "task";
                      const isLastBlock = bIdx === bArr.length - 1;
                      const duration = formatDurationLabel(block.durationMinutes);
                      const nameLabel = isTimeOff
                        ? `Time off${block.reason ? ` · ${block.reason}` : ""}`
                        : isTask
                          ? (block.title ?? "Task")
                          : isOpen
                            ? "Open Slot"
                            : (block.title ?? "Visit");
                      // 2026-04-30: same muted-state markers as the
                      // single-tech view — kept identical so both layouts
                      // strike past-open / completed rows the same way.
                      const isPastOpen = isOpen && Date.parse(block.endISO) < nowMs;
                      const isCompleted = !isOpen && block.visitStatus === "completed";
                      const isMuted = isPastOpen || isCompleted;
                      return (
                        <button
                          key={`${tech.technicianId}-${block.startISO}-${block.visitId ?? block.timeOffId ?? block.taskId ?? "open"}`}
                          type="button"
                          onClick={() =>
                            isTimeOff || isTask ? undefined : handleBlockClick(tech, block)
                          }
                          disabled={isTimeOff || isTask}
                          className={`w-full text-left px-3 py-1.5 transition-colors ${
                            isTimeOff
                              ? "bg-amber-50/60 cursor-default"
                              : isTask
                                ? "bg-indigo-50/60 cursor-default"
                                : "hover:bg-[#F0F5F0]"
                          } ${
                            !isLastBlock ? "border-b border-slate-100" : ""
                          } ${isPastOpen ? "opacity-60" : isCompleted ? "opacity-70" : ""}`}
                          data-testid={
                            isTask
                              ? `schedule-block-task-${block.taskId ?? `${tech.technicianId}-${block.startISO}`}`
                              : isTimeOff
                                ? `schedule-block-time-off-${block.timeOffId ?? `${tech.technicianId}-${block.startISO}`}`
                                : `schedule-block-${block.visitId ?? `${tech.technicianId}-${block.startISO}`}`
                          }
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
                              truncates first per spec.
                              2026-04-30: muted state mirrors the
                              single-tech view above. */}
                          <div
                            className={`grid items-baseline gap-1.5 text-xs ${
                              isMuted
                                ? "text-text-muted line-through"
                                : isTimeOff
                                  ? "text-amber-800"
                                  : isTask
                                    ? "text-indigo-800"
                                    : isOpen
                                      ? "text-emerald-700"
                                      : "text-[#111827]"
                            }`}
                            style={{ gridTemplateColumns: "96px minmax(0, 1fr) auto" }}
                          >
                            <span
                              className={`tabular-nums font-medium ${
                                isMuted
                                  ? "text-text-muted"
                                  : isTimeOff
                                    ? "text-amber-700"
                                    : isTask
                                      ? "text-indigo-700"
                                      : isOpen
                                        ? "text-emerald-700"
                                        : "text-slate-600"
                              }`}
                            >
                              {timeRange}
                            </span>
                            <span className="flex items-baseline gap-1 min-w-0">
                              <span className={`shrink-0 ${isMuted ? "text-text-muted" : isTimeOff ? "text-amber-400" : isTask ? "text-indigo-400" : isOpen ? "text-emerald-400" : "text-slate-300"}`} aria-hidden>•</span>
                              <span className="font-semibold truncate">{nameLabel}</span>
                            </span>
                            <span className={`tabular-nums font-normal text-right ${isMuted ? "text-text-muted" : isTimeOff ? "text-amber-600" : isTask ? "text-indigo-600" : isOpen ? "text-emerald-600" : "text-slate-500"}`}>({duration})</span>
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
            //
            // 2026-04-30 (responsive pass) — the ≤ 4-tech grid now
            // collapses to a vertical stack below `xl` (1280 px). The
            // previous unconditional `repeat(N, minmax(0, 1fr))` with
            // `min-w-0` on each column let columns crush below their
            // intrinsic minimum at narrow desktop / tablet widths,
            // truncating tech names and visit labels. At `< xl` the
            // wrapper is now `flex flex-col` (each tech becomes a
            // full-width section); at `xl+` it stays `grid` with the
            // unchanged inline `gridTemplateColumns`. The
            // `gridTemplateColumns` inline style is harmless on a
            // `display: flex` parent — the browser ignores it.
            // Stacked: vertical sections at every breakpoint, no
            // grid, no horizontal scroll. Each tech becomes a
            // full-width section with its name as a compact header
            // and its rows below. Body wrapper's overflow-y-auto
            // (set on the parent) handles the internal scroll when
            // stacked content exceeds the fixed card height.
            //
            // Renders off-roster (unassigned / non-schedulable) visits
            // in the same column/section structure as regular tech rows.
            // The "Unassigned" label is italic to distinguish it from
            // named technician columns without adding visual noise.
            const renderUnassignedColumn = (
              isLastCol: boolean,
              widthClass: string,
            ) => (
              <div
                key="unassigned-visits"
                className={`${widthClass} ${
                  !isLastCol
                    ? "border-b xl:border-b-0 xl:border-r border-[#e2e8f0]"
                    : ""
                }`}
                data-testid="schedule-unassigned-column"
              >
                <div className="px-3 py-2 text-[13px] border-b border-[#e2e8f0] bg-slate-50/50 truncate">
                  <span
                    className="italic text-slate-500"
                    data-testid="schedule-unassigned-label"
                  >
                    Unassigned
                  </span>
                </div>
                <div className="py-0.5">
                  {offRosterRows.map((row, bIdx, bArr) => {
                    const isTaskRow = !!row.taskId && !row.visitId;
                    const timeRange = formatTimeRange(
                      row.scheduledStart,
                      row.scheduledEnd,
                    );
                    const isLastBlock = bIdx === bArr.length - 1;
                    const durationMinutes = Math.round(
                      (Date.parse(row.scheduledEnd) -
                        Date.parse(row.scheduledStart)) /
                        60_000,
                    );
                    const duration = formatDurationLabel(durationMinutes);
                    const nameLabel = isTaskRow
                      ? `${row.title ?? "Task"} (task)`
                      : (row.title ?? "Visit");
                    const rowKey = isTaskRow
                      ? `unassigned-task-${row.taskId}`
                      : `unassigned-${row.visitId}`;
                    return (
                      <button
                        key={rowKey}
                        type="button"
                        onClick={() => isTaskRow ? undefined : handleOffRosterClick(row)}
                        disabled={isTaskRow}
                        className={`w-full text-left px-3 py-1.5 transition-colors ${
                          isTaskRow
                            ? "bg-indigo-50/60 cursor-default"
                            : "hover:bg-[#F0F5F0]"
                        } ${
                          !isLastBlock ? "border-b border-slate-100" : ""
                        }`}
                        data-testid={isTaskRow ? `schedule-unassigned-task-${row.taskId}` : `schedule-unassigned-row-${row.visitId}`}
                      >
                        <div
                          className={`grid items-baseline gap-1.5 text-xs ${isTaskRow ? "text-indigo-800" : "text-[#111827]"}`}
                          style={{
                            gridTemplateColumns: "96px minmax(0, 1fr) auto",
                          }}
                        >
                          <span className={`tabular-nums font-medium ${isTaskRow ? "text-indigo-700" : "text-slate-600"}`}>
                            {timeRange}
                          </span>
                          <span className="flex items-baseline gap-1 min-w-0">
                            <span
                              className={`shrink-0 ${isTaskRow ? "text-indigo-400" : "text-slate-300"}`}
                              aria-hidden
                            >
                              •
                            </span>
                            <span className="font-semibold truncate">
                              {nameLabel}
                            </span>
                          </span>
                          <span className={`tabular-nums font-normal text-right ${isTaskRow ? "text-indigo-600" : "text-slate-500"}`}>
                            ({duration})
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
            // 2026-05-07 RALPH (idle grouping): the column branches
            // below render `activeTechsForRender` as dedicated
            // columns and append ONE grouped "Available" column when
            // `idleTechsForRender.length > 0`. Stacked mode is
            // unchanged — every tech still gets their own section.
            if (isStacked) {
              return (
                <div
                  className="flex flex-col flex-1"
                  data-testid="schedule-multi-column-view"
                  data-display-mode="stacked"
                >
                  {visibleTechs.map((tech, i) =>
                    renderColumn(
                      tech,
                      i === visibleTechs.length - 1 && !hasUnassigned,
                      "w-full",
                    ),
                  )}
                  {hasUnassigned && renderUnassignedColumn(true, "w-full")}
                </div>
              );
            }
            // Compact "Available" column rendered ONCE at the right
            // edge of column-mode layouts when at least one idle
            // tech exists. Each row shows the tech name + a green
            // "Open" pill; clicking promotes to the schedule
            // creation flow if the tech has any open block, falling
            // back to a no-op when they have none (off-shift).
            const renderGroupedAvailableColumn = (
              isLastCol: boolean,
              widthClass: string,
            ) => (
              <div
                key="available-techs"
                className={`${widthClass} ${
                  !isLastCol
                    ? "border-b xl:border-b-0 xl:border-r border-[#e2e8f0]"
                    : ""
                }`}
                data-testid="schedule-available-column"
              >
                <div className="px-3 py-2 text-[13px] font-semibold text-[#111827] border-b border-[#e2e8f0] bg-slate-50/50 truncate">
                  Available
                </div>
                <div className="py-0.5">
                  {idleTechsForRender.map((tech, idx) => {
                    const firstOpen = tech.scheduleBlocks.find(
                      (b) => b.kind === "open",
                    );
                    // 2026-05-07 RALPH (technician time off): render
                    // an "Off" pill (amber) when the tech has any
                    // time-off block today. Takes precedence over
                    // the "Open" pill since a tech on time-off
                    // shouldn't read as available even if a tiny
                    // sliver of open slot remains around the
                    // blocked window.
                    const hasTimeOff = tech.scheduleBlocks.some(
                      (b) => b.kind === "time_off",
                    );
                    const isOffShift = tech.state === "off_today";
                    const isLastRow = idx === idleTechsForRender.length - 1;
                    const hasClickable = !!firstOpen && !hasTimeOff;
                    return (
                      <button
                        key={tech.technicianId}
                        type="button"
                        onClick={() =>
                          hasClickable &&
                          firstOpen &&
                          handleBlockClick(tech, firstOpen)
                        }
                        disabled={!hasClickable}
                        data-testid={`schedule-available-row-${tech.technicianId}`}
                        className={`w-full text-left px-3 py-1 transition-colors flex items-center gap-2 ${
                          !isLastRow ? "border-b border-slate-100" : ""
                        } ${
                          hasClickable
                            ? "hover:bg-[#F0F5F0]"
                            : "cursor-default opacity-70"
                        }`}
                      >
                        <span className="flex-1 text-xs font-medium text-slate-700 dark:text-gray-200 truncate">
                          {tech.name}
                          {isOffShift && !hasTimeOff && (
                            <span className="ml-1 text-[10px] font-normal text-amber-700 align-middle">
                              (off)
                            </span>
                          )}
                        </span>
                        <span
                          className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                            hasTimeOff
                              ? "bg-amber-100 text-amber-700"
                              : hasClickable
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-slate-100 text-slate-500"
                          }`}
                          data-testid={`schedule-available-status-${tech.technicianId}`}
                        >
                          {hasTimeOff ? "Off" : hasClickable ? "Open" : "—"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
            const activeColumnsLastIdx = activeTechsForRender.length - 1;
            return useGrid ? (
              <div
                className="flex flex-col xl:grid flex-1"
                style={{
                  gridTemplateColumns: `repeat(${effectiveColumnCount}, minmax(0, 1fr))`,
                }}
                data-testid="schedule-multi-column-view"
                data-display-mode="column"
              >
                {activeTechsForRender.map((tech, i) =>
                  renderColumn(
                    tech,
                    !hasIdleGroup && !hasUnassigned && i === activeColumnsLastIdx,
                    "w-full xl:min-w-0",
                  ),
                )}
                {hasIdleGroup &&
                  renderGroupedAvailableColumn(!hasUnassigned, "w-full xl:min-w-0")}
                {hasUnassigned && renderUnassignedColumn(true, "w-full xl:min-w-0")}
              </div>
            ) : (
              <div
                className="overflow-x-auto flex-1"
                data-testid="schedule-multi-column-view"
                data-display-mode="column"
              >
                <div className="flex h-full" style={{ minWidth: "min-content" }}>
                  {activeTechsForRender.map((tech, i) =>
                    renderColumn(
                      tech,
                      !hasIdleGroup && !hasUnassigned && i === activeColumnsLastIdx,
                      "flex-none w-[220px]",
                    ),
                  )}
                  {hasIdleGroup &&
                    renderGroupedAvailableColumn(!hasUnassigned, "flex-none w-[220px]")}
                  {hasUnassigned && renderUnassignedColumn(true, "flex-none w-[220px]")}
                </div>
              </div>
            );
          })()
        )}
      </div>
      {/* 2026-05-07 RALPH (technician time off): mounted at the
          schedule card level so the team-filter Popover footer's
          "Add time off →" link can launch it. Mutation invalidates
          the capacity query → schedule card refreshes automatically. */}
      <TechnicianTimeOffModal
        open={timeOffModalOpen}
        onOpenChange={setTimeOffModalOpen}
        technicians={techs.map((t) => ({ id: t.technicianId, name: t.name }))}
        defaultTechnicianId={timeOffDefaultTechId}
      />
    </CardShell>
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
