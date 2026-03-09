/**
 * DispatchUnscheduledCard — compact 2-line draggable unscheduled visit card.
 * Optimized for dense backlog display (20+ items).
 * Line 1: customerName — summary
 * Line 2: locationName . duration . #jobNumber
 */
import { useDraggable } from "@dnd-kit/core";
import type { DispatchVisit } from "./dispatchPreviewTypes";
import type { DispatchDragData } from "./dispatchDndTypes";
import { formatDuration, visitStatusDot, priorityIndicator } from "./dispatchPreviewUtils";
import { GripVertical, Loader2 } from "lucide-react";

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
    disabled: isSaving,
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
      } ${isDragging ? "opacity-40 shadow-lg" : ""} ${isSaving ? "opacity-60 pointer-events-none" : ""} ${isSelected ? "ring-2 ring-emerald-500" : ""} cursor-grab active:cursor-grabbing`}
    >
      {isSaving ? (
        <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-emerald-400" />
      ) : (
        <GripVertical className="h-3.5 w-3.5 flex-shrink-0 text-slate-300 group-hover:text-slate-400" />
      )}

      <div className="min-w-0 flex-1">
        {/* Line 1: client name (primary), priority indicator */}
        <div className="flex items-center gap-1 leading-tight">
          <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${visitStatusDot(visit.status)}`} />
          <span className="truncate text-[11px] font-semibold text-foreground">{visit.customerName}</span>
          {visit.priority !== "normal" && (
            <span className={`rounded px-1 py-px text-[8px] font-bold uppercase flex-shrink-0 ${
              visit.priority === "urgent" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
            }`}>{visit.priority === "urgent" ? "!" : "H"}</span>
          )}
        </div>
        {/* Line 2: summary (if present) */}
        {visit.summary && (
          <p className="truncate text-[10px] text-muted-foreground leading-tight mt-px pl-2.5">{visit.summary}</p>
        )}
        {/* Line 3: location · duration · #jobNumber (de-emphasized) */}
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground leading-tight mt-px pl-2.5">
          <span className="truncate">{visit.locationName}</span>
          <span className="text-slate-300 flex-shrink-0">&middot;</span>
          <span className="whitespace-nowrap flex-shrink-0 font-medium text-slate-500">{formatDuration(visit.durationMinutes)}</span>
          <span className="text-slate-300 flex-shrink-0">&middot;</span>
          <span className="text-slate-400 flex-shrink-0 text-[9px]">#{visit.jobNumber}</span>
        </div>
      </div>
    </div>
  );
}
