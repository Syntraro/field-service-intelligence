/** Phase 12 wrapper: invoice send modal. */
import { SendCommunicationModal } from "./SendCommunicationModal";

interface Props {
  invoiceId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function SendInvoiceModal({ invoiceId, isOpen, onClose, onSuccess }: Props) {
  return (
    <SendCommunicationModal
      entityType="invoice"
      entityId={invoiceId}
      isOpen={isOpen}
      onClose={onClose}
      onSuccess={onSuccess}
      title="Send Invoice"
    />
  );
}
