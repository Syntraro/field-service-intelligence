/**
 * PostVisitCompletionDialog — canonical post-visit-completion decision
 * surface for office users.
 *
 * Options in order:
 *   1. Close job & invoice now
 *   2. Close job & invoice later
 *   3. Schedule follow-up   ← keeps job open, opens AddVisitDialog
 *   4. Leave job unscheduled ← keeps job open, no invoice, no follow-up
 *   5. Archive without invoice ← closes/archives the job without billing
 *
 * Mounted ONCE inside `<VisitEditorLauncher>` so every consumer
 * (Dashboard, DispatchPreview, FinancialDashboard, JobDetailPage) gets
 * it without per-page wiring. The launcher fires `onAfterComplete`
 * from `EditVisitModal` after a successful `completeVisitWithOutcome`,
 * which sets the dialog state controlled here.
 *
 * Architecture:
 *   - Options 1, 2, 5 route through canonical `POST /api/jobs/:id/close`.
 *   - "Leave job unscheduled" is a no-op (visit completion already happened).
 *   - "Schedule follow-up" fires `onScheduleFollowUp` → launcher mounts
 *     `AddVisitDialog` for the job. No server action in this dialog.
 *   - The same role contract that gates the close endpoint
 *     (`requireRole(MANAGER_ROLES)` server-side) governs visibility
 *     here; non-managers see the dialog but the server rejects the
 *     close mutation with a clear toast.
 */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
} from "@/components/ui/modal";
import { Loader2, FileText, Clock, Calendar, CalendarOff, Archive } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { invalidateJob } from "@/lib/queryInvalidation";
import { useToast } from "@/hooks/use-toast";
import { useJobVisits } from "@/hooks/useJobVisits";

interface PostVisitCompletionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Job whose visit was just completed. */
  jobId: string;
  /** Visit id that was just completed — excluded from the
   *  "remaining open" count so the dialog reflects post-completion
   *  state even before the visits refetch lands. */
  completedVisitId: string;
  /** Called when the user picks "Schedule follow-up". The launcher
   *  handles opening AddVisitDialog; this dialog just signals intent. */
  onScheduleFollowUp?: () => void;
}

type CloseMode = "invoice_now" | "invoice_later" | "archive";

interface JobMinimal {
  id: string;
  version: number | null;
  status: string;
}

interface CloseJobResponse {
  job: JobMinimal;
  invoice: { id: string; invoiceNumber?: string } | null;
}

