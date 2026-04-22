/**
 * SlotQuickCreateLauncher — single canonical quick-create entry point.
 *
 * Consolidates the "click a free slot → pick New Job / General Task /
 * Supplier Visit → open the canonical create dialog pre-filled with
 * {tech, date, time}" flow that Dispatch (`DispatchPreview`) and the
 * Dashboard technician workload tiles each previously reimplemented.
 *
 * Contract:
 *  - Caller feeds a controlled `slot` prop. non-null renders the chooser.
 *  - Chooser selection prefills and opens the corresponding canonical
 *    dialog (`QuickAddJobDialog` for New Job; `TaskDialog` for General
 *    Task / Supplier Visit — the Supplier Visit flow is a `taskType`
 *    variant of `TaskDialog`, not a separate dialog).
 *  - `defaultJobDurationMinutes` (60 by default) is applied to the New
 *    Job prefill whenever the slot does not carry its own duration.
 *
 * This component never forks the canonical create dialogs. It only
 * orchestrates WHEN and WITH WHAT CONTEXT they open.
 */

import { useMemo, useState } from "react";
import { CalendarPlus, ClipboardList, Truck } from "lucide-react";
import { format } from "date-fns";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";
import { TaskDialog } from "@/components/TaskDialog";

export interface QuickCreateSlot {
  technicianId: string;
  technicianName?: string;
  /** Anchor date. Accepts a `Date` (canonical) or "YYYY-MM-DD" string. */
  date: Date | string;
  /** 24h "HH:mm" — the slot's start. */
  startTime: string;
  /** Optional "HH:mm" end for the chooser header only. */
  endTime?: string;
  /** Optional duration (minutes). Falls back to defaultJobDurationMinutes. */
  durationMinutes?: number;
}

export interface SlotQuickCreateLauncherProps {
  /** Controlled: non-null shows the chooser. */
  slot: QuickCreateSlot | null;
  /** Clears the chooser/slot on cancel or after a dialog option is picked. */
  onClose: () => void;
  /** Default duration for the New Job prefill when `slot.durationMinutes` is absent. */
  defaultJobDurationMinutes?: number;
  /** Optional: surface-specific side-effects after a successful create. */
  onJobCreated?: () => void;
  onTaskChanged?: () => void;
}

/** Parse "HH:mm" into a Date anchored at today, for 12h formatting. */
function parseHMasDate(hm: string): Date {
  const [h, m] = hm.split(":").map(Number);
  const d = new Date();
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}

/** Coerce slot.date to a YYYY-MM-DD string (TaskDialog's expected shape). */
function toYmdString(date: Date | string): string {
  if (typeof date === "string") return date;
  return format(date, "yyyy-MM-dd");
}

/** Coerce slot.date to a Date (QuickAddJobDialog accepts either, but `Date`
 *  matches the Calendar picker's native type). */
function toDate(date: Date | string): Date {
  if (typeof date === "string") return new Date(`${date}T00:00:00`);
  return date;
}

export function SlotQuickCreateLauncher({
  slot,
  onClose,
  defaultJobDurationMinutes = 60,
  onJobCreated,
  onTaskChanged,
}: SlotQuickCreateLauncherProps) {
  const [jobOpen, setJobOpen] = useState(false);
  const [jobPrefill, setJobPrefill] = useState<{
    date?: Date | string;
    time?: string;
    durationMinutes?: number;
    assignedTechnicianIds?: string[];
  } | undefined>(undefined);

  const [taskOpen, setTaskOpen] = useState(false);
  const [taskPrefill, setTaskPrefill] = useState<{
    assignedToUserId?: string;
    startDate?: string;
    startTime?: string;
    taskType?: "GENERAL" | "SUPPLIER_VISIT";
  } | undefined>(undefined);

  // The chooser is open iff there's a slot AND no downstream dialog is up.
  const chooserOpen = !!slot && !jobOpen && !taskOpen;

  const headerTimeLabel = useMemo(
    () => (slot ? format(parseHMasDate(slot.startTime), "h:mm a") : ""),
    [slot],
  );
  const headerDateLabel = useMemo(
    () => (slot ? format(toDate(slot.date), "EEEE, MMM d, yyyy") : ""),
    [slot],
  );

  const openJob = () => {
    if (!slot) return;
    setJobPrefill({
      date: slot.date,
      time: slot.startTime,
      durationMinutes: slot.durationMinutes ?? defaultJobDurationMinutes,
      assignedTechnicianIds: [slot.technicianId],
    });
    setJobOpen(true);
    onClose();
  };

  const openTask = (taskType: "GENERAL" | "SUPPLIER_VISIT") => {
    if (!slot) return;
    setTaskPrefill({
      assignedToUserId: slot.technicianId,
      startDate: toYmdString(slot.date),
      startTime: slot.startTime,
      taskType,
    });
    setTaskOpen(true);
    onClose();
  };

  return (
    <>
      <Dialog open={chooserOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent className="max-w-[280px] p-5 gap-0">
          <DialogHeader className="space-y-1.5 pb-3">
            <DialogTitle className="text-base font-semibold">Quick Create</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-0.5">
                <p className="text-sm text-foreground font-medium">
                  {slot?.technicianName ?? "Technician"} · {headerTimeLabel}
                </p>
                <p className="text-xs text-muted-foreground">{headerDateLabel}</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5 pt-1">
            <Button
              className="w-full justify-start gap-2"
              onClick={openJob}
              data-testid="slot-create-job"
            >
              <CalendarPlus className="h-4 w-4" />
              New Job Visit
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={() => openTask("GENERAL")}
              data-testid="slot-create-task"
            >
              <ClipboardList className="h-4 w-4" />
              General Task
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={() => openTask("SUPPLIER_VISIT")}
              data-testid="slot-create-supplier-visit"
            >
              <Truck className="h-4 w-4" />
              Supplier Visit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={onClose}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <QuickAddJobDialog
        open={jobOpen}
        onOpenChange={(open) => {
          setJobOpen(open);
          if (!open) setJobPrefill(undefined);
        }}
        initialSchedule={jobPrefill}
        onSuccess={() => {
          setJobOpen(false);
          setJobPrefill(undefined);
          onJobCreated?.();
        }}
      />

      <TaskDialog
        open={taskOpen}
        onOpenChange={(open) => {
          setTaskOpen(open);
          if (!open) setTaskPrefill(undefined);
        }}
        initialData={taskPrefill}
        onChanged={() => { onTaskChanged?.(); }}
      />
    </>
  );
}
