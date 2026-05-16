import {
  ModalShell,
  ModalHeader,
  ModalTitle,
} from "@/components/ui/modal";
import { QuickAddJobDialog } from "@/components/QuickAddJobDialog";

export interface CreateJobModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedLocationId?: string;
  initialSchedule?: {
    date?: Date | string;
    time?: string;
    durationMinutes?: number;
    assignedTechnicianIds?: string[];
  };
  cloneFromJobId?: string;
  onSuccess?: () => void;
}

export function CreateJobModal({
  open,
  onOpenChange,
  preselectedLocationId,
  initialSchedule,
  cloneFromJobId,
  onSuccess,
}: CreateJobModalProps) {
  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="max-w-xl sm:max-w-[600px] h-auto max-h-[90vh] flex flex-col overflow-hidden"
      data-testid="dialog-create-job"
    >
      <ModalHeader>
        <ModalTitle>Create Job</ModalTitle>
      </ModalHeader>
      <QuickAddJobDialog
        open={open}
        onOpenChange={onOpenChange}
        embedded
        compact
        preselectedLocationId={preselectedLocationId}
        initialSchedule={initialSchedule}
        cloneFromJobId={cloneFromJobId}
        onSuccess={onSuccess}
      />
    </ModalShell>
  );
}
