/**
 * EditVisitModal - Canonical visit editing modal
 *
 * Shared component used by both Job Detail and Calendar flows.
 * Uses JobScheduleFields for consistent scheduling UI (date picker,
 * time dropdown, duration select, multi-tech chips).
 *
 * Saves via PATCH /api/jobs/:jobId/visits/:visitId.
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CalendarMinus, Check, Loader2, MoreVertical, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, isApiError } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  JobScheduleFields,
  JobScheduleValue,
  parseJobToScheduleValue,
} from "@/components/jobs/JobScheduleFields";
import type { JobVisit } from "@shared/schema";

// ============================================================================
// Status display constants
// ============================================================================

const VISIT_STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  dispatched: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  en_route: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  on_site: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  on_hold: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
};

const VISIT_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  dispatched: "Dispatched",
  en_route: "En Route",
  on_site: "On Site",
  in_progress: "In Progress",
  on_hold: "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

// ============================================================================
// Props
// ============================================================================

export interface EditVisitModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  visitId: string;
  /** Current job status - used to guard complete/uncomplete actions */
  jobStatus?: string;
}

// ============================================================================
// Component
// ============================================================================

export function EditVisitModal({
  open,
  onOpenChange,
  jobId,
  visitId,
  jobStatus,
}: EditVisitModalProps) {
  const { toast } = useToast();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Schedule form state (powered by JobScheduleFields)
  const [scheduleValue, setScheduleValue] = useState<JobScheduleValue>(() =>
    parseJobToScheduleValue({})
  );
  const [visitNotes, setVisitNotes] = useState("");

  // Fetch visit data
  const { data: visit, isLoading } = useQuery<JobVisit>({
    queryKey: ["visit-detail", visitId],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/visits/${visitId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch visit");
      return res.json();
    },
    enabled: open && !!visitId,
  });

  // Initialize form from visit data when loaded
  useEffect(() => {
    if (visit) {
      setScheduleValue(
        parseJobToScheduleValue({
          scheduledStart: visit.scheduledStart,
          scheduledEnd: visit.scheduledEnd,
          isAllDay: visit.isAllDay ?? false,
          primaryTechnicianId: visit.assignedTechnicianId,
        })
      );
      setVisitNotes(visit.visitNotes || "");
    }
  }, [visit]);

  // Shared query invalidation
  const invalidateVisitQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["visit-detail", visitId] });
    queryClient.invalidateQueries({ queryKey: ["visits"] });
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
    queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
  };

  // PATCH visit mutation
  const editMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      return apiRequest(`/api/jobs/${jobId}/visits/${visitId}`, {
        method: "PATCH",
        body: JSON.stringify({ ...payload, version: visit?.version }),
      });
    },
    onSuccess: () => {
      invalidateVisitQueries();
      toast({ title: "Visit Updated" });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      const isVersionConflict =
        (isApiError(error) && error.status === 409) ||
        /version|optimistic/i.test(error.message);
      if (isVersionConflict) {
        toast({
          title: "Conflict",
          description: "This visit was updated elsewhere. Refreshing...",
        });
        invalidateVisitQueries();
        return;
      }
      toast({
        title: "Error",
        description: error.message || "Failed to update visit",
        variant: "destructive",
      });
    },
  });

  // Status update mutation (complete / uncomplete)
  const updateStatusMutation = useMutation({
    mutationFn: async (status: string) => {
      return apiRequest(`/api/jobs/${jobId}/visits/${visitId}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: () => {
      invalidateVisitQueries();
      toast({ title: "Visit Updated", description: "Visit status has been updated." });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update visit",
        variant: "destructive",
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/jobs/${jobId}/visits/${visitId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      invalidateVisitQueries();
      toast({ title: "Visit Deleted", description: "Visit has been removed." });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete visit",
        variant: "destructive",
      });
    },
  });

  // Build PATCH payload from JobScheduleValue + notes
  const handleSave = () => {
    const payload: Record<string, unknown> = {};

    if (scheduleValue.unscheduled) {
      // Clear schedule
      payload.scheduledStart = null;
      payload.scheduledEnd = null;
      payload.isAllDay = false;
      payload.estimatedDurationMinutes = null;
    } else if (scheduleValue.date) {
      const isAllDay = scheduleValue.isAllDay || !scheduleValue.time;

      if (isAllDay) {
        payload.scheduledStart = new Date(`${scheduleValue.date}T00:00:00`).toISOString();
        payload.scheduledEnd = new Date(`${scheduleValue.date}T23:59:59`).toISOString();
        payload.isAllDay = true;
        payload.estimatedDurationMinutes = null;
      } else {
        const start = new Date(`${scheduleValue.date}T${scheduleValue.time}:00`);
        const end = new Date(start.getTime() + scheduleValue.durationMinutes * 60000);
        payload.scheduledStart = start.toISOString();
        payload.scheduledEnd = end.toISOString();
        payload.isAllDay = false;
        payload.estimatedDurationMinutes = scheduleValue.durationMinutes;
      }
    }

    // Technician — use primary (first assigned)
    payload.assignedTechnicianId = scheduleValue.primaryTechnicianId || null;

    // Notes
    payload.visitNotes = visitNotes || null;

    editMutation.mutate(payload);
  };

  const isCompleted = visit?.status === "completed";
  const isCancelled = visit?.status === "cancelled";
  const isJobClosed = jobStatus === "completed" || jobStatus === "closed";

  // Show Complete only when visit is active + not completed/cancelled + job is open
  const showCompleteAction =
    !isCompleted && !isCancelled && !isJobClosed;

  // Placeholder visit #1 cannot be deleted
  const isPlaceholderVisit =
    visit?.visitNumber === 1 && !visit?.scheduledStart && visit?.isActive;

  const isPending = editMutation.isPending;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-edit-visit">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Visit #{visit?.visitNumber || ""}
              {visit && (
                <Badge
                  className={cn(
                    "text-xs ml-2",
                    VISIT_STATUS_COLORS[visit.status] || ""
                  )}
                >
                  {VISIT_STATUS_LABELS[visit.status] || visit.status}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {isLoading || !visit ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="space-y-4 py-2">
              {/* Check-in/out info for completed visits */}
              {isCompleted && (
                <div className="text-xs text-muted-foreground space-y-0.5 bg-muted/30 rounded-md p-2">
                  {visit.checkedInAt && (
                    <div>
                      Checked in: {format(new Date(visit.checkedInAt), "MMM dd h:mm a")}
                    </div>
                  )}
                  {visit.checkedOutAt && (
                    <div>
                      Checked out: {format(new Date(visit.checkedOutAt), "MMM dd h:mm a")}
                    </div>
                  )}
                </div>
              )}

              {/* Visit Schedule — uses canonical JobScheduleFields */}
              <JobScheduleFields
                value={scheduleValue}
                onChange={setScheduleValue}
                hideUnscheduledToggle={true}
                compact
              />

              {/* Instructions / Notes */}
              <div className="space-y-2">
                <Label htmlFor="visit-notes">Instructions</Label>
                <Textarea
                  id="visit-notes"
                  placeholder="Special instructions or notes for this visit..."
                  value={visitNotes}
                  onChange={(e) => setVisitNotes(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
          )}

          {/* Footer actions */}
          {visit && (
            <DialogFooter className="flex justify-between sm:justify-between">
              <div className="flex gap-2">
                {/* Complete button — only for non-completed visits when job is open */}
                {showCompleteAction && (
                  <Button
                    size="sm"
                    onClick={() => updateStatusMutation.mutate("completed")}
                    disabled={updateStatusMutation.isPending}
                    data-testid="button-complete-visit"
                  >
                    {updateStatusMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4 mr-1" />
                    )}
                    Complete
                  </Button>
                )}
              </div>

              <div className="flex gap-2">
                {/* More actions menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="button-visit-more-actions"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {/* Clear schedule */}
                    {visit.scheduledStart && (
                      <DropdownMenuItem
                        onClick={() =>
                          editMutation.mutate({
                            scheduledStart: null,
                            scheduledEnd: null,
                          })
                        }
                        disabled={editMutation.isPending}
                        data-testid="menuitem-clear-schedule"
                      >
                        <CalendarMinus className="h-4 w-4 mr-2" />
                        Clear Schedule
                      </DropdownMenuItem>
                    )}

                    {/* Delete visit */}
                    {isPlaceholderVisit ? (
                      <DropdownMenuItem
                        disabled
                        className="text-muted-foreground"
                        data-testid="menuitem-delete-visit-disabled"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        <span className="flex flex-col">
                          <span>Delete Visit</span>
                          <span className="text-xs font-normal">
                            Placeholder visit #1 can't be deleted.
                          </span>
                        </span>
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        onClick={() => setShowDeleteConfirm(true)}
                        className="text-destructive focus:text-destructive"
                        data-testid="menuitem-delete-visit"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Visit
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Save button */}
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={isPending}
                  data-testid="button-save-visit"
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 mr-1" />
                  )}
                  Save
                </Button>
              </div>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent data-testid="dialog-delete-visit-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Visit</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete Visit #{visit?.visitNumber || ""}?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
