/**
 * QBO Override Acknowledgement Modal
 *
 * Phase 10A: Modal that users must complete before making billing changes to a QBO-synced invoice
 */

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface QboOverrideModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceNumber?: string | null;
  qboInvoiceId?: string | null;
  operationType: string; // e.g., "edit billing fields", "add line item", "void invoice"
  onConfirm: (reason: string) => void;
  isPending?: boolean;
}

export function QboOverrideModal({
  open,
  onOpenChange,
  invoiceNumber,
  qboInvoiceId,
  operationType,
  onConfirm,
  isPending = false,
}: QboOverrideModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState("");

  const canSubmit = acknowledged && reason.trim().length >= 10;

  const handleConfirm = () => {
    if (canSubmit) {
      onConfirm(reason.trim());
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Reset state when closing
      setAcknowledged(false);
      setReason("");
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
            QuickBooks Sync Warning
          </DialogTitle>
          <DialogDescription className="text-left">
            {invoiceNumber ? (
              <span>Invoice <strong>#{invoiceNumber}</strong></span>
            ) : (
              <span>This invoice</span>
            )}{" "}
            is synced to QuickBooks
            {qboInvoiceId && <span> (QBO ID: {qboInvoiceId})</span>}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <h4 className="font-medium text-amber-800 dark:text-amber-200 mb-2">
              Important Notice
            </h4>
            <p className="text-sm text-amber-700 dark:text-amber-300">
              You are about to <strong>{operationType}</strong>. This change will{" "}
              <strong>NOT</strong> be automatically synced to QuickBooks.
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-2">
              After making this change, you must manually update the invoice in QuickBooks
              to maintain accurate accounting records.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Checkbox
                id="acknowledge"
                checked={acknowledged}
                onCheckedChange={(checked) => setAcknowledged(checked === true)}
                data-testid="qbo-override-acknowledge"
              />
              <Label
                htmlFor="acknowledge"
                className="text-sm leading-normal cursor-pointer"
              >
                I understand that QuickBooks will <strong>NOT</strong> be updated
                automatically and I will manually reconcile this change.
              </Label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason">
                Reason for change <span className="text-muted-foreground">(min. 10 characters)</span>
              </Label>
              <Textarea
                id="reason"
                placeholder="Explain why this change is needed (e.g., 'Customer requested price adjustment', 'Correcting billing error')..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="min-h-[80px]"
                data-testid="qbo-override-reason"
              />
              {reason.length > 0 && reason.length < 10 && (
                <p className="text-xs text-destructive">
                  Please provide at least 10 characters ({10 - reason.length} more needed)
                </p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!canSubmit || isPending}
            data-testid="qbo-override-confirm"
          >
            {isPending ? "Processing..." : "Proceed with Change"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hook to manage QBO override modal state
 */
export function useQboOverride() {
  const [modalState, setModalState] = useState<{
    open: boolean;
    operationType: string;
    onConfirm: ((reason: string) => void) | null;
  }>({
    open: false,
    operationType: "",
    onConfirm: null,
  });

  const requestOverride = (
    operationType: string,
    onConfirm: (reason: string) => void
  ) => {
    setModalState({
      open: true,
      operationType,
      onConfirm,
    });
  };

  const closeModal = () => {
    setModalState({
      open: false,
      operationType: "",
      onConfirm: null,
    });
  };

  const handleConfirm = (reason: string) => {
    if (modalState.onConfirm) {
      modalState.onConfirm(reason);
    }
    closeModal();
  };

  return {
    isOpen: modalState.open,
    operationType: modalState.operationType,
    requestOverride,
    closeModal,
    handleConfirm,
  };
}
