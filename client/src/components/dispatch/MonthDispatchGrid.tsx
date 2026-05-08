/**
 * MonthDispatchGrid — pure display component for the Month view.
 * Renders a date grid (Mon–Sun, 5–6 rows) with compact visit cards.
 * Each day cell is a droppable target using the existing DnD contract.
 *
 * Responsibilities: render, group, display, provide drop surfaces.
 * NOT responsible for: data fetching, mutations, scheduling logic.
 *
 * 2026-03-31: Initial implementation — reuses canonical card content,
 * technician color resolution, and existing DnD drop contract.
 * 2026-03-31: visitsByDay now provided by adapter (useDispatchMonthData),
 * not computed internally — consistent with week grid pattern.
 * 2026-05-05 Phase 3 correction: lead visits rendered alongside jobs
 * in each day cell. Branch render on `item.type === "lead_visit"` so
 * lead pills get amber styling + "Lead" badge + click → /leads/:id
 * without ever flowing through job-shaped logic. Lead visits count
 * toward the same MAX_MONTH_CELL_ITEMS overflow as jobs (no silent
 * drop). Lead visits are NOT droppable targets — DnD remains a
 * job-side feature; the lead-visit click handler is bound at the
 * pill level only.
 */
import { useState, useMemo, useCallback } from "react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isToday, isSameMonth,
} from "date-fns";
import { useDroppable } from "@dnd-kit/core";
import type { DispatchVisit, DispatchLeadVisit } from "./dispatchPreviewTypes";
import type { DispatchDropData } from "./dispatchDndTypes";
import { VisitCardContent } from "./VisitCardContent";
import { UNASSIGNED_COLOR } from "@shared/colors";
import { TimeOffOverlay } from "./TimeOffOverlay";

/** Max cards visible per day cell before expand */
const MAX_MONTH_CELL_ITEMS = 3;

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Props = {
  selectedDate: Date;
  visitsByDay: Map<string, DispatchVisit[]>;
  leadVisitsByDay: Map<string, DispatchLeadVisit[]>;
  techColorMap: Map<string, string>;
  selectedVisitId: string | null;
  onSelectVisit: (visit: DispatchVisit) => void;
  onOpenLead: (leadId: string) => void;
  /** 2026-05-07 RALPH (technician time off): per-day count of techs
   *  with any time-off entry that day. Drives the small `N off`
   *  summary chip when ≥ 2 techs are off. */
  techsOnTimeOffByDay?: Map<string, Set<string>>;
  /** 2026-05-07 RALPH (technician time off): per-day list of
   *  rich entries. When exactly 1 tech is off on a given day, the
   *  cell renders the canonical `<TimeOffOverlay variant="chip">`
   *  with the full "Time off · Reason · Returning …" label. */
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
 * Discriminated union of items rendered in a month-day cell.
 * Branch render rules MUST switch on `kind` — never on field shape.
 * `kind: "lead"` carriers must NEVER be passed to job-shaped consumers
 * (VisitCardContent, DnD drop data, selected-visit highlight, etc.).
 */
type CellItem =
  | { kind: "job"; visit: DispatchVisit; sortKey: string }
  | { kind: "lead"; leadVisit: DispatchLeadVisit; sortKey: string };

function buildCellItems(
  visits: DispatchVisit[],
  leadVisits: DispatchLeadVisit[],
): CellItem[] {
  const items: CellItem[] = [];
  for (const v of visits) {
    items.push({ kind: "job", visit: v, sortKey: v.scheduledStart ?? "9999" });
  }
  for (const lv of leadVisits) {
    items.push({ kind: "lead", leadVisit: lv, sortKey: lv.scheduledStart ?? "9999" });
  }
  items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return items;
}

/** Compact lead-visit pill for the month grid — amber tint, "Lead" badge,
 *  no jobNumber/jobStatus access (those don't exist on DispatchLeadVisit). */
function MonthLeadVisitPill({
  leadVisit,
  onOpenLead,
}: {
  leadVisit: DispatchLeadVisit;
  onOpenLead: (leadId: string) => void;
}) {
  const time = leadVisit.scheduledStart && !leadVisit.isAllDay
    ? format(new Date(leadVisit.scheduledStart), "h:mm a")
    : leadVisit.isAllDay ? "All day" : "";
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onOpenLead(leadVisit.leadId); }}
      className="rounded px-1 py-0.5 text-left border bg-amber-50 border-amber-200 hover:bg-amber-100 transition-colors"
      style={{ borderLeftWidth: 2, borderLeftColor: "#f59e0b" }}
      data-testid={`month-lead-visit-${leadVisit.id}`}
      title={`${leadVisit.leadTitle}${time ? ` · ${time}` : ""}`}
    >
      <div className="flex items-center gap-1 min-w-0">
        <span className="rounded bg-amber-500 text-white text-[8px] font-bold px-1 py-px leading-none uppercase tracking-wide">
          Lead
        </span>
        {time && (
          <span className="text-[10px] text-amber-900 font-medium leading-none shrink-0">
            {time}
          </span>
        )}
        <span className="text-[10px] text-amber-900 leading-none truncate min-w-0">
          {leadVisit.leadTitle}
        </span>
      </div>
    </button>
  );
}

