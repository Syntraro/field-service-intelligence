/**
 * DispatchBoard (DispatchPreview.tsx)
 * Primary dispatch board with Day and Week views, drag/drop scheduling,
 * overlap prevention, task parity, and structured detail panel.
 * Route: /dispatch (primary), /calendar (alias)
 */
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { addDays, subDays, addWeeks, subWeeks, startOfDay, startOfWeek, endOfWeek, eachDayOfInterval, addMinutes, format } from "date-fns";
import { AlertCircle, Loader2, CalendarPlus, ClipboardList, Truck } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";

import type { VisitStatus, DispatchVisit, DispatchTask, Technician } from "@/components/dispatch/dispatchPreviewTypes";
import { VISIT_STATUS_OPTIONS, UNASSIGNED_TECH_ID } from "@/components/dispatch/dispatchPreviewTypes";
import type { DispatchDragData, DispatchDropData } from "@/components/dispatch/dispatchDndTypes";
import { useDispatchPreviewData } from "@/components/dispatch/useDispatchPreviewData";
import { useDispatchWeekData } from "@/components/dispatch/useDispatchWeekData";
import { useDispatchPreviewMutations } from "@/components/dispatch/useDispatchPreviewMutations";
import {
  TIMELINE_START_HOUR, TIMELINE_END_HOUR, HOUR_WIDTH_PX, TIMELINE_HOURS, SNAP_MINUTES, PX_PER_MINUTE,
  getTimelineConfig,
} from "@/components/dispatch/dispatchPreviewUtils";
import { checkOverlap, findNearestValidSlot } from "@/components/dispatch/dispatchOverlapUtils";
import { useTechnicianWorkingHours, isTechWorkingOnDate, isTechWorkingInRange } from "@/hooks/useTechnicianWorkingHours";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

import DispatchBoardHeader, { type DispatchView } from "@/components/dispatch/DispatchBoardHeader";
import DispatchFiltersBar from "@/components/dispatch/DispatchFiltersBar";
import DispatchTechnicianSidebar from "@/components/dispatch/DispatchTechnicianSidebar";
import DispatchTimeline from "@/components/dispatch/DispatchTimeline";
import DispatchUnscheduledPanel from "@/components/dispatch/DispatchUnscheduledPanel";
import DispatchDetailPanel from "@/components/dispatch/DispatchDetailPanel";
import DispatchDragPreview from "@/components/dispatch/DispatchDragPreview";
import WeekDispatchGrid from "@/components/dispatch/WeekDispatchGrid";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";
import { TaskDialog } from "@/components/TaskDialog";

/** Compute scheduled start ISO string from pixel position within the timeline.
 *  Item 4: Parameterized for 24h mode — accepts dynamic startHour and total hours. */
function computeDropTime(
  dropClientX: number,
  timelineRect: DOMRect,
  scrollLeft: number,
  selectedDate: Date,
  startHour = TIMELINE_START_HOUR,
  totalHours = TIMELINE_HOURS.length,
): string {
  const relativeX = dropClientX - timelineRect.left + scrollLeft;
  const totalMinutesFromStart = (relativeX / HOUR_WIDTH_PX) * 60;
  const snappedMinutes = Math.round(totalMinutesFromStart / SNAP_MINUTES) * SNAP_MINUTES;
  const clampedMinutes = Math.max(0, Math.min(snappedMinutes, totalHours * 60 - SNAP_MINUTES));
  const absoluteMinutes = startHour * 60 + clampedMinutes;
  const day = startOfDay(selectedDate);
  return addMinutes(day, absoluteMinutes).toISOString();
}

/** Convert pixel X in timeline to snapped minutes from midnight.
 *  Item 4: Parameterized for 24h mode. */
function pxToSnappedMinutes(relativeX: number, startHour = TIMELINE_START_HOUR, endHour = TIMELINE_END_HOUR): number {
  const totalMinutesFromStart = (relativeX / HOUR_WIDTH_PX) * 60;
  const snapped = Math.round(totalMinutesFromStart / SNAP_MINUTES) * SNAP_MINUTES;
  const timelineMax = (endHour - startHour) * 60;
  return startHour * 60 + Math.max(0, Math.min(snapped, timelineMax - SNAP_MINUTES));
}

