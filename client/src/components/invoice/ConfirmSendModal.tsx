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

interface ConfirmSendModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceNumber: string | null;
  customerName: string;
  total: string;
  onConfirm: () => void;
  isPending?: boolean;
}

function formatCurrency(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(num);
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
              Send Invoice #{invoiceNumber || "Draft"} for {formatCurrency(total)} to {customerName}?
            </span>
            <span className="block font-medium text-foreground">
              Note: Once sent, this invoice cannot be edited. Only notes can be updated.
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
