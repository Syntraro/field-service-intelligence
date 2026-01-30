/**
 * JobScheduleFields - Unified scheduling component
 *
 * Used by:
 * - QuickAddJobDialog (new job creation)
 * - ScheduleJobModal (calendar scheduling)
 * - Job edit views
 *
 * Provides consistent scheduling UI with:
 * - Unscheduled checkbox (disables all fields when checked)
 * - Date picker (required when scheduled)
 * - Time picker (optional - empty = all-day)
 * - Duration input (for timed events)
 * - Technician assignment
 */

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, setHours, setMinutes } from "date-fns";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CalendarIcon, Clock, Sun, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { getMemberDisplayName } from "@/lib/displayName";

// ============================================================================
// Types
// ============================================================================

export interface JobScheduleValue {
  /** True = job is not scheduled (backlog) */
  unscheduled: boolean;
  /** True = all-day event (no specific time) */
  isAllDay: boolean;
  /** Date in YYYY-MM-DD format */
  date: string;
  /** Time in HH:mm format (empty for all-day) */
  time: string;
  /** Duration in minutes (default 60 for timed events) */
  durationMinutes: number;
  /** Primary technician ID */
  primaryTechnicianId: string;
  /** All assigned technician IDs (for future multi-select) */
  assignedTechnicianIds: string[];
}

export interface JobScheduleFieldsProps {
  value: JobScheduleValue;
  onChange: (value: JobScheduleValue) => void;
  /** Hide the unscheduled checkbox (e.g., in calendar modal where scheduling is implied) */
  hideUnscheduledToggle?: boolean;
  /** Default to scheduled mode (unscheduled=false) */
  defaultScheduled?: boolean;
  /** Compact layout for inline use */
  compact?: boolean;
  /** Disable all fields */
  disabled?: boolean;
}

// ============================================================================
// Default Value Factory
// ============================================================================

export function createDefaultScheduleValue(options?: {
  unscheduled?: boolean;
  date?: Date | string;
  time?: string;
  isAllDay?: boolean;
  durationMinutes?: number;
  primaryTechnicianId?: string;
}): JobScheduleValue {
  const date = options?.date
    ? typeof options.date === "string"
      ? options.date
      : format(options.date, "yyyy-MM-dd")
    : "";

  return {
    unscheduled: options?.unscheduled ?? true,
    isAllDay: options?.isAllDay ?? false,
    date,
    time: options?.time ?? "",
    durationMinutes: options?.durationMinutes ?? 60,
    primaryTechnicianId: options?.primaryTechnicianId ?? "",
    assignedTechnicianIds: options?.primaryTechnicianId
      ? [options.primaryTechnicianId]
      : [],
  };
}

/**
 * Parse existing job data into JobScheduleValue
 */
export function parseJobToScheduleValue(job: {
  scheduledStart?: Date | string | null;
  scheduledEnd?: Date | string | null;
  isAllDay?: boolean;
  primaryTechnicianId?: string | null;
  assignedTechnicianIds?: string[] | null;
}): JobScheduleValue {
  const hasSchedule = !!job.scheduledStart;

  if (!hasSchedule) {
    return createDefaultScheduleValue({
      unscheduled: true,
      primaryTechnicianId: job.primaryTechnicianId || undefined,
    });
  }

  const start =
    typeof job.scheduledStart === "string"
      ? parseISO(job.scheduledStart)
      : job.scheduledStart!;

  const isAllDay = job.isAllDay ?? false;

  // Compute duration from start/end
  let durationMinutes = 60;
  if (job.scheduledEnd) {
    const end =
      typeof job.scheduledEnd === "string"
        ? parseISO(job.scheduledEnd)
        : job.scheduledEnd;
    durationMinutes = Math.round(
      (end.getTime() - start.getTime()) / 60000
    );
  }

  return {
    unscheduled: false,
    isAllDay,
    date: format(start, "yyyy-MM-dd"),
    time: isAllDay ? "" : format(start, "HH:mm"),
    durationMinutes: isAllDay ? 1440 : durationMinutes,
    primaryTechnicianId: job.primaryTechnicianId || "",
    assignedTechnicianIds: job.assignedTechnicianIds || [],
  };
}

// ============================================================================
// Time Options Generator
// ============================================================================

function generateTimeOptions() {
  const options = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const display = format(setMinutes(setHours(new Date(), h), m), "h:mm a");
      options.push({ value: time, label: display });
    }
  }
  return options;
}

const TIME_OPTIONS = generateTimeOptions();

const DURATION_OPTIONS = [
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 45, label: "45 min" },
  { value: 60, label: "1 hour" },
  { value: 90, label: "1.5 hours" },
  { value: 120, label: "2 hours" },
  { value: 180, label: "3 hours" },
  { value: 240, label: "4 hours" },
  { value: 480, label: "8 hours" },
];

// ============================================================================
// Component
// ============================================================================

