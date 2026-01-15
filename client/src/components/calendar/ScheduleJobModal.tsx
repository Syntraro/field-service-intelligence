/**
 * Schedule Job Modal - Calendar Slice 3
 *
 * Modal for scheduling/editing job assignments:
 * - Job selection (from unscheduled jobs list)
 * - Technician dropdown
 * - Date picker
 * - Start/End time fields
 * - Notes
 *
 * Handles validation errors:
 * - OUTSIDE_WORKING_HOURS
 * - TECHNICIAN_OVERBOOKED
 * - CROSS_DAY_NOT_ALLOWED
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, addHours, setHours, setMinutes, parseISO } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarIcon, AlertCircle, Clock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

// ============================================================================
// Types
// ============================================================================

export interface ScheduleJobModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected job ID (for scheduling from job detail) */
  jobId?: string;
  /** Pre-selected date (for scheduling from calendar click) */
  initialDate?: Date;
  /** Pre-selected start time (hour, 0-23) */
  initialHour?: number;
  /** Pre-selected technician */
  initialTechnicianId?: string;
  /** Existing assignment to edit */
  editAssignment?: {
    id: string;
    jobId: string;
    scheduledStart: string | null;
    scheduledEnd: string | null;
    primaryTechnicianId: string | null;
    notes?: string;
  };
  /** Callback after successful save */
  onSuccess?: () => void;
}

interface ValidationError {
  code: string;
  message: string;
  details?: {
    allowedStart?: string;
    allowedEnd?: string;
    dayOfWeek?: number;
    dayName?: string;
    conflictingJobNumber?: number;
    conflictingTitle?: string;
    conflictingStart?: string;
    conflictingEnd?: string;
  };
}

// ============================================================================
// Component
// ============================================================================

