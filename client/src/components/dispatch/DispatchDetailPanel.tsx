/**
 * DispatchDetailPanel — right-side panel showing visit or task details.
 *
 * Restructured 2026-03-08:
 * - Client-first hierarchy: customer name → summary → job link
 * - Compact status badge row (no full Section wrapper)
 * - Searchable multi-select crew picker (stays open during multi-select)
 * - Inline date editing via calendar popover (reuses canonical reschedule path)
 * - Panel order: identity → status → crew → schedule → location → actions
 * - "Open Job" button removed; job number is a link in the header
 */
import { useState, useCallback, useMemo, useRef } from "react";
import { format, addMinutes } from "date-fns";
import { Link } from "wouter";
import {
  X, Clock, MapPin, Phone, FileText, Pencil, Save,
  ExternalLink, CalendarDays, AlertTriangle, KeyRound,
  ClipboardList, Truck, Users, CheckCircle2,
  RotateCcw, Trash2, ChevronDown, Search,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DispatchVisit, DispatchTask, VisitStatus, Technician } from "./dispatchPreviewTypes";
import { StatusChip } from "@/components/ui/chip";
import { visitStatusColor, formatDuration, isCompletedStatus, normalizeVisitStatusForDisplay, SNAP_MINUTES, TIMELINE_START_HOUR, TIMELINE_END_HOUR, jobStateColor, jobStateLabel } from "./dispatchPreviewUtils";
import { visitStatusLabel } from "@/lib/visitStatusDisplay";
import { clampResizeEnd, findNearestValidSlot } from "./dispatchOverlapUtils";
// 2026-03-21: NeedsFollowUpModal removed — lifecycle actions now routed through
// canonical EditVisitModal opened via onOpenVisitEditor callback.

/**
 * 2026-04-21 Phase 1 canonical visit mutation architecture:
 * DispatchDetailPanel is TASK-ONLY. Visit rendering was removed from this
 * component to enforce the architectural rule that visit edits flow
 * exclusively through EditVisitModal (via VisitEditorLauncher), which
 * consumes `useDispatchPreviewMutations` for all operational mutations.
 *
 * Do NOT reintroduce visit-edit callbacks or visit rendering here. The
 * previous `VisitProps` interface (with onUpdateCrew, onUpdateStatus,
 * onUpdateVisitNotes, onReschedule, onResize, onOpenVisitEditor, and
 * onScheduleFromPanel) was dead — DispatchPreview never mounted this panel
 * for visits — and leaving it in place invited future shadow orchestration.
 */
type TaskProps = {
  entityType: "task";
  task: DispatchTask;
  technicians?: Technician[];
  laneVisits?: DispatchVisit[];
  laneTasks?: DispatchTask[];
  onClose: () => void;
  onRescheduleTask?: (task: DispatchTask, newStart: string, newEnd: string, techId?: string) => void;
  /** Item 8: Task lifecycle actions */
  onCompleteTask?: (task: DispatchTask) => void;
  onReopenTask?: (task: DispatchTask) => void;
  onDeleteTask?: (task: DispatchTask) => void;
  /** When "popover", renders as a compact overlay instead of a full-height sidebar */
  mode?: "sidebar" | "popover";
};

type Props = TaskProps;

// 2026-03-18: Local STATUS_LABELS removed — using canonical visitStatusLabel()
// from visitStatusDisplay.ts. See that module for the authoritative label mapping.

const TASK_TYPE_LABELS: Record<string, string> = {
  GENERAL: "General Task",
  SUPPLIER_VISIT: "Supplier Visit",
  supplier_run: "Supplier Run",
  pickup: "Pickup",
  delivery: "Delivery",
  meeting: "Meeting",
  training: "Training",
  vehicle_maintenance: "Vehicle Maintenance",
};

/** Returns true if this task type should show the Truck icon */
function isSupplierType(type: string): boolean {
  return type === "SUPPLIER_VISIT" || type === "supplier_run";
}

import { DURATION_MINUTES as DURATION_OPTIONS } from "@/lib/schedulingConstants";

// ============================================================================
// Shared sub-components
// ============================================================================

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-b pb-2 mb-2 last:border-b-0">
      <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">{title}</p>
      {children}
    </div>
  );
}

function InfoRow({ icon: Icon, children }: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  if (!children) return null;
  return (
    <div className="flex items-start gap-2 py-0.5">
      <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
      <div className="min-w-0 text-xs text-foreground">{children}</div>
    </div>
  );
}

// ============================================================================
// 2026-04-21 Phase 1: CrewPicker, UnscheduledScheduleForm, and VisitDetail
// have been removed. Their only consumer was the defunct visit branch of
// this panel. Crew selection now lives inside EditVisitModal via the
// canonical `VisitTeamAssignment` component; unscheduled visits are
// scheduled from the canonical quick-create / EditVisitModal surfaces.
// Do not resurrect these functions — add features to EditVisitModal.
// ============================================================================


// ============================================================================
// TaskDetail — unchanged structure
// ============================================================================

