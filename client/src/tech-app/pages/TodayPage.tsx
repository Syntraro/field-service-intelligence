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

import { useState, useCallback, useMemo } from "react";
import { MobileShell } from "../components/MobileShell";
import { DaySelector, toDateStr } from "../components/DaySelector";
import { useTodayVisits, type TodayVisit } from "../hooks/useTodayVisits";
import { useTechShift } from "../hooks/useTechShift";
import { useElapsedTimer } from "../hooks/useElapsedTimer";
import {
  STATUS_LABELS, STATUS_COLORS, DEFAULT_STATUS_COLOR,
} from "../utils/visitDisplay";
import {
  CalendarDays, MapPin, ChevronRight, Clock, Truck,
  LogIn, LogOut, Navigation,
  Loader2, RefreshCw, Plus, Briefcase, UserPlus, FileText, X, CheckSquare, Check,
} from "lucide-react";
import { useLocation } from "wouter";
import { useTechTasks } from "../hooks/useTechTasks";
import { toEpochMsSafe, toLocalDateKey } from "../utils/safeDateTime";
import { ActiveTimerConflictDialog, parseTimerConflict, type ActiveTimerInfo } from "../components/ActiveTimerConflictDialog";
import type { Task } from "@shared/schema";

// Display maps imported from shared utils/visitDisplay.ts

// ── Job card ──

