import { useState } from "react";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  MapPin, 
  MoreHorizontal,
  Copy,
  Receipt,
  PenTool,
  Download,
  Printer,
  XCircle,
  AlertTriangle
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
import type { Job, Client, CustomerCompany, Invoice } from "@shared/schema";

interface JobHeaderCardProps {
  job: Job & {
    location?: Client;
    parentCompany?: CustomerCompany;
  };
  jobInvoices: Invoice[];
  onEdit: () => void;
  onDelete: () => void;
}

function getJobStatusDisplay(status: string, scheduledStart: Date | null): { 
  label: string; 
  variant: "default" | "destructive" | "secondary" | "outline"; 
  isOverdue?: boolean;
} {
  const now = new Date();
  const isOverdue = !!(scheduledStart && new Date(scheduledStart) < now && 
    !["completed", "invoiced", "cancelled", "closed", "archived"].includes(status));

  switch (status) {
    case "draft": return { label: "Draft", variant: "outline", isOverdue };
    case "scheduled": return { label: "Scheduled", variant: "secondary", isOverdue };
    case "dispatched": return { label: "Dispatched", variant: "secondary", isOverdue };
    case "en_route": return { label: "En Route", variant: "default", isOverdue };
    case "on_site": return { label: "On Site", variant: "default", isOverdue };
    case "in_progress": return { label: "In Progress", variant: "default", isOverdue };
    case "needs_parts": return { label: "Needs Parts", variant: "secondary", isOverdue };
    case "on_hold": return { label: "On Hold", variant: "secondary", isOverdue };
    case "completed": return { label: "Completed", variant: "default", isOverdue: false };
    case "invoiced": return { label: "Invoiced", variant: "default", isOverdue: false };
    case "cancelled": return { label: "Cancelled", variant: "outline", isOverdue: false };
    case "closed": return { label: "Closed", variant: "outline", isOverdue: false };
    case "archived": return { label: "Archived", variant: "outline", isOverdue: false };
    default: return { label: status, variant: "outline", isOverdue };
  }
}

function getPriorityDisplay(priority: string): { 
  label: string; 
  variant: "default" | "destructive" | "secondary" | "outline";
} {
  switch (priority) {
    case "low": return { label: "Low", variant: "outline" };
    case "medium": return { label: "Medium", variant: "secondary" };
    case "high": return { label: "High", variant: "default" };
    case "urgent": return { label: "Urgent", variant: "destructive" };
    default: return { label: priority, variant: "outline" };
  }
}

export function JobHeaderCard({ 
  job, 
  jobInvoices,
  onEdit, 
  onDelete
}: JobHeaderCardProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showCloseJobDialog, setShowCloseJobDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [closeOption, setCloseOption] = useState<"invoice_now" | "invoice_later" | "archive">("invoice_now");

  const locationName = job.location?.location || job.location?.companyName || "Location";
  const clientName = job.parentCompany?.name || job.location?.companyName || "Client";
  const fullAddress = job.location ? 
    [job.location.address, job.location.city, job.location.province, job.location.postalCode].filter(Boolean).join(", ") : "";

  const existingInvoice = jobInvoices.length > 0 ? jobInvoices[0] : null;

  const createInvoiceMutation = useMutation({
    mutationFn: async (markJobCompleted: boolean = false) => {
      return await apiRequest(`/api/invoices/from-job/${job.id}`, { method: "POST", body: JSON.stringify({
        includeLineItems: true,
        includeNotes: true,
        markJobCompleted,
      }) });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", job.id] });
      toast({ title: "Invoice Created", description: "Invoice has been created from this job." });
      setLocation(`/invoices/${data.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create invoice", variant: "destructive" });
    },
  });

  const closeJobMutation = useMutation({
    mutationFn: async (option: "invoice_now" | "invoice_later" | "archive") => {
      let newStatus = "completed";
      if (option === "invoice_now") {
        newStatus = "invoiced";
      } else if (option === "archive") {
        newStatus = "archived";
      }

      await apiRequest(`/api/jobs/${job.id}/status`, { method: "PATCH", body: JSON.stringify({ status: newStatus }) });

      if (option === "invoice_now") {
        return await apiRequest(`/api/invoices/from-job/${job.id}`, { method: "POST", body: JSON.stringify({
          includeLineItems: true,
          includeNotes: true,
          markJobCompleted: true,
        }) });
      }
      return null;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", job.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      setShowCloseJobDialog(false);
      
      if (data) {
        queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
        toast({ title: "Job Closed", description: "Job closed and invoice created." });
        setLocation(`/invoices/${data.id}`);
      } else {
        toast({ title: "Job Closed", description: "Job has been closed." });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to close job", variant: "destructive" });
    },
  });

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
    closeJobMutation.mutate(closeOption);
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
                    <DropdownMenuItem 
                      onClick={() => setShowCloseJobDialog(true)}
                      data-testid="menu-close-job"
                    >
                      <XCircle className="h-4 w-4 mr-2" />
                      Close Job
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={handleCreateSimilarJob}
                      data-testid="menu-create-similar"
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Create Similar Job
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={handleCreateInvoice}
                      data-testid="menu-create-invoice"
                    >
                      <Receipt className="h-4 w-4 mr-2" />
                      {existingInvoice ? "View Invoice" : "Create Invoice"}
                    </DropdownMenuItem>
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
                    <DropdownMenuSeparator />
                    <DropdownMenuItem 
                      onClick={() => setShowDeleteConfirm(true)}
                      className="text-destructive"
                      data-testid="menu-delete-job"
                    >
                      Delete Job
                    </DropdownMenuItem>
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
    </>
  );
}
