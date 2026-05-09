/**
 * ReserveInventoryModal — reserve stock at a location for future work.
 * (2026-05-08 — Inventory Phase 5.)
 *
 * Reservations bump inventory_quantities.reserved_quantity (which the
 * server already nets out of available = on_hand − reserved). They do
 * NOT physically move stock — that only happens when consumeForJob
 * pulls against a matching active reservation.
 *
 * Composes canonical primitives only:
 *   - <ModalShell> + <ModalHeader> + <ModalTitle> + <ModalBody> + <ModalFooter>
 *   - <FormField> + <FormLabel> + <FormHelperText> + <FormErrorText>
 *   - <FormSection>
 *   - canonical <Input> + <Textarea> + <Select>
 *
 * Server-side enforcement is the authoritative gate (Phase 5
 * reserveInventory validates type=product + trackInventory + active
 * location + sufficient AVAILABILITY); the client mirrors the
 * availability check for fast feedback.
 *
 * Operational prefill: surfaces that already imply an item / location /
 * job pass prefill props so the user starts as close to "click submit"
 * as possible.
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

interface ReserveInventoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional job linkage. When set, the modal POSTs to
   *  /api/inventory/jobs/:jobId/reservations and the URL job id wins
   *  over the body. When null, the modal POSTs to the ad-hoc
   *  /api/inventory/reservations endpoint. */
  jobId?: string | null;
  prefillItemId?: string | null;
  prefillLocationId?: string | null;
  prefillLineItemId?: string | null;
  prefillQuantity?: string | null;
}

export function ReserveInventoryModal({
  open,
  onOpenChange,
  jobId,
  prefillItemId,
  prefillLocationId,
  prefillLineItemId,
  prefillQuantity,
}: ReserveInventoryModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [itemId, setItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

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
  // available quantity inline + to enforce the over-reserve guard.
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
    setItemId(prefillItemId ?? "");
    setLocationId(prefillLocationId ?? "");
    setQuantity(prefillQuantity ?? "");
    setNotes("");
  }, [open, prefillItemId, prefillLocationId, prefillQuantity]);

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
      const url = jobId
        ? `/api/inventory/jobs/${jobId}/reservations`
        : "/api/inventory/reservations";
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId,
          locationId,
          quantity: quantity.trim(),
          notes: notes.trim() || null,
          jobId: jobId ?? null,
          lineItemId: prefillLineItemId ?? null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Reservation failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      // Phase 5 invalidation set: every surface that displays
      // availability, reservations, or low-stock counts.
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/items", itemId] });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/items", itemId, "locations"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/items", itemId, "reservations"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/locations", locationId, "inventory"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/locations", locationId, "reservations"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/inventory/locations", "with-aggregates"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/low-stock"] });
      if (jobId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/inventory/jobs", jobId, "reservations"],
        });
      }
      toast({ title: "Inventory reserved" });
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit() {
    setError(null);
    if (!itemId) return setError("Pick a stock item.");
    if (!locationId) return setError("Pick a location.");
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return setError("Quantity must be greater than zero.");
    }
    if (availableHere != null && qty > availableHere) {
      return setError(
        `Only ${availableHere > 0 ? availableHere : 0} available to reserve at this location after existing reservations.`,
      );
    }
    mutation.mutate();
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-[480px]"
      data-testid="reserve-inventory-modal"
    >
      <ModalHeader>
        <ModalTitle>Reserve Inventory</ModalTitle>
        <ModalDescription>
          Hold stock at a location for future work. Available stock at the
          location is reduced immediately, but no quantity moves until the
          reservation is consumed.
        </ModalDescription>
      </ModalHeader>

      <ModalBody className="space-y-4">
        <FormSection title="What to reserve">
          <FormField>
            <FormLabel htmlFor="reserve-inv-item">Item</FormLabel>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger
                id="reserve-inv-item"
                data-testid="reserve-inventory-item-select"
              >
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
            <FormLabel htmlFor="reserve-inv-loc">Location</FormLabel>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger
                id="reserve-inv-loc"
                data-testid="reserve-inventory-location-select"
              >
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
                <span className="tabular-nums">{availableHere}</span> available
                to reserve at this location.
              </FormHelperText>
            )}
          </FormField>

          <FormField>
            <FormLabel htmlFor="reserve-inv-qty" required>
              Quantity
            </FormLabel>
            <Input
              id="reserve-inv-qty"
              type="number"
              min="0"
              step="any"
              placeholder="Quantity"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              data-testid="reserve-inventory-quantity-input"
            />
          </FormField>

          <FormField>
            <FormLabel htmlFor="reserve-inv-notes" srOnly>
              Notes
            </FormLabel>
            <Textarea
              id="reserve-inv-notes"
              placeholder="Notes (optional)"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              data-testid="reserve-inventory-notes-input"
            />
          </FormField>
        </FormSection>

        {error && (
          <FormErrorText data-testid="reserve-inventory-error">
            {error}
          </FormErrorText>
        )}
      </ModalBody>

      <ModalFooter>
        <ModalSecondaryAction
          onClick={() => onOpenChange(false)}
          data-testid="reserve-inventory-cancel"
        >
          Cancel
        </ModalSecondaryAction>
        <ModalPrimaryAction
          onClick={handleSubmit}
          disabled={mutation.isPending}
          data-testid="reserve-inventory-save"
        >
          {mutation.isPending ? "Saving..." : "Reserve"}
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}
