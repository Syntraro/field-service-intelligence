import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  invalidateCalendarAndUnscheduledQueries,
  invalidateJobQueries,
  invalidateVisitQueries,
} from "@/hooks/useSchedulingApi";

interface AddVisitDialogProps {
  jobId: string;
  jobVersion: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technicians: any[];
  /** Optional default technician ID (e.g., from current visit for follow-up) */
  defaultTechnicianId?: string | null;
  /** Callback when visit is successfully created - receives new visit ID for highlighting */
  onVisitCreated?: (visitId: string) => void;
  /** Visit Reschedule Architecture: conflict resolution mode from parent */
  conflictMode?: 'replace' | 'complete_and_new';
  /** Visit Reschedule Architecture: ID of the conflicting visit */
  conflictVisitId?: string;
}

export function AddVisitDialog({
  jobId,
  jobVersion,
  open,
  onOpenChange,
  technicians,
  defaultTechnicianId,
  onVisitCreated,
  conflictMode,
  conflictVisitId,
}: AddVisitDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("09:00");
  const [estimatedDuration, setEstimatedDuration] = useState("60");
  // Sentinel value for "no technician" — Radix Select rejects value=""
  const UNASSIGNED = "__unassigned__";
  const [assignedTechnicianId, setAssignedTechnicianId] = useState<string>(UNASSIGNED);
  const [visitNotes, setVisitNotes] = useState("");

  useEffect(() => {
    if (open) {
      // Reset form when dialog opens
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setScheduledDate(format(tomorrow, "yyyy-MM-dd"));
      setScheduledTime("09:00");
      setEstimatedDuration("60");
      // Default technician from prop (e.g., follow-up inherits from current visit)
      setAssignedTechnicianId(defaultTechnicianId || UNASSIGNED);
      setVisitNotes("");
    }
  }, [open, defaultTechnicianId]);

  // Phase 4: Use canonical calendar schedule endpoint
  // POST /api/calendar/schedule creates a job_visit and syncs to jobs table
  // IMPORTANT: This MUST be POST (create new visit), never PATCH (reschedule existing)
  const SCHEDULE_ENDPOINT = "/api/calendar/schedule";
  const SCHEDULE_METHOD = "POST";

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      // DEV-only assertion: Guarantee we always create NEW visits, never reschedule
      // This prevents accidental reuse of PATCH /api/calendar/schedule/:jobId
      if (process.env.NODE_ENV === "development") {
        console.log(
          "[AddVisitDialog] Creating new visit via %s %s (jobId=%s)",
          SCHEDULE_METHOD,
          SCHEDULE_ENDPOINT,
          data.jobId
        );
        // Assert: endpoint must NOT contain jobId path param (that would be reschedule)
        if (SCHEDULE_ENDPOINT.includes("/:") || SCHEDULE_ENDPOINT.match(/\/[a-f0-9-]{36}/i)) {
          console.error(
            "[AddVisitDialog] ASSERTION FAILED: Endpoint appears to be a reschedule path!",
            SCHEDULE_ENDPOINT
          );
        }
        // Assert: method must be POST, not PATCH
        if (SCHEDULE_METHOD !== "POST") {
          console.error(
            "[AddVisitDialog] ASSERTION FAILED: Method must be POST, got:",
            SCHEDULE_METHOD
          );
        }
      }

      return await apiRequest(SCHEDULE_ENDPOINT, {
        method: SCHEDULE_METHOD,
        body: JSON.stringify(data),
      });
    },
    onSuccess: (data: any) => {
      // Use centralized invalidation helpers for consistency and DEV logging
      // Schedule creates visit: calendar + unscheduled (job may move from backlog)
      invalidateCalendarAndUnscheduledQueries(queryClient, "schedule-visit", jobId);
      invalidateJobQueries(queryClient, "schedule-visit", jobId);
      invalidateVisitQueries(queryClient, "schedule-visit", jobId);

      toast({
        title: "Visit Scheduled",
        description: "The visit has been added to the job.",
      });
      // Notify parent of new visit ID for highlighting/scrolling
      if (onVisitCreated && data?.visit?.id) {
        onVisitCreated(data.visit.id);
      }
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to schedule visit.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Build payload matching scheduleJobSchema field names exactly
    // Combine date and time into ISO datetime string
    // Fix: Construct Date without Z suffix so JS interprets as local time,
    // then toISOString() converts to correct UTC (matches EditVisitModal pattern)
    const startAt = new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString();

    createMutation.mutate({
      jobId,
      startAt,
      durationMinutes: parseInt(estimatedDuration, 10),
      technicianUserId: assignedTechnicianId === UNASSIGNED ? null : assignedTechnicianId || null,
      notes: visitNotes.trim() || undefined,
      version: jobVersion,
      // Visit Reschedule Architecture: pass conflict resolution to backend
      ...(conflictMode && { conflictMode }),
      ...(conflictVisitId && { conflictVisitId }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-add-visit">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Schedule Visit</DialogTitle>
            <DialogDescription>
              Add a scheduled site visit for this job.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="scheduledDate">Date</Label>
                <Input
                  id="scheduledDate"
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  required
                  data-testid="input-visit-date"
                />
              </div>
              <div>
                <Label htmlFor="scheduledTime">Time</Label>
                <Input
                  id="scheduledTime"
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  required
                  data-testid="input-visit-time"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="estimatedDuration">Estimated Duration (minutes)</Label>
              <Input
                id="estimatedDuration"
                type="number"
                min="15"
                step="15"
                value={estimatedDuration}
                onChange={(e) => setEstimatedDuration(e.target.value)}
                required
                data-testid="input-visit-duration"
              />
            </div>
            <div>
              <Label htmlFor="assignedTechnician">Assign Technician (Optional)</Label>
              <Select
                value={assignedTechnicianId}
                onValueChange={setAssignedTechnicianId}
              >
                <SelectTrigger data-testid="select-visit-technician">
                  <SelectValue placeholder="Select technician..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {technicians.map((tech: any) => (
                    <SelectItem key={String(tech.id)} value={String(tech.id)}>
                      {tech.firstName && tech.lastName
                        ? `${tech.firstName} ${tech.lastName}`
                        : tech.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="visitNotes">Notes (Optional)</Label>
              <Textarea
                id="visitNotes"
                rows={3}
                value={visitNotes}
                onChange={(e) => setVisitNotes(e.target.value)}
                placeholder="Special instructions or notes for this visit..."
                data-testid="input-visit-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-visit"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending}
              data-testid="button-save-visit"
            >
              {createMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Schedule Visit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
