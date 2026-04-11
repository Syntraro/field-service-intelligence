/**
 * ActiveTimerConflictDialog — Shared modal for ACTIVE_TIMER_EXISTS (409) errors.
 *
 * 2026-04-10: Shows clear blocking message when tech tries to start a task/visit
 * while another timer is already running.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Clock } from "lucide-react";

export interface ActiveTimerInfo {
  type: "task" | "visit";
  id: string | null;
  entryType: string;
  jobId: string | null;
  taskId: string | null;
  notes: string | null;
}

interface ActiveTimerConflictDialogProps {
  open: boolean;
  onClose: () => void;
  activeItem?: ActiveTimerInfo | null;
}

export function ActiveTimerConflictDialog({
  open,
  onClose,
  activeItem,
}: ActiveTimerConflictDialogProps) {
  const label = activeItem?.notes
    ? activeItem.notes
    : activeItem?.type === "task"
      ? `Task (${activeItem.taskId?.slice(0, 8)}...)`
      : activeItem?.entryType === "travel_to_job"
        ? "Travel to job"
        : activeItem?.entryType === "on_site"
          ? "On-site work"
          : activeItem?.entryType ?? "Active work";

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-500" />
            Timer already running
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>You already have an active timer:</p>
              <div className="rounded-md bg-amber-50 dark:bg-amber-950 px-3 py-2 text-amber-800 dark:text-amber-200 font-medium">
                {label}
              </div>
              <p>Stop the current timer before starting a new one.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onClose}>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Parse a 409 error response to extract activeItem if it's an ACTIVE_TIMER_EXISTS error.
 * Returns the activeItem or null if not a timer conflict.
 */
export function parseTimerConflict(error: any): ActiveTimerInfo | null {
  if (!error) return null;
  // ApiError from queryClient wraps the response
  const code = error?.code || error?.data?.code;
  if (code === "ACTIVE_TIMER_EXISTS") {
    return error?.activeItem || error?.data?.activeItem || null;
  }
  // Check if error message was from the raw response body
  const status = error?.status || error?.statusCode;
  if (status === 409 && error?.message?.includes("another timer")) {
    return error?.activeItem || null;
  }
  return null;
}
