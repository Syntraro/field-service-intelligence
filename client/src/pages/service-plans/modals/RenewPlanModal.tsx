import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
  FormErrorText,
  InlineInput,
  InlineTextarea,
} from "@/components/ui/form-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { RecurringPlanDetail } from "../ServicePlanActionsRail";

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function defaultNewEndDate(existing: string | null): string {
  if (existing) {
    const [y, m, d] = existing.split("-").map(Number);
    return `${y + 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const now = new Date();
  return `${now.getFullYear() + 1}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// ── RenewPlanModal ─────────────────────────────────────────────────────────────

interface RenewPlanModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: RecurringPlanDetail;
}

export function RenewPlanModal({ open, onOpenChange, plan }: RenewPlanModalProps) {
  const { toast } = useToast();
  const today = todayStr();

  const [endDate, setEndDate] = useState(() => defaultNewEndDate(plan.endDate));
  const [amount, setAmount] = useState(plan.pmContractAmount ?? "");
  const [notes, setNotes] = useState("");
  const [reactivate, setReactivate] = useState(!plan.isActive);
  const [errors, setErrors] = useState<{ endDate?: string; amount?: string }>({});

  // Reset state from current plan each time the modal opens.
  useEffect(() => {
    if (open) {
      setEndDate(defaultNewEndDate(plan.endDate));
      setAmount(plan.pmContractAmount ?? "");
      setNotes("");
      setReactivate(!plan.isActive);
      setErrors({});
    }
  }, [open, plan.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const validate = (): boolean => {
    const errs: { endDate?: string; amount?: string } = {};
    if (!endDate) {
      errs.endDate = "New end date is required.";
    } else if (endDate < today) {
      errs.endDate = "End date must be today or later.";
    } else if (plan.endDate && endDate <= plan.endDate) {
      errs.endDate = "New end date must be after the current contract end date.";
    }
    if (amount.trim() !== "" && (isNaN(Number(amount)) || Number(amount) < 0)) {
      errs.amount = "Amount must be a valid positive number.";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const renewMutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { endDate };
      if (amount.trim() !== "") body.pmContractAmount = amount.trim();
      // renewalNote is NOT the plan's notes column. The server reads it from
      // req.body before Zod validation (which strips unknown fields) and writes
      // it only into the logEvent meta — the plan notes column is never touched.
      if (notes.trim() !== "") body.renewalNote = notes.trim();
      // Reactivate if the plan is currently paused and the user opted in.
      // Phase 1B PATCH guard allows isActive=true once the effective endDate is future.
      if (reactivate && !plan.isActive) body.isActive = true;
      return apiRequest(`/api/recurring-templates/${plan.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates", plan.id] });
      queryClient.invalidateQueries({
        queryKey: ["/api/recurring-templates", plan.id, "instances"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/activity/other", plan.id] });
      const reactivated = reactivate && !plan.isActive;
      toast({
        title: "Contract renewed",
        description: `"${plan.title}" has been renewed${reactivated ? " and reactivated" : ""}.`,
      });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Renewal failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (validate()) renewMutation.mutate();
  };

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="max-w-md"
      data-testid="renew-plan-modal"
    >
      <ModalHeader>
        <ModalTitle>Renew Contract</ModalTitle>
        <ModalDescription>
          Extend the service agreement for &ldquo;{plan.title}&rdquo;.
        </ModalDescription>
      </ModalHeader>

      <ModalBody className="space-y-3">
        <FormField>
          <InlineInput
            id="renew-end-date"
            label="New End Date"
            required
            type="date"
            value={endDate}
            min={today}
            onChange={(e) => {
              setEndDate(e.target.value);
              if (errors.endDate) setErrors((p) => ({ ...p, endDate: undefined }));
            }}
            error={!!errors.endDate}
            data-testid="renew-end-date"
          />
          {errors.endDate && <FormErrorText>{errors.endDate}</FormErrorText>}
        </FormField>

        <FormField>
          <InlineInput
            id="renew-amount"
            label="Contract Amount"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              if (errors.amount) setErrors((p) => ({ ...p, amount: undefined }));
            }}
            error={!!errors.amount}
            data-testid="renew-amount"
          />
          {errors.amount && <FormErrorText>{errors.amount}</FormErrorText>}
        </FormField>

        <InlineTextarea
          id="renew-notes"
          label="Renewal Notes"
          placeholder="Optional notes about this renewal…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          data-testid="renew-notes"
        />

        {!plan.isActive && (
          <div className="flex items-center gap-2 pt-0.5">
            <Checkbox
              id="renew-reactivate"
              checked={reactivate}
              onCheckedChange={(checked) => setReactivate(checked === true)}
              data-testid="renew-reactivate"
            />
            <Label htmlFor="renew-reactivate" className="text-row cursor-pointer font-normal">
              Reactivate this plan
            </Label>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <ModalSecondaryAction
          onClick={() => onOpenChange(false)}
          disabled={renewMutation.isPending}
          data-testid="renew-cancel"
        >
          Cancel
        </ModalSecondaryAction>
        <ModalPrimaryAction
          onClick={handleSubmit}
          disabled={renewMutation.isPending}
          data-testid="renew-confirm"
        >
          {renewMutation.isPending ? "Renewing…" : "Renew Contract"}
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}
