/**
 * CreateInvoiceFromJobDialog — Canonical dialog for creating invoices from jobs.
 *
 * Extracted from JobDetailPage.tsx (2026-03-22).
 * Creates draft invoices via POST /api/invoices/from-job/:jobId.
 *
 * Two workflow branches:
 *   - "Create Invoice" → markJobCompleted = false
 *   - "Close Job & Create Invoice" → markJobCompleted = true (hidden if job already completed)
 *
 * Owns: mutation, cache invalidation, toast, dialog close.
 * Parent owns: activity logging, navigation (via onCreated callback).
 */
import { useMutation } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface CreateInvoiceFromJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobNumber: number;
  jobSummary: string;
  jobStatus: string;
  locationDisplayName: string;
  onCreated: (invoice: { id: string; invoiceNumber?: string }) => void;
}

export function CreateInvoiceFromJobDialog({
  open,
  onOpenChange,
  jobId,
  jobNumber,
  jobSummary,
  jobStatus,
  locationDisplayName,
  onCreated,
}: CreateInvoiceFromJobDialogProps) {
  const { toast } = useToast();

  const createInvoiceMutation = useMutation({
    mutationFn: async (markJobCompleted: boolean = false) => {
      const response = await apiRequest(`/api/invoices/from-job/${jobId}`, {
        method: "POST",
        body: JSON.stringify({
          includeLineItems: true,
          includeNotes: true,
          markJobCompleted,
        })
      });
      return response;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: "Invoice Created", description: "Invoice has been created from this job." });
      onOpenChange(false);
      onCreated(data);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create invoice",
        variant: "destructive",
      });
    },
  });

  const handleCreateInvoice = (closeJob: boolean = false) => {
    createInvoiceMutation.mutate(closeJob);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-create-invoice">
        <DialogHeader>
          <DialogTitle>Create Invoice from Job</DialogTitle>
          <DialogDescription>
            This will create a new draft invoice with line items from this job's parts and billing.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-muted-foreground">
            Job: #{jobNumber} - {jobSummary || "No summary"}
          </p>
          <p className="text-sm text-muted-foreground">
            Client: {locationDisplayName || "Unknown"}
          </p>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {jobStatus !== "completed" && (
            <Button
              variant="outline"
              onClick={() => handleCreateInvoice(true)}
              disabled={createInvoiceMutation.isPending}
              data-testid="button-close-job-create-invoice"
            >
              {createInvoiceMutation.isPending ? "Creating..." : "Close Job & Create Invoice"}
            </Button>
          )}
          <Button
            onClick={() => handleCreateInvoice(false)}
            disabled={createInvoiceMutation.isPending}
            data-testid="button-confirm-create-invoice"
          >
            {createInvoiceMutation.isPending ? "Creating..." : "Create Invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
