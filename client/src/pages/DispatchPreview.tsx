/**
 * DispatchBoard (DispatchPreview.tsx)
 * Primary dispatch board with Day, Week, and Month views, drag/drop scheduling,
 * overlap prevention, task parity, and structured detail panel.
 * Route: /dispatch (primary), /calendar (alias)
 */
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { addDays, subDays, addWeeks, subWeeks, addMonths, subMonths, startOfWeek, endOfWeek, eachDayOfInterval, addMinutes, format } from "date-fns";
import { AlertCircle, Loader2 } from "lucide-react";
// 2026-05-05 Phase 3: wouter navigation for the lead-visits strip
// click-through. Other dispatch click handlers route via internal
// modal state, so this is the only place the page leaves the route.
import { useLocation } from "wouter";
import type { DispatchLeadVisit } from "@/components/dispatch/dispatchPreviewTypes";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";

import type { VisitStatus, DispatchVisit, DispatchTask, Technician } from "@/components/dispatch/dispatchPreviewTypes";
import { UNASSIGNED_TECH_ID } from "@/components/dispatch/dispatchPreviewTypes";
import { VISIT_STATUS_OPTIONS } from "@/lib/visitStatusDisplay";
import type { DispatchDragData, DispatchDropData } from "@/components/dispatch/dispatchDndTypes";
import { useDispatchPreviewData } from "@/components/dispatch/useDispatchPreviewData";
import { useDispatchWeekData } from "@/components/dispatch/useDispatchWeekData";
import { useDispatchMonthData } from "@/components/dispatch/useDispatchMonthData";
import { useDispatchPreviewMutations } from "@/components/dispatch/useDispatchPreviewMutations";
import { getTimelineConfig, HOUR_WIDTH_PX, SNAP_MINUTES, DEFAULT_SCHEDULE_HOUR } from "@/components/dispatch/dispatchPreviewUtils";
import { UNASSIGNED_COLOR } from "@shared/colors";
// checkOverlap + findNearestValidSlot now accessed via resolvePlacement() shared resolver
import { useTechnicianWorkingHours, isTechWorkingOnDate, isTechWorkingInRange } from "@/hooks/useTechnicianWorkingHours";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

import DispatchBoardHeader, { type DispatchView } from "@/components/dispatch/DispatchBoardHeader";
import { resolvePlacement, clientXToRelativePx, type PlacementResult } from "@/components/dispatch/dispatchPlacementResolver";
import DispatchFiltersBar from "@/components/dispatch/DispatchFiltersBar";
import DispatchTechnicianSidebar from "@/components/dispatch/DispatchTechnicianSidebar";
import DispatchTimeline, { ANY_TIME_COL_WIDTH } from "@/components/dispatch/DispatchTimeline";
import DispatchUnscheduledPanel from "@/components/dispatch/DispatchUnscheduledPanel";
import DispatchDetailPanel from "@/components/dispatch/DispatchDetailPanel";
// DispatchDragPreview removed — drag preview now rendered inline from shared dragPlacement result
import WeekDispatchGrid, { WEEK_START_HOUR, WEEK_HOUR_HEIGHT_PX } from "@/components/dispatch/WeekDispatchGrid";
import MonthDispatchGrid from "@/components/dispatch/MonthDispatchGrid";
import DispatchMapPanel from "@/components/dispatch/DispatchMapPanel";
import { useLiveTechnicians } from "@/hooks/useLiveTechnicians";
// 2026-04-20 canonicalization: Dispatch now mounts the shared launcher
// components that encapsulate EditVisitModal state and the quick-create
// chooser + QuickAddJobDialog + TaskDialog orchestration. Dashboard uses
// the exact same pair — one implementation, two entry points.
import {
  VisitEditorLauncher,
  type VisitEditorState,
} from "@/components/dispatch/VisitEditorLauncher";
import {
  SlotQuickCreateLauncher,
  type QuickCreateSlot,
} from "@/components/dispatch/SlotQuickCreateLauncher";
// 2026-04-24: mandatory single path for every Edit Visit modal opening.
// DispatchPreview passes a fully hydrated payload from DispatchVisit (has
// customerName + locationId) so the adapter hits the fast-path no-op —
// zero network cost, uniform contract across every surface.
import { enrichVisitEditorState } from "@/lib/visitEditorPayloadBuilder";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Local pxToSnappedMinutes and computeDropTime removed — unified into
// dispatchPlacementResolver.ts resolvePlacement() (shared by drag + click modes)

/**
 * 2026-04-30: localStorage key for the last-selected Dispatch view.
 * Naming follows the in-repo `syntraro:*` kebab-case convention.
 * Stored value is a raw `DispatchView` string ("day" | "week" |
 * "month"); any other value is treated as missing and the default
 * ("day") is used.
 */
const DISPATCH_VIEW_KEY = "syntraro:dispatch-view-mode";

