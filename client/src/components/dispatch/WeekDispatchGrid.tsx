/**
 * WeekDispatchGrid — calendar-style vertical week view for the dispatch board.
 * 7 day columns (Mon→Sun), vertical time axis (hour rows).
 * Visits/tasks positioned vertically by scheduledStart within each day column.
 * Reuses existing DnD system, mutations, and modals — no new write paths.
 *
 * 2026-03-30: Replaced tech-row×day-column grid with Google Calendar-style layout.
 */
import { useMemo, useRef, useEffect } from "react";
import { format, isToday, isWeekend } from "date-fns";
import type { DispatchVisit, DispatchTask, DispatchLeadVisit, Technician } from "./dispatchPreviewTypes";
import { UNASSIGNED_TECH_ID } from "./dispatchPreviewTypes";
import { formatHour } from "./dispatchPreviewUtils";
import WeekDayColumn from "./WeekDispatchCell";
import { TimeOffOverlay } from "./TimeOffOverlay";

// Week calendar layout constants — defaults for standard hours mode
export const WEEK_START_HOUR = 6;
export const WEEK_END_HOUR = 21;
export const WEEK_HOUR_HEIGHT_PX = 60;
const TIME_GUTTER_WIDTH = 52;
const DAY_HEADER_HEIGHT = 52;

// 24-hour mode constants for the week grid
const WEEK_START_HOUR_24 = 0;
const WEEK_END_HOUR_24 = 24;

type Props = {
  technicians: Technician[];
  weekDays: Date[];
  visitsByTechByDay: Map<string, Map<string, DispatchVisit[]>>;
  tasksByTechByDay: Map<string, Map<string, DispatchTask[]>>;
  /** 2026-05-05 Phase 3 correction: per-day lead visits. Rendered in
   *  the same day column as jobs but always branch-rendered so they
   *  never flow through job-shaped DnD/color/render paths. */
  leadVisitsByDay: Map<string, DispatchLeadVisit[]>;
  selectedItemId: string | null;
  savingIds: Set<string>;
  onSelectVisit: (visit: DispatchVisit) => void;
  onSelectTask: (task: DispatchTask) => void;
  /** 2026-05-05 Phase 3 correction: lead-visit click handler — routes
   *  to /leads/:leadId, NOT to a job route. */
  onOpenLead: (leadId: string) => void;
  /** Resize handler — reuses existing shared resizeVisit mutation */
  onResize?: (visit: DispatchVisit, newEndTime: string) => void;
  /** 2026-03-31: 24-hour mode — shared with Day view via same toggle state */
  show24Hour?: boolean;
  /** 2026-05-07 RALPH (technician time off): per-day count of techs
   *  with any time-off entry that day. Used to render a small "N
   *  off" summary chip when ≥ 2 techs are off; ignored when the
   *  per-entry list (`timeOffEntriesByDay`) supplies enough room
   *  for the canonical per-tech chips. Optional — empty map paints
   *  exactly as the pre-feature view. */
  techsOnTimeOffByDay?: Map<string, Set<string>>;
  /** 2026-05-07 RALPH (technician time off): per-day list of
   *  rich time-off entries (with technician name + reason +
   *  endsAt for the "Returning …" label). When present, each day
   *  column header renders one canonical `<TimeOffOverlay
   *  variant="chip">` per tech (1 tech off → "Time off · Sick";
   *  2+ techs → falls back to a summary chip to keep the column
   *  header dense). */
  timeOffEntriesByDay?: Map<
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
  >;
};

/**
 * Flatten visitsByTechByDay → visitsByDay (deduplicating multi-tech visits).
 * This merges all filtered technicians' visits into a single per-day list.
 */
