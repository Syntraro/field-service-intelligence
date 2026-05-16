/**
 * SlotQuickCreateLauncher — quick-create entry point for dispatch slot clicks.
 *
 * When a dispatch slot is clicked, a small two-button chooser asks whether
 * the user wants to create a Job or a Task for that slot. Choosing one opens
 * the corresponding focused create modal with the slot's prefill applied.
 */

import { useState, useEffect, useMemo } from "react";
import { format } from "date-fns";
import { CreateJobModal } from "@/components/CreateJobModal";
import { CreateTaskModal } from "@/components/CreateTaskModal";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ClipboardList, CheckSquare } from "lucide-react";

export interface QuickCreateSlot {
  technicianId: string;
  technicianName?: string;
  /** Anchor date. Accepts a `Date` (canonical) or "YYYY-MM-DD" string. */
  date: Date | string;
  /** 24h "HH:mm" — the slot's start. */
  startTime: string;
  /** Optional "HH:mm" end — preserved for compatibility; not used by the
   *  canonical dialogs (they derive end from duration). */
  endTime?: string;
  /** Optional duration (minutes). Falls back to defaultJobDurationMinutes. */
  durationMinutes?: number;
}

export interface SlotQuickCreateLauncherProps {
  /** Controlled: non-null mounts the create modal with this slot's prefill. */
  slot: QuickCreateSlot | null;
  /** Clears the slot when the modal closes. */
  onClose: () => void;
  /** Default duration for the New Job prefill when `slot.durationMinutes` is absent. */
  defaultJobDurationMinutes?: number;
  /** Optional: surface-specific side-effects after a successful create. */
  onJobCreated?: () => void;
  onTaskChanged?: () => void;
}

/** Coerce slot.date to a YYYY-MM-DD string (TaskDialog's expected shape). */
function toYmdString(date: Date | string): string {
  if (typeof date === "string") return date;
  return format(date, "yyyy-MM-dd");
}

type ChosenType = "job" | "task" | null;

export function SlotQuickCreateLauncher({
  slot,
  onClose,
  defaultJobDurationMinutes = 60,
  onJobCreated,
  onTaskChanged,
}: SlotQuickCreateLauncherProps) {
  // Which modal is open after the user picks a type. null = show chooser.
  const [chosenType, setChosenType] = useState<ChosenType>(null);

  // Reset type choice whenever the slot clears so the chooser appears fresh
  // on the next slot click.
  useEffect(() => {
    if (!slot) setChosenType(null);
  }, [slot]);

  const jobInitialSchedule = useMemo(() => {
    if (!slot) return undefined;
    return {
      date: slot.date,
      time: slot.startTime,
      durationMinutes: slot.durationMinutes ?? defaultJobDurationMinutes,
      assignedTechnicianIds: [slot.technicianId],
    };
  }, [slot, defaultJobDurationMinutes]);

  const taskInitialData = useMemo(() => {
    if (!slot) return undefined;
    return {
      assignedToUserId: slot.technicianId,
      startDate: toYmdString(slot.date),
      startTime: slot.startTime,
    };
  }, [slot]);

  const isOpen = !!slot;
  const chooserOpen = isOpen && chosenType === null;
  const jobOpen = isOpen && chosenType === "job";
  const taskOpen = isOpen && chosenType === "task";

  return (
    <>
      {/* Step 1 — pick job or task for this slot. */}
      <ModalShell
        open={chooserOpen}
        onOpenChange={(open) => { if (!open) onClose(); }}
        className="max-w-xs"
        data-testid="dialog-slot-chooser"
      >
        <ModalHeader className="sr-only">
          <ModalTitle>Choose what to create</ModalTitle>
          <ModalDescription>Create a job or task for this time slot.</ModalDescription>
        </ModalHeader>
        <div className="p-6 flex flex-col gap-3">
          <p className="text-sm font-medium text-center text-foreground mb-1">
            What would you like to create?
          </p>
          <Button
            variant="outline"
            className="h-12 flex items-center gap-2 justify-center"
            onClick={() => setChosenType("job")}
            data-testid="slot-chooser-job"
          >
            <ClipboardList className="h-4 w-4" />
            Create Job
          </Button>
          <Button
            variant="outline"
            className="h-12 flex items-center gap-2 justify-center"
            onClick={() => setChosenType("task")}
            data-testid="slot-chooser-task"
          >
            <CheckSquare className="h-4 w-4" />
            Create Task
          </Button>
        </div>
      </ModalShell>

      {/* Step 2 — focused create modal for the chosen type. */}
      <CreateJobModal
        open={jobOpen}
        onOpenChange={(open) => { if (!open) onClose(); }}
        initialSchedule={jobInitialSchedule}
        onSuccess={onJobCreated}
      />
      <CreateTaskModal
        open={taskOpen}
        onOpenChange={(open) => { if (!open) onClose(); }}
        initialData={taskInitialData}
        onChanged={onTaskChanged}
      />
    </>
  );
}
