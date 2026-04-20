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
import { Loader2 } from "lucide-react";
// 2026-04-12 UI consistency: use the canonical visit team assignment pattern,
// not the legacy single-select TechnicianSelector. Matches EditVisitModal.
import { VisitTeamAssignment } from "@/components/visits/VisitTeamAssignment";
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
  /** Optional default technician crew (e.g., from current visit for follow-up).
   *  2026-04-12: accepts either the legacy single ID or the canonical array. */
  defaultTechnicianId?: string | null;
  defaultTechnicianIds?: string[] | null;
  /** Callback when visit is successfully created - receives new visit ID for highlighting */
  onVisitCreated?: (visitId: string) => void;
  /** 2026-04-18 Phase 2 (multi-visit): optional explicit visit to update
   *  in place instead of creating a new one. When absent, the canonical
   *  backend path creates a brand-new visit (the dialog's default use).
   *  Replaces the pre-multi-visit `conflictMode` / `conflictVisitId`
   *  pair, which modeled a singular "the other visit" assumption that
   *  no longer exists. */
  targetVisitId?: string;
}

export function AddVisitDialog({
  jobId,
  jobVersion,
  open,
  onOpenChange,
  defaultTechnicianId,
  defaultTechnicianIds,
  onVisitCreated,
  targetVisitId,
}: AddVisitDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("09:00");
  const [estimatedDuration, setEstimatedDuration] = useState("60");
  // 2026-04-12: multi-crew state — matches EditVisitModal's `assignedTechnicianIds`.
  const [assignedTechnicianIds, setAssignedTechnicianIds] = useState<string[]>([]);
  const [visitNotes, setVisitNotes] = useState("");

  useEffect(() => {
    if (open) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setScheduledDate(format(tomorrow, "yyyy-MM-dd"));
      setScheduledTime("09:00");
      setEstimatedDuration("60");
      // Default crew resolution: prefer the canonical array, fall back to the
      // legacy single-id prop for callers still passing the old shape.
      const seed =
        defaultTechnicianIds && defaultTechnicianIds.length > 0
          ? defaultTechnicianIds
          : defaultTechnicianId
            ? [defaultTechnicianId]
            : [];
      setAssignedTechnicianIds(seed);
      setVisitNotes("");
    }
  }, [open, defaultTechnicianId, defaultTechnicianIds]);

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

      // 2026-04-12: full crew persists in a single atomic request. The
      // schedule endpoint now accepts `assignedTechnicianIds[]` directly;
      // no follow-up PATCH is needed.
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

    // 2026-04-18 Phase 2 (multi-visit): `targetVisitId` is the canonical
    // way to ask the backend to update an existing visit in place. When
    // omitted, the backend creates a new visit (the default flow).
    createMutation.mutate({
      jobId,
      startAt,
      durationMinutes: parseInt(estimatedDuration, 10),
      assignedTechnicianIds,
      notes: visitNotes.trim() || undefined,
      version: jobVersion,
      ...(targetVisitId && { targetVisitId }),
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
              {/* 2026-04-12 UI consistency: canonical visit team assignment —
                  same popover + chip UX as EditVisitModal. Multi-select. */}
              <VisitTeamAssignment
                value={assignedTechnicianIds}
                onChange={setAssignedTechnicianIds}
              />
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
