/**
 * TodaysOperationsCard — Live operational command center.
 *
 * Full-width card that replaces the Dashboard's legacy four-tile KPI
 * strip. Two compositions in one surface:
 *
 *   LEFT (≈75%) — horizontally scrollable technician workload rail. Per
 *   technician: avatar + name, today's job count + scheduled hours, a
 *   derived status badge (Available / On Job / Heavy Load / Completed /
 *   Unscheduled Gap), a load bar, and up to three upcoming job preview
 *   rows (scheduled time · customer). "+N more" when a tech has more
 *   than three. Clicking a tech card → /dispatch (canonical destination;
 *   no URL tech-filter scheme exists yet, per lib/dashboardNavigation.ts).
 *
 *   RIGHT (≈25%) — operational alerts stack. Four rows, each a
 *   quick-glance mirror of a canonical destination already reachable
 *   from the lower Jobs card:
 *     1. Unscheduled       → DashboardActionModal(scheduling_issues)
 *     2. Past Due          → DashboardActionModal(scheduling_issues)
 *     3. Action Required   → DashboardActionModal(action_required)
 *     4. Ready for Invoice → DashboardActionModal(ready_to_invoice)
 *   Splitting Unscheduled from Past Due (instead of the lower card's
 *   combined "Scheduling Issues" row) is intentional — each row maps to
 *   a distinct operator decision ("assign it" vs "fix the calendar").
 *   Clicking either opens the same modal where both sections are
 *   labelled; the lower Jobs card is the canonical collapsed view.
 *
 *   2026-04-20: Waiting Parts / Emergency Jobs / Open Schedule Gaps were
 *   removed — the first two were not today-scoped and duplicated info
 *   already surfaced per-row inside the Action Required modal; the
 *   third used an arbitrary client-side threshold with weak signal.
 *
 * Data sources (all existing, no new aggregation endpoints):
 *   - GET /api/calendar?start=X&end=Y   — today's visits (shared cache
 *     key with the dispatch board)
 *   - GET /api/team/technicians         — schedulable roster
 *   - GET /api/team/technicians/live-state — canonical activity projection
 *   - GET /api/dashboard/workflow       — Unscheduled / Past Due /
 *     Action Required / Ready for Invoice counts (shared cache with
 *     Dashboard.tsx's own workflow query and with the Jobs card)
 *
 * SSE invalidation: every query key used here is already covered by
 * useDispatchStream's VISIT_JOB_KEYS / TIME_KEYS prefix sets.
 *
 * Derived selectors (local to this file — no shared business logic
 * introduced for a UI-only concern):
 *   - scheduled minutes / visit count per tech from today's visit list
 *   - status badge priority: On Job > Completed > Heavy Load >
 *     Unscheduled Gap > Available
 */

import { useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Briefcase, ChevronRight, Clock, Receipt, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useTechniciansDirectory } from "@/hooks/useTechnicians";
import { useTechnicianLiveStates, type TechnicianLiveState } from "@/hooks/useTechnicians";
import { resolveDashboardNav } from "@/lib/dashboardNavigation";
import type { DashboardActionMode } from "@/components/DashboardActionModal";
import type { CalendarRangeResponseDto, CalendarEventDto } from "@shared/types/scheduling";

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

type TechStatusKind =
  | "on_job"
  | "completed"
  | "heavy_load"
  | "unscheduled_gap"
  | "available";

interface TechPreviewRow {
  visitId: string;
  scheduledStart: string | null;
  customer: string;
}

interface TechCardData {
  id: string;
  name: string;
  initials: string;
  color: string | null;
  visitCount: number;
  scheduledMinutes: number;
  status: TechStatusKind;
  loadPct: number; // 0–100, based on 8h = 480min
  preview: TechPreviewRow[];
  moreCount: number;
}

// ============================================================================
// Helpers
// ============================================================================

