import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
  ModalSecondaryAction,
  ModalPrimaryAction,
} from "@/components/ui/modal";
import { FormField, FormLabel } from "@/components/ui/form-field";
import { CanonicalDatePicker } from "@/components/ui/canonical-date-picker";
import type { InvoiceView } from "@/components/invoices/InvoiceListPanel";
import { receivablesKeys } from "@/lib/receivablesQueryKeys";

interface SetFollowUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  currentFollowUpAt?: string | null;
  /** Scopes cache invalidation to the active view slice. Defaults to "all". */
  activeView?: InvoiceView;
  onSuccess?: () => void;
}

export function SetFollowUpDialog({
  open,
  onOpenChange,
  invoiceId,
  currentFollowUpAt,
  activeView = "all",
  onSuccess,
}: SetFollowUpDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [dateStr, setDateStr] = useState<string | null>(() => {
    if (!currentFollowUpAt) return null;
    // Convert ISO timestamp to YYYY-MM-DD for the picker
    return currentFollowUpAt.slice(0, 10);
  });

  // Sync initial value when dialog opens with a new invoice
  useEffect(() => {
    if (open) {
      setDateStr(currentFollowUpAt ? currentFollowUpAt.slice(0, 10) : null);
    }
  }, [open, currentFollowUpAt]);

  const mutation = useMutation({
    mutationFn: async (followUpAt: string | null) =>
      apiRequest(`/api/receivables/invoices/${invoiceId}/follow-up`, {
        method: "PATCH",
        body: JSON.stringify({ followUpAt }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: receivablesKeys.viewsCounts() });
      queryClient.invalidateQueries({ queryKey: receivablesKeys.invoices(activeView) });
      toast({ title: "Follow-up saved" });
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message, variant: "destructive" });
    },
  });

  function handleSave() {
    const followUpAt = dateStr
      ? new Date(dateStr + "T00:00:00").toISOString()
      : null;
    mutation.mutate(followUpAt);
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-[400px]"
      data-testid="set-follow-up-modal"
    >
      <ModalHeader>
        <ModalTitle>Set Follow-up</ModalTitle>
        <ModalDescription>Schedule a follow-up reminder for this invoice.</ModalDescription>
      </ModalHeader>
      <ModalBody className="space-y-4">
        <FormField>
          <FormLabel htmlFor="followUpDate" srOnly>Follow-up Date</FormLabel>
          <CanonicalDatePicker
            value={dateStr}
            onChange={(v) => setDateStr(v)}
            placeholder="Pick date"
            clearable
            data-testid="set-follow-up-date"
          />
        </FormField>
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryAction onClick={() => onOpenChange(false)}>
          Cancel
        </ModalSecondaryAction>
        <ModalPrimaryAction
          onClick={handleSave}
          disabled={mutation.isPending}
          data-testid="set-follow-up-confirm"
        >
          Save Follow-up
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}
