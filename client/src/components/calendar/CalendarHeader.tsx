/**
 * CalendarHeader - Consolidated calendar controls
 *
 * Phase 6 of Calendar Page UI Rewrite (2026-03-04)
 * Changes from original:
 * - Date title: text-lg font-semibold (was text-2xl font-bold)
 * - Technician chips row removed → TechnicianFilterPopover in controls row
 * - "Show tasks" Switch toggle added
 * - Controls consolidated into single flex row
 */

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Package } from "lucide-react";
import { getWeekStart } from "./calendarUtils";
import { TechnicianFilterPopover } from "./TechnicianFilterPopover";
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

  // Technician visibility
  technicians: any[];
  hiddenTechnicianIds: Set<string>;
  onToggleTechnicianVisibility: (techId: string) => void;

  // Parts button (weekly view)
  onPartsClick: () => void;

  // Start hour (weekly/daily view)
  calendarStartHour: number;
  onStartHourChange: (hour: number) => void;

  // Tasks toggle
  showTasks: boolean;
  onToggleShowTasks: () => void;

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
  technicians,
  hiddenTechnicianIds,
  onToggleTechnicianVisibility,
  onPartsClick,
  calendarStartHour,
  onStartHourChange,
  showTasks,
  onToggleShowTasks,
  regional,
}: CalendarHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      {/* Left: navigation + date title */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={onPreviousMonth}
          data-testid={view === "weekly" ? "button-previous-week" : "button-previous-month"}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-lg font-semibold">
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
          ) : view === "daily" ? (
            (() => {
              const dayName = currentDate.toLocaleDateString(undefined, { weekday: "short" });
              return `${dayName}, ${monthNames[month - 1]} ${currentDate.getDate()}, ${year}`;
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

      {/* Right: controls row */}
      <div className="flex items-center gap-2">
        {/* Technician filter popover (all views) */}
        <TechnicianFilterPopover
          technicians={technicians}
          hiddenTechnicianIds={hiddenTechnicianIds}
          onToggleTechnicianVisibility={onToggleTechnicianVisibility}
        />

        {/* Show tasks toggle */}
        <div className="flex items-center gap-1.5">
          <Switch
            id="show-tasks"
            checked={showTasks}
            onCheckedChange={onToggleShowTasks}
            className="scale-75"
          />
          <label htmlFor="show-tasks" className="text-xs text-muted-foreground cursor-pointer select-none">
            Tasks
          </label>
        </div>

        {/* Start hour selector (weekly/daily only) */}
        {(view === "weekly" || view === "daily") && (
          <div className="flex items-center gap-1.5">
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
        )}

        {/* Parts button (weekly only) */}
        {view === "weekly" && (
          <Button
            variant="outline"
            size="sm"
            onClick={onPartsClick}
            data-testid="button-parts"
          >
            <Package className="h-3.5 w-3.5 mr-1.5" />
            Parts
          </Button>
        )}

        {/* View switch pills */}
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
  );
}
