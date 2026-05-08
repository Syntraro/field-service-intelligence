/**
 * TransferStockModal — move stock between two locations.
 * (2026-05-08 foundation).
 *
 * Posts to POST /api/inventory/transfers. The server runs the transfer
 * inside a single tx (inventory_transactions row + both quantity rows
 * update together) and rejects insufficient-stock / inactive-location /
 * service-item / non-stock-item / same-location attempts with a
 * structured 400.
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

interface TransferStockModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Item to transfer. When null the modal shows an "Open an item first"
   *  empty state — this happens when the action is fired without a
   *  selected item. */
  itemId: string | null;
  /** Phase-2 contextual prefill. Each is applied on open + reset on
   *  close. Source location prefill comes from the location rail; item
   *  prefill comes from the item rail; both come from a per-location
   *  inventory row. Goal: minimize clicks for day-to-day field-service
   *  inventory workflows. */
  prefillFromLocationId?: string | null;
  prefillToLocationId?: string | null;
}

export function TransferStockModal({
  open,
  onOpenChange,
  itemId,
  prefillFromLocationId,
  prefillToLocationId,
}: TransferStockModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
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

  // Reset state every open and apply contextual prefill.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setFromLocationId(prefillFromLocationId ?? "");
    setToLocationId(prefillToLocationId ?? "");
    setQuantity("");
    setNotes("");
  }, [open, prefillFromLocationId, prefillToLocationId]);

  const locations = locationsQuery.data?.rows ?? [];
  const stockByLoc = useMemo(() => {
    const m = new Map<string, ItemLocationStock>();
    for (const r of stockQuery.data?.rows ?? []) m.set(r.locationId, r);
    return m;
  }, [stockQuery.data]);

  const fromOnHand = fromLocationId
    ? Number(stockByLoc.get(fromLocationId)?.onHandQuantity ?? "0")
    : null;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!itemId) throw new Error("No item selected.");
      const res = await fetch("/api/inventory/transfers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId,
          fromLocationId,
          toLocationId,
          quantity: quantity.trim(),
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Transfer failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/items", itemId] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/low-stock"] });
      toast({ title: "Stock transferred" });
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit() {
    setError(null);
    if (!fromLocationId) return setError("Pick a source location.");
    if (!toLocationId) return setError("Pick a destination location.");
    if (fromLocationId === toLocationId) {
      return setError("Source and destination must differ.");
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return setError("Quantity must be greater than zero.");
    }
    if (fromOnHand != null && qty > fromOnHand) {
      return setError(
        `Source location only has ${fromOnHand} on hand. Transfer at most that.`,
      );
    }
    mutation.mutate();
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-[480px]"
      data-testid="inventory-transfer-modal"
    >
      <ModalHeader>
        <ModalTitle>Transfer Stock</ModalTitle>
        <ModalDescription>
          Move stock from one location to another. Both quantity rows and
          the audit log update together.
        </ModalDescription>
      </ModalHeader>

      <ModalBody className="space-y-4">
        {!itemId ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-row text-slate-600" data-testid="inventory-transfer-no-item">
            Open an item first, then click Make Transfer in its right rail.
          </div>
        ) : (
          <>
            <FormSection title="Movement">
              <FormRow className="grid-cols-2">
                <FormField>
                  <FormLabel htmlFor="inv-tx-from">From</FormLabel>
                  <Select value={fromLocationId} onValueChange={setFromLocationId}>
                    <SelectTrigger id="inv-tx-from" data-testid="inventory-transfer-from-select">
                      <SelectValue placeholder="Pick source" />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((l) => (
                        <SelectItem key={l.id} value={l.id} disabled={!l.isActive}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField>
                  <FormLabel htmlFor="inv-tx-to">To</FormLabel>
                  <Select value={toLocationId} onValueChange={setToLocationId}>
                    <SelectTrigger id="inv-tx-to" data-testid="inventory-transfer-to-select">
                      <SelectValue placeholder="Pick destination" />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((l) => (
                        <SelectItem
                          key={l.id}
                          value={l.id}
                          disabled={!l.isActive || l.id === fromLocationId}
                        >
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              </FormRow>

              <FormField>
                <FormLabel htmlFor="inv-tx-qty" required>Quantity</FormLabel>
                <Input
                  id="inv-tx-qty"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Quantity"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  data-testid="inventory-transfer-quantity-input"
                />
                {fromOnHand != null && (
                  <p className="text-xs text-muted-foreground">
                    Source has <span className="tabular-nums">{fromOnHand}</span> on hand.
                  </p>
                )}
              </FormField>

              <FormField>
                <FormLabel htmlFor="inv-tx-notes" srOnly>Notes</FormLabel>
                <Textarea
                  id="inv-tx-notes"
                  placeholder="Notes (optional)"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  data-testid="inventory-transfer-notes-input"
                />
              </FormField>
            </FormSection>
          </>
        )}

        {error && <FormErrorText data-testid="inventory-transfer-error">{error}</FormErrorText>}
      </ModalBody>

      <ModalFooter>
        <ModalSecondaryAction onClick={() => onOpenChange(false)} data-testid="inventory-transfer-cancel">
          Cancel
        </ModalSecondaryAction>
        <ModalPrimaryAction
          onClick={handleSubmit}
          disabled={!itemId || mutation.isPending}
          data-testid="inventory-transfer-save"
        >
          {mutation.isPending ? "Transferring..." : "Transfer Stock"}
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}
