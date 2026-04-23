/**
 * Dashboard — Operations Command Center
 *
 * Layout: Today's Operations (full-width top) → Jobs + Invoices → Quotes + PM Health → Tasks sidebar
 * Data: Reuses canonical dashboard/workflow, attention, and invoices queries.
 *
 * Visual hierarchy (5 tiers):
 * L1: Today's Operations (dark charcoal header, elevated card)
 * L2: Jobs (strongest domain card, shadow-md)
 * L3: Invoices (medium weight)
 * L4: Quotes + PM Health (lightest)
 * L5: Tasks panel (subordinate sidebar)
 *
 * Worklist-style phrasing: every row reads as "object + condition + implied action"
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { DashboardActionModal, type DashboardActionMode } from "@/components/DashboardActionModal";
import { MidnightRolloverCard } from "@/components/MidnightRolloverCard";
import { TodaysOperationsCard } from "@/components/TodaysOperationsCard";
import { QuotePipelineCard, type DashboardQuotePreview } from "@/components/dashboard/QuotePipelineCard";
import { RevenueCenterCard } from "@/components/dashboard/RevenueCenterCard";
import { PMHealthCard } from "@/components/dashboard/PMHealthCard";
import {
  DashboardViewToggle,
  DASHBOARD_VIEW_KEY,
} from "@/components/dashboard/DashboardViewToggle";
import {
  VisitEditorLauncher,
  type VisitEditorState,
} from "@/components/dispatch/VisitEditorLauncher";
import {
  SlotQuickCreateLauncher,
  type QuickCreateSlot,
} from "@/components/dispatch/SlotQuickCreateLauncher";
// ============================================================================
// Types
// ============================================================================

interface WorkflowSummary {
  quotes: {
    awaitingApprovalCount: number;
    draftReadyToSendCount: number;
    approvedNotConvertedCount: number;
    awaitingApprovalPreview: DashboardQuotePreview[];
    draftReadyToSendPreview: DashboardQuotePreview[];
    approvedNotConvertedPreview: DashboardQuotePreview[];
    /** Backwards-compat fields — not read by current UI. */
    approvedCount: number;
    draftCount: number;
  };
  jobs: {
    requiresInvoicingCount: number;
    activeCount: number;
    onHoldCount: number;
    unscheduledCount: number;
    // 2026-04-08: Live overdue count from /api/dashboard/workflow.
    // This is the SOLE source of the overdue count for the dashboard widget.
    overdueCount: number;
  };
  invoices: {
    outstandingCount: number;
    pastDueCount: number;
    /** 2026-04-22 Revenue Center. */
    draftCount: number;
  };
  pm: {
    awaitingGenerationCount: number;
    overdueCount: number;
    comingDueCount: number;
    upcomingCount: number;
    /** 2026-04-22: PM relevance signal — hides the card when false. */
    hasAnyData: boolean;
  };
  fourth: null;
}

// 2026-04-15: Task type + TasksPanel moved to
// `client/src/components/tasks/TasksPanel.tsx` when the panel relocated
// to the global header. No local references remain on this page.

// 2026-04-19: Today-visit aggregate summary (TodayVisitSummary) removed —
// the former 4-tile KPI strip was replaced by the <TodaysOperationsCard />
// command center, which derives workload per technician from live visit /
// live-state data directly. The /api/dashboard/today-summary endpoint
// still exists server-side for any external consumer, but this page no
// longer queries it.

// ============================================================================
// Today's Operations (command center top — strongest visual anchor)
// ----------------------------------------------------------------------------
// 2026-04-08: Split into TodaysOperationsHeader + TodaysOperationsKPIs so the
// parent can place the heading and the KPI cards in different CSS Grid cells.
// This is the structural fix that lets the Tasks panel align with the KPI row
// instead of the heading.
//
// 2026-04-22 Operations Dashboard upgrade: the inline DashCard + WorklistCard
// primitives that powered the old Quotes + PM Health row were removed. Their
// replacements live in `@/components/dashboard/{QuotePipelineCard,
// RevenueCenterCard, PMHealthCard}`.
// ============================================================================

function TodaysOperationsHeader() {
  // 2026-04-21: Separate "Financial Dashboard" outline button replaced by
  // the shared <DashboardViewToggle /> segmented switcher so the two
  // dashboards share one consistent control.
  return (
    <div
      className="flex items-center justify-between gap-3 mb-2"
      style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: '8px' }}
    >
      <h3 className="text-lg font-semibold text-[#111827] dark:text-gray-100 tracking-tight">
        Today's Operations
      </h3>
      <DashboardViewToggle active="operations" />
    </div>
  );
}

// 2026-04-19: The former TodaysOperationsKPIs (4 KPI tiles: Scheduled /
// In Progress / Remaining / Completed) was replaced by the live
// command-center card. Tech workload rail + operational alerts stack now
// live in <TodaysOperationsCard /> in `@/components/TodaysOperationsCard`.