/** Single day cell — droppable target with expand/collapse for overflow */
function MonthDayCell({
  date,
  items,
  isCurrentMonth,
  techColorMap,
  selectedVisitId,
  onSelectVisit,
  onOpenLead,
  isExpanded,
  onToggleExpand,
  techsOffCount,
  timeOffEntries,
}: {
  date: Date;
  items: CellItem[];
  isCurrentMonth: boolean;
  techColorMap: Map<string, string>;
  selectedVisitId: string | null;
  onSelectVisit: (visit: DispatchVisit) => void;
  onOpenLead: (leadId: string) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  /** 2026-05-07 RALPH (technician time off): count of techs with
   *  any time-off entry on this day. Renders a small amber chip
   *  inline with the day number when ≥ 2 techs are off. */
  techsOffCount?: number;
  /** 2026-05-07 RALPH (technician time off): rich entries — when
   *  exactly 1 tech is off, the cell renders a canonical
   *  `<TimeOffOverlay variant="chip">` with the full label
   *  (Time off · Reason · Returning …). */
  timeOffEntries?: Array<{
    id: string;
    technicianUserId: string;
    technicianName: string;
    reason: string;
    startsAt: string;
    endsAt: string;
    allDay: boolean;
  }>;
}) {
  const dayKey = format(date, "yyyy-MM-dd");
  const dropData: DispatchDropData = { dayKey };
  const { setNodeRef, isOver } = useDroppable({
    id: `month-day-${dayKey}`,
    data: dropData,
  });

  const today = isToday(date);
  const hasOverflow = items.length > MAX_MONTH_CELL_ITEMS;
  const visibleItems = isExpanded ? items : items.slice(0, MAX_MONTH_CELL_ITEMS);

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col border-r border-b min-h-[110px] p-1 ${
        !isCurrentMonth ? "bg-slate-50/60" : "bg-white"
      } ${isOver ? "bg-emerald-50/50 ring-1 ring-inset ring-emerald-300" : ""}`}
    >
      {/* Day number */}
      <div className="flex items-center justify-between mb-0.5 px-0.5 gap-1">
        <span className={`text-xs font-medium leading-tight ${
          today
            ? "flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white text-[11px] font-semibold"
            : !isCurrentMonth ? "text-slate-400" : "text-slate-700"
        }`}>
          {format(date, "d")}
        </span>
        {/* 2026-05-07 RALPH (technician time off): per-day off chip.
            1 tech off → canonical overlay chip with name + reason
            (the user knows WHO is off without drilling in). 2+
            techs → compact summary "N off" so the cell stays
            within its compact 3-card budget. */}
        {(techsOffCount ?? 0) === 1 && timeOffEntries?.[0] && (
          <TimeOffOverlay
            variant="chip"
            reason={timeOffEntries[0].reason}
            endsAtISO={timeOffEntries[0].endsAt}
            allDay={timeOffEntries[0].allDay}
            technicianName={timeOffEntries[0].technicianName}
            testId={`month-day-off-chip-${dayKey}`}
          />
        )}
        {(techsOffCount ?? 0) > 1 && (
          <span
            className="inline-block rounded-full border border-amber-300 bg-amber-100 px-1 py-0 text-[9px] font-semibold text-amber-700 leading-tight"
            data-testid={`month-day-off-chip-${dayKey}`}
            title={`${techsOffCount} technicians off`}
          >
            {techsOffCount} off
          </span>
        )}
      </div>

      {/* Cards — branch render on item.kind so lead pills NEVER flow
          through VisitCardContent / job-color logic. */}
      <div className="flex flex-col gap-px flex-1 min-w-0">
        {visibleItems.map(item => {
          if (item.kind === "lead") {
            return (
              <MonthLeadVisitPill
                key={`lead-${item.leadVisit.id}`}
                leadVisit={item.leadVisit}
                onOpenLead={onOpenLead}
              />
            );
          }
          const v = item.visit;
          // 2026-04-19: derive color from canonical crew (technicianIds[0]).
          const primaryTechId = v.technicianIds[0] ?? null;
          const techColor = primaryTechId
            ? techColorMap.get(primaryTechId) ?? UNASSIGNED_COLOR
            : UNASSIGNED_COLOR;
          const isSelected = selectedVisitId === v.id;
          return (
            <button
              key={`job-${v.id}`}
              onClick={(e) => { e.stopPropagation(); onSelectVisit(v); }}
              className={`rounded px-1 py-0.5 text-left border transition-colors hover:brightness-95 ${
                isSelected ? "ring-1 ring-primary" : ""
              }`}
              style={{
                backgroundColor: `${techColor}20`,
                borderColor: `${techColor}50`,
                borderLeftWidth: 2,
                borderLeftColor: techColor,
              }}
            >
              <VisitCardContent visit={v} variant="month" />
            </button>
          );
        })}

        {/* Expand/collapse overflow — stays in Month, does not navigate away */}
        {hasOverflow && !isExpanded && (
          <button
            onClick={onToggleExpand}
            className="text-[10px] font-medium text-primary hover:text-primary/80 px-1 py-px text-left"
          >
            +{items.length - MAX_MONTH_CELL_ITEMS} more
          </button>
        )}
        {hasOverflow && isExpanded && (
          <button
            onClick={onToggleExpand}
            className="text-[10px] font-medium text-slate-500 hover:text-slate-700 px-1 py-px text-left"
          >
            show less
          </button>
        )}
      </div>
    </div>
  );
}

export default function MonthDispatchGrid({
  selectedDate,
  visitsByDay,
  leadVisitsByDay,
  techColorMap,
  selectedVisitId,
  onSelectVisit,
  onOpenLead,
  techsOnTimeOffByDay,
  timeOffEntriesByDay,
}: Props) {
  // Local expand state — tracks which day cells are expanded (by dayKey)
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((dayKey: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey); else next.add(dayKey);
      return next;
    });
  }, []);

  // Build grid dates: start from Monday of the week containing the 1st,
  // end at Sunday of the week containing the last day of the month.
  const gridDates = useMemo(() => {
    const monthStart = startOfMonth(selectedDate);
    const monthEnd = endOfMonth(selectedDate);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [selectedDate.getFullYear(), selectedDate.getMonth()]);

  // Reset expanded state when month changes
  const monthKey = `${selectedDate.getFullYear()}-${selectedDate.getMonth()}`;
  useMemo(() => { setExpandedDays(new Set()); }, [monthKey]);

  return (
    <div className="flex flex-col flex-1 overflow-auto bg-white border-l">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b bg-slate-50 sticky top-0 z-10">
        {WEEKDAY_LABELS.map(label => (
          <div key={label} className="px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide border-r">
            {label}
          </div>
        ))}
      </div>

      {/* Date grid — rows grow naturally when cells expand */}
      <div className="grid grid-cols-7">
        {gridDates.map(date => {
          const dayKey = format(date, "yyyy-MM-dd");
          const items = buildCellItems(
            visitsByDay.get(dayKey) ?? [],
            leadVisitsByDay.get(dayKey) ?? [],
          );
          return (
            <MonthDayCell
              key={dayKey}
              date={date}
              items={items}
              isCurrentMonth={isSameMonth(date, selectedDate)}
              techColorMap={techColorMap}
              selectedVisitId={selectedVisitId}
              onSelectVisit={onSelectVisit}
              onOpenLead={onOpenLead}
              isExpanded={expandedDays.has(dayKey)}
              onToggleExpand={() => toggleExpand(dayKey)}
              techsOffCount={techsOnTimeOffByDay?.get(dayKey)?.size ?? 0}
              timeOffEntries={timeOffEntriesByDay?.get(dayKey)}
            />
          );
        })}
      </div>
    </div>
  );
}
