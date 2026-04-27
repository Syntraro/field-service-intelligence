import { useState, useEffect } from "react";
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
// 2026-04-21 Phase 1 canonical visit mutation architecture: new visit
// creation routes through the canonical `scheduleVisit` hook — same engine
// EditVisitModal / VisitEditorLauncher use. No bespoke `apiRequest` body
// assembly, no one-off invalidation helpers, no alternate payload shape.
import { useDispatchPreviewMutations } from "@/components/dispatch/useDispatchPreviewMutations";
import { useDefaultSchedulingBuffer, formatScheduledBlockSummary } from "@/hooks/useDefaultSchedulingBuffer";

interface AddVisitDialogProps {
  jobId: string;
  /** Optional: only required when `targetVisitId` is set (in-place update of
   *  a specific placeholder). For the default flow (create-new-visit), the
   *  canonical `scheduleVisit` hook resolves version from cache. */
  jobVersion?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional default technician crew (e.g., from current visit for follow-up).
   *  2026-04-12: accepts either the legacy single ID or the canonical array. */
  defaultTechnicianId?: string | null;
  defaultTechnicianIds?: string[] | null;
  /** 2026-04-18 Phase 2 (multi-visit): optional explicit visit to update
   *  in place instead of creating a new one. When absent, the canonical
   *  backend path creates a brand-new visit (the dialog's default use). */
  targetVisitId?: string;
}

export function AddVisitDialog({
  jobId,
  jobVersion,
  open,
  onOpenChange,
  defaultTechnicianId,
  defaultTechnicianIds,
  targetVisitId,
}: AddVisitDialogProps) {
  const { toast } = useToast();
  // Canonical schedule mutation — same hook EditVisitModal / VisitEditorLauncher use.
  const { scheduleVisit, savingIds } = useDispatchPreviewMutations();
  // 2026-04-26: tenant default buffer extends scheduledEnd only.
  const defaultBufferMinutes = useDefaultSchedulingBuffer();
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("09:00");
  const [estimatedDuration, setEstimatedDuration] = useState("60");
  // 2026-04-12: multi-crew state — matches EditVisitModal's `assignedTechnicianIds`.
  const [assignedTechnicianIds, setAssignedTechnicianIds] = useState<string[]>([]);
  const [visitNotes, setVisitNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Combine date and time into ISO datetime strings. Construct Date
    // without Z suffix so JS interprets as local time, then toISOString()
    // converts to correct UTC (matches EditVisitModal pattern).
    const start = new Date(`${scheduledDate}T${scheduledTime}:00`);
    const durationMinutes = parseInt(estimatedDuration, 10);
    // Work duration stays as the user picked; the scheduled block adds the
    // tenant default buffer so calendar conflicts honour the same window
    // that gets persisted server-side.
    const buffer = Math.max(0, defaultBufferMinutes | 0);
    const end = new Date(start.getTime() + (durationMinutes + buffer) * 60_000);

    setSubmitting(true);
    try {
      // 2026-04-26 fix: pass `expectedVersion` so the hook does NOT fall
      // back to the cache-derived `freshVersion` lookup. For an on-hold
      // job whose only visit is completed, the cache lookup misses (the
      // job isn't in `/api/calendar` and on-hold jobs are excluded from
      // `/api/calendar/unscheduled`) and the hook would otherwise send
      // `version: -1` → backend rejects with VERSION_MISMATCH → silent
      // failure with a misleading "Visit Scheduled" toast.
      const result = await scheduleVisit({
        jobId,
        // When `targetVisitId` is set, the hook forwards it as `targetVisitId`
        // and the backend updates that exact placeholder in place. When
        // omitted, the backend creates a new visit row.
        visitId: targetVisitId,
        assignedTechnicianIds,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        visitNotes: visitNotes.trim() || null,
        expectedVersion: jobVersion,
      });

      // 2026-04-26 fix: only fire the success toast / close the dialog
      // when the mutation actually succeeded. The hook handles its own
      // error toast (version-conflict, not-found, generic) so this branch
      // simply returns and keeps the modal open for the user to retry.
      if (!result.ok) {
        return;
      }

      toast({
        title: "Visit Scheduled",
        description: "The visit has been added to the job.",
      });
      onOpenChange(false);
    } catch (err) {
      // Defensive fallback. The hook is supposed to convert all failures
      // into `{ ok: false, ... }` — if anything DOES throw (e.g. a bug
      // in the request builder) we want a clear destructive toast and
      // the modal must stay open.
      const msg = (err as any)?.message ?? "Failed to schedule visit";
      toast({ variant: "destructive", title: "Schedule failed", description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const isPending = submitting || savingIds.has(targetVisitId ?? jobId);

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
              {(() => {
                const summary = formatScheduledBlockSummary(
                  parseInt(estimatedDuration || "0", 10) || 0,
                  defaultBufferMinutes,
                );
                return summary ? (
                  <p className="text-xs text-muted-foreground mt-1" data-testid="text-buffer-hint">
                    {summary}
                  </p>
                ) : null;
              })()}
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
              disabled={isPending}
              data-testid="button-save-visit"
            >
              {isPending && (
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
