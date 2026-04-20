/**
 * TaskDetailPage — Tech app task detail view.
 *
 * 2026-04-10: Created as part of task labor unification.
 * Shows task info, supplier visit details, and start/stop/complete controls
 * backed by canonical time_entries.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { MobileShell } from "../components/MobileShell";
import { useTechTasks } from "../hooks/useTechTasks";
import {
  ArrowLeft, Clock, Truck, CheckSquare, Loader2, Check, Navigation,
  Briefcase, MapPin, FileText, Calendar,
} from "lucide-react";
import { ActiveTimerConflictDialog, parseTimerConflict, type ActiveTimerInfo } from "../components/ActiveTimerConflictDialog";
import type { Task } from "@shared/schema";

interface SupplierVisitDetails {
  taskId: string;
  supplierId: string | null;
  supplierLocationId: string | null;
  supplierNameOther: string | null;
  poNumber: string | null;
}

export function TaskDetailPage({ taskId }: { taskId: string }) {
  const [, setLocation] = useLocation();
  const { tasks, runningTaskId, startTask, stopTask, closeTask, refetch } = useTechTasks();
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [timerConflict, setTimerConflict] = useState<ActiveTimerInfo | null>(null);

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

  // Fetch supplier visit details if SUPPLIER_VISIT type
  const svQuery = useQuery<SupplierVisitDetails | null>({
    queryKey: ["/api/tech/tasks", taskId, "supplier-visit"],
    queryFn: async () => {
      if (!task || task.type !== "SUPPLIER_VISIT") return null;
      const res = await fetch(`/api/tasks/${taskId}/supplier-visit`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!task && task.type === "SUPPLIER_VISIT",
    staleTime: 60_000,
  });

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
  const isSupplier = task.type === "SUPPLIER_VISIT";
  const sv = svQuery.data;

  const handleStart = async () => {
    setActionPending("start");
    try { await startTask.mutateAsync(taskId); }
    catch (e) { const c = parseTimerConflict(e); if (c) setTimerConflict(c); }
    finally { setActionPending(null); }
  };

  const handleStop = async () => {
    setActionPending("stop");
    try { await stopTask.mutateAsync(taskId); }
    catch { /* handled by mutation */ }
    finally { setActionPending(null); }
  };

  const handleComplete = async () => {
    setActionPending("complete");
    try { await closeTask.mutateAsync(taskId); setLocation("/tech/today"); }
    catch { /* handled by mutation */ }
    finally { setActionPending(null); }
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
          <div className={`h-8 w-8 rounded-md flex items-center justify-center ${
            isSupplier ? "bg-amber-50" : "bg-indigo-50"
          }`}>
            {isSupplier
              ? <Truck className="text-amber-600 h-4 w-4" />
              : <CheckSquare className="text-indigo-600 h-4 w-4" />
            }
          </div>
          <div>
            <span className="text-sm font-medium text-slate-700">{isSupplier ? "Supplier Visit" : "General Task"}</span>
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

        {/* Supplier visit details */}
        {isSupplier && sv && (
          <div className="rounded-md border border-amber-200 bg-amber-50/50 p-3 space-y-1.5">
            <div className="flex items-center gap-1.5 mb-1">
              <Truck className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs font-semibold text-amber-700 uppercase">Supplier Details</span>
            </div>
            {sv.supplierNameOther && (
              <div className="text-sm text-slate-700"><span className="text-slate-400">Supplier:</span> {sv.supplierNameOther}</div>
            )}
            {sv.poNumber && (
              <div className="text-sm text-slate-700"><span className="text-slate-400">PO #:</span> {sv.poNumber}</div>
            )}
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
