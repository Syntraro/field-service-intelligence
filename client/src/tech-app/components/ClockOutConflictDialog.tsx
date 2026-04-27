/**
 * ClockOutConflictDialog — 2026-04-24 (corrected).
 *
 * Shown when POST /api/time/clock-out returns 409 ACTIVE_JOB_TIMER. Forces
 * the tech to decide what to do with the running job timer before ending
 * their day. Every resolution path routes through an EXISTING canonical
 * endpoint — no duplicate timer-closing logic, no fake-pause-via-notes.
 *
 * Resolution paths by active-timer type:
 *
 *   on_site + visitId   (tech is actively working a visit)
 *     • End Job Timer & Clock Out →
 *         POST /api/tech/visits/:visitId/complete { outcome: "completed" }
 *         Canonical visit-complete path. Stops the timer AND marks the
 *         visit completed. Terminal — not resumable from the tech app
 *         without an explicit reopen. Outcome defaults to "completed";
 *         other outcomes (needs_parts / needs_followup) remain available
 *         from the richer visit-detail page.
 *     • Pause Job Timer & Clock Out →
 *         POST /api/tech/visits/:visitId/pause
 *         Canonical pause path. Sets visit.status = "paused" and stops
 *         the time entry. RESUMABLE via the tech app's existing
 *         POST /api/tech/visits/:visitId/resume (and that route
 *         re-starts a fresh on_site entry — see techField.ts:613-658).
 *
 *   anything else        (travel_to_job, travel_between_jobs,
 *                         travel_to_supplier, supplier_run, task_work)
 *     • End & Clock Out →
 *         POST /api/time/entries/stop { timeEntryId }
 *         These timer types have no visit lifecycle and no canonical
 *         pause/resume. Pause button is hidden for this case because
 *         there is no real resumable pause state.
 *
 * After any resolution path, the final step is the original
 * POST /api/time/clock-out — which the server guard now passes because
 * the running time entry has been cleared.
 *
 * All three stop primitives (/pause, /complete, /entries/stop) are ALREADY
 * the single canonical paths used by the Today and VisitDetail screens.
 */

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Pause, StopCircle, Clock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

export interface ClockOutActiveItem {
  type: "task" | "visit";
  id: string | null;
  entryType: string;
  jobId: string | null;
  visitId: string | null;
  taskId: string | null;
  timeEntryId: string;
  startedAt: string | null;
  notes: string | null;
}

/** Extract the active-timer payload from the 409 ApiError. Returns null
 *  when the error is not an ACTIVE_JOB_TIMER conflict. */
export function parseClockOutConflict(error: any): ClockOutActiveItem | null {
  if (!error) return null;
  const code = error?.code ?? error?.data?.code;
  if (code !== "ACTIVE_JOB_TIMER") return null;
  const activeItem = error?.data?.activeItem ?? error?.activeItem ?? null;
  if (!activeItem) return null;
  return {
    type: activeItem.type === "task" ? "task" : "visit",
    id: activeItem.id ?? null,
    entryType: String(activeItem.entryType ?? "active"),
    jobId: activeItem.jobId ?? null,
    visitId: activeItem.visitId ?? null,
    taskId: activeItem.taskId ?? null,
    timeEntryId: String(activeItem.timeEntryId ?? ""),
    startedAt: activeItem.startedAt ?? null,
    notes: activeItem.notes ?? null,
  };
}

/**
 * Whether the active timer represents live visit work (on_site /
 * in_progress) with a known visitId. Only this case exposes the canonical
 * /pause and /complete endpoints; everything else falls back to a bare
 * /api/time/entries/stop call.
 */
function isResumableVisitTimer(item: ClockOutActiveItem): boolean {
  if (!item.visitId) return false;
  return item.entryType === "on_site" || item.entryType === "in_progress";
}

