/**
 * PmBillingFields — Shared optional PM billing section (model, label, contract amount).
 * Used by PM Create wizard and PM Edit page.
 * All fields are optional — a PM can be created/saved without billing.
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PmBillingFieldsProps {
  billingModel: string;
  billingLabel: string;
  contractAmount: string;
  onBillingModelChange: (v: string) => void;
  onBillingLabelChange: (v: string) => void;
  onContractAmountChange: (v: string) => void;
  testIdPrefix?: string;
}

export function PmBillingFields({
  billingModel,
  billingLabel,
  contractAmount,
  onBillingModelChange,
  onBillingLabelChange,
  onContractAmountChange,
  testIdPrefix = "pm",
}: PmBillingFieldsProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Billing model</Label>
        <Select
          value={billingModel || "none"}
          onValueChange={(v) => onBillingModelChange(v === "none" ? "" : v)}
        >
          <SelectTrigger data-testid={`${testIdPrefix}-billing-model`}>
            <SelectValue placeholder="Not set" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Not set</SelectItem>
            <SelectItem value="per_visit">Per Visit — Invoice each completed job</SelectItem>
            <SelectItem value="monthly_fixed">Monthly Fixed — Covered by monthly contract</SelectItem>
            <SelectItem value="annual_prepaid">Annual Prepaid — Covered by annual contract</SelectItem>
            <SelectItem value="do_not_bill">Do Not Bill — No invoice expected</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Determines how PM jobs are billed at completion. This is stamped onto each generated job.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Billing label (optional)</Label>
          <Input
            value={billingLabel}
            onChange={(e) => onBillingLabelChange(e.target.value)}
            placeholder="e.g. Quarterly RTU PM"
            data-testid={`${testIdPrefix}-billing-label`}
          />
        </div>
        <div className="space-y-2">
          <Label>Contract amount (optional)</Label>
          <Input
            type="number"
            step="0.01"
            value={contractAmount}
            onChange={(e) => onContractAmountChange(e.target.value)}
            placeholder="0.00"
            data-testid={`${testIdPrefix}-contract-amount`}
          />
        </div>
      </div>
    </div>
  );
}
