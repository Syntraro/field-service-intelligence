/** Phase 12 wrapper: job email modal. */
import { SendCommunicationModal } from "./SendCommunicationModal";

interface Props {
  jobId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function SendJobModal({ jobId, isOpen, onClose, onSuccess }: Props) {
  return (
    <SendCommunicationModal
      entityType="job"
      entityId={jobId}
      isOpen={isOpen}
      onClose={onClose}
      onSuccess={onSuccess}
      title="Send Email"
    />
  );
}
