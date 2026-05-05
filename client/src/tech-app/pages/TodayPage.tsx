/**
 * Technician PWA — Today schedule screen.
 *
 * Phase 1 (2026-04-04): Wired to real backend via GET /api/tech/visits/today.
 *   - Removed mock visit data (INITIAL_VISITS, TEAM_VISITS, MOCK_TECHNICIANS)
 *   - Removed Team View (no real multi-tech endpoint for technician role)
 *   - Added loading, empty, and error states
 *   - Clock-in/out remains local-only (deferred to Phase 2 — tightly coupled
 *     to visit action flow, wiring it here without visit status mutations
 *     would create partial state that's hard to reconcile)
 *   - FAB retained with static permission mock (future: derive from user role)
 *   - Visit card tap navigates to /tech/visit/:id (detail stays mock until Phase 2)
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { MobileShell } from "../components/MobileShell";
import { DaySelector, toDateStr } from "../components/DaySelector";
import { useTodayVisits, type TodayVisit, type TodayScope } from "../hooks/useTodayVisits";
import { useTechShift } from "../hooks/useTechShift";
import { useElapsedTimer } from "../hooks/useElapsedTimer";
import { useEffectivePermissions } from "@/hooks/useEffectivePermissions";
import { ViewingScopePicker } from "../components/ViewingScopePicker";
import { useTechnicianName } from "@/components/TechnicianSelector";
import { useAuth } from "@/lib/auth";
import {
  STATUS_LABELS, STATUS_COLORS, DEFAULT_STATUS_COLOR,
} from "../utils/visitDisplay";
import {
  CalendarDays, ChevronRight, Clock, Truck,
  LogIn, LogOut, Navigation, Phone,
  Loader2, RefreshCw, Plus, Briefcase, UserPlus, FileText, X, CheckSquare,
  Users, User as UserIcon, Bell,
} from "lucide-react";
import { useLocation } from "wouter";
import { useTechTasks } from "../hooks/useTechTasks";
// 2026-04-21 Phase 1 push notifications — subtle CTA on first load.
import { usePushRegistration } from "../hooks/usePushRegistration";
// 2026-04-26 geofence start prompt — opt-in, manual-confirm, prompt-only.
import { useGeofencePrompt } from "../hooks/useGeofencePrompt";
import { GeofenceStartPrompt } from "../components/GeofenceStartPrompt";
import { useQueryClient } from "@tanstack/react-query";
import { toEpochMsSafe, toLocalDateKey } from "../utils/safeDateTime";
import { toTelHref, toMapsHref } from "../utils/externalLinks";
import type { Task } from "@shared/schema";

// Capability key for cross-tech viewing. Matches server permission seeded in
// server/routes/roles.ts (granted to admin + manager by default).
const SCOPE_ALL_VIEW = "schedule.all.view";
const SCOPE_STORAGE_PREFIX = "tech.today.scope.v1:";

// Display maps imported from shared utils/visitDisplay.ts

// ── Card body wrapper — <button> in self-mode, inert <div> in read-only.
// Exists so we don't announce the card as a disabled button to screen readers
// when a manager is viewing another technician's schedule. Same layout classes
// either way to preserve the press-scale feel.
function CardBodyWrapper({ readOnly, onTap, ariaLabel, children }: {
  readOnly: boolean;
  onTap: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  if (readOnly) {
    return (
      <div className="flex-1 min-w-0 text-left bg-transparent" data-testid="visit-card-readonly">
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={ariaLabel}
      className="flex-1 min-w-0 text-left bg-transparent"
    >
      {children}
    </button>
  );
}

// ── Job card ──

function JobCard({ visit, isNext, urgencyText, onTap, nodeRef, readOnly = false, technicianLabel = null }: {
  visit: TodayVisit;
  isNext: boolean;
  /** Optional "in X min" subscript for the NEXT visit only. Computed by
   *  the parent against a 30 s ticker so this component doesn't need its
   *  own clock. Returns null once the scheduled time has passed — the
   *  late-duration readout was removed 2026-04-19. */
  urgencyText?: string | null;
  onTap: () => void;
  /** Callback ref applied to the outer wrapper so the parent can scroll the
   *  NEXT visit into view on initial load without `forwardRef` plumbing. */
  nodeRef?: (el: HTMLDivElement | null) => void;
  /** Manager cross-tech view: cards are non-tappable and action anchors are
   *  hidden (phone/navigate still expose location data but would invite
   *  interaction that isn't relevant to the manager). */
  readOnly?: boolean;
  /** Canonical assigned-tech display name to surface on the card when the
   *  viewer isn't the assignee (manager cross-tech view). Null hides the row. */
  technicianLabel?: string | null;
}) {
  const isTerminal = visit.status === "completed" || visit.status === "on_hold" || visit.status === "cancelled";
  // 2026-04-09: paused counts as active in flight (visit is started, just not currently timing).
  const isActive = visit.status === "en_route" || visit.status === "in_progress" || visit.status === "on_site" || visit.status === "paused";
  // Pre-compute native-handoff targets so the card action buttons can be
  // rendered conditionally and we avoid running string work inline.
  const mapsHref = toMapsHref(visit.address);
  const telHref = toTelHref(visit.phone);
  // NEXT badge is now hosted inline next to the time/company on the LEFT
  // so it competes with nothing on the high-attention edge of the card.
  const showNextBadge = isNext && !isActive && !isTerminal;

  return (
    // Outer wrapper is a non-interactive <div>. Its visual classes — border,
    // background, ring, and `active:scale-[0.98]` — are preserved verbatim.
    // CSS `:active` applies to an element while any descendant is being
    // activated (mouse down / touch), so the whole-card press-scale feedback
    // still fires exactly as before whether the user taps the body button
    // or an action link.
    <div
      ref={nodeRef}
      className={`rounded-md border transition-all active:scale-[0.98] ${
        showNextBadge
          ? "border-[#22c55e] bg-[#22c55e]/5 ring-1 ring-[#22c55e]/20"
          : isActive
            ? "border-blue-400 bg-blue-50 ring-1 ring-blue-300/30"
            : isTerminal
              ? "border-slate-200 bg-slate-50 opacity-60"
              : "border-slate-200 bg-white"
      }`}
    >
      <div className="px-3 py-2.5 flex items-center gap-2">
        {/* Primary body — tappable <button> for assignee, plain <div> in
            manager cross-tech view (read-only operational visibility in v1).
            Using element swap rather than a disabled button so screen readers
            don't announce the card as an inert button to managers. */}
        <CardBodyWrapper readOnly={readOnly} onTap={onTap} ariaLabel={`Open ${visit.jobTitle}`}>
          {/* 2026-04-19: Information hierarchy rework — Row 1 now leads with
              NEXT + time + job title (what the tech actually acts on);
              Row 2 demotes company + address to subtle secondary context.
              Job title takes the flex remainder with truncate so long call
              descriptions ellipse cleanly without wrapping or pushing the
              status pill off the card. */}
          <div className="flex items-center gap-1.5 min-w-0">
            {showNextBadge && (
              <span className="text-[10px] font-bold text-white bg-[#22c55e] px-1.5 py-0.5 rounded-full tracking-wide shrink-0">NEXT</span>
            )}
            <span className={`text-sm font-semibold shrink-0 ${showNextBadge ? "text-[#22c55e]" : isTerminal ? "text-slate-400" : "text-slate-500"}`}>
              {/* Terminal visits read as "Sched {time} · Done" so the
                  time is unambiguously the scheduled slot, not the actual
                  completion time (which TodayVisit does not carry). */}
              {isTerminal ? `Sched ${visit.scheduledTime} · Done` : visit.scheduledTime}
            </span>
            {/* "in X min" subscript — only for NEXT. Null once past due. */}
            {showNextBadge && urgencyText && (
              <span className="text-xs font-medium text-[#22c55e] shrink-0">{urgencyText}</span>
            )}
            <span className="flex-1 min-w-0 text-sm font-semibold text-slate-700 truncate">{visit.jobTitle}</span>
            {(isActive || isTerminal) && (
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[visit.status] || DEFAULT_STATUS_COLOR}`}>
                {STATUS_LABELS[visit.status] || visit.status}
              </span>
            )}
          </div>
          {/* Row 2 — company · address. Single truncating line so the
              ellipsis falls at the end of the combined string instead of
              fighting two flex children for width. */}
          <div className="mt-0.5 text-xs text-slate-500 truncate">
            {visit.company}
            <span className="text-slate-400"> · </span>
            {visit.address}
          </div>
          {/* Assigned-tech badge shown only in manager cross-tech view so the
              self-view layout is unchanged. Lives inside the body so group
              headers remain the primary grouping cue. */}
          {technicianLabel && (
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
              <UserIcon className="h-3 w-3" />
              <span className="truncate">{technicianLabel}</span>
            </div>
          )}
        </CardBodyWrapper>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* In read-only mode we suppress action anchors AND the chevron so
              the card cannot trigger navigation or handoff — matches v1 scope:
              cross-tech view is read-only operational visibility. */}
          {!readOnly && telHref && (
            <a
              href={telHref}
              aria-label={`Call ${visit.company}`}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors"
            >
              <Phone className="h-4 w-4" />
            </a>
          )}
          {/* One-tap navigate — sibling anchor. `https://` maps URL so
              iOS/Android dispatch to the default maps handler. */}
          {!readOnly && mapsHref && (
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Navigate to site"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md hover:bg-[rgba(118,176,84,0.08)] text-slate-400 hover:text-[#76B054] transition-colors"
            >
              <Navigation className="h-4 w-4" />
            </a>
          )}
          {!readOnly && <ChevronRight className="h-4 w-4 text-slate-300" />}
        </div>
      </div>
    </div>
  );
}

