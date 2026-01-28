import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Users, Package } from "lucide-react";
import { TECHNICIAN_COLORS, getWeekStart } from "./calendarUtils";
import type { RegionalSettings } from "@/hooks/useCompanyRegionalSettings";
import { formatHourLabel } from "@/hooks/useCompanyRegionalSettings";

export interface CalendarHeaderProps {
  // View state
  view: "monthly" | "weekly" | "daily";
  onViewChange: (view: "monthly" | "weekly" | "daily") => void;

  // Date state
  currentDate: Date;
  month: number;
  year: number;
  monthNames: string[];

  // Navigation
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onGoToToday: () => void;

  // Technician filter (weekly view)
  selectedTechnicianId: string | null;
  onSelectedTechnicianChange: (id: string | null) => void;
  technicians: any[];

  // Parts button (weekly view)
  onPartsClick: () => void;

  // Start hour (weekly/daily view)
  calendarStartHour: number;
  onStartHourChange: (hour: number) => void;

  // Technician visibility chips
  hiddenTechnicianIds: Set<string>;
  onToggleTechnicianVisibility: (techId: string) => void;

  // Regional settings (timezone, time format, week start)
  regional: RegionalSettings;
}

export function CalendarHeader({
  view,
  onViewChange,
  currentDate,
  month,
  year,
  monthNames,
  onPreviousMonth,
  onNextMonth,
  onGoToToday,
  selectedTechnicianId,
  onSelectedTechnicianChange,
  technicians,
  onPartsClick,
  calendarStartHour,
  onStartHourChange,
  hiddenTechnicianIds,
  onToggleTechnicianVisibility,
  regional,
}: CalendarHeaderProps) {
  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={onPreviousMonth}
            data-testid={view === "weekly" ? "button-previous-week" : "button-previous-month"}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-2xl font-bold">
            {view === "weekly" ? (
              (() => {
                const weekStart = getWeekStart(currentDate, regional.weekStartsOn);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekEnd.getDate() + 6);

                const startMonth = monthNames[weekStart.getMonth()];
                const endMonth = monthNames[weekEnd.getMonth()];
                const startDay = weekStart.getDate();
                const endDay = weekEnd.getDate();
                const startYear = weekStart.getFullYear();
                const endYear = weekEnd.getFullYear();

                if (startYear !== endYear) {
                  return `${startMonth} ${startDay}, ${startYear} - ${endMonth} ${endDay}, ${endYear}`;
                } else if (startMonth !== endMonth) {
                  return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${endYear}`;
                } else {
                  return `${startMonth} ${startDay}-${endDay}, ${endYear}`;
                }
              })()
            ) : (
              `${monthNames[month - 1]} ${year}`
            )}
          </h2>
          <Button
            variant="outline"
            size="icon"
            onClick={onNextMonth}
            data-testid={view === "weekly" ? "button-next-week" : "button-next-month"}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={onGoToToday}
            data-testid="button-today"
          >
            Today
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {view === "weekly" && (
            <>
              <Select value={selectedTechnicianId || "all"} onValueChange={(v) => onSelectedTechnicianChange(v === "all" ? null : v)}>
                <SelectTrigger className="w-36 text-xs h-8" data-testid="select-technician-filter">
                  <Users className="h-3.5 w-3.5 mr-1.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Technicians</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {technicians.map((tech: any) => (
                    <SelectItem key={tech.id} value={tech.id}>
                      {tech.firstName} {tech.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={onPartsClick}
                data-testid="button-parts"
              >
                <Package className="h-3.5 w-3.5 mr-1.5" />
                Parts
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Start:</span>
                <Select
                  value={String(calendarStartHour)}
                  onValueChange={(value) => onStartHourChange(parseInt(value, 10))}
                >
                  <SelectTrigger className="w-20 text-xs h-8" data-testid="select-start-hour">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => i).map((hour) => (
                      <SelectItem key={hour} value={String(hour)}>
                        {formatHourLabel(hour, regional.timeFormat)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          <div className="flex gap-1 bg-muted/50 p-1 rounded-full">
            <Button
              variant={view === "monthly" ? "default" : "ghost"}
              size="sm"
              className={`rounded-full ${view === "monthly" ? "" : "hover:bg-background/60"}`}
              onClick={() => onViewChange("monthly")}
              data-testid="button-monthly-view"
            >
              Monthly
            </Button>
            <Button
              variant={view === "weekly" ? "default" : "ghost"}
              size="sm"
              className={`rounded-full ${view === "weekly" ? "" : "hover:bg-background/60"}`}
              onClick={() => onViewChange("weekly")}
              data-testid="button-weekly-view"
            >
              Weekly
            </Button>
            <Button
              variant={view === "daily" ? "default" : "ghost"}
              size="sm"
              className={`rounded-full ${view === "daily" ? "" : "hover:bg-background/60"}`}
              onClick={() => onViewChange("daily")}
              data-testid="button-daily-view"
            >
              Day
            </Button>
          </div>
        </div>
      </div>

      {/* Technician Filter Chips */}
      {technicians.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap text-xs mt-1.5">
          <span className="text-muted-foreground font-medium text-[11px]">Show:</span>
          {technicians.map((tech: any, index: number) => {
            const color = TECHNICIAN_COLORS[index % TECHNICIAN_COLORS.length];
            const isHidden = hiddenTechnicianIds.has(tech.id);
            return (
              <button
                key={tech.id}
                onClick={() => onToggleTechnicianVisibility(tech.id)}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full border transition-all text-[10px] ${
                  isHidden
                    ? 'bg-muted/30 border-muted-foreground/20 opacity-50'
                    : `${color.bg} ${color.border}`
                }`}
                data-testid={`chip-technician-${tech.id}`}
              >
                <div className={`w-2 h-2 rounded-full ${color.dot}`} />
                <span className={isHidden ? 'text-muted-foreground' : ''}>{tech.firstName} {tech.lastName?.[0]}.</span>
              </button>
            );
          })}
          <button
            onClick={() => onToggleTechnicianVisibility('unassigned')}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full border transition-all text-[10px] ${
              hiddenTechnicianIds.has('unassigned')
                ? 'bg-muted/30 border-muted-foreground/20 opacity-50'
                : 'bg-muted/50 border-muted-foreground/30'
            }`}
            data-testid="chip-technician-unassigned"
          >
            <div className="w-2 h-2 rounded-full bg-muted-foreground/40" />
            <span className={hiddenTechnicianIds.has('unassigned') ? 'text-muted-foreground' : ''}>Unassigned</span>
          </button>
        </div>
      )}
    </>
  );
}
