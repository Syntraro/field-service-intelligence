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
import { formatCurrency } from "@/lib/formatters";

interface ConfirmSendModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceNumber: string | null;
  customerName: string;
  total: string;
  onConfirm: () => void;
  isPending?: boolean;
}

export function ConfirmSendModal({
  open,
  onOpenChange,
  invoiceNumber,
  customerName,
  total,
  onConfirm,
  isPending,
}: ConfirmSendModalProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Send Invoice?</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">
              Mark Invoice #{invoiceNumber || "Draft"} for {formatCurrency(total)} to {customerName} as sent?
            </span>
            <span className="block text-foreground">
              This will set the invoice status to awaiting payment. The invoice remains editable — if you change billing details later, you may need to resend an updated copy to the client.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isPending}>
            {isPending ? "Sending..." : "Send Invoice"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
