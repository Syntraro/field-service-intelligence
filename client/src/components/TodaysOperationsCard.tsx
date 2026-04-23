/**
 * TodaysOperationsCard — Live operational command center.
 *
 * Full-width card with two compositions:
 *
 *   LEFT (≈75%) — horizontally scrollable technician workload rail. Each
 *   tile is a compact day-at-a-glance: avatar + name, "N jobs · ~Xh"
 *   summary, and a chronological list of the tech's schedule rows
 *   (booked visits + ≥2h open gaps). Click → /dispatch.
 *
 *   RIGHT (≈25%) — operational alerts stack. Four rows mirroring the
 *   canonical workflow counts (Unscheduled / Past Due / Action Required /
 *   Ready for Invoice). Click opens the canonical DashboardActionModal.
 *
 *   2026-04-20 (row rail refactor): the tile's status badge, load
 *   percentage, progress bar, and 3-item visit preview were removed —
 *   the schedule-rows list carries the operational signal cleanly on
 *   its own. The separate "Today's Capacity" card that previously sat
 *   below this surface was deleted in the same pass.
 *
 * Data sources:
 *   - GET /api/dashboard/capacity   — per-tech schedule blocks, visit
 *     count, booked minutes, state. Server-side computation reuses the
 *     canonical visit query + workingHours + companyBusinessHours
 *     already used by dispatch/calendar. Authoritative source for the
 *     tech rail.
 *   - GET /api/team/technicians     — directory lookup for avatar color.
 *   - GET /api/dashboard/workflow   — right-panel alert counts (shared
 *     cache with Dashboard.tsx and the lower Invoices card).
 *
 * SSE invalidation: capacity + workflow query keys are covered by
 * useDispatchStream's prefix sets.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Briefcase,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Receipt,
  Settings2,
  Users,
} from "lucide-react";

/**
 * 2026-04-21: Operational-alerts rail collapse.
 *
 * The rail compacts to a 64px vertical strip so the Team Workload panel
 * can reclaim the horizontal space on dense dashboards. Preference is
 * persisted per-browser (same tenant/user) via localStorage, and the
 * mobile/tablet initial default is "collapsed" so touch users aren't
 * buried in four alert rows before they see their schedule.
 */
const ALERTS_COLLAPSED_KEY = "syntraro:dash-alerts-collapsed";
import { Skeleton } from "@/components/ui/skeleton";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { resolveDashboardNav } from "@/lib/dashboardNavigation";
import type { DashboardActionMode } from "@/components/DashboardActionModal";
// 2026-04-21: shared dropdown shell (extracted from DispatchFiltersBar) so
// the dashboard controls mirror the dispatcher interaction pattern.
import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";

// ============================================================================
// Types
// ============================================================================

interface WorkflowSummaryJobs {
  jobs: {
    requiresInvoicingCount: number;
    activeCount: number;
    onHoldCount: number;
    unscheduledCount: number;
    overdueCount: number;
  };
}

// 2026-04-20: Tech tile is now a day-at-a-glance schedule list. Status
// badge / load percentage / progress bar were removed — the schedule
// rows themselves carry the operational signal. Data flows from the
// canonical /api/dashboard/capacity endpoint (same source that formerly
// powered the separate Today's Capacity card — now deleted).

type CapacityTileState =
  | "open_now"
  | "next_opening"
  | "limited_opening"
  | "fully_open"
  | "fully_booked"
  | "day_over"
  | "off_today";

interface ScheduleBlock {
  kind: "booked" | "open";
  startISO: string;
  endISO: string;
  durationMinutes: number;
  title?: string;
  visitId?: string;
  jobId?: string;
  visitStatus?: string;
}

interface TechnicianCapacityDto {
  technicianId: string;
  name: string;
  state: CapacityTileState;
  visitCount: number;
  bookedMinutes: number;
  scheduleBlocks: ScheduleBlock[];
}

interface CapacityResponseDto {
  timezone: string;
  technicians: TechnicianCapacityDto[];
}

