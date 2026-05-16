import {
  ModalShell,
  ModalHeader,
  ModalTitle,
} from "@/components/ui/modal";
import { TaskDialog } from "@/components/TaskDialog";

export interface CreateTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: {
    assignedToUserId?: string;
    startDate?: string;
    startTime?: string;
  };
  onChanged?: () => void;
}

export function CreateTaskModal({
  open,
  onOpenChange,
  initialData,
  onChanged,
}: CreateTaskModalProps) {
  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="max-w-xl sm:max-w-[600px] h-auto max-h-[90vh] flex flex-col overflow-hidden"
      data-testid="dialog-create-task"
    >
      <ModalHeader>
        <ModalTitle>Create Task</ModalTitle>
      </ModalHeader>
      <TaskDialog
        open={open}
        onOpenChange={onOpenChange}
        embedded
        forcedType="GENERAL"
        initialData={initialData}
        onChanged={onChanged}
      />
    </ModalShell>
  );
}
