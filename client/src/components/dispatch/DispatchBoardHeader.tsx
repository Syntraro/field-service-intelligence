/**
 * DispatchBoardHeader — top bar with title, date nav, view toggles (Day/Week),
 * and scheduling mode selector (Drag / Click-to-Schedule).
 */
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, GripVertical, MousePointer } from "lucide-react";
import { format, startOfWeek, endOfWeek } from "date-fns";

export type DispatchView = "day" | "week";
/** Scheduling interaction mode */
export type SchedulingMode = "drag" | "click";

type Props = {
  selectedDate: Date;
  onPrevDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
  activeView?: DispatchView;
  onViewChange?: (v: DispatchView) => void;
  /** Item 7: Show 24-hour timeline toggle (day view only) */
  show24Hour?: boolean;
  onToggle24Hour?: () => void;
  /** Scheduling mode: drag or click-to-schedule */
  schedulingMode?: SchedulingMode;
  onSchedulingModeChange?: (mode: SchedulingMode) => void;
};

export default function DispatchBoardHeader({
  selectedDate, onPrevDay, onNextDay, onToday,
  activeView = "day", onViewChange,
  show24Hour, onToggle24Hour,
  schedulingMode = "drag", onSchedulingModeChange,
}: Props) {
  const isToday = format(selectedDate, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");

  const dateLabel = activeView === "week"
    ? `${format(startOfWeek(selectedDate, { weekStartsOn: 1 }), "MMM d")} – ${format(endOfWeek(selectedDate, { weekStartsOn: 1 }), "MMM d, yyyy")}`
    : format(selectedDate, "EEEE, MMM d, yyyy");

  return (
    <div className="flex items-center justify-between border-b bg-white px-5 py-3">
      <h1 className="text-lg font-bold text-foreground">Dispatch Board</h1>

      {/* Date navigation */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onToday} disabled={isToday} className="text-xs">
          Today
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onPrevDay}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[180px] text-center text-sm font-medium">
          {dateLabel}
        </span>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onNextDay}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Scheduling mode + 24-hour toggle + view toggles */}
      <div className="flex items-center gap-3">
        {/* Scheduling mode selector — Drag / Click */}
        {activeView === "day" && onSchedulingModeChange && (
          <div className="inline-flex items-center rounded-lg border bg-white p-0.5">
            <button
              onClick={() => onSchedulingModeChange("drag")}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                schedulingMode === "drag"
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-slate-50"
              }`}
              title="Drag to schedule"
            >
              <GripVertical className="h-3 w-3" />
              Drag
            </button>
            <button
              onClick={() => onSchedulingModeChange("click")}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                schedulingMode === "click"
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-slate-50"
              }`}
              title="Click to schedule"
            >
              <MousePointer className="h-3 w-3" />
              Click
            </button>
          </div>
        )}
        {activeView === "day" && onToggle24Hour && (
          <button
            onClick={onToggle24Hour}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              show24Hour
                ? "bg-primary text-white border-primary"
                : "bg-white text-muted-foreground border-slate-200 hover:bg-slate-50"
            }`}
            title={show24Hour ? "Show business hours (5 AM – 10 PM)" : "Show full 24-hour timeline"}
          >
            24h
          </button>
        )}
      <div className="inline-flex items-center rounded-lg border bg-white p-0.5">
        {(["day", "week"] as const).map(v => (
          <button
            key={v}
            onClick={() => onViewChange?.(v)}
            className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
              activeView === v
                ? "bg-primary text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-slate-50"
            }`}
          >
            {v}
          </button>
        ))}
        <button
          disabled
          title="Month view — coming soon"
          className="rounded-md px-3 py-1 text-xs font-medium capitalize text-muted-foreground/40 cursor-not-allowed"
        >
          month
        </button>
      </div>
      </div>
    </div>
  );
}
