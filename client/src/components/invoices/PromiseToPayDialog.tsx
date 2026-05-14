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
import { CanonicalDatePicker } from "@/components/ui/canonical-date-picker";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PromiseToPayDialogProps {
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

export function PromiseToPayDialog({
  open,
  onOpenChange,
  invoiceId,
  activeView = "all",
  onSuccess,
}: PromiseToPayDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [promisedDateStr, setPromisedDateStr] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [contactMethod, setContactMethod] = useState("");
  const [errors, setErrors] = useState<{ promisedAt?: string; noteText?: string }>({});

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      setPromisedDateStr(null);
      setNoteText("");
      setContactMethod("");
      setErrors({});
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async (payload: {
      promisedAt: string;
      noteText: string;
      contactMethod?: string;
    }) =>
      apiRequest(`/api/receivables/invoices/${invoiceId}/promise-to-pay`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: receivablesKeys.viewsCounts() });
      queryClient.invalidateQueries({ queryKey: receivablesKeys.invoices(activeView) });
      // Notes invalidation is scoped by the caller via the onSuccess callback.
      toast({ title: "Promise recorded" });
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message, variant: "destructive" });
    },
  });

  function handleSubmit() {
    const nextErrors: typeof errors = {};
    if (!promisedDateStr) nextErrors.promisedAt = "Promise date is required.";
    if (!noteText.trim()) nextErrors.noteText = "Note is required.";
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});

    // Local-time midnight so "May 14" means 00:00 in the user's timezone, not UTC.
    const promisedAt = new Date(promisedDateStr! + "T00:00:00").toISOString();
    mutation.mutate({
      promisedAt,
      noteText: noteText.trim(),
      contactMethod: contactMethod || undefined,
    });
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-[460px]"
      data-testid="promise-to-pay-modal"
    >
      <ModalHeader>
        <ModalTitle>Record Promise to Pay</ModalTitle>
        <ModalDescription>
          Record when the customer promised to pay this invoice.
        </ModalDescription>
      </ModalHeader>
      <ModalBody className="space-y-4">
        <FormField>
          <FormLabel htmlFor="promisedAt">Promise Date</FormLabel>
          <CanonicalDatePicker
            value={promisedDateStr}
            onChange={(v) => {
              setPromisedDateStr(v);
              if (v) setErrors((e) => ({ ...e, promisedAt: undefined }));
            }}
            placeholder="Pick date"
          />
          {errors.promisedAt && <FormErrorText>{errors.promisedAt}</FormErrorText>}
        </FormField>

        <FormField>
          <FormLabel htmlFor="promiseNoteText" srOnly>Note</FormLabel>
          <Textarea
            id="promiseNoteText"
            placeholder="Enter details about this promise…"
            value={noteText}
            onChange={(e) => {
              setNoteText(e.target.value);
              if (e.target.value.trim()) setErrors((e2) => ({ ...e2, noteText: undefined }));
            }}
            data-testid="promise-note-text"
          />
          {errors.noteText && <FormErrorText>{errors.noteText}</FormErrorText>}
        </FormField>

        <FormField>
          <FormLabel htmlFor="promiseContactMethod">Contact Method</FormLabel>
          <Select value={contactMethod} onValueChange={setContactMethod}>
            <SelectTrigger id="promiseContactMethod" data-testid="promise-contact-method">
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
          data-testid="promise-to-pay-confirm"
        >
          Record Promise
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}