function flattenByDay<T extends { id: string; scheduledStart: string | null }>(
  byTechByDay: Map<string, Map<string, T[]>>,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  const seen = new Map<string, Set<string>>();
  Array.from(byTechByDay.entries()).forEach(([, dayMap]) => {
    Array.from(dayMap.entries()).forEach(([dayKey, items]) => {
      if (!map.has(dayKey)) { map.set(dayKey, []); seen.set(dayKey, new Set()); }
      for (const item of items) {
        if (!seen.get(dayKey)!.has(item.id)) {
          seen.get(dayKey)!.add(item.id);
          map.get(dayKey)!.push(item);
        }
      }
    });
  });
  // Sort by start time within each day
  Array.from(map.entries()).forEach(([, items]) => {
    items.sort((a: T, b: T) => {
      if (!a.scheduledStart) return 1;
      if (!b.scheduledStart) return -1;
      return new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime();
    });
  });
  return map;
}

/** NowIndicator — horizontal red line at current time in today's column */
function NowIndicator({ startHour, hourHeight }: { startHour: number; hourHeight: number }) {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startHour * 60;
  if (currentMinutes < startMinutes) return null;
  const top = ((currentMinutes - startMinutes) / 60) * hourHeight;
  return (
    <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top }}>
      <div className="flex items-center">
        <div className="h-2 w-2 rounded-full bg-red-500 -ml-1 shadow-sm" />
        <div className="flex-1 h-[2px] bg-red-500" />
      </div>
    </div>
  );
}