function JobCard({ visit, isNext, onTap }: { visit: TodayVisit; isNext: boolean; onTap: () => void }) {
  const isTerminal = visit.status === "completed" || visit.status === "on_hold" || visit.status === "cancelled";
  // 2026-04-09: paused counts as active in flight (visit is started, just not currently timing).
  const isActive = visit.status === "en_route" || visit.status === "in_progress" || visit.status === "on_site" || visit.status === "paused";

  return (
    <button
      onClick={onTap}
      className={`w-full text-left rounded-md border transition-all active:scale-[0.98] ${
        isNext && !isActive && !isTerminal
          ? "border-[#22c55e] bg-[#22c55e]/5 ring-1 ring-[#22c55e]/20"
          : isActive
            ? "border-blue-400 bg-blue-50 ring-1 ring-blue-300/30"
            : isTerminal
              ? "border-slate-200 bg-slate-50 opacity-60"
              : "border-slate-200 bg-white"
      }`}
    >
      <div className="px-3 py-2.5 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-sm font-semibold ${isNext && !isActive ? "text-[#22c55e]" : "text-slate-500"}`}>
              {visit.scheduledTime}
            </span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-sm text-slate-500 truncate">{visit.company}</span>
            {(isActive || isTerminal) && (
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${STATUS_COLORS[visit.status] || DEFAULT_STATUS_COLOR}`}>
                {STATUS_LABELS[visit.status] || visit.status}
              </span>
            )}
          </div>
          <div className="text-sm font-semibold text-slate-700 truncate mt-0.5">{visit.jobTitle}</div>
          <div className="flex items-center gap-1 mt-0.5">
            <MapPin className="h-2.5 w-2.5 text-slate-400 shrink-0" />
            <span className="text-xs text-slate-400 truncate">{visit.address}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={e => { e.stopPropagation(); }}
            className="p-1.5 rounded-md hover:bg-[rgba(118,176,84,0.08)] text-slate-400 hover:text-[#76B054] transition-colors"
          >
            <Navigation className="h-3.5 w-3.5" />
          </button>
          {isNext && !isActive && !isTerminal && (
            <span className="text-xs font-bold text-[#22c55e] bg-[#22c55e]/10 px-2 py-0.5 rounded-full">NEXT</span>
          )}
          <ChevronRight className="h-4 w-4 text-slate-300" />
        </div>
      </div>
    </button>
  );
}

// ── Loading state ──

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
      <Loader2 className="h-8 w-8 animate-spin mb-3 opacity-50" />
      <p className="text-sm font-medium">Loading today's schedule…</p>
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

function EmptyState({ dateLabel }: { dateLabel?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <CalendarDays className="h-10 w-10 mb-2 opacity-40" />
      <p className="text-sm font-medium">No jobs scheduled{dateLabel ? ` for ${dateLabel}` : ""}</p>
    </div>
  );
}

// ── Task card ──

function TaskCard({ task, onComplete, isCompleting, onStart, onStop, isTimerPending, isTimerRunning, onTap }: {
  task: Task;
  onComplete: () => void;
  isCompleting: boolean;
  onStart: () => void;
  onStop: () => void;
  isTimerPending: boolean;
  /** Whether THIS task has a running timer (from canonical time_entries, NOT task.status) */
  isTimerRunning: boolean;
  onTap: () => void;
}) {
  const isOverdue = task.scheduledStartAt && new Date(task.scheduledStartAt) < new Date();
  const isSupplier = task.type === "SUPPLIER_VISIT";
  // 2026-04-10 INTEGRITY: Use canonical timer state, not task.status
  const isInProgress = isTimerRunning;

  return (
    <div
      className={`w-full rounded-md border px-3 py-2.5 active:scale-[0.99] transition-transform cursor-pointer ${
        isInProgress ? "border-emerald-300 bg-emerald-50/50" : "border-slate-200 bg-white"
      }`}
      onClick={onTap}
    >
      <div className="flex items-start gap-2">
        <div className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${
          isSupplier ? "bg-amber-50" : isInProgress ? "bg-emerald-100" : "bg-indigo-50"
        }`}>
          {isSupplier
            ? <Truck className="text-amber-600" style={{ width: 14, height: 14 }} />
            : <CheckSquare className={isInProgress ? "text-emerald-600" : "text-indigo-600"} style={{ width: 14, height: 14 }} />
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-slate-700 truncate">{task.title}</span>
            {isInProgress && (
              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">In Progress</span>
            )}
            {isOverdue && !isInProgress && (
              <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">Overdue</span>
            )}
            {!task.scheduledStartAt && (
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
        <div className="flex items-center gap-1 shrink-0">
          {/* Timer start/stop — canonical through time_entries */}
          {isInProgress ? (
            <button
              onClick={(e) => { e.stopPropagation(); onStop(); }}
              disabled={isTimerPending}
              className="h-8 px-2.5 rounded-md border border-amber-300 bg-amber-50 text-amber-700 text-xs font-semibold flex items-center gap-1 active:scale-95 disabled:opacity-60"
            >
              {isTimerPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clock className="h-3 w-3" />}
              Stop
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onStart(); }}
              disabled={isTimerPending}
              className="h-8 px-2.5 rounded-md border border-blue-300 bg-blue-50 text-blue-700 text-xs font-semibold flex items-center gap-1 active:scale-95 disabled:opacity-60"
            >
              {isTimerPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Navigation className="h-3 w-3" />}
              Start
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onComplete(); }}
            disabled={isCompleting}
            className="h-8 px-2.5 rounded-md border border-emerald-300 bg-emerald-50 text-emerald-700 text-xs font-semibold flex items-center gap-1 active:scale-95 disabled:opacity-60"
          >
            {isCompleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Done
          </button>
        </div>
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
  const { tasks, runningTaskId, startTask, stopTask, closeTask } = useTechTasks();
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [timerTaskId, setTimerTaskId] = useState<string | null>(null);
  const [timerConflict, setTimerConflict] = useState<ActiveTimerInfo | null>(null);
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
  const nextVisitId = visits.find(v => !TERMINAL_STATUSES.includes(v.status))?.id;

  const handleClockIn = async () => {
    setShiftError(null);
    try { await clockIn.mutateAsync(); setShiftSuccess("Clocked in"); setTimeout(() => setShiftSuccess(null), 3000); } catch (err: any) { setShiftError(err?.message || "Failed to clock in"); }
  };

  const handleClockOut = async () => {
    setShiftError(null);
    try { await clockOut.mutateAsync(); setShiftSuccess("Clocked out"); setTimeout(() => setShiftSuccess(null), 3000); } catch (err: any) { setShiftError(err?.message || "Failed to clock out"); }
  };

  const shiftPending = clockIn.isPending || clockOut.isPending;

  return (
    <MobileShell showNav>
      {/* Date navigation */}
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
          button with the same weight as Clock In. */}
      {isClockedIn && (
        <div className="bg-[#22c55e]/5 px-3 py-2.5 flex items-center justify-between border-b border-emerald-100">
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

      {/* ── Day timeline: visits + scheduled-today tasks, sorted by time ── */}
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={refetch} />
      ) : timelineItems.length === 0 && sectionTasks.length === 0 ? (
        <EmptyState dateLabel={isSelectedToday ? undefined : selectedDate.toLocaleDateString([], { month: "short", day: "numeric" })} />
      ) : (
        <>
          {timelineItems.length > 0 && (
            <div className="p-2.5 space-y-1.5">
              {timelineItems.map((item) =>
                item.kind === "visit" ? (
                  <JobCard key={item.visit.id} visit={item.visit} isNext={item.visit.id === nextVisitId} onTap={() => onVisitTap(item.visit.id)} />
                ) : (
                  <TaskCard
                    key={item.task.id}
                    task={item.task}
                    isCompleting={completingTaskId === item.task.id}
                    isTimerPending={timerTaskId === item.task.id}
                    isTimerRunning={runningTaskId === item.task.id}
                    onTap={() => setLocation(`/tech/tasks/${item.task.id}`)}
                    onStart={async () => {
                      setTimerTaskId(item.task.id);
                      try { await startTask.mutateAsync(item.task.id); }
                      catch (e) { const c = parseTimerConflict(e); if (c) setTimerConflict(c); }
                      finally { setTimerTaskId(null); }
                    }}
                    onStop={async () => {
                      setTimerTaskId(item.task.id);
                      try { await stopTask.mutateAsync(item.task.id); }
                      catch { /* handled by mutation */ }
                      finally { setTimerTaskId(null); }
                    }}
                    onComplete={async () => {
                      setCompletingTaskId(item.task.id);
                      try { await closeTask.mutateAsync(item.task.id); }
                      catch { /* handled by mutation */ }
                      finally { setCompletingTaskId(null); }
                    }}
                  />
                ),
              )}
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
                isCompleting={completingTaskId === task.id}
                isTimerPending={timerTaskId === task.id}
                isTimerRunning={runningTaskId === task.id}
                onTap={() => setLocation(`/tech/tasks/${task.id}`)}
                onStart={async () => {
                  setTimerTaskId(task.id);
                  try { await startTask.mutateAsync(task.id); }
                  catch (e) { const c = parseTimerConflict(e); if (c) setTimerConflict(c); }
                  finally { setTimerTaskId(null); }
                }}
                onStop={async () => {
                  setTimerTaskId(task.id);
                  try { await stopTask.mutateAsync(task.id); }
                  catch { /* handled by mutation */ }
                  finally { setTimerTaskId(null); }
                }}
                onComplete={async () => {
                  setCompletingTaskId(task.id);
                  try { await closeTask.mutateAsync(task.id); }
                  catch { /* handled by mutation */ }
                  finally { setCompletingTaskId(null); }
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Create FAB */}
      <button onClick={() => setShowCreateMenu(true)}
        className="fixed bottom-20 right-4 h-12 w-12 rounded-full bg-emerald-600 text-white shadow-lg flex items-center justify-center active:scale-95 z-30">
        <Plus className="h-5 w-5" />
      </button>

      {/* Create action chooser */}
      {showCreateMenu && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setShowCreateMenu(false)}>
          <div className="w-full max-w-md bg-white rounded-t-2xl p-4 pb-6 shadow-xl space-y-2" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-bold text-slate-800">Create</h3>
              <button onClick={() => setShowCreateMenu(false)} className="p-1 rounded-md hover:bg-slate-100">
                <X className="h-4 w-4 text-slate-400" />
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
      {/* Timer conflict dialog */}
      <ActiveTimerConflictDialog
        open={!!timerConflict}
        onClose={() => setTimerConflict(null)}
        activeItem={timerConflict}
      />
    </MobileShell>
  );
}
