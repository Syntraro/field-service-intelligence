import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { detectScheduleConflict } from "@/lib/scheduleOverlapCheck";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { CanonicalDatePicker } from "@/components/ui/canonical-date-picker";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FormField,
  FormLabel,
  FormRow,
  InlineInput,
  InlineTextarea,
} from "@/components/ui/form-field";
import { TechnicianSelector } from "@/components/TechnicianSelector";
import type { Job } from "@shared/schema";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeToISOString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
  return null;
}

function extractDateString(value: Date | string | null | undefined): string {
  const iso = safeToISOString(value);
  return iso ? iso.split("T")[0] : "";
}

// ─── Types ───────────────────────────────────────────────────────────────────

/** Optional prefill data for creating a task from dispatch quick-create */
interface TaskPrefill {
  assignedToUserId?: string;
  startDate?: string;   // YYYY-MM-DD
  startTime?: string;   // HH:mm
}

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId?: string;
  onChanged?: () => void;
  /** Prefill fields when creating from dispatch board quick-create */
  initialData?: TaskPrefill;
  /** 2026-04-25 CreateNewDialog embedding: when true, the parent shell owns
   *  the Dialog wrapper / title strip; this component renders only the form
   *  body + footer. */
  embedded?: boolean;
  /** Lock the task type — reserved for future use; currently always "GENERAL". */
  forcedType?: "GENERAL";
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TaskDialog({ open, onOpenChange, taskId, onChanged, initialData, embedded = false, forcedType }: TaskDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const isEditMode = !!taskId;

  // Form state
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [embNotesOpen, setEmbNotesOpen] = useState(false);
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [jobId, setJobId] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showConflictAlert, setShowConflictAlert] = useState(false);

  // ─── Data Queries ──────────────────────────────────────────────────────────

  const { data: taskData, isLoading: isLoadingTask } = useQuery({
    queryKey: taskId ? [`/api/tasks/${taskId}`] : ["task-empty"],
    enabled: isEditMode && open,
    staleTime: 0,
  });
  const task = taskData as any;

  // Job picker: load only active (open) jobs, capped at 100, sorted by most recent.
  const { data: jobsData } = useQuery<{ data?: Job[]; items?: Job[] }>({
    queryKey: ["jobs", "picker"],
    queryFn: () => apiRequest("/api/jobs?status=open&limit=100&sortBy=jobNumber&sortOrder=desc"),
    staleTime: 2 * 60 * 1000,
  });
  const jobs = jobsData?.data ?? jobsData?.items ?? [];

  // ─── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (task && isEditMode) {
      setTitle(task.title || "");
      setNotes(task.notes || "");
      setAssignedToUserId(task.assignedToUserId || "");
      setJobId(task.jobId || "");
      if (task.scheduledStartAt) {
        const dateStr = extractDateString(task.scheduledStartAt);
        if (dateStr) {
          setStartDate(dateStr);
          const d = new Date(task.scheduledStartAt);
          if (!isNaN(d.getTime())) setStartTime(d.toTimeString().slice(0, 5));
        }
      }
    } else if (!isEditMode) {
      resetForm();
      if (initialData) {
        if (initialData.assignedToUserId) setAssignedToUserId(initialData.assignedToUserId);
        if (initialData.startDate) setStartDate(initialData.startDate);
        if (initialData.startTime) setStartTime(initialData.startTime);
      }
    }
  }, [task, isEditMode, open, forcedType]);

  const resetForm = () => {
    setTitle("");
    setNotes("");
    setAssignedToUserId("");
    setStartDate("");
    setStartTime("08:00");
    setJobId("");
    setSaveError(null);
  };

  // ─── Validation ────────────────────────────────────────────────────────────

  const canSubmit = title.trim().length > 0;

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async () => {
      setSaveError(null);

      let scheduledStartAt: string | undefined;
      let scheduledEndAt: string | undefined;

      let hasConflict = false;
      if (startDate && startDate.trim()) {
        const time = startTime && startTime.trim() ? startTime : "08:00";
        scheduledStartAt = safeToISOString(startDate + "T" + time) ?? undefined;

        if (scheduledStartAt && assignedToUserId) {
          const taskDuration = 60;
          const proposedEnd = new Date(new Date(scheduledStartAt).getTime() + taskDuration * 60000);
          hasConflict = await detectScheduleConflict(
            assignedToUserId, startDate,
            scheduledStartAt, proposedEnd.toISOString(),
            taskDuration,
            isEditMode ? taskId : undefined,
          );
        }
      }

      const payload: any = {
        title: title.trim(),
        type: "GENERAL",
        status: "pending" as const,
      };
      if (notes.trim()) payload.notes = notes.trim();
      if (assignedToUserId) payload.assignedToUserId = assignedToUserId;
      if (scheduledStartAt) payload.scheduledStartAt = scheduledStartAt;
      if (scheduledEndAt) payload.scheduledEndAt = scheduledEndAt;
      if (jobId) payload.jobId = jobId;

      if (isEditMode) {
        const updated = await apiRequest(`/api/tasks/${taskId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        return { task: updated, hasConflict };
      } else {
        const created = await apiRequest<any>("/api/tasks", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        return { task: created, hasConflict };
      }
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === "string" && k.startsWith("/api/tasks");
        },
      });
      if (result?.hasConflict) {
        setShowConflictAlert(true);
      } else {
        onOpenChange(false);
        resetForm();
      }
      onChanged?.();
    },
    onError: (error: any) => {
      const msg = error?.message || "Unknown error";
      setSaveError(`Failed to ${isEditMode ? "update" : "create"} task: ${msg}`);
      if (process.env.NODE_ENV !== "production") {
        console.warn("[TASKS_DIAG] save error:", { status: error?.status, message: msg });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!taskId) throw new Error("No task ID");
      return apiRequest(`/api/tasks/${taskId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === "string" && k.startsWith("/api/tasks");
        },
      });
      onOpenChange(false);
      onChanged?.();
    },
    onError: (error: any) => {
      setSaveError(`Failed to delete task: ${error?.message || "Unknown error"}`);
    },
  });

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this task?")) {
      deleteMutation.mutate();
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const body = (
    <>
          {isLoadingTask && isEditMode ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Loading task...
            </div>
          ) : (
            <div className="space-y-2.5">
              {/* Row 1: Title */}
              <InlineInput
                id={embedded ? "task-title-embedded" : "task-title"}
                label="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={embedded ? "Brief description of the task" : "Task title"}
              />

              {/* Row 2: Notes */}
              {embedded ? (
                (embNotesOpen || notes.length > 0) ? (
                  <div className="rounded-md bg-muted/30 p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium">Instructions</span>
                      {notes.length === 0 && (
                        <button
                          type="button"
                          onClick={() => setEmbNotesOpen(false)}
                          className="text-helper text-muted-foreground hover:text-foreground"
                          data-testid="emb-task-notes-collapse"
                        >
                          −
                        </button>
                      )}
                    </div>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Add notes or instructions for the team..."
                      rows={2}
                      className="text-sm"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEmbNotesOpen(true)}
                    className="text-helper font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1 py-1"
                    data-testid="emb-task-notes-expand"
                  >
                    + Add instructions
                  </button>
                )
              ) : (
                <InlineTextarea
                  id="task-notes"
                  label="Notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional details"
                  rows={2}
                />
              )}

              {/* Row 3: Assigned To | Start Date | Start Time */}
              <FormRow className="grid-cols-2 sm:grid-cols-4">
                <FormField>
                  <FormLabel>Assigned To</FormLabel>
                  <TechnicianSelector
                    mode="single"
                    value={assignedToUserId || null}
                    onChange={(id) => setAssignedToUserId(id ?? "")}
                    placeholder="Select..."
                  />
                </FormField>

                <FormField>
                  <FormLabel>Start Date</FormLabel>
                  <CanonicalDatePicker
                    value={startDate}
                    onChange={(next) => setStartDate(next ?? "")}
                    className="w-full text-sm"
                  />
                </FormField>

                <FormField>
                  <FormLabel htmlFor="task-start-time">Start Time</FormLabel>
                  <Input
                    id="task-start-time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    disabled={!startDate}
                    className="text-sm"
                  />
                </FormField>

              </FormRow>

              {/* Row 4: Link to Job (full width) */}
              <FormField>
                <FormLabel>Link to Job (Optional)</FormLabel>
                <div className="flex gap-1">
                  <Select value={jobId || undefined} onValueChange={setJobId}>
                    <SelectTrigger className="text-sm flex-1">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {jobs.map((job) => (
                        <SelectItem key={job.id} value={job.id}>
                          #{job.jobNumber} - {job.summary}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {jobId && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setJobId("")}
                      className="px-2"
                    >
                      ×
                    </Button>
                  )}
                </div>
              </FormField>

            </div>
          )}

          {/* Inline error banner */}
          {saveError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 mt-2">
              {saveError}
            </div>
          )}

          <DialogFooter className="pt-2 flex justify-between items-center">
            {isEditMode ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                Delete
              </Button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} size="sm">
                Cancel
              </Button>
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={!canSubmit || saveMutation.isPending}
                size="sm"
                data-testid="task-submit"
              >
                {saveMutation.isPending
                  ? "Saving..."
                  : isEditMode
                    ? "Update"
                    : embedded
                      ? "Create Task"
                      : "Create"}
              </Button>
            </div>
          </DialogFooter>
    </>
  );

  return (
    <>
      {embedded ? (
        <div className="px-5 pt-3 pb-3 flex-1 min-h-0 overflow-y-auto" data-testid="embedded-task-dialog">
          {body}
        </div>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="sm:max-w-3xl p-5">
            <DialogHeader className="pb-2">
              <DialogTitle>{isEditMode ? "Edit Task" : "New Task"}</DialogTitle>
            </DialogHeader>
            {body}
          </DialogContent>
        </Dialog>
      )}

      <AlertDialog open={showConflictAlert} onOpenChange={setShowConflictAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Scheduling conflict detected</AlertDialogTitle>
            <AlertDialogDescription>
              This item overlaps another scheduled item. Please review the dispatch board.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => { setShowConflictAlert(false); onOpenChange(false); resetForm(); }}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
