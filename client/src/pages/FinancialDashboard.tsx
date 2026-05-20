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
  AlertCircle, ChevronDown,
  TrendingUp, Users, Receipt, Calendar as CalendarIcon,
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
    queryKey: ["/api/dashboard/capacity", "today"],
    queryFn: () => apiRequest<CapacityResponseDto>("/api/dashboard/capacity"),
    staleTime: 30_000,
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
            <h1 className="text-header text-foreground tracking-tight">
              Business Dashboard
            </h1>
            <p className="text-helper text-muted-foreground mt-0.5">
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
}: {
  onOpenVisit: (state: VisitEditorState) => void;
  onOpenSlot: (slot: QuickCreateSlot) => void;
  unscheduledJobsCount: number;
  scopeIds: string[];
  onScopeIdsChange: (next: string[] | ((prev: string[]) => string[])) => void;
  compact?: boolean;
  // displayMode / onDisplayModeChange kept in the prop type for page
  // backward-compat; the new horizontal-card layout has no separate modes.
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
  const capacityQuery = useQuery<CapacityResponseDto>({
    queryKey: ["/api/dashboard/capacity", "today"],
    queryFn: () => apiRequest<CapacityResponseDto>("/api/dashboard/capacity"),
    staleTime: 30_000,
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

  // Split visibleTechs into two groups:
  //   scheduledTechs — have at least one BOOKED or TASK block after filtering/clamping.
  //     Each gets its own card showing ALL their blocks (booked + open slots interleaved).
  //   openGroupTechs — on-shift techs with NO booked/task work; collapsed into a single
  //     "Open technicians" card that lists each tech with their clickable open time slots.
  //     Off-shift techs are excluded from both groups (appear only when they have assigned
  //     visits). In openOnly mode all blocks are open-kind so every tech with visible
  //     slots gets an individual card instead.
  const scheduledTechs = useMemo(() => {
    if (openOnly) {
      // Open-only mode: all remaining blocks are open-kind; show each tech with
      // visible slots as its own card (the filter already keeps only open blocks).
      return visibleTechs.filter((t) => t.scheduleBlocks.length > 0);
    }
    // Normal mode: individual card for techs with at least one booked visit or task.
    // Their open slots between jobs are also rendered inside the same card.
    return visibleTechs.filter((t) =>
      t.scheduleBlocks.some((b) => b.kind === "booked" || b.kind === "task"),
    );
  }, [visibleTechs, openOnly]);

  const openGroupTechs = useMemo(() => {
    if (openOnly) return []; // individual cards cover all open-slot techs in this mode
    // All in-scope techs with no booked/task work → grouped card.
    // Intentionally no state filter: the original pre-redesign column layout
    // showed ALL idle techs (including state:"off_today") in the Available group.
    // Their scheduleBlocks still contains open slots when present (used for
    // clickable time ranges). state:"off_today" techs show "No open slots".
    return visibleTechs.filter(
      (t) => !t.scheduleBlocks.some((b) => b.kind === "booked" || b.kind === "task"),
    );
  }, [visibleTechs, openOnly]);

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
          <span className="truncate max-w-[6rem]">{scopeLabel}</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">
            {isAllTeam ? "All" : scopeIds.length}
          </span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={4} className="w-60 p-0">
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

  // Per-tech card renderer. Utilization = booked / (booked + open) since those
  // two block kinds tile the schedulable workday. Revenue and drive time are not
  // in the capacity endpoint; both show "—" per spec.
  //
  // TODO: horizontal drag-to-reorder within this row was deferred because
  // nesting a new DndContext inside DashboardWidgetGrid's DndContext requires
  // careful sensor isolation to avoid interfering with widget-level drag, and
  // would need its own separate order-state mechanism.
  const renderTechCard = (tech: CapacityTechDto) => {
    const bookedBlocks = tech.scheduleBlocks.filter((b) => b.kind === "booked");
    const openBlocks = tech.scheduleBlocks.filter((b) => b.kind === "open");
    const bookedMins = bookedBlocks.reduce((s, b) => s + (b.durationMinutes ?? 0), 0);
    const openMins = openBlocks.reduce((s, b) => s + (b.durationMinutes ?? 0), 0);
    const workdayMins = bookedMins + openMins;
    const utilizationPct = workdayMins > 0 ? Math.round((bookedMins / workdayMins) * 100) : 0;
    const bookedHoursLabel = `${(bookedMins / 60).toFixed(1)}h booked`;
    const isOffShift = tech.state === "off_today";
    const hasBooked = bookedBlocks.length > 0;
    const statusLabel = isOffShift ? "Off shift" : hasBooked ? "Working" : "Available";
    // visibleTechs already applied the openOnly filter and clamped past open slots.
    const displayBlocks = tech.scheduleBlocks;
    return (
      <div
        key={tech.technicianId}
        className="flex-1 min-w-[250px] flex flex-col bg-inset-surface border border-border rounded-md overflow-hidden"
        data-testid={`schedule-tech-card-${tech.technicianId}`}
      >
        {/* Header: name + status/hours (left) | utilization % text (right) */}
        <div className="bg-white border-b border-border/40 px-3 pt-2.5 pb-2 shrink-0">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-foreground truncate leading-tight">
                {tech.name}
              </div>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {!isOffShift && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden />
                )}
                <span
                  className={cn(
                    "text-[11px] leading-none",
                    isOffShift ? "text-muted-foreground" : "text-emerald-700",
                  )}
                >
                  {statusLabel}
                </span>
                <span className="text-[11px] text-muted-foreground leading-none">
                  {bookedHoursLabel}
                </span>
              </div>
            </div>
            {/* Utilization as readable text — large % on top, small label below */}
            <div className="shrink-0 text-right">
              <div className="text-[15px] font-semibold text-foreground tabular-nums leading-none">
                {utilizationPct}%
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5 leading-none">
                utilized
              </div>
            </div>
          </div>
        </div>
        {/* Schedule blocks — grows naturally with content; no internal scroll for
            normal schedules. The outer widget uses heightPreset:"auto" so the card
            height is driven by content, not a fixed container. */}
        <div className="bg-white">
          {displayBlocks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 px-3 text-center">
              <CalendarIcon className="h-4 w-4 text-muted-foreground/30 mb-1.5" aria-hidden />
              <span className="text-[11px] text-muted-foreground">No scheduled work</span>
            </div>
          ) : (
            <div className="p-2 flex flex-col gap-1.5">
              {displayBlocks.map((block, bIdx) => {
                const isOpen = block.kind === "open";
                const isTimeOff = block.kind === "time_off";
                const isTask = block.kind === "task";
                const isBooked = block.kind === "booked";
                const isPastOpen = isOpen && Date.parse(block.endISO) < nowMs;
                const isCompleted = !isOpen && block.visitStatus === "completed";
                const isMuted = isPastOpen || isCompleted;
                const timeRange = formatTimeRange(block.startISO, block.endISO);
                const durationMins = block.durationMinutes ?? 0;
                const durationLabel = durationMins > 0 ? formatDurationLabel(durationMins) : null;
                // For booked visits: title = client/company name, description = job summary.
                // For other kinds: use a simple label.
                const clientName = isBooked ? (block.title ?? "Visit") : null;
                const jobDesc = isBooked ? (block.description ?? null) : null;
                const simpleLabel = isTimeOff
                  ? `Time off${block.reason ? ` · ${block.reason}` : ""}`
                  : isTask
                    ? (block.title ?? "Task")
                    : isOpen
                      ? "Open Slot"
                      : null;
                const timeColor = isMuted
                  ? "text-muted-foreground"
                  : isTimeOff
                    ? "text-amber-700"
                    : isTask
                      ? "text-indigo-700"
                      : isOpen
                        ? "text-emerald-600"
                        : "text-slate-500";
                return (
                  <button
                    key={`${tech.technicianId}-${block.startISO}-${block.visitId ?? block.timeOffId ?? block.taskId ?? "open"}-${bIdx}`}
                    type="button"
                    onClick={() =>
                      !isTimeOff && !isTask ? handleBlockClick(tech, block) : undefined
                    }
                    disabled={isTimeOff || isTask}
                    className={cn(
                      "w-full text-left p-2 rounded-md border transition-colors",
                      isTimeOff
                        ? "bg-amber-50 border-amber-200/70 cursor-default"
                        : isTask
                          ? "bg-indigo-50 border-indigo-200/70 cursor-default"
                          : isOpen
                            ? "bg-emerald-50 border-emerald-300 border-dashed hover:bg-emerald-100"
                            : "bg-white border-border hover:bg-slate-50",
                      (isPastOpen || isCompleted) && "opacity-60",
                    )}
                    data-testid={
                      isTask
                        ? `schedule-block-task-${block.taskId ?? `${tech.technicianId}-${block.startISO}`}`
                        : isTimeOff
                          ? `schedule-block-time-off-${block.timeOffId ?? `${tech.technicianId}-${block.startISO}`}`
                          : `schedule-block-${block.visitId ?? `${tech.technicianId}-${block.startISO}`}`
                    }
                  >
                    {isBooked ? (
                      <>
                        {/* Row 1: time range (left) + duration (right) */}
                        <div className="flex items-baseline justify-between gap-1">
                          <span className={cn("text-[12px] tabular-nums font-medium leading-tight", timeColor)}>
                            {timeRange}
                          </span>
                          {durationLabel && (
                            <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 leading-tight">
                              {durationLabel}
                            </span>
                          )}
                        </div>
                        {/* Row 2: client name · job description inline, truncated */}
                        {clientName && (
                          <div className={cn(
                            "text-[13px] font-medium truncate mt-1 leading-snug",
                            isMuted ? "text-muted-foreground line-through" : "text-foreground",
                          )}>
                            {clientName}
                            {jobDesc && (
                              <span className="font-normal text-muted-foreground"> · {jobDesc}</span>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        {/* Non-booked blocks (open, time_off, task): compact 2-line layout */}
                        <div className={cn("text-[12px] tabular-nums font-medium leading-tight", timeColor)}>
                          {timeRange}
                          {durationLabel && (
                            <span className="font-normal text-muted-foreground ml-1.5">{durationLabel}</span>
                          )}
                        </div>
                        {simpleLabel && (
                          <div className={cn(
                            "text-[13px] font-medium truncate mt-1 leading-snug",
                            isMuted
                              ? "text-muted-foreground line-through"
                              : isTimeOff
                                ? "text-amber-800"
                                : isTask
                                  ? "text-indigo-800"
                                  : "text-emerald-700",
                          )}>
                            {simpleLabel}
                          </div>
                        )}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <CardShell className="flex flex-col">
      {/* Single header — Open filter + Team filter. Display-mode toggle removed
          since the new horizontal-card layout is the only mode. */}
      <div
        className="pl-4 pr-10 py-2.5 border-b border-card-border flex items-center justify-between gap-3"
        data-testid="todays-schedule-header"
      >
        <div className="flex items-center gap-2 min-w-0">
          <CalendarIcon className="h-3.5 w-3.5 text-[#76B054] shrink-0" />
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
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {openOnlyToggleControl}
          {teamFilterControl}
        </div>
      </div>
      {/* Horizontal per-tech card layout. Each schedulable technician gets
          one inset sub-card. overflow-x-auto handles teams > 5; each card's
          schedule-blocks section scrolls internally. */}
      <div data-testid="schedule-body-scroll">
        {capacityQuery.isLoading ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : capacityQuery.isError ? (
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
        ) : scheduledTechs.length === 0 && openGroupTechs.length === 0 && offRosterRows.length === 0 ? (
          <div className="p-4">
            <EmptyState message={
              visibleTechs.length === 0
                ? "No technicians in the selected scope."
                : "No scheduled work today."
            } />
          </div>
        ) : (
          <div
            className="flex gap-3 px-3 py-3 overflow-x-auto w-full"
            data-testid="schedule-tech-cards"
          >
            {/* Individual cards: technicians with at least one scheduled block */}
            {scheduledTechs.map((tech) => renderTechCard(tech))}

            {/* Grouped card: on-shift technicians with no booked/task work.
                Shows each tech with their clickable open time slots. */}
            {openGroupTechs.length > 0 && (
              <div
                className="flex-1 min-w-[250px] flex flex-col bg-inset-surface border border-border rounded-md overflow-hidden"
                data-testid="schedule-open-group-card"
              >
                <div className="bg-white border-b border-border/40 px-3 pt-2.5 pb-2 shrink-0">
                  <div className="text-[13px] font-semibold text-foreground leading-tight">
                    Open
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {openGroupTechs.length} technician{openGroupTechs.length !== 1 ? "s" : ""} · no booked work
                  </div>
                </div>
                <div className="bg-white">
                  {openGroupTechs.map((t, tIdx) => {
                    const techOpenBlocks = t.scheduleBlocks.filter(
                      (b) => b.kind === "open",
                    );
                    return (
                      <div
                        key={t.technicianId}
                        className={cn("px-2 py-2", tIdx > 0 && "border-t border-border/30")}
                      >
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" aria-hidden />
                          <span className="text-[12px] font-medium text-foreground truncate">
                            {t.name}
                          </span>
                        </div>
                        {techOpenBlocks.length > 0 ? (
                          <div className="flex flex-col gap-1 pl-3">
                            {techOpenBlocks.map((block, bIdx) => (
                              <button
                                key={`og-${t.technicianId}-${block.startISO}-${bIdx}`}
                                type="button"
                                onClick={() => handleBlockClick(t, block)}
                                className="w-full text-left px-2 py-1 rounded border border-emerald-300 border-dashed bg-emerald-50 hover:bg-emerald-100 transition-colors"
                                data-testid={`schedule-open-group-slot-${t.technicianId}-${bIdx}`}
                              >
                                <span className="text-[11px] tabular-nums font-medium text-emerald-700">
                                  {formatTimeRange(block.startISO, block.endISO)}
                                </span>
                                {block.durationMinutes > 0 && (
                                  <span className="text-[11px] text-muted-foreground ml-1.5">
                                    {formatDurationLabel(block.durationMinutes)}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="pl-3 text-[11px] text-muted-foreground">No open slots</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Unassigned visits card: visits/tasks assigned to non-schedulable techs */}
            {offRosterRows.length > 0 && (
              <div
                className="flex-1 min-w-[250px] flex flex-col bg-inset-surface border border-border rounded-md overflow-hidden"
                data-testid="schedule-unassigned-card"
              >
                <div className="bg-white border-b border-border/40 px-3 pt-2.5 pb-2 shrink-0">
                  <div className="text-[13px] font-medium text-muted-foreground truncate leading-tight italic">
                    Unassigned
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {offRosterRows.length} visit{offRosterRows.length !== 1 ? "s" : ""}
                  </div>
                </div>
                <div className="bg-white">
                  <div className="p-2 flex flex-col gap-1.5">
                    {offRosterRows.map((row, bIdx) => {
                      const isTaskRow = !!row.taskId && !row.visitId;
                      const timeRange = formatTimeRange(row.scheduledStart, row.scheduledEnd);
                      const nameLabel = isTaskRow ? (row.title ?? "Task") : (row.title ?? "Visit");
                      const rowKey = isTaskRow
                        ? `unassigned-task-${row.taskId}`
                        : `unassigned-${row.visitId}`;
                      return (
                        <button
                          key={rowKey}
                          type="button"
                          onClick={() => !isTaskRow ? handleOffRosterClick(row) : undefined}
                          disabled={isTaskRow}
                          className={cn(
                            "w-full text-left p-2 rounded-md border transition-colors",
                            isTaskRow
                              ? "bg-indigo-50 border-indigo-200/70 cursor-default"
                              : "bg-white border-border hover:bg-slate-50",
                          )}
                          data-testid={
                            isTaskRow
                              ? `schedule-unassigned-task-${row.taskId}`
                              : `schedule-unassigned-row-${row.visitId}`
                          }
                        >
                          <div className="flex items-baseline justify-between gap-1">
                            <span className={cn(
                              "text-[12px] tabular-nums font-medium leading-tight",
                              isTaskRow ? "text-indigo-700" : "text-slate-500",
                            )}>
                              {timeRange}
                            </span>
                          </div>
                          <div className={cn(
                            "text-[13px] truncate font-medium mt-1 leading-snug",
                            isTaskRow ? "text-indigo-800" : "text-foreground",
                          )}>
                            {nameLabel}
                            {!isTaskRow && row.technicianName && (
                              <span className="text-[11px] text-muted-foreground font-normal ml-1">
                                · {row.technicianName}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
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
