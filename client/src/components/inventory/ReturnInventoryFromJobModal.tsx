/**
 * ReturnInventoryFromJobModal — return part of a previously-consumed
 * quantity back to its source location.
 * (2026-05-08 — Inventory Phase 3.)
 *
 * Returns ALWAYS attach to a parent consumption row. The destination
 * location + the unit cost snapshot come from the parent — the user
 * chooses only the quantity to return + optional notes. The server
 * validates `quantity <= remainingReturnable(parent)`.
 */

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
  ModalPrimaryAction,
  ModalSecondaryAction,
} from "@/components/ui/modal";
import {
  FormField,
  FormLabel,
  FormErrorText,
  FormHelperText,
  FormSection,
} from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { JobInventoryUsageRow } from "@/lib/inventory/types";

interface ReturnInventoryFromJobModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  /** The parent consumption row to return against. Set by the page
   *  when the user clicks "Return" on a specific row. The modal
   *  computes the remaining returnable from this row + its existing
   *  child returns (passed from the parent so the modal doesn't have
   *  to refetch). */
  parent: JobInventoryUsageRow | null;
  /** Total quantity already returned against `parent` (sum of child
   *  return rows). The modal exposes the remaining capacity inline. */
  alreadyReturned: number;
}

export function ReturnInventoryFromJobModal({
  open,
  onOpenChange,
  jobId,
  parent,
  alreadyReturned,
}: ReturnInventoryFromJobModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setQuantity("");
    setNotes("");
  }, [open]);

  const remaining = parent ? Number(parent.quantity) - alreadyReturned : 0;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!parent) throw new Error("No usage row selected.");
      const res = await fetch(
        `/api/inventory/jobs/${jobId}/usage/${parent.id}/return`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quantity: quantity.trim(),
            notes: notes.trim() || null,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Return failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      if (!parent) return;
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/items"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/items", parent.itemId],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/items", parent.itemId, "locations"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/items", parent.itemId, "transactions"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/items", parent.itemId, "recent-usage"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/locations", parent.locationId, "inventory"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/locations", parent.locationId, "transactions"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/locations", parent.locationId, "recent-usage"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/locations", "with-aggregates"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/low-stock"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/jobs", jobId, "usage"],
      });
      toast({ title: "Inventory returned to stock" });
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit() {
    setError(null);
    if (!parent) return setError("No row selected.");
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return setError("Quantity must be greater than zero.");
    }
    if (qty > remaining) {
      return setError(
        `Cannot return more than ${remaining} — that's the remaining un-returned quantity from the original consumption.`,
      );
    }
    mutation.mutate();
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-[440px]"
      data-testid="return-inventory-from-job-modal"
    >
      <ModalHeader>
        <ModalTitle>Return Inventory</ModalTitle>
        <ModalDescription>
          Return part of this consumption back to its source location.
          Returns reuse the original consumption's unit cost so the
          job's net cost reconciles cleanly.
        </ModalDescription>
      </ModalHeader>

      <ModalBody className="space-y-4">
        {parent ? (
          <FormSection title="What's returning">
            <div
              className="rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 text-row text-slate-700"
              data-testid="return-inventory-parent-summary"
            >
              <div className="font-medium text-slate-900">
                {parent.itemName ?? "Unnamed item"}
              </div>
              <div className="text-helper text-slate-500">
                Originally consumed {Number(parent.quantity)} from {parent.locationName} ·
                Already returned {alreadyReturned} · Remaining {remaining}
              </div>
            </div>

            <FormField>
              <FormLabel htmlFor="ret-inv-qty" required>
                Quantity to return
              </FormLabel>
              <Input
                id="ret-inv-qty"
                type="number"
                min="0"
                max={String(remaining)}
                step="any"
                placeholder="Quantity"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                data-testid="return-inventory-quantity-input"
              />
              <FormHelperText>
                Up to <span className="tabular-nums">{remaining}</span> remaining.
              </FormHelperText>
            </FormField>

            <FormField>
              <FormLabel htmlFor="ret-inv-notes" srOnly>
                Notes
              </FormLabel>
              <Textarea
                id="ret-inv-notes"
                placeholder="Notes (optional)"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                data-testid="return-inventory-notes-input"
              />
            </FormField>
          </FormSection>
        ) : (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-row text-slate-600" data-testid="return-inventory-no-parent">
            Pick a consumption row from the Inventory Usage section to return.
          </div>
        )}

        {error && (
          <FormErrorText data-testid="return-inventory-error">{error}</FormErrorText>
        )}
      </ModalBody>

      <ModalFooter>
        <ModalSecondaryAction
          onClick={() => onOpenChange(false)}
          data-testid="return-inventory-cancel"
        >
          Cancel
        </ModalSecondaryAction>
        <ModalPrimaryAction
          onClick={handleSubmit}
          disabled={!parent || mutation.isPending || remaining <= 0}
          data-testid="return-inventory-save"
        >
          {mutation.isPending ? "Saving..." : "Return to Stock"}
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}
