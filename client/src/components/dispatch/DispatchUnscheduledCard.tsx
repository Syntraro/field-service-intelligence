/**
 * DispatchUnscheduledCard — compact 2–3 line unscheduled visit card.
 * Draggable source for drag-and-drop scheduling onto the dispatch timeline
 * or between queue bucket sections.
 */
import { useCallback, memo } from "react";
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

function DispatchUnscheduledCardImpl({ visit, isSaving, isSelected, onSelect }: Props) {
  const dragData: DispatchDragData = {
    type: "unscheduled-visit",
    visitId: visit.visitId ?? undefined,
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

  const handleClick = useCallback(() => {
    onSelect?.(visit);
  }, [onSelect, visit]);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-dispatch-block="unscheduled-visit"
      onClick={handleClick}
      className={`group flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 transition-shadow hover:bg-slate-100 hover:shadow-sm cursor-grab active:cursor-grabbing ${
        priorityCls ? `border-l-[3px] ${priorityCls}` : ""
      } ${isDragging ? "opacity-40 shadow-lg" : ""} ${
        isSelected ? "ring-2 ring-blue-500 bg-blue-50/50" : ""
      }`}
    >
      <GripVertical className="h-3.5 w-3.5 flex-shrink-0 text-slate-300 group-hover:text-slate-400" />
      <VisitCardContent visit={visit} variant="unscheduled" />
    </div>
  );
}

const DispatchUnscheduledCard = memo(DispatchUnscheduledCardImpl);
export default DispatchUnscheduledCard;