interface TechCardData {
  id: string;
  name: string;
  initials: string;
  color: string | null;
  state: CapacityTileState;
  visitCount: number;
  bookedMinutes: number;
  scheduleBlocks: ScheduleBlock[];
  /** Company IANA timezone — used to format the schedule block clocks. */
  timezone: string;
}

// ============================================================================
// Helpers
// ============================================================================

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Format a UTC ISO timestamp as a clock-time string in the supplied IANA
 * zone. Without `timeZone` passed through, the browser renders in its
 * local zone — which breaks when a user is browsing in a different zone
 * than the company. The canonical backend emits company-local wall
 * clocks as UTC instants; the client must render in the same zone.
 */
function formatClockTime(iso: string, timezone: string | undefined): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: timezone });
}

function formatHours(minutes: number): string {
  if (minutes <= 0) return "0h";
  const h = minutes / 60;
  if (h < 1) return `${minutes}m`;
  if (Number.isInteger(h)) return `${h}h`;
  return `${h.toFixed(1)}h`;
}

/**
 * "3h 15m" / "45m" / "2h" — used for the Open-row duration suffix.
 * Distinct from `formatHours` (which returns decimal hours like "1.5h")
 * because the tile's Open label reads more naturally as "Open (3h 15m)".
 */
function formatOpenDuration(minutes: number): string {
  if (minutes <= 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Extract the company-local YYYY-MM-DD of an ISO instant. The capacity
 * endpoint already anchors every ISO it emits to the company's timezone,
 * so this formatter needs only the `timezone` field from that response
 * to produce the wall-clock date the dispatch board would show.
 */
function localYmdFromIso(iso: string, timezone: string | undefined): string {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const y = parts.find(p => p.type === "year")?.value ?? "0000";
  const m = parts.find(p => p.type === "month")?.value ?? "01";
  const day = parts.find(p => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

/** Extract "HH:mm" (24h) in the supplied timezone. */
function localHmFromIso(iso: string, timezone: string | undefined): string {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone || undefined,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(d);
}

// ============================================================================
// Component
// ============================================================================

interface TodaysOperationsCardProps {
  /**
   * Callback for opening the canonical DashboardActionModal in a given
   * mode. Passed down from Dashboard.tsx so the right-panel alert rows
   * open the same modal the lower Jobs card opens — single modal
   * instance, same UX. When omitted the component falls back to URL
   * navigation via resolveDashboardNav (degraded, but functional).
   */
  onOpenActionModal?: (mode: DashboardActionMode) => void;
  /**
   * 2026-04-20 — booked-row click handler. Dashboard.tsx hosts the
   * canonical EditVisitModal; this callback requests it be opened for a
   * specific visit. Omitted in tests / isolated renders (row becomes a
   * no-op button).
   */
  onEditVisit?: (args: {
    jobId: string;
    visitId: string;
    title?: string;
  }) => void;
  /**
   * 2026-04-20 — open-row click handler. Dashboard.tsx hosts the mini
   * create chooser + QuickAddJobDialog + TaskDialog; this callback hands
   * off the slot context (tech + company-local date/time + duration).
   */
  onCreateInSlot?: (slot: {
    technicianId: string;
    technicianName: string;
    date: string;            // YYYY-MM-DD (company-local)
    startTime: string;       // HH:mm (company-local, 24h)
    endTime: string;         // HH:mm (company-local, 24h)
    durationMinutes: number;
  }) => void;
}

export function TodaysOperationsCard({
  onOpenActionModal,
  onEditVisit,
  onCreateInSlot,
}: TodaysOperationsCardProps = {}) {
  const [, setLocation] = useLocation();

  // 1. Per-tech capacity (schedule blocks + visit counts). Single canonical
  //    endpoint — server computes schedule blocks from the same visit +
  //    working-hours sources the dispatch board uses.
  const capacityQuery = useQuery<CapacityResponseDto>({
    queryKey: ["/api/dashboard/capacity"],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/capacity`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch capacity");
      return res.json();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  // 2. Technician directory — only used for avatar color + initials fallback.
  const { teamMembers, isLoading: techLoading } = useTechniciansDirectory();

  // 3. Workflow counts — shared cache with Dashboard.tsx's own query.
  const workflowQuery = useQuery<WorkflowSummaryJobs>({
    queryKey: ["dashboard", "workflow"],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/workflow`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch workflow");
      return res.json();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  // ── Derived: per-tech tile data ────────────────────────────────────────
  // Join capacity (schedule blocks + counts + state) with directory
  // (avatar color). Capacity is authoritative for the tech list — it
  // already applies filterSchedulableTechnicians() server-side.
  const techCards: TechCardData[] = useMemo(() => {
    const caps = capacityQuery.data?.technicians ?? [];
    const tz = capacityQuery.data?.timezone ?? "";
    const directoryById = new Map<string, { color: string | null; fullName?: string; email?: string }>();
    for (const m of teamMembers) {
      directoryById.set(m.id, { color: m.color ?? null, fullName: m.fullName, email: m.email });
    }

    const cards: TechCardData[] = caps.map((c) => {
      const dir = directoryById.get(c.technicianId);
      return {
        id: c.technicianId,
        name: c.name,
        initials: initialsFromName(c.name),
        color: dir?.color ?? null,
        state: c.state,
        visitCount: c.visitCount,
        bookedMinutes: c.bookedMinutes,
        scheduleBlocks: c.scheduleBlocks,
        timezone: tz,
      };
    });

    // Sort: techs with visits today first (busiest actionable), then
    // techs with any open block, then off/day-over. Within each group
    // prefer more booked minutes, then name.
    const groupRank = (card: TechCardData) => {
      if (card.state === "off_today") return 3;
      if (card.state === "day_over") return 2;
      if (card.visitCount === 0) return 1;
      return 0;
    };
    cards.sort((a, b) => {
      const g = groupRank(a) - groupRank(b);
      if (g !== 0) return g;
      if (b.bookedMinutes !== a.bookedMinutes) return b.bookedMinutes - a.bookedMinutes;
      return a.name.localeCompare(b.name);
    });

    return cards;
  }, [capacityQuery.data, teamMembers]);

  // ── Derived: alerts panel counts ───────────────────────────────────────
  // All four come directly from the canonical workflow summary — same
  // source the lower Jobs card uses. No client-side aggregation, no
  // sampling caps, no arbitrary thresholds.
  const unscheduledCount = workflowQuery.data?.jobs.unscheduledCount ?? 0;
  const pastDueCount = workflowQuery.data?.jobs.overdueCount ?? 0;
  const actionRequiredCount = workflowQuery.data?.jobs.onHoldCount ?? 0;
  const readyToInvoiceCount = workflowQuery.data?.jobs.requiresInvoicingCount ?? 0;

  /**
   * Open the canonical DashboardActionModal when the parent supplied a
   * handler; otherwise fall back to URL navigation. Keeps this component
   * usable in isolation while ensuring the Dashboard-mounted instance
   * opens the same modal the lower Jobs card opens.
   */
  const handleAlertClick = (mode: DashboardActionMode, fallbackPath: string) => {
    if (onOpenActionModal) onOpenActionModal(mode);
    else setLocation(fallbackPath);
  };

  // 2026-04-21 UX pass: two header-level filters.
  //   1. workloadView: "all" | "open" — booked+open rows vs open-only.
  //   2. selectedTechIds: Set<string> — which techs appear on the rail.
  //      null means "all techs"; any Set means explicit subset. We never
  //      persist a subset that's equal to "all" — when the user hits Select
  //      All we reset to null so the label collapses back to "All technicians".
  const [workloadView, setWorkloadView] = useState<"all" | "open">("all");
  const [selectedTechIds, setSelectedTechIds] = useState<Set<string> | null>(null);

  // ── Render ─────────────────────────────────────────────────────────────
  const isLoading = capacityQuery.isLoading || techLoading || workflowQuery.isLoading;

  // Prune any persisted selection that no longer maps to a live tech. Runs
  // whenever the capacity feed refreshes — e.g. a tech was deactivated or
  // their working hours dropped out from under them. Without this the
  // dropdown would claim "2 selected" while rendering nothing.
  useEffect(() => {
    if (!selectedTechIds) return;
    const live = new Set(techCards.map((t) => t.id));
    let changed = false;
    const next = new Set<string>();
    selectedTechIds.forEach((id) => {
      if (live.has(id)) next.add(id);
      else changed = true;
    });
    if (!changed) return;
    // If pruning collapsed the set to "effectively everyone", fall back to
    // the null sentinel so the label reads "All technicians".
    if (next.size === 0 || next.size === techCards.length) setSelectedTechIds(null);
    else setSelectedTechIds(next);
  }, [techCards, selectedTechIds]);

  // Apply the two filters in sequence. View mode happens first so the empty-
  // state wording can distinguish "this tech has no open time" from "you
  // filtered everyone out".
  const viewFiltered =
    workloadView === "open"
      ? techCards.filter((t) => t.scheduleBlocks.some((b) => b.kind === "open"))
      : techCards;
  const visibleTechCards =
    selectedTechIds === null
      ? viewFiltered
      : viewFiltered.filter((t) => selectedTechIds.has(t.id));

  // Concise trigger labels per the UX spec: "All technicians" when nothing
  // is narrowed, the tech's name for a single pick, else "N selected".
  const teamFilterLabel =
    selectedTechIds === null || selectedTechIds.size === techCards.length
      ? "All team"
      : selectedTechIds.size === 1
        ? techCards.find((t) => selectedTechIds.has(t.id))?.name ?? "1 selected"
        : `${selectedTechIds.size} selected`;

  const toggleTech = (id: string) => {
    setSelectedTechIds((prev) => {
      // Expand null ("all") to the full set the first time the user narrows.
      const base = prev ?? new Set(techCards.map((t) => t.id));
      const next = new Set(base);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Collapse back to the null sentinel when the user lands on "all
      // selected" — keeps the trigger label at "All technicians" rather
      // than showing a numeric count that means the same thing.
      if (next.size === 0 || next.size === techCards.length) return null;
      return next;
    });
  };
  const selectAllTechs = () => setSelectedTechIds(null);
  const clearAllTechs = () => setSelectedTechIds(new Set());

  // ---------------------------------------------------------------------
  // 2026-04-21: Operational-alerts collapse state + persistence.
  // Initial value: localStorage (if set), otherwise viewport-based default
  // (collapsed on anything below Tailwind's `lg` breakpoint = 1024px).
  // ---------------------------------------------------------------------
  const [alertsCollapsed, setAlertsCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem(ALERTS_COLLAPSED_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
    return window.matchMedia("(max-width: 1023px)").matches;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(ALERTS_COLLAPSED_KEY, alertsCollapsed ? "1" : "0");
    } catch {
      // localStorage may be unavailable (private mode, quota) — silent fallback.
    }
  }, [alertsCollapsed]);

  const totalAlertCount =
    unscheduledCount + pastDueCount + actionRequiredCount + readyToInvoiceCount;
  const isUrgent = actionRequiredCount > 0;

  return (
    <div
      className="bg-white rounded-md border border-[#e2e8f0] overflow-hidden"
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
    >
      {/* 2026-04-21: Grid replaced by flex so the right rail can animate
          its width smoothly between expanded (~320px) and collapsed
          (64px). The left panel uses `flex-1 min-w-0` to reclaim space
          automatically as the rail collapses. */}
      <div className="flex flex-col lg:flex-row">
        {/* LEFT — Technician workload panel (auto-expands as alerts rail collapses) */}
        <div className="flex-1 min-w-0 p-4 border-b lg:border-b-0 lg:border-r border-[#e2e8f0]">
          <div className="flex items-center justify-between mb-3 gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Users className="h-3.5 w-3.5 text-[#4b5563] shrink-0" />
              <h4 className="text-sm font-semibold text-[#111827] truncate">Team workload</h4>
            </div>
            {/* 2026-04-21 UX refinement: two-dropdown pattern mirrors the
                Dispatch filter bar. View dropdown owns booked-vs-open; Team
                dropdown owns the visible-tech subset and carries the
                Manage team shortcut in its footer. No count text, no
                loose Manage team link — the dropdowns carry the state. */}
            <div className="flex items-center gap-2 shrink-0">
              <MultiSelectDropdown
                label={workloadView === "all" ? "All" : "Open"}
                width="w-40"
                align="right"
                testId="workload-view-trigger"
              >
                <div className="p-1">
                  <button
                    type="button"
                    onClick={() => setWorkloadView("all")}
                    className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-xs hover:bg-slate-50"
                    data-testid="workload-view-all"
                  >
                    <span>All</span>
                    {workloadView === "all" && <Check className="h-3 w-3 text-primary" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkloadView("open")}
                    className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-xs hover:bg-slate-50"
                    data-testid="workload-view-open"
                  >
                    <span>Open</span>
                    {workloadView === "open" && <Check className="h-3 w-3 text-primary" />}
                  </button>
                </div>
              </MultiSelectDropdown>

              <MultiSelectDropdown
                label={teamFilterLabel}
                width="w-60"
                align="right"
                testId="workload-team-trigger"
              >
                <div className="p-2">
                  <div className="mb-2 flex gap-1">
                    <button
                      onClick={selectAllTechs}
                      className="text-xs text-primary hover:underline"
                      data-testid="workload-team-select-all"
                    >
                      Select All
                    </button>
                    <span className="text-xs text-muted-foreground">|</span>
                    <button
                      onClick={clearAllTechs}
                      className="text-xs text-primary hover:underline"
                      data-testid="workload-team-clear-all"
                    >
                      Clear All
                    </button>
                  </div>
                  {techCards.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground italic">
                      No team members available.
                    </p>
                  ) : (
                    <div className="max-h-[260px] overflow-y-auto">
                      {techCards.map((t) => {
                        // `selectedTechIds === null` means "everyone" — reflect
                        // that as checked in the UI so Select All looks truthful.
                        const checked =
                          selectedTechIds === null || selectedTechIds.has(t.id);
                        return (
                          <button
                            key={t.id}
                            onClick={() => toggleTech(t.id)}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-slate-50"
                            data-testid={`workload-team-toggle-${t.id}`}
                          >
                            <div
                              className={`flex h-4 w-4 items-center justify-center rounded border ${
                                checked ? "border-primary bg-primary" : "border-slate-300"
                              }`}
                            >
                              {checked && <Check className="h-3 w-3 text-white" />}
                            </div>
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: t.color || "#64748b" }}
                            />
                            <span className="truncate">{t.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="my-1.5 border-t border-slate-100" />
                  <Link href="/settings/team?tab=schedules">
                    <a
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      data-testid="workload-manage-team-link"
                    >
                      <Settings2 className="h-3 w-3" />
                      <span className="flex-1">Manage team</span>
                      <ExternalLink className="h-3 w-3 opacity-60" />
                    </a>
                  </Link>
                </div>
              </MultiSelectDropdown>
            </div>
          </div>

          {isLoading ? (
            <div className="flex gap-3 overflow-hidden">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-[188px] w-[260px] shrink-0 rounded-md" />
              ))}
            </div>
          ) : techCards.length === 0 ? (
            <div className="text-sm text-[#4b5563] italic py-6">No available team members.</div>
          ) : visibleTechCards.length === 0 ? (
            // Distinguish "nothing selected" from "nobody has open time" so
            // the fix path is obvious at a glance.
            <div className="text-sm text-[#4b5563] italic py-6" data-testid="workload-open-empty">
              {selectedTechIds !== null && selectedTechIds.size === 0
                ? "No team members selected."
                : workloadView === "open"
                  ? "No team members have open availability today."
                  : "No team members match the current filters."}
            </div>
          ) : (
            <div
              className="flex gap-3 overflow-x-auto pb-1"
              style={{
                scrollbarWidth: "thin",
                scrollbarColor: "#cbd5e1 transparent",
              }}
            >
              {visibleTechCards.map((t) => (
                <TechnicianWorkloadTile
                  key={t.id}
                  card={t}
                  view={workloadView}
                  onEditVisit={onEditVisit}
                  onCreateInSlot={onCreateInSlot}
                />
              ))}
            </div>
          )}
        </div>

        {/* RIGHT — Operational alerts. Width transitions smoothly between
            expanded (lg:w-80) and collapsed (lg:w-16); on mobile/tablet
            the card stacks vertically so the rail takes full width in
            either state. `overflow-hidden` clips the swapped inner
            content during the transition — the width animates, the
            contents swap on commit (no cross-fade jank). */}
        <div
          className={`shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out ${
            alertsCollapsed ? "w-full lg:w-16" : "w-full lg:w-80"
          }`}
          data-testid="alerts-rail"
          data-collapsed={alertsCollapsed ? "true" : "false"}
        >
          {alertsCollapsed ? (
            <button
              type="button"
              onClick={() => setAlertsCollapsed(false)}
              className={`w-full h-full min-h-[56px] lg:min-h-[180px] flex flex-row lg:flex-col items-center justify-center gap-2.5 px-3 py-3 lg:py-6 transition-colors ${
                isUrgent ? "bg-red-50/60 hover:bg-red-50" : "hover:bg-slate-50"
              }`}
              aria-label={`Expand operational alerts (${totalAlertCount} total)`}
              aria-expanded="false"
              data-testid="alerts-expand-toggle"
            >
              <AlertTriangle
                className={`h-4 w-4 shrink-0 ${isUrgent ? "text-red-600" : "text-[#4b5563]"}`}
              />
              <span
                className={`text-xs font-semibold uppercase tracking-wide ${
                  isUrgent ? "text-red-600" : "text-[#4b5563]"
                }`}
              >
                Alerts
              </span>
              <span
                className={`inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full text-[10px] font-bold tabular-nums ${
                  isUrgent
                    ? "bg-red-600 text-white"
                    : totalAlertCount > 0
                      ? "bg-[#111827] text-white"
                      : "bg-slate-200 text-slate-600"
                }`}
                aria-label={`${totalAlertCount} active alerts`}
              >
                {totalAlertCount}
              </span>
              <ChevronLeft
                className="hidden lg:inline h-3.5 w-3.5 text-slate-400 lg:mt-1"
                aria-hidden="true"
              />
            </button>
          ) : (
            <div className="p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle
                    className={`h-3.5 w-3.5 shrink-0 ${isUrgent ? "text-red-600" : "text-[#4b5563]"}`}
                  />
                  <h4 className="text-sm font-semibold text-[#111827] truncate">
                    Operational alerts
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setAlertsCollapsed(true)}
                  className="shrink-0 inline-flex items-center justify-center h-6 w-6 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                  aria-label="Collapse operational alerts"
                  aria-expanded="true"
                  data-testid="alerts-collapse-toggle"
                  title="Collapse"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="space-y-0.5">
                {/* 2026-04-21: Row order reflects operational triage — Action
                    Required (human-in-the-loop) surfaces first, then Past Due,
                    then Unscheduled backlog, then Ready for Invoice as the
                    cashflow tail. Presentation only; counts, handlers, and
                    modal wiring are unchanged.
                    2026-04-22: vertical rhythm tightened (outer space-y-1 →
                    space-y-0.5, AlertRow padding py-2 → py-1.5) so low-count
                    days stop feeling loose. */}
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
                  count={unscheduledCount}
                  onClick={() =>
                    handleAlertClick("scheduling_issues", resolveDashboardNav("jobs.unscheduled"))
                  }
                />
                <AlertRow
                  icon={Receipt}
                  label="Ready for Invoice"
                  count={readyToInvoiceCount}
                  onClick={() =>
                    handleAlertClick("ready_to_invoice", resolveDashboardNav("jobs.needsInvoicing"))
                  }
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Technician workload tile
// ============================================================================

/**
 * Tech tile row rendering rules (all driven by canonical capacity data):
 *
 *  - Header: avatar + name + summary "N jobs · ~Xh".
 *  - Body:
 *      off_today → single muted line "Off today".
 *      day_over with no blocks → single muted line "Day ended".
 *      No blocks at all (working hours <2h with no visits) → "No scheduled jobs today".
 *      Otherwise → chronological schedule blocks, one row each:
 *        BOOKED: time range · customer/location name (neutral styling).
 *        OPEN:   time range · "Open" (subtle emerald tint — operationally
 *                meaningful but not alarming; gaps under 120min are never
 *                emitted server-side so we never render them here).
 */
function TechnicianWorkloadTile({
  card,
  view = "all",
  onEditVisit,
  onCreateInSlot,
}: {
  card: TechCardData;
  /** 2026-04-21: "all" = booked + open rows with the jobs/hours summary.
   *  "open" = open rows only, summary replaced with total-available time. */
  view?: "all" | "open";
  onEditVisit?: TodaysOperationsCardProps["onEditVisit"];
  onCreateInSlot?: TodaysOperationsCardProps["onCreateInSlot"];
}) {
  // In open-only mode, drop booked rows before deciding the empty-state
  // branches — otherwise a fully-booked tech would wrongly render the
  // "day ended" / "no jobs" copy when the user only wants availability.
  const blocks =
    view === "open"
      ? card.scheduleBlocks.filter((b) => b.kind === "open")
      : card.scheduleBlocks;
  const showOffToday = card.state === "off_today";
  const showDayEnded = view === "all" && card.state === "day_over" && blocks.length === 0;
  const showEmptyFallback = !showOffToday && !showDayEnded && blocks.length === 0;
  const openMinutesTotal = card.scheduleBlocks
    .filter((b) => b.kind === "open")
    .reduce((acc, b) => acc + b.durationMinutes, 0);

  // Outer wrapper is a plain <div>. Per-row <button>s own click handling;
  // nesting buttons inside a tile-level button was brittle and the
  // tile-wide "→ /dispatch" behavior is superseded by the richer row-
  // level actions (edit visit / quick create in slot).
  return (
    <div className="shrink-0 w-[260px] rounded-md border border-[#e2e8f0] bg-white px-3 py-3">
      <div className="flex items-center gap-2.5 mb-2">
        <span
          className="h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
          style={{ backgroundColor: card.color || "#64748b" }}
          aria-hidden="true"
        >
          {card.initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#111827] truncate">{card.name}</p>
          {/* Open-only mode suppresses the job/hours workload summary and
              surfaces an availability-first label instead. No new feed —
              openMinutesTotal sums existing scheduleBlocks of kind "open". */}
          {view === "open" ? (
            <p className="text-[11px] text-emerald-700 tabular-nums">
              {openMinutesTotal > 0
                ? `${formatOpenDuration(openMinutesTotal)} open today`
                : "No open time"}
            </p>
          ) : (
            <p className="text-[11px] text-[#4b5563] tabular-nums">
              {card.visitCount} {card.visitCount === 1 ? "job" : "jobs"} · ~{formatHours(card.bookedMinutes)}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-0.5">
        {showOffToday ? (
          <p className="text-[11px] text-[#94a3b8] italic">Off today</p>
        ) : showDayEnded ? (
          <p className="text-[11px] text-[#94a3b8] italic">Day ended</p>
        ) : showEmptyFallback ? (
          <p className="text-[11px] text-[#94a3b8] italic">
            {view === "open" ? "No open time today" : "No scheduled jobs today"}
          </p>
        ) : (
          blocks.map((block, idx) => (
            <ScheduleBlockRow
              key={`${block.kind}-${block.startISO}-${idx}`}
              block={block}
              timezone={card.timezone}
              technicianId={card.id}
              technicianName={card.name}
              onEditVisit={onEditVisit}
              onCreateInSlot={onCreateInSlot}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ScheduleBlockRow({
  block,
  timezone,
  technicianId,
  technicianName,
  onEditVisit,
  onCreateInSlot,
}: {
  block: ScheduleBlock;
  timezone: string;
  technicianId: string;
  technicianName: string;
  onEditVisit?: TodaysOperationsCardProps["onEditVisit"];
  onCreateInSlot?: TodaysOperationsCardProps["onCreateInSlot"];
}) {
  const tz = timezone || undefined;
  const timeRange = `${formatClockTime(block.startISO, tz)} – ${formatClockTime(block.endISO, tz)}`;

  if (block.kind === "open") {
    const disabled = !onCreateInSlot;
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!onCreateInSlot) return;
          onCreateInSlot({
            technicianId,
            technicianName,
            date: localYmdFromIso(block.startISO, tz),
            startTime: localHmFromIso(block.startISO, tz),
            endTime: localHmFromIso(block.endISO, tz),
            durationMinutes: block.durationMinutes,
          });
        }}
        className="w-full text-left flex items-center gap-1 text-[11px] rounded-sm px-1 -mx-1 bg-emerald-50/40 hover:bg-emerald-50 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:cursor-default disabled:hover:bg-emerald-50/40"
        data-testid="capacity-open-row"
        aria-label={`Create in open slot ${timeRange} (${formatOpenDuration(block.durationMinutes)}) for ${technicianName}`}
      >
        <span className="text-[#4b5563] tabular-nums shrink-0">{timeRange}</span>
        <span className="text-[#94a3b8]">·</span>
        <span className="text-emerald-700 font-medium">Open</span>
        <span className="text-emerald-700/80 tabular-nums">({formatOpenDuration(block.durationMinutes)})</span>
      </button>
    );
  }

  const dimmed = block.visitStatus === "completed" || block.visitStatus === "cancelled";
  const hasVisit = Boolean(block.visitId && block.jobId);
  const disabled = !onEditVisit || !hasVisit;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (!onEditVisit || !block.visitId || !block.jobId) return;
        onEditVisit({
          jobId: block.jobId,
          visitId: block.visitId,
          title: block.title,
        });
      }}
      className="w-full text-left flex items-center gap-1 text-[11px] rounded-sm px-1 -mx-1 hover:bg-[#F0F5F0] transition-colors focus:outline-none focus:ring-2 focus:ring-[#76B054]/30 disabled:cursor-default disabled:hover:bg-transparent"
      data-testid="capacity-booked-row"
      aria-label={`Open visit ${block.title ?? ""} ${timeRange}`}
    >
      <span className={`tabular-nums shrink-0 ${dimmed ? "text-[#9ca3af]" : "text-[#4b5563]"}`}>
        {timeRange}
      </span>
      <span className="text-[#94a3b8]">·</span>
      <span className={`truncate ${dimmed ? "text-[#9ca3af] line-through" : "text-[#111827]"}`}>
        {block.title ?? "Scheduled"}
      </span>
    </button>
  );
}

// ============================================================================
// Alert row
// 2026-04-23: exported so the Business Dashboard (FinancialDashboard.tsx)
// can mount the SAME component with identical styling + interaction
// contract. Zero behavior change for Operations; only added the `export`
// keyword. Consumers pass the same canonical onClick → DashboardActionModal
// wiring. No fork, no duplicate styling.
// ============================================================================

export function AlertRow({
  icon: Icon,
  label,
  count,
  onClick,
  urgent,
}: {
  icon: React.ElementType;
  label: string;
  count: number;
  onClick: () => void;
  urgent?: boolean;
}) {
  const hasCount = count > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-left transition-colors group ${
        urgent && hasCount
          ? "bg-red-50/60 hover:bg-red-50"
          : "hover:bg-[#F0F5F0]"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${urgent && hasCount ? "text-red-600" : "text-[#4b5563]"}`} />
        <span className={`text-xs truncate ${urgent && hasCount ? "text-red-600 font-medium" : "text-[#4b5563]"}`}>
          {label}
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span
          className={`text-sm font-bold tabular-nums ${
            urgent && hasCount ? "text-red-600" : hasCount ? "text-[#111827]" : "text-[#4b5563]"
          }`}
        >
          {count}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-[#4b5563] group-hover:text-[#111827] transition-colors" />
      </div>
    </button>
  );
}
