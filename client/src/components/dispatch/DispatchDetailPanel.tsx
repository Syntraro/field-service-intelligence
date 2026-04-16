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
import { visitStatusColor, formatDuration, isCompletedStatus, normalizeVisitStatusForDisplay, SNAP_MINUTES, TIMELINE_START_HOUR, TIMELINE_END_HOUR, jobStateColor, jobStateLabel } from "./dispatchPreviewUtils";
import { visitStatusLabel } from "@/lib/visitStatusDisplay";
import { clampResizeEnd, findNearestValidSlot } from "./dispatchOverlapUtils";
// 2026-03-21: NeedsFollowUpModal removed — lifecycle actions now routed through
// canonical EditVisitModal opened via onOpenVisitEditor callback.

type VisitProps = {
  entityType: "visit";
  visit: DispatchVisit;
  technicians?: Technician[];
  laneVisits?: DispatchVisit[];
  laneTasks?: DispatchTask[];
  onClose: () => void;
  onUnschedule?: (visit: DispatchVisit) => void;
  onReschedule?: (visit: DispatchVisit, newStart: string, newEnd: string, techId?: string, allDay?: boolean) => void;
  onResize?: (visit: DispatchVisit, newEndTime: string) => void;
  onUpdateCrew?: (visit: DispatchVisit, technicianIds: string[]) => void;
  onUpdateStatus?: (visit: DispatchVisit, status: string) => void;
  onUpdateVisitNotes?: (visit: DispatchVisit, notes: string) => void;
  /** 2026-03-21: Opens canonical EditVisitModal for lifecycle actions (complete, reopen, delete).
   *  Replaces former onCompleteVisitWithOutcome / onReopenVisit / onDeleteVisit props. */
  onOpenVisitEditor?: (visit: DispatchVisit) => void;
  /** Item 4: Handler for scheduling an unscheduled visit from the detail panel.
   *  Item 2: Supports multi-tech — additionalTechIds for crew assignment after scheduling. */
  onScheduleFromPanel?: (visit: DispatchVisit, startAt: string, endAt: string, techId: string, additionalTechIds?: string[]) => void;
  /** Dispatch board's currently selected date — prefills scheduling form date */
  boardDate?: Date;
  /** When "popover", renders as a compact overlay instead of a full-height sidebar */
  mode?: "sidebar" | "popover";
};

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

type Props = VisitProps | TaskProps;

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
// CrewPicker — searchable multi-select popover
// Stays open during multi-select. Closes on outside click.
// ============================================================================