export default function WeekDispatchGrid({
  technicians, weekDays, visitsByTechByDay, tasksByTechByDay, leadVisitsByDay,
  selectedItemId, savingIds, onSelectVisit, onSelectTask, onOpenLead, onResize,
  show24Hour, techsOnTimeOffByDay, timeOffEntriesByDay,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // 2026-03-31: Dynamic hour config from shared 24h toggle
  const startHour = show24Hour ? WEEK_START_HOUR_24 : WEEK_START_HOUR;
  const endHour = show24Hour ? WEEK_END_HOUR_24 : WEEK_END_HOUR;
  const weekHours = useMemo(
    () => Array.from({ length: endHour - startHour }, (_, i) => startHour + i),
    [startHour, endHour],
  );

  // Flatten tech-grouped data into per-day lists (deduplicated)
  const visitsByDay = useMemo(() => flattenByDay(visitsByTechByDay), [visitsByTechByDay]);
  const tasksByDay = useMemo(() => flattenByDay(tasksByTechByDay), [tasksByTechByDay]);

  // 2026-03-31: Build techId→color lookup for week-view card coloring
  const techColorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of technicians) m.set(t.id, t.color);
    return m;
  }, [technicians]);

  const totalGridHeight = weekHours.length * WEEK_HOUR_HEIGHT_PX;

  // Auto-scroll to business hours (8 AM) on mount or when 24h mode changes
  useEffect(() => {
    if (scrollRef.current) {
      const businessHourOffset = (8 - startHour) * WEEK_HOUR_HEIGHT_PX;
      scrollRef.current.scrollTop = Math.max(0, businessHourOffset - 20);
    }
  }, [startHour]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto bg-white">
      <div className="min-w-fit">
        {/* Sticky day header row */}
        <div className="sticky top-0 z-20 flex border-b bg-white shadow-sm">
          {/* Time gutter header */}
          <div
            className="flex-shrink-0 border-r bg-white"
            style={{ width: TIME_GUTTER_WIDTH, height: DAY_HEADER_HEIGHT }}
          />
          {/* Day labels */}
          {weekDays.map(day => {
            const today = isToday(day);
            const weekend = isWeekend(day);
            const dayKey = format(day, "yyyy-MM-dd");
            const offCount =
              techsOnTimeOffByDay?.get(dayKey)?.size ?? 0;
            return (
              <div
                key={day.toISOString()}
                className={`flex-1 min-w-[130px] flex flex-col items-center justify-center border-r ${
                  today ? "bg-emerald-50/40" : ""
                }`}
                style={{ height: DAY_HEADER_HEIGHT }}
                data-week-day={dayKey}
              >
                <span className={`text-xs uppercase tracking-wide font-semibold ${
                  today ? "text-emerald-600" : weekend ? "text-slate-400" : "text-muted-foreground"
                }`}>
                  {format(day, "EEE")}
                </span>
                <span className={`text-base font-semibold leading-tight ${
                  today ? "text-emerald-700" : weekend ? "text-slate-400" : "text-foreground"
                }`}>
                  {format(day, "d")}
                </span>
                {/* 2026-05-07 RALPH (technician time off): per-day
                    chips. When 1 tech is off, render a canonical
                    `<TimeOffOverlay variant="chip">` with the
                    full "Technician off · Reason · Returning …"
                    label so dispatchers see the reason at a
                    glance. When 2+ techs are off, fall back to a
                    compact summary chip to keep the day-column
                    header dense (the per-tech detail is reachable
                    by drilling into the day view). */}
                {offCount === 1 && timeOffEntriesByDay?.get(dayKey)?.[0] && (() => {
                  const entry = timeOffEntriesByDay.get(dayKey)![0];
                  return (
                    <div
                      className="mt-0.5 max-w-full px-1"
                      data-testid={`week-day-off-chip-${dayKey}`}
                    >
                      <TimeOffOverlay
                        variant="chip"
                        reason={entry.reason}
                        endsAtISO={entry.endsAt}
                        allDay={entry.allDay}
                        technicianName={entry.technicianName}
                        testId={`week-day-off-entry-${dayKey}-${entry.technicianUserId}`}
                      />
                      <div className="text-[10px] text-amber-700/80 truncate text-center mt-0.5">
                        {entry.technicianName}
                      </div>
                    </div>
                  );
                })()}
                {offCount > 1 && (
                  <span
                    className="mt-0.5 inline-block rounded-full border border-amber-300 bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-700"
                    data-testid={`week-day-off-chip-${dayKey}`}
                    title={`${offCount} technicians off`}
                  >
                    {offCount} off
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Grid body: time gutter + day columns */}
        <div className="flex">
          {/* Time gutter */}
          <div className="flex-shrink-0 border-r bg-white" style={{ width: TIME_GUTTER_WIDTH }}>
            {weekHours.map(h => (
              <div key={h} className="relative border-b border-slate-100" style={{ height: WEEK_HOUR_HEIGHT_PX }}>
                <span className="absolute -top-[7px] right-2 text-[10px] text-muted-foreground select-none">
                  {formatHour(h)}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDays.map(day => {
            const dayKey = format(day, "yyyy-MM-dd");
            const visits = visitsByDay.get(dayKey) ?? [];
            const tasks = tasksByDay.get(dayKey) ?? [];
            const today = isToday(day);
            const weekend = isWeekend(day);

            return (
              <div
                key={dayKey}
                className={`flex-1 min-w-[130px] border-r relative ${
                  today ? "bg-emerald-50/20" : weekend ? "bg-slate-50/40" : ""
                }`}
                style={{ height: totalGridHeight }}
              >
                {/* Hour grid lines */}
                {weekHours.map(h => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-b border-slate-100"
                    style={{ top: (h - startHour) * WEEK_HOUR_HEIGHT_PX, height: WEEK_HOUR_HEIGHT_PX }}
                  >
                    {/* Half-hour dashed line */}
                    <div
                      className="absolute left-0 right-0 border-b border-dashed border-slate-50"
                      style={{ top: WEEK_HOUR_HEIGHT_PX / 2 }}
                    />
                  </div>
                ))}

                {/* Current time indicator (today only) */}
                {today && <NowIndicator startHour={startHour} hourHeight={WEEK_HOUR_HEIGHT_PX} />}

                {/* Day column content: positioned visits/tasks + drop target */}
                <WeekDayColumn
                  dayKey={dayKey}
                  visits={visits}
                  tasks={tasks}
                  leadVisits={leadVisitsByDay.get(dayKey) ?? []}
                  startHour={startHour}
                  endHour={endHour}
                  hourHeight={WEEK_HOUR_HEIGHT_PX}
                  selectedItemId={selectedItemId}
                  savingIds={savingIds}
                  onSelectVisit={onSelectVisit}
                  onSelectTask={onSelectTask}
                  onOpenLead={onOpenLead}
                  onResize={onResize}
                  techColorMap={techColorMap}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
