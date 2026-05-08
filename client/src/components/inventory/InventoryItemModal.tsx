/**
 * InventoryItemModal — Create / Edit item (2026-05-08 foundation).
 *
 * Composes canonical primitives only:
 *   - <ModalShell> + <ModalHeader> + <ModalTitle> + <ModalBody> + <ModalFooter>
 *   - <FormField> + <FormLabel> + <FormHelperText> + <FormErrorText>
 *   - <FormSection> + <FormRow>
 *   - canonical <Input> / <Textarea> / <Select> / <Switch>
 *
 * Business rules enforced client-side (server is the source of truth):
 *   - Service items cannot have trackInventory=true. The toggle is
 *     disabled when type === "service".
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
  FormHelperText,
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
import type { InventoryItemRow } from "@/lib/inventory/types";

interface InventoryItemModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When non-null, the modal renders in edit mode. */
  editing?: InventoryItemRow | null;
}

interface ItemFormState {
  type: "product" | "service";
  name: string;
  sku: string;
  model: string;
  category: string;
  description: string;
  cost: string;
  unitPrice: string;
  isTaxable: boolean;
  trackInventory: boolean;
  isActive: boolean;
}

function emptyForm(): ItemFormState {
  return {
    type: "product",
    name: "",
    sku: "",
    model: "",
    category: "",
    description: "",
    cost: "",
    unitPrice: "",
    isTaxable: true,
    trackInventory: false,
    isActive: true,
  };
}

function fromRow(row: InventoryItemRow): ItemFormState {
  return {
    type: (row.type as "product" | "service") ?? "product",
    name: row.name ?? "",
    sku: row.sku ?? "",
    model: row.model ?? "",
    category: row.category ?? "",
    description: row.description ?? "",
    cost: row.cost ?? "",
    unitPrice: row.unitPrice ?? "",
    isTaxable: row.isTaxable ?? true,
    trackInventory: row.trackInventory,
    isActive: row.isActive ?? true,
  };
}