// 2026-04-15: The in-file `TasksPanel` + `getInitials` + `formatTaskDate`
// block (previously here, ~180 LOC) moved to
// `client/src/components/tasks/TasksPanel.tsx` when the panel relocated
// to the global header dropdown.


// ============================================================================
// Main Dashboard
// ============================================================================

export default function Dashboard() {
  // 2026-04-08: useDispatchStream() now mounted once at App.tsx root for all office surfaces.
  // 2026-04-15: Tasks panel relocated from this page to the global header
  // (client/src/components/tasks/TasksPanel.tsx + App.tsx header trigger).
  // The dashboard-only `tasksCollapsed` localStorage key became moot and
  // has been dropped; the panel is now opened from the header popover
  // with transient open/close state.

  // 2026-04-22: Dashboard is the single sidebar entry point for both views.
  // When the user's last-used view was Financial, redirect to /financials
  // so clicking the sidebar "Dashboard" link reopens where they left off.
  // Initial state is read synchronously from localStorage so the conditional
  // return (placed AFTER every other hook to honor the rules of hooks)
  // suppresses the Operations layout before the bounce happens.
  // The toggle writes `financial` BEFORE it navigates, so an explicit
  // "Operations" click from /financials never re-bounces to /financials.
  const [, setLocation] = useLocation();
  const [redirectingToFinancial] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(DASHBOARD_VIEW_KEY) === "financial";
    } catch {
      return false;
    }
  });

  // Dashboard action modal state
  const [actionModalOpen, setActionModalOpen] = useState(false);
  // 2026-04-19 Task B: default mode aligned with the first Jobs card row after
  // consolidation (Action Required). No runtime effect — just keeps the initial
  // state readable.
  const [actionModalMode, setActionModalMode] = useState<DashboardActionMode>("action_required");
  const openActionModal = (mode: DashboardActionMode) => { setActionModalMode(mode); setActionModalOpen(true); };

  // 2026-04-20 — Canonical launchers. Dashboard is an ENTRY POINT for the
  // same EditVisitModal and QuickCreate flows Dispatch uses; the launcher
  // components own all dialog/modal mount & state orchestration. No
  // per-surface onAfterMutation invalidation — the capacity query is now
  // part of useDispatchStream's canonical VISIT_JOB_KEYS refresh set.
  const [editorState, setEditorState] = useState<VisitEditorState | null>(null);
  const [slot, setSlot] = useState<QuickCreateSlot | null>(null);

  // 2026-04-08 freshness tier:
  // Workflow now carries the live overdueCount alongside on-hold/unscheduled/
  // ready-to-invoice. SSE (`useDispatchStream`) is the primary refresh path on
  // any visit/job/scheduling mutation; the 30s staleTime is the fallback for
  // signals lost during reconnect, and refetchOnWindowFocus catches tab returns.
  const { data: workflowData, isLoading: workflowLoading } = useQuery<WorkflowSummary>({
    queryKey: ["dashboard", "workflow"],
    queryFn: () => apiRequest(`/api/dashboard/workflow`),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  // 2026-04-22: redirect effect must sit AFTER every hook above so the
  // rules-of-hooks invariant holds. `redirectingToFinancial` is captured
  // once at mount and never flips — the component is short-lived when it
  // kicks in (React unmounts on route change) so there's no stale-closure
  // concern.
  useEffect(() => {
    if (redirectingToFinancial) {
      setLocation("/financials", { replace: true });
    }
  }, [redirectingToFinancial, setLocation]);

  if (redirectingToFinancial) return null;

  // 2026-04-21: /api/invoices/stats query + derived Invoices-card counts
  // were removed. Invoice metrics now live on the Financial Dashboard
  // (/financials); the Operations Dashboard is operations-only.

  // 2026-04-19: The dashboard's top-of-page Today's Operations surface is
  // now rendered by <TodaysOperationsCard />, which fetches its own
  // per-technician workload from /api/calendar + /api/team/technicians +
  // /api/team/technicians/live-state. The former aggregate
  // `/api/dashboard/today-summary` query and its `TodayVisitSummary`
  // consumer were removed from this page in the same change — the only
  // consumer was the retired KPI strip. SSE invalidation for the endpoint
  // is unchanged; any future consumer can reintroduce the hook.

  return (
    <div className="min-h-screen bg-[#F4F8F4]">
      <main className="mx-auto px-4 sm:px-5 lg:px-6 py-4">
        {/* 2026-04-08: CSS Grid 2-col × 2-row.
            - Row 1: "Today's Operations" heading
            - Row 2: KPI cards + dashboard cards (full width)
            2026-04-15: Tasks panel moved to global header; the second
            grid column is no longer needed. Grid collapsed to single
            column at every breakpoint — KPI/worklist cards now use the
            full content width. */}
        <div className="grid grid-cols-1 gap-y-2">
          {/* Row 1, col 1: heading */}
          <div className="lg:col-start-1 lg:row-start-1">
            <TodaysOperationsHeader />
          </div>

          {/* Row 2, col 1: command-center card + dashboard content */}
          <div className="lg:col-start-1 lg:row-start-2 min-w-0 space-y-3">
            {/* 2026-04-19: Top-of-page full-width live command center.
                Replaces the former Scheduled/In Progress/Remaining/Completed
                KPI strip with a technician workload rail + operational
                alerts stack. All data sourced from existing canonical
                endpoints — see TodaysOperationsCard.tsx header for the
                detailed data-source map.
                2026-04-20: Right-panel alert rows now reuse the Jobs-card
                modal by receiving the same `openActionModal` handler that
                powers the lower WorklistCard below. One modal instance,
                one canonical drill-down for both surfaces. */}
            <TodaysOperationsCard
              onOpenActionModal={openActionModal}
              onEditVisit={({ jobId, visitId, title }) =>
                setEditorState({ jobId, visitId, customerName: title })
              }
              onCreateInSlot={(s) => setSlot({
                technicianId: s.technicianId,
                technicianName: s.technicianName,
                date: s.date,
                startTime: s.startTime,
                endTime: s.endTime,
                durationMinutes: s.durationMinutes,
              })}
            />

            {/* 2026-04-22 Operations Dashboard upgrade:
                • Row 2 (always):  Quote Pipeline + Revenue Center
                • Row 3 (conditional): PM Health — only when tenant has PM data.
                Quote Pipeline hides itself when there are zero quote actions
                across all three buckets; Revenue Center then spans full width. */}
            {(() => {
              const quoteTotal =
                (workflowData?.quotes.awaitingApprovalCount ?? 0) +
                (workflowData?.quotes.draftReadyToSendCount ?? 0) +
                (workflowData?.quotes.approvedNotConvertedCount ?? 0);
              const showQuotes = workflowLoading || quoteTotal > 0;
              const showPM = (workflowData?.pm.hasAnyData ?? false) || workflowLoading;
              return (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {showQuotes && (
                      <QuotePipelineCard
                        awaitingApproval={{
                          count: workflowData?.quotes.awaitingApprovalCount ?? 0,
                          preview: workflowData?.quotes.awaitingApprovalPreview ?? [],
                        }}
                        draftReadyToSend={{
                          count: workflowData?.quotes.draftReadyToSendCount ?? 0,
                          preview: workflowData?.quotes.draftReadyToSendPreview ?? [],
                        }}
                        approvedNotConverted={{
                          count: workflowData?.quotes.approvedNotConvertedCount ?? 0,
                          preview: workflowData?.quotes.approvedNotConvertedPreview ?? [],
                        }}
                        isLoading={workflowLoading}
                      />
                    )}
                    <RevenueCenterCard
                      className={!showQuotes ? "lg:col-span-2" : ""}
                      readyToInvoiceCount={workflowData?.jobs.requiresInvoicingCount ?? 0}
                      draftInvoiceCount={workflowData?.invoices.draftCount ?? 0}
                      overdueInvoiceCount={workflowData?.invoices.pastDueCount ?? 0}
                      approvedQuotesNotConvertedCount={workflowData?.quotes.approvedNotConvertedCount ?? 0}
                      unscheduledCount={workflowData?.jobs.unscheduledCount ?? 0}
                      isLoading={workflowLoading}
                    />
                  </div>

                  {showPM && (
                    <PMHealthCard
                      overdueCount={workflowData?.pm.overdueCount ?? 0}
                      comingDueCount={workflowData?.pm.comingDueCount ?? 0}
                      upcomingCount={workflowData?.pm.upcomingCount ?? 0}
                      awaitingGenerationCount={workflowData?.pm.awaitingGenerationCount ?? 0}
                      isLoading={workflowLoading}
                    />
                  )}
                </>
              );
            })()}
          </div>

          {/* 2026-04-16: midnight rollover widget. Only renders when
              there is at least one auto-paused entry in the last 7 days;
              silent on quiet days. */}
          <MidnightRolloverCard />
        </div>
      </main>
      <DashboardActionModal
        open={actionModalOpen}
        onOpenChange={setActionModalOpen}
        mode={actionModalMode}
      />

      {/* Canonical launchers. Dashboard passes context only; these
          components own the modal/chooser/dialog lifecycle. Dispatch
          mounts the same two launchers. Refresh is driven by
          useDispatchStream's VISIT_JOB_KEYS set (now includes
          "/api/dashboard/capacity") — no explicit invalidation here. */}
      <VisitEditorLauncher
        state={editorState}
        onClose={() => setEditorState(null)}
      />
      <SlotQuickCreateLauncher
        slot={slot}
        onClose={() => setSlot(null)}
      />
    </div>
  );
}
