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

interface ConfirmVoidModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceNumber: string | null;
  onConfirm: () => void;
  isPending?: boolean;
}

export function ConfirmVoidModal({
  open,
  onOpenChange,
  invoiceNumber,
  onConfirm,
  isPending,
}: ConfirmVoidModalProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Void Invoice?</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">
              Are you sure you want to void Invoice #{invoiceNumber || "Draft"}?
            </span>
            <span className="block font-medium text-destructive">
              This action cannot be undone. The invoice will be marked as void and no further payments can be recorded.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isPending ? "Voiding..." : "Void Invoice"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
