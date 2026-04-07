import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, isApiError } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import {
  MapPin,
  MoreHorizontal,
  Copy,
  Receipt,
  PenTool,
  Download,
  Printer,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
// Card/CardContent removed — parent provides wrapping card
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import type { Invoice } from "@shared/schema";
import type { JobHeaderDetail } from "@/hooks/useJobsFeed";

// Phase 4 Step A7: Accept canonical JobHeaderDetail which includes
// correctly resolved location and parentCompany from the COALESCE join.
interface JobHeaderCardProps {
  job: JobHeaderDetail;
  jobInvoice: Invoice | null;
  onEdit: () => void;
  onDelete: () => void;
  /** When false, hides Edit/More Actions buttons but keeps all dialog/mutation logic active */
  showActions?: boolean;
}

/** 2026-03-24: Imperative handle for parent to trigger lifecycle actions without duplicating mutations */
export interface JobHeaderCardHandle {
  openCloseJobDialog: () => void;
  triggerReopenJob: () => void;
}

// Office roles that can perform billing/admin actions
const OFFICE_ROLES = ["owner", "admin", "manager", "dispatcher"];

export const JobHeaderCard = forwardRef<JobHeaderCardHandle, JobHeaderCardProps>(function JobHeaderCard({
  job,
  jobInvoice,
  onEdit,
  onDelete,
  showActions = true,
}, ref) {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [showCloseJobDialog, setShowCloseJobDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showInvoicedWarning, setShowInvoicedWarning] = useState(false);
  const [closeOption, setCloseOption] = useState<"invoice_now" | "invoice_later" | "archive">("invoice_now");
  // Uncompleted visits guardrail: shown when close fails due to open visits
  const [uncompletedVisitsGuardrail, setUncompletedVisitsGuardrail] = useState<{
    mode: "invoice_now" | "invoice_later" | "archive";
    visitCount: number;
  } | null>(null);
  // Close-job communication dialog: replaces destructive toasts for user-actionable errors
  const [closeJobError, setCloseJobError] = useState<{
    title: string;
    body: string;
    showArchiveAction?: boolean;
  } | null>(null);

  // 2026-03-24: Expose lifecycle triggers to parent via imperative handle
  useImperativeHandle(ref, () => ({
    openCloseJobDialog: () => setShowCloseJobDialog(true),
    triggerReopenJob: () => handleReopenJob(),
  }));

  // Role-based permissions
  const isOfficeUser = user?.role && OFFICE_ROLES.includes(user.role);

  // Check if job can be reopened or is in a terminal state
  const canReopen = ["completed", "archived"].includes(job.status);
  const isInvoiced = job.status === "invoiced";
  const isTerminal = ["completed", "archived", "invoiced"].includes(job.status);

  const locationName = job.location?.location || job.location?.companyName || "Location";
  const clientName = job.parentCompany?.name || job.location?.companyName || "Client";
  const fullAddress = job.location ?
    [job.location.address, job.location.address2, job.location.city, job.location.province, job.location.postalCode].filter(Boolean).join(", ") : "";

  const existingInvoice = jobInvoice;

  // createInvoiceMutation removed (2026-03-22) — dead code, showActions always false.
  // Invoice creation canonicalized in CreateInvoiceFromJobDialog.

  // Ref to track active undo timeout
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear undo timeout on unmount
  useEffect(() => {
    return () => {
      if (undoTimeoutRef.current) {
        clearTimeout(undoTimeoutRef.current);
      }
    };
  }, []);

  const undoCloseMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(`/api/jobs/${job.id}/undo-close`, {
        method: "POST",
      });
      return response as { job: any };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      // 2026-04-05: Invalidate ["/api/jobs"] family for Job Detail sub-resource freshness
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      // Phase 5.1: undoing a close moves job back to a different status bucket
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
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
      // Use the unified close endpoint with visit guardrail support
      const response = await apiRequest(`/api/jobs/${job.id}/close`, {
        method: "POST",
        body: JSON.stringify({ mode, version: job.version, autoCompleteOpenVisits }),
      });
      return { ...(response as { job: any; invoice: any | null }), mode };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["visits"] });
      // 2026-04-05: Invalidate ["/api/jobs"] family so Job Detail sub-resources
      // (time-summary, time-entries, expenses, notes) refresh after close.
      // The ["jobs"] prefix does NOT match ["/api/jobs", ...] — separate family.
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      // Phase 5.1: closing a job removes it from active/on-hold dashboard counts
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setShowCloseJobDialog(false);
      setUncompletedVisitsGuardrail(null);

      if (data.invoice) {
        // Invoice created - no undo available
        // Phase 5 Step A7: canonical family key invalidation
        queryClient.invalidateQueries({ queryKey: ["invoices"] });
        toast({ title: "Job Closed", description: "Job closed and invoice created." });
        setLocation(`/invoices/${data.invoice.id}`);
      } else {
        // Archive or invoice_later - show undo toast
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

        // Auto-dismiss undo option after 20 seconds
        undoTimeoutRef.current = setTimeout(() => {
          toastResult.dismiss();
          undoTimeoutRef.current = null;
        }, 20000);
      }
    },
    onError: (error: Error) => {
      setShowCloseJobDialog(false);

      // Uncompleted visits guardrail (409 UNCOMPLETED_VISITS) → dedicated dialog
      if (isApiError(error) && error.status === 409 && error.message.includes("uncompleted visit")) {
        const countMatch = error.message.match(/(\d+)\s+uncompleted/);
        const visitCount = countMatch ? parseInt(countMatch[1], 10) : 0;
        setUncompletedVisitsGuardrail({ mode: closeOption, visitCount });
        return;
      }
      // Version conflict (409 VERSION_MISMATCH) → silent refresh
      const isVersionConflict =
        (isApiError(error) && error.status === 409) ||
        /version|expected version|optimistic/i.test(error.message);
      if (isVersionConflict) {
        toast({ title: "Conflict", description: "This job was updated elsewhere. Refreshing\u2026" });
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
        queryClient.invalidateQueries({ queryKey: ["invoices"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
        queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });
        queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
        return;
      }
      // Already invoiced state mismatch → refresh
      if (/Cannot close job in status 'invoiced'/i.test(error.message)) {
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
        queryClient.invalidateQueries({ queryKey: ["invoices"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        setCloseJobError({
          title: "Already Invoiced",
          body: "This job is already invoiced. The page will refresh with the latest status.",
        });
        return;
      }
      // No line items / validation failures → communication dialog with archive option
      if (/no.*(line item|billable|part)/i.test(error.message) || /validation/i.test(error.message)) {
        setCloseJobError({
          title: "Can't create invoice",
          body: "This job has no line items. You need at least one line item to create an invoice.",
          showArchiveAction: true,
        });
        return;
      }
      // Unexpected / internal errors → keep destructive toast as last resort
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
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
      // Fix: send version for optimistic locking + correct field name targetOpenSubStatus
      const response = await apiRequest(`/api/jobs/${job.id}/reopen`, {
        method: "POST",
        body: JSON.stringify({ targetOpenSubStatus: null, version: job.version }),
      });
      return response as { job: any };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      // (covered by family-wide ["jobs"] invalidation above)
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/range"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      // Phase 5 Step B3: canonical dashboard family key
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: "Job Reopened", description: "Job has been reopened and is ready for scheduling." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to reopen job", variant: "destructive" });
    },
  });

  const handleReopenJob = () => {
    if (isInvoiced) {
      setShowInvoicedWarning(true);
    } else {
      reopenJobMutation.mutate();
    }
  };

  // handleCreateInvoice removed (2026-03-22) — dead code, showActions always false.

  const handleCreateSimilarJob = () => {
    setLocation(`/jobs/new?cloneFrom=${job.id}`);
  };

  const handleCloseJob = () => {
    closeJobMutation.mutate({ mode: closeOption });
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = () => {
    toast({ title: "Coming Soon", description: "PDF download will be available soon." });
  };

  const handleCollectSignature = () => {
    toast({ title: "Coming Soon", description: "Signature collection will be available soon." });
  };

  return (
    <>
      <div data-testid="card-job-header">
          <div className="flex flex-wrap items-start justify-between gap-4">
            {/* LEFT: Client info, job summary, address */}
            <div className="flex-1 min-w-[280px]">
              <button
                type="button"
                onClick={() => setLocation(`/clients/${job.locationId}`)}
                className="text-left"
                data-testid="link-client-title"
              >
                <h1 className="text-xl font-bold tracking-tight text-[#0f172a] hover:text-[#76B054] transition-colors" data-testid="text-client-title">
                  {clientName}
                </h1>
              </button>

              {job.summary && (
                <p className="mt-0.5 text-sm font-medium text-[#475569]" data-testid="text-job-summary">
                  {job.summary}
                </p>
              )}

              <div className="mt-2 flex items-center gap-1.5 text-xs text-[#64748b]" data-testid="text-location-info">
                <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="font-medium text-[#64748b]">{locationName}</span>
                {fullAddress && (
                  <>
                    <span>·</span>
                    <span>{fullAddress}</span>
                  </>
                )}
              </div>

              {/* Action buttons — hidden when showActions is false (parent renders its own action bar) */}
              {showActions && <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onEdit}
                  data-testid="button-edit"
                >
                  Edit Job
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" data-testid="button-more-actions">
                      <MoreHorizontal className="h-4 w-4 mr-1" />
                      More Actions
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {/* Office-only: Close Job (hidden for terminal states) */}
                    {isOfficeUser && !isTerminal && (
                      <DropdownMenuItem
                        onClick={() => setShowCloseJobDialog(true)}
                        data-testid="menu-close-job"
                      >
                        <XCircle className="h-4 w-4 mr-2" />
                        Close Job
                      </DropdownMenuItem>
                    )}
                    {/* Office-only: Reopen Job */}
                    {isOfficeUser && (canReopen || isInvoiced) && (
                      <DropdownMenuItem
                        onClick={handleReopenJob}
                        disabled={reopenJobMutation.isPending}
                        data-testid="menu-reopen-job"
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        {reopenJobMutation.isPending ? "Reopening..." : "Reopen Job"}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={handleCreateSimilarJob}
                      data-testid="menu-create-similar"
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Create Similar Job
                    </DropdownMenuItem>
                    {/* Create/View Invoice menu item removed (2026-03-22) — dead code */}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleCollectSignature}
                      data-testid="menu-collect-signature"
                    >
                      <PenTool className="h-4 w-4 mr-2" />
                      Collect Signature
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handleDownloadPDF}
                      data-testid="menu-download-pdf"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download PDF
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={handlePrint}
                      data-testid="menu-print"
                    >
                      <Printer className="h-4 w-4 mr-2" />
                      Print
                    </DropdownMenuItem>
                    {/* Office-only: Delete Job */}
                    {isOfficeUser && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setShowDeleteConfirm(true)}
                          className="text-destructive"
                          data-testid="menu-delete-job"
                        >
                          Delete Job
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>}
            </div>
          </div>
      </div>

      {/* Close Job Dialog */}
      <Dialog open={showCloseJobDialog} onOpenChange={setShowCloseJobDialog}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-close-job">
          <DialogHeader>
            <DialogTitle>Close Job</DialogTitle>
            <DialogDescription>
              {isInvoiced
                ? "This job is already invoiced and cannot be closed again."
                : "Closing this job will stop scheduling activity. Choose how you want to proceed with billing."}
            </DialogDescription>
          </DialogHeader>

          {/* Guard: if job is already invoiced, show link to invoice instead of close options */}
          {isInvoiced ? (
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCloseJobDialog(false)}>
                Cancel
              </Button>
              {existingInvoice && (
                <Button onClick={() => { setShowCloseJobDialog(false); setLocation(`/invoices/${existingInvoice.id}`); }}>
                  <Receipt className="h-4 w-4 mr-2" />
                  View Invoice
                </Button>
              )}
            </DialogFooter>
          ) : (<>
          <div className="space-y-3 py-4">
            <label 
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${closeOption === "invoice_now" ? "border-primary bg-primary/5" : "hover-elevate"}`}
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
                <p className="text-xs text-muted-foreground">
                  Creates an invoice from this job and marks it as invoiced.
                </p>
              </div>
            </label>

            <label 
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${closeOption === "invoice_later" ? "border-primary bg-primary/5" : "hover-elevate"}`}
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
                <p className="text-xs text-muted-foreground">
                  Marks job as completed. You can create an invoice later.
                </p>
              </div>
            </label>

            <label 
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${closeOption === "archive" ? "border-destructive bg-destructive/5" : "hover-elevate"}`}
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
                <p className="text-xs text-muted-foreground">
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

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCloseJobDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCloseJob}
              disabled={closeJobMutation.isPending}
              data-testid="button-confirm-close"
            >
              {closeJobMutation.isPending ? "Closing..." : "Close Job"}
            </Button>
          </DialogFooter>
          </>)}
        </DialogContent>
      </Dialog>

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
                // Navigate to visits section (scroll to visits on this page)
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
                // Retry close with auto-complete flag
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
      <Dialog open={!!closeJobError} onOpenChange={(open) => { if (!open) setCloseJobError(null); }}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-close-job-error">
          <DialogHeader>
            <DialogTitle>{closeJobError?.title}</DialogTitle>
            <DialogDescription>{closeJobError?.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setCloseJobError(null)}>
              Go back
            </Button>
            {closeJobError?.showArchiveAction && (
              <Button
                onClick={() => {
                  setCloseJobError(null);
                  closeJobMutation.mutate({ mode: "archive" });
                }}
                disabled={closeJobMutation.isPending}
                data-testid="button-archive-no-invoice"
              >
                Close & archive (no invoice)
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent data-testid="dialog-delete-job">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Job</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this job? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { onDelete(); setShowDeleteConfirm(false); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Invoiced Warning - cannot reopen */}
      <Dialog open={showInvoicedWarning} onOpenChange={setShowInvoicedWarning}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-invoiced-warning">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Cannot Reopen Job
            </DialogTitle>
            <DialogDescription>
              This job has been invoiced and cannot be reopened directly.
              To reopen this job, you must first void or credit the linked invoice.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowInvoicedWarning(false)}>
              Cancel
            </Button>
            {existingInvoice && (
              <Button
                onClick={() => {
                  setShowInvoicedWarning(false);
                  setLocation(`/invoices/${existingInvoice.id}`);
                }}
                data-testid="button-view-invoice"
              >
                <Receipt className="h-4 w-4 mr-2" />
                View Invoice
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});