export function ScheduleJobModal({
  open,
  onOpenChange,
  jobId,
  initialDate,
  initialHour,
  initialTechnicianId,
  editAssignment,
  onSuccess,
}: ScheduleJobModalProps) {
  const { toast } = useToast();
  const isEditMode = !!editAssignment;

  // Form state
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [startTime, setStartTime] = useState<string>("09:00");
  const [endTime, setEndTime] = useState<string>("10:00");
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [validationError, setValidationError] = useState<ValidationError | null>(null);

  // Fetch technicians
  const { data: technicians = [] } = useQuery<any[]>({
    queryKey: ["/api/team/technicians"],
  });

  // Fetch unscheduled/schedulable jobs
  const { data: schedulableJobs = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs", { status: "pending,scheduled" }],
    queryFn: async () => {
      const res = await fetch("/api/jobs?status=pending,scheduled&limit=100");
      if (!res.ok) throw new Error("Failed to fetch jobs");
      const data = await res.json();
      return data.jobs || [];
    },
    enabled: open && !isEditMode,
  });

  // Initialize form when modal opens or props change
  useEffect(() => {
    if (open) {
      setValidationError(null);

      if (editAssignment) {
        // Edit mode - populate from assignment
        setSelectedJobId(editAssignment.jobId);
        if (editAssignment.scheduledStart) {
          const start = parseISO(editAssignment.scheduledStart);
          setSelectedDate(start);
          setStartTime(format(start, "HH:mm"));
        }
        if (editAssignment.scheduledEnd) {
          const end = parseISO(editAssignment.scheduledEnd);
          setEndTime(format(end, "HH:mm"));
        }
        setSelectedTechnicianId(editAssignment.primaryTechnicianId || "");
        setNotes(editAssignment.notes || "");
      } else {
        // Create mode - use initial values
        setSelectedJobId(jobId || "");
        setSelectedDate(initialDate || new Date());
        if (initialHour !== undefined) {
          setStartTime(`${String(initialHour).padStart(2, "0")}:00`);
          setEndTime(`${String(initialHour + 1).padStart(2, "0")}:00`);
        } else {
          setStartTime("09:00");
          setEndTime("10:00");
        }
        setSelectedTechnicianId(initialTechnicianId || "");
        setNotes("");
      }
    }
  }, [open, jobId, initialDate, initialHour, initialTechnicianId, editAssignment]);

  // Create assignment mutation
  const createMutation = useMutation({
    mutationFn: async (payload: {
      jobId: string;
      technicianUserId?: string;
      startAt: string;
      endAt: string;
      notes?: string;
    }) => {
      return apiRequest("/api/calendar/assignments", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({
        title: "Job scheduled",
        description: "The job has been added to the calendar",
      });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: async (error: any) => {
      // Check for validation errors from backend
      if (error.response) {
        try {
          const data = await error.response.json();
          if (data.code) {
            setValidationError(data);
            return;
          }
        } catch {}
      }
      // Handle fetch response errors
      if (error.code) {
        setValidationError(error);
        return;
      }
      toast({
        title: "Error",
        description: error.message || "Failed to schedule job",
        variant: "destructive",
      });
    },
  });

  // Update assignment mutation
  const updateMutation = useMutation({
    mutationFn: async (payload: {
      technicianUserId?: string | null;
      startAt?: string;
      endAt?: string;
      notes?: string | null;
    }) => {
      return apiRequest(`/api/calendar/assignments/${editAssignment!.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({
        title: "Schedule updated",
        description: "The assignment has been updated",
      });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: async (error: any) => {
      if (error.code) {
        setValidationError(error);
        return;
      }
      toast({
        title: "Error",
        description: error.message || "Failed to update schedule",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    setValidationError(null);

    if (!selectedDate) {
      toast({
        title: "Error",
        description: "Please select a date",
        variant: "destructive",
      });
      return;
    }

    if (!isEditMode && !selectedJobId) {
      toast({
        title: "Error",
        description: "Please select a job",
        variant: "destructive",
      });
      return;
    }

    // Parse times and build ISO strings
    const [startHour, startMin] = startTime.split(":").map(Number);
    const [endHour, endMin] = endTime.split(":").map(Number);

    const startDateTime = setMinutes(setHours(selectedDate, startHour), startMin);
    const endDateTime = setMinutes(setHours(selectedDate, endHour), endMin);

    // Validate end is after start
    if (endDateTime <= startDateTime) {
      setValidationError({
        code: "INVALID_TIME_RANGE",
        message: "End time must be after start time",
      });
      return;
    }

    const startAt = startDateTime.toISOString();
    const endAt = endDateTime.toISOString();

    if (isEditMode) {
      updateMutation.mutate({
        technicianUserId: selectedTechnicianId || null,
        startAt,
        endAt,
        notes: notes || null,
      });
    } else {
      createMutation.mutate({
        jobId: selectedJobId,
        technicianUserId: selectedTechnicianId || undefined,
        startAt,
        endAt,
        notes: notes || undefined,
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  // Generate time options (every 15 minutes)
  const timeOptions = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const display = format(setMinutes(setHours(new Date(), h), m), "h:mm a");
      timeOptions.push({ value: time, label: display });
    }
  }

  const getValidationErrorMessage = () => {
    if (!validationError) return null;

    switch (validationError.code) {
      case "OUTSIDE_WORKING_HOURS":
        return (
          <div className="flex items-start gap-2 p-3 text-sm bg-amber-50 text-amber-800 rounded-md border border-amber-200">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Outside Working Hours</p>
              <p className="text-amber-700">
                {validationError.message}
                {validationError.details?.allowedStart && validationError.details?.allowedEnd && (
                  <span className="block mt-1">
                    Allowed hours on {validationError.details.dayName}:{" "}
                    {validationError.details.allowedStart} - {validationError.details.allowedEnd}
                  </span>
                )}
              </p>
            </div>
          </div>
        );

      case "TECHNICIAN_OVERBOOKED":
        return (
          <div className="flex items-start gap-2 p-3 text-sm bg-red-50 text-red-800 rounded-md border border-red-200">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Scheduling Conflict</p>
              <p className="text-red-700">
                {validationError.message}
                {validationError.details?.conflictingJobNumber && (
                  <span className="block mt-1">
                    Conflicting job: #{validationError.details.conflictingJobNumber}
                    {validationError.details.conflictingTitle &&
                      ` - ${validationError.details.conflictingTitle}`}
                  </span>
                )}
              </p>
            </div>
          </div>
        );

      case "CROSS_DAY_NOT_ALLOWED":
        return (
          <div className="flex items-start gap-2 p-3 text-sm bg-amber-50 text-amber-800 rounded-md border border-amber-200">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Invalid Time Range</p>
              <p className="text-amber-700">Assignments cannot span multiple days</p>
            </div>
          </div>
        );

      default:
        return (
          <div className="flex items-start gap-2 p-3 text-sm bg-red-50 text-red-800 rounded-md border border-red-200">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <p>{validationError.message}</p>
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            {isEditMode ? "Edit Schedule" : "Schedule Job"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Validation Error Display */}
          {validationError && getValidationErrorMessage()}

          {/* Job Selection (only for create mode) */}
          {!isEditMode && (
            <div className="space-y-2">
              <Label htmlFor="job">Job</Label>
              <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                <SelectTrigger id="job">
                  <SelectValue placeholder="Select a job to schedule" />
                </SelectTrigger>
                <SelectContent>
                  {schedulableJobs.map((job: any) => (
                    <SelectItem key={job.id} value={job.id}>
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-xs">#{job.jobNumber}</span>
                        <span className="truncate">{job.summary || job.locationName}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Technician Selection */}
          <div className="space-y-2">
            <Label htmlFor="technician">Technician</Label>
            <Select value={selectedTechnicianId} onValueChange={setSelectedTechnicianId}>
              <SelectTrigger id="technician">
                <SelectValue placeholder="Select technician (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Unassigned</SelectItem>
                {technicians.map((tech: any) => (
                  <SelectItem key={tech.id} value={tech.id}>
                    {tech.fullName || `${tech.firstName} ${tech.lastName}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date Selection */}
          <div className="space-y-2">
            <Label>Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !selectedDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {selectedDate ? format(selectedDate, "PPP") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Time Selection */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startTime">Start Time</Label>
              <Select value={startTime} onValueChange={setStartTime}>
                <SelectTrigger id="startTime">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="endTime">End Time</Label>
              <Select value={endTime} onValueChange={setEndTime}>
                <SelectTrigger id="endTime">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              placeholder="Add scheduling notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditMode ? "Update Schedule" : "Schedule Job"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
