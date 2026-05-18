/**
 * TaskDetailPage — Tech app task detail view.
 *
 * 2026-04-10: Created as part of task labor unification.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { MobileShell } from "../components/MobileShell";
import { useTechTasks } from "../hooks/useTechTasks";
import {
  ArrowLeft, Clock, CheckSquare, Loader2, Check, Navigation,
  Briefcase, FileText, Calendar, AlertCircle, X,
} from "lucide-react";
import { ActiveTimerConflictDialog, parseTimerConflict, type ActiveTimerInfo } from "../components/ActiveTimerConflictDialog";
// 2026-04-26: canonical tech-app error formatter — same helper VisitDetailPage
// uses. Returns `null` for 401 (handled by SessionExpiredDialog at app root)
// and a stable message for 403 / other failures. Lets us suppress the toast
// flicker that otherwise overlaps the session-expired modal.
import { displayApiError } from "../utils/apiErrorDisplay";
import type { Task } from "@shared/schema";

export function TaskDetailPage({ taskId }: { taskId: string }) {
  const [, setLocation] = useLocation();
  const { tasks, runningTaskId, startTask, stopTask, closeTask, refetch } = useTechTasks();
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [timerConflict, setTimerConflict] = useState<ActiveTimerInfo | null>(null);
  // 2026-04-26: surfaced action-error state — replaces the prior empty
  // "/* handled by mutation */" catches that hid every non-conflict failure
  // (the underlying useTechTasks mutations have no onError handler, so
  // without this banner the user saw nothing on stop/start/close failure).
  const [actionError, setActionError] = useState<string | null>(null);

  /** Map a mutation error into the inline banner. Falls back to a stable
   *  message; suppresses 401 (handled by the session-expired modal at the
   *  app root). Same shape VisitDetailPage uses. */
  const showError = (err: unknown) => {
    const msg = displayApiError(err);
    if (msg === null) return; // 401 — session-expired modal handles it
    setActionError(msg);
  };

  // Resync task + timer state when the app regains focus. Prevents a stale
  // "running" badge if the backend stopped the timer (e.g., started another
  // task on desktop or an admin closed it) while this tab was backgrounded.
  // SSE handles this when connected; this is the disconnected-tab fallback.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refetch();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refetch]);

  const task = tasks.find((t) => t.id === taskId);

  if (!task) {
    return (
      <MobileShell showNav={false}>
        <div className="flex items-center gap-2 px-3 py-3 border-b border-slate-200">
          <button
            onClick={() => setLocation("/tech/today")}
            aria-label="Back"
            className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center rounded-md hover:bg-slate-100 active:bg-slate-200"
          >
            <ArrowLeft className="h-5 w-5 text-slate-600" />
          </button>
          <span className="text-base font-semibold text-slate-700">Task</span>
        </div>
        <div className="flex items-center justify-center h-40 text-sm text-slate-400">
          Task not found or still loading...
        </div>
      </MobileShell>
    );
  }

  // 2026-04-10 INTEGRITY: Use canonical timer state from time_entries, not task.status
  const isInProgress = runningTaskId === taskId;

  const handleStart = async () => {
    setActionPending("start");
    setActionError(null);
    try {
      await startTask.mutateAsync(taskId);
    } catch (e) {
      // Active-timer conflict has its own dedicated dialog (gives the user
      // the option to stop the other timer). Any OTHER failure surfaces in
      // the inline error banner so the user knows the start didn't land.
      const c = parseTimerConflict(e);
      if (c) {
        setTimerConflict(c);
      } else {
        showError(e);
      }
    } finally {
      setActionPending(null);
    }
  };

  const handleStop = async () => {
    setActionPending("stop");
    setActionError(null);
    try {
      await stopTask.mutateAsync(taskId);
    } catch (e) {
      showError(e);
    } finally {
      setActionPending(null);
    }
  };

  const handleComplete = async () => {
    setActionPending("complete");
    setActionError(null);
    try {
      await closeTask.mutateAsync(taskId);
      setLocation("/tech/today");
    } catch (e) {
      showError(e);
    } finally {
      setActionPending(null);
    }
  };

  return (
    <MobileShell showNav={false}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-slate-200 bg-white sticky top-0 z-10">
        <button onClick={() => setLocation("/tech/today")} className="p-1.5 -ml-1.5 rounded-md active:bg-slate-100">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </button>
        <span className="text-base font-semibold text-slate-700 truncate flex-1">{task.title}</span>
        {isInProgress && (
          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full shrink-0">In Progress</span>
        )}
      </div>

      <div className="p-3 space-y-3">
        {/* Type badge */}
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md flex items-center justify-center bg-indigo-50">
            <CheckSquare className="text-indigo-600 h-4 w-4" />
          </div>
          <div>
            <span className="text-sm font-medium text-slate-700">General Task</span>
            <span className="text-xs text-slate-400 block capitalize">{task.status.replace("_", " ")}</span>
          </div>
        </div>

        {/* Schedule */}
        {task.scheduledStartAt && (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Calendar className="h-4 w-4 text-slate-400" />
            <span>{new Date(task.scheduledStartAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
            {task.scheduledEndAt && (
              <>
                <span className="text-slate-400">-</span>
                <span>{new Date(task.scheduledEndAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
              </>
            )}
          </div>
        )}

        {/* Notes */}
        {task.notes && (
          <div className="rounded-md border border-slate-200 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <FileText className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-xs font-semibold text-slate-500 uppercase">Notes</span>
            </div>
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{task.notes}</p>
          </div>
        )}

        {/* Job link */}
        {task.jobId && (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Briefcase className="h-4 w-4 text-slate-400" />
            <span>Linked to job</span>
            {task.isBillable && (
              <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">Billable</span>
            )}
          </div>
        )}
      </div>

      {/* 2026-04-26: inline error banner — sits directly above the fixed
           action strip so the user sees the failure in the same eyeline as
           the button they tapped. `role="alert" + aria-live="assertive"`
           announces it on screen readers (matches VisitDetailPage). The
           banner is fixed-positioned to stay above the action strip even
           when the page is scrolled. */}
      {actionError && (
        <div
          className="fixed left-0 right-0 z-30 bg-red-50 border-t border-b border-red-200 px-3 py-2 flex items-start gap-2"
          style={{ bottom: "68px" }}
          role="alert"
          aria-live="assertive"
          data-testid="task-detail-error"
        >
          <AlertCircle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-xs text-red-700 flex-1">{actionError}</p>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-red-600 -mt-0.5 -mr-1 p-1 rounded hover:bg-red-100"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Action buttons — fixed at bottom */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-slate-200 bg-white p-3 flex gap-2 z-20">
        {isInProgress ? (
          <button
            onClick={handleStop}
            disabled={!!actionPending}
            className="flex-1 h-11 rounded-md bg-amber-500 text-white font-semibold text-sm flex items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-60"
          >
            {actionPending === "stop" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
            Stop Timer
          </button>
        ) : (
          <button
            onClick={handleStart}
            disabled={!!actionPending || task.status === "completed" || task.status === "cancelled"}
            className="flex-1 h-11 rounded-md bg-blue-600 text-white font-semibold text-sm flex items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-60"
          >
            {actionPending === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
            Start Timer
          </button>
        )}
        <button
          onClick={handleComplete}
          disabled={!!actionPending || task.status === "completed"}
          className="flex-1 h-11 rounded-md bg-emerald-600 text-white font-semibold text-sm flex items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-60"
        >
          {actionPending === "complete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Complete
        </button>
      </div>
      <ActiveTimerConflictDialog
        open={!!timerConflict}
        onClose={() => setTimerConflict(null)}
        activeItem={timerConflict}
      />
    </MobileShell>
  );
}
