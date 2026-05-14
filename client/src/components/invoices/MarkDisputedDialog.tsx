import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { InvoiceView } from "@/components/invoices/InvoiceListPanel";
import { receivablesKeys } from "@/lib/receivablesQueryKeys";
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
import { FormField, FormLabel, FormErrorText } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface MarkDisputedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  /** Scopes cache invalidation to the active view slice. Defaults to "all". */
  activeView?: InvoiceView;
  onSuccess?: () => void;
}

const CONTACT_METHOD_OPTIONS = [
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "portal", label: "Portal" },
  { value: "in_person", label: "In Person" },
  { value: "other", label: "Other" },
] as const;

export function MarkDisputedDialog({
  open,
  onOpenChange,
  invoiceId,
  activeView = "all",
  onSuccess,
}: MarkDisputedDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [noteText, setNoteText] = useState("");
  const [contactMethod, setContactMethod] = useState("");
  const [errors, setErrors] = useState<{ noteText?: string }>({});

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      setNoteText("");
      setContactMethod("");
      setErrors({});
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async (payload: { noteText: string; contactMethod?: string }) =>
      apiRequest(`/api/receivables/invoices/${invoiceId}/mark-disputed`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: receivablesKeys.viewsCounts() });
      queryClient.invalidateQueries({ queryKey: receivablesKeys.invoices(activeView) });
      // Notes invalidation is scoped by the caller via the onSuccess callback.
      toast({ title: "Dispute recorded" });
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message, variant: "destructive" });
    },
  });

  function handleSubmit() {
    const nextErrors: typeof errors = {};
    if (!noteText.trim()) nextErrors.noteText = "Note is required.";
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});

    mutation.mutate({
      noteText: noteText.trim(),
      contactMethod: contactMethod || undefined,
    });
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-[460px]"
      data-testid="mark-disputed-modal"
    >
      <ModalHeader>
        <ModalTitle>Mark Disputed</ModalTitle>
        <ModalDescription>Record a dispute on this invoice.</ModalDescription>
      </ModalHeader>
      <ModalBody className="space-y-4">
        <FormField>
          <FormLabel htmlFor="disputeNoteText" srOnly>Note</FormLabel>
          <Textarea
            id="disputeNoteText"
            placeholder="Describe the dispute…"
            value={noteText}
            onChange={(e) => {
              setNoteText(e.target.value);
              if (e.target.value.trim()) setErrors((e2) => ({ ...e2, noteText: undefined }));
            }}
            data-testid="dispute-note-text"
          />
          {errors.noteText && <FormErrorText>{errors.noteText}</FormErrorText>}
        </FormField>

        <FormField>
          <FormLabel htmlFor="disputeContactMethod">Contact Method</FormLabel>
          <Select value={contactMethod} onValueChange={setContactMethod}>
            <SelectTrigger id="disputeContactMethod">
              <SelectValue placeholder="Select method…" />
            </SelectTrigger>
            <SelectContent>
              {CONTACT_METHOD_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryAction onClick={() => onOpenChange(false)}>
          Cancel
        </ModalSecondaryAction>
        <ModalPrimaryAction
          onClick={handleSubmit}
          disabled={mutation.isPending}
          data-testid="mark-disputed-confirm"
        >
          Record Dispute
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}