const SHIFT_MINUTES = 480; // 8h reference shift for the load bar
const HEAVY_THRESHOLD = 540; // >9h → Heavy Load
const GAP_THRESHOLD = 180; // <3h → Unscheduled Gap (when count > 0)

function getTodayRangeISO(): [string, string] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start.toISOString(), end.toISOString()];
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatClockTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatHours(minutes: number): string {
  if (minutes <= 0) return "0h";
  const h = minutes / 60;
  if (h < 1) return `${minutes}m`;
  if (Number.isInteger(h)) return `${h}h`;
  return `${h.toFixed(1)}h`;
}

const STATUS_LABEL: Record<TechStatusKind, string> = {
  on_job: "On Job",
  completed: "Completed",
  heavy_load: "Heavy Load",
  unscheduled_gap: "Unscheduled Gap",
  available: "Available",
};

const STATUS_BADGE_CLASS: Record<TechStatusKind, string> = {
  on_job: "bg-blue-50 text-blue-700 border-blue-200",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  heavy_load: "bg-amber-50 text-amber-700 border-amber-200",
  unscheduled_gap: "bg-slate-50 text-slate-600 border-slate-200",
  available: "bg-slate-50 text-slate-700 border-slate-200",
};

const STATUS_BAR_CLASS: Record<TechStatusKind, string> = {
  on_job: "bg-blue-500",
  completed: "bg-emerald-500",
  heavy_load: "bg-amber-500",
  unscheduled_gap: "bg-slate-300",
  available: "bg-slate-400",
};

function deriveTechStatus(
  visitCount: number,
  scheduledMinutes: number,
  completedCount: number,
  liveActivity: TechnicianLiveState["activityStatus"] | null,
): TechStatusKind {
  if (liveActivity === "en_route" || liveActivity === "on_site") return "on_job";
  if (visitCount > 0 && completedCount === visitCount) return "completed";
  if (scheduledMinutes > HEAVY_THRESHOLD) return "heavy_load";
  if (visitCount > 0 && scheduledMinutes < GAP_THRESHOLD) return "unscheduled_gap";
  return "available";
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
}