export function PostVisitCompletionDialog({
  open,
  onOpenChange,
  jobId,
  completedVisitId,
  onScheduleFollowUp,
}: PostVisitCompletionDialogProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [pendingMode, setPendingMode] = useState<CloseMode | null>(null);

  // Pull canonical job state (for `version`) and visits list. Both queries
  // are already cached app-wide; this hook just subscribes.
  const { data: job } = useQuery<JobMinimal>({
    queryKey: ["jobs", "detail", jobId],
    queryFn: () => apiRequest<JobMinimal>(`/api/jobs/${jobId}`),
    enabled: open && !!jobId,
    staleTime: 10 * 1000,
  });
  const { eligibleVisits, isLoading: visitsLoading } = useJobVisits(jobId, { enabled: open });

  // Remaining open visits = eligible (active, non-terminal) MINUS the one
  // we just completed. We exclude by id rather than waiting for the cache
  // to refetch so the copy is correct on first render.
  const remainingOpenCount = useMemo(
    () => eligibleVisits.filter((v) => v.id !== completedVisitId).length,
    [eligibleVisits, completedVisitId],
  );
  const hasRemaining = remainingOpenCount > 0;

  const closeJobMutation = useMutation({
    mutationFn: async (mode: CloseMode): Promise<CloseJobResponse> => {
      if (!job) throw new Error("Job not loaded");
      return apiRequest<CloseJobResponse>(`/api/jobs/${jobId}/close`, {
        method: "POST",
        body: JSON.stringify({
          mode,
          version: job.version ?? 0,
          autoCompleteOpenVisits: hasRemaining,
        }),
      });
    },
    onSuccess: (result, mode) => {
      invalidateJob(queryClient, jobId);
      queryClient.invalidateQueries({ queryKey: ["visits"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onOpenChange(false);
      setPendingMode(null);

      if (mode === "invoice_now" && result.invoice) {
        queryClient.invalidateQueries({ queryKey: ["invoices"] });
        toast({
          title: "Job Closed",
          description: result.invoice.invoiceNumber
            ? `Invoice #${result.invoice.invoiceNumber} created.`
            : "Job closed and invoice created.",
        });
        setLocation(`/invoices/${result.invoice.id}`);
      } else if (mode === "archive") {
        toast({
          title: "Job Archived",
          description: "Job archived without invoice.",
        });
      } else {
        toast({
          title: "Job Closed",
          description: hasRemaining
            ? "Remaining visits completed and job closed."
            : "Job closed.",
        });
      }
    },
    onError: (err: Error) => {
      setPendingMode(null);
      toast({
        title: "Couldn't close job",
        description: err.message || "Try again from the job detail page.",
        variant: "destructive",
      });
    },
  });

  const handleClose = (mode: CloseMode) => {
    setPendingMode(mode);
    closeJobMutation.mutate(mode);
  };

  const isPending = closeJobMutation.isPending;

  // Copy adapts based on whether other open visits remain.
  const titleText = hasRemaining
    ? "Visit completed. This job has other incomplete visits."
    : "Visit completed.";
  const descriptionText = hasRemaining
    ? `What do you want to do? ${remainingOpenCount} other ${remainingOpenCount === 1 ? "visit is" : "visits are"} still open.`
    : "What do you want to do?";

  const invoiceNowLabel = hasRemaining
    ? "Complete remaining visits and invoice now"
    : "Close job & invoice now";
  const invoiceNowHelper = hasRemaining
    ? "Marks remaining visits complete, closes the job, and creates an invoice immediately."
    : "Completes the job and creates an invoice immediately.";

  const invoiceLaterLabel = hasRemaining
    ? "Complete remaining visits and invoice later"
    : "Close job & invoice later";
  const invoiceLaterHelper = hasRemaining
    ? "Marks remaining visits complete and closes the job. Invoice can be created later."
    : "Completes the job. Invoice can be created later.";

  return (
    <ModalShell
      open={open}
      onOpenChange={(next) => {
        // Don't allow closing while a mutation is in flight.
        if (isPending) return;
        onOpenChange(next);
      }}
      className="sm:max-w-[520px]"
      data-testid="post-visit-completion-dialog"
    >
      <ModalHeader>
        <ModalTitle>{titleText}</ModalTitle>
        <ModalDescription>
          {visitsLoading ? "Loading job state…" : descriptionText}
        </ModalDescription>
      </ModalHeader>

      <ModalBody>
        <div className="flex flex-col gap-2" data-testid="post-visit-options">
          {/* Option 1: Close job & invoice now */}
          <button
            type="button"
            onClick={() => handleClose("invoice_now")}
            disabled={isPending || !job}
            className="flex items-start gap-3 rounded-md border border-card-border p-3 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="option-invoice-now"
          >
            <FileText className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{invoiceNowLabel}</div>
              <div className="text-xs text-text-muted mt-0.5">{invoiceNowHelper}</div>
            </div>
            {pendingMode === "invoice_now" && isPending && (
              <Loader2 className="h-4 w-4 animate-spin shrink-0 mt-0.5" />
            )}
          </button>

          {/* Option 2: Close job & invoice later */}
          <button
            type="button"
            onClick={() => handleClose("invoice_later")}
            disabled={isPending || !job}
            className="flex items-start gap-3 rounded-md border border-card-border p-3 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="option-invoice-later"
          >
            <Clock className="h-4 w-4 mt-0.5 shrink-0 text-text-secondary" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{invoiceLaterLabel}</div>
              <div className="text-xs text-text-muted mt-0.5">{invoiceLaterHelper}</div>
            </div>
            {pendingMode === "invoice_later" && isPending && (
              <Loader2 className="h-4 w-4 animate-spin shrink-0 mt-0.5" />
            )}
          </button>

          {/* Option 3: Schedule follow-up */}
          <button
            type="button"
            onClick={() => onScheduleFollowUp?.()}
            disabled={isPending}
            className="flex items-start gap-3 rounded-md border border-card-border p-3 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="option-schedule-followup"
          >
            <Calendar className="h-4 w-4 mt-0.5 shrink-0 text-text-secondary" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Schedule follow-up</div>
              <div className="text-xs text-text-muted mt-0.5">
                Keep the job open and schedule another visit.
              </div>
            </div>
          </button>

          {/* Option 4: Leave job unscheduled (no-op) */}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="flex items-start gap-3 rounded-md border border-card-border p-3 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="option-leave-unscheduled"
          >
            <CalendarOff className="h-4 w-4 mt-0.5 shrink-0 text-text-muted" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Leave job unscheduled</div>
              <div className="text-xs text-text-muted mt-0.5">
                Visit is completed. Job remains open without a scheduled follow-up.
              </div>
            </div>
          </button>

          {/* Option 5: Archive without invoice */}
          <button
            type="button"
            onClick={() => handleClose("archive")}
            disabled={isPending || !job}
            className="flex items-start gap-3 rounded-md border border-card-border p-3 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="option-archive-no-invoice"
          >
            <Archive className="h-4 w-4 mt-0.5 shrink-0 text-text-muted" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Archive without invoice</div>
              <div className="text-xs text-text-muted mt-0.5">
                Archives the job without billing.
              </div>
            </div>
            {pendingMode === "archive" && isPending && (
              <Loader2 className="h-4 w-4 animate-spin shrink-0 mt-0.5" />
            )}
          </button>
        </div>
      </ModalBody>
    </ModalShell>
  );
}
