import { useState, useEffect, useMemo } from "react";
import { addDays, format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone, Check } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
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
import {
  FormField,
  FormLabel,
  FormErrorText,
  FormHelperText,
} from "@/components/ui/form-field";
import { CanonicalDatePicker } from "@/components/ui/canonical-date-picker";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { receivablesKeys } from "@/lib/receivablesQueryKeys";
import type { InvoiceView } from "@/components/invoices/InvoiceListPanel";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ContactClientModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  customerCompanyId: string;
  activeView?: InvoiceView;
  onSuccess?: () => void;
}

interface ContactOption {
  id: string;
  name: string;
}

type OutcomeValue =
  | "spoke_with"
  | "left_message"
  | "no_answer"
  | "email_sent"
  | "text_sent"
  | "other";

const OUTCOME_OPTIONS: { value: OutcomeValue; label: string }[] = [
  { value: "spoke_with", label: "Spoke with Client" },
  { value: "left_message", label: "Left Message" },
  { value: "no_answer", label: "No Answer" },
  { value: "email_sent", label: "Email Sent" },
  { value: "text_sent", label: "Text Sent" },
  { value: "other", label: "Other" },
];

const METHOD_OPTIONS = [
  { value: "phone_call", label: "Phone Call" },
  { value: "email", label: "Email" },
  { value: "text_message", label: "Text Message" },
  { value: "in_person", label: "In Person" },
  { value: "other", label: "Other" },
] as const;

const FOLLOW_UP_TYPE_OPTIONS = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "text", label: "Text" },
  { value: "task", label: "Task/Reminder" },
] as const;

const QUICK_FOLLOW_UP = [
  { label: "3 Days", days: 3 },
  { label: "1 Week", days: 7 },
  { label: "2 Weeks", days: 14 },
] as const;

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayStr() {
  return format(new Date(), "yyyy-MM-dd");
}

// Submits at local noon to avoid timezone-driven date shifts
function toISONoon(dateStr: string) {
  return new Date(dateStr + "T12:00:00").toISOString();
}

function toISODate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toISOString();
}

// ── ContactClientModal ─────────────────────────────────────────────────────────

