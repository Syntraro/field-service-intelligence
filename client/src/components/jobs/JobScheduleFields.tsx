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

import { useTechniciansDirectory } from "@/hooks/useTechnicians";
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
import { Badge } from "@/components/ui/badge";
import { CalendarIcon, Clock, Plus, Sun, User, X } from "lucide-react";
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
  /** When true, fields remain editable even when value.unscheduled is true.
   *  Used by EditVisitModal so unscheduled visits show an interactive editor
   *  instead of greyed-out disabled fields. Other consumers keep default (false). */
  allowEditWhenUnscheduled?: boolean;
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
  assignedTechnicianIds?: string[];
}): JobScheduleValue {
  const date = options?.date
    ? typeof options.date === "string"
      ? options.date
      : format(options.date, "yyyy-MM-dd")
    : "";

  // assignedTechnicianIds takes precedence; fall back to singleton from primaryTechnicianId
  const techIds = options?.assignedTechnicianIds
    ?? (options?.primaryTechnicianId ? [options.primaryTechnicianId] : []);

  return {
    unscheduled: options?.unscheduled ?? true,
    isAllDay: options?.isAllDay ?? false,
    date,
    time: options?.time ?? (options?.unscheduled === false ? "09:00" : ""),
    durationMinutes: options?.durationMinutes ?? 60,
    primaryTechnicianId: techIds[0] ?? "",
    assignedTechnicianIds: techIds,
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

  // Prefer assignedTechnicianIds; fall back to singleton from primaryTechnicianId
  const techIds = (job.assignedTechnicianIds && job.assignedTechnicianIds.length > 0)
    ? job.assignedTechnicianIds
    : (job.primaryTechnicianId ? [job.primaryTechnicianId] : []);

  return {
    unscheduled: false,
    isAllDay,
    date: format(start, "yyyy-MM-dd"),
    time: isAllDay ? "" : format(start, "HH:mm"),
    durationMinutes: isAllDay ? 1440 : durationMinutes,
    primaryTechnicianId: techIds[0] || "",
    assignedTechnicianIds: techIds,
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

import { DURATION_OPTIONS_LONG as DURATION_OPTIONS } from "@/lib/schedulingConstants";

// ============================================================================
// Component
// ============================================================================

export function JobScheduleFields({
  value,
  onChange,
  hideUnscheduledToggle = false,
  compact = false,
  disabled = false,
  allowEditWhenUnscheduled = false,
}: JobScheduleFieldsProps) {
  // Fetch technicians
  const { teamMembers: technicians } = useTechniciansDirectory();

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

    // Keep primaryTechnicianId = first assigned tech (backward compat)
    if (partial.assignedTechnicianIds !== undefined) {
      newValue.primaryTechnicianId = partial.assignedTechnicianIds[0] || "";
    }

    // When switching to/from all-day, update isAllDay
    if (partial.time !== undefined) {
      newValue.isAllDay = !partial.time;
    }

    onChange(newValue);
  };

  // Technician add/remove handlers
  const handleAddTechnician = (techId: string) => {
    if (value.assignedTechnicianIds.includes(techId)) return;
    update({ assignedTechnicianIds: [...value.assignedTechnicianIds, techId] });
  };

  const handleRemoveTechnician = (techId: string) => {
    update({ assignedTechnicianIds: value.assignedTechnicianIds.filter(id => id !== techId) });
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
      // Default to today at 9:00 AM when switching to scheduled
      update({
        unscheduled: false,
        date: format(new Date(), "yyyy-MM-dd"),
        time: "09:00",
        isAllDay: false,
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
    update({ time, isAllDay: false });
  };

  const isDisabled = disabled || (value.unscheduled && !allowEditWhenUnscheduled);
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
        </Label>
        <Select
          value={value.time || "09:00"}
          onValueChange={handleTimeChange}
          disabled={isDisabled}
        >
          <SelectTrigger data-testid="select-time">
            <SelectValue placeholder="Select time..." />
          </SelectTrigger>
          <SelectContent>
            {TIME_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Duration — hidden when unscheduled unless allowEditWhenUnscheduled is set */}
      {(!value.unscheduled || allowEditWhenUnscheduled) && (
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

      {/* Technician Assignment — multi-select chips + Add */}
      <div className={cn("space-y-2", isDisabled && "opacity-50")}>
        <Label className="flex items-center gap-1.5">
          <User className="h-4 w-4" />
          Technicians
        </Label>
        <div className="flex flex-wrap gap-1.5">
          {value.assignedTechnicianIds.length === 0 && (
            <span className="text-xs text-muted-foreground italic leading-6">Unassigned</span>
          )}
          {value.assignedTechnicianIds.map((techId) => {
            const tech = technicianOptions.find(t => t.id === techId);
            if (!tech) return null;
            return (
              <Badge
                key={techId}
                variant="secondary"
                className="flex items-center gap-1 pr-1"
                data-testid={`tech-chip-${techId}`}
              >
                {tech.displayName}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 ml-0.5 hover:bg-destructive/20"
                  onClick={() => handleRemoveTechnician(techId)}
                  disabled={isDisabled}
                  data-testid={`button-remove-tech-${techId}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            );
          })}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2"
                disabled={isDisabled}
                data-testid="button-add-technician"
              >
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-1" align="start">
              <div className="text-xs font-medium text-muted-foreground px-2 py-1.5 border-b mb-1">
                Select Technician
              </div>
              {(() => {
                const available = technicianOptions.filter(
                  t => !value.assignedTechnicianIds.includes(t.id)
                );
                if (available.length === 0) {
                  return (
                    <div className="text-xs text-muted-foreground px-2 py-2">
                      No available technicians
                    </div>
                  );
                }
                return available.map(tech => (
                  <button
                    key={tech.id}
                    type="button"
                    className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-accent flex items-center gap-2"
                    onClick={() => handleAddTechnician(tech.id)}
                    data-testid={`select-tech-${tech.id}`}
                  >
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    {tech.displayName}
                  </button>
                ));
              })()}
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}