function CrewPicker({
  visit,
  technicians,
  onUpdateCrew,
}: {
  visit: DispatchVisit;
  technicians: Technician[];
  onUpdateCrew: (visit: DispatchVisit, technicianIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const currentIds = visit.technicianIds.length > 0
    ? visit.technicianIds
    : (visit.technicianId ? [visit.technicianId] : []);

  const filtered = useMemo(() => {
    if (!search.trim()) return technicians;
    const q = search.toLowerCase();
    return technicians.filter((t) => t.name.toLowerCase().includes(q));
  }, [technicians, search]);

  const handleToggle = useCallback((techId: string) => {
    const isAssigned = currentIds.includes(techId);
    if (isAssigned) {
      if (currentIds.length <= 1) return; // min-1-tech rule
      onUpdateCrew(visit, currentIds.filter(id => id !== techId));
    } else {
      onUpdateCrew(visit, [...currentIds, techId]);
    }
  }, [visit, currentIds, onUpdateCrew]);

  // Collapsed display
  const assignedNames = technicians
    .filter(t => currentIds.includes(t.id))
    .map(t => t.name.split(" ")[0]);

  const summary = assignedNames.length === 0
    ? "No technicians"
    : assignedNames.length <= 2
      ? assignedNames.join(", ")
      : `${assignedNames[0]} +${assignedNames.length - 1}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex w-full items-center gap-2 rounded border px-2 py-1.5 text-xs hover:bg-slate-50 transition-colors">
          <Users className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="flex-1 text-left truncate">{summary}</span>
          <span className="text-xs text-blue-600 font-medium flex-shrink-0">{currentIds.length}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0 z-[9999]" align="start">
        {/* Search */}
        <div className="flex items-center border-b px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground mr-2 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search technicians..."
            className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground"
            autoFocus
          />
        </div>
        {/* Checkbox list */}
        <div className="max-h-[240px] overflow-y-auto p-1" style={{ scrollbarWidth: "thin" }}>
          {filtered.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-3">No match</div>
          ) : (
            filtered.map(t => {
              const isAssigned = currentIds.includes(t.id);
              const isOnlyMember = isAssigned && currentIds.length <= 1;
              const isOffShift = t.isWorking === false;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleToggle(t.id)}
                  disabled={isOnlyMember}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors ${
                    isAssigned
                      ? "bg-[rgba(118,176,84,0.08)] text-[#39833A] hover:bg-[#C2E974]"
                      : isOffShift
                        ? "text-slate-400 hover:bg-slate-50"
                        : "text-foreground hover:bg-slate-50"
                  } ${isOnlyMember ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <Checkbox
                    checked={isAssigned}
                    disabled={isOnlyMember}
                    className="pointer-events-none"
                    tabIndex={-1}
                  />
                  <div
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[8px] font-semibold text-white ${isOffShift && !isAssigned ? "opacity-50" : ""}`}
                    style={{ backgroundColor: t.color }}
                  >
                    {t.initials}
                  </div>
                  <span className="flex-1 text-left truncate">{t.name}</span>
                  {isOffShift && !isAssigned && (
                    <span className="text-[8px] text-slate-400 uppercase tracking-wide flex-shrink-0">off</span>
                  )}
                </button>
              );
            })
          )}
        </div>
        {/* Footer */}
        {currentIds.length > 1 && (
          <p className="px-2 py-1.5 text-xs text-blue-600 leading-tight border-t">
            Schedule changes apply to all {currentIds.length} assigned technicians.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ============================================================================
// Item 4: UnscheduledScheduleForm — inline date/time/tech picker for backlog visits
// ============================================================================

function UnscheduledScheduleForm({
  visit,
  technicians,
  onSchedule,
  boardDate,
}: {
  visit: DispatchVisit;
  technicians: Technician[];
  /** Item 2: Accepts techIds array for multi-tech assignment */
  onSchedule?: (visit: DispatchVisit, startAt: string, endAt: string, techId: string, additionalTechIds?: string[]) => void;
  /** Dispatch board's currently selected date — used as default prefill */
  boardDate?: Date;
}) {
  // Prefill date from dispatch board's selected day (not today unless board is on today)
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(boardDate);
  const [selectedTime, setSelectedTime] = useState("09:00");
  const [selectedTechIds, setSelectedTechIds] = useState<string[]>(visit.technicianId ? [visit.technicianId] : []);
  const [selectedDuration, setSelectedDuration] = useState(String(visit.durationMinutes || 60));
  const [techSearchOpen, setTechSearchOpen] = useState(false);
  const [techSearch, setTechSearch] = useState("");

  const canSchedule = selectedDate && selectedTechIds.length > 0 && onSchedule;

  const handleSchedule = useCallback(() => {
    if (!canSchedule || !selectedDate) return;
    const [h, m] = selectedTime.split(":").map(Number);
    const start = new Date(selectedDate);
    start.setHours(h, m, 0, 0);
    const dur = parseInt(selectedDuration, 10) || 60;
    const end = addMinutes(start, dur);
    const additionalIds = selectedTechIds.length > 1 ? selectedTechIds.slice(1) : undefined;
    onSchedule(visit, start.toISOString(), end.toISOString(), selectedTechIds[0], additionalIds);
  }, [canSchedule, selectedDate, selectedTime, selectedDuration, selectedTechIds, visit, onSchedule]);

  const handleToggleTech = useCallback((techId: string) => {
    setSelectedTechIds(prev => {
      if (prev.includes(techId)) {
        return prev.filter(id => id !== techId);
      }
      return [...prev, techId];
    });
  }, []);

  const filteredTechs = useMemo(() => {
    if (!techSearch.trim()) return technicians;
    const q = techSearch.toLowerCase();
    return technicians.filter(t => t.name.toLowerCase().includes(q));
  }, [technicians, techSearch]);

  const selectedNames = technicians.filter(t => selectedTechIds.includes(t.id)).map(t => t.name.split(" ")[0]);
  const techSummary = selectedNames.length === 0
    ? "Select technicians..."
    : selectedNames.length <= 2
      ? selectedNames.join(", ")
      : `${selectedNames[0]} +${selectedNames.length - 1}`;

  if (!onSchedule) {
    return <p className="text-xs text-muted-foreground italic">Not yet scheduled</p>;
  }

  return (
    <div className="space-y-2">
      {/* Date picker */}
      <div className="flex items-center gap-2 py-0.5">
        <CalendarDays className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <Popover>
          <PopoverTrigger asChild>
            <button className="text-xs font-medium hover:text-[#76B054] hover:underline transition-colors">
              {selectedDate ? format(selectedDate, "EEE, MMM d, yyyy") : "Select date..."}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 z-[9999]" align="start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>
      {/* Time */}
      <div className="flex items-center gap-2 py-0.5">
        <Clock className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <Input
          type="time"
          value={selectedTime}
          onChange={e => setSelectedTime(e.target.value)}
          step={SNAP_MINUTES * 60}
          className="h-7 w-28 text-xs"
        />
      </div>
      {/* Duration */}
      <div className="flex items-center gap-2 py-0.5">
        <Clock className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground opacity-0" />
        <Select value={selectedDuration} onValueChange={setSelectedDuration}>
          <SelectTrigger className="h-7 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DURATION_OPTIONS.map(d => (
              <SelectItem key={d} value={String(d)} className="text-xs">{formatDuration(d)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {/* Item 2: Multi-tech assignment with searchable checkbox popover */}
      {technicians.length > 0 && (
        <Popover open={techSearchOpen} onOpenChange={setTechSearchOpen}>
          <PopoverTrigger asChild>
            <button className="flex w-full items-center gap-2 rounded border px-2 py-1.5 text-xs hover:bg-slate-50 transition-colors">
              <Users className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="flex-1 text-left truncate">{techSummary}</span>
              {selectedTechIds.length > 0 && (
                <span className="text-xs text-blue-600 font-medium flex-shrink-0">{selectedTechIds.length}</span>
              )}
              <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0 z-[9999]" align="start">
            <div className="flex items-center border-b px-2 py-1.5">
              <Search className="h-3.5 w-3.5 text-muted-foreground mr-2 shrink-0" />
              <input
                value={techSearch}
                onChange={(e) => setTechSearch(e.target.value)}
                placeholder="Search technicians..."
                className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground"
                autoFocus
              />
            </div>
            <div className="max-h-[240px] overflow-y-auto p-1">
              {filteredTechs.map(t => {
                const isSelected = selectedTechIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleToggleTech(t.id)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors ${
                      isSelected ? "bg-[rgba(118,176,84,0.08)] text-[#39833A] hover:bg-[#C2E974]" : "text-foreground hover:bg-slate-50"
                    } cursor-pointer`}
                  >
                    <Checkbox checked={isSelected} className="pointer-events-none" tabIndex={-1} />
                    <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[8px] font-semibold text-white" style={{ backgroundColor: t.color }}>
                      {t.initials}
                    </div>
                    <span className="flex-1 text-left truncate">{t.name}</span>
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      )}
      {/* Schedule button */}
      <button
        onClick={handleSchedule}
        disabled={!canSchedule}
        className="flex w-full items-center justify-center gap-1.5 rounded bg-[#76B054] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#5F9442] disabled:opacity-40 disabled:cursor-not-allowed transition-colors mt-1"
      >
        <CalendarDays className="h-3 w-3" /> Schedule Visit
      </button>
    </div>
  );
}

// ============================================================================
// VisitDetail — client-first hierarchy, inline date editing
// ============================================================================

function VisitDetail({ visit, onClose, onUnschedule, onReschedule, onResize, onUpdateCrew, onUpdateStatus, onUpdateVisitNotes, onOpenVisitEditor, onScheduleFromPanel, technicians, laneVisits = [], laneTasks = [], boardDate, mode = "sidebar" }: Omit<VisitProps, "entityType">) {
  const isScheduled = !!visit.scheduledStart;
  const isCompleted = isCompletedStatus(visit.status);

  // ── Inline tech change (keeps same time) ──
  const handleTechChange = useCallback((newTechId: string) => {
    if (!onReschedule || !visit.scheduledStart) return;
    const dur = visit.durationMinutes * 60000;
    const newEnd = new Date(new Date(visit.scheduledStart).getTime() + dur).toISOString();
    onReschedule(visit, visit.scheduledStart, newEnd, newTechId);
  }, [visit, onReschedule]);

  // ── Inline duration editing — overlap-clamped ──
  const handleDurationChange = useCallback((newDurStr: string) => {
    const newDur = parseInt(newDurStr, 10);
    if (isNaN(newDur) || !visit.scheduledStart) return;
    const start = new Date(visit.scheduledStart);
    const startMin = start.getHours() * 60 + start.getMinutes();
    const proposedEndMin = startMin + newDur;
    const clampedEndMin = clampResizeEnd(startMin, proposedEndMin, laneVisits, laneTasks, visit.id, TIMELINE_END_HOUR);
    const clampedDur = clampedEndMin - startMin;
    if (clampedDur < SNAP_MINUTES) return;
    const newEnd = addMinutes(start, clampedDur).toISOString();
    if (onResize) {
      onResize(visit, newEnd);
    } else if (onReschedule) {
      onReschedule(visit, visit.scheduledStart, newEnd);
    }
  }, [visit, onResize, onReschedule, laneVisits, laneTasks]);

  // ── Inline start time editing — overlap-validated ──
  const [editingStartTime, setEditingStartTime] = useState<string | null>(null);
  const currentStartTime = useMemo(() => {
    if (!visit.scheduledStart) return "";
    return format(new Date(visit.scheduledStart), "HH:mm");
  }, [visit.scheduledStart]);

  const handleStartTimeCommit = useCallback((timeStr: string) => {
    if (!onReschedule || !visit.scheduledStart) return;
    setEditingStartTime(null);
    if (timeStr === currentStartTime) return;
    const oldStart = new Date(visit.scheduledStart);
    const [h, m] = timeStr.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return;
    const proposedStartMin = h * 60 + m;
    const validStartMin = findNearestValidSlot(
      proposedStartMin, visit.durationMinutes, laneVisits, visit.id,
      SNAP_MINUTES, TIMELINE_START_HOUR, TIMELINE_END_HOUR, laneTasks,
    );
    if (validStartMin === null) return;
    const newStart = new Date(oldStart);
    newStart.setHours(Math.floor(validStartMin / 60), validStartMin % 60, 0, 0);
    const newEnd = addMinutes(newStart, visit.durationMinutes).toISOString();
    onReschedule(visit, newStart.toISOString(), newEnd);
  }, [visit, onReschedule, currentStartTime, laneVisits, laneTasks]);

  // ── Inline date editing — preserves time and duration ──
  const handleDateChange = useCallback((newDate: Date | undefined) => {
    if (!newDate || !onReschedule || !visit.scheduledStart) return;
    const oldStart = new Date(visit.scheduledStart);
    const newStart = new Date(newDate);
    // Preserve the original time-of-day
    newStart.setHours(oldStart.getHours(), oldStart.getMinutes(), oldStart.getSeconds(), 0);
    const newEnd = addMinutes(newStart, visit.durationMinutes).toISOString();
    onReschedule(visit, newStart.toISOString(), newEnd);
  }, [visit, onReschedule]);

  // For all-day visits, derive date from UTC to avoid timezone-shifted display
  // e.g., "2026-03-09T00:00:00.000Z" in EST would show as March 8 without this fix
  const selectedDate = useMemo(() => {
    if (!visit.scheduledStart) return undefined;
    if (visit.isAllDay) {
      // Extract UTC date parts to avoid local timezone shift
      const d = new Date(visit.scheduledStart);
      return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    return new Date(visit.scheduledStart);
  }, [visit.scheduledStart, visit.isAllDay]);

  // Format date display — use UTC for all-day visits to avoid off-by-one
  const displayDateStr = useMemo(() => {
    if (!visit.scheduledStart) return "";
    if (visit.isAllDay) {
      // Use UTC date parts directly
      const d = new Date(visit.scheduledStart);
      const localEquiv = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      return format(localEquiv, "EEE, MMM d, yyyy");
    }
    return format(new Date(visit.scheduledStart), "EEE, MMM d, yyyy");
  }, [visit.scheduledStart, visit.isAllDay]);

  // ── Any Time checkbox state — local edit state, doesn't save until user interaction ──
  // null = no pending change (follow visit.isAllDay)
  const [pendingAnyTime, setPendingAnyTime] = useState<boolean | null>(null);
  const isAnyTime = pendingAnyTime ?? visit.isAllDay;

  // Default time/duration when converting from Any Time → scheduled
  const [conversionTime, setConversionTime] = useState("09:00");
  const [conversionDuration, setConversionDuration] = useState(60);

  // Reset pending state when visit changes (e.g., after save or selecting different visit)
  const visitIdRef = useRef(visit.id);
  if (visitIdRef.current !== visit.id) {
    visitIdRef.current = visit.id;
    setPendingAnyTime(null);
  }

  // Handle Any Time checkbox change
  const handleAnyTimeToggle = useCallback((checked: boolean) => {
    if (!onReschedule) return;
    if (checked) {
      // Convert to Any Time — save immediately with canonical UTC boundaries
      let dateStr: string;
      if (visit.scheduledStart) {
        const d = new Date(visit.scheduledStart);
        if (visit.isAllDay) {
          // Already all-day: use UTC date to avoid timezone shift
          dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
        } else {
          // Timed: use local date the user sees on screen
          dateStr = format(d, "yyyy-MM-dd");
        }
      } else {
        dateStr = format(new Date(), "yyyy-MM-dd");
      }
      onReschedule(visit, `${dateStr}T00:00:00.000Z`, `${dateStr}T23:59:59.000Z`, undefined, true);
      setPendingAnyTime(null);
    } else {
      // Convert to timed — show time/duration controls, don't save yet
      setPendingAnyTime(false);
      // Initialize conversion defaults from current date
      setConversionTime("09:00");
      setConversionDuration(60);
    }
  }, [visit, onReschedule]);

  // Save conversion from Any Time → timed (user presses Save after setting time/duration)
  const handleConversionSave = useCallback(() => {
    if (!onReschedule || !visit.scheduledStart) return;
    // Derive date from the visit's current date (UTC for all-day)
    const d = new Date(visit.scheduledStart);
    const dateStr = visit.isAllDay
      ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
      : format(d, "yyyy-MM-dd");
    const [h, m] = conversionTime.split(":").map(Number);
    const start = new Date(`${dateStr}T00:00:00`);
    start.setHours(h, m, 0, 0);
    const end = addMinutes(start, conversionDuration);
    onReschedule(visit, start.toISOString(), end.toISOString(), undefined, false);
    setPendingAnyTime(null);
  }, [visit, onReschedule, conversionTime, conversionDuration]);

  // Duration options
  const durationOpts = useMemo(() => {
    const set = new Set(DURATION_OPTIONS);
    if (visit.durationMinutes > 0) set.add(visit.durationMinutes);
    return Array.from(set).sort((a, b) => a - b);
  }, [visit.durationMinutes]);

  // Editable visit notes
  const [editingNotes, setEditingNotes] = useState(false);
  const [noteDraft, setNoteDraft] = useState(visit.visitNotes || "");
  // Sync draft with visit prop when visit changes (e.g., after save + refetch)
  const lastVisitIdRef = useRef(visit.id);
  if (visit.id !== lastVisitIdRef.current) {
    lastVisitIdRef.current = visit.id;
    setNoteDraft(visit.visitNotes || "");
    setEditingNotes(false);
  }

  const handleSaveNotes = useCallback(() => {
    if (!onUpdateVisitNotes) return;
    onUpdateVisitNotes(visit, noteDraft.trim());
    setEditingNotes(false);
  }, [visit, noteDraft, onUpdateVisitNotes]);

  return (
    <div className={mode === "popover"
      ? "flex w-[22rem] flex-col rounded-md border bg-white shadow-xl"
      : "flex h-full w-80 flex-shrink-0 flex-col border-l-2 border-l-emerald-300 bg-white shadow-lg"
    }>
      {/* ── Header: Client-first hierarchy (drag handle in popover mode) ── */}
      <div data-panel-drag-handle className={`border-b px-3 py-2.5 ${mode === "popover" ? "rounded-t-lg cursor-move" : ""} ${isCompleted ? "bg-slate-50" : "bg-emerald-50/60"}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {/* 1. Client / company name — primary title */}
            <p className={`text-sm font-bold truncate leading-tight ${isCompleted ? "text-muted-foreground line-through" : "text-foreground"}`}>
              {isCompleted && <CheckCircle2 className="h-3.5 w-3.5 text-slate-400 inline mr-1 -mt-0.5" />}
              {visit.customerCompanyId ? (
                <Link href={`/clients/${visit.customerCompanyId}`} className="hover:text-[#76B054] hover:underline transition-colors">
                  {visit.customerName}
                </Link>
              ) : (
                visit.customerName
              )}
            </p>
            {/* 2. Location name — directly under client (if distinct) */}
            {visit.locationName && visit.locationName !== visit.customerName && (
              <p className="text-xs text-muted-foreground truncate mt-0.5 flex items-center gap-1">
                <MapPin className="h-2.5 w-2.5 flex-shrink-0" />{visit.locationName}
              </p>
            )}
            {/* 2b. Service address — formatted street, city, province */}
            {visit.locationAddress && (
              <p className="text-xs text-muted-foreground/70 truncate mt-0.5 pl-3.5">
                {[visit.locationAddress, visit.locationCity, visit.locationProvinceState, visit.locationPostalCode].filter(Boolean).join(", ")}
              </p>
            )}
            {/* 3. Summary / description */}
            {visit.summary && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{visit.summary}</p>
            )}
            {/* 4. Job reference — clickable link */}
            <div className="flex items-center gap-2 mt-1">
              <Link
                href={`/jobs/${visit.jobId}`}
                className="text-xs text-blue-600 hover:underline font-medium"
              >
                Job #{visit.jobNumber}
              </Link>
              {/* Visit ordinal de-emphasized — job status is primary dispatch context */}
              {visit.technicianIds.length > 1 && (
                <span className="flex items-center gap-0.5 rounded bg-blue-100 px-1 py-px text-xs font-semibold text-blue-700">
                  <Users className="h-2.5 w-2.5" />{visit.technicianIds.length}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-slate-200 text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      <div className={mode === "popover" ? "px-3 py-2 overflow-y-auto" : "flex-1 overflow-y-auto px-3 py-2"}>
        {/* 4. Compact status row — no Section wrapper */}
        <div className="flex items-center gap-2 mb-2 pb-2 border-b">
          {/* Job-status-first: badge matches card color for dispatch consistency */}
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${jobStateColor(visit.jobStatus, visit.jobOpenSubStatus ?? null)}`}>
            {isCompleted && <CheckCircle2 className="h-3 w-3 mr-1" />}
            {jobStateLabel(visit.jobStatus, visit.jobOpenSubStatus ?? null)}
          </span>
          {visit.priority !== "normal" && (
            <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${
 visit.priority === "urgent" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
 }`}>
              <AlertTriangle className="h-2.5 w-2.5" />
              {visit.priority}
            </span>
          )}
          {visit.jobType && (
            <span className="text-xs text-muted-foreground">{visit.jobType}</span>
          )}
        </div>

        {/* 5. Crew */}
        {isScheduled && technicians && technicians.length > 0 && (onUpdateCrew || onReschedule) && (
          <Section title="Crew">
            {onUpdateCrew ? (
              <CrewPicker visit={visit} technicians={technicians} onUpdateCrew={onUpdateCrew} />
            ) : (
              <Select value={visit.technicianId ?? ""} onValueChange={handleTechChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Assign technician" />
                </SelectTrigger>
                <SelectContent>
                  {technicians.map(t => (
                    <SelectItem key={t.id} value={t.id} className="text-xs">{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Section>
        )}

        {/* 6. Schedule — date, time, duration all inline-editable */}
        <Section title="Schedule">
          {isScheduled && visit.scheduledStart ? (
            <>
              {/* Timed mode: date, time, duration controls */}
              <>
              {/* Inline date picker */}
              <div className="flex items-center gap-2 py-0.5">
                <CalendarDays className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                {onReschedule ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="text-xs font-medium hover:text-[#76B054] hover:underline transition-colors">
                        {displayDateStr}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 z-[9999]" align="start">
                      <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={handleDateChange}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                ) : (
                  <span className="text-xs font-medium">{displayDateStr}</span>
                )}
              </div>
              {/* Inline start time */}
              <div className="flex items-center gap-2 py-0.5">
                <Clock className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                {onReschedule ? (
                  <>
                    <Input
                      type="time"
                      value={editingStartTime ?? currentStartTime}
                      onChange={e => setEditingStartTime(e.target.value)}
                      onBlur={e => handleStartTimeCommit(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") handleStartTimeCommit((e.target as HTMLInputElement).value);
                        if (e.key === "Escape") setEditingStartTime(null);
                      }}
                      step={SNAP_MINUTES * 60}
                      className="h-7 w-28 text-xs"
                    />
                    {visit.scheduledEnd && (
                      <span className="text-xs text-muted-foreground">
                        – {format(new Date(visit.scheduledEnd), "h:mm a")}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-xs">
                    {format(new Date(visit.scheduledStart), "h:mm a")}
                    {visit.scheduledEnd && ` – ${format(new Date(visit.scheduledEnd), "h:mm a")}`}
                  </span>
                )}
              </div>
              {/* Inline duration selector */}
              <div className="flex items-center gap-2 py-0.5">
                <Clock className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground opacity-0" />
                {(onResize || onReschedule) ? (
                  <Select value={String(visit.durationMinutes)} onValueChange={handleDurationChange}>
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
                  <span className="text-xs">{formatDuration(visit.durationMinutes)}</span>
                )}
              </div>
                </>
            </>
          ) : (
            /* Item 4: Inline scheduling form for unscheduled visits */
            <UnscheduledScheduleForm
              visit={visit}
              technicians={technicians ?? []}
              onSchedule={onScheduleFromPanel}
              boardDate={boardDate}
            />
          )}
        </Section>

        {/* 7. Location — only in sidebar mode; popover mode shows location in header */}
        {mode !== "popover" && (
          <Section title="Location">
            <InfoRow icon={MapPin}>
              <p className="font-medium">{visit.locationName}</p>
              {visit.customerName !== visit.locationName && (
                <p className="text-muted-foreground">{visit.customerName}</p>
              )}
            </InfoRow>
          </Section>
        )}

        {/* Contact */}
        {visit.contactName && (
          <Section title="Contact">
            <InfoRow icon={Phone}>
              <p>{visit.contactName}</p>
              {visit.contactPhone && (
                <a href={`tel:${visit.contactPhone}`} className="text-blue-600 hover:underline">{visit.contactPhone}</a>
              )}
            </InfoRow>
          </Section>
        )}

        {/* Notes section — always visible, with editable visit notes */}
        <Section title="Notes">
          {visit.accessInstructions && (
            <InfoRow icon={KeyRound}><p className="whitespace-pre-wrap text-xs leading-relaxed">{visit.accessInstructions}</p></InfoRow>
          )}
          {visit.description && (
            <InfoRow icon={FileText}><p className="whitespace-pre-wrap text-xs leading-relaxed">{visit.description}</p></InfoRow>
          )}
          {visit.locationNotes && (
            <InfoRow icon={MapPin}><p className="whitespace-pre-wrap text-xs leading-relaxed">{visit.locationNotes}</p></InfoRow>
          )}
          {/* Editable visit notes */}
          <div className="mt-1">
            <div className="flex items-center gap-1.5 mb-1">
              <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Visit Notes</span>
              {onUpdateVisitNotes && !editingNotes && (
                <button
                  type="button"
                  onClick={() => { setNoteDraft(visit.visitNotes || ""); setEditingNotes(true); }}
                  className="ml-auto p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
            {editingNotes ? (
              <div className="space-y-1.5">
                <Textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Add visit notes..."
                  rows={3}
                  className="text-xs resize-none max-h-32"
                  autoFocus
                  onKeyDown={(e) => {
                    // Ctrl/Cmd+Enter to save
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      handleSaveNotes();
                    }
                    // Escape cancels editing
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setEditingNotes(false);
                    }
                  }}
                />
                <div className="flex items-center gap-1.5 justify-end">
                  <button
                    type="button"
                    onClick={() => setEditingNotes(false)}
                    className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground rounded"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveNotes}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded"
                  >
                    <Save className="h-2.5 w-2.5" /> Save
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="cursor-pointer rounded px-1 py-0.5 hover:bg-slate-50 min-h-[1.5rem]"
                onClick={() => { if (onUpdateVisitNotes) { setNoteDraft(visit.visitNotes || ""); setEditingNotes(true); } }}
              >
                {visit.visitNotes ? (
                  <p className="whitespace-pre-wrap text-xs leading-relaxed max-h-24 overflow-y-auto">{visit.visitNotes}</p>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No visit notes — click to add</p>
                )}
              </div>
            )}
          </div>
        </Section>
      </div>

      {/* ── Footer: dispatch-specific + canonical visit editor ── */}
      {/* 2026-03-21: Lifecycle actions (complete, reopen, delete) moved to canonical
          EditVisitModal. Only dispatch-specific actions remain here. */}
      <div className="border-t bg-slate-50/50 px-3 py-2 space-y-1.5">
        {/* Open canonical visit editor for lifecycle actions */}
        {onOpenVisitEditor && (
          <button
            onClick={() => onOpenVisitEditor(visit)}
            className="flex w-full items-center justify-center gap-1.5 rounded bg-[rgba(118,176,84,0.08)] px-3 py-1.5 text-xs font-medium text-[#5F9442] hover:bg-[#C2E974] transition-colors"
          >
            <Pencil className="h-3 w-3" /> Edit / Complete Visit
          </button>
        )}

        {isScheduled && onUnschedule && !isCompleted && (
          <button
            onClick={() => onUnschedule(visit)}
            className="flex w-full items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            <X className="h-3 w-3" /> Unschedule Visit
          </button>
        )}
      </div>
    </div>
  );
}

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
          <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 capitalize">
            {task.status.replace("_", " ")}
          </span>
        </div>

        {isScheduled && technicians && technicians.length > 0 && onRescheduleTask && (
          <Section title="Technician">
            <Select value={task.assignedToUserId ?? ""} onValueChange={handleTaskTechChange}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Assign technician" />
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
  if (props.entityType === "task") {
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
  return (
    <VisitDetail
      visit={props.visit}
      technicians={props.technicians}
      laneVisits={props.laneVisits}
      laneTasks={props.laneTasks}
      onClose={props.onClose}
      onUnschedule={props.onUnschedule}
      onReschedule={props.onReschedule}
      onResize={props.onResize}
      onUpdateCrew={props.onUpdateCrew}
      onUpdateStatus={props.onUpdateStatus}
      onUpdateVisitNotes={props.onUpdateVisitNotes}
      onOpenVisitEditor={props.onOpenVisitEditor}
      onScheduleFromPanel={props.onScheduleFromPanel}
      boardDate={props.boardDate}
      mode={props.mode}
    />
  );
}
