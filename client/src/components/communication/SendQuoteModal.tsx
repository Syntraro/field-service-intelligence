/** Phase 12 wrapper: quote send modal. */
import { SendCommunicationModal } from "./SendCommunicationModal";

interface Props {
  quoteId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function SendQuoteModal({ quoteId, isOpen, onClose, onSuccess }: Props) {
  return (
    <SendCommunicationModal
      entityType="quote"
      entityId={quoteId}
      isOpen={isOpen}
      onClose={onClose}
      onSuccess={onSuccess}
      title="Send Quote"
    />
  );
}