export default function DispatchPreview() {
  const { toast } = useToast();
  // 2026-05-05 Phase 3: navigation for the lead-visits click-through.
  const [, setLocation] = useLocation();

  // 2026-04-08: useDispatchStream() now mounted once at App.tsx root for all office surfaces.

  // ── View mode ──
  // 2026-04-30: Persist last-selected Dispatch view across navigations
  // via a single localStorage key with a validated read and silent
  // fallback on disabled-storage. The user-suggested
  // `dispatch:lastViewMode` was renamed to `syntraro:dispatch-view-mode`
  // to keep the in-repo namespace consistent (`syntraro:*` kebab-case).
  const [activeView, setActiveView] = useState<DispatchView>(() => {
    if (typeof window === "undefined") return "day";
    try {
      const saved = window.localStorage.getItem(DISPATCH_VIEW_KEY);
      if (saved === "day" || saved === "week" || saved === "month") return saved;
    } catch {
      // ignore — fall through to default
    }
    return "day";
  });
  const handleViewChange = useCallback((next: DispatchView) => {
    setActiveView(next);
    try {
      window.localStorage.setItem(DISPATCH_VIEW_KEY, next);
    } catch {
      // localStorage may be unavailable (private mode, quota). Persistence
      // best-effort; default fallback path still works.
    }
  }, []);

  // ── Item 7: 24-hour timeline toggle ──
  const [show24Hour, setShow24Hour] = useState(false);
  const onToggle24Hour = useCallback(() => setShow24Hour(prev => !prev), []);

  // ── Map panel toggle (additive — unscheduled stays visible) ──
  const [showMap, setShowMap] = useState(false);
  // ── Unscheduled-on-map toggle (default OFF — only relevant when map visible) ──
  const [showUnscheduledOnMap, setShowUnscheduledOnMap] = useState(false);
  // ── Show Routes toggle (default OFF — draws per-technician route polylines on map) ──
  const [showRoutes, setShowRoutes] = useState(false);

  // ── Live technician GPS — only polls when map panel is visible ──
  const { data: liveTechnicians } = useLiveTechnicians(showMap);

  // ── Hover linkage between map markers and calendar visit cards ──
  // 2026-04-08: Hover state moved to module-scoped external store in
  // dispatchHoverContext.ts. The previous useState in this component caused
  // every hover to re-render the entire DispatchPreview tree. Now consumers
  // subscribe via useHoverSetter / useIsVisitHovered with per-id granularity.

  // Item 4: Dynamic timeline config from 24h toggle
  const tlConfig = useMemo(() => getTimelineConfig(show24Hour), [show24Hour]);

  // ── Date nav ──
  const [selectedDate, setSelectedDate] = useState(new Date());

  const onPrevDay = useCallback(() => {
    setSelectedDate(d =>
      activeView === "month" ? subMonths(d, 1) : activeView === "week" ? subWeeks(d, 1) : subDays(d, 1)
    );
  }, [activeView]);
  const onNextDay = useCallback(() => {
    setSelectedDate(d =>
      activeView === "month" ? addMonths(d, 1) : activeView === "week" ? addWeeks(d, 1) : addDays(d, 1)
    );
  }, [activeView]);
  const onToday = useCallback(() => setSelectedDate(new Date()), []);

  // ── Real data from backend — only active view fetches ──
  // All three views follow the same pattern: thin adapter over useDispatchRangeData.
  const dayData = useDispatchPreviewData(selectedDate, activeView === "day");
  const weekData = useDispatchWeekData(selectedDate, activeView === "week");
  const monthData = useDispatchMonthData(selectedDate, activeView === "month");

  // ── Working hours for technician on-shift/off-shift grouping ──
  const { scheduleMap } = useTechnicianWorkingHours();

  // Enrich technicians with isWorking flag based on current view context
  const rawTechnicians = activeView === "month" ? monthData.technicians : activeView === "week" ? weekData.technicians : dayData.technicians;
  const technicians: Technician[] = useMemo(() => {
    if (activeView === "week" || activeView === "month") {
      const ws = activeView === "month" ? monthData.gridStart : startOfWeek(selectedDate, { weekStartsOn: 1 });
      const we = activeView === "month" ? monthData.gridEnd : endOfWeek(selectedDate, { weekStartsOn: 1 });
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
  }, [rawTechnicians, scheduleMap, selectedDate, activeView, monthData.gridStart, monthData.gridEnd]);

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

  // ── 2026-05-07 RALPH (technician time off): assignment-onto-off-tech
  // confirmation dialog. Mirrors `offShiftConfirm` so the existing
  // pattern stays canonical. The trigger fires from two paths:
  //   1. Pre-flight client check inside handleDragEnd / handleResize:
  //      iterates `timeOffByTech` against the target tech + range.
  //      If overlap, defers the mutation and shows this dialog.
  //   2. Server-side 409 with code: "TIME_OFF_CONFLICT" (for the
  //      stale-client case where the local time-off cache missed
  //      a freshly created entry). The mutation hook surfaces the
  //      dialog post-hoc by reading the response payload.
  // Override path: the action retries the mutation with
  // `overrideTimeOffConflict: true` which the server respects.
  const [timeOffConfirm, setTimeOffConfirm] = useState<{
    action: () => void;
    techName: string;
    reason?: string;
  } | null>(null);

  // ── 2026-03-30: Multi-day visit confirmation dialog ──
  // Warns before a drop/resize would cause a visit to cross midnight into the next day.
  const [multiDayConfirm, setMultiDayConfirm] = useState<{
    action: () => void;
  } | null>(null);


  // Use active view's data for shared state
  // (technicians already computed above with isWorking enrichment)
  const activeData = activeView === "month" ? monthData : activeView === "week" ? weekData : dayData;
  const scheduledVisits = activeData.scheduledVisits;
  const unscheduledVisits = activeData.unscheduledVisits;
  const scheduledTasks = activeData.scheduledTasks;
  // 2026-05-05 Phase 3: lead visits (pre-sales onsite). Rendered as a
  // sibling strip ABOVE the technician grid — not merged into the
  // job-centric DispatchVisit shape because they have no jobNumber,
  // no lifecycle, no drag/resize. Click-through goes to /leads/:id.
  const leadVisits = activeData.leadVisits ?? [];
  // 2026-05-07 RALPH (technician time off): time-off entries
  // overlapping the visible range. The day adapter narrows to today;
  // week / month adapters return the full visible range. The lane
  // shading + sidebar pill + drag-confirm warning all read this.
  const timeOffEntries = (activeData as any).timeOff ?? [];
  const isLoading = activeData.isLoading;
  const error = activeData.error;

  // Per-tech map of time-off entries for fast lane lookup.
  const timeOffByTech = useMemo(() => {
    const m = new Map<string, Array<{
      id: string;
      startsAt: string;
      endsAt: string;
      reason: string;
      allDay: boolean;
    }>>();
    for (const t of timeOffEntries) {
      const arr = m.get(t.technicianUserId) ?? [];
      arr.push({
        id: t.id,
        startsAt: t.startsAt,
        endsAt: t.endsAt,
        reason: t.reason,
        allDay: t.allDay,
      });
      m.set(t.technicianUserId, arr);
    }
    return m;
  }, [timeOffEntries]);

  // Set of tech IDs with any time-off in the visible range — used
  // by the sidebar to paint an "Off" pill next to the tech name.
  const techsOnTimeOff = useMemo(
    () => new Set<string>(timeOffEntries.map((t: any) => t.technicianUserId)),
    [timeOffEntries],
  );

  // Per-day Set<techId> for week + month chip rendering. Each
  // `dayKey` (YYYY-MM-DD) maps to the set of unique techs that
  // have any time-off entry overlapping that calendar day. The
  // chip shows `set.size`. Computed once per timeOffEntries
  // change so it doesn't recompute on every drag tick.
  const techsOnTimeOffByDay = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const t of timeOffEntries as any[]) {
      const start = new Date(t.startsAt);
      const end = new Date(t.endsAt);
      // Iterate each calendar day the entry covers (clamped to a
      // sane upper bound so a malformed multi-year row can't loop
      // forever — capacity already clips reads to the visible
      // range).
      const cursor = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate(),
      );
      let safety = 0;
      while (cursor < end && safety < 366) {
        const y = cursor.getFullYear();
        const mo = String(cursor.getMonth() + 1).padStart(2, "0");
        const d = String(cursor.getDate()).padStart(2, "0");
        const key = `${y}-${mo}-${d}`;
        const set = m.get(key) ?? new Set<string>();
        set.add(t.technicianUserId);
        m.set(key, set);
        cursor.setDate(cursor.getDate() + 1);
        safety++;
      }
    }
    return m;
  }, [timeOffEntries]);

  // 2026-05-07 RALPH (technician time off): per-day list of RICH
  // entries for the canonical week + month chip rendering. Each
  // entry carries the tech NAME (resolved from the technicians
  // roster) so the chip can render "Time off · Vacation · …"
  // alongside the tech's name without a downstream lookup. Day
  // iteration uses the same 366-day safety bound as
  // `techsOnTimeOffByDay`.
  const timeOffEntriesByDay = useMemo(() => {
    const techNameById = new Map<string, string>();
    for (const t of technicians) techNameById.set(t.id, t.name);
    const m = new Map<
      string,
      Array<{
        id: string;
        technicianUserId: string;
        technicianName: string;
        reason: string;
        startsAt: string;
        endsAt: string;
        allDay: boolean;
      }>
    >();
    for (const t of timeOffEntries as any[]) {
      const start = new Date(t.startsAt);
      const end = new Date(t.endsAt);
      const cursor = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate(),
      );
      let safety = 0;
      while (cursor < end && safety < 366) {
        const y = cursor.getFullYear();
        const mo = String(cursor.getMonth() + 1).padStart(2, "0");
        const d = String(cursor.getDate()).padStart(2, "0");
        const key = `${y}-${mo}-${d}`;
        const arr = m.get(key) ?? [];
        arr.push({
          id: t.id,
          technicianUserId: t.technicianUserId,
          technicianName:
            techNameById.get(t.technicianUserId) ?? "Technician",
          reason: t.reason,
          startsAt: t.startsAt,
          endsAt: t.endsAt,
          allDay: t.allDay,
        });
        m.set(key, arr);
        cursor.setDate(cursor.getDate() + 1);
        safety++;
      }
    }
    return m;
  }, [timeOffEntries, technicians]);

  // 2026-05-07 RALPH (technician time off): preflight overlap
  // check used by drag/drop handlers BEFORE issuing the
  // reschedule mutation. Returns the conflicting time-off entries
  // (empty array = no conflict, fire away). The resolved tech IDs
  // are tested against `timeOffByTech` for any interval that
  // overlaps the requested [startISO, endISO) window.
  const checkTimeOffOverlap = useCallback(
    (techIds: string[], startISO: string, endISO: string) => {
      if (!techIds.length) return [] as Array<typeof timeOffEntries[number]>;
      const startMs = Date.parse(startISO);
      const endMs = Date.parse(endISO);
      if (!isFinite(startMs) || !isFinite(endMs) || endMs <= startMs) {
        return [] as Array<typeof timeOffEntries[number]>;
      }
      const matches: Array<typeof timeOffEntries[number]> = [];
      for (const techId of techIds) {
        const list = timeOffByTech.get(techId);
        if (!list) continue;
        for (const entry of list) {
          const entryStart = Date.parse(entry.startsAt);
          const entryEnd = Date.parse(entry.endsAt);
          // Canonical overlap predicate: a.start < b.end && a.end > b.start.
          if (entryStart < endMs && entryEnd > startMs) {
            matches.push({
              ...entry,
              technicianUserId: techId,
            } as any);
          }
        }
      }
      return matches;
    },
    [timeOffByTech],
  );

  // ── Mutations ──
  // 2026-03-21: reopenVisit, completeVisitWithOutcome, deleteVisit removed — lifecycle
  // actions now routed through canonical EditVisitModal.
  // 2026-04-21 Phase 1: updateVisitCrew, updateVisitStatus removed from this
  // destructure — dispatch board no longer performs those quick-actions. Crew
  // and status changes go through EditVisitModal (canonical visit editor).
  const { scheduleVisit, rescheduleVisit, unscheduleVisit, resizeVisit, rescheduleTask, completeTask, reopenTask, deleteTask, updateQueueBucket, savingIds } =
    useDispatchPreviewMutations();

  // ── Timeline scroll ref (for computing drop positions) ──
  const timelineScrollRef = useRef<HTMLDivElement>(null);

  // ── DnD state ──
  const [activeDragData, setActiveDragData] = useState<DispatchDragData | null>(null);
  const [activeOverTechId, setActiveOverTechId] = useState<string | null>(null);

  // Pointer tracking: native pointermove listener gives the real viewport clientX
  // independent of dnd-kit's scroll-adjusted delta. This prevents double-counting
  // scroll offset for internal drags (where dnd-kit's scrollAdjustedTranslate
  // includes the timeline scroll delta, but clientXToRelativePx also adds scrollLeft).
  const dragPointerXRef = useRef<number>(0);
  // Tick counter: incremented after auto-scroll mutates scrollLeft/scrollTop.
  // The dragPlacement useMemo depends on this so it recomputes immediately,
  // reading the live pointer ref + live scrollLeft in the same render frame.
  const [dragTick, setDragTick] = useState(0);

  // Native pointermove handler — updates dragPointerXRef/Y with real viewport position
  const dragPointerYRef = useRef<number>(0);
  const nativePointerMoveRef = useRef<((e: PointerEvent) => void) | null>(null);

  // Fix 1: Origin lane locking — prevent visit jumping to adjacent lane on drag start
  const originLaneRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);
  // BUG 2 fix: Capture grab offset (cursor-to-element-corner) for DragOverlay alignment
  const dragGrabOffsetRef = useRef<{ x: number; y: number }>({ x: 10, y: 10 });
  // Item 1: Grab X offset within the block — used to align preview/drop to block's left edge
  const dragGrabBlockXRef = useRef(0);
  // External drag lifecycle: tracks whether drag originates from Unscheduled panel (sidebar)
  const isExternalDragRef = useRef(false);
  // 2026-04-12 final cleanup: crewUpdateTimerRef removed — full crew now
  // persists in a single scheduleVisit call (one canonical write path).
  useEffect(() => {
    return () => {
      if (nativePointerMoveRef.current) {
        window.removeEventListener("pointermove", nativePointerMoveRef.current);
        nativePointerMoveRef.current = null;
      }
    };
  }, []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // ── Technician multi-select filter (shared Day/Week) ──
  // 2026-03-23: UNASSIGNED_TECH_ID included in filter state so users can toggle the lane
  const [selectedTechIds, setSelectedTechIds] = useState<Set<string>>(new Set());
  const [hasInitialized, setHasInitialized] = useState(false);
  useEffect(() => {
    if (!hasInitialized && technicians.length > 0) {
      setSelectedTechIds(new Set([...technicians.map(t => t.id), UNASSIGNED_TECH_ID]));
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
    () => setSelectedTechIds(new Set([...technicians.map(t => t.id), UNASSIGNED_TECH_ID])),
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

  // ── Month view: tech color map ──
  const monthTechColorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of technicians) m.set(t.id, t.color);
    return m;
  }, [technicians]);

  // ── Derived data (Day view) ──
  const allVisits = useMemo(() => [...scheduledVisits, ...unscheduledVisits], [scheduledVisits, unscheduledVisits]);

  // 2026-03-26: Unassigned lane is persistent (always available) and rendered at top.
  // No longer conditional on having unassigned visits — it's a first-class drop target.
  const UNASSIGNED_TECH: Technician = {
    id: UNASSIGNED_TECH_ID,
    name: "Unassigned",
    initials: "??",
    color: UNASSIGNED_COLOR,
    status: "off",
  };

  const visibleTechs = useMemo(() => {
    const filtered = sortedTechnicians.filter(t => selectedTechIds.has(t.id));
    // Unassigned lane at top, controlled by filter toggle
    if (selectedTechIds.has(UNASSIGNED_TECH_ID)) {
      filtered.unshift(UNASSIGNED_TECH);
    }
    return filtered;
  }, [sortedTechnicians, selectedTechIds]);

  /** Multi-tech: place each visit in every assigned technician's lane */
  const visitsByTech = useMemo(() => {
    const map = new Map<string, DispatchVisit[]>();
    for (const t of visibleTechs) map.set(t.id, []);
    for (const v of scheduledVisits) {
      if (!selectedStatuses.has(v.status)) continue;
      // 2026-04-19: group strictly by canonical crew array — same fix as
      // useDispatchWeekData. The scalar-fallback was a stale-state hazard.
      const techIds = v.technicianIds;
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

  /** Multi-tech: place each assigned lead visit in every assigned technician's lane.
   *  Mirrors the visitsByTech grouping pattern. Unassigned lead visits are omitted
   *  here — they stay in the LeadVisitsStrip overflow surface. */
  const leadVisitsByTech = useMemo(() => {
    const map = new Map<string, DispatchLeadVisit[]>();
    for (const t of visibleTechs) map.set(t.id, []);
    for (const lv of leadVisits) {
      if (lv.technicianIds.length === 0) continue;
      for (const tid of lv.technicianIds) {
        if (!selectedTechIds.has(tid)) continue;
        const arr = map.get(tid);
        if (arr) arr.push(lv);
      }
    }
    return map;
  }, [visibleTechs, leadVisits, selectedTechIds]);

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

  // ── Map visits: flattened from the same tech+status-filtered data the board uses ──
  // Day view uses visitsByTech; Week view uses filteredWeekVisits. Both already
  // respect selectedTechIds + selectedStatuses, so the map stays in sync.
  // 2026-04-02: Completed visits excluded — they add clutter without dispatch value.
  const mapVisits = useMemo(() => {
    const seen = new Set<string>();
    const result: DispatchVisit[] = [];
    // Flatten from the view-appropriate filtered map (deduplicates multi-tech visits)
    const source = activeView === "week" ? filteredWeekVisits : visitsByTech;
    if (activeView === "week") {
      // Week: Map<techId, Map<dayKey, DispatchVisit[]>>
      Array.from((source as Map<string, Map<string, DispatchVisit[]>>).values()).forEach(dayMap => {
        Array.from(dayMap.values()).forEach(visits => {
          for (const v of visits) {
            if (!seen.has(v.id) && v.status !== "completed") { seen.add(v.id); result.push(v); }
          }
        });
      });
    } else {
      // Day: Map<techId, DispatchVisit[]>
      Array.from((source as Map<string, DispatchVisit[]>).values()).forEach(visits => {
        for (const v of visits) {
          if (!seen.has(v.id) && v.status !== "completed") { seen.add(v.id); result.push(v); }
        }
      });
    }
    // Optionally include unscheduled visits on map (never completed by definition)
    if (showUnscheduledOnMap) {
      for (const v of unscheduledVisits) {
        if (!seen.has(v.id)) { seen.add(v.id); result.push(v); }
      }
    }
    return result;
  }, [activeView, visitsByTech, filteredWeekVisits, showUnscheduledOnMap, unscheduledVisits]);

  // 2026-03-26: Week view — persistent Unassigned lane at top, same as day view
  const weekVisibleTechs = useMemo(() => {
    const filtered = sortedTechnicians.filter(t => selectedTechIds.has(t.id));
    if (selectedTechIds.has(UNASSIGNED_TECH_ID)) {
      filtered.unshift(UNASSIGNED_TECH);
    }
    return filtered;
  }, [sortedTechnicians, selectedTechIds]);

  // ── Drag placement via shared resolver (overlap detection + preview position) ──
  // Unified: replaces separate dragHasOverlap + DispatchDragPreview inline math.
  //
  // Scroll-sync fix: dragPointerXRef (ref) holds the live pointer clientX.
  // dragTick (state) is bumped by auto-scroll to force recomputation even when
  // the pointer hasn't moved. This ensures the placement reads the CURRENT
  // scrollLeft and pointer position in the SAME render frame, eliminating the
  // drift that occurred when auto-scroll changed scrollLeft but dragPointerX
  // state was still stale from the prior DragMove event.
  const dragPlacement = useMemo((): PlacementResult | null => {
    // dragTick is in the dependency array solely to trigger recomputation after
    // auto-scroll; its value is not used in the calculation.
    void dragTick;

    if (!activeDragData || !activeOverTechId || activeOverTechId === UNASSIGNED_TECH_ID) return null;
    const scrollEl = timelineScrollRef.current;
    if (!scrollEl) return null;

    const pointerX = dragPointerXRef.current;
    const rect = scrollEl.getBoundingClientRect();

    // External drag: suppress preview until pointer is inside the board's
    // horizontal bounds. This prevents transient coordinates from the sidebar
    // zone resolving to a misleading end-of-day slot.
    if (isExternalDragRef.current) {
      if (pointerX < rect.left || pointerX > rect.right) return null;
    }

    const relativeX = clientXToRelativePx(
      pointerX,
      rect,
      scrollEl.scrollLeft,
      dragGrabBlockXRef.current,
    ) - ANY_TIME_COL_WIDTH;

    // Guard: negative relativeX means pointer is before the timeline start;
    // don't resolve placement (would clamp to 0 = misleading first-slot snap).
    if (relativeX < 0) return null;

    const laneVisits = visitsByTech.get(activeOverTechId) ?? [];
    const laneTasks = tasksByTech.get(activeOverTechId) ?? [];
    return resolvePlacement(relativeX, activeOverTechId, activeDragData.durationMinutes, {
      selectedDate,
      startHour: tlConfig.startHour,
      endHour: tlConfig.endHour,
      laneVisits,
      laneTasks,
      excludeId: activeDragData.visitId,
    });
  }, [activeDragData, activeOverTechId, dragTick, visitsByTech, tasksByTech, selectedDate, tlConfig]);

  const dragHasOverlap = dragPlacement?.hasOverlap ?? false;

  // ── DnD handlers ──
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as DispatchDragData | undefined;
    if (data) {
      setActiveDragData(data);
      // Fix 1: Capture origin lane so item doesn't jump on drag start
      originLaneRef.current = data.technicianId ?? null;
      isDraggingRef.current = true;

      // External drag detection: sidebar card has no meaningful timeline offset
      isExternalDragRef.current = data.type === "unscheduled-visit";

      // BUG 2 fix: Capture pointer-to-element-corner offset for DragOverlay alignment.
      // dnd-kit positions DragOverlay at elementPosition + delta, so the overlay's left edge
      // is offset from the cursor by the grab point. Compensating in the overlay transform
      // ensures the ghost stays anchored near the cursor regardless of where the card was grabbed.
      const pointerEvent = event.activatorEvent as PointerEvent | undefined;
      const target = pointerEvent?.target as HTMLElement | undefined;
      const dragEl = target?.closest("[data-dispatch-block]") as HTMLElement | null;
      if (pointerEvent) dragPointerXRef.current = pointerEvent.clientX;
      if (pointerEvent && dragEl && !isExternalDragRef.current) {
        // Internal drag: capture grab offset within the on-board block
        const rect = dragEl.getBoundingClientRect();
        dragGrabOffsetRef.current = {
          x: pointerEvent.clientX - rect.left,
          y: pointerEvent.clientY - rect.top,
        };
        // Item 1: Capture grab X offset within the block for preview/drop alignment
        dragGrabBlockXRef.current = pointerEvent.clientX - rect.left;
      } else {
        // External drag: sidebar card position is irrelevant to timeline placement.
        // Zero offset ensures drop/preview resolve to where the pointer actually is.
        dragGrabOffsetRef.current = { x: 10, y: 10 };
        dragGrabBlockXRef.current = 0;
      }

      // Attach native pointermove listener to track raw viewport pointer position.
      // This bypasses dnd-kit's scrollAdjustedTranslate which double-counts scroll
      // offset for internal drags (source inside the timeline scroll container).
      if (pointerEvent) dragPointerYRef.current = pointerEvent.clientY;
      const handler = (e: PointerEvent) => {
        dragPointerXRef.current = e.clientX;
        dragPointerYRef.current = e.clientY;
      };
      nativePointerMoveRef.current = handler;
      window.addEventListener("pointermove", handler);
    }
  }, []);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    // dragPointerXRef is updated by the native pointermove listener (real viewport X).
    // We only bump the tick here to trigger dragPlacement recomputation.
    setDragTick(t => t + 1);

    const overData = event.over?.data.current as DispatchDropData | undefined;
    // Fix 1: Use detected lane if available, fall back to origin lane
    const detectedLane = overData?.technicianId ?? null;
    setActiveOverTechId(detectedLane ?? originLaneRef.current);

    // Auto-scroll timeline when pointer nears edges
    const scrollEl = timelineScrollRef.current;
    if (!scrollEl) return;
    // Use native pointer position from refs (not dnd-kit's scroll-adjusted delta)
    const pointerX = dragPointerXRef.current;
    const pointerY = dragPointerYRef.current;
    const rect = scrollEl.getBoundingClientRect();

    // Pointer-inside-container guards: only scroll when pointer is actually
    // within the scroll container bounds. Without this, dragging from outside
    // (e.g. the Unscheduled sidebar) produces unbounded scroll velocity
    // because the edge-distance formula goes negative.
    const insideH = pointerX >= rect.left && pointerX <= rect.right;
    const insideV = pointerY >= rect.top && pointerY <= rect.bottom;

    const isExternal = isExternalDragRef.current;
    const EDGE_PX = 60;
    const MAX_SPEED = 12;
    let dx = 0;
    let dy = 0;

    // Horizontal auto-scroll:
    // - External drag (from Unscheduled panel): DISABLED. The board must stay
    //   stable so the user can drop onto the currently visible time slots.
    //   Scroll first, then drag — not the other way around.
    // - Internal drag (within board): enabled only when pointer is inside the
    //   container (prevents unbounded velocity when pointer exits the edge).
    //   Phase 8 fix: cap rightward scroll at timeline end to prevent over-scroll
    //   that traps the preview at the far-right boundary.
    if (!isExternal && insideH && insideV) {
      if (pointerX < rect.left + EDGE_PX) {
        dx = -MAX_SPEED * (1 - (pointerX - rect.left) / EDGE_PX);
      } else if (pointerX > rect.right - EDGE_PX) {
        // Cap: don't scroll right if timeline end is already visible
        const totalTimelinePx = (tlConfig.endHour - tlConfig.startHour) * HOUR_WIDTH_PX;
        const maxScroll = totalTimelinePx - scrollEl.clientWidth;
        if (scrollEl.scrollLeft < maxScroll) {
          dx = MAX_SPEED * (1 - (rect.right - pointerX) / EDGE_PX);
        }
      }
    }
    // Vertical auto-scroll: allowed for both internal and external drag
    // (needed to reach different technician lanes), but only when pointer is
    // horizontally inside the container.
    if (insideH && insideV) {
      if (pointerY < rect.top + EDGE_PX) {
        dy = -MAX_SPEED * (1 - (pointerY - rect.top) / EDGE_PX);
      } else if (pointerY > rect.bottom - EDGE_PX) {
        dy = MAX_SPEED * (1 - (rect.bottom - pointerY) / EDGE_PX);
      }
    }
    if (dx !== 0 || dy !== 0) {
      scrollEl.scrollLeft += dx;
      scrollEl.scrollTop += dy;
      // Scroll-sync fix: the tick bump at the top of this handler already
      // ensures dragPlacement recomputes in this batch. The useMemo reads
      // scrollLeft live from the DOM, so the freshly-mutated scroll position
      // and the current pointer ref are both available in the same frame.
    }
  }, []);

  /** Unified drag end handler for both day view (pixel-based) and week view (cell-based) drops */
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    // Clean up native pointer listener
    if (nativePointerMoveRef.current) {
      window.removeEventListener("pointermove", nativePointerMoveRef.current);
      nativePointerMoveRef.current = null;
    }

    const dragData = activeDragData;
    setActiveDragData(null);
    setActiveOverTechId(null);
    originLaneRef.current = null;
    isDraggingRef.current = false;
    isExternalDragRef.current = false;

    const { over } = event;
    if (!over || !dragData) return;

    const dropData = over.data.current as DispatchDropData | undefined;

    // ── Right-rail bucket drop ─────────────────────────────────────────────
    // Dropping onto a staging section: update bucket only (if unscheduled) or
    // unschedule + set bucket (if currently scheduled).
    if (dropData?.queueBucket) {
      const bucket = dropData.queueBucket;
      if (dragData.type === "unscheduled-visit" && dragData.visitId) {
        updateQueueBucket({ visitId: dragData.visitId, dispatchQueueBucket: bucket });
      } else if (dragData.type === "scheduled-visit" && dragData.visitId) {
        unscheduleVisit({ visitId: dragData.visitId, jobId: dragData.jobId });
        updateQueueBucket({ visitId: dragData.visitId, dispatchQueueBucket: bucket });
      }
      return;
    }

    // Day view requires technicianId; week calendar drops provide dayKey only
    if (!dropData?.technicianId && !dropData?.dayKey) return;
    // 2026-03-26: Unassigned lane is now a valid drop target — dropping here
    // keeps the schedule but clears technician assignment.
    const isDropOnUnassigned = dropData.technicianId === UNASSIGNED_TECH_ID;

    // ── Week view drop (dayKey present: cell-based or calendar column) ──
    // 2026-03-31: Derive drop time from pointer Y position in the week grid,
    // not from the visit's original scheduled time. This ensures dragging a
    // 12:00 visit to the 2:15 slot actually schedules at 2:15.
    // Calendar-style week drops may omit technicianId — preserve the drag
    // source's tech assignment (no tech change). Tech-row week drops still
    // provide an explicit technicianId for reassignment.
    if (dropData.dayKey) {
      // Resolve target time from pointer Y position relative to the week grid column.
      // Month view drops have no time grid — use DEFAULT_SCHEDULE_HOUR (9 AM) explicitly.
      const isMonthDrop = activeView === "month";
      const dayEl = isMonthDrop ? null : document.querySelector(`[data-week-day="${dropData.dayKey}"]`);
      const [y2, m2, d2] = dropData.dayKey.split("-").map(Number);
      let timeH: number;
      let timeM: number;
      if (isMonthDrop) {
        // Month cells have no time grid — schedule at canonical default time
        timeH = DEFAULT_SCHEDULE_HOUR;
        timeM = 0;
      } else if (dayEl) {
        const rect = dayEl.getBoundingClientRect();
        const pointerY = dragPointerYRef.current;
        const offsetY = pointerY - rect.top; // Y within the grid column (px)
        // 2026-03-31: Use dynamic week hour range from shared 24h toggle
        const weekStart = show24Hour ? 0 : WEEK_START_HOUR;
        const weekEnd = show24Hour ? 24 : 21;
        const rawMinutes = weekStart * 60 + (offsetY / WEEK_HOUR_HEIGHT_PX) * 60;
        const snapped = Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES;
        const clamped = Math.max(weekStart * 60, Math.min(snapped, weekEnd * 60 - SNAP_MINUTES));
        timeH = Math.floor(clamped / 60);
        timeM = clamped % 60;
      } else {
        // Week grid element not found (should not happen). Use explicit default
        // rather than preserving original time, which would mask the bug.
        timeH = DEFAULT_SCHEDULE_HOUR;
        timeM = 0;
      }
      const newDay = new Date(y2, m2 - 1, d2, timeH, timeM, 0, 0);
      const startAt = newDay.toISOString();
      const endDt = addMinutes(newDay, dragData.durationMinutes);
      const endAt = endDt.toISOString();

      // 2026-03-30: Multi-day check — warn if end crosses midnight
      const crossesMidnight = endDt.getDate() !== newDay.getDate() || endDt.getMonth() !== newDay.getMonth();

      // 2026-03-30: Calendar drops have no technicianId — preserve source tech.
      // Tech-row drops provide explicit technicianId for reassignment.
      const hasExplicitTech = !!dropData.technicianId;
      const effectiveTechId = isDropOnUnassigned ? null : (hasExplicitTech ? dropData.technicianId : undefined);

      // Stabilization: version resolved internally by mutations from fresh cache
      const executeMutation = () => {
        if (dragData.type === "scheduled-task") {
          if (isDropOnUnassigned) return; // Tasks require an assignee
          rescheduleTask({
            taskId: dragData.visitId!,
            scheduledStartAt: startAt,
            scheduledEndAt: endAt,
            assignedToUserId: hasExplicitTech ? dropData.technicianId : (dragData.technicianId ?? undefined),
          });
        } else if (dragData.type === "unscheduled-visit") {
          // visitId may be undefined for backlog items without a persisted visit
          // 2026-04-12 final cleanup: canonical crew array.
          scheduleVisit({
            jobId: dragData.jobId,
            visitId: dragData.visitId,
            assignedTechnicianIds: effectiveTechId ? [effectiveTechId] : [],
            startAt,
            endAt,
          });
        } else if (dragData.type === "scheduled-visit") {
          // Scheduled visits always have a real persisted visitId
          const vid = dragData.visitId!;
          if (dragData.isMultiTech && !isDropOnUnassigned) {
            // 2026-03-30: Skip tech check for calendar drops (no tech context)
            if (hasExplicitTech) {
              const visit = allVisits.find(v => v.id === vid);
              const assignedIds = visit?.technicianIds ?? [];
              if (!assignedIds.includes(dropData.technicianId!)) {
                toast({
                  title: "Multi-tech visit",
                  description: "Change crew assignments from the visit detail panel.",
                });
                return;
              }
            }
            rescheduleVisit({ visitId: vid, jobId: dragData.jobId, startAt, endAt });
          } else {
            const techChanged = hasExplicitTech ? (dragData.technicianId !== dropData.technicianId) : false;
            // 2026-04-12 final cleanup: crew change → replace with [newTech];
            // unassigned lane → null; otherwise undefined (crew unchanged).
            const crewChange =
              isDropOnUnassigned
                ? null
                : techChanged && dropData.technicianId
                  ? [dropData.technicianId]
                  : undefined;
            // 2026-05-07 RALPH (technician time off): preflight
            // overlap check. If the resolved (tech, range) overlaps
            // a known time-off entry, defer the mutation behind the
            // confirmation dialog. Cancel → no-op. Confirm →
            // re-issue the mutation with overrideTimeOffConflict=true
            // so the server-side check (the safety net) accepts the
            // assignment without bouncing 409.
            const effectiveTechIds = isDropOnUnassigned
              ? []
              : crewChange ?? [dragData.technicianId].filter(Boolean);
            const tofEntries = checkTimeOffOverlap(
              effectiveTechIds as string[],
              startAt,
              endAt,
            );
            if (tofEntries.length > 0) {
              const offTech = sortedTechnicians.find(
                (t) => t.id === tofEntries[0].technicianUserId,
              );
              setTimeOffConfirm({
                techName: offTech?.name ?? "Technician",
                reason: tofEntries[0].reason,
                action: () => {
                  rescheduleVisit({
                    visitId: vid,
                    jobId: dragData.jobId,
                    assignedTechnicianIds: crewChange,
                    startAt,
                    endAt,
                    overrideTimeOffConflict: true,
                  });
                },
              });
              return;
            }
            rescheduleVisit({
              visitId: vid,
              jobId: dragData.jobId,
              assignedTechnicianIds: crewChange,
              startAt,
              endAt,
            });
          }
        }
      };

      // Off-shift check for week view drop target (skip for Unassigned lane and calendar drops)
      if (!isDropOnUnassigned && hasExplicitTech) {
        const [y, m, d] = dropData.dayKey.split("-").map(Number);
        const targetTech = sortedTechnicians.find(t => t.id === dropData.technicianId);
        const targetDate = new Date(y, m - 1, d);
        const isOffShiftOnDay = targetTech && !isTechWorkingOnDate(scheduleMap, targetTech.id, targetDate);
        if (isOffShiftOnDay && targetTech) {
          setOffShiftConfirm({ action: executeMutation, techName: targetTech.name });
          return;
        }
      }

      // 2026-03-30: Multi-day warning — require explicit confirmation before creating
      if (crossesMidnight) {
        setMultiDayConfirm({ action: executeMutation });
        return;
      }

      executeMutation();
      return;
    }

    // ── Day view drop — shared placement resolver (pixel-based, auto-resolve overlap) ──
    // Day view lanes always provide technicianId — guard ensures type safety
    if (!dropData.technicianId) return;
    const dayDropTechId = dropData.technicianId;
    const scrollEl = timelineScrollRef.current;
    if (!scrollEl) return;

    // Use native pointer position (same as dragPlacement preview) for consistency
    const finalX = dragPointerXRef.current;
    const relativeX = clientXToRelativePx(
      finalX,
      scrollEl.getBoundingClientRect(),
      scrollEl.scrollLeft,
      dragGrabBlockXRef.current,
    ) - ANY_TIME_COL_WIDTH;
    const laneVisits = visitsByTech.get(dayDropTechId) ?? [];
    const laneTasks = tasksByTech.get(dayDropTechId) ?? [];
    const placement = resolvePlacement(relativeX, dayDropTechId, dragData.durationMinutes, {
      selectedDate,
      startHour: tlConfig.startHour,
      endHour: tlConfig.endHour,
      laneVisits,
      laneTasks,
      excludeId: dragData.visitId,
    }, { autoResolveOverlap: true });
    if (!placement.isValid) {
      toast({ title: "Could not place visit", description: "Try dropping in an open time slot." });
      return;
    }

    const startAt = placement.startAt;
    const endAt = placement.endAt;

    // 2026-04-12 final cleanup: effective lead-tech for day-view drop; null for Unassigned lane.
    const effectiveTechId = isDropOnUnassigned ? null : dayDropTechId;

    // Stabilization: version resolved internally by mutations from fresh cache
    const executeMutation = () => {
      if (dragData.type === "scheduled-task") {
        if (isDropOnUnassigned) return; // Tasks require an assignee
        rescheduleTask({
          taskId: dragData.visitId!,
          scheduledStartAt: startAt,
          scheduledEndAt: endAt,
          assignedToUserId: dayDropTechId,
        });
      } else if (dragData.type === "unscheduled-visit") {
        // visitId may be undefined for backlog items without a persisted visit
        scheduleVisit({
          jobId: dragData.jobId,
          visitId: dragData.visitId,
          assignedTechnicianIds: effectiveTechId ? [effectiveTechId] : [],
          startAt,
          endAt,
        });
      } else if (dragData.type === "scheduled-visit") {
        // Scheduled visits always have a real persisted visitId
        const vid = dragData.visitId!;
        if (dragData.isMultiTech && !isDropOnUnassigned) {
          const visit = allVisits.find(v => v.id === vid);
          const assignedIds = visit?.technicianIds ?? [];
          const targetIsAssigned = assignedIds.includes(dayDropTechId);
          if (!targetIsAssigned) {
            toast({
              title: "Multi-tech visit",
              description: "Change crew assignments from the visit detail panel.",
            });
            return;
          }
          rescheduleVisit({
            visitId: vid,
            jobId: dragData.jobId,
            startAt,
            endAt,
          });
        } else {
          const techChanged = dragData.technicianId !== dayDropTechId;
          // 2026-04-12 final cleanup: canonical crew change semantics.
          const crewChange =
            isDropOnUnassigned
              ? null
              : techChanged
                ? [dayDropTechId]
                : undefined;
          rescheduleVisit({
            visitId: vid,
            jobId: dragData.jobId,
            assignedTechnicianIds: crewChange,
            startAt,
            endAt,
          });
        }
      }
    };

    // Off-shift check (skip for Unassigned lane)
    if (!isDropOnUnassigned) {
      const targetTech = sortedTechnicians.find(t => t.id === dayDropTechId);
      if (targetTech && targetTech.isWorking === false) {
        setOffShiftConfirm({ action: executeMutation, techName: targetTech.name });
        return;
      }
    }
    executeMutation();
  }, [activeDragData, selectedDate, activeView, show24Hour, scheduleVisit, rescheduleVisit, rescheduleTask, visitsByTech, tasksByTech, sortedTechnicians, scheduleMap, tlConfig, allVisits]);

  // ── Unschedule handler ──
  // Stabilization: version resolved internally by mutation from fresh cache
  const handleUnschedule = useCallback((visit: DispatchVisit) => {
    if (visit.kind !== "visit") return; // Guard: backlog items cannot be unscheduled (already unscheduled)
    unscheduleVisit({ visitId: visit.id, jobId: visit.jobId });
  }, [unscheduleVisit]);

  // ── Item 4: Schedule from detail panel (for unscheduled visits) ──
  // Item 2: Supports multi-tech — schedules with primary tech, then updates crew if additional techs
  // 2026-03-26: Pass real visit.visitId only (undefined for backlog items without a
  // persisted visit). Never fall back to visit.id which is the job UUID for backlog items.
  // 2026-04-12 final cleanup: full crew in one schedule call — no split
  // schedule-then-crew-patch sequence.
  const handleScheduleFromPanel = useCallback((visit: DispatchVisit, startAt: string, endAt: string, techId: string, additionalTechIds?: string[]) => {
    const crew = [techId, ...(additionalTechIds ?? [])];
    scheduleVisit({
      jobId: visit.jobId,
      visitId: visit.visitId ?? undefined,
      assignedTechnicianIds: crew,
      startAt,
      endAt,
    });
  }, [scheduleVisit]);

  // 2026-03-22: handleOpenVisitEditor removed — visits now open EditVisitModal
  // directly from handleSelectVisit. No intermediate dispatch panel for real visits.
  //
  // 2026-04-21 Phase 1 canonical visit mutation architecture:
  // handleUpdateStatus, handleUpdateCrew, handleUpdateVisitNotes removed.
  // DispatchDetailPanel does not mount for visits (visit-read-only rule),
  // so those callbacks had zero callers. All visit mutation surfaces now
  // flow through EditVisitModal (via VisitEditorLauncher), which consumes
  // `useDispatchPreviewMutations` directly. Adding a new "quick visit
  // action" on the dispatch board must go through that single engine —
  // do NOT reintroduce inline apiRequest mutations here.

  // ── Resize handlers ──
  const handleResize = useCallback((visit: DispatchVisit, newEndTime: string) => {
    if (visit.kind !== "visit") return; // Guard: backlog items cannot be resized
    resizeVisit({
      visitId: visit.id,
      jobId: visit.jobId,
      scheduledStart: visit.scheduledStart ?? "",
      scheduledEnd: visit.scheduledEnd ?? "",
      newEndTime,
    });
  }, [resizeVisit]);

  // 2026-03-30: Week view resize — wraps shared resizeVisit with multi-day check
  const handleWeekResize = useCallback((visit: DispatchVisit, newEndTime: string) => {
    if (visit.kind !== "visit") return;
    const newEnd = new Date(newEndTime);
    const start = visit.scheduledStart ? new Date(visit.scheduledStart) : null;
    // Check if resize crosses midnight
    if (start && (newEnd.getDate() !== start.getDate() || newEnd.getMonth() !== start.getMonth())) {
      setMultiDayConfirm({
        action: () => resizeVisit({
          visitId: visit.id,
          jobId: visit.jobId,
          scheduledStart: visit.scheduledStart ?? "",
          scheduledEnd: visit.scheduledEnd ?? "",
          newEndTime,
        }),
      });
      return;
    }
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
    if (visit.kind !== "visit") return; // Guard: backlog items use scheduleVisit, not reschedule
    const executeMutation = () => {
      // 2026-04-12 final cleanup: crew change only when techId provided.
      rescheduleVisit({
        visitId: visit.id,
        jobId: visit.jobId,
        assignedTechnicianIds: techId ? [techId] : undefined,
        startAt: newStart,
        endAt: newEnd,
        allDay,
      });
    };

    // Check if reassigning to an off-shift technician
    if (techId) {
      const targetTech = sortedTechnicians.find(t => t.id === techId);
      if (targetTech && targetTech.isWorking === false) {
        setOffShiftConfirm({ action: executeMutation, techName: targetTech.name });
        return;
      }
    }
    executeMutation();
  }, [rescheduleVisit, sortedTechnicians]);

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

  // ── Quick-create from empty slot click (canonical: SlotQuickCreateLauncher) ──
  // 2026-04-20 canonicalization: the prior 5-variable inline state
  // (`quickCreate`, `quickCreateJobOpen`, `quickCreateJobSchedule`,
  // `quickCreateTaskOpen`, `quickCreateTaskPrefill`) plus the inline
  // chooser Dialog + QuickAddJobDialog + TaskDialog mounts collapsed to
  // a single controlled `quickCreateSlot` fed into SlotQuickCreateLauncher.
  // The launcher owns all dialog state; Dispatch is now purely an entry
  // point that hands off {techId, tech name, date, start time, duration}.
  const [quickCreateSlot, setQuickCreateSlot] = useState<QuickCreateSlot | null>(null);
  const handleEmptySlotClick = useCallback((techId: string, minuteOfDay: number) => {
    if (techId === UNASSIGNED_TECH_ID) {
      toast({
        title: "Choose a technician lane",
        description: "Quick-create requires a specific technician lane.",
      });
      return;
    }
    const tech = sortedTechnicians.find(t => t.id === techId);
    const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
    const mm = String(minuteOfDay % 60).padStart(2, "0");
    setQuickCreateSlot({
      technicianId: techId,
      technicianName: tech?.name,
      date: selectedDate,
      startTime: `${hh}:${mm}`,
      // Explicitly pass 60min default to match prior Dispatch behavior; the
      // launcher also defaults to 60, but making it explicit here keeps
      // Dispatch's intent visible at the call site.
      durationMinutes: 60,
    });
  }, [toast, sortedTechnicians, selectedDate]);

  // ── Selection (detail panel) — supports both visits and tasks ──
  // Fix 5: Ref for detecting clicks outside the detail panel
  const panelRef = useRef<HTMLDivElement>(null);
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // 2026-04-20 canonicalization: state shape lifted to the shared
  // `VisitEditorState` consumed by `VisitEditorLauncher`. Non-null =
  // modal visible; null = closed. Both Dispatch and Dashboard feed this
  // same shape into the launcher.
  const [visitEditorState, setVisitEditorState] = useState<VisitEditorState | null>(null);

  // Draggable floating panel: offset from center (user can drag the panel around)
  const [panelDragOffset, setPanelDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const panelDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // 2026-03-22: Clicking any visit with a real visitId opens EditVisitModal directly.
  // Both scheduled (kind="visit") and unscheduled (kind="backlog") items can carry
  // a visitId. Items without a visitId (rare edge case: no active visit exists)
  // are not actionable — the user needs to schedule the job first.
  const handleSelectVisit = useCallback(async (visit: DispatchVisit) => {
    setSelectedTaskId(null);
    const effectiveVisitId = visit.visitId;
    if (effectiveVisitId) {
      // 2026-04-24: ALWAYS route through the canonical adapter so this page
      // obeys the same hydration contract as Dashboard / JobDetailPage. The
      // DispatchVisit payload already carries customerName + locationId, so
      // the adapter fast-paths and returns the partial unchanged — zero
      // network cost, uniform contract, no dispatch-specific branching.
      // 2026-03-23: Include location context for modal header
      const addressParts = [visit.locationAddress, visit.locationCity, visit.locationProvinceState].filter(Boolean);
      const state = await enrichVisitEditorState(effectiveVisitId, visit.jobId, {
        customerName: visit.customerName,
        customerCompanyId: visit.customerCompanyId || undefined,
        jobNumber: visit.jobNumber,
        jobSummary: visit.summary,
        locationName: visit.locationName,
        locationAddress: addressParts.join(", "),
        locationId: visit.locationId || undefined,
      });
      setVisitEditorState(state);
    }
    // Items without a visitId: no-op (schedule the job via drag-to-lane first)
  }, []);

  const handleSelectTask = useCallback((task: DispatchTask) => {
    setSelectedVisitId(null);
    setSelectedTaskId(prev => {
      const next = prev === task.id ? null : task.id;
      if (next !== prev) setPanelDragOffset({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedVisitId(null);
    setSelectedTaskId(null);
    // Reset drag offset so next open starts centered
    setPanelDragOffset({ x: 0, y: 0 });
  }, []);

  // 2026-03-21: handleDeleteVisit removed — delete now handled by canonical EditVisitModal.

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
      setPanelDragOffset({ x: 0, y: 0 });
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [selectedVisitId, selectedTaskId]);

  // Escape key closes the quick editor and resets drag offset
  useEffect(() => {
    if (!selectedVisitId && !selectedTaskId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedVisitId(null);
        setSelectedTaskId(null);
        setPanelDragOffset({ x: 0, y: 0 });
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selectedVisitId, selectedTaskId]);

  // ── Drag preview node — renders from shared dragPlacement result (same pattern as click preview) ──
  const dragPreviewNode = useMemo(() => {
    if (!dragPlacement) return null;
    const bgColor = dragPlacement.hasOverlap
      ? "bg-red-200/60 border-red-500"
      : "bg-emerald-200/50 border-emerald-400";
    return (
      <div
        className={`pointer-events-none absolute top-0 bottom-0 rounded border-2 border-dashed ${bgColor} z-30`}
        style={{ left: dragPlacement.previewLeft, width: dragPlacement.previewWidth }}
      >
        <div className={`absolute -top-6 left-0 rounded px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap shadow ${
          dragPlacement.hasOverlap ? "bg-red-600 text-white" : "bg-emerald-700 text-white"
        }`}>
          {dragPlacement.startTimeLabel} – {dragPlacement.endTimeLabel}
        </div>
        {dragPlacement.hasOverlap && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-md uppercase tracking-wide">Overlap</div>
          </div>
        )}
      </div>
    );
  }, [dragPlacement]);

  // ── Error state ──
  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-app-bg">
        <div className="text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-red-400 mb-2" />
          <p className="text-sm font-medium text-foreground">Failed to load dispatch data</p>
          <p className="text-helper text-muted-foreground mt-1">{error.message}</p>
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
    const selectedVisitPrimaryTech = selectedVisit?.technicianIds[0] ?? null;
    if (selectedVisitPrimaryTech) {
      return {
        visits: visitsByTech.get(selectedVisitPrimaryTech) ?? [],
        tasks: tasksByTech.get(selectedVisitPrimaryTech) ?? [],
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

  // ── Floating detail panel — centered overlay with drag support ──
  // Panel drag handler: mousedown on the drag-handle area starts tracking.
  // Cleanup ref ensures mousemove/mouseup listeners are removed on unmount
  // even if the user hasn't released the mouse (e.g., tab switch, navigation).
  const panelDragCleanupRef = useRef<(() => void) | null>(null);
  const handlePanelDragStart = useCallback((e: React.MouseEvent) => {
    // Only drag from the header drag-handle area, not from interactive elements
    const target = e.target as HTMLElement;
    if (target.closest("a, button, input, select, textarea, [data-radix-popper-content-wrapper]")) return;
    // Only allow drag from the header region (marked with data-panel-drag-handle)
    if (!target.closest("[data-panel-drag-handle]")) return;
    e.preventDefault();
    // Clean up any prior drag listeners (defensive against rapid re-drags)
    panelDragCleanupRef.current?.();
    panelDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: panelDragOffset.x,
      origY: panelDragOffset.y,
    };
    const onMove = (me: MouseEvent) => {
      if (!panelDragRef.current) return;
      setPanelDragOffset({
        x: panelDragRef.current.origX + (me.clientX - panelDragRef.current.startX),
        y: panelDragRef.current.origY + (me.clientY - panelDragRef.current.startY),
      });
    };
    const onUp = () => {
      panelDragRef.current = null;
      panelDragCleanupRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    panelDragCleanupRef.current = onUp;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [panelDragOffset]);
  // Cleanup: remove orphaned panel drag listeners on unmount
  useEffect(() => {
    return () => { panelDragCleanupRef.current?.(); };
  }, []);

  const panelStyle: React.CSSProperties = {
    position: "fixed",
    top: `calc(50% + ${panelDragOffset.y}px)`,
    left: `calc(50% + ${panelDragOffset.x}px)`,
    transform: "translate(-50%, -50%)",
    zIndex: 50,
    maxHeight: "85vh",
  };

  // 2026-03-22: Floating panel is now only used for tasks. Real visits open
  // EditVisitModal directly (no intermediate panel). Backlog items are not selectable.
  const floatingEditor = selectedTask ? (
    <div ref={panelRef} style={panelStyle} className="flex flex-col" onMouseDown={handlePanelDragStart}>
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
        mode="popover"
      />
    </div>
  ) : null;

  // 2026-04-20 canonicalization: inline EditVisitModal mount removed —
  // the render block below uses <VisitEditorLauncher/> which wraps the
  // same modal with the same props. Dispatch-specific optimistic-cache
  // callbacks (scheduleVisit / rescheduleVisit / updateVisitCrew) are
  // threaded through the launcher as before. Dashboard mounts the exact
  // same launcher without those callbacks, matching the JobDetailPage
  // pattern.

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full flex-col bg-app-bg">
        {/* Header with view toggle */}
        <DispatchBoardHeader
          selectedDate={selectedDate}
          onPrevDay={onPrevDay}
          onNextDay={onNextDay}
          onToday={onToday}
          activeView={activeView}
          onViewChange={handleViewChange}
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
          includeUnassigned
          showHideWeekends={activeView === "week"}
          hideWeekends={hideWeekends}
          onToggleHideWeekends={onToggleHideWeekends}
          showMap={showMap}
          onToggleMap={() => setShowMap(prev => !prev)}
          showUnscheduledOnMap={showUnscheduledOnMap}
          onToggleUnscheduledOnMap={() => setShowUnscheduledOnMap(prev => !prev)}
          showRoutes={showRoutes}
          onToggleRoutes={() => setShowRoutes(prev => !prev)}
        />


        {/* Lead visits strip — overflow surface for unassigned / unscheduled
            pre-sales visits only. Assigned + scheduled lead visits are placed
            in their technician lane via leadVisitsByTech → DispatchTimeline.
            Click → /leads/:id. Lead visits NEVER assume job fields. */}
        {activeView === "day" && (() => {
          const stripLeadVisits = leadVisits.filter(
            (lv) => lv.technicianIds.length === 0 || !lv.scheduledStart,
          );
          return stripLeadVisits.length > 0 ? (
            <LeadVisitsStrip
              visits={stripLeadVisits}
              onOpenLead={(leadId) => setLocation(`/leads/${leadId}`)}
            />
          ) : null;
        })()}

        {/* Main content area */}
        <div className="flex flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400 mb-2" />
                <p className="text-helper text-muted-foreground">Loading dispatch board...</p>
              </div>
            </div>
          ) : activeView === "day" ? (
            /* ── Day View ── */
            <>
              <DispatchTechnicianSidebar
                technicians={visibleTechs}
                techsOnTimeOff={techsOnTimeOff}
              />
              <DispatchTimeline
                technicians={visibleTechs}
                visitsByTech={visitsByTech}
                tasksByTech={tasksByTech}
                leadVisitsByTech={leadVisitsByTech}
                timeOffByTech={timeOffByTech}
                dayDateISO={selectedDate.toISOString()}
                savingIds={savingIds}
                selectedVisitId={selectedVisitId}
                selectedTaskId={selectedTaskId}
                onSelectVisit={handleSelectVisit}
                onSelectTask={handleSelectTask}
                onSelectLeadVisit={(lv) => setLocation(`/leads/${lv.leadId}`)}
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
              {/* Right region: Unscheduled (always) + Map (additive) — Day view
                   2026-03-31: Map toggle moved to DispatchFiltersBar. Panels are in-flow siblings. */}
              <DispatchUnscheduledPanel
                visits={unscheduledVisits}
                savingIds={savingIds}
                selectedVisitId={selectedVisitId}
                onSelectVisit={handleSelectVisit}
              />
              {showMap && (
                <div className="flex h-full flex-shrink-0 flex-col border-l bg-white" style={{ width: "clamp(700px, 40vw, 50%)" }}>
                  <DispatchMapPanel
                    visits={mapVisits}
                    technicians={technicians}
                    liveTechnicians={liveTechnicians}
                    isDragging={!!activeDragData}
                    showRoutes={showRoutes}
                  />
                </div>
              )}
            </>
          ) : activeView === "week" ? (
            /* ── Week View ── */
            <>
              <WeekDispatchGrid
                technicians={weekVisibleTechs}
                weekDays={filteredWeekDays}
                visitsByTechByDay={filteredWeekVisits}
                tasksByTechByDay={filteredWeekTasks}
                leadVisitsByDay={weekData.leadVisitsByDay}
                selectedItemId={selectedVisitId ?? selectedTaskId}
                savingIds={savingIds}
                onSelectVisit={handleSelectVisit}
                onSelectTask={handleSelectTask}
                onOpenLead={(leadId) => setLocation(`/leads/${leadId}`)}
                onResize={handleWeekResize}
                show24Hour={show24Hour}
                techsOnTimeOffByDay={techsOnTimeOffByDay}
                timeOffEntriesByDay={timeOffEntriesByDay}
              />
              {/* Right region: Unscheduled (always) + Map (additive) — Week view */}
              <DispatchUnscheduledPanel
                visits={unscheduledVisits}
                savingIds={savingIds}
                selectedVisitId={selectedVisitId}
                onSelectVisit={handleSelectVisit}
              />
              {showMap && (
                <div className="flex h-full flex-shrink-0 flex-col border-l bg-white" style={{ width: "clamp(700px, 40vw, 50%)" }}>
                  <DispatchMapPanel
                    visits={mapVisits}
                    technicians={technicians}
                    liveTechnicians={liveTechnicians}
                    isDragging={!!activeDragData}
                    showRoutes={showRoutes}
                  />
                </div>
              )}
            </>
          ) : (
            /* ── Month View ── */
            <>
              <MonthDispatchGrid
                selectedDate={selectedDate}
                visitsByDay={monthData.visitsByDay}
                leadVisitsByDay={monthData.leadVisitsByDay}
                techColorMap={monthTechColorMap}
                selectedVisitId={selectedVisitId}
                onSelectVisit={handleSelectVisit}
                onOpenLead={(leadId) => setLocation(`/leads/${leadId}`)}
                techsOnTimeOffByDay={techsOnTimeOffByDay}
                timeOffEntriesByDay={timeOffEntriesByDay}
              />
              {/* Right region: Unscheduled (always) — Month view */}
              <DispatchUnscheduledPanel
                visits={unscheduledVisits}
                savingIds={savingIds}
                selectedVisitId={selectedVisitId}
                onSelectVisit={handleSelectVisit}
              />
            </>
          )}
        </div>
      </div>

      {/* Floating detail panel — centered draggable overlay for visit/task inspection */}
      {floatingEditor}

      {/* 2026-04-21 Phase 1: Canonical Edit Visit launcher — shared with Dashboard.
          The launcher + modal consume `useDispatchPreviewMutations` internally;
          pages never pass callbacks. Every mounting surface gets the same save
          behavior by construction. */}
      <VisitEditorLauncher
        state={visitEditorState}
        onClose={() => {
          setVisitEditorState(null);
          handleCloseDetail();
        }}
        onAfterMutation={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
          queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
        }}
      />

      {/* Drag overlay — Phase 8: suppress floating ghost when in-grid preview is active
          to avoid redundant dual visuals (pale-blue ghost + green grid preview).
          Ghost only shows while dragging outside the board or before a lane is detected. */}
      <DragOverlay dropAnimation={null}>
        {!dragPlacement && draggedVisit && (
          <div className="pointer-events-none rounded border border-[#76B054] bg-[rgba(118,176,84,0.08)] px-2 py-1 shadow-md opacity-70 max-w-[160px]"
            style={{ transform: `translate(${dragGrabOffsetRef.current.x - 10}px, ${dragGrabOffsetRef.current.y - 10}px)` }}>
            <p className="text-[10px] font-semibold text-[#39833A] truncate">{draggedVisit.customerName}</p>
            <p className="text-[9px] text-[#76B054]">#{draggedVisit.jobNumber}</p>
          </div>
        )}
        {!dragPlacement && draggedTask && (
          <div className="pointer-events-none rounded border border-dashed border-violet-300 bg-violet-50 px-2 py-1 shadow-md opacity-70 max-w-[160px]"
            style={{ transform: `translate(${dragGrabOffsetRef.current.x - 10}px, ${dragGrabOffsetRef.current.y - 10}px)` }}>
            <p className="text-[10px] font-semibold text-violet-800 truncate">{draggedTask.title}</p>
            <p className="text-[9px] text-violet-600 truncate">{draggedTask.type}</p>
          </div>
        )}
      </DragOverlay>

      {/* 2026-05-07 RALPH (technician time off): assignment-onto-off
          confirmation. Mirrors the off-shift dialog right below it.
          Cancel → no-op. Assign anyway → invokes the deferred
          mutation, which forwards `overrideTimeOffConflict: true` to
          the server so the time-off check is bypassed. */}
      <AlertDialog
        open={!!timeOffConfirm}
        onOpenChange={(open) => {
          if (!open) setTimeOffConfirm(null);
        }}
      >
        <AlertDialogContent data-testid="dispatch-time-off-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Assign visit on technician's time off?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{timeOffConfirm?.techName}</strong> is marked off
              {timeOffConfirm?.reason ? ` (${timeOffConfirm.reason})` : ""}{" "}
              during this time. Assign the visit anyway?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setTimeOffConfirm(null)}
              data-testid="dispatch-time-off-confirm-cancel"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                timeOffConfirm?.action();
                setTimeOffConfirm(null);
              }}
              data-testid="dispatch-time-off-confirm-accept"
            >
              Assign anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      {/* 2026-03-30: Multi-day visit confirmation dialog */}
      <AlertDialog open={!!multiDayConfirm} onOpenChange={(open) => { if (!open) setMultiDayConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create multi-day visit?</AlertDialogTitle>
            <AlertDialogDescription>
              This change will create a multi-day visit that crosses midnight into the next day. Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setMultiDayConfirm(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              multiDayConfirm?.action();
              setMultiDayConfirm(null);
            }}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 2026-04-20: Canonical quick-create launcher — shared with
          Dashboard. Owns the chooser Dialog + QuickAddJobDialog +
          TaskDialog mounts and all their state. Dispatch only feeds it
          a slot context via `handleEmptySlotClick`. */}
      <SlotQuickCreateLauncher
        slot={quickCreateSlot}
        onClose={() => setQuickCreateSlot(null)}
        onTaskChanged={() => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] })}
      />
    </DndContext>
  );
}