export function TodaysOperationsCard({ onOpenActionModal }: TodaysOperationsCardProps = {}) {
  const [, setLocation] = useLocation();
  const [startISO, endISO] = useMemo(() => getTodayRangeISO(), []);

  // 1. Today's visits — shared cache key with the dispatch board.
  const calendarQuery = useQuery<CalendarRangeResponseDto>({
    queryKey: ["/api/calendar", startISO, endISO],
    queryFn: async () => {
      const res = await fetch(
        `/api/calendar?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to fetch calendar");
      return res.json();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  // 2. Technician roster.
  const { teamMembers, isLoading: techLoading } = useTechniciansDirectory();

  // 3. Live per-tech activity.
  const { states: liveStates } = useTechnicianLiveStates();

  // 4. Workflow counts — shared cache with Dashboard.tsx's own query.
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

  // 2026-04-20: The dedicated on-hold sample fetch (waiting-parts count)
  // and the urgent-jobs fetch (emergency count) were removed along with
  // their right-panel rows. Hold-reason labels (including "Needs Parts")
  // remain visible inside the DashboardActionModal(action_required)
  // drill-down, which is the correct home for that detail.

  // ── Derived: per-tech workload data ────────────────────────────────────
  const techCards: TechCardData[] = useMemo(() => {
    const events: CalendarEventDto[] = calendarQuery.data?.events ?? [];
    const liveByTech = new Map<string, TechnicianLiveState>();
    for (const s of liveStates) liveByTech.set(s.technicianId, s);

    // Bucket today's events per assigned tech id (multi-tech visits count
    // under each crew member, consistent with getDaySummary).
    interface Bucket {
      all: CalendarEventDto[];
      completed: number;
      scheduledMinutes: number;
    }
    const buckets = new Map<string, Bucket>();

    for (const ev of events) {
      const assigned = Array.isArray(ev.assignedTechnicianIds) ? ev.assignedTechnicianIds : [];
      for (const techId of assigned) {
        let b = buckets.get(techId);
        if (!b) {
          b = { all: [], completed: 0, scheduledMinutes: 0 };
          buckets.set(techId, b);
        }
        b.all.push(ev);
        if (ev.visitStatus === "completed") b.completed++;
        const dur = ev.durationMinutes;
        if (typeof dur === "number" && dur > 0) {
          b.scheduledMinutes += dur;
        } else if (ev.startAt && ev.endAt) {
          const diff = (new Date(ev.endAt).getTime() - new Date(ev.startAt).getTime()) / 60_000;
          if (diff > 0) b.scheduledMinutes += Math.round(diff);
        }
      }
    }

    const cards: TechCardData[] = teamMembers.map((m) => {
      const bucket = buckets.get(m.id) ?? { all: [], completed: 0, scheduledMinutes: 0 };
      const sorted = [...bucket.all].sort((a, b) => {
        const ta = a.startAt ? new Date(a.startAt).getTime() : Number.POSITIVE_INFINITY;
        const tb = b.startAt ? new Date(b.startAt).getTime() : Number.POSITIVE_INFINITY;
        return ta - tb;
      });
      const preview: TechPreviewRow[] = sorted.slice(0, 3).map((v) => ({
        visitId: v.visitId ?? v.id,
        scheduledStart: v.startAt,
        customer: v.customerCompanyName ?? v.locationName ?? "Unassigned location",
      }));
      const moreCount = Math.max(0, sorted.length - preview.length);
      const live = liveByTech.get(m.id) ?? null;
      const status = deriveTechStatus(
        bucket.all.length,
        bucket.scheduledMinutes,
        bucket.completed,
        live?.activityStatus ?? null,
      );
      const loadPct = Math.min(100, Math.round((bucket.scheduledMinutes / SHIFT_MINUTES) * 100));

      return {
        id: m.id,
        name: m.fullName || m.email,
        initials: initialsFromName(m.fullName || m.email),
        color: m.color ?? null,
        visitCount: bucket.all.length,
        scheduledMinutes: bucket.scheduledMinutes,
        status,
        loadPct,
        preview,
        moreCount,
      };
    });

    // Sort: on-job first, then heavy-load, then by scheduled minutes desc,
    // then name. Keeps the most operationally relevant techs on the left.
    const statusRank: Record<TechStatusKind, number> = {
      on_job: 0,
      heavy_load: 1,
      available: 2,
      unscheduled_gap: 3,
      completed: 4,
    };
    cards.sort((a, b) => {
      const r = statusRank[a.status] - statusRank[b.status];
      if (r !== 0) return r;
      if (b.scheduledMinutes !== a.scheduledMinutes) return b.scheduledMinutes - a.scheduledMinutes;
      return a.name.localeCompare(b.name);
    });

    return cards;
  }, [calendarQuery.data, teamMembers, liveStates]);

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

  // ── Render ─────────────────────────────────────────────────────────────
  const isLoading = calendarQuery.isLoading || techLoading || workflowQuery.isLoading;

  return (
    <div
      className="bg-white rounded-md border border-[#e2e8f0] overflow-hidden"
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-0">
        {/* LEFT — Technician workload rail (75%) */}
        <div className="lg:col-span-3 p-4 border-b lg:border-b-0 lg:border-r border-[#e2e8f0]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Users className="h-3.5 w-3.5 text-[#4b5563]" />
              <h4 className="text-sm font-semibold text-[#111827]">Technician workload</h4>
            </div>
            <span className="text-xs text-[#4b5563] tabular-nums">
              {techCards.length} {techCards.length === 1 ? "technician" : "technicians"}
            </span>
          </div>

          {isLoading ? (
            <div className="flex gap-3 overflow-hidden">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-[188px] w-[260px] shrink-0 rounded-md" />
              ))}
            </div>
          ) : techCards.length === 0 ? (
            <div className="text-sm text-[#4b5563] italic py-6">No schedulable technicians.</div>
          ) : (
            <div
              className="flex gap-3 overflow-x-auto pb-1"
              style={{
                scrollbarWidth: "thin",
                scrollbarColor: "#cbd5e1 transparent",
              }}
            >
              {techCards.map((t) => (
                <TechnicianWorkloadTile
                  key={t.id}
                  card={t}
                  onClick={() => setLocation(resolveDashboardNav("ops.activeJobs"))}
                />
              ))}
            </div>
          )}
        </div>

        {/* RIGHT — Operational alerts stack (25%) */}
        <div className="lg:col-span-1 p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-3.5 w-3.5 text-[#4b5563]" />
            <h4 className="text-sm font-semibold text-[#111827]">Operational alerts</h4>
          </div>
          <div className="space-y-1">
            {/* Each row mirrors a canonical Jobs-card destination — the
                `handleAlertClick` helper opens the same DashboardActionModal
                the Jobs card opens (when the parent supplied a handler),
                so this panel is a quick-glance jump into the same modal
                rather than a parallel info surface. */}
            <AlertRow
              icon={Briefcase}
              label="Unscheduled"
              count={unscheduledCount}
              onClick={() =>
                handleAlertClick("scheduling_issues", resolveDashboardNav("jobs.unscheduled"))
              }
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
              icon={AlertTriangle}
              label="Action Required"
              count={actionRequiredCount}
              onClick={() =>
                handleAlertClick("action_required", resolveDashboardNav("ops.onHold"))
              }
              urgent={actionRequiredCount > 0}
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
      </div>
    </div>
  );
}

// ============================================================================
// Technician workload tile
// ============================================================================

function TechnicianWorkloadTile({ card, onClick }: { card: TechCardData; onClick: () => void }) {
  const loadColor = STATUS_BAR_CLASS[card.status];
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 w-[260px] text-left rounded-md border border-[#e2e8f0] bg-white px-3 py-3 hover:bg-[#F0F5F0] transition-colors focus:outline-none focus:ring-2 focus:ring-[#76B054]/40"
    >
      <div className="flex items-center gap-2.5 mb-1.5">
        <span
          className="h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
          style={{ backgroundColor: card.color || "#64748b" }}
          aria-hidden="true"
        >
          {card.initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#111827] truncate">{card.name}</p>
          <p className="text-[11px] text-[#4b5563] tabular-nums">
            {card.visitCount} {card.visitCount === 1 ? "job" : "jobs"} · ~{formatHours(card.scheduledMinutes)}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${STATUS_BADGE_CLASS[card.status]}`}
        >
          {STATUS_LABEL[card.status]}
        </span>
        <span className="text-[10px] text-[#4b5563] tabular-nums">{card.loadPct}%</span>
      </div>

      <div className="h-1.5 w-full rounded-full bg-[#f1f5f9] overflow-hidden mb-2">
        <div
          className={`h-full ${loadColor} transition-all`}
          style={{ width: `${card.loadPct}%` }}
        />
      </div>

      <div className="space-y-0.5">
        {card.preview.length === 0 ? (
          <p className="text-[11px] text-[#94a3b8] italic">No scheduled jobs today</p>
        ) : (
          card.preview.map((row) => (
            <div key={row.visitId} className="flex items-center gap-1 text-[11px]">
              <span className="text-[#4b5563] tabular-nums shrink-0">
                {formatClockTime(row.scheduledStart)}
              </span>
              <span className="text-[#94a3b8]">·</span>
              <span className="text-[#111827] truncate">{row.customer}</span>
            </div>
          ))
        )}
        {card.moreCount > 0 && (
          <p className="text-[11px] text-[#4b5563] font-medium">+{card.moreCount} more</p>
        )}
      </div>
    </button>
  );
}

// ============================================================================
// Alert row
// ============================================================================

function AlertRow({
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
      className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-left transition-colors group ${
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