// ── Loading state ──

function LoadingState() {
  // Skeleton rows mimic the JobCard footprint so the page doesn't reflow
  // when real data arrives. Three rows is enough to look intentional
  // without dominating the screen on small phones.
  return (
    <div className="p-2.5 space-y-1.5" role="status" aria-live="polite" aria-label="Loading schedule">
      {[0, 1, 2].map(i => (
        <div key={i} className="rounded-md border border-slate-200 bg-white px-3 py-2.5 animate-pulse">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="h-3 w-24 bg-slate-200 rounded" />
              <div className="h-3.5 w-3/4 bg-slate-200 rounded" />
              <div className="h-3 w-1/2 bg-slate-100 rounded" />
            </div>
            <div className="h-8 w-8 bg-slate-100 rounded-md shrink-0" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Error state ──

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <CalendarDays className="h-10 w-10 mb-2 opacity-40" />
      <p className="text-sm font-medium mb-3">Failed to load schedule</p>
      <button
        onClick={onRetry}
        className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-slate-100 text-slate-600 text-xs font-semibold active:bg-slate-200 transition-colors"
      >
        <RefreshCw className="h-3 w-3" />
        Retry
      </button>
    </div>
  );
}

// ── Empty state ──

function EmptyState({ dateLabel, onCheckTomorrow, message }: { dateLabel?: string; onCheckTomorrow?: () => void; message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <CalendarDays className="h-10 w-10 mb-2 opacity-40" />
      <p className="text-sm font-medium text-center px-4">
        {message ?? `No jobs scheduled${dateLabel ? ` for ${dateLabel}` : ""}`}
      </p>
      {onCheckTomorrow && (
        <button
          onClick={onCheckTomorrow}
          className="mt-3 min-h-[44px] px-4 rounded-md bg-slate-100 text-slate-600 text-xs font-semibold flex items-center gap-1.5 active:bg-slate-200"
        >
          Check tomorrow
          <ChevronRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ── Task card ──

function TaskCard({ task, isTimerRunning, onTap }: {
  task: Task;
  /** Whether THIS task has a running timer (from canonical time_entries, NOT task.status) */
  isTimerRunning: boolean;
  onTap: () => void;
}) {
  const isOverdue = task.scheduledStartAt && new Date(task.scheduledStartAt) < new Date();
  const isSupplier = task.type === "SUPPLIER_VISIT";
  const isCompleted = task.status === "completed" || task.status === "cancelled";
  // 2026-04-10 INTEGRITY: Use canonical timer state, not task.status
  const isInProgress = isTimerRunning;

  return (
    <div
      className={`w-full rounded-md border px-3 py-2.5 active:scale-[0.99] transition-transform cursor-pointer ${
        isCompleted ? "border-slate-200 bg-slate-50 opacity-60" :
        isInProgress ? "border-emerald-300 bg-emerald-50/50" : "border-slate-200 bg-white"
      }`}
      onClick={onTap}
    >
      <div className="flex items-start gap-2">
        <div className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${
          isCompleted ? "bg-slate-100" :
          isSupplier ? "bg-amber-50" : isInProgress ? "bg-emerald-100" : "bg-indigo-50"
        }`}>
          {isSupplier
            ? <Truck className={isCompleted ? "text-slate-400" : "text-amber-600"} style={{ width: 14, height: 14 }} />
            : <CheckSquare className={isCompleted ? "text-slate-400" : isInProgress ? "text-emerald-600" : "text-indigo-600"} style={{ width: 14, height: 14 }} />
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-sm font-semibold truncate ${isCompleted ? "text-slate-400 line-through" : "text-slate-700"}`}>{task.title}</span>
            {isCompleted && (
              <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">Done</span>
            )}
            {isInProgress && !isCompleted && (
              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">In Progress</span>
            )}
            {isOverdue && !isInProgress && !isCompleted && (
              <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">Overdue</span>
            )}
            {!task.scheduledStartAt && !isCompleted && (
              <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">Unscheduled</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-400">
            <span>{isSupplier ? "Supplier Visit" : "Task"}</span>
            {task.scheduledStartAt && (
              <>
                <span>·</span>
                <Clock className="h-2.5 w-2.5" />
                <span>{new Date(task.scheduledStartAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
              </>
            )}
          </div>
          {task.notes && <p className="text-xs text-slate-400 mt-0.5 truncate">{task.notes}</p>}
        </div>
        {/* Chevron indicates tap-to-open — actions live on TaskDetailPage */}
        <ChevronRight className="h-4 w-4 text-slate-300 shrink-0 mt-1" />
      </div>
    </div>
  );
}

// ── Main page ──

export function TodayPage({ onVisitTap }: { onVisitTap: (id: string) => void }) {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { data: effectivePermissions } = useEffectivePermissions();
  const canViewOthers = (effectivePermissions?.permissions ?? []).includes(SCOPE_ALL_VIEW);
  const resolveTechName = useTechnicianName();

  // Date navigation state
  const [selectedDate, setSelectedDate] = useState(new Date());
  const isSelectedToday = toDateStr(selectedDate) === toDateStr(new Date());
  const dateParam = isSelectedToday ? undefined : toDateStr(selectedDate);

  const goToPrevDay = useCallback(() => setSelectedDate(d => { const n = new Date(d); n.setDate(n.getDate() - 1); return n; }), []);
  const goToNextDay = useCallback(() => setSelectedDate(d => { const n = new Date(d); n.setDate(n.getDate() + 1); return n; }), []);
  const goToToday = useCallback(() => setSelectedDate(new Date()), []);

  // ── Viewing scope (manager/admin cross-tech visibility) ──
  // Default = self. Persist last chosen scope per-user in localStorage so
  // the picker doesn't reset on every navigation. Server re-validates every
  // request, so tampering with localStorage cannot elevate access.
  const scopeStorageKey = user ? `${SCOPE_STORAGE_PREFIX}${user.id}` : null;
  const [scope, setScope] = useState<TodayScope>({ kind: "self" });
  const [scopePickerOpen, setScopePickerOpen] = useState(false);

  // Hydrate persisted scope on mount (once we know the user id). If the user
  // loses the capability (role change) the server will 403 the request and
  // we fall back to self for rendering — handled below in the query error path.
  useEffect(() => {
    if (!scopeStorageKey || !canViewOthers) return;
    try {
      const raw = window.localStorage.getItem(scopeStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as TodayScope;
      if (parsed.kind === "self" || parsed.kind === "all") {
        setScope(parsed);
      } else if (parsed.kind === "custom" && Array.isArray(parsed.technicianIds)) {
        setScope({ kind: "custom", technicianIds: parsed.technicianIds.filter((x): x is string => typeof x === "string") });
      }
    } catch {
      // Ignore malformed storage — fall back to self.
    }
  }, [scopeStorageKey, canViewOthers]);

  const applyScope = useCallback((next: TodayScope) => {
    setScope(next);
    if (scopeStorageKey) {
      try { window.localStorage.setItem(scopeStorageKey, JSON.stringify(next)); } catch { /* quota / privacy mode */ }
    }
  }, [scopeStorageKey]);

  // Users without the capability are pinned to self regardless of any stale
  // local storage. Belt-and-braces; server also enforces.
  const effectiveScope: TodayScope = canViewOthers ? scope : { kind: "self" };
  const isSelfScope = effectiveScope.kind === "self";

  const { visits, isLoading, isError, refetch } = useTodayVisits(dateParam, effectiveScope);
  const { tasks, runningTaskId } = useTechTasks();
  // Task actions (start/stop/complete) live on TaskDetailPage — no inline state needed
  const { isClockedIn, clockInAt, clockIn, clockOut } = useTechShift();
  const { formatted: elapsed } = useElapsedTimer(clockInAt, isClockedIn, 10_000);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [shiftSuccess, setShiftSuccess] = useState<string | null>(null);
  const [showCreateMenu, setShowCreateMenu] = useState(false);

  // 2026-04-26 geofence prompt — wired only on the tech-app TodayPage and
  // only when the viewer is looking at their own schedule. Cross-tech
  // (manager) views never see "you're on site"; their device location is
  // unrelated to the assigned tech. The hook fails closed on every error
  // path (config disabled, permission denied, no eligible visit).
  const queryClient = useQueryClient();
  const {
    prompt: geofencePrompt,
    dismissPrompt: dismissGeofencePrompt,
    ackStarted: ackGeofenceStarted,
  } = useGeofencePrompt({
    visits,
    isClockedIn,
    enabled: isSelfScope,
  });

  // ── Split tasks: timeline (scheduled today) vs section (overdue + unscheduled) ──
  // 2026-04-10: Tasks scheduled for the selected day are merged into the day
  // timeline alongside visits, sorted by time. All other tasks (overdue,
  // unscheduled, future) remain in the separate Tasks section below.
  const selectedDayStr = toDateStr(selectedDate);
  const { timelineTasks, sectionTasks } = useMemo(() => {
    const timeline: Task[] = [];
    const section: Task[] = [];
    for (const task of tasks) {
      // Use validated date key — malformed scheduledStartAt → null → section bucket
      const taskDayKey = toLocalDateKey(task.scheduledStartAt);
      if (taskDayKey && taskDayKey === selectedDayStr) {
        timeline.push(task);
      } else {
        section.push(task);
      }
    }
    return { timelineTasks: timeline, sectionTasks: section };
  }, [tasks, selectedDayStr]);

  // ── Unified timeline: visits + scheduled-today tasks, sorted by time ──
  type TimelineItem =
    | { kind: "visit"; visit: TodayVisit }
    | { kind: "task"; task: Task };

  // 2026-04-10: Canonical timeline sort using raw ISO datetimes from both
  // visits (scheduledStartRaw) and tasks (scheduledStartAt). Both are UTC
  // ISO strings → Date.getTime() → absolute ms sort. This produces correct
  // chronological order regardless of timezone because both sources are in
  // the same reference frame (UTC epoch ms). The previous implementation
  // parsed the display-formatted "8:00 AM" string for visits (local time)
  // and used UTC modulo for tasks — a timezone mismatch that caused wrong
  // ordering.
  // 2026-04-10 hardening: all datetime conversions use toEpochMsSafe so
  // malformed/missing ISO strings never inject NaN into the sort. Items
  // with invalid datetimes are excluded from the timeline (they fall to the
  // Tasks section via the day-matching logic above — invalid dates never
  // match selectedDayStr, so they can't reach timelineTasks in the first
  // place). The guard here is defense-in-depth for any future code path
  // that might bypass the day classifier.
  const timelineItems: TimelineItem[] = useMemo(() => {
    const items: (TimelineItem & { sortMs: number; tieBreak: number })[] = [];

    for (const v of visits) {
      const ms = toEpochMsSafe(v.scheduledStartRaw);
      if (ms === null) continue; // invalid visit datetime — skip (should not happen; visits are pre-filtered by server)
      items.push({ kind: "visit", visit: v, sortMs: ms, tieBreak: 0 });
    }

    for (const t of timelineTasks) {
      const ms = toEpochMsSafe(t.scheduledStartAt);
      if (ms === null) continue; // invalid task datetime — skip (defense-in-depth; day classifier already excludes these)
      items.push({ kind: "task", task: t, sortMs: ms, tieBreak: 1 });
    }

    // Primary: chronological (absolute epoch ms). Tie-break: visits first (0), tasks second (1).
    items.sort((a, b) => a.sortMs - b.sortMs || a.tieBreak - b.tieBreak);
    return items;
  }, [visits, timelineTasks]);

  const TERMINAL_STATUSES = ["completed", "on_hold", "cancelled"];
  const ACTIVE_VISIT_STATUSES = ["en_route", "in_progress", "on_site", "paused"];
  const nextVisitId = visits.find(v => !TERMINAL_STATUSES.includes(v.status))?.id;
  // Resume pill target — the first visit the tech is currently in the
  // middle of (en_route / on_site / paused). Independent of nextVisitId
  // because a visit can be active without being "first".
  const activeVisit = visits.find(v => ACTIVE_VISIT_STATUSES.includes(v.status));

  // Minute-accurate clock tick for urgency labels and Now divider
  // placement. 30-second cadence balances "current enough to feel live"
  // against needless re-renders.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // 2026-04-21 Phase 1 push notifications — state only. The CTA below is
  // rendered purely from this state. The hook does NOT auto-prompt; a tap
  // on the CTA is the only trigger.
  const push = usePushRegistration();
  const [pushCtaDismissed, setPushCtaDismissed] = useState(false);

  // Partition the pre-sorted timeline into three render buckets so the
  // page reads as "past-due → Now → upcoming → completed history". Done
  // items stay in chronological order within their own bucket at the
  // bottom instead of cluttering the active flow.
  const { pastNonTerminal, futureNonTerminal, terminalItems } = useMemo(() => {
    const past: typeof timelineItems = [];
    const future: typeof timelineItems = [];
    const term: typeof timelineItems = [];
    for (const item of timelineItems) {
      const isTerm =
        item.kind === "visit"
          ? TERMINAL_STATUSES.includes(item.visit.status)
          : item.task.status === "completed" || item.task.status === "cancelled";
      if (isTerm) {
        term.push(item);
        continue;
      }
      const itemMs = item.kind === "visit"
        ? toEpochMsSafe(item.visit.scheduledStartRaw)
        : toEpochMsSafe(item.task.scheduledStartAt);
      if (itemMs !== null && itemMs <= nowTick) past.push(item);
      else future.push(item);
    }
    return { pastNonTerminal: past, futureNonTerminal: future, terminalItems: term };
  }, [timelineItems, nowTick]);

  // 2026-04-19: Lateness subscript removed from visit card time row per
  // product request — only forward-looking urgency ("now" / "in X min")
  // is rendered now. Past-scheduled visits return null so the render
  // guard in JobCard drops the subscript entirely.
  const urgencyText: string | null = useMemo(() => {
    if (!nextVisitId) return null;
    const nextVisit = visits.find(v => v.id === nextVisitId);
    if (!nextVisit) return null;
    const ms = toEpochMsSafe(nextVisit.scheduledStartRaw);
    if (ms === null) return null;
    const diffMin = Math.round((ms - nowTick) / 60_000);
    if (diffMin === 0) return "now";
    if (diffMin < 0) return null;
    if (diffMin < 60) return `in ${diffMin} min`;
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return m === 0 ? `in ${h} h` : `in ${h} h ${m} min`;
  }, [nextVisitId, visits, nowTick]);

  // Auto-scroll the NEXT visit into view on first arrival to the page (or
  // when the user changes day). A ref guard prevents re-scrolling on
  // every unrelated re-render (e.g., nowTick) so the tech can scroll
  // freely once they're on the page.
  const nextVisitRef = useRef<HTMLDivElement | null>(null);
  const hasAutoScrolledRef = useRef(false);
  useEffect(() => { hasAutoScrolledRef.current = false; }, [selectedDayStr]);
  useEffect(() => {
    if (hasAutoScrolledRef.current || !nextVisitId) return;
    const el = nextVisitRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "auto", block: "center" });
    hasAutoScrolledRef.current = true;
  }, [nextVisitId, pastNonTerminal, futureNonTerminal]);

  const handleClockIn = async () => {
    setShiftError(null);
    try { await clockIn.mutateAsync(); setShiftSuccess("Clocked in"); setTimeout(() => setShiftSuccess(null), 3000); } catch (err: any) { setShiftError(err?.message || "Failed to clock in"); }
  };

  const handleClockOut = async () => {
    setShiftError(null);
    try { await clockOut.mutateAsync(); setShiftSuccess("Clocked out"); setTimeout(() => setShiftSuccess(null), 3000); } catch (err: any) { setShiftError(err?.message || "Failed to clock out"); }
  };

  const shiftPending = clockIn.isPending || clockOut.isPending;

  // Render helper for a single timeline row so we can reuse it across the
  // past / future / terminal buckets without duplicating the conditional
  // visit-vs-task logic.
  // Non-self scope (manager view): cards are read-only, assigned-tech name
  // surfaces on the card, and NEXT/scrollIntoView suppression avoids scrolling
  // to someone else's next visit on the manager's device.
  const renderTimelineItem = (item: typeof timelineItems[number]) => {
    if (item.kind === "visit") {
      const isNext = isSelfScope && item.visit.id === nextVisitId;
      const assignedIds = item.visit.assignedTechnicianIds;
      const label = !isSelfScope && assignedIds.length > 0
        ? (assignedIds.length === 1
            ? resolveTechName(assignedIds[0])
            : `${resolveTechName(assignedIds[0])} +${assignedIds.length - 1}`)
        : null;
      return (
        <JobCard
          key={item.visit.id}
          visit={item.visit}
          isNext={isNext}
          urgencyText={isNext ? urgencyText : null}
          onTap={() => onVisitTap(item.visit.id)}
          nodeRef={isNext ? (el => { nextVisitRef.current = el; }) : undefined}
          readOnly={!isSelfScope}
          technicianLabel={label}
        />
      );
    }
    return (
      <TaskCard
        key={item.task.id}
        task={item.task}
        isTimerRunning={runningTaskId === item.task.id}
        onTap={() => setLocation(`/tech/tasks/${item.task.id}`)}
      />
    );
  };

  const showNowDivider = isSelfScope && isSelectedToday && pastNonTerminal.length > 0 && futureNonTerminal.length > 0;
  const hasAnyTimeline = pastNonTerminal.length > 0 || futureNonTerminal.length > 0 || terminalItems.length > 0;
  // In non-self mode, tasks are hidden — so "has content" must be measured
  // by visit count alone. Without this, a manager with their own unrelated
  // tasks would bypass the role-aware empty state and render a blank grouped
  // view below.
  const hasAnyVisits = visits.length > 0;

  // ── Group timeline items by technician (manager cross-tech mode only) ──
  // In non-self mode the list is re-rendered as a sequence of grouped
  // sections: per-tech header + that tech's visits in chronological order.
  // Unassigned visits are grouped under a sentinel key so they stay visible.
  // Tasks are excluded (self-only in v1) — server also scopes tasks to self.
  const UNASSIGNED_KEY = "__unassigned__";
  const groupedByTech = useMemo(() => {
    if (isSelfScope) return null;
    const groups = new Map<string, TodayVisit[]>();
    for (const item of timelineItems) {
      if (item.kind !== "visit") continue;
      const ids = item.visit.assignedTechnicianIds;
      if (ids.length === 0) {
        if (!groups.has(UNASSIGNED_KEY)) groups.set(UNASSIGNED_KEY, []);
        groups.get(UNASSIGNED_KEY)!.push(item.visit);
        continue;
      }
      // A visit can be assigned to multiple techs — show it under each group.
      // This is correct mirroring of crew semantics: the visit is on both
      // techs' schedules for the day.
      for (const techId of ids) {
        if (!groups.has(techId)) groups.set(techId, []);
        groups.get(techId)!.push(item.visit);
      }
    }
    // Sort group entries by display name for stable rendering; keep
    // Unassigned at the bottom.
    const entries = Array.from(groups.entries());
    entries.sort((a, b) => {
      if (a[0] === UNASSIGNED_KEY) return 1;
      if (b[0] === UNASSIGNED_KEY) return -1;
      return resolveTechName(a[0]).localeCompare(resolveTechName(b[0]));
    });
    return entries;
  }, [isSelfScope, timelineItems, resolveTechName]);

  // Label for the Viewing chip trigger — communicates current scope at a glance.
  const scopeTriggerLabel = useMemo(() => {
    if (effectiveScope.kind === "self") return "Me";
    if (effectiveScope.kind === "all") return "All technicians";
    const n = effectiveScope.technicianIds.length;
    if (n === 0) return "Select technicians";
    if (n === 1) return resolveTechName(effectiveScope.technicianIds[0]);
    return `${resolveTechName(effectiveScope.technicianIds[0])} +${n - 1}`;
  }, [effectiveScope, resolveTechName]);

  return (
    <MobileShell showNav>
      {/* Sticky header cluster — DaySelector + clock strip + shift feedback
          all stay pinned to the top of the MobileShell scroll container so
          day-jump and clock-out remain one tap away regardless of scroll
          position. `z-10` keeps timeline rows from painting over the
          header; background is opaque per strip to prevent bleed-through. */}
      <div className="sticky top-0 z-10 bg-slate-50">
        <DaySelector selectedDate={selectedDate} onSelect={setSelectedDate} onPrev={goToPrevDay} onNext={goToNextDay} onToday={goToToday} />

        {/* Viewing-scope chip — only for users with schedule.all.view.
            Sits directly under DaySelector so it reads as a scope modifier
            on the day strip. Self-mode users never see this row. */}
        {canViewOthers && (
          <div className="bg-white px-3 py-2 flex items-center gap-2 border-b border-slate-200">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Viewing</span>
            <button
              type="button"
              onClick={() => setScopePickerOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 active:bg-slate-100 min-h-[32px]"
              data-testid="button-open-scope-picker"
            >
              {effectiveScope.kind === "all" ? (
                <Users className="h-3.5 w-3.5 text-slate-500" />
              ) : (
                <UserIcon className="h-3.5 w-3.5 text-slate-500" />
              )}
              <span className="max-w-[180px] truncate">{scopeTriggerLabel}</span>
              <ChevronRight className="h-3 w-3 text-slate-400" />
            </button>
          </div>
        )}

        {/* 2026-04-09: Clock In / Clock Out parity — same placement, padding,
            font weight, and visual hierarchy. The only differences are the
            state label, the indicator color, and the button color.
            2026-04-20: Hidden in manager cross-tech view — the banner
            controls the viewer's OWN shift, not the person they're looking at. */}

        {/* Clock-in banner (not clocked in) */}
        {isSelfScope && !isClockedIn && (
          <div className="bg-slate-100 px-3 py-2.5 flex items-center justify-between border-b border-slate-200">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-slate-400" />
              <span className="text-sm font-medium text-slate-600">Not Clocked In</span>
            </div>
            <button
              onClick={handleClockIn}
              disabled={shiftPending}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-[#22c55e] text-white text-sm font-bold active:scale-95 transition-transform disabled:opacity-60"
              data-testid="button-clock-in"
            >
              <LogIn className="h-3 w-3" />
              {clockIn.isPending ? "Clocking in…" : "Clock In"}
            </button>
          </div>
        )}

        {/* Active shift strip (clocked in) — Clock Out is now a real primary
            button with the same weight as Clock In. When the tech has a
            visit currently in progress, a Resume pill appears on a second
            row linking back to that visit detail. */}
        {isSelfScope && isClockedIn && (
          <div className="bg-[#22c55e]/5 border-b border-emerald-100">
            <div className="px-3 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-[#22c55e] animate-pulse" />
                <span className="text-sm font-medium text-[#22c55e]">Working</span>
                {elapsed && <span className="text-sm text-slate-500 ml-1 tabular-nums">{elapsed}</span>}
              </div>
              <button
                onClick={handleClockOut}
                disabled={shiftPending}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-rose-600 text-white text-sm font-bold active:scale-95 transition-transform disabled:opacity-60"
                data-testid="button-clock-out"
              >
                <LogOut className="h-3 w-3" />
                {clockOut.isPending ? "Clocking out…" : "Clock Out"}
              </button>
            </div>
            {activeVisit && (
              <button
                onClick={() => onVisitTap(activeVisit.id)}
                aria-label={`Resume ${activeVisit.jobTitle}`}
                className="w-full px-3 py-2 border-t border-emerald-100 flex items-center gap-2 text-left bg-white/60 hover:bg-white active:bg-emerald-50 transition-colors"
                data-testid="button-resume-active-visit"
              >
                <Truck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span className="text-xs font-semibold text-emerald-700 shrink-0">Resume</span>
                <span className="text-xs text-slate-600 truncate flex-1">{activeVisit.jobTitle}</span>
                <ChevronRight className="h-4 w-4 text-emerald-600 shrink-0" />
              </button>
            )}
          </div>
        )}

        {/* Shift success */}
        {isSelfScope && shiftSuccess && (
          <div className="px-3 py-1.5 bg-emerald-50 border-b border-emerald-100 flex items-center gap-1.5">
            <LogIn className="h-3 w-3 text-emerald-600" />
            <p className="text-xs font-medium text-emerald-700">{shiftSuccess}</p>
          </div>
        )}

        {/* Shift error */}
        {isSelfScope && shiftError && (
          <div className="px-3 py-1.5 bg-red-50 border-b border-red-100">
            <p className="text-xs text-red-600">{shiftError}</p>
            <button onClick={() => setShiftError(null)} className="text-xs text-red-500 underline">Dismiss</button>
          </div>
        )}
      </div>

      {/* 2026-04-21 Phase 1 push notifications — subtle enable CTA.
          Shows only when:
            - the browser supports push
            - permission hasn't been granted OR denied yet
            - the tech is looking at their own schedule
            - the tech hasn't dismissed the CTA this session
          One tap → permission prompt → subscribe → POST to backend. If
          anything fails, the hook surfaces the error in its own state. */}
      {isSelfScope && push.supported && push.permission === "default" && !pushCtaDismissed && (
        <div
          className="mx-3 mt-2 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm"
          data-testid="push-cta"
        >
          <Bell className="h-4 w-4 text-[#22c55e] shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-slate-800">Enable notifications</div>
            <div className="text-[11px] text-slate-500 truncate">
              Get alerted when a new visit is assigned to you.
            </div>
          </div>
          <button
            type="button"
            onClick={() => { void push.requestAndSubscribe(); }}
            disabled={push.busy}
            className="px-2.5 py-1 rounded-md bg-[#22c55e] text-white text-xs font-semibold disabled:opacity-60"
            data-testid="button-enable-push"
          >
            {push.busy ? "…" : "Enable"}
          </button>
          <button
            type="button"
            onClick={() => setPushCtaDismissed(true)}
            aria-label="Dismiss"
            className="p-1 text-slate-400"
            data-testid="button-dismiss-push-cta"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Day timeline ──
          Self scope: visits + scheduled-today tasks, partitioned past/now/future.
          Non-self scope: visits only, grouped by technician (tasks hidden in v1). */}
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : (isSelfScope
            ? !hasAnyTimeline && sectionTasks.length === 0
            : !hasAnyVisits) ? (
        <EmptyState
          dateLabel={isSelectedToday ? undefined : selectedDate.toLocaleDateString([], { month: "short", day: "numeric" })}
          onCheckTomorrow={isSelfScope && isSelectedToday ? goToNextDay : undefined}
          message={
            isSelfScope
              ? undefined
              : effectiveScope.kind === "all"
                ? "No visits scheduled for any technician"
                : "No visits for selected technicians"
          }
        />
      ) : !isSelfScope && groupedByTech ? (
        // Manager cross-tech view — grouped by technician.
        <div className="p-2.5 space-y-3">
          {groupedByTech.map(([techId, techVisits]) => {
            const displayName = techId === UNASSIGNED_KEY ? "Unassigned" : resolveTechName(techId);
            return (
              <div key={techId} data-testid={`tech-group-${techId}`}>
                <div className="flex items-center gap-2 px-1 py-1.5 sticky top-0 bg-slate-50">
                  <UserIcon className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-xs font-semibold text-slate-600 truncate">{displayName}</span>
                  <span className="text-[11px] text-slate-400">
                    {techVisits.length} visit{techVisits.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {techVisits.map((visit) => {
                    const assignedIds = visit.assignedTechnicianIds;
                    // Only add the per-card tech label when the visit is on
                    // multiple crews — otherwise the group header already says it.
                    const cardLabel = assignedIds.length > 1
                      ? `${resolveTechName(assignedIds[0])} +${assignedIds.length - 1}`
                      : null;
                    return (
                      <JobCard
                        key={`${techId}:${visit.id}`}
                        visit={visit}
                        isNext={false}
                        onTap={() => { /* non-tappable in cross-tech view */ }}
                        readOnly
                        technicianLabel={cardLabel}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {hasAnyTimeline && (
            <div className="p-2.5 space-y-1.5">
              {pastNonTerminal.map(renderTimelineItem)}
              {/* "Now" divider — only rendered on today's view, and only
                  when there are non-terminal items straddling the current
                  time. Keeps it from appearing redundantly when everything
                  is already upcoming or everything is already past. */}
              {showNowDivider && (
                <div className="flex items-center gap-2 py-1" aria-hidden="true">
                  <div className="h-px flex-1 bg-emerald-200" />
                  <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Now</span>
                  <div className="h-px flex-1 bg-emerald-200" />
                </div>
              )}
              {futureNonTerminal.map(renderTimelineItem)}
              {/* Terminal (done / on_hold / cancelled) visits + completed
                  tasks moved to the bottom so the actionable rows stay on
                  top. Chronological order preserved within the bucket. */}
              {terminalItems.map(renderTimelineItem)}
            </div>
          )}
        </>
      )}

      {/* ── Tasks section: overdue + unscheduled (NOT in timeline) ──
          Self-only. In non-self scope v1, tasks visibility is not cross-tech
          (tasks endpoint is scoped to the caller), so we hide the section to
          avoid misrepresenting the manager's own tasks as the viewed tech's. */}
      {isSelfScope && sectionTasks.length > 0 && (
        <div className="px-2.5 pb-2">
          <div className="flex items-center gap-1.5 px-1 py-1.5">
            <CheckSquare className="h-3 w-3 text-slate-400" />
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Tasks ({sectionTasks.length})</span>
          </div>
          <div className="space-y-1.5">
            {sectionTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                isTimerRunning={runningTaskId === task.id}
                onTap={() => setLocation(`/tech/tasks/${task.id}`)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Create FAB — positioned above the 52px bottom nav + iOS safe-area
          inset so the button never clips the home indicator or hides behind
          the nav bar. 12px gap between FAB bottom and nav top. */}
      <button
        onClick={() => setShowCreateMenu(true)}
        aria-label="Create"
        className="fixed right-4 min-h-[44px] min-w-[44px] h-14 w-14 rounded-full bg-emerald-600 text-white shadow-lg flex items-center justify-center active:scale-95 z-30"
        style={{ bottom: "calc(52px + env(safe-area-inset-bottom, 0px) + 12px)" }}
      >
        <Plus className="h-6 w-6" />
      </button>

      {/* Create action chooser */}
      {showCreateMenu && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setShowCreateMenu(false)}>
          <div className="w-full max-w-md bg-white rounded-t-2xl p-4 pb-6 shadow-xl space-y-2" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-bold text-slate-800">Create</h3>
              <button
                onClick={() => setShowCreateMenu(false)}
                aria-label="Close"
                className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-md hover:bg-slate-100 active:bg-slate-200"
              >
                <X className="h-5 w-5 text-slate-400" />
              </button>
            </div>
            <button
              onClick={() => { setShowCreateMenu(false); setLocation("/tech/create-job"); }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-md border border-slate-200 bg-white hover:bg-slate-50 active:bg-slate-100 transition-colors"
            >
              <div className="h-9 w-9 rounded-md bg-emerald-50 flex items-center justify-center shrink-0">
                <Briefcase className="h-4.5 w-4.5 text-emerald-600" style={{ width: 18, height: 18 }} />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-slate-800">Create Job</p>
                <p className="text-xs text-slate-400">New work order with scheduling</p>
              </div>
            </button>
            <button
              onClick={() => { setShowCreateMenu(false); setLocation("/tech/create-lead"); }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-md border border-slate-200 bg-white hover:bg-slate-50 active:bg-slate-100 transition-colors"
            >
              <div className="h-9 w-9 rounded-md bg-amber-50 flex items-center justify-center shrink-0">
                <FileText className="h-4.5 w-4.5 text-amber-600" style={{ width: 18, height: 18 }} />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-slate-800">Create Lead</p>
                <p className="text-xs text-slate-400">Report an opportunity to the office</p>
              </div>
            </button>
            <button
              onClick={() => { setShowCreateMenu(false); setLocation("/tech/create-client"); }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-md border border-slate-200 bg-white hover:bg-slate-50 active:bg-slate-100 transition-colors"
            >
              <div className="h-9 w-9 rounded-md bg-blue-50 flex items-center justify-center shrink-0">
                <UserPlus className="h-4.5 w-4.5 text-blue-600" style={{ width: 18, height: 18 }} />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-slate-800">Create Client</p>
                <p className="text-xs text-slate-400">New client and service location</p>
              </div>
            </button>
            <button
              onClick={() => { setShowCreateMenu(false); setLocation("/tech/create-task"); }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-md border border-slate-200 bg-white hover:bg-slate-50 active:bg-slate-100 transition-colors"
            >
              <div className="h-9 w-9 rounded-md bg-indigo-50 flex items-center justify-center shrink-0">
                <CheckSquare className="h-4.5 w-4.5 text-indigo-600" style={{ width: 18, height: 18 }} />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-slate-800">Create Task</p>
                <p className="text-xs text-slate-400">General task or supplier visit</p>
              </div>
            </button>
          </div>
        </div>
      )}
      {/* Timer conflict dialog lives on TaskDetailPage now */}

      {/* Manager/Admin viewing-scope bottom sheet. Rendered from the Today
          page so the trigger chip is right above, and state reset is coupled
          to the same user id that keys localStorage. */}
      {canViewOthers && (
        <ViewingScopePicker
          open={scopePickerOpen}
          initialScope={effectiveScope}
          onClose={() => setScopePickerOpen(false)}
          onApply={applyScope}
          selfId={user?.id ?? null}
        />
      )}

      {/* 2026-04-26 geofence start prompt. Renders only when the hook signals
          a candidate visit within radius. Tapping "Start visit" forwards to
          the canonical POST /api/tech/visits/:visitId/start path; the
          orchestrator owns the status write and time-entry side effects. We
          refetch today's visits on success so the moved card reflects the new
          status, and invalidate /api/tech/time/summary so the running-timer
          state surfaces in the shift strip. */}
      <GeofenceStartPrompt
        open={!!geofencePrompt}
        visit={geofencePrompt?.visit ?? null}
        distanceMeters={geofencePrompt?.distanceMeters ?? null}
        onStarted={(visitId) => {
          ackGeofenceStarted(visitId);
          refetch();
          queryClient.invalidateQueries({ queryKey: ["/api/tech/time/summary"] });
        }}
        onDismiss={dismissGeofencePrompt}
        onError={(err) => {
          console.error("[geofence] start failed", err);
        }}
      />
    </MobileShell>
  );
}
