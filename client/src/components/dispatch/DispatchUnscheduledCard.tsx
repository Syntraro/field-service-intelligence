/**
 * DispatchUnscheduledCard — compact 2–3 line unscheduled visit card.
 * Draggable source for drag-and-drop scheduling onto the dispatch timeline.
 *
 * 2026-03-30: Optional selection mode props for DAY-VIEW-ONLY Focus workflow.
 * isChecked = selected for "Add to Focus" (checkbox tick, green highlight).
 * isFocused = already in Focus bar (subtle indicator, no checkbox interaction).
 * When isSelectionMode is true: click toggles selection, drag is disabled.
 * When isSelectionMode is false/absent: existing behavior is unchanged.
 */
import { useCallback } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { DispatchVisit } from "./dispatchPreviewTypes";
import type { DispatchDragData } from "./dispatchDndTypes";
import { priorityIndicator } from "./dispatchPreviewUtils";
import { VisitCardContent } from "./VisitCardContent";
import { GripVertical, Circle, CheckCircle2, ExternalLink } from "lucide-react";

type Props = {
  visit: DispatchVisit;
  isSaving?: boolean;
  isSelected?: boolean;
  onSelect?: (visit: DispatchVisit) => void;
  /** DAY-VIEW-ONLY: selection mode props — all optional */
  isSelectionMode?: boolean;
  /** True if this card is ticked for "Add to Focus" */
  isChecked?: boolean;
  /** True if this card is already in the Focus bar */
  isFocused?: boolean;
  onToggleSelect?: (visitId: string) => void;
};

export default function DispatchUnscheduledCard({ visit, isSaving, isSelected, onSelect, isSelectionMode, isChecked, isFocused, onToggleSelect }: Props) {
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
    disabled: !!isSelectionMode,
  });

  const priorityCls = priorityIndicator(visit.priority);

  // Click handler: selection mode toggles checkbox; normal mode opens visit
  const handleClick = useCallback(() => {
    if (isSelectionMode && onToggleSelect) {
      onToggleSelect(visit.id);
    } else {
      onSelect?.(visit);
    }
  }, [isSelectionMode, onToggleSelect, onSelect, visit]);

  // Details icon click in selection mode — opens modal without toggling selection
  const handleDetailsClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect?.(visit);
  }, [onSelect, visit]);

  return (
    <div
      ref={setNodeRef}
      {...(isSelectionMode ? {} : listeners)}
      {...(isSelectionMode ? {} : attributes)}
      data-dispatch-block="unscheduled-visit"
      onClick={handleClick}
      className={`group flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 transition-shadow hover:bg-slate-100 hover:shadow-sm ${
        priorityCls ? `border-l-[3px] ${priorityCls}` : ""
      } ${isDragging ? "opacity-40 shadow-lg" : ""} ${
        isSelectionMode && isChecked
          ? "ring-2 ring-blue-500 bg-blue-50 border-blue-300"
          : isSelected && !isSelectionMode ? "ring-2 ring-blue-500 bg-blue-50/50" : ""
      } ${isFocused && !isChecked ? "border-l-[3px] border-l-blue-600" : ""} ${isSelectionMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}`}
    >
      {/* Selection mode: check indicator on left */}
      {isSelectionMode ? (
        isChecked
          ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-blue-600" />
          : <Circle className="h-4 w-4 flex-shrink-0 text-slate-300" />
      ) : (
        <GripVertical className="h-3.5 w-3.5 flex-shrink-0 text-slate-300 group-hover:text-slate-400" />
      )}

      <VisitCardContent visit={visit} variant="unscheduled" />

      {/* Selection mode: details icon to open modal without selecting */}
      {isSelectionMode && visit.visitId && (
        <button
          onClick={handleDetailsClick}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          title="Open visit details"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