// ─── Lead-visits strip (2026-05-05 Phase 3) ──────────────────────────
//
// Day-view-only ribbon above the technician timeline. Each row is a
// scheduled lead visit; the LEAD badge + amber tint + lower visual
// weight signal "this is pre-sales, not a job." Click → /leads/:id.
// Branches strictly on `type === "lead_visit"` so consumers never
// assume job fields. No drag, no resize, no status workflow — those
// are job-only concerns.

function LeadVisitsStrip({
  visits,
  onOpenLead,
}: {
  visits: DispatchLeadVisit[];
  onOpenLead: (leadId: string) => void;
}) {
  // Sort chronologically by scheduled start (unscheduled at end).
  const sorted = [...visits].sort((a, b) => {
    if (a.scheduledStart && b.scheduledStart) {
      return a.scheduledStart.localeCompare(b.scheduledStart);
    }
    if (a.scheduledStart) return -1;
    if (b.scheduledStart) return 1;
    return 0;
  });

  return (
    <div
      className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 flex-shrink-0"
      data-testid="dispatch-lead-visits-strip"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
          <span className="inline-flex items-center px-1.5 py-0 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-200 text-amber-800">
            Lead
          </span>
          Lead visits ({sorted.length})
        </span>
        <span className="text-[10px] text-amber-700/70 italic">
          Pre-sales onsite
        </span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-1.5 max-h-[100px] overflow-y-auto">
        {sorted.map((v) => {
          // Pure-render branch: NEVER reads jobNumber / jobStatus / etc.
          // Spec invariant — lead visits never assume job fields.
          if (v.type !== "lead_visit") return null;
          const time = v.scheduledStart
            ? format(new Date(v.scheduledStart), "h:mm a")
            : "Unscheduled";
          const place = [v.locationName, v.locationCity]
            .filter(Boolean)
            .join(" · ");
          const techLabel =
            v.technicianNames.length === 0
              ? "Unassigned"
              : v.technicianNames.length === 1
                ? v.technicianNames[0]
                : `${v.technicianNames[0]} +${v.technicianNames.length - 1}`;
          return (
            <button
              key={v.id}
              onClick={() => onOpenLead(v.leadId)}
              className="text-left bg-white border border-amber-300 hover:border-amber-400 hover:bg-amber-50 rounded px-2 py-1.5 transition-colors"
              data-testid={`dispatch-lead-visit-${v.id}`}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                  Lead
                </span>
                <span className="text-[11px] font-semibold text-slate-700 tabular-nums">
                  {time}
                </span>
                {v.durationMinutes && (
                  <span className="text-[10px] text-slate-400">
                    {v.durationMinutes}m
                  </span>
                )}
              </div>
              <p className="text-[12px] font-medium text-slate-800 truncate">
                {v.leadTitle}
              </p>
              <p className="text-[10px] text-slate-500 truncate">{techLabel}</p>
              {place && (
                <p className="text-[10px] text-slate-400 truncate">{place}</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