function TaskDetail({ task, onClose, technicians, laneVisits = [], laneTasks = [], onRescheduleTask, onCompleteTask, onReopenTask, onDeleteTask, mode = "sidebar" }: Omit<TaskProps, "entityType">) {
  const typeLabel = TASK_TYPE_LABELS[task.type] ?? task.type;
  const isScheduled = !!task.scheduledStart;

  const handleTaskTechChange = useCallback((newTechId: string) => {
    if (!onRescheduleTask || !task.scheduledStart) return;
    const dur = task.durationMinutes * 60000;
    const newEnd = new Date(new Date(task.scheduledStart).getTime() + dur).toISOString();
    onRescheduleTask(task, task.scheduledStart, newEnd, newTechId);
  }, [task, onRescheduleTask]);

  const handleTaskDurationChange = useCallback((newDurStr: string) => {
    const newDur = parseInt(newDurStr, 10);
    if (isNaN(newDur) || !task.scheduledStart || !onRescheduleTask) return;
    const start = new Date(task.scheduledStart);
    const startMin = start.getHours() * 60 + start.getMinutes();
    const clampedEndMin = clampResizeEnd(startMin, startMin + newDur, laneVisits, laneTasks, task.id, TIMELINE_END_HOUR);
    const clampedDur = clampedEndMin - startMin;
    if (clampedDur < SNAP_MINUTES) return;
    const newEnd = addMinutes(start, clampedDur).toISOString();
    onRescheduleTask(task, task.scheduledStart, newEnd);
  }, [task, onRescheduleTask, laneVisits, laneTasks]);

  const [editingStartTime, setEditingStartTime] = useState<string | null>(null);
  const currentStartTime = useMemo(() => {
    if (!task.scheduledStart) return "";
    return format(new Date(task.scheduledStart), "HH:mm");
  }, [task.scheduledStart]);

  const handleTaskStartTimeCommit = useCallback((timeStr: string) => {
    if (!onRescheduleTask || !task.scheduledStart) return;
    setEditingStartTime(null);
    if (timeStr === currentStartTime) return;
    const [h, m] = timeStr.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return;
    const proposedStartMin = h * 60 + m;
    const validStartMin = findNearestValidSlot(
      proposedStartMin, task.durationMinutes, laneVisits, task.id,
      SNAP_MINUTES, TIMELINE_START_HOUR, TIMELINE_END_HOUR, laneTasks,
    );
    if (validStartMin === null) return;
    const newStart = new Date(task.scheduledStart);
    newStart.setHours(Math.floor(validStartMin / 60), validStartMin % 60, 0, 0);
    const newEnd = addMinutes(newStart, task.durationMinutes).toISOString();
    onRescheduleTask(task, newStart.toISOString(), newEnd);
  }, [task, onRescheduleTask, currentStartTime, laneVisits, laneTasks]);

  // Item 3: Inline date editing for tasks — preserves time and duration
  const handleTaskDateChange = useCallback((newDate: Date | undefined) => {
    if (!newDate || !onRescheduleTask || !task.scheduledStart) return;
    const oldStart = new Date(task.scheduledStart);
    const newStart = new Date(newDate);
    newStart.setHours(oldStart.getHours(), oldStart.getMinutes(), oldStart.getSeconds(), 0);
    const newEnd = addMinutes(newStart, task.durationMinutes).toISOString();
    onRescheduleTask(task, newStart.toISOString(), newEnd);
  }, [task, onRescheduleTask]);

  const durationOpts = useMemo(() => {
    const set = new Set(DURATION_OPTIONS);
    if (task.durationMinutes > 0) set.add(task.durationMinutes);
    return Array.from(set).sort((a, b) => a - b);
  }, [task.durationMinutes]);

  // Item 8: Task lifecycle state
  const isTaskCompleted = task.status === "completed" || task.status === "cancelled";
  const [confirmDeleteTask, setConfirmDeleteTask] = useState(false);

  return (
    <div className={mode === "popover"
      ? "flex w-[22rem] flex-col rounded-md border bg-white shadow-xl"
      : "flex h-full w-80 flex-shrink-0 flex-col border-l-2 border-l-[#76B054] bg-white shadow-lg"
    }>
      <div data-panel-drag-handle className={`flex items-center justify-between border-b bg-[rgba(118,176,84,0.08)] px-3 py-2.5 ${mode === "popover" ? "rounded-t-lg cursor-move" : ""}`}>
        <div className="min-w-0 flex items-center gap-2">
          {isSupplierType(task.type)
            ? <Truck className="h-4 w-4 text-[#76B054] flex-shrink-0" />
            : <ClipboardList className="h-4 w-4 text-[#76B054] flex-shrink-0" />}
          <div>
            <p className={`text-sm font-bold truncate ${isTaskCompleted ? "text-muted-foreground line-through" : "text-foreground"}`}>
              {isTaskCompleted && <CheckCircle2 className="h-3.5 w-3.5 text-slate-400 inline mr-1 -mt-0.5" />}
              {task.title}
            </p>
            <p className="text-xs text-muted-foreground">{typeLabel}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-[#C2E974] text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className={mode === "popover" ? "px-3 py-2 overflow-y-auto" : "flex-1 overflow-y-auto px-3 py-2"}>
        <div className="flex items-center gap-2 mb-2 pb-2 border-b">
          <StatusChip status={task.status}>
            {task.status.replace("_", " ")}
          </StatusChip>
        </div>

        {isScheduled && technicians && technicians.length > 0 && onRescheduleTask && (
          <Section title="Assignee">
            <Select value={task.assignedToUserId ?? ""} onValueChange={handleTaskTechChange}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Assign team member" />
              </SelectTrigger>
              <SelectContent>
                {technicians.map(t => (
                  <SelectItem key={t.id} value={t.id} className="text-xs">{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Section>
        )}

        <Section title="Schedule">
          {isScheduled && task.scheduledStart ? (
            <>
              {/* Item 3: Inline date picker for tasks (mirrors visit date editing) */}
              <div className="flex items-center gap-2 py-0.5">
                <CalendarDays className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                {onRescheduleTask ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="text-xs font-medium hover:text-[#76B054] hover:underline transition-colors">
                        {format(new Date(task.scheduledStart), "EEE, MMM d, yyyy")}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                      <Calendar
                        mode="single"
                        selected={new Date(task.scheduledStart)}
                        onSelect={handleTaskDateChange}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                ) : (
                  <span className="text-xs font-medium">{format(new Date(task.scheduledStart), "EEE, MMM d, yyyy")}</span>
                )}
              </div>
              <div className="flex items-center gap-2 py-0.5">
                <Clock className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                {onRescheduleTask ? (
                  <>
                    <Input
                      type="time"
                      value={editingStartTime ?? currentStartTime}
                      onChange={e => setEditingStartTime(e.target.value)}
                      onBlur={e => handleTaskStartTimeCommit(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") handleTaskStartTimeCommit((e.target as HTMLInputElement).value);
                        if (e.key === "Escape") setEditingStartTime(null);
                      }}
                      step={SNAP_MINUTES * 60}
                      className="h-7 w-28 text-xs"
                    />
                    {task.scheduledEnd && (
                      <span className="text-xs text-muted-foreground">
                        – {format(new Date(task.scheduledEnd), "h:mm a")}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-xs">
                    {format(new Date(task.scheduledStart), "h:mm a")}
                    {task.scheduledEnd && ` – ${format(new Date(task.scheduledEnd), "h:mm a")}`}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 py-0.5">
                <Clock className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground opacity-0" />
                {onRescheduleTask ? (
                  <Select value={String(task.durationMinutes)} onValueChange={handleTaskDurationChange}>
                    <SelectTrigger className="h-7 w-28 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {durationOpts.map(d => (
                        <SelectItem key={d} value={String(d)} className="text-xs">{formatDuration(d)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-xs">{formatDuration(task.durationMinutes)}</span>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground italic">Not yet scheduled</p>
          )}
        </Section>

        {task.notes && (
          <Section title="Notes">
            <p className="text-xs text-foreground whitespace-pre-wrap">{task.notes}</p>
          </Section>
        )}
      </div>

      {/* Item 8: Task footer with lifecycle actions */}
      <div className="border-t bg-blue-50/30 px-3 py-2 space-y-1.5">
        {/* Complete / Reopen */}
        {onCompleteTask && onReopenTask && (
          <div className="flex gap-1.5">
            {isTaskCompleted ? (
              <button
                onClick={() => onReopenTask(task)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors"
              >
                <RotateCcw className="h-3 w-3" /> Reopen Task
              </button>
            ) : (
              <button
                onClick={() => onCompleteTask(task)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
              >
                <CheckCircle2 className="h-3 w-3" /> Complete Task
              </button>
            )}
          </div>
        )}

        {/* Delete */}
        {onDeleteTask && (
          confirmDeleteTask ? (
            <div className="flex gap-1.5">
              <button
                onClick={() => { onDeleteTask(task); setConfirmDeleteTask(false); }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200 transition-colors"
              >
                Confirm Delete
              </button>
              <button
                onClick={() => setConfirmDeleteTask(false)}
                className="flex items-center justify-center rounded px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDeleteTask(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="h-3 w-3" /> Delete Task
            </button>
          )
        )}

        {/* Related job link */}
        {task.jobId && (
          <Link
            href={`/jobs/${task.jobId}`}
            className="flex w-full items-center justify-center gap-1.5 rounded bg-[#C2E974] px-3 py-1.5 text-xs font-medium text-[#39833A] hover:bg-[rgba(118,176,84,0.25)] transition-colors"
          >
            <ExternalLink className="h-3 w-3" /> Open Related Job
          </Link>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Exported wrapper
// ============================================================================

export default function DispatchDetailPanel(props: Props) {
  return (
    <TaskDetail
      task={props.task}
      technicians={props.technicians}
      laneVisits={props.laneVisits}
      laneTasks={props.laneTasks}
      onClose={props.onClose}
      onRescheduleTask={props.onRescheduleTask}
      onCompleteTask={props.onCompleteTask}
      onReopenTask={props.onReopenTask}
      onDeleteTask={props.onDeleteTask}
      mode={props.mode}
    />
  );
}
