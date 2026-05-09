/**
 * ConfirmVoidModal — destructive confirm for voiding an invoice.
 * 2026-05-09: migrated from AlertDialog to canonical ConfirmModal.
 * AlertDialog provided no behavioral benefit here (escape-key dismiss
 * is identical to Dialog; the ARIA role="alertdialog" wasn't being
 * leveraged by any a11y tool). ConfirmModal gives consistent button
 * sizing, padding, and pending state with all other confirmation flows.
 */
import { ConfirmModal } from "@/components/ui/modal";

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
    <ConfirmModal
      open={open}
      onOpenChange={onOpenChange}
      title="Void Invoice?"
      description={`Are you sure you want to void Invoice #${invoiceNumber || "Draft"}?`}
      emphasis="This action cannot be undone. The invoice will be marked as void and no further payments can be recorded."
      confirmLabel={isPending ? "Voiding…" : "Void Invoice"}
      variant="destructive"
      isPending={isPending}
      onConfirm={onConfirm}
      testIdPrefix="void-invoice"
    />
  );
}
