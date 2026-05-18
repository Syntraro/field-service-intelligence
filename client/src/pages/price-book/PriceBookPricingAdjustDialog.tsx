import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalFooter,
  ModalPrimaryAction,
  ModalSecondaryAction,
} from "@/components/ui/modal";

type PricingOp = "increase_pct" | "decrease_pct" | "set_markup_pct";

const OP_OPTIONS: { value: PricingOp; label: string; description: string }[] = [
  {
    value: "increase_pct",
    label: "Increase prices by %",
    description: "Increases unit price by the entered percentage. Items with no price are skipped.",
  },
  {
    value: "decrease_pct",
    label: "Decrease prices by %",
    description: "Decreases unit price by the entered percentage. Items with no price are skipped.",
  },
  {
    value: "set_markup_pct",
    label: "Set markup % (recompute from cost)",
    description: "Sets markup % and recomputes unit price from cost. Items without a cost are skipped.",
  },
];

interface PriceBookPricingAdjustDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  onSuccess: () => void;
}

export function PriceBookPricingAdjustDialog({
  open,
  onOpenChange,
  selectedIds,
  onSuccess,
}: PriceBookPricingAdjustDialogProps) {
  const { toast } = useToast();
  const [operation, setOperation] = useState<PricingOp>("increase_pct");
  const [value, setValue] = useState("");

  function handleClose() {
    onOpenChange(false);
    setValue("");
    setOperation("increase_pct");
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const num = parseFloat(value);
      if (isNaN(num) || num < 0) throw new Error("Invalid value");
      const body =
        operation === "set_markup_pct"
          ? { ids: selectedIds, operation: "set_markup_pct", markupPct: num }
          : {
              ids: selectedIds,
              operation: "adjust_price_pct",
              pctDelta: operation === "decrease_pct" ? -num : num,
            };
      return apiRequest<{ updatedCount: number }>("/api/items/bulk-update", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"], exact: false });
      toast({ title: `Updated pricing for ${data.updatedCount} item(s).` });
      handleClose();
      onSuccess();
    },
    onError: () =>
      toast({ title: "Error", description: "Failed to update pricing.", variant: "destructive" }),
  });

  const currentOp = OP_OPTIONS.find((o) => o.value === operation)!;
  const numValue = parseFloat(value);
  const canSubmit = value.trim() !== "" && !isNaN(numValue) && numValue >= 0 && !mutation.isPending;

  return (
    <ModalShell open={open} onOpenChange={(v) => { if (!v) handleClose(); }} className="max-w-sm">
      <ModalHeader>
        <ModalTitle>Adjust Pricing</ModalTitle>
        <ModalDescription>
          {selectedIds.length} item{selectedIds.length !== 1 ? "s" : ""} selected
        </ModalDescription>
      </ModalHeader>

      <div className="px-5 py-4 space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Operation</p>
          <div className="space-y-2">
            {OP_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="pricing-op"
                  value={opt.value}
                  checked={operation === opt.value}
                  onChange={() => setOperation(opt.value)}
                  className="mt-0.5 accent-primary"
                />
                <span className="text-sm leading-snug">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pricing-value" className="text-sm font-medium">
            Value (%)
          </Label>
          <div className="relative">
            <Input
              id="pricing-value"
              type="number"
              step="0.1"
              min="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. 10"
              className="pr-8"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">
              %
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            {currentOp.description}
          </p>
        </div>
      </div>

      <ModalFooter>
        <ModalSecondaryAction onClick={handleClose}>Cancel</ModalSecondaryAction>
        <ModalPrimaryAction onClick={() => mutation.mutate()} disabled={!canSubmit}>
          {mutation.isPending && (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" aria-hidden="true" />
          )}
          Apply to {selectedIds.length} item{selectedIds.length !== 1 ? "s" : ""}
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}