export function ContactClientModal({
  open,
  onOpenChange,
  invoiceId,
  customerCompanyId,
  activeView = "all",
  onSuccess,
}: ContactClientModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Form state ──────────────────────────────────────────────────────────────

  const [outcome, setOutcome] = useState<OutcomeValue | null>(null);
  const [contactedId, setContactedId] = useState<string>("");
  const [method, setMethod] = useState<string>("");
  const [dateStr, setDateStr] = useState<string>(todayStr());
  const [notes, setNotes] = useState<string>("");

  // Promise to pay
  const [promiseEnabled, setPromiseEnabled] = useState(false);
  const [promiseDateStr, setPromiseDateStr] = useState<string | null>(null);

  // Follow-up
  const [followUpEnabled, setFollowUpEnabled] = useState(false);
  const [followUpType, setFollowUpType] = useState<string>("call");
  const [followUpQuick, setFollowUpQuick] = useState<number | "custom" | null>(null);
  const [followUpDateStr, setFollowUpDateStr] = useState<string | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset when modal opens/closes
  useEffect(() => {
    if (!open) {
      setOutcome(null);
      setContactedId("");
      setMethod("");
      setDateStr(todayStr());
      setNotes("");
      setPromiseEnabled(false);
      setPromiseDateStr(null);
      setFollowUpEnabled(false);
      setFollowUpType("call");
      setFollowUpQuick(null);
      setFollowUpDateStr(null);
      setErrors({});
    }
  }, [open]);

  // ── Contacts fetch ──────────────────────────────────────────────────────────

  const { data: contactsData } = useQuery<{
    companyContacts: { id: string; firstName: string; lastName: string }[];
    locationContacts: {
      contactPersonId: string;
      firstName: string;
      lastName: string;
    }[];
  }>({
    queryKey: ["customer-contacts", customerCompanyId],
    queryFn: async () => {
      const res = await fetch(
        `/api/customer-companies/${encodeURIComponent(customerCompanyId)}/contacts`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load contacts");
      return res.json();
    },
    enabled: open && !!customerCompanyId,
    staleTime: 60_000,
  });

  const contactOptions = useMemo<ContactOption[]>(() => {
    const seen = new Set<string>();
    const result: ContactOption[] = [];
    const add = (id: string, first: string, last: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      result.push({ id, name: `${first} ${last}`.trim() });
    };
    contactsData?.companyContacts.forEach((c) => add(c.id, c.firstName, c.lastName));
    contactsData?.locationContacts.forEach((c) =>
      add(c.contactPersonId, c.firstName, c.lastName),
    );
    return result;
  }, [contactsData]);

  // ── Quick follow-up date calculation ───────────────────────────────────────

  function applyQuickFollowUp(days: number) {
    const base = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
    const result = addDays(base, days);
    setFollowUpDateStr(format(result, "yyyy-MM-dd"));
    setFollowUpQuick(days);
  }

  function handleFollowUpDateChange(v: string | null) {
    setFollowUpDateStr(v);
    setFollowUpQuick("custom");
  }

  // ── Save mutation ───────────────────────────────────────────────────────────

  const mutation = useMutation({
    mutationFn: async (payload: object) =>
      apiRequest(`/api/receivables/invoices/${invoiceId}/communicate`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: receivablesKeys.viewsCounts() });
      queryClient.invalidateQueries({ queryKey: receivablesKeys.invoices(activeView) });
      queryClient.invalidateQueries({ queryKey: receivablesKeys.notes(invoiceId) });
      toast({ title: "Communication saved" });
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message, variant: "destructive" });
    },
  });

  // ── Validation & submit ─────────────────────────────────────────────────────

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!outcome) errs.outcome = "Select an outcome.";
    if (!method) errs.method = "Select a method.";
    if (!dateStr) errs.date = "Date is required.";
    if (promiseEnabled && !promiseDateStr) {
      errs.promiseDate = "Payment date is required.";
    }
    if (followUpEnabled && !followUpDateStr) {
      errs.followUpDate = "Follow-up date is required.";
    }
    return errs;
  }

  function handleSave() {
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});

    const payload: Record<string, unknown> = {
      outcome,
      contactPersonId: contactedId || null,
      method,
      communicatedAt: toISONoon(dateStr),
      notes: notes.trim() || undefined,
    };

    if (promiseEnabled && promiseDateStr) {
      payload.promiseToPay = {
        enabled: true,
        promisedAt: toISODate(promiseDateStr),
      };
    }

    if (followUpEnabled && followUpDateStr) {
      payload.followUp = {
        enabled: true,
        followUpAt: toISODate(followUpDateStr),
      };
    }

    mutation.mutate(payload);
  }

  const isFormValid = !!outcome && !!method && !!dateStr;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="w-[720px] max-w-[720px] max-h-[calc(100vh-80px)]"
      data-testid="contact-client-modal"
    >
      <ModalHeader className="px-5 pt-4 pb-[10px] border-b border-slate-200 space-y-1.5 text-left">
        <ModalTitle>Communicate with Client</ModalTitle>
        <ModalDescription>Log outcome and set follow-up.</ModalDescription>
      </ModalHeader>

      <ModalBody className="px-5 py-3 overflow-y-auto">
        {/* ── Outcome + Details: side by side ── */}
        <div className="grid grid-cols-2 gap-5 items-start">
          {/* Outcome column */}
          <div>
            <div className="text-sm font-semibold leading-5 mb-2">Outcome</div>
            <div
              className="grid grid-cols-2 gap-2"
              role="radiogroup"
              aria-label="Communication outcome"
            >
              {OUTCOME_OPTIONS.map((opt) => {
                const selected = outcome === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setOutcome(opt.value);
                      setErrors((e) => ({ ...e, outcome: "" }));
                    }}
                    className={cn(
                      "relative flex items-center justify-between h-9 px-[10px] rounded-lg border text-left transition-colors",
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-background hover:border-primary/40 hover:bg-slate-50",
                    )}
                    data-testid={`outcome-${opt.value}`}
                  >
                    <span className="text-caption font-medium text-foreground">
                      {opt.label}
                    </span>
                    {selected && (
                      <Check
                        className="h-4 w-4 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>
            {errors.outcome && (
              <FormErrorText className="mt-1.5">{errors.outcome}</FormErrorText>
            )}
          </div>

          {/* Details column */}
          <div>
            <div className="text-sm font-semibold leading-5 mb-2">Details</div>
            <div className="space-y-3">
              {/* Contacted */}
              <FormField>
                <Select value={contactedId} onValueChange={setContactedId}>
                  <SelectTrigger className="h-[34px]" data-testid="contact-client-contacted">
                    <SelectValue placeholder="Spoke with…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unknown">Unknown / Not specified</SelectItem>
                    {contactOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              {/* Method */}
              <FormField>
                <Select
                  value={method}
                  onValueChange={(v) => {
                    setMethod(v);
                    setErrors((e) => ({ ...e, method: "" }));
                  }}
                >
                  <SelectTrigger className="h-[34px]" data-testid="contact-client-method">
                    <SelectValue placeholder="Via phone, text, email…" />
                  </SelectTrigger>
                  <SelectContent>
                    {METHOD_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.method && <FormErrorText>{errors.method}</FormErrorText>}
              </FormField>

              {/* Contact Date */}
              <FormField>
                <FormLabel required>Contact Date</FormLabel>
                <CanonicalDatePicker
                  value={dateStr}
                  onChange={(v) => {
                    setDateStr(v ?? todayStr());
                    setErrors((e) => ({ ...e, date: "" }));
                  }}
                  placeholder="Pick date"
                  className="h-[34px] w-[180px]"
                  data-testid="contact-client-date"
                />
                {errors.date && <FormErrorText>{errors.date}</FormErrorText>}
              </FormField>

              {/* Notes */}
              <FormField>
                <FormLabel srOnly>Notes</FormLabel>
                <Textarea
                  placeholder="Add details about the conversation…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={500}
                  className="h-[72px] resize-none"
                  data-testid="contact-client-notes"
                />
                {notes.length > 0 && (
                  <FormHelperText className="text-right">
                    {notes.length}/500
                  </FormHelperText>
                )}
              </FormField>
            </div>
          </div>
        </div>

        {/* ── Next Steps ── */}
        <div className="mt-4">
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-sm font-semibold leading-5">Next Steps</span>
            <span className="text-helper text-muted-foreground">Optional</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Promise to Pay card */}
            <div
              className="rounded-md border border-border p-3 space-y-3"
              data-testid="promise-to-pay-card"
            >
              <div className="text-caption font-medium text-foreground">
                Promise to Pay
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  id="promise-enabled"
                  checked={promiseEnabled}
                  onCheckedChange={(v) => {
                    setPromiseEnabled(!!v);
                    if (!v) {
                      setPromiseDateStr(null);
                      setErrors((e) => ({ ...e, promiseDate: "" }));
                    }
                  }}
                  data-testid="promise-enabled-checkbox"
                />
                <span className="text-caption text-foreground">
                  Client promised to pay
                </span>
              </label>

              {promiseEnabled && (
                <FormField>
                  <FormLabel htmlFor="promise-date" required>
                    Payment by
                  </FormLabel>
                  <CanonicalDatePicker
                    value={promiseDateStr}
                    onChange={(v) => {
                      setPromiseDateStr(v);
                      if (v) setErrors((e) => ({ ...e, promiseDate: "" }));
                    }}
                    placeholder="Pick date"
                    className="h-[34px] w-[170px]"
                    data-testid="promise-date-picker"
                  />
                  {errors.promiseDate && (
                    <FormErrorText>{errors.promiseDate}</FormErrorText>
                  )}
                </FormField>
              )}
            </div>

            {/* Set Follow-up card */}
            <div
              className="rounded-md border border-border p-3 space-y-3"
              data-testid="follow-up-card"
            >
              <div className="text-caption font-medium text-foreground">
                Set Follow-up
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  id="followup-enabled"
                  checked={followUpEnabled}
                  onCheckedChange={(v) => {
                    setFollowUpEnabled(!!v);
                    if (!v) {
                      setFollowUpDateStr(null);
                      setFollowUpQuick(null);
                      setErrors((e) => ({ ...e, followUpDate: "" }));
                    }
                  }}
                  data-testid="followup-enabled-checkbox"
                />
                <span className="text-caption text-foreground">
                  Create follow-up
                </span>
              </label>

              {followUpEnabled && (
                <div className="space-y-3">
                  <FormField>
                    <FormLabel>Follow-up Type</FormLabel>
                    <Select value={followUpType} onValueChange={setFollowUpType}>
                      <SelectTrigger className="h-[34px]" data-testid="followup-type-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FOLLOW_UP_TYPE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>

                  {/* Quick buttons */}
                  <div>
                    <div className="text-helper text-muted-foreground mb-1.5">
                      Follow-up in
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_FOLLOW_UP.map((q) => (
                        <Button
                          key={q.days}
                          type="button"
                          variant={followUpQuick === q.days ? "default" : "outline"}
                          size="sm"
                          className="h-[30px] px-[10px] text-helper"
                          onClick={() => applyQuickFollowUp(q.days)}
                          data-testid={`followup-quick-${q.days}`}
                        >
                          {q.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <FormField>
                    <FormLabel required>Follow-up Date</FormLabel>
                    <CanonicalDatePicker
                      value={followUpDateStr}
                      onChange={handleFollowUpDateChange}
                      placeholder="Pick date"
                      className="h-[34px] w-[170px]"
                      data-testid="followup-date-picker"
                    />
                    {errors.followUpDate && (
                      <FormErrorText>{errors.followUpDate}</FormErrorText>
                    )}
                  </FormField>
                </div>
              )}
            </div>
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <ModalSecondaryAction
          className="w-[82px] h-9 rounded-lg"
          onClick={() => onOpenChange(false)}
          data-testid="contact-client-cancel"
        >
          Cancel
        </ModalSecondaryAction>
        <ModalPrimaryAction
          className="w-[164px] h-9 rounded-lg"
          onClick={handleSave}
          disabled={!isFormValid || mutation.isPending}
          data-testid="contact-client-save"
        >
          Save Communication
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}