export default function DispatchPreview() {
  const { toast } = useToast();

  // ── View mode ──
  const [activeView, setActiveView] = useState<DispatchView>("day");

  // ── Item 7: 24-hour timeline toggle ──
  const [show24Hour, setShow24Hour] = useState(false);
  const onToggle24Hour = useCallback(() => setShow24Hour(prev => !prev), []);

  // Item 4: Dynamic timeline config from 24h toggle
  const tlConfig = useMemo(() => getTimelineConfig(show24Hour), [show24Hour]);

  // ── Date nav ──
  const [selectedDate, setSelectedDate] = useState(new Date());

  const onPrevDay = useCallback(() => {
    setSelectedDate(d => activeView === "week" ? subWeeks(d, 1) : subDays(d, 1));
  }, [activeView]);
  const onNextDay = useCallback(() => {
    setSelectedDate(d => activeView === "week" ? addWeeks(d, 1) : addDays(d, 1));
  }, [activeView]);
  const onToday = useCallback(() => setSelectedDate(new Date()), []);

  // ── Real data from backend (Day view) ──
  const dayData = useDispatchPreviewData(selectedDate);

  // ── Week data (Week view) ──
  const weekData = useDispatchWeekData(selectedDate);

  // ── Working hours for technician on-shift/off-shift grouping ──
  const { scheduleMap } = useTechnicianWorkingHours();

  // Enrich technicians with isWorking flag based on current view context
  const rawTechnicians = activeView === "week" ? weekData.technicians : dayData.technicians;
  const technicians: Technician[] = useMemo(() => {
    if (activeView === "week") {
      const ws = startOfWeek(selectedDate, { weekStartsOn: 1 });
      const we = endOfWeek(selectedDate, { weekStartsOn: 1 });
      const days = eachDayOfInterval({ start: ws, end: we });
      return rawTechnicians.map(t => ({
        ...t,
        isWorking: isTechWorkingInRange(scheduleMap, t.id, days),
      }));
    }
    return rawTechnicians.map(t => ({
      ...t,
      isWorking: isTechWorkingOnDate(scheduleMap, t.id, selectedDate),
    }));
  }, [rawTechnicians, scheduleMap, selectedDate, activeView]);

  // Sort technicians: working first, then off-shift (stable sort preserves original order within groups)
  const sortedTechnicians = useMemo(() => {
    return [...technicians].sort((a, b) => {
      const aWorking = a.isWorking !== false ? 0 : 1;
      const bWorking = b.isWorking !== false ? 0 : 1;
      return aWorking - bWorking;
    });
  }, [technicians]);

  // ── Off-shift assignment confirmation dialog ──
  const [offShiftConfirm, setOffShiftConfirm] = useState<{
    action: () => void;
    techName: string;
    /** Number of off-shift techs (for plural wording) */
    count?: number;
  } | null>(null);

  // Use day or week data depending on active view for shared state
  // (technicians already computed above with isWorking enrichment)
  const scheduledVisits = activeView === "week" ? weekData.scheduledVisits : dayData.scheduledVisits;
  const unscheduledVisits = activeView === "week" ? weekData.unscheduledVisits : dayData.unscheduledVisits;
  const scheduledTasks = activeView === "week" ? weekData.scheduledTasks : dayData.scheduledTasks;
  const isLoading = activeView === "week" ? weekData.isLoading : dayData.isLoading;
  const error = activeView === "week" ? weekData.error : dayData.error;

  // ── Mutations ──
  const { scheduleVisit, rescheduleVisit, unscheduleVisit, resizeVisit, rescheduleTask, completeTask, reopenTask, deleteTask, updateVisitCrew, updateVisitStatus, deleteVisit, savingIds } =
    useDispatchPreviewMutations();

  // ── Timeline scroll ref (for computing drop positions) ──
  const timelineScrollRef = useRef<HTMLDivElement>(null);

  // ── DnD state ──
  const [activeDragData, setActiveDragData] = useState<DispatchDragData | null>(null);
  const [dragPointerX, setDragPointerX] = useState<number>(0);
  const [activeOverTechId, setActiveOverTechId] = useState<string | null>(null);
  // Fix 1: Origin lane locking — prevent visit jumping to adjacent lane on drag start
  const originLaneRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);
  // BUG 2 fix: Capture grab offset (cursor-to-element-corner) for DragOverlay alignment
  const dragGrabOffsetRef = useRef<{ x: number; y: number }>({ x: 10, y: 10 });
  // Item 1: Grab X offset within the block — used to align preview/drop to block's left edge
  const dragGrabBlockXRef = useRef(0);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // ── Technician multi-select filter (shared Day/Week) ──
  const [selectedTechIds, setSelectedTechIds] = useState<Set<string>>(new Set());
  const [hasInitialized, setHasInitialized] = useState(false);
  useEffect(() => {
    if (!hasInitialized && technicians.length > 0) {
      setSelectedTechIds(new Set(technicians.map(t => t.id)));
      setHasInitialized(true);
    }
  }, [technicians, hasInitialized]);

  const onTechToggle = useCallback((id: string) => {
    setSelectedTechIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);
  const onTechSelectAll = useCallback(
    () => setSelectedTechIds(new Set(technicians.map(t => t.id))),
    [technicians],
  );
  const onTechClearAll = useCallback(() => setSelectedTechIds(new Set()), []);

  // ── Visit status multi-select filter (shared Day/Week) ──
  const [selectedStatuses, setSelectedStatuses] = useState<Set<VisitStatus>>(
    () => new Set(VISIT_STATUS_OPTIONS.map(o => o.value)),
  );
  const onStatusToggle = useCallback((s: VisitStatus) => {
    setSelectedStatuses(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }, []);

  // ── Hide weekends toggle (Week view) ──
  const [hideWeekends, setHideWeekends] = useState(false);
  const onToggleHideWeekends = useCallback(() => setHideWeekends(h => !h), []);

  // ── Derived data (Day view) ──
  const allVisits = useMemo(() => [...scheduledVisits, ...unscheduledVisits], [scheduledVisits, unscheduledVisits]);

  const unassignedScheduled = useMemo(
    () => scheduledVisits.filter(v => !v.technicianId && selectedStatuses.has(v.status)),
    [scheduledVisits, selectedStatuses],
  );

  const visibleTechs = useMemo(() => {
    const filtered = sortedTechnicians.filter(t => selectedTechIds.has(t.id));
    if (unassignedScheduled.length > 0) {
      filtered.push({
        id: UNASSIGNED_TECH_ID,
        name: "Unassigned",
        initials: "??",
        color: "#94a3b8",
        status: "off",
      });
    }
    return filtered;
  }, [sortedTechnicians, selectedTechIds, unassignedScheduled.length]);

  /** Multi-tech: place each visit in every assigned technician's lane */
  const visitsByTech = useMemo(() => {
    const map = new Map<string, DispatchVisit[]>();
    for (const t of visibleTechs) map.set(t.id, []);
    for (const v of scheduledVisits) {
      if (!selectedStatuses.has(v.status)) continue;
      const techIds = v.technicianIds.length > 0 ? v.technicianIds : (v.technicianId ? [v.technicianId] : []);
      if (techIds.length === 0) {
        const arr = map.get(UNASSIGNED_TECH_ID);
        if (arr) arr.push(v);
        continue;
      }
      for (const tid of techIds) {
        if (!selectedTechIds.has(tid)) continue;
        const arr = map.get(tid);
        if (arr) arr.push(v);
      }
    }
    return map;
  }, [visibleTechs, scheduledVisits, selectedTechIds, selectedStatuses]);

  const tasksByTech = useMemo(() => {
    const map = new Map<string, DispatchTask[]>();
    for (const t of visibleTechs) map.set(t.id, []);
    for (const task of scheduledTasks) {
      if (!task.assignedToUserId) continue;
      const arr = map.get(task.assignedToUserId);
      if (arr) arr.push(task);
    }
    return map;
  }, [visibleTechs, scheduledTasks]);

  // Any Time capacity warning — soft limit at 3 per technician/day
  const ANY_TIME_WARN_THRESHOLD = 3;
  /** Count allDay visits for a technician on the current dispatch day, excluding a specific visit */
  const countAnyTimeVisits = useCallback((techId: string, excludeVisitId?: string): number => {
    const techVisits = visitsByTech.get(techId) ?? [];
    return techVisits.filter(v => v.isAllDay && v.id !== excludeVisitId).length;
  }, [visitsByTech]);

  /** Show a warning toast if adding/converting to Any Time would exceed threshold */
  const warnIfAnyTimeOverloaded = useCallback((techId: string, excludeVisitId?: string) => {
    const count = countAnyTimeVisits(techId, excludeVisitId);
    if (count >= ANY_TIME_WARN_THRESHOLD) {
      toast({
        title: "Any Time capacity",
        description: `This technician already has ${count} Any Time visits today. Consider scheduling a specific time.`,
      });
    }
  }, [countAnyTimeVisits, toast]);

  // ── Week view: filter weekDays and data by hideWeekends + tech/status filters ──
  const filteredWeekDays = useMemo(() => {
    if (!hideWeekends) return weekData.weekDays;
    return weekData.weekDays.filter(d => d.getDay() !== 0 && d.getDay() !== 6);
  }, [weekData.weekDays, hideWeekends]);

  const filteredWeekVisits = useMemo(() => {
    const map = new Map<string, Map<string, DispatchVisit[]>>();
    Array.from(weekData.visitsByTechByDay.entries()).forEach(([techId, dayMap]) => {
      if (!selectedTechIds.has(techId)) return;
      const filteredDayMap = new Map<string, DispatchVisit[]>();
      Array.from(dayMap.entries()).forEach(([dayKey, visits]) => {
        filteredDayMap.set(dayKey, visits.filter(v => selectedStatuses.has(v.status)));
      });
      map.set(techId, filteredDayMap);
    });
    return map;
  }, [weekData.visitsByTechByDay, selectedTechIds, selectedStatuses]);

  const filteredWeekTasks = useMemo(() => {
    const map = new Map<string, Map<string, DispatchTask[]>>();
    Array.from(weekData.tasksByTechByDay.entries()).forEach(([techId, dayMap]) => {
      if (!selectedTechIds.has(techId)) return;
      map.set(techId, dayMap);
    });
    return map;
  }, [weekData.tasksByTechByDay, selectedTechIds]);

  const weekVisibleTechs = useMemo(
    () => sortedTechnicians.filter(t => selectedTechIds.has(t.id)),
    [sortedTechnicians, selectedTechIds],
  );

  // ── Overlap detection for drag preview ──
  // Item 1: Subtract grab offset so overlap detection matches preview position
  const dragHasOverlap = useMemo(() => {
    if (!activeDragData || !activeOverTechId || activeOverTechId === UNASSIGNED_TECH_ID) return false;
    const scrollEl = timelineScrollRef.current;
    if (!scrollEl) return false;

    const relativeX = dragPointerX - scrollEl.getBoundingClientRect().left + scrollEl.scrollLeft - dragGrabBlockXRef.current;
    const startMinutes = pxToSnappedMinutes(relativeX, tlConfig.startHour, tlConfig.endHour);
    const endMinutes = startMinutes + activeDragData.durationMinutes;

    const laneVisits = visitsByTech.get(activeOverTechId) ?? [];
    // Fix 2: Include tasks in overlap detection
    const laneTasks = tasksByTech.get(activeOverTechId) ?? [];
    return checkOverlap(startMinutes, endMinutes, laneVisits, activeDragData.visitId, laneTasks);
  }, [activeDragData, activeOverTechId, dragPointerX, visitsByTech, tasksByTech, tlConfig]);

  // ── DnD handlers ──
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as DispatchDragData | undefined;
    if (data) {
      setActiveDragData(data);
      // Fix 1: Capture origin lane so item doesn't jump on drag start
      originLaneRef.current = data.technicianId ?? null;
      isDraggingRef.current = true;

      // BUG 2 fix: Capture pointer-to-element-corner offset for DragOverlay alignment.
      // dnd-kit positions DragOverlay at elementPosition + delta, so the overlay's left edge
      // is offset from the cursor by the grab point. Compensating in the overlay transform
      // ensures the ghost stays anchored near the cursor regardless of where the card was grabbed.
      const pointerEvent = event.activatorEvent as PointerEvent | undefined;
      const target = pointerEvent?.target as HTMLElement | undefined;
      const dragEl = target?.closest("[data-dispatch-block]") as HTMLElement | null;
      if (pointerEvent && dragEl) {
        const rect = dragEl.getBoundingClientRect();
        dragGrabOffsetRef.current = {
          x: pointerEvent.clientX - rect.left,
          y: pointerEvent.clientY - rect.top,
        };
        // Item 1: Capture grab X offset within the block for preview/drop alignment
        dragGrabBlockXRef.current = pointerEvent.clientX - rect.left;
      } else {
        dragGrabOffsetRef.current = { x: 10, y: 10 };
        dragGrabBlockXRef.current = 0;
      }
    }
  }, []);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const activatorEvent = event.activatorEvent as PointerEvent | undefined;
    if (activatorEvent) {
      setDragPointerX(activatorEvent.clientX + (event.delta?.x ?? 0));
    }
    const overData = event.over?.data.current as DispatchDropData | undefined;
    // Fix 1: Use detected lane if available, fall back to origin lane
    const detectedLane = overData?.technicianId ?? null;
    setActiveOverTechId(detectedLane ?? originLaneRef.current);

    // Goal 4: Auto-scroll timeline when pointer nears edges
    const scrollEl = timelineScrollRef.current;
    if (!scrollEl || !activatorEvent) return;
    const pointerX = activatorEvent.clientX + (event.delta?.x ?? 0);
    const pointerY = activatorEvent.clientY + (event.delta?.y ?? 0);
    const rect = scrollEl.getBoundingClientRect();
    const EDGE_PX = 60;
    const MAX_SPEED = 12;
    let dx = 0;
    let dy = 0;
    // Horizontal auto-scroll
    if (pointerX < rect.left + EDGE_PX) {
      dx = -MAX_SPEED * (1 - (pointerX - rect.left) / EDGE_PX);
    } else if (pointerX > rect.right - EDGE_PX) {
      dx = MAX_SPEED * (1 - (rect.right - pointerX) / EDGE_PX);
    }
    // Vertical auto-scroll
    if (pointerY < rect.top + EDGE_PX) {
      dy = -MAX_SPEED * (1 - (pointerY - rect.top) / EDGE_PX);
    } else if (pointerY > rect.bottom - EDGE_PX) {
      dy = MAX_SPEED * (1 - (rect.bottom - pointerY) / EDGE_PX);
    }
    if (dx !== 0 || dy !== 0) {
      scrollEl.scrollLeft += dx;
      scrollEl.scrollTop += dy;
    }
  }, []);

  /** Unified drag end handler for both day view (pixel-based) and week view (cell-based) drops */
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const dragData = activeDragData;
    setActiveDragData(null);
    setActiveOverTechId(null);
    originLaneRef.current = null;
    isDraggingRef.current = false;

    const { over } = event;
    if (!over || !dragData) return;

    const dropData = over.data.current as DispatchDropData | undefined;
    if (!dropData?.technicianId || dropData.technicianId === UNASSIGNED_TECH_ID) return;

    // ── Week view drop (cell-based: dayKey present) ──
    if (dropData.dayKey) {
      // Preserve original time-of-day, change date to target dayKey
      const originalStart = dragData.originalStart ? new Date(dragData.originalStart) : null;
      const timeH = originalStart ? originalStart.getHours() : 9;
      const timeM = originalStart ? originalStart.getMinutes() : 0;
      const [y, m, d] = dropData.dayKey.split("-").map(Number);
      const newDay = new Date(y, m - 1, d, timeH, timeM, 0, 0);
      const startAt = newDay.toISOString();
      const endAt = addMinutes(newDay, dragData.durationMinutes).toISOString();

      // Stabilization: version resolved internally by mutations from fresh cache
      const executeMutation = () => {
        if (dragData.type === "scheduled-task") {
          rescheduleTask({
            taskId: dragData.visitId,
            scheduledStartAt: startAt,
            scheduledEndAt: endAt,
            assignedToUserId: dropData.technicianId,
          });
        } else if (dragData.type === "unscheduled-visit") {
          scheduleVisit({
            jobId: dragData.jobId,
            visitId: dragData.visitId,
            technicianUserId: dropData.technicianId,
            startAt,
            endAt,
          });
        } else if (dragData.type === "scheduled-visit") {
          if (dragData.isMultiTech) {
            // Multi-tech: allow time reschedule, block crew reassignment
            const visit = allVisits.find(v => v.id === dragData.visitId);
            const assignedIds = visit?.technicianIds ?? [];
            if (!assignedIds.includes(dropData.technicianId)) {
              toast({
                title: "Multi-tech visit",
                description: "Change crew assignments from the visit detail panel.",
              });
              return;
            }
            rescheduleVisit({ visitId: dragData.visitId, jobId: dragData.jobId, startAt, endAt });
          } else {
            const techChanged = dragData.technicianId !== dropData.technicianId;
            rescheduleVisit({
              visitId: dragData.visitId,
              jobId: dragData.jobId,
              technicianUserId: techChanged ? dropData.technicianId : undefined,
              startAt,
              endAt,
            });
          }
        }
      };

      // Off-shift check for week view drop target
      const targetTech = sortedTechnicians.find(t => t.id === dropData.technicianId);
      const targetDate = new Date(y, m - 1, d);
      const isOffShiftOnDay = targetTech && !isTechWorkingOnDate(scheduleMap, targetTech.id, targetDate);
      if (isOffShiftOnDay && targetTech) {
        setOffShiftConfirm({ action: executeMutation, techName: targetTech.name });
      } else {
        executeMutation();
      }
      return;
    }

    // ── Day view drop (pixel-based) ──
    const scrollEl = timelineScrollRef.current;
    if (!scrollEl) return;

    const timelineRect = scrollEl.getBoundingClientRect();
    const scrollLeft = scrollEl.scrollLeft;
    const activatorEvent = event.activatorEvent as PointerEvent | undefined;
    if (!activatorEvent) return;

    // Item 1: Subtract grab offset so drop position matches the block's left edge, not cursor
    const finalX = activatorEvent.clientX + (event.delta?.x ?? 0);
    const relativeX = finalX - timelineRect.left + scrollLeft - dragGrabBlockXRef.current;
    const proposedStartMinutes = pxToSnappedMinutes(relativeX, tlConfig.startHour, tlConfig.endHour);
    const laneVisits = visitsByTech.get(dropData.technicianId) ?? [];
    const laneTasks = tasksByTech.get(dropData.technicianId) ?? [];
    const validStartMinutes = findNearestValidSlot(
      proposedStartMinutes,
      dragData.durationMinutes,
      laneVisits,
      dragData.visitId,
      SNAP_MINUTES,
      tlConfig.startHour,
      tlConfig.endHour,
      laneTasks,
    );
    if (validStartMinutes === null) return;

    const day = startOfDay(selectedDate);
    const startAt = addMinutes(day, validStartMinutes).toISOString();
    const endAt = addMinutes(new Date(startAt), dragData.durationMinutes).toISOString();

    // Stabilization: version resolved internally by mutations from fresh cache
    const executeMutation = () => {
      if (dragData.type === "scheduled-task") {
        rescheduleTask({
          taskId: dragData.visitId,
          scheduledStartAt: startAt,
          scheduledEndAt: endAt,
          assignedToUserId: dropData.technicianId,
        });
      } else if (dragData.type === "unscheduled-visit") {
        scheduleVisit({
          jobId: dragData.jobId,
          visitId: dragData.visitId,
          technicianUserId: dropData.technicianId,
          startAt,
          endAt,
        });
      } else if (dragData.type === "scheduled-visit") {
        if (dragData.isMultiTech) {
          // Multi-tech: allow time reschedule (all mirrors move together).
          // Block only if target lane is NOT one of the assigned techs (= crew reassignment attempt).
          const visit = allVisits.find(v => v.id === dragData.visitId);
          const assignedIds = visit?.technicianIds ?? [];
          const targetIsAssigned = assignedIds.includes(dropData.technicianId);
          if (!targetIsAssigned) {
            toast({
              title: "Multi-tech visit",
              description: "Change crew assignments from the visit detail panel.",
            });
            return;
          }
          // Time-only reschedule — no tech change
          rescheduleVisit({
            visitId: dragData.visitId,
            jobId: dragData.jobId,
            startAt,
            endAt,
          });
        } else {
          const techChanged = dragData.technicianId !== dropData.technicianId;
          rescheduleVisit({
            visitId: dragData.visitId,
            jobId: dragData.jobId,
            technicianUserId: techChanged ? dropData.technicianId : undefined,
            startAt,
            endAt,
          });
        }
      }
    };

    const targetTech = sortedTechnicians.find(t => t.id === dropData.technicianId);
    if (targetTech && targetTech.isWorking === false) {
      setOffShiftConfirm({ action: executeMutation, techName: targetTech.name });
    } else {
      executeMutation();
    }
  }, [activeDragData, selectedDate, scheduleVisit, rescheduleVisit, rescheduleTask, visitsByTech, tasksByTech, sortedTechnicians, scheduleMap, tlConfig, allVisits]);

  // ── Unschedule handler ──
  // Stabilization: version resolved internally by mutation from fresh cache
  const handleUnschedule = useCallback((visit: DispatchVisit) => {
    unscheduleVisit({ visitId: visit.id, jobId: visit.jobId });
  }, [unscheduleVisit]);

  // ── Item 4: Schedule from detail panel (for unscheduled visits) ──
  // Item 2: Supports multi-tech — schedules with primary tech, then updates crew if additional techs
  const handleScheduleFromPanel = useCallback((visit: DispatchVisit, startAt: string, endAt: string, techId: string, additionalTechIds?: string[]) => {
    scheduleVisit({
      jobId: visit.jobId,
      visitId: visit.id,
      technicianUserId: techId,
      startAt,
      endAt,
    });
    // If additional technicians selected, update crew after a short delay to let schedule complete
    if (additionalTechIds && additionalTechIds.length > 0) {
      setTimeout(() => {
        updateVisitCrew({
          visitId: visit.id,
          technicianUserIds: [techId, ...additionalTechIds],
        });
      }, 800);
    }
  }, [scheduleVisit, updateVisitCrew]);

  // ── Visit status change handler (complete / reopen) ──
  const handleUpdateStatus = useCallback((visit: DispatchVisit, status: string) => {
    updateVisitStatus({ visitId: visit.id, jobId: visit.jobId, status });
  }, [updateVisitStatus]);

  // ── Resize handlers ──
  const handleResize = useCallback((visit: DispatchVisit, newEndTime: string) => {
    resizeVisit({
      visitId: visit.id,
      jobId: visit.jobId,
      scheduledStart: visit.scheduledStart ?? "",
      scheduledEnd: visit.scheduledEnd ?? "",
      newEndTime,
    });
  }, [resizeVisit]);

  // ── Item 8: Task lifecycle handlers ──
  const handleCompleteTask = useCallback((task: DispatchTask) => {
    completeTask(task.id);
  }, [completeTask]);

  const handleReopenTask = useCallback((task: DispatchTask) => {
    reopenTask(task.id);
  }, [reopenTask]);

  const handleDeleteTask = useCallback((task: DispatchTask) => {
    deleteTask(task.id);
    setSelectedTaskId(null);
    setSelectedVisitId(null);
  }, [deleteTask]);

  const handleResizeTask = useCallback((task: DispatchTask, newEndTime: string) => {
    if (!task.scheduledStart) return;
    rescheduleTask({
      taskId: task.id,
      scheduledStartAt: task.scheduledStart,
      scheduledEndAt: newEndTime,
    });
  }, [rescheduleTask]);

  // ── Reschedule from detail panel (with off-shift confirmation) ──
  // Stabilization: version resolved internally by mutation from fresh cache
  const handleRescheduleFromPanel = useCallback((visit: DispatchVisit, newStart: string, newEnd: string, techId?: string, allDay?: boolean) => {
    const executeMutation = () => {
      rescheduleVisit({
        visitId: visit.id,
        jobId: visit.jobId,
        technicianUserId: techId ?? undefined,
        startAt: newStart,
        endAt: newEnd,
        allDay,
      });
    };

    // Any Time capacity warning: warn if converting to allDay and tech already has >= threshold
    if (allDay && !visit.isAllDay) {
      const effectiveTechId = techId ?? visit.technicianId;
      if (effectiveTechId) warnIfAnyTimeOverloaded(effectiveTechId, visit.id);
    }

    // Check if reassigning to an off-shift technician
    if (techId) {
      const targetTech = sortedTechnicians.find(t => t.id === techId);
      if (targetTech && targetTech.isWorking === false) {
        setOffShiftConfirm({ action: executeMutation, techName: targetTech.name });
        return;
      }
    }
    executeMutation();
  }, [rescheduleVisit, sortedTechnicians, warnIfAnyTimeOverloaded]);

  // ── Reschedule task from detail panel (with off-shift confirmation) ──
  const handleRescheduleTaskFromPanel = useCallback((task: DispatchTask, newStart: string, newEnd: string, techId?: string) => {
    const executeMutation = () => {
      rescheduleTask({
        taskId: task.id,
        scheduledStartAt: newStart,
        scheduledEndAt: newEnd,
        assignedToUserId: techId ?? task.assignedToUserId ?? undefined,
      });
    };

    // Check if reassigning to an off-shift technician
    const targetId = techId ?? task.assignedToUserId;
    if (targetId) {
      const targetTech = sortedTechnicians.find(t => t.id === targetId);
      if (targetTech && targetTech.isWorking === false) {
        setOffShiftConfirm({ action: executeMutation, techName: targetTech.name });
        return;
      }
    }
    executeMutation();
  }, [rescheduleTask, sortedTechnicians]);

  // ── Crew update from detail panel (with off-shift confirmation) ──
  // Stabilization: version resolved internally by mutation from fresh cache
  const handleUpdateCrew = useCallback((visit: DispatchVisit, technicianIds: string[]) => {
    const executeMutation = () => {
      updateVisitCrew({
        visitId: visit.id,
        technicianUserIds: technicianIds,
      });
    };

    // Check if any newly-added technician is off-shift
    const currentIds = new Set(visit.technicianIds);
    const newlyAdded = technicianIds.filter(id => !currentIds.has(id));
    const offShiftNew = newlyAdded.filter(id => {
      const tech = sortedTechnicians.find(t => t.id === id);
      return tech && tech.isWorking === false;
    });

    if (offShiftNew.length > 0) {
      const names = offShiftNew.map(id => sortedTechnicians.find(t => t.id === id)?.name ?? id).join(", ");
      setOffShiftConfirm({ action: executeMutation, techName: names, count: offShiftNew.length });
    } else {
      executeMutation();
    }
  }, [updateVisitCrew, sortedTechnicians]);

  // ── Item 6: Quick-create from empty slot click ──
  const [quickCreate, setQuickCreate] = useState<{ techId: string; minuteOfDay: number } | null>(null);
  const [quickCreateJobOpen, setQuickCreateJobOpen] = useState(false);
  const [quickCreateJobSchedule, setQuickCreateJobSchedule] = useState<{
    date?: Date; time?: string; durationMinutes?: number; primaryTechnicianId?: string;
  } | undefined>(undefined);
  // Task quick-create via TaskDialog modal (replaces inline apiRequest)
  const [quickCreateTaskOpen, setQuickCreateTaskOpen] = useState(false);
  const [quickCreateTaskPrefill, setQuickCreateTaskPrefill] = useState<{
    assignedToUserId?: string; startDate?: string; startTime?: string; taskType?: "GENERAL" | "SUPPLIER_VISIT";
  } | undefined>(undefined);
  const handleEmptySlotClick = useCallback((techId: string, minuteOfDay: number) => {
    // Guard: block quick-create from the unassigned lane — no valid tech to assign to
    if (techId === UNASSIGNED_TECH_ID) {
      toast({ title: "Choose a technician lane", description: "Quick-create requires a specific technician lane." });
      return;
    }
    setQuickCreate({ techId, minuteOfDay });
  }, [toast]);

  // ── Selection (detail panel) — supports both visits and tasks ──
  // Fix 5: Ref for detecting clicks outside the detail panel
  const panelRef = useRef<HTMLDivElement>(null);
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const handleSelectVisit = useCallback((visit: DispatchVisit) => {
    setSelectedTaskId(null);
    setSelectedVisitId(prev => prev === visit.id ? null : visit.id);
  }, []);

  const handleSelectTask = useCallback((task: DispatchTask) => {
    setSelectedVisitId(null);
    setSelectedTaskId(prev => prev === task.id ? null : task.id);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedVisitId(null);
    setSelectedTaskId(null);
  }, []);

  // ── Visit delete handler (needs handleCloseDetail) ──
  const handleDeleteVisit = useCallback((visit: DispatchVisit) => {
    deleteVisit({ visitId: visit.id, jobId: visit.jobId });
    handleCloseDetail();
  }, [deleteVisit, handleCloseDetail]);

  const selectedVisit = useMemo(
    () => selectedVisitId ? allVisits.find(v => v.id === selectedVisitId) ?? null : null,
    [selectedVisitId, allVisits],
  );
  const selectedTask = useMemo(
    () => selectedTaskId ? scheduledTasks.find(t => t.id === selectedTaskId) ?? null : null,
    [selectedTaskId, scheduledTasks],
  );

  // Clear selection if item disappears — debounced to survive transient refetch gaps
  // (e.g., crew change causes brief period where visit is not yet in the refreshed data)
  const selectionClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (selectedVisitId && !selectedVisit) {
      selectionClearTimerRef.current = setTimeout(() => setSelectedVisitId(null), 1500);
    } else if (selectionClearTimerRef.current) {
      clearTimeout(selectionClearTimerRef.current);
      selectionClearTimerRef.current = null;
    }
    return () => { if (selectionClearTimerRef.current) clearTimeout(selectionClearTimerRef.current); };
  }, [selectedVisitId, selectedVisit]);
  const taskClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (selectedTaskId && !selectedTask) {
      taskClearTimerRef.current = setTimeout(() => setSelectedTaskId(null), 1500);
    } else if (taskClearTimerRef.current) {
      clearTimeout(taskClearTimerRef.current);
      taskClearTimerRef.current = null;
    }
    return () => { if (taskClearTimerRef.current) clearTimeout(taskClearTimerRef.current); };
  }, [selectedTaskId, selectedTask]);

  // Fix 5: Close detail panel when clicking outside (but not during drag/resize)
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      // Don't close during drag or resize operations
      if (isDraggingRef.current) return;
      // Only close if panel is open and click is outside
      if (!selectedVisitId && !selectedTaskId) return;
      if (panelRef.current && panelRef.current.contains(e.target as Node)) return;
      // Dispatcher-polish: use data attribute as primary selector (resilient to CSS class changes)
      const target = e.target as HTMLElement;
      if (target.closest("[data-dispatch-block]")) return;
      // Panel popover guard: Radix popovers (crew picker, date picker) and
      // selects (duration, time, technician) render in portals outside the panel
      // DOM tree. Clicks inside these portals must NOT close the detail panel.
      if (target.closest("[data-radix-popper-content-wrapper]")) return;
      if (target.closest("[data-radix-select-viewport]")) return;
      if (target.closest("[role='listbox']")) return;
      setSelectedVisitId(null);
      setSelectedTaskId(null);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [selectedVisitId, selectedTaskId]);

  // ── Drag preview node for the active lane ──
  // Item 1: Subtract grab X offset so preview shows where block's LEFT edge will land
  const dragPreviewNode = useMemo(() => {
    if (!activeDragData || !activeOverTechId) return null;
    const scrollEl = timelineScrollRef.current;
    if (!scrollEl) return null;
    const relativeX = dragPointerX - scrollEl.getBoundingClientRect().left + scrollEl.scrollLeft - dragGrabBlockXRef.current;
    return (
      <DispatchDragPreview
        pointerX={relativeX}
        durationMinutes={activeDragData.durationMinutes}
        selectedDate={selectedDate}
        hasOverlap={dragHasOverlap}
        timelineStartHour={tlConfig.startHour}
        timelineEndHour={tlConfig.endHour}
      />
    );
  }, [activeDragData, activeOverTechId, dragPointerX, selectedDate, dragHasOverlap, tlConfig]);

  // ── Error state ──
  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50">
        <div className="text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-red-400 mb-2" />
          <p className="text-sm font-medium text-foreground">Failed to load dispatch data</p>
          <p className="text-xs text-muted-foreground mt-1">{error.message}</p>
        </div>
      </div>
    );
  }

  // ── Drag overlay (ghost preview follows cursor) ──
  const draggedVisit = activeDragData
    ? allVisits.find(v => v.id === activeDragData.visitId)
    : null;
  const draggedTask = activeDragData?.type === "scheduled-task"
    ? scheduledTasks.find(t => t.id === activeDragData.visitId)
    : null;

  // ── Lane data for selected item's panel (Goal 1: overlap validation for panel edits) ──
  const selectedLaneData = useMemo(() => {
    if (selectedVisit?.technicianId) {
      return {
        visits: visitsByTech.get(selectedVisit.technicianId) ?? [],
        tasks: tasksByTech.get(selectedVisit.technicianId) ?? [],
      };
    }
    if (selectedTask?.assignedToUserId) {
      return {
        visits: visitsByTech.get(selectedTask.assignedToUserId) ?? [],
        tasks: tasksByTech.get(selectedTask.assignedToUserId) ?? [],
      };
    }
    return { visits: [], tasks: [] };
  }, [selectedVisit, selectedTask, visitsByTech, tasksByTech]);

  // ── Detail panel rendering (Fix 5: wrapped in ref div for outside-click detection) ──
  const showDetailPanel = selectedVisit || selectedTask;
  // Dispatcher-polish: h-full on ref wrapper preserves flex layout in the parent overflow-hidden container
  const detailPanel = selectedVisit ? (
    <div ref={panelRef} className="h-full">
      <DispatchDetailPanel
        entityType="visit"
        visit={selectedVisit}
        technicians={technicians}
        laneVisits={selectedLaneData.visits}
        laneTasks={selectedLaneData.tasks}
        onClose={handleCloseDetail}
        onUnschedule={selectedVisit.scheduledStart ? handleUnschedule : undefined}
        onReschedule={handleRescheduleFromPanel}
        onResize={handleResize}
        onUpdateCrew={handleUpdateCrew}
        onUpdateStatus={handleUpdateStatus}
        onDeleteVisit={handleDeleteVisit}
        onScheduleFromPanel={!selectedVisit.scheduledStart ? handleScheduleFromPanel : undefined}
        boardDate={selectedDate}
      />
    </div>
  ) : selectedTask ? (
    <div ref={panelRef} className="h-full">
      <DispatchDetailPanel
        entityType="task"
        task={selectedTask}
        technicians={technicians}
        laneVisits={selectedLaneData.visits}
        laneTasks={selectedLaneData.tasks}
        onClose={handleCloseDetail}
        onRescheduleTask={handleRescheduleTaskFromPanel}
        onCompleteTask={handleCompleteTask}
        onReopenTask={handleReopenTask}
        onDeleteTask={handleDeleteTask}
      />
    </div>
  ) : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full flex-col bg-slate-50">
        {/* Header with view toggle */}
        <DispatchBoardHeader
          selectedDate={selectedDate}
          onPrevDay={onPrevDay}
          onNextDay={onNextDay}
          onToday={onToday}
          activeView={activeView}
          onViewChange={setActiveView}
          show24Hour={show24Hour}
          onToggle24Hour={onToggle24Hour}
        />

        {/* Filters — shared across Day and Week */}
        <DispatchFiltersBar
          technicians={technicians}
          selectedTechIds={selectedTechIds}
          onTechToggle={onTechToggle}
          onTechSelectAll={onTechSelectAll}
          onTechClearAll={onTechClearAll}
          selectedStatuses={selectedStatuses}
          onStatusToggle={onStatusToggle}
          showHideWeekends={activeView === "week"}
          hideWeekends={hideWeekends}
          onToggleHideWeekends={onToggleHideWeekends}
        />

        {/* Main content area */}
        <div className="flex flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400 mb-2" />
                <p className="text-xs text-muted-foreground">Loading dispatch board...</p>
              </div>
            </div>
          ) : activeView === "day" ? (
            /* ── Day View ── */
            <>
              <DispatchTechnicianSidebar technicians={visibleTechs} />
              <DispatchTimeline
                technicians={visibleTechs}
                visitsByTech={visitsByTech}
                tasksByTech={tasksByTech}
                savingIds={savingIds}
                selectedVisitId={selectedVisitId}
                selectedTaskId={selectedTaskId}
                onSelectVisit={handleSelectVisit}
                onSelectTask={handleSelectTask}
                onUnschedule={handleUnschedule}
                onResize={handleResize}
                onResizeTask={handleResizeTask}
                timelineScrollRef={timelineScrollRef}
                activeDropTechId={activeOverTechId}
                dragPreviewNode={dragPreviewNode}
                dragHasOverlap={dragHasOverlap}
                timelineHours={tlConfig.hours}
                timelineStartHour={tlConfig.startHour}
                timelineEndHour={tlConfig.endHour}
                onEmptySlotClick={handleEmptySlotClick}
              />
              {showDetailPanel ? detailPanel : (
                <DispatchUnscheduledPanel
                  visits={unscheduledVisits}
                  savingIds={savingIds}
                  selectedVisitId={selectedVisitId}
                  onSelectVisit={handleSelectVisit}
                />
              )}
            </>
          ) : (
            /* ── Week View ── */
            <>
              <WeekDispatchGrid
                technicians={weekVisibleTechs}
                weekDays={filteredWeekDays}
                visitsByTechByDay={filteredWeekVisits}
                tasksByTechByDay={filteredWeekTasks}
                selectedItemId={selectedVisitId ?? selectedTaskId}
                onSelectVisit={handleSelectVisit}
                onSelectTask={handleSelectTask}
              />
              {showDetailPanel ? detailPanel : (
                <DispatchUnscheduledPanel
                  visits={unscheduledVisits}
                  savingIds={savingIds}
                  selectedVisitId={selectedVisitId}
                  onSelectVisit={handleSelectVisit}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Drag overlay — compact ghost near cursor, low opacity so lane preview stays readable */}
      {/* BUG 2 fix: Ghost transform compensates for grab offset so it's always anchored
          near the cursor, regardless of where the user grabbed the card (sidebar vs timeline) */}
      <DragOverlay dropAnimation={null}>
        {draggedVisit && (
          <div className="pointer-events-none rounded border border-blue-300 bg-blue-50 px-2 py-1 shadow-md opacity-70 max-w-[160px]"
            style={{ transform: `translate(${dragGrabOffsetRef.current.x - 10}px, ${dragGrabOffsetRef.current.y - 10}px)` }}>
            <p className="text-[10px] font-semibold text-blue-800 truncate">{draggedVisit.customerName}</p>
            <p className="text-[9px] text-blue-500">#{draggedVisit.jobNumber}</p>
          </div>
        )}
        {draggedTask && (
          <div className="pointer-events-none rounded border border-dashed border-violet-300 bg-violet-50 px-2 py-1 shadow-md opacity-70 max-w-[160px]"
            style={{ transform: `translate(${dragGrabOffsetRef.current.x - 10}px, ${dragGrabOffsetRef.current.y - 10}px)` }}>
            <p className="text-[10px] font-semibold text-violet-800 truncate">{draggedTask.title}</p>
            <p className="text-[9px] text-violet-600 truncate">{draggedTask.type}</p>
          </div>
        )}
      </DragOverlay>

      {/* Off-shift assignment confirmation dialog */}
      <AlertDialog open={!!offShiftConfirm} onOpenChange={(open) => { if (!open) setOffShiftConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Assign to off-shift technician{(offShiftConfirm?.count ?? 1) > 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{offShiftConfirm?.techName}</strong> {(offShiftConfirm?.count ?? 1) > 1 ? "are" : "is"} not scheduled to work during this time. Are you sure you want to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setOffShiftConfirm(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              offShiftConfirm?.action();
              setOffShiftConfirm(null);
            }}>
              Assign anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Item 6: Quick-create from empty slot click — Job Visit + Task.
       * Uses Dialog (not AlertDialog) so buttons don't auto-close the modal.
       * This allows the async task creation to show loading state while open. */}
      {quickCreate && (() => {
        const tech = sortedTechnicians.find(t => t.id === quickCreate.techId);
        const h = Math.floor(quickCreate.minuteOfDay / 60);
        const m = quickCreate.minuteOfDay % 60;
        const slotDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), h, m, 0, 0);
        const timeLabel = format(slotDate, "h:mm a");
        const timeStr = format(slotDate, "HH:mm");
        return (
          <Dialog open onOpenChange={(open) => { if (!open) setQuickCreate(null); }}>
            <DialogContent className="max-w-[280px] p-5 gap-0">
              <DialogHeader className="space-y-1.5 pb-3">
                <DialogTitle className="text-base font-semibold">Quick Create</DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-0.5">
                    <p className="text-sm text-foreground font-medium">{tech?.name ?? "Technician"} · {timeLabel}</p>
                    <p className="text-xs text-muted-foreground">{format(selectedDate, "EEEE, MMM d, yyyy")}</p>
                  </div>
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1.5 pt-1">
                <Button
                  className="w-full justify-start gap-2"
                  onClick={() => {
                    setQuickCreateJobSchedule({
                      date: selectedDate,
                      time: timeStr,
                      durationMinutes: 60,
                      primaryTechnicianId: quickCreate.techId,
                    });
                    setQuickCreate(null);
                    setQuickCreateJobOpen(true);
                  }}
                >
                  <CalendarPlus className="h-4 w-4" />
                  New Job Visit
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={() => {
                    const dateStr = format(selectedDate, "yyyy-MM-dd");
                    setQuickCreateTaskPrefill({
                      assignedToUserId: quickCreate.techId,
                      startDate: dateStr,
                      startTime: timeStr,
                      taskType: "GENERAL",
                    });
                    setQuickCreate(null);
                    setQuickCreateTaskOpen(true);
                  }}
                >
                  <ClipboardList className="h-4 w-4" />
                  General Task
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={() => {
                    const dateStr = format(selectedDate, "yyyy-MM-dd");
                    setQuickCreateTaskPrefill({
                      assignedToUserId: quickCreate.techId,
                      startDate: dateStr,
                      startTime: timeStr,
                      taskType: "SUPPLIER_VISIT",
                    });
                    setQuickCreate(null);
                    setQuickCreateTaskOpen(true);
                  }}
                >
                  <Truck className="h-4 w-4" />
                  Supplier Visit
                </Button>
                <Button variant="ghost" className="w-full text-muted-foreground" size="sm" onClick={() => setQuickCreate(null)}>
                  Cancel
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Quick-create job dialog — opened from quick-create modal */}
      <QuickAddJobDialog
        open={quickCreateJobOpen}
        onOpenChange={(open) => {
          setQuickCreateJobOpen(open);
          if (!open) setQuickCreateJobSchedule(undefined);
        }}
        initialSchedule={quickCreateJobSchedule}
        onSuccess={() => {
          setQuickCreateJobOpen(false);
          setQuickCreateJobSchedule(undefined);
        }}
      />

      {/* Quick-create task dialog — opened from quick-create modal */}
      <TaskDialog
        open={quickCreateTaskOpen}
        onOpenChange={(open) => {
          setQuickCreateTaskOpen(open);
          if (!open) setQuickCreateTaskPrefill(undefined);
        }}
        initialData={quickCreateTaskPrefill}
        onChanged={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
        }}
      />
    </DndContext>
  );
}
