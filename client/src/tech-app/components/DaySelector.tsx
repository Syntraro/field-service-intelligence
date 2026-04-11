/**
 * DaySelector — Shared date navigation strip for tech app screens.
 * Shows a 7-day strip centered on the selected date with prev/next arrows and Today button.
 */
import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}

function buildDayStrip(center: Date): Date[] {
  const days: Date[] = [];
  for (let i = -3; i <= 3; i++) {
    const d = new Date(center);
    d.setDate(center.getDate() + i);
    days.push(d);
  }
  return days;
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface DaySelectorProps {
  selectedDate: Date;
  onSelect: (d: Date) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

export function DaySelector({ selectedDate, onSelect, onPrev, onNext, onToday }: DaySelectorProps) {
  const days = useMemo(() => buildDayStrip(selectedDate), [selectedDate]);
  const todayDate = new Date();
  const showTodayButton = !isToday(selectedDate);

  return (
    <div className="px-4 pt-2 pb-1">
      <div className="flex items-center justify-between mb-1.5">
        <button onClick={onPrev} className="p-1 rounded-md active:bg-slate-100">
          <ChevronLeft className="text-slate-500" style={{ width: 18, height: 18 }} />
        </button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800">
            {selectedDate.toLocaleDateString([], { month: "long", year: "numeric" })}
          </span>
          {showTodayButton && (
            <button onClick={onToday} className="text-sm font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full active:bg-emerald-100">
              Today
            </button>
          )}
        </div>
        <button onClick={onNext} className="p-1 rounded-md active:bg-slate-100">
          <ChevronRight className="text-slate-500" style={{ width: 18, height: 18 }} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((d) => {
          const selected = isSameDay(d, selectedDate);
          const todayMark = isSameDay(d, todayDate);
          return (
            <button key={d.toISOString()} onClick={() => onSelect(d)}
              className={`flex flex-col items-center py-1 rounded-md transition-colors ${
                selected ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 active:bg-slate-100"
              }`}>
              <span className={`text-xs font-medium ${selected ? "text-emerald-100" : "text-slate-400"}`}>
                {d.toLocaleDateString([], { weekday: "short" })}
              </span>
              <span className={`text-sm font-bold leading-tight ${selected ? "text-white" : ""}`}>
                {d.getDate()}
              </span>
              {todayMark && !selected && <div className="w-1 h-1 rounded-full bg-emerald-500 mt-0.5" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