export function InventoryItemModal({
  open,
  onOpenChange,
  editing,
}: InventoryItemModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ItemFormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  // Reset form on every open / edit-target change so stale state from
  // a prior session never leaks.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(editing ? fromRow(editing) : emptyForm());
  }, [open, editing]);

  // Service items can never track inventory — auto-clear if user flips type.
  useEffect(() => {
    if (form.type === "service" && form.trackInventory) {
      setForm((f) => ({ ...f, trackInventory: false }));
    }
  }, [form.type, form.trackInventory]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        type: form.type,
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        model: form.model.trim() || null,
        category: form.category.trim() || null,
        description: form.description.trim() || null,
        cost: form.cost.trim() || null,
        unitPrice: form.unitPrice.trim() || null,
        isTaxable: form.isTaxable,
        trackInventory: form.type === "service" ? false : form.trackInventory,
        isActive: form.isActive,
      };
      const url = editing
        ? `/api/inventory/items/${editing.id}`
        : "/api/inventory/items";
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
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/items"] });
      toast({
        title: editing ? "Item updated" : "Item created",
      });
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit() {
    if (!form.name.trim()) {
      setError("Item name is required.");
      return;
    }
    mutation.mutate();
  }

  return (
    <ModalShell open={open} onOpenChange={onOpenChange} className="sm:max-w-[560px]" data-testid="inventory-item-modal">
      <ModalHeader>
        <ModalTitle>{editing ? "Edit Item" : "Create Item"}</ModalTitle>
        <ModalDescription>
          {editing
            ? "Update item identity, pricing, and inventory tracking."
            : "Add a product or service to your catalog."}
        </ModalDescription>
      </ModalHeader>

      <ModalBody className="space-y-4">
        <FormSection title="Identity">
          <FormRow className="grid-cols-2">
            <FormField>
              <FormLabel htmlFor="inv-item-type">Type</FormLabel>
              <Select
                value={form.type}
                onValueChange={(v) => setForm({ ...form, type: v as "product" | "service" })}
              >
                <SelectTrigger id="inv-item-type" data-testid="inventory-item-type-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="product">Product</SelectItem>
                  <SelectItem value="service">Service</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField>
              <FormLabel htmlFor="inv-item-category" srOnly>
                Category
              </FormLabel>
              <Input
                id="inv-item-category"
                placeholder="Category"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                data-testid="inventory-item-category-input"
              />
            </FormField>
          </FormRow>

          <FormField>
            <FormLabel htmlFor="inv-item-name" required>Name</FormLabel>
            <Input
              id="inv-item-name"
              placeholder="Item name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              data-testid="inventory-item-name-input"
            />
          </FormField>

          <FormRow className="grid-cols-2">
            <FormField>
              <FormLabel htmlFor="inv-item-sku" srOnly>SKU</FormLabel>
              <Input
                id="inv-item-sku"
                placeholder="SKU"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                data-testid="inventory-item-sku-input"
              />
            </FormField>
            <FormField>
              <FormLabel htmlFor="inv-item-model" srOnly>Model</FormLabel>
              <Input
                id="inv-item-model"
                placeholder="Model number"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                data-testid="inventory-item-model-input"
              />
            </FormField>
          </FormRow>

          <FormField>
            <FormLabel htmlFor="inv-item-description" srOnly>Description</FormLabel>
            <Textarea
              id="inv-item-description"
              placeholder="Description"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              data-testid="inventory-item-description-input"
            />
          </FormField>
        </FormSection>

        <FormSection title="Pricing">
          <FormRow className="grid-cols-2">
            <FormField>
              <FormLabel htmlFor="inv-item-cost" srOnly>Unit Cost</FormLabel>
              <Input
                id="inv-item-cost"
                type="number"
                step="0.01"
                min="0"
                placeholder="Unit cost"
                value={form.cost}
                onChange={(e) => setForm({ ...form, cost: e.target.value })}
                data-testid="inventory-item-cost-input"
              />
            </FormField>
            <FormField>
              <FormLabel htmlFor="inv-item-price" srOnly>Unit Price</FormLabel>
              <Input
                id="inv-item-price"
                type="number"
                step="0.01"
                min="0"
                placeholder="Unit price"
                value={form.unitPrice}
                onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
                data-testid="inventory-item-price-input"
              />
            </FormField>
          </FormRow>
        </FormSection>

        <FormSection title="Settings">
          <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-card px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium">Taxable</div>
              <div className="text-xs text-muted-foreground">Apply tax when this item is sold.</div>
            </div>
            <Switch
              checked={form.isTaxable}
              onCheckedChange={(v) => setForm({ ...form, isTaxable: Boolean(v) })}
              data-testid="inventory-item-taxable-toggle"
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-card px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium">Track Inventory</div>
              <div className="text-xs text-muted-foreground">
                {form.type === "service"
                  ? "Service items cannot track inventory."
                  : "Surface this item in stock counts, transfers, and adjustments."}
              </div>
            </div>
            <Switch
              checked={form.trackInventory}
              disabled={form.type === "service"}
              onCheckedChange={(v) => setForm({ ...form, trackInventory: Boolean(v) })}
              data-testid="inventory-item-track-toggle"
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-card px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium">Active</div>
              <div className="text-xs text-muted-foreground">
                Inactive items are hidden from new quotes / invoices.
              </div>
            </div>
            <Switch
              checked={form.isActive}
              onCheckedChange={(v) => setForm({ ...form, isActive: Boolean(v) })}
              data-testid="inventory-item-active-toggle"
            />
          </div>
        </FormSection>

        {error && <FormErrorText data-testid="inventory-item-error">{error}</FormErrorText>}
      </ModalBody>

      <ModalFooter>
        <ModalSecondaryAction onClick={() => onOpenChange(false)} data-testid="inventory-item-cancel">
          Cancel
        </ModalSecondaryAction>
        <ModalPrimaryAction
          onClick={handleSubmit}
          disabled={mutation.isPending}
          data-testid="inventory-item-save"
        >
          {mutation.isPending
            ? editing
              ? "Saving..."
              : "Creating..."
            : editing
              ? "Save Changes"
              : "Create Item"}
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}