function activityLabel(activeItem: ClockOutActiveItem): string {
  if (activeItem.notes) return activeItem.notes;
  if (activeItem.type === "task") {
    const short = activeItem.taskId?.slice(0, 8) ?? "task";
    return `Task (${short}…)`;
  }
  switch (activeItem.entryType) {
    case "travel_to_job":        return "Travel to job";
    case "travel_between_jobs":  return "Travel between jobs";
    case "on_site":              return "On-site work";
    case "in_progress":          return "On-site work";
    case "travel_to_supplier":   return "Travel to supplier";
    case "supplier_run":         return "Supplier run";
    case "task_work":            return "Task work";
    default:                     return activeItem.entryType || "Active work";
  }
}

interface ClockOutConflictDialogProps {
  open: boolean;
  activeItem: ClockOutActiveItem | null;
  onCancel: () => void;
  /** Invoked after a successful resolution (timer closed + clocked out). */
  onResolved: () => void;
  /** Invoked when resolution fails; parent decides how to surface the error. */
  onError: (err: unknown) => void;
}

export function ClockOutConflictDialog({
  open,
  activeItem,
  onCancel,
  onResolved,
  onError,
}: ClockOutConflictDialogProps) {
  const [busy, setBusy] = useState<"end" | "pause" | null>(null);

  const clockOut = () =>
    apiRequest("/api/time/clock-out", {
      method: "POST",
      body: JSON.stringify({}),
    });

  const resolveEnd = async () => {
    if (!activeItem || busy) return;
    setBusy("end");
    try {
      if (isResumableVisitTimer(activeItem) && activeItem.visitId) {
        // Canonical visit-complete path — timer stops + visit.status = "completed"
        // inside the orchestrator (lifecycle.completeVisit).
        await apiRequest(`/api/tech/visits/${activeItem.visitId}/complete`, {
          method: "POST",
          body: JSON.stringify({ outcome: "completed" }),
        });
      } else {
        // Non-visit timer (travel / task / supplier). Bare stop — no
        // visit state to manage, no divergence risk.
        await apiRequest("/api/time/entries/stop", {
          method: "POST",
          body: JSON.stringify({ timeEntryId: activeItem.timeEntryId }),
        });
      }
      await clockOut();
      onResolved();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  };

  const resolvePause = async () => {
    if (!activeItem || busy) return;
    if (!isResumableVisitTimer(activeItem) || !activeItem.visitId) {
      // Button should be hidden for non-visit timers, but defensive-guard
      // the handler in case a stale render slipped through.
      return;
    }
    setBusy("pause");
    try {
      // Canonical resumable pause — sets visit.status = "paused", stops
      // the time entry. Resume later via POST /api/tech/visits/:visitId/resume
      // which starts a fresh on_site entry (techField.ts:613-658).
      await apiRequest(`/api/tech/visits/${activeItem.visitId}/pause`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await clockOut();
      onResolved();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  };

  const canPause = activeItem ? isResumableVisitTimer(activeItem) : false;

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-500" />
            Active Job Timer Detected
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>You still have an active timer running:</p>
              {activeItem && (
                <div className="rounded-md bg-amber-50 dark:bg-amber-950 px-3 py-2 text-amber-800 dark:text-amber-200 font-medium">
                  {activityLabel(activeItem)}
                </div>
              )}
              <p className="text-muted-foreground">
                {canPause
                  ? "End the visit or pause it (resumable later) before clocking out."
                  : "End it before clocking out."}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            type="button"
            onClick={resolveEnd}
            disabled={!!busy}
            className="w-full"
            data-testid="clock-out-conflict-end"
          >
            {busy === "end" ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Ending…</>
            ) : (
              <><StopCircle className="h-4 w-4 mr-2" /> End Job Timer & Clock Out</>
            )}
          </Button>
          {canPause && (
            <Button
              type="button"
              variant="secondary"
              onClick={resolvePause}
              disabled={!!busy}
              className="w-full"
              data-testid="clock-out-conflict-pause"
            >
              {busy === "pause" ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Pausing…</>
              ) : (
                <><Pause className="h-4 w-4 mr-2" /> Pause Job Timer & Clock Out</>
              )}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={!!busy}
            className="w-full"
            data-testid="clock-out-conflict-cancel"
          >
            Cancel
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
