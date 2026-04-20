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
import { useTodayVisits, type TodayVisit } from "../hooks/useTodayVisits";
import { useTechShift } from "../hooks/useTechShift";
import { useElapsedTimer } from "../hooks/useElapsedTimer";
import {
  STATUS_LABELS, STATUS_COLORS, DEFAULT_STATUS_COLOR,
} from "../utils/visitDisplay";
import {
  CalendarDays, ChevronRight, Clock, Truck,
  LogIn, LogOut, Navigation, Phone,
  Loader2, RefreshCw, Plus, Briefcase, UserPlus, FileText, X, CheckSquare,
} from "lucide-react";
import { useLocation } from "wouter";
import { useTechTasks } from "../hooks/useTechTasks";
import { toEpochMsSafe, toLocalDateKey } from "../utils/safeDateTime";
import { toTelHref, toMapsHref } from "../utils/externalLinks";
import type { Task } from "@shared/schema";

// Display maps imported from shared utils/visitDisplay.ts

// ── Job card ──

function JobCard({ visit, isNext, urgencyText, onTap, nodeRef }: {
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
        {/* Primary body button — the explicit clickable region that opens
            the visit detail. Now a sibling of the action anchors instead of
            their parent, so there is no nested interactive content. */}
        <button
          type="button"
          onClick={onTap}
          aria-label={`Open ${visit.jobTitle}`}
          className="flex-1 min-w-0 text-left bg-transparent"
        >
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
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* One-tap call — sibling of the body button (no interactive
              nesting). `tel:` hands off to the native dialer. */}
          {telHref && (
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
          {mapsHref && (
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
          <ChevronRight className="h-4 w-4 text-slate-300" />
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

function EmptyState({ dateLabel, onCheckTomorrow }: { dateLabel?: string; onCheckTomorrow?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <CalendarDays className="h-10 w-10 mb-2 opacity-40" />
      <p className="text-sm font-medium">No jobs scheduled{dateLabel ? ` for ${dateLabel}` : ""}</p>
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

  // Date navigation state
  const [selectedDate, setSelectedDate] = useState(new Date());
  const isSelectedToday = toDateStr(selectedDate) === toDateStr(new Date());
  const dateParam = isSelectedToday ? undefined : toDateStr(selectedDate);

  const goToPrevDay = useCallback(() => setSelectedDate(d => { const n = new Date(d); n.setDate(n.getDate() - 1); return n; }), []);
  const goToNextDay = useCallback(() => setSelectedDate(d => { const n = new Date(d); n.setDate(n.getDate() + 1); return n; }), []);
  const goToToday = useCallback(() => setSelectedDate(new Date()), []);

  const { visits, isLoading, isError, refetch } = useTodayVisits(dateParam);
  const { tasks, runningTaskId } = useTechTasks();
  // Task actions (start/stop/complete) live on TaskDetailPage — no inline state needed
  const { isClockedIn, clockInAt, clockIn, clockOut } = useTechShift();
  const { formatted: elapsed } = useElapsedTimer(clockInAt, isClockedIn, 10_000);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [shiftSuccess, setShiftSuccess] = useState<string | null>(null);
  const [showCreateMenu, setShowCreateMenu] = useState(false);

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

  // Day summary counts — drive the one-line header above the timeline.
  const summaryCounts = useMemo(() => {
    let inProgress = 0;
    let done = 0;
    for (const v of visits) {
      if (ACTIVE_VISIT_STATUSES.includes(v.status)) inProgress++;
      else if (TERMINAL_STATUSES.includes(v.status)) done++;
    }
    return { total: visits.length, inProgress, done };
  }, [visits]);

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
  const renderTimelineItem = (item: typeof timelineItems[number]) => {
    if (item.kind === "visit") {
      const isNext = item.visit.id === nextVisitId;
      return (
        <JobCard
          key={item.visit.id}
          visit={item.visit}
          isNext={isNext}
          urgencyText={isNext ? urgencyText : null}
          onTap={() => onVisitTap(item.visit.id)}
          nodeRef={isNext ? (el => { nextVisitRef.current = el; }) : undefined}
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

  const showNowDivider = isSelectedToday && pastNonTerminal.length > 0 && futureNonTerminal.length > 0;
  const hasAnyTimeline = pastNonTerminal.length > 0 || futureNonTerminal.length > 0 || terminalItems.length > 0;

  return (
    <MobileShell showNav>
      {/* Sticky header cluster — DaySelector + clock strip + shift feedback
          all stay pinned to the top of the MobileShell scroll container so
          day-jump and clock-out remain one tap away regardless of scroll
          position. `z-10` keeps timeline rows from painting over the
          header; background is opaque per strip to prevent bleed-through. */}
      <div className="sticky top-0 z-10 bg-slate-50">
        <DaySelector selectedDate={selectedDate} onSelect={setSelectedDate} onPrev={goToPrevDay} onNext={goToNextDay} onToday={goToToday} />

        {/* 2026-04-09: Clock In / Clock Out parity — same placement, padding,
            font weight, and visual hierarchy. The only differences are the
            state label, the indicator color, and the button color. */}

        {/* Clock-in banner (not clocked in) */}
        {!isClockedIn && (
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
        {isClockedIn && (
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
        {shiftSuccess && (
          <div className="px-3 py-1.5 bg-emerald-50 border-b border-emerald-100 flex items-center gap-1.5">
            <LogIn className="h-3 w-3 text-emerald-600" />
            <p className="text-xs font-medium text-emerald-700">{shiftSuccess}</p>
          </div>
        )}

        {/* Shift error */}
        {shiftError && (
          <div className="px-3 py-1.5 bg-red-50 border-b border-red-100">
            <p className="text-xs text-red-600">{shiftError}</p>
            <button onClick={() => setShiftError(null)} className="text-xs text-red-500 underline">Dismiss</button>
          </div>
        )}
      </div>

      {/* One-line day summary — visible as soon as the timeline is ready.
          Kept outside the sticky block so it scrolls with content and
          doesn't steal permanent header real estate. */}
      {!isLoading && !isError && hasAnyTimeline && (
        <div className="px-3 pt-2.5 pb-0.5 flex items-center gap-2 text-xs text-slate-500">
          <span><span className="font-semibold text-slate-700">{summaryCounts.total}</span> visit{summaryCounts.total === 1 ? "" : "s"}</span>
          {summaryCounts.inProgress > 0 && (
            <>
              <span className="text-slate-300">·</span>
              <span><span className="font-semibold text-[#22c55e]">{summaryCounts.inProgress}</span> in progress</span>
            </>
          )}
          {summaryCounts.done > 0 && (
            <>
              <span className="text-slate-300">·</span>
              <span><span className="font-semibold text-slate-600">{summaryCounts.done}</span> done</span>
            </>
          )}
        </div>
      )}

      {/* ── Day timeline: visits + scheduled-today tasks, sorted by time ── */}
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : !hasAnyTimeline && sectionTasks.length === 0 ? (
        <EmptyState
          dateLabel={isSelectedToday ? undefined : selectedDate.toLocaleDateString([], { month: "short", day: "numeric" })}
          onCheckTomorrow={isSelectedToday ? goToNextDay : undefined}
        />
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

      {/* ── Tasks section: overdue + unscheduled (NOT in timeline) ── */}
      {sectionTasks.length > 0 && (
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
    </MobileShell>
  );
}
