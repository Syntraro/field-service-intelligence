import { useMemo } from "react";
import { format, addDays, parseISO, startOfDay, endOfDay } from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DispatchShiftEntry } from "@/components/dispatch/dispatchPreviewTypes";
import ShiftBlock from "./ShiftBlock";

interface Technician {
  id: string;
  fullName: string;
  color?: string | null;
}

interface Props {
  weekStart: Date;
  technicians: Technician[];
  shifts: DispatchShiftEntry[];
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onAddShift: (technicianId?: string, date?: string) => void;
  onEditShift: (shift: DispatchShiftEntry) => void;
  onDeleteShift: (shift: DispatchShiftEntry) => void;
  /** Company IANA timezone — passed to ShiftBlock for correct local-time display. */
  timezone?: string;
}

/** Returns the YYYY-MM-DD key from a shift (uses occurrenceDate if set, otherwise parses startsAt UTC date). */
function shiftDateKey(shift: DispatchShiftEntry): string {
  if (shift.occurrenceDate) return shift.occurrenceDate;
  try {
    return shift.startsAt.slice(0, 10); // ISO prefix
  } catch {
    return "";
  }
}

export default function TechnicianScheduleGrid({
  weekStart,
  technicians,
  shifts,
  onPrevWeek,
  onNextWeek,
  onAddShift,
  onEditShift,
  onDeleteShift,
  timezone,
}: Props) {
  // Build 7 day columns for the week
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(weekStart, i);
      return {
        date: d,
        key: format(d, "yyyy-MM-dd"),
        dayLabel: format(d, "EEE"),    // Mon, Tue, …
        dateLabel: format(d, "M/d"),   // 5/19
      };
    });
  }, [weekStart]);

  // Index shifts by technicianUserId → dateKey → shift[]
  const shiftIndex = useMemo(() => {
    const idx = new Map<string, Map<string, DispatchShiftEntry[]>>();
    for (const s of shifts) {
      const techMap = idx.get(s.technicianUserId) ?? new Map<string, DispatchShiftEntry[]>();
      const dateK = shiftDateKey(s);
      const dayShifts = techMap.get(dateK) ?? [];
      dayShifts.push(s);
      techMap.set(dateK, dayShifts);
      idx.set(s.technicianUserId, techMap);
    }
    return idx;
  }, [shifts]);

  const weekLabel = `${format(weekStart, "MMM d")} – ${format(addDays(weekStart, 6), "MMM d, yyyy")}`;

  return (
    <div className="flex flex-col gap-3" data-testid="technician-schedule-grid">
      {/* Week navigation */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onPrevWeek} aria-label="Previous week">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-helper font-medium text-slate-700 min-w-[170px] text-center">
          {weekLabel}
        </span>
        <Button variant="outline" size="sm" onClick={onNextWeek} aria-label="Next week">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
        <table className="w-full min-w-[700px] table-fixed border-collapse">
          <colgroup>
            <col className="w-36" />
            {days.map((d) => (
              <col key={d.key} />
            ))}
          </colgroup>

          {/* Header row */}
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">
                Technician
              </th>
              {days.map((d) => (
                <th
                  key={d.key}
                  className="px-2 py-2 text-center text-[11px] font-medium text-muted-foreground border-l border-slate-200"
                >
                  <div>{d.dayLabel}</div>
                  <div className="text-slate-400 font-normal">{d.dateLabel}</div>
                </th>
              ))}
            </tr>
          </thead>

          {/* Technician rows */}
          <tbody>
            {technicians.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-8 text-center text-helper text-muted-foreground"
                >
                  No technicians found.
                </td>
              </tr>
            ) : (
              technicians.map((tech, rowIdx) => {
                const techMap = shiftIndex.get(tech.id);
                return (
                  <tr
                    key={tech.id}
                    className={`${rowIdx < technicians.length - 1 ? "border-b border-slate-100" : ""}`}
                    data-testid={`schedule-row-${tech.id}`}
                  >
                    {/* Tech name cell */}
                    <td className="px-3 py-2 align-top">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-[10px] font-semibold text-white"
                          style={{ backgroundColor: tech.color ?? "#94a3b8" }}
                        >
                          {tech.fullName.slice(0, 1).toUpperCase()}
                        </div>
                        <span className="text-[12px] font-medium text-slate-800 truncate">
                          {tech.fullName}
                        </span>
                      </div>
                    </td>

                    {/* Day cells */}
                    {days.map((d) => {
                      const dayShifts = techMap?.get(d.key) ?? [];
                      return (
                        <td
                          key={d.key}
                          className="px-1.5 py-1.5 align-top border-l border-slate-100 min-h-[60px]"
                          data-testid={`schedule-cell-${tech.id}-${d.key}`}
                        >
                          <div className="flex flex-col gap-1">
                            {dayShifts.map((s) => (
                              <ShiftBlock
                                key={s.id}
                                shift={s}
                                onEdit={onEditShift}
                                onDelete={onDeleteShift}
                                timezone={timezone}
                              />
                            ))}
                            <button
                              type="button"
                              onClick={() => onAddShift(tech.id, d.key)}
                              className="flex items-center justify-center rounded border border-dashed border-slate-200 py-0.5 text-[10px] text-slate-300 hover:border-slate-400 hover:text-slate-500 transition-colors"
                              aria-label={`Add shift for ${tech.fullName} on ${d.key}`}
                              data-testid={`add-shift-${tech.id}-${d.key}`}
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
