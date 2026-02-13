import { useState, useRef, useEffect } from "react";
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
import { Card, CardContent } from "@/components/ui/card";
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
}

// Office roles that can perform billing/admin actions
const OFFICE_ROLES = ["owner", "admin", "manager", "dispatcher"];

export function JobHeaderCard({
  job,
  jobInvoice,
  onEdit,
  onDelete
}: JobHeaderCardProps) {
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

  // Role-based permissions
  const isOfficeUser = user?.role && OFFICE_ROLES.includes(user.role);

  // Check if job can be reopened
  const canReopen = ["completed", "archived"].includes(job.status);
  const isInvoiced = job.status === "invoiced";

  const locationName = job.location?.location || job.location?.companyName || "Location";
  const clientName = job.parentCompany?.name || job.location?.companyName || "Client";
  const fullAddress = job.location ?
    [job.location.address, job.location.city, job.location.province, job.location.postalCode].filter(Boolean).join(", ") : "";

  const existingInvoice = jobInvoice;

  const createInvoiceMutation = useMutation({
    mutationFn: async (markJobCompleted: boolean = false) => {
      return await apiRequest(`/api/invoices/from-job/${job.id}`, { method: "POST", body: JSON.stringify({
        includeLineItems: true,
        includeNotes: true,
        markJobCompleted,
      }) });
    },
    onSuccess: (data: any) => {
      // Phase 5 Step A7: canonical family key invalidation
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      // Phase 5.3 G2: dashboard invoice widget stale after creating invoice from job
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: "Invoice Created", description: "Invoice has been created from this job." });
      setLocation(`/invoices/${data.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create invoice", variant: "destructive" });
    },
  });

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
      // Handle uncompleted visits guardrail (409 UNCOMPLETED_VISITS)
      if (isApiError(error) && error.status === 409 && error.message.includes("uncompleted visit")) {
        // Extract visit count from error message (format: "Job has N uncompleted visit(s)")
        const countMatch = error.message.match(/(\d+)\s+uncompleted/);
        const visitCount = countMatch ? parseInt(countMatch[1], 10) : 0;
        setShowCloseJobDialog(false);
        setUncompletedVisitsGuardrail({ mode: closeOption, visitCount });
        return;
      }
      toast({ title: "Error", description: error.message || "Failed to close job", variant: "destructive" });
    },
  });

  const reopenJobMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(`/api/jobs/${job.id}/reopen`, {
        method: "POST",
        body: JSON.stringify({ target: "in_progress" }),
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
      toast({ title: "Job Reopened", description: "Job has been reopened and is now in progress." });
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

  const handleCreateInvoice = () => {
    if (existingInvoice) {
      setLocation(`/invoices/${existingInvoice.id}`);
    } else {
      createInvoiceMutation.mutate(false);
    }
  };

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
      <Card data-testid="card-job-header">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            {/* LEFT: Client info, job summary, address */}
            <div className="flex-1 min-w-[280px]">
              <button
                type="button"
                onClick={() => setLocation(`/clients/${job.locationId}`)}
                className="text-left"
                data-testid="link-client-title"
              >
                <h1 className="text-2xl font-semibold hover:text-primary transition-colors" data-testid="text-client-title">
                  {clientName}
                </h1>
              </button>

              {job.summary && (
                <p className="mt-0.5 text-base text-muted-foreground" data-testid="text-job-summary">
                  {job.summary}
                </p>
              )}

              <div className="mt-2 flex items-center gap-1.5 text-sm" data-testid="text-location-info">
                <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="font-medium">{locationName}</span>
                {fullAddress && (
                  <>
                    <span className="text-muted-foreground">-</span>
                    <span className="text-muted-foreground">{fullAddress}</span>
                  </>
                )}
              </div>

              {/* Action buttons */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
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
                    {/* Office-only: Close Job */}
                    {isOfficeUser && (
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
                    {/* Office-only: Create/View Invoice */}
                    {isOfficeUser && (
                      <DropdownMenuItem
                        onClick={handleCreateInvoice}
                        data-testid="menu-create-invoice"
                      >
                        <Receipt className="h-4 w-4 mr-2" />
                        {existingInvoice ? "View Invoice" : "Create Invoice"}
                      </DropdownMenuItem>
                    )}
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
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Close Job Dialog */}
      <Dialog open={showCloseJobDialog} onOpenChange={setShowCloseJobDialog}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-close-job">
          <DialogHeader>
            <DialogTitle>Close Job</DialogTitle>
            <DialogDescription>
              Closing this job will stop scheduling activity. Choose how you want to proceed with billing.
            </DialogDescription>
          </DialogHeader>
          
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
}
