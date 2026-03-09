/**
 * WeekDispatchCell — individual cell in the week grid (one tech, one day).
 * Compact item rows for dense weekly overview. Click to select for detail panel.
 * Items are draggable for week-view drag/drop rescheduling.
 * Multi-tech visits show a team indicator badge.
 */
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { DispatchVisit, DispatchTask } from "./dispatchPreviewTypes";
import type { DispatchDragData, DispatchDropData } from "./dispatchDndTypes";
import { visitStatusDot, formatDuration, isCompletedStatus } from "./dispatchPreviewUtils";
import { ClipboardList, Truck, Users, CheckCircle2 } from "lucide-react";

type Props = {
  visits: DispatchVisit[];
  tasks: DispatchTask[];
  selectedItemId: string | null;
  onSelectVisit: (visit: DispatchVisit) => void;
  onSelectTask: (task: DispatchTask) => void;
  techId: string;
  dayKey: string;
};

const MAX_VISIBLE = 4;

/** Draggable visit row inside a week cell */
function WeekVisitItem({ visit, techId, dayKey, isSelected, onSelect }: {
  visit: DispatchVisit;
  techId: string;
  dayKey: string;
  isSelected: boolean;
  onSelect: (v: DispatchVisit) => void;
}) {
  const isTeamVisit = visit.technicianIds.length > 1;
  const isCompleted = isCompletedStatus(visit.status);
  const dragData: DispatchDragData = {
    type: "scheduled-visit",
    visitId: visit.id,
    jobId: visit.jobId,
    jobNumber: visit.jobNumber,
    technicianId: visit.technicianId,
    durationMinutes: visit.durationMinutes,
    version: visit.version,
    isMultiTech: isTeamVisit,
    originalStart: visit.scheduledStart,
  };

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `week-visit-${visit.id}--${techId}--${dayKey}`,
    data: dragData,
  });

  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-dispatch-block="week-visit"
      onClick={(e) => { e.stopPropagation(); onSelect(visit); }}
      className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-slate-100 cursor-grab active:cursor-grabbing ${
        isSelected ? "ring-1 ring-emerald-500 bg-emerald-50" : ""
      } ${isDragging ? "opacity-40" : ""} ${isCompleted ? "opacity-55" : ""}`}
    >
      {isCompleted
        ? <CheckCircle2 className="h-2.5 w-2.5 flex-shrink-0 text-slate-400" />
        : <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${visitStatusDot(visit.status)}`} />
      }
      <span className={`truncate text-[10px] flex-1 ${isCompleted ? "line-through text-muted-foreground" : "text-foreground"}`}>{visit.customerName}</span>
      {isTeamVisit && (
        <span className="flex items-center gap-0.5 rounded bg-emerald-100 px-1 py-px text-[8px] font-semibold text-emerald-700 flex-shrink-0">
          <Users className="h-2 w-2" />{visit.technicianIds.length}
        </span>
      )}
      <span className="text-[9px] text-muted-foreground whitespace-nowrap flex-shrink-0">
        {formatDuration(visit.durationMinutes)}
      </span>
    </button>
  );
}

/** Draggable task row inside a week cell */
function WeekTaskItem({ task, techId, dayKey, isSelected, onSelect }: {
  task: DispatchTask;
  techId: string;
  dayKey: string;
  isSelected: boolean;
  onSelect: (t: DispatchTask) => void;
}) {
  const dragData: DispatchDragData = {
    type: "scheduled-task",
    visitId: task.id,
    jobId: task.jobId ?? "",
    jobNumber: 0,
    technicianId: task.assignedToUserId,
    durationMinutes: task.durationMinutes || 60,
    version: 0,
    originalStart: task.scheduledStart,
  };

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `week-task-${task.id}--${techId}--${dayKey}`,
    data: dragData,
  });

  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-dispatch-block="week-task"
      onClick={(e) => { e.stopPropagation(); onSelect(task); }}
      className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-blue-50 cursor-grab active:cursor-grabbing ${
        isSelected ? "ring-1 ring-blue-500 bg-blue-50" : ""
      } ${isDragging ? "opacity-40" : ""}`}
    >
      {task.type === "SUPPLIER_VISIT" || task.type === "supplier_run"
        ? <Truck className="h-2.5 w-2.5 flex-shrink-0 text-blue-500" />
        : <ClipboardList className="h-2.5 w-2.5 flex-shrink-0 text-blue-500" />}
      <span className="truncate text-[10px] text-blue-700 flex-1">{task.title}</span>
      <span className="text-[9px] text-blue-400 whitespace-nowrap flex-shrink-0">
        {formatDuration(task.durationMinutes)}
      </span>
    </button>
  );
}

export default function WeekDispatchCell({ visits, tasks, selectedItemId, onSelectVisit, onSelectTask, techId, dayKey }: Props) {
  // Make the cell a droppable zone for week-view drag/drop
  const dropData: DispatchDropData = { technicianId: techId, dayKey };
  const { setNodeRef, isOver } = useDroppable({
    id: `week-cell-${techId}--${dayKey}`,
    data: dropData,
  });

  const totalItems = visits.length + tasks.length;

  const visibleVisits = visits.slice(0, MAX_VISIBLE);
  const remainingSlots = Math.max(0, MAX_VISIBLE - visibleVisits.length);
  const visibleTasks = tasks.slice(0, remainingSlots);
  const overflow = totalItems - visibleVisits.length - visibleTasks.length;

  return (
    <div ref={setNodeRef} className={`space-y-px min-h-[36px] rounded transition-colors ${isOver ? "bg-blue-50/60 ring-1 ring-inset ring-blue-300" : ""}`}>
      {visibleVisits.map(v => (
        <WeekVisitItem
          key={`${v.id}--${techId}`}
          visit={v}
          techId={techId}
          dayKey={dayKey}
          isSelected={selectedItemId === v.id}
          onSelect={onSelectVisit}
        />
      ))}
      {visibleTasks.map(t => (
        <WeekTaskItem
          key={`${t.id}--${techId}`}
          task={t}
          techId={techId}
          dayKey={dayKey}
          isSelected={selectedItemId === t.id}
          onSelect={onSelectTask}
        />
      ))}
      {overflow > 0 && (
        <p className="text-[9px] text-muted-foreground px-1">+{overflow} more</p>
      )}
    </div>
  );
}