export function JobScheduleFields({
  value,
  onChange,
  hideUnscheduledToggle = false,
  compact = false,
  disabled = false,
}: JobScheduleFieldsProps) {
  // Fetch technicians
  const { data: technicians = [] } = useQuery<any[]>({
    queryKey: ["/api/team/technicians"],
  });

  // Normalize technicians with display names
  const technicianOptions = technicians.map((tech) => ({
    id: tech.id,
    displayName: getMemberDisplayName(tech),
  }));

  // Derive isAllDay from empty time
  const isAllDay = !value.time && !value.unscheduled && !!value.date;

  // Update handler helper
  const update = (partial: Partial<JobScheduleValue>) => {
    const newValue = { ...value, ...partial };

    // Keep assignedTechnicianIds in sync with primaryTechnicianId
    if (partial.primaryTechnicianId !== undefined) {
      newValue.assignedTechnicianIds = partial.primaryTechnicianId
        ? [partial.primaryTechnicianId]
        : [];
    }

    // When switching to/from all-day, update isAllDay
    if (partial.time !== undefined) {
      newValue.isAllDay = !partial.time;
    }

    onChange(newValue);
  };

  // Handle unscheduled toggle
  const handleUnscheduledChange = (checked: boolean) => {
    if (checked) {
      // Clear scheduling fields when marking as unscheduled
      update({
        unscheduled: true,
        date: "",
        time: "",
        isAllDay: false,
      });
    } else {
      // Default to today when scheduling
      update({
        unscheduled: false,
        date: format(new Date(), "yyyy-MM-dd"),
      });
    }
  };

  // Handle date selection
  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      update({ date: format(date, "yyyy-MM-dd") });
    }
  };

  // Handle time selection
  const handleTimeChange = (time: string) => {
    update({
      time: time === "all-day" ? "" : time,
      isAllDay: time === "all-day",
    });
  };

  const isDisabled = disabled || value.unscheduled;
  const selectedDate = value.date ? parseISO(value.date) : undefined;

  return (
    <div className={cn("space-y-4", compact && "space-y-3")}>
      {/* Unscheduled Toggle */}
      {!hideUnscheduledToggle && (
        <div className="flex items-center space-x-2">
          <Checkbox
            id="unscheduled"
            checked={value.unscheduled}
            onCheckedChange={handleUnscheduledChange}
            disabled={disabled}
            data-testid="checkbox-unscheduled"
          />
          <Label
            htmlFor="unscheduled"
            className="text-sm font-normal cursor-pointer"
          >
            Unscheduled (add to backlog)
          </Label>
        </div>
      )}

      {/* Date Selection */}
      <div className={cn("space-y-2", isDisabled && "opacity-50")}>
        <Label className="flex items-center gap-1.5">
          <CalendarIcon className="h-4 w-4" />
          Date {!value.unscheduled && "*"}
        </Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal",
                !value.date && "text-muted-foreground"
              )}
              disabled={isDisabled}
              data-testid="button-select-date"
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {value.date ? format(selectedDate!, "PPP") : "Select date..."}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleDateSelect}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Time Selection */}
      <div className={cn("space-y-2", isDisabled && "opacity-50")}>
        <Label className="flex items-center gap-1.5">
          <Clock className="h-4 w-4" />
          Time
          {isAllDay && (
            <span className="ml-2 text-xs text-amber-600 flex items-center gap-1">
              <Sun className="h-3 w-3" />
              All Day
            </span>
          )}
        </Label>
        <Select
          value={value.time || "all-day"}
          onValueChange={handleTimeChange}
          disabled={isDisabled}
        >
          <SelectTrigger data-testid="select-time">
            <SelectValue placeholder="Select time..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all-day">
              <span className="flex items-center gap-2">
                <Sun className="h-4 w-4 text-amber-500" />
                All Day
              </span>
            </SelectItem>
            {TIME_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Duration (only for timed events) */}
      {!isAllDay && !value.unscheduled && (
        <div className={cn("space-y-2", isDisabled && "opacity-50")}>
          <Label>Duration</Label>
          <Select
            value={String(value.durationMinutes)}
            onValueChange={(v) => update({ durationMinutes: Number(v) })}
            disabled={isDisabled}
          >
            <SelectTrigger data-testid="select-duration">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DURATION_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={String(opt.value)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Technician Assignment */}
      <div className={cn("space-y-2", isDisabled && "opacity-50")}>
        <Label className="flex items-center gap-1.5">
          <User className="h-4 w-4" />
          Technician
        </Label>
        <Select
          value={value.primaryTechnicianId || "none"}
          onValueChange={(v) =>
            update({ primaryTechnicianId: v === "none" ? "" : v })
          }
          disabled={isDisabled}
        >
          <SelectTrigger data-testid="select-technician">
            <SelectValue placeholder="Select technician..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Unassigned</SelectItem>
            {technicianOptions.map((tech) => (
              <SelectItem key={tech.id} value={tech.id}>
                {tech.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
