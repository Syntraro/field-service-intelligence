/**
 * DispatchUnscheduledCard — compact 2–3 line unscheduled visit card.
 * Draggable source for drag-and-drop scheduling onto the dispatch timeline.
 */
import { useDraggable } from "@dnd-kit/core";
import type { DispatchVisit } from "./dispatchPreviewTypes";
import type { DispatchDragData } from "./dispatchDndTypes";
import { priorityIndicator } from "./dispatchPreviewUtils";
import { VisitCardContent } from "./VisitCardContent";
import { GripVertical } from "lucide-react";

type Props = {
  visit: DispatchVisit;
  isSaving?: boolean;
  isSelected?: boolean;
  onSelect?: (visit: DispatchVisit) => void;
};

export default function DispatchUnscheduledCard({ visit, isSaving, isSelected, onSelect }: Props) {
  const dragData: DispatchDragData = {
    type: "unscheduled-visit",
    visitId: visit.id,
    jobId: visit.jobId,
    jobNumber: visit.jobNumber,
    technicianId: null,
    durationMinutes: visit.durationMinutes,
    version: visit.version,
    isMultiTech: false,
    originalStart: null,
  };

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `unscheduled-${visit.id}`,
    data: dragData,
  });

  const priorityCls = priorityIndicator(visit.priority);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-dispatch-block="unscheduled-visit"
      onClick={() => onSelect?.(visit)}
      className={`group flex items-center gap-1 rounded border bg-white px-1.5 py-1 transition-shadow hover:shadow-sm ${
        priorityCls ? `border-l-[3px] ${priorityCls}` : ""
      } ${isDragging ? "opacity-40 shadow-lg" : ""} ${isSelected ? "ring-2 ring-emerald-500 bg-emerald-50/50" : ""} cursor-grab active:cursor-grabbing`}
    >
      <GripVertical className="h-3.5 w-3.5 flex-shrink-0 text-slate-300 group-hover:text-slate-400" />

      <VisitCardContent visit={visit} variant="unscheduled" />
    </div>
  );
}
