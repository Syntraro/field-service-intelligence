import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { DAYS_OF_WEEK_FULL } from "@/lib/schedulingConstants";
import type { WeeklyHoursRow } from "@/lib/weeklyScheduleUtils";

interface Props {
  hours: WeeklyHoursRow[];
  disabled?: boolean;
  onChange: (dayOfWeek: number, isWorking: boolean) => void;
}

export function WeeklyScheduleGrid({ hours, disabled = false, onChange }: Props) {
  return (
    <div className="divide-y" data-testid="weekly-schedule-grid">
      {DAYS_OF_WEEK_FULL.map((day) => {
        const row = hours.find((h) => h.dayOfWeek === day.value) ?? {
          dayOfWeek: day.value,
          startTime: null,
          endTime: null,
          isWorking: false,
        };
        const switchId = `switch-weekly-day-${day.value}`;
        return (
          <div
            key={day.value}
            className="flex items-center gap-4 py-3"
            data-testid={`row-weekly-day-${day.value}`}
          >
            <Label
              htmlFor={switchId}
              className="w-28 text-sm font-medium cursor-pointer shrink-0"
            >
              {day.label}
            </Label>
            <span
              className={`flex-1 text-helper ${row.isWorking ? "text-foreground" : "text-muted-foreground"}`}
              data-testid={`label-weekly-status-${day.value}`}
            >
              {row.isWorking ? "Working" : "Not Working"}
            </span>
            <Switch
              id={switchId}
              checked={row.isWorking}
              onCheckedChange={(checked) => onChange(day.value, checked)}
              disabled={disabled}
              data-testid={`switch-weekly-day-${day.value}`}
            />
          </div>
        );
      })}
    </div>
  );
}
