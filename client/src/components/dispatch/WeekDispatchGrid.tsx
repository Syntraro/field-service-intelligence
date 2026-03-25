/**
 * WeekDispatchGrid — the main Week view component for the dispatch board.
 * Technician rows on the left, day columns across the week.
 * Each cell shows visits/tasks for that tech on that day in a compact list.
 * Splits technicians into working (on-shift) and off-shift groups.
 */
import { format, isToday, isWeekend } from "date-fns";
import type { DispatchVisit, DispatchTask, Technician } from "./dispatchPreviewTypes";
import WeekDispatchCell from "./WeekDispatchCell";

type Props = {
  technicians: Technician[];
  weekDays: Date[];
  visitsByTechByDay: Map<string, Map<string, DispatchVisit[]>>;
  tasksByTechByDay: Map<string, Map<string, DispatchTask[]>>;
  selectedItemId: string | null;
  onSelectVisit: (visit: DispatchVisit) => void;
  onSelectTask: (task: DispatchTask) => void;
};

const ROW_MIN_HEIGHT = 80;
const TECH_COL_WIDTH = 180;

function TechRow({ tech, weekDays, visitsByTechByDay, tasksByTechByDay, selectedItemId, onSelectVisit, onSelectTask, isLast, isOffShift }: {
  tech: Technician;
  weekDays: Date[];
  visitsByTechByDay: Map<string, Map<string, DispatchVisit[]>>;
  tasksByTechByDay: Map<string, Map<string, DispatchTask[]>>;
  selectedItemId: string | null;
  onSelectVisit: (visit: DispatchVisit) => void;
  onSelectTask: (task: DispatchTask) => void;
  isLast: boolean;
  isOffShift: boolean;
}) {
  return (
    <div className={`flex ${!isLast ? "border-b" : ""}`}>
      {/* Tech name cell */}
      <div
        className="flex items-center gap-2 border-r px-3 flex-shrink-0"
        style={{ width: TECH_COL_WIDTH, minHeight: ROW_MIN_HEIGHT }}
      >
        <div
          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${isOffShift ? "opacity-50" : ""}`}
          style={{ backgroundColor: tech.color }}
        >
          {tech.initials}
        </div>
        <p className={`truncate text-[13px] font-medium leading-tight ${isOffShift ? "text-slate-400" : "text-foreground"}`}>
          {tech.name}
        </p>
      </div>

      {/* Day cells */}
      {weekDays.map(day => {
        const dayKey = format(day, "yyyy-MM-dd");
        const visits = visitsByTechByDay.get(tech.id)?.get(dayKey) ?? [];
        const tasks = tasksByTechByDay.get(tech.id)?.get(dayKey) ?? [];
        const today = isToday(day);
        const weekend = isWeekend(day);

        return (
          <div
            key={dayKey}
            className={`flex-1 min-w-[140px] border-r p-1 ${
              today ? "bg-blue-50/30" : weekend ? "bg-slate-50/50" : ""
            }`}
            style={{ minHeight: ROW_MIN_HEIGHT }}
          >
            <WeekDispatchCell
              visits={visits}
              tasks={tasks}
              selectedItemId={selectedItemId}
              onSelectVisit={onSelectVisit}
              onSelectTask={onSelectTask}
              techId={tech.id}
              dayKey={dayKey}
            />
          </div>
        );
      })}
    </div>
  );
}

export default function WeekDispatchGrid({
  technicians, weekDays, visitsByTechByDay, tasksByTechByDay,
  selectedItemId, onSelectVisit, onSelectTask,
}: Props) {
  // Split into working and off-shift groups
  const working = technicians.filter(t => t.isWorking !== false);
  const offShift = technicians.filter(t => t.isWorking === false);
  const orderedTechs = [...working, ...offShift];

  return (
    <div className="flex-1 overflow-auto bg-white">
      <div className="min-w-fit">
        {/* Header row: tech label + day columns */}
        <div className="sticky top-0 z-10 flex border-b bg-slate-50">
          <div
            className="flex items-center border-r px-3 text-[11px] font-medium text-muted-foreground flex-shrink-0"
            style={{ width: TECH_COL_WIDTH, height: 36 }}
          >
            Technicians
          </div>
          {weekDays.map(day => {
            const today = isToday(day);
            const weekend = isWeekend(day);
            return (
              <div
                key={day.toISOString()}
                className={`flex-1 min-w-[140px] flex items-center justify-center border-r text-[11px] font-medium ${
                  today ? "bg-blue-50 text-blue-700 font-semibold" : weekend ? "text-slate-400" : "text-muted-foreground"
                }`}
                style={{ height: 36 }}
              >
                {format(day, "EEE d")}
              </div>
            );
          })}
        </div>

        {/* Tech rows */}
        {orderedTechs.length > 0 ? (
          <>
            {working.map((tech, i) => (
              <TechRow
                key={tech.id}
                tech={tech}
                weekDays={weekDays}
                visitsByTechByDay={visitsByTechByDay}
                tasksByTechByDay={tasksByTechByDay}
                selectedItemId={selectedItemId}
                onSelectVisit={onSelectVisit}
                onSelectTask={onSelectTask}
                isLast={i === working.length - 1 && offShift.length === 0}
                isOffShift={false}
              />
            ))}
            {offShift.length > 0 && (
              <>
                {/* Off-shift divider spanning full width */}
                <div className="flex border-b bg-slate-50/80">
                  <div
                    className="flex items-center justify-center px-3 flex-shrink-0"
                    style={{ width: TECH_COL_WIDTH }}
                  >
                    <div className="flex items-center gap-2 w-full">
                      <div className="flex-1 h-px bg-slate-200" />
                      <span className="text-[9px] font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap">Off shift</span>
                      <div className="flex-1 h-px bg-slate-200" />
                    </div>
                  </div>
                  {weekDays.map(day => (
                    <div key={day.toISOString()} className="flex-1 min-w-[140px] border-r" />
                  ))}
                </div>
                {offShift.map((tech, i) => (
                  <TechRow
                    key={tech.id}
                    tech={tech}
                    weekDays={weekDays}
                    visitsByTechByDay={visitsByTechByDay}
                    tasksByTechByDay={tasksByTechByDay}
                    selectedItemId={selectedItemId}
                    onSelectVisit={onSelectVisit}
                    onSelectTask={onSelectTask}
                    isLast={i === offShift.length - 1}
                    isOffShift={true}
                  />
                ))}
              </>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            No schedulable technicians found
          </div>
        )}
      </div>
    </div>
  );
}
