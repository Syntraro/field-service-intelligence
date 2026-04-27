/**
 * SlotQuickCreateLauncher — single canonical quick-create entry point for
 * dispatch / dashboard slot clicks.
 *
 * 2026-04-26 consolidation: dropped the intermediate 3-option chooser
 * ("New Job Visit / General Task / Supplier Visit"). The chooser was a
 * second pre-step on top of what the canonical `CreateNewDialog` already
 * surfaces as its tabs. With the chooser removed, slot click → directly
 * opens `CreateNewDialog` with the slot's prefill applied to BOTH the
 * Job tab and the Task / Supplier-Visit tabs. The user picks the create
 * type by switching tabs inside the modal — same affordance, one click
 * instead of two.
 *
 * The launcher still owns the prefill mapping (slot → tab-specific
 * payload) so consumers (DispatchPreview, dashboard tiles) keep their
 * existing `slot` prop contract.
 */

import { useMemo } from "react";
import { format } from "date-fns";
import { CreateNewDialog } from "@/components/CreateNewDialog";

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

export function SlotQuickCreateLauncher({
  slot,
  onClose,
  defaultJobDurationMinutes = 60,
  onJobCreated,
  onTaskChanged,
}: SlotQuickCreateLauncherProps) {
  // Job prefill — date / time / duration / single-tech array.
  const jobInitialSchedule = useMemo(() => {
    if (!slot) return undefined;
    return {
      date: slot.date,
      time: slot.startTime,
      durationMinutes: slot.durationMinutes ?? defaultJobDurationMinutes,
      assignedTechnicianIds: [slot.technicianId],
    };
  }, [slot, defaultJobDurationMinutes]);

  // Task / Supplier-Visit prefill — separate shape (single user, ymd date).
  const taskInitialData = useMemo(() => {
    if (!slot) return undefined;
    return {
      assignedToUserId: slot.technicianId,
      startDate: toYmdString(slot.date),
      startTime: slot.startTime,
    };
  }, [slot]);

  return (
    <CreateNewDialog
      open={!!slot}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      defaultTab="job"
      jobInitialSchedule={jobInitialSchedule}
      taskInitialData={taskInitialData}
      onJobCreated={onJobCreated}
      onTaskChanged={onTaskChanged}
    />
  );
}
