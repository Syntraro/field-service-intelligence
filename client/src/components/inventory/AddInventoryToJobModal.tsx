/**
 * AddInventoryToJobModal — consume stock from a location onto a job.
 * (2026-05-08 — Inventory Phase 3.)
 *
 * Composes canonical primitives only:
 *   - <ModalShell> + <ModalHeader> + <ModalTitle> + <ModalBody> + <ModalFooter>
 *   - <FormField> + <FormLabel> + <FormHelperText> + <FormErrorText>
 *   - <FormSection>
 *   - canonical <Input> + <Textarea> + <Select>
 *
 * Server-side enforcement is the authoritative gate (the storage
 * service validates type=product + trackInventory + active location +
 * sufficient stock); the client does the same checks for fast feedback.
 *
 * Operational prefill: when the modal is opened from a context that
 * already implies an item or location (item rail, location rail,
 * location-inventory row) the page passes prefill props so the user
 * starts as close to "click submit" as possible.
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
  FormHelperText,
  FormSection,
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
import type {
  InventoryItemRow,
  InventoryLocation,
  ItemLocationStock,
} from "@/lib/inventory/types";

interface AddInventoryToJobModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  /** Optional contextual prefill — set when launched from a surface
   *  that already implies an item / location. Reset on close. */
  prefillItemId?: string | null;
  prefillLocationId?: string | null;
}

export function AddInventoryToJobModal({
  open,
  onOpenChange,
  jobId,
  prefillItemId,
  prefillLocationId,
}: AddInventoryToJobModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [itemId, setItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Server-side filtered: stockOnly=true returns only product +
  // trackInventory + active items so the picker can never offer a
  // selection the server would reject.
  const itemsQuery = useQuery<{ items: InventoryItemRow[] }>({
    queryKey: ["/api/inventory/items", "stockOnly"],
    queryFn: async () => {
      const res = await fetch("/api/inventory/items?stockOnly=true", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load stock items (${res.status})`);
      return res.json();
    },
    enabled: open,
  });

  const locationsQuery = useQuery<{ rows: InventoryLocation[] }>({
    queryKey: ["/api/inventory/locations"],
    queryFn: async () => {
      const res = await fetch("/api/inventory/locations", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load locations (${res.status})`);
      return res.json();
    },
    enabled: open,
  });

  // Per-(item, location) stock rows for the active item, used to show
  // available quantity inline + to enforce the insufficient-stock guard.
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

  // Reset + apply prefill on every open.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setItemId(prefillItemId ?? "");
    setLocationId(prefillLocationId ?? "");
    setQuantity("");
    setNotes("");
  }, [open, prefillItemId, prefillLocationId]);

  const items = itemsQuery.data?.items ?? [];
  const locations = locationsQuery.data?.rows ?? [];

  const stockByLocation = useMemo(() => {
    const m = new Map<string, ItemLocationStock>();
    for (const r of stockQuery.data?.rows ?? []) m.set(r.locationId, r);
    return m;
  }, [stockQuery.data]);

  const availableHere = locationId
    ? Number(stockByLocation.get(locationId)?.availableQuantity ?? "0")
    : null;

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/inventory/jobs/${jobId}/usage`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId,
          locationId,
          quantity: quantity.trim(),
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Consume failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      // Phase-3 invalidation set: every surface that displays a
      // quantity, a low-stock count, or a usage row is invalidated.
      // The server is the source of truth; React Query refetches in
      // parallel.
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/items", itemId] });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/items", itemId, "locations"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/items", itemId, "transactions"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/items", itemId, "recent-usage"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/locations", locationId, "inventory"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/locations", locationId, "transactions"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/locations", locationId, "recent-usage"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/locations", "with-aggregates"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/low-stock"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/jobs", jobId, "usage"],
      });
      toast({ title: "Inventory added to job" });
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit() {
    setError(null);
    if (!itemId) return setError("Pick a stock item.");
    if (!locationId) return setError("Pick a source location.");
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return setError("Quantity must be greater than zero.");
    }
    if (availableHere != null && qty > availableHere) {
      return setError(
        `Source location only has ${availableHere} available. Reduce the quantity.`,
      );
    }
    mutation.mutate();
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-[480px]"
      data-testid="add-inventory-to-job-modal"
    >
      <ModalHeader>
        <ModalTitle>Add Inventory</ModalTitle>
        <ModalDescription>
          Consume stock from a location onto this job. The unit cost is
          snapshotted at the moment you save — later changes to the
          item's cost will not change this job's totals.
        </ModalDescription>
      </ModalHeader>

      <ModalBody className="space-y-4">
        <FormSection title="What was used">
          <FormField>
            <FormLabel htmlFor="add-inv-item">Item</FormLabel>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger id="add-inv-item" data-testid="add-inventory-item-select">
                <SelectValue placeholder="Pick an item" />
              </SelectTrigger>
              <SelectContent>
                {items.length === 0 && (
                  <SelectItem value="__empty__" disabled>
                    No stock items found
                  </SelectItem>
                )}
                {items.map((it) => (
                  <SelectItem key={it.id} value={it.id}>
                    {it.name ?? "Unnamed item"}
                    {it.sku ? ` · ${it.sku}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormHelperText>
              Only product items with inventory tracking enabled appear here.
            </FormHelperText>
          </FormField>

          <FormField>
            <FormLabel htmlFor="add-inv-loc">Source location</FormLabel>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger id="add-inv-loc" data-testid="add-inventory-location-select">
                <SelectValue placeholder="Pick a location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id} disabled={!l.isActive}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableHere != null && (
              <FormHelperText>
                <span className="tabular-nums">{availableHere}</span> available at this location.
              </FormHelperText>
            )}
          </FormField>

          <FormField>
            <FormLabel htmlFor="add-inv-qty" required>
              Quantity
            </FormLabel>
            <Input
              id="add-inv-qty"
              type="number"
              min="0"
              step="any"
              placeholder="Quantity"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              data-testid="add-inventory-quantity-input"
            />
          </FormField>

          <FormField>
            <FormLabel htmlFor="add-inv-notes" srOnly>
              Notes
            </FormLabel>
            <Textarea
              id="add-inv-notes"
              placeholder="Notes (optional)"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              data-testid="add-inventory-notes-input"
            />
          </FormField>
        </FormSection>

        {error && <FormErrorText data-testid="add-inventory-error">{error}</FormErrorText>}
      </ModalBody>

      <ModalFooter>
        <ModalSecondaryAction
          onClick={() => onOpenChange(false)}
          data-testid="add-inventory-cancel"
        >
          Cancel
        </ModalSecondaryAction>
        <ModalPrimaryAction
          onClick={handleSubmit}
          disabled={mutation.isPending}
          data-testid="add-inventory-save"
        >
          {mutation.isPending ? "Saving..." : "Add to Job"}
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}
