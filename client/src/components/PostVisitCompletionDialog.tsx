/**
 * PostVisitCompletionDialog — canonical post-visit-completion decision
 * surface for office users.
 *
 * 2026-05-01: surfaces the 3-option decision after a visit is marked
 * complete via the canonical `EditVisitModal` flow:
 *   1. Close job and invoice now
 *   2. Close job, invoice later
 *   3. Leave job open
 *
 * When the parent job has OTHER open visits (excluding the just-
 * completed one), copy adjusts and the close-job mutation is fired
 * with `autoCompleteOpenVisits: true` — the canonical close endpoint
 * (`POST /api/jobs/:id/close`) atomically completes those visits +
 * closes the job + (if mode=invoice_now) creates the invoice
 * server-side. No client-side orchestration; no new endpoint.
 *
 * Mounted ONCE inside `<VisitEditorLauncher>` so every consumer
 * (Dashboard, DispatchPreview, FinancialDashboard, JobDetailPage) gets
 * it without per-page wiring. The launcher fires `onAfterComplete`
 * from `EditVisitModal` after a successful `completeVisitWithOutcome`,
 * which sets the dialog state controlled here.
 *
 * Architecture:
 *   - No new write paths. All actions route through canonical
 *     `POST /api/jobs/:id/close` with existing modes.
 *   - "Leave job open" is a no-op (visit completion already happened).
 *   - The same role contract that gates the close endpoint
 *     (`requireRole(MANAGER_ROLES)` server-side) governs visibility
 *     here; non-managers see the dialog but the server rejects the
 *     close mutation with a clear toast.
 */
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, FileText, Clock, X as XIcon } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
}

type CloseMode = "invoice_now" | "invoice_later";

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
      // Canonical close endpoint. `autoCompleteOpenVisits: true` only
      // when other visits remain open — server enforces the same rule
      // (jobs.ts:656) and would reject otherwise.
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
      // Family-wide invalidations matching JobHeaderCard's
      // `closeJobMutation` so consumers refresh consistently.
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["visits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
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
    : "Close job and invoice now";
  const invoiceLaterLabel = hasRemaining
    ? "Complete remaining visits and invoice later"
    : "Close job, invoice later";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Don't allow closing while a mutation is in flight.
        if (isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="sm:max-w-[520px]"
        data-testid="post-visit-completion-dialog"
      >
        <DialogHeader>
          <DialogTitle>{titleText}</DialogTitle>
          <DialogDescription>
            {visitsLoading ? "Loading job state…" : descriptionText}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-2" data-testid="post-visit-options">
          {/* Option 1: Invoice now */}
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
              <div className="text-xs text-text-muted mt-0.5">
                {hasRemaining
                  ? "Marks remaining visits complete, closes the job, and creates an invoice."
                  : "Closes the job and creates an invoice from all eligible items."}
              </div>
            </div>
            {pendingMode === "invoice_now" && isPending && (
              <Loader2 className="h-4 w-4 animate-spin shrink-0 mt-0.5" />
            )}
          </button>

          {/* Option 2: Invoice later */}
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
              <div className="text-xs text-text-muted mt-0.5">
                {hasRemaining
                  ? "Marks remaining visits complete and closes the job. Invoice later from the job."
                  : "Closes the job. Invoice later from the job."}
              </div>
            </div>
            {pendingMode === "invoice_later" && isPending && (
              <Loader2 className="h-4 w-4 animate-spin shrink-0 mt-0.5" />
            )}
          </button>

          {/* Option 3: Leave open (no-op) */}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="flex items-start gap-3 rounded-md border border-card-border p-3 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="option-leave-open"
          >
            <XIcon className="h-4 w-4 mt-0.5 shrink-0 text-text-muted" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Leave job open</div>
              <div className="text-xs text-text-muted mt-0.5">
                {hasRemaining
                  ? "Only the current visit is marked complete. Other visits stay open."
                  : "Job stays open. You can schedule another visit or invoice later."}
              </div>
            </div>
          </button>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            data-testid="button-dismiss"
          >
            Decide later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
