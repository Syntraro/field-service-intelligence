import { useState, useRef, useEffect } from "react";
import type { ReactElement } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, isApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { AlertTriangle, Loader2, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
  ModalSecondaryAction,
  ModalPrimaryAction,
} from "@/components/ui/modal";
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
import type { Invoice } from "@shared/schema";
import type { JobHeaderDetail } from "@/hooks/useJobsFeed";
import {
  invalidateJobLifecycle,
  invalidateDashboard,
} from "@/lib/queryInvalidation";

export interface JobLifecycleActions {
  openCloseJobDialog: () => void;
  triggerReopenJob: () => void;
  /** Mount anywhere in the tree — portaled dialogs for close / reopen flows. */
  dialogsElement: ReactElement;
}

/**
 * Owns the close-job and reopen-job lifecycle mutations and dialogs for
 * JobDetailPage. Accepts undefined job for safe hook placement before
 * loading guards; all callbacks no-op when job is falsy.
 */
export function useJobLifecycleActions({
  job,
  jobInvoice = null,
  jobInvoices = [],
}: {
  job: JobHeaderDetail | null | undefined;
  jobInvoice?: Invoice | null;
  jobInvoices?: Invoice[];
}): JobLifecycleActions {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [showCloseJobDialog, setShowCloseJobDialog] = useState(false);
  const [showInvoicedWarning, setShowInvoicedWarning] = useState(false);
  const [closeOption, setCloseOption] = useState<"invoice_now" | "invoice_later" | "archive">("invoice_now");
  const [uncompletedVisitsGuardrail, setUncompletedVisitsGuardrail] = useState<{
    mode: "invoice_now" | "invoice_later" | "archive";
    visitCount: number;
  } | null>(null);
  const [closeJobError, setCloseJobError] = useState<{
    title: string;
    body: string;
  } | null>(null);

  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    };
  }, []);

  const isInvoiced = job?.status === "invoiced";
  const existingInvoice: Invoice | null =
    jobInvoice ?? (jobInvoices.length > 0 ? jobInvoices[0] : null);

  const undoCloseMutation = useMutation({
    mutationFn: async () => {
      if (!job) throw new Error("Job not loaded");
      const response = await apiRequest(`/api/jobs/${job.id}/undo-close`, { method: "POST" });
      return response as { job: any };
    },
    onSuccess: () => {
      if (job) invalidateJobLifecycle(queryClient, job.id);
      invalidateDashboard(queryClient);
      toast({ title: "Undo Successful", description: "Job close has been undone." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to undo close", variant: "destructive" });
    },
  });

  const closeJobMutation = useMutation({
    mutationFn: async ({ mode, autoCompleteOpenVisits }: {
      mode: "invoice_now" | "invoice_later" | "archive";
      autoCompleteOpenVisits?: boolean;
    }) => {
      if (!job) throw new Error("Job not loaded");
      const response = await apiRequest(`/api/jobs/${job.id}/close`, {
        method: "POST",
        body: JSON.stringify({ mode, version: job.version, autoCompleteOpenVisits }),
      });
      return { ...(response as { job: any; invoice: any | null }), mode };
    },
    onSuccess: (data) => {
      if (job) invalidateJobLifecycle(queryClient, job.id);
      queryClient.invalidateQueries({ queryKey: ["visits"] });
      invalidateDashboard(queryClient);
      setShowCloseJobDialog(false);
      setUncompletedVisitsGuardrail(null);

      if (data.invoice) {
        queryClient.invalidateQueries({ queryKey: ["invoices"] }); // invoices family: new invoice created
        toast({ title: "Job Closed", description: "Job closed and invoice created." });
        setLocation(`/invoices/${data.invoice.id}`);
      } else {
        const toastResult = toast({
          title: "Job Closed",
          description: "Job has been closed.",
          action: (
            <ToastAction
              altText="Undo"
              onClick={() => {
                if (undoTimeoutRef.current) {
                  clearTimeout(undoTimeoutRef.current);
                  undoTimeoutRef.current = null;
                }
                undoCloseMutation.mutate();
              }}
            >
              Undo
            </ToastAction>
          ),
        });

        undoTimeoutRef.current = setTimeout(() => {
          toastResult.dismiss();
          undoTimeoutRef.current = null;
        }, 20000);
      }
    },
    onError: (error: Error) => {
      setShowCloseJobDialog(false);

      if (isApiError(error) && error.status === 409 && error.message.includes("uncompleted visit")) {
        const countMatch = error.message.match(/(\d+)\s+uncompleted/);
        const visitCount = countMatch ? parseInt(countMatch[1], 10) : 0;
        setUncompletedVisitsGuardrail({ mode: closeOption, visitCount });
        return;
      }
      const isVersionConflict =
        (isApiError(error) && error.status === 409) ||
        /version|expected version|optimistic/i.test(error.message);
      if (isVersionConflict) {
        toast({ title: "Conflict", description: "This job was updated elsewhere. Refreshing…" });
        if (job) invalidateJobLifecycle(queryClient, job.id);
        queryClient.invalidateQueries({ queryKey: ["invoices"] });
        invalidateDashboard(queryClient);
        queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
        queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });
        queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
        return;
      }
      if (/Cannot close job in status 'invoiced'/i.test(error.message)) {
        if (job) invalidateJobLifecycle(queryClient, job.id);
        queryClient.invalidateQueries({ queryKey: ["invoices"] });
        invalidateDashboard(queryClient);
        setCloseJobError({
          title: "Already Invoiced",
          body: "This job is already invoiced. The page will refresh with the latest status.",
        });
        return;
      }
      if (job) invalidateJobLifecycle(queryClient, job.id);
      const isFriendly = error.message && !error.message.includes("is not a function") && !error.message.includes("Internal Server");
      toast({
        title: "Error",
        description: isFriendly ? error.message : "Failed to close job. Please try again or contact support.",
        variant: "destructive",
      });
    },
  });

  const reopenJobMutation = useMutation({
    mutationFn: async () => {
      if (!job) throw new Error("Job not loaded");
      const response = await apiRequest(`/api/jobs/${job.id}/reopen`, {
        method: "POST",
        body: JSON.stringify({ targetOpenSubStatus: null, version: job.version }),
      });
      return response as { job: any };
    },
    onSuccess: () => {
      if (job) invalidateJobLifecycle(queryClient, job.id);
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      invalidateDashboard(queryClient);
      toast({ title: "Job Reopened", description: "Job has been reopened and is ready for scheduling." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to reopen job", variant: "destructive" });
    },
  });

  const handleReopenJob = () => {
    if (!job) return;
    if (isInvoiced) {
      setShowInvoicedWarning(true);
    } else {
      reopenJobMutation.mutate();
    }
  };

  const handleCloseJob = () => {
    closeJobMutation.mutate({ mode: closeOption });
  };

  const dialogsElement = (
    <>
      {/* Close Job Dialog */}
      <ModalShell open={showCloseJobDialog} onOpenChange={setShowCloseJobDialog} className="sm:max-w-md" data-testid="dialog-close-job">
        <ModalHeader>
          <ModalTitle>Close Job</ModalTitle>
          <ModalDescription>
            {isInvoiced
              ? "This job is already invoiced and cannot be closed again."
              : "Closing this job will stop scheduling activity. Choose how you want to proceed with billing."}
          </ModalDescription>
        </ModalHeader>

        {!isInvoiced && (
          <ModalBody>
            <div className="space-y-3">
              <label
                className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${closeOption === "invoice_now" ? "border-primary bg-primary/5" : "hover-elevate"}`}
                data-testid="option-invoice-now"
              >
                <input
                  type="radio"
                  name="closeOption"
                  value="invoice_now"
                  checked={closeOption === "invoice_now"}
                  onChange={() => setCloseOption("invoice_now")}
                  className="mt-0.5"
                />
                <div>
                  <p className="font-medium text-sm">Close & create invoice now</p>
                  <p className="text-helper text-muted-foreground">
                    Creates an invoice from this job and marks it as invoiced.
                  </p>
                </div>
              </label>

              <label
                className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${closeOption === "invoice_later" ? "border-primary bg-primary/5" : "hover-elevate"}`}
                data-testid="option-invoice-later"
              >
                <input
                  type="radio"
                  name="closeOption"
                  value="invoice_later"
                  checked={closeOption === "invoice_later"}
                  onChange={() => setCloseOption("invoice_later")}
                  className="mt-0.5"
                />
                <div>
                  <p className="font-medium text-sm">Close & invoice later</p>
                  <p className="text-helper text-muted-foreground">
                    Marks job as completed. You can create an invoice later.
                  </p>
                </div>
              </label>

              <label
                className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${closeOption === "archive" ? "border-destructive bg-destructive/5" : "hover-elevate"}`}
                data-testid="option-archive"
              >
                <input
                  type="radio"
                  name="closeOption"
                  value="archive"
                  checked={closeOption === "archive"}
                  onChange={() => setCloseOption("archive")}
                  className="mt-0.5"
                />
                <div>
                  <p className="font-medium text-sm">Close & archive (no invoice)</p>
                  <p className="text-helper text-muted-foreground">
                    No invoice will be created. Job will be archived and won't appear in billing queues.
                  </p>
                  {closeOption === "archive" && (
                    <div className="mt-2 flex items-start gap-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
                      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                      <span>This job will not generate any revenue. Only use for cancelled or non-billable work.</span>
                    </div>
                  )}
                </div>
              </label>
            </div>
          </ModalBody>
        )}

        <ModalFooter>
          <ModalSecondaryAction onClick={() => setShowCloseJobDialog(false)}>
            Cancel
          </ModalSecondaryAction>
          {isInvoiced ? (
            existingInvoice && (
              <ModalPrimaryAction onClick={() => { setShowCloseJobDialog(false); setLocation(`/invoices/${existingInvoice.id}`); }}>
                <Receipt className="h-4 w-4 mr-2" />
                View Invoice
              </ModalPrimaryAction>
            )
          ) : (
            <ModalPrimaryAction
              onClick={handleCloseJob}
              disabled={closeJobMutation.isPending}
              data-testid="button-confirm-close"
            >
              {closeJobMutation.isPending ? "Closing..." : "Close Job"}
            </ModalPrimaryAction>
          )}
        </ModalFooter>
      </ModalShell>

      {/* Uncompleted Visits Guardrail — shown when close fails due to open visits */}
      <AlertDialog
        open={!!uncompletedVisitsGuardrail}
        onOpenChange={(open) => { if (!open) setUncompletedVisitsGuardrail(null); }}
      >
        <AlertDialogContent data-testid="dialog-uncompleted-visits">
          <AlertDialogHeader>
            <AlertDialogTitle>Uncompleted Visits</AlertDialogTitle>
            <AlertDialogDescription>
              This job has {uncompletedVisitsGuardrail?.visitCount || "open"} uncompleted visit{(uncompletedVisitsGuardrail?.visitCount ?? 0) !== 1 ? "s" : ""}.
              You can review them first or mark them all as completed to proceed with closing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel data-testid="button-cancel-guardrail">Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                setUncompletedVisitsGuardrail(null);
                document.getElementById("visits-section")?.scrollIntoView({ behavior: "smooth" });
              }}
              data-testid="button-go-to-visits"
            >
              Go to Visits
            </Button>
            <AlertDialogAction
              onClick={() => {
                if (!uncompletedVisitsGuardrail) return;
                closeJobMutation.mutate({
                  mode: uncompletedVisitsGuardrail.mode,
                  autoCompleteOpenVisits: true,
                });
              }}
              disabled={closeJobMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-auto-complete-and-close"
            >
              {closeJobMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Mark Visits Completed & Close
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Close Job — communication dialog for validation / state errors */}
      <ModalShell open={!!closeJobError} onOpenChange={(open) => { if (!open) setCloseJobError(null); }} className="sm:max-w-md" data-testid="dialog-close-job-error">
        <ModalHeader>
          <ModalTitle>{closeJobError?.title}</ModalTitle>
          <ModalDescription>{closeJobError?.body}</ModalDescription>
        </ModalHeader>
        <ModalFooter>
          <ModalSecondaryAction onClick={() => setCloseJobError(null)}>
            Go back
          </ModalSecondaryAction>
        </ModalFooter>
      </ModalShell>

      {/* Invoiced Warning — cannot reopen directly */}
      <ModalShell open={showInvoicedWarning} onOpenChange={setShowInvoicedWarning} className="sm:max-w-md" data-testid="dialog-invoiced-warning">
        <ModalHeader>
          <ModalTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Cannot Reopen Job
          </ModalTitle>
          <ModalDescription>
            This job has been invoiced and cannot be reopened directly.
            To reopen this job, you must first void or credit the linked invoice.
          </ModalDescription>
        </ModalHeader>
        <ModalFooter>
          <ModalSecondaryAction onClick={() => setShowInvoicedWarning(false)}>
            Cancel
          </ModalSecondaryAction>
          {existingInvoice && (
            <ModalPrimaryAction
              onClick={() => {
                setShowInvoicedWarning(false);
                setLocation(`/invoices/${existingInvoice.id}`);
              }}
              data-testid="button-view-invoice"
            >
              <Receipt className="h-4 w-4 mr-2" />
              View Invoice
            </ModalPrimaryAction>
          )}
        </ModalFooter>
      </ModalShell>
    </>
  );

  return {
    openCloseJobDialog: () => { if (job) setShowCloseJobDialog(true); },
    triggerReopenJob: handleReopenJob,
    dialogsElement,
  };
}
