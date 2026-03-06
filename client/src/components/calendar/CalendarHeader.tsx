/**
 * CalendarHeader - Consolidated calendar controls
 *
 * Phase 6 of Calendar Page UI Rewrite (2026-03-04)
 * Changes from original:
 * - Date title: text-lg font-semibold (was text-2xl font-bold)
 * - Technician chips row removed → TechnicianFilterPopover in controls row
 * - Tasks always shown (toggle removed in Polish Pass)
 * - Day layout toggle added (columns/rows) in Polish Pass
 * - Controls consolidated into single flex row
 */

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Columns3, Rows3, ArrowUpDown, AlertTriangle, CalendarOff } from "lucide-react";
import type { DayLayout } from "@/hooks/useCalendarState";
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

  // Hide weekends toggle (weekly view, 2026-03-06)
  hideWeekends?: boolean;
  onToggleHideWeekends?: () => void;

  // Start hour (weekly/daily view)
  calendarStartHour: number;
  onStartHourChange: (hour: number) => void;

  // Day layout toggle (daily view only)
  dayLayout: DayLayout;
  onToggleDayLayout: () => void;

  // Regional settings (timezone, time format, week start)
  regional: RegionalSettings;

  // Risk sort + alerts filter (Calendar Improvement 2026-03-05)
  riskFirstSort?: boolean;
  onToggleRiskFirstSort?: () => void;
  alertsOnly?: boolean;
  onToggleAlertsOnly?: () => void;
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
  hideWeekends,
  onToggleHideWeekends,
  calendarStartHour,
  onStartHourChange,
  dayLayout,
  onToggleDayLayout,
  regional,
  riskFirstSort,
  onToggleRiskFirstSort,
  alertsOnly,
  onToggleAlertsOnly,
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
        {/* Risk-first sort toggle (Calendar Improvement 2026-03-05) */}
        {(view === "weekly" || view === "daily") && onToggleRiskFirstSort && (
          <Button
            variant={riskFirstSort ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={onToggleRiskFirstSort}
            title="Sort technician lanes by risk level"
          >
            <ArrowUpDown className="h-3 w-3" />
            Risk first
          </Button>
        )}

        {/* Alerts-only filter toggle (Calendar Improvement 2026-03-05) */}
        {(view === "weekly" || view === "daily") && onToggleAlertsOnly && (
          <Button
            variant={alertsOnly ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={onToggleAlertsOnly}
            title="Only show lanes with active alerts"
          >
            <AlertTriangle className="h-3 w-3" />
            Alerts only
          </Button>
        )}

        {/* Technician filter popover (all views) */}
        <TechnicianFilterPopover
          technicians={technicians}
          hiddenTechnicianIds={hiddenTechnicianIds}
          onToggleTechnicianVisibility={onToggleTechnicianVisibility}
        />

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

        {/* Day layout toggle (daily view only) */}
        {view === "daily" && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={onToggleDayLayout}
            title={dayLayout === "columns" ? "Switch to horizontal rows" : "Switch to vertical columns"}
            data-testid="button-day-layout"
          >
            {dayLayout === "columns" ? (
              <Rows3 className="h-3.5 w-3.5" />
            ) : (
              <Columns3 className="h-3.5 w-3.5" />
            )}
            {dayLayout === "columns" ? "Rows" : "Columns"}
          </Button>
        )}

        {/* Hide weekends toggle (weekly view only, 2026-03-06) */}
        {view === "weekly" && onToggleHideWeekends && (
          <Button
            variant={hideWeekends ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={onToggleHideWeekends}
            title={hideWeekends ? "Show weekend columns" : "Hide weekend columns"}
            data-testid="button-hide-weekends"
          >
            <CalendarOff className="h-3 w-3" />
            {hideWeekends ? "Show Weekends" : "Hide Weekends"}
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
