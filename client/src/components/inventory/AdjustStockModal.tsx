/**
 * AdjustStockModal — adjust stock at a single location.
 * (2026-05-08 foundation).
 *
 * Posts to POST /api/inventory/adjustments. Positive delta = stock IN
 * (to_location_id = locationId); negative delta = stock OUT
 * (from_location_id = locationId). Same-tx invariant as transfers.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  FormSection,
  FormRow,
  FormHelperText,
} from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { InventoryLocation, ItemLocationStock } from "@/lib/inventory/types";

interface AdjustStockModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string | null;
  /** Phase-2 contextual prefill. Set when the modal is opened from a
   *  surface that already implies a location (location rail, location
   *  inventory row). Reset on close. */
  prefillLocationId?: string | null;
}

type AdjustDirection = "in" | "out";

const REASON_OPTIONS: { value: "adjustment" | "count_correction" | "initial" | "return"; label: string }[] = [
  { value: "adjustment", label: "Adjustment" },
  { value: "count_correction", label: "Count correction" },
  { value: "initial", label: "Initial stock" },
  { value: "return", label: "Return to stock" },
];

export function AdjustStockModal({
  open,
  onOpenChange,
  itemId,
  prefillLocationId,
}: AdjustStockModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [locationId, setLocationId] = useState("");
  const [direction, setDirection] = useState<AdjustDirection>("in");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<typeof REASON_OPTIONS[number]["value"]>("adjustment");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const locationsQuery = useQuery<{ rows: InventoryLocation[] }>({
    queryKey: ["/api/inventory/locations"],
    queryFn: async () => {
      const res = await fetch("/api/inventory/locations", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load locations (${res.status})`);
      return res.json();
    },
    enabled: open,
  });

  const stockQuery = useQuery<{ rows: ItemLocationStock[] }>({
    queryKey: ["/api/inventory/items", itemId, "locations"],
    queryFn: async () => {
      const res = await fetch(`/api/inventory/items/${itemId}/locations`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load item locations (${res.status})`);
      return res.json();
    },
    enabled: open && !!itemId,
  });

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLocationId(prefillLocationId ?? "");
    setDirection("in");
    setQuantity("");
    setReason("adjustment");
    setNotes("");
  }, [open, prefillLocationId]);

  const locations = locationsQuery.data?.rows ?? [];
  const stockByLoc = useMemo(() => {
    const m = new Map<string, ItemLocationStock>();
    for (const r of stockQuery.data?.rows ?? []) m.set(r.locationId, r);
    return m;
  }, [stockQuery.data]);
  const onHandHere = locationId
    ? Number(stockByLoc.get(locationId)?.onHandQuantity ?? "0")
    : null;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!itemId) throw new Error("No item selected.");
      const qty = Number(quantity);
      const signed = direction === "in" ? qty : -qty;
      const res = await fetch("/api/inventory/adjustments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId,
          locationId,
          deltaQuantity: String(signed),
          reason,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Adjustment failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/items", itemId] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/low-stock"] });
      toast({ title: "Stock adjusted" });
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit() {
    setError(null);
    if (!locationId) return setError("Pick a location.");
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return setError("Quantity must be greater than zero.");
    }
    if (direction === "out" && onHandHere != null && qty > onHandHere) {
      return setError(
        `Location only has ${onHandHere} on hand. Cannot remove more than what's there.`,
      );
    }
    mutation.mutate();
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-[480px]"
      data-testid="inventory-adjust-modal"
    >
      <ModalHeader>
        <ModalTitle>Adjust Stock</ModalTitle>
        <ModalDescription>
          Record a stock movement at a single location. Adds or removes
          quantity and writes an audit row.
        </ModalDescription>
      </ModalHeader>

      <ModalBody className="space-y-4">
        {!itemId ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-row text-slate-600" data-testid="inventory-adjust-no-item">
            Open an item first, then click Adjust Stock in its right rail.
          </div>
        ) : (
          <FormSection title="Adjustment">
            <FormField>
              <FormLabel htmlFor="inv-adj-location">Location</FormLabel>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger id="inv-adj-location" data-testid="inventory-adjust-location-select">
                  <SelectValue placeholder="Pick location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id} disabled={!l.isActive}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {onHandHere != null && (
                <FormHelperText>
                  Currently <span className="tabular-nums">{onHandHere}</span> on hand at this location.
                </FormHelperText>
              )}
            </FormField>

            <FormRow className="grid-cols-2">
              <FormField>
                <FormLabel htmlFor="inv-adj-direction">Direction</FormLabel>
                <Select value={direction} onValueChange={(v) => setDirection(v as AdjustDirection)}>
                  <SelectTrigger id="inv-adj-direction" data-testid="inventory-adjust-direction-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">Add stock (+)</SelectItem>
                    <SelectItem value="out">Remove stock (−)</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField>
                <FormLabel htmlFor="inv-adj-qty" required>Quantity</FormLabel>
                <Input
                  id="inv-adj-qty"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Quantity"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  data-testid="inventory-adjust-quantity-input"
                />
              </FormField>
            </FormRow>

            <FormField>
              <FormLabel htmlFor="inv-adj-reason">Reason</FormLabel>
              <Select value={reason} onValueChange={(v) => setReason(v as typeof reason)}>
                <SelectTrigger id="inv-adj-reason" data-testid="inventory-adjust-reason-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASON_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField>
              <FormLabel htmlFor="inv-adj-notes" srOnly>Notes</FormLabel>
              <Textarea
                id="inv-adj-notes"
                placeholder="Notes (optional)"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                data-testid="inventory-adjust-notes-input"
              />
            </FormField>
          </FormSection>
        )}

        {error && <FormErrorText data-testid="inventory-adjust-error">{error}</FormErrorText>}
      </ModalBody>

      <ModalFooter>
        <ModalSecondaryAction onClick={() => onOpenChange(false)} data-testid="inventory-adjust-cancel">
          Cancel
        </ModalSecondaryAction>
        <ModalPrimaryAction
          onClick={handleSubmit}
          disabled={!itemId || mutation.isPending}
          data-testid="inventory-adjust-save"
        >
          {mutation.isPending ? "Saving..." : "Save Adjustment"}
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}
