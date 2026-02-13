/**
 * Schedule Job Modal - Calendar Slice 3
 *
 * Modal for scheduling/editing job assignments from the calendar.
 * Uses unified JobScheduleFields component for consistent scheduling UI.
 *
 * Entry points:
 * - Calendar hour slot click => pre-fill date + time
 * - Calendar all-day lane click => pre-fill date, all-day mode
 * - Job detail action => schedule existing job
 *
 * Handles validation errors:
 * - OUTSIDE_WORKING_HOURS
 * - TECHNICIAN_OVERBOOKED
 * - CROSS_DAY_NOT_ALLOWED
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Clock, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  JobScheduleFields,
  JobScheduleValue,
  createDefaultScheduleValue,
  parseJobToScheduleValue,
} from "@/components/jobs/JobScheduleFields";
import { applyJobSchedule } from "@/lib/jobScheduling";

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
  /** Pre-selected start minutes (0-59) */
  initialMinutes?: number;
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
    isAllDay?: boolean;
  };
  /** Whether to default to all-day mode (e.g., from all-day drop zone) */
  defaultAllDay?: boolean;
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
  initialMinutes,
  initialTechnicianId,
  editAssignment,
  onSuccess,
  defaultAllDay,
}: ScheduleJobModalProps) {
  const { toast } = useToast();
  const isEditMode = !!editAssignment;

  // Form state
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [scheduleValue, setScheduleValue] = useState<JobScheduleValue>(
    createDefaultScheduleValue({ unscheduled: false })
  );
  const [notes, setNotes] = useState<string>("");
  const [validationError, setValidationError] = useState<ValidationError | null>(null);

  // Fetch unscheduled/schedulable jobs
  const { data: schedulableJobs = [] } = useQuery<any[]>({
    // Phase 5 E2: canonical family key
    queryKey: ["jobs", { status: "pending,scheduled" }],
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
        setScheduleValue(parseJobToScheduleValue({
          scheduledStart: editAssignment.scheduledStart,
          scheduledEnd: editAssignment.scheduledEnd,
          isAllDay: editAssignment.isAllDay,
          primaryTechnicianId: editAssignment.primaryTechnicianId,
        }));
        setNotes(editAssignment.notes || "");
      } else {
        // Create mode - use initial values
        setSelectedJobId(jobId || "");

        // Build initial schedule value
        const dateStr = initialDate
          ? format(initialDate, "yyyy-MM-dd")
          : format(new Date(), "yyyy-MM-dd");

        const timeStr = initialHour !== undefined && !defaultAllDay
          ? `${String(initialHour).padStart(2, "0")}:${String(initialMinutes || 0).padStart(2, "0")}`
          : "";

        setScheduleValue(createDefaultScheduleValue({
          unscheduled: false,
          date: dateStr,
          time: timeStr,
          isAllDay: defaultAllDay || false,
          durationMinutes: 60,
          primaryTechnicianId: initialTechnicianId || undefined,
        }));
        setNotes("");
      }
    }
  }, [open, jobId, initialDate, initialHour, initialMinutes, initialTechnicianId, editAssignment, defaultAllDay]);

  // Schedule mutation
  const scheduleMutation = useMutation({
    mutationFn: async () => {
      const targetJobId = isEditMode ? editAssignment!.jobId : selectedJobId;

      const result = await applyJobSchedule(targetJobId, scheduleValue, {
        notes,
        existingAssignmentId: isEditMode ? editAssignment!.id : undefined,
      });

      if (!result.success) {
        throw new Error(result.error || "Failed to schedule job");
      }

      return result.job;
    },
    onSuccess: () => {
      toast({
        title: isEditMode ? "Schedule updated" : "Job scheduled",
        description: isEditMode
          ? "The assignment has been updated"
          : "The job has been added to the calendar",
      });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: any) => {
      // Check for structured validation errors
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

  const handleSubmit = () => {
    setValidationError(null);

    // Validation
    if (!scheduleValue.date) {
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

    scheduleMutation.mutate();
  };

  const isPending = scheduleMutation.isPending;

  const getValidationErrorMessage = () => {
    if (!validationError) return null;

    switch (validationError.code) {
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
              <Label htmlFor="job">Job *</Label>
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

          {/* Unified Scheduling Fields */}
          <JobScheduleFields
            value={scheduleValue}
            onChange={setScheduleValue}
            hideUnscheduledToggle={true} // Calendar modal always schedules
          />

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
          <Button onClick={handleSubmit} disabled={isPending || (!isEditMode && !selectedJobId)}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditMode ? "Update Schedule" : "Schedule Job"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
