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

import { useState } from "react";
import { useLocation } from "wouter";
import {
  FileText, ChevronRight,
  Wrench,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { resolveDashboardNav, type DashboardAction } from "@/lib/dashboardNavigation";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardActionModal, type DashboardActionMode } from "@/components/DashboardActionModal";
import { MidnightRolloverCard } from "@/components/MidnightRolloverCard";
import { TodaysOperationsCard } from "@/components/TodaysOperationsCard";
import { DashboardViewToggle } from "@/components/dashboard/DashboardViewToggle";
import {
  VisitEditorLauncher,
  type VisitEditorState,
} from "@/components/dispatch/VisitEditorLauncher";
import {
  SlotQuickCreateLauncher,
  type QuickCreateSlot,
} from "@/components/dispatch/SlotQuickCreateLauncher";
import type { Invoice as SchemaInvoice } from "@shared/schema";

// ============================================================================
// Types
// ============================================================================

interface Invoice extends Pick<SchemaInvoice, "id" | "invoiceNumber" | "total" | "balance" | "dueDate" | "status"> {
  locationName?: string;
  isPastDue?: boolean;
}

interface WorkflowSummary {
  quotes: { approvedCount: number; draftCount: number };
  jobs: {
    requiresInvoicingCount: number;
    activeCount: number;
    onHoldCount: number;
    unscheduledCount: number;
    // 2026-04-08: Live overdue count from /api/dashboard/workflow.
    // This is the SOLE source of the overdue count for the dashboard widget.
    overdueCount: number;
  };
  invoices: { outstandingCount: number; pastDueCount: number };
  pm: { awaitingGenerationCount: number; overdueCount: number; comingDueCount: number; upcomingCount: number };
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
// Shared card primitives
// ============================================================================

function DashCard({ children, className = "", elevated }: { children: React.ReactNode; className?: string; elevated?: boolean }) {
  return (
    <div className={`bg-[#ffffff] dark:bg-gray-900 rounded-md overflow-hidden border border-[#e2e8f0] dark:border-gray-700 ${className}`} style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      {children}
    </div>
  );
}

// ============================================================================
// Today's Operations (command center top — strongest visual anchor)
// ----------------------------------------------------------------------------
// 2026-04-08: Split into TodaysOperationsHeader + TodaysOperationsKPIs so the
// parent can place the heading and the KPI cards in different CSS Grid cells.
// This is the structural fix that lets the Tasks panel align with the KPI row
// instead of the heading.
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

// ============================================================================
// Worklist Card (flat rows, pipeline-style phrasing)
// ============================================================================

interface WorklistRow {
  label: string;
  value: number | string;
  sub?: string;
  action: DashboardAction;
  warn?: boolean;
  urgentBg?: boolean;
  /** Optional click override — when set, row calls this instead of navigating */
  onClick?: () => void;
}

function WorklistCard({ title, icon: Icon, color, bg, headerStrength, rows, isLoading, elevated }: {
  title: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  headerStrength?: "strong" | "medium" | "light";
  rows: WorklistRow[];
  isLoading: boolean;
  elevated?: boolean;
}) {
  const [, setLocation] = useLocation();

  return (
    <DashCard className="flex flex-col" elevated={elevated}>
      <div className="px-4 py-2.5 border-b border-[#e2e8f0] dark:border-gray-600">
        <div className="flex items-center gap-2">
          <Icon className={`h-3.5 w-3.5 ${color}`} />
          <h3 className="text-sm font-semibold text-[#111827] dark:text-gray-100">{title}</h3>
        </div>
      </div>
      <div className="flex-1">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {rows.map((_, i) => <Skeleton key={i} className="h-8" />)}
          </div>
        ) : (
          <div>
            {rows.map((row, index) => {
              const isLast = index === rows.length - 1;
              const numVal = typeof row.value === "number" ? row.value : parseFloat(String(row.value).replace(/[^0-9.-]/g, "")) || 0;
              const isWarn = row.warn && numVal > 0;
              return (
                <button
                  key={row.label}
                  onClick={() => row.onClick ? row.onClick() : setLocation(resolveDashboardNav(row.action))}
                  className={`w-full text-left px-4 py-1.5 hover:bg-[#F0F5F0] transition-colors flex items-center justify-between group ${row.urgentBg ? (numVal > 0 ? "bg-red-50/60 dark:bg-red-950/15" : "bg-red-50/20 dark:bg-red-950/5") : ""} ${!isLast ? "border-b border-[#e2e8f0]" : ""}`}
                >
                  <span className={`text-xs group-hover:text-[#111827] transition-colors ${isWarn ? "text-red-600 dark:text-red-400 font-medium" : "text-[#4b5563]"}`}>
                    {row.label}
                  </span>
                  <div className="flex items-center gap-2">
                    {row.sub && <span className="text-[11px] text-[#4b5563]">{row.sub}</span>}
                    <span className={`text-sm font-bold tabular-nums ${isWarn ? "text-red-600" : numVal > 0 || typeof row.value === "string" ? "text-[#111827]" : "text-[#4b5563]"}`}>
                      {row.value}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-[#4b5563] group-hover:text-[#111827] transition-colors" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </DashCard>
  );
}

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

            {/* 2026-04-21: Invoices WorklistCard removed — invoice
                management is now the Financial Dashboard's concern.
                The Operations Dashboard is operations-only. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <WorklistCard
                title="Quotes"
                icon={FileText}
                color="text-teal-600"
                bg="bg-teal-100 dark:bg-teal-950/30"
                headerStrength="light"
                isLoading={workflowLoading}
                rows={[
                  { label: "Quotes awaiting approval", value: workflowData?.quotes.draftCount ?? 0, action: "pipeline.quotesAwaitingApproval" },
                  { label: "Draft quotes — need sending", value: 0, action: "quotes.draft" },
                  { label: "Approved quotes not converted", value: workflowData?.quotes.approvedCount ?? 0, action: "quotes.approved" },
                ]}
              />
              <WorklistCard
                title="PM Health"
                icon={Wrench}
                color="text-violet-600"
                bg="bg-violet-100 dark:bg-violet-950/30"
                headerStrength="light"
                isLoading={workflowLoading}
                rows={[
                  { label: "Overdue PM work", value: workflowData?.pm.overdueCount ?? 0, action: "pm.overdue", warn: true, urgentBg: true },
                  { label: "PM due in next 7 days", value: workflowData?.pm.comingDueCount ?? 0, action: "pm.comingDue" },
                  { label: "Upcoming PM (7–30 days)", value: workflowData?.pm.upcomingCount ?? 0, action: "pm.upcoming" },
                  { label: "PM instances awaiting generation", value: workflowData?.pm.awaitingGenerationCount ?? 0, action: "pipeline.pmAwaiting" },
                ]}
              />
            </div>
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
