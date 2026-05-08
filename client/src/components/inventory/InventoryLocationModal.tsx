/**
 * InventoryLocationModal — Create / Edit inventory location.
 * (2026-05-08 foundation).
 *
 * Same canonical primitives as InventoryItemModal. Address fields are
 * inlined matching the canonical client_locations shape (no separate
 * addresses table exists today).
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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import type { InventoryLocation, InventoryLocationType } from "@/lib/inventory/types";

const LOCATION_TYPE_OPTIONS: { value: InventoryLocationType; label: string }[] = [
  { value: "warehouse", label: "Warehouse" },
  { value: "vehicle", label: "Vehicle / Truck" },
  { value: "office", label: "Office" },
  { value: "storage", label: "Storage" },
  { value: "temporary", label: "Temporary" },
  { value: "other", label: "Other" },
];

interface InventoryLocationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: InventoryLocation | null;
}

interface LocationFormState {
  name: string;
  type: InventoryLocationType;
  isActive: boolean;
  address: string;
  address2: string;
  city: string;
  provinceState: string;
  postalCode: string;
  country: string;
  notes: string;
}

function emptyForm(): LocationFormState {
  return {
    name: "",
    type: "warehouse",
    isActive: true,
    address: "",
    address2: "",
    city: "",
    provinceState: "",
    postalCode: "",
    country: "",
    notes: "",
  };
}

function fromRow(row: InventoryLocation): LocationFormState {
  return {
    name: row.name,
    type: row.type as InventoryLocationType,
    isActive: row.isActive,
    address: row.address ?? "",
    address2: row.address2 ?? "",
    city: row.city ?? "",
    provinceState: row.provinceState ?? "",
    postalCode: row.postalCode ?? "",
    country: row.country ?? "",
    notes: row.notes ?? "",
  };
}

export function InventoryLocationModal({
  open,
  onOpenChange,
  editing,
}: InventoryLocationModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<LocationFormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(editing ? fromRow(editing) : emptyForm());
  }, [open, editing]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        isActive: form.isActive,
        address: form.address.trim() || null,
        address2: form.address2.trim() || null,
        city: form.city.trim() || null,
        provinceState: form.provinceState.trim() || null,
        postalCode: form.postalCode.trim() || null,
        country: form.country.trim() || null,
        notes: form.notes.trim() || null,
      };
      const url = editing
        ? `/api/inventory/locations/${editing.id}`
        : "/api/inventory/locations";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Request failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/locations"] });
      toast({ title: editing ? "Location updated" : "Location created" });
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit() {
    if (!form.name.trim()) {
      setError("Location name is required.");
      return;
    }
    mutation.mutate();
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-[520px]"
      data-testid="inventory-location-modal"
    >
      <ModalHeader>
        <ModalTitle>{editing ? "Edit Location" : "Create Location"}</ModalTitle>
        <ModalDescription>
          {editing
            ? "Update location identity, type, and address."
            : "Add a warehouse, vehicle, office, or other place stock lives."}
        </ModalDescription>
      </ModalHeader>

      <ModalBody className="space-y-4">
        <FormSection title="Identity">
          <FormRow className="grid-cols-2">
            <FormField>
              <FormLabel htmlFor="inv-loc-name" required>Name</FormLabel>
              <Input
                id="inv-loc-name"
                placeholder="Location name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                data-testid="inventory-location-name-input"
              />
            </FormField>
            <FormField>
              <FormLabel htmlFor="inv-loc-type">Type</FormLabel>
              <Select
                value={form.type}
                onValueChange={(v) => setForm({ ...form, type: v as InventoryLocationType })}
              >
                <SelectTrigger id="inv-loc-type" data-testid="inventory-location-type-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCATION_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </FormRow>
        </FormSection>

        <FormSection title="Address">
          <FormField>
            <FormLabel htmlFor="inv-loc-address" srOnly>Street address</FormLabel>
            <Input
              id="inv-loc-address"
              placeholder="Street address"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              data-testid="inventory-location-address-input"
            />
          </FormField>
          <FormField>
            <FormLabel htmlFor="inv-loc-address2" srOnly>Suite / unit</FormLabel>
            <Input
              id="inv-loc-address2"
              placeholder="Suite / unit (optional)"
              value={form.address2}
              onChange={(e) => setForm({ ...form, address2: e.target.value })}
              data-testid="inventory-location-address2-input"
            />
          </FormField>
          <FormRow className="grid-cols-3">
            <FormField>
              <FormLabel htmlFor="inv-loc-city" srOnly>City</FormLabel>
              <Input
                id="inv-loc-city"
                placeholder="City"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                data-testid="inventory-location-city-input"
              />
            </FormField>
            <FormField>
              <FormLabel htmlFor="inv-loc-province" srOnly>Province / state</FormLabel>
              <Input
                id="inv-loc-province"
                placeholder="Province / state"
                value={form.provinceState}
                onChange={(e) => setForm({ ...form, provinceState: e.target.value })}
                data-testid="inventory-location-province-input"
              />
            </FormField>
            <FormField>
              <FormLabel htmlFor="inv-loc-postal" srOnly>Postal code</FormLabel>
              <Input
                id="inv-loc-postal"
                placeholder="Postal code"
                value={form.postalCode}
                onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
                data-testid="inventory-location-postal-input"
              />
            </FormField>
          </FormRow>
        </FormSection>

        <FormSection title="Settings">
          <FormField>
            <FormLabel htmlFor="inv-loc-notes" srOnly>Notes</FormLabel>
            <Textarea
              id="inv-loc-notes"
              placeholder="Notes (optional)"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              data-testid="inventory-location-notes-input"
            />
          </FormField>
          <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-card px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium">Active</div>
              <div className="text-xs text-muted-foreground">
                Inactive locations are hidden from transfers and adjustments.
              </div>
            </div>
            <Switch
              checked={form.isActive}
              onCheckedChange={(v) => setForm({ ...form, isActive: Boolean(v) })}
              data-testid="inventory-location-active-toggle"
            />
          </div>
        </FormSection>

        {error && <FormErrorText data-testid="inventory-location-error">{error}</FormErrorText>}
      </ModalBody>

      <ModalFooter>
        <ModalSecondaryAction onClick={() => onOpenChange(false)} data-testid="inventory-location-cancel">
          Cancel
        </ModalSecondaryAction>
        <ModalPrimaryAction
          onClick={handleSubmit}
          disabled={mutation.isPending}
          data-testid="inventory-location-save"
        >
          {mutation.isPending
            ? editing
              ? "Saving..."
              : "Creating..."
            : editing
              ? "Save Changes"
              : "Create Location"}
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}
