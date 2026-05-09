import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FormField,
  FormLabel,
  FormRow,
  FormSection,
  FormErrorText,
} from "@/components/ui/form-field";
// 2026-05-06 Phase 1 modal canonicalization: swapped raw Dialog primitives
// for the canonical ModalShell + Modal* primitives per CLAUDE.md Modal
// Taxonomy rule #2 (generic / simple form modal). Body is a standard
// space-y form layout with intra-body `border-t pt-2` section separators
// (Pricing / Duration+Category / Checkboxes rows) — fits cleanly inside
// <ModalBody>. Width (`sm:max-w-[550px]`) + `overflow-visible` (lets the
// Type and Category Select dropdowns extend outside the modal) passed at
// the call-site per Modal Taxonomy rule #5.
// 2026-05-09 Phase 2C: migrated body from raw Label/div stacks to canonical
// FormField / FormLabel / FormRow / FormSection / FormErrorText. No behavior changes.
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
} from "@/components/ui/modal";
import { Loader2 } from "lucide-react";
import { Part, ProductFormData } from "./types";

interface ProductServiceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingProduct: Part | null;
  formData: ProductFormData;
  onFormDataChange: (data: ProductFormData) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  checkDuplicate: Part | null | undefined;
  /** Available category options for the category selector */
  uniqueCategories?: string[];
  /** Called when the user triggers archive/restore from inside the modal (edit mode only). */
  onArchiveClick?: () => void;
  /** Called when the user triggers delete from inside the modal (edit mode only). */
  onDeleteClick?: () => void;
}

export function ProductServiceFormDialog({
  open,
  onOpenChange,
  editingProduct,
  formData,
  onFormDataChange,
  onSave,
  onCancel,
  isSaving,
  checkDuplicate,
  uniqueCategories = [],
  onArchiveClick,
  onDeleteClick,
}: ProductServiceFormDialogProps) {
  const setField = <K extends keyof ProductFormData>(field: K, value: ProductFormData[K]) => {
    onFormDataChange({ ...formData, [field]: value });
  };

  const handleCostChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cost = parseFloat(e.target.value) || 0;
    const markup = parseFloat(formData.markupPercent) || 0;
    const calculatedPrice = markup > 0 ? (cost * (1 + markup / 100)).toFixed(2) : "";
    onFormDataChange({ ...formData, cost: e.target.value, unitPrice: calculatedPrice });
  };

  const handleMarkupChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const markup = parseFloat(e.target.value) || 0;
    const cost = parseFloat(formData.cost) || 0;
    const calculatedPrice = cost > 0 ? (cost * (1 + markup / 100)).toFixed(2) : "";
    onFormDataChange({ ...formData, markupPercent: e.target.value, unitPrice: calculatedPrice });
  };

  return (
    // 2026-05-06: width + overflow-visible passed at the call-site per
    // Modal Taxonomy rule #5. The `overflow-visible` is intentional —
    // the Type and Category Select dropdowns rely on it to extend
    // outside the modal's content area.
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-[550px] overflow-visible"
      data-testid="dialog-product"
    >
      <ModalHeader>
        <ModalTitle>{editingProduct ? "Edit Item" : "Add New Item"}</ModalTitle>
        <ModalDescription>
          {editingProduct ? "Update the item details." : "Create a new product or service."}
        </ModalDescription>
      </ModalHeader>

      <ModalBody className="space-y-3">
        {/* Row A: Type | SKU — Type is a Select so keeps visible label */}
        <FormRow className="grid-cols-2">
          <FormField>
            <FormLabel>Type *</FormLabel>
            <Select value={formData.type} onValueChange={(v: "service" | "product") => setField("type", v)}>
              <SelectTrigger data-testid="select-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="product">Product</SelectItem>
                <SelectItem value="service">Service</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField>
            <FormLabel htmlFor="ps-sku" srOnly>SKU</FormLabel>
            <Input
              id="ps-sku"
              value={formData.sku}
              onChange={(e) => setField("sku", e.target.value)}
              placeholder="SKU (e.g. HVAC-001)"
              data-testid="input-sku"
            />
          </FormField>
        </FormRow>

        {/* Row B: Name (full width) */}
        <FormField>
          <FormLabel htmlFor="ps-name" srOnly>Name</FormLabel>
          <Input
            id="ps-name"
            value={formData.name}
            onChange={(e) => setField("name", e.target.value)}
            placeholder="Name *"
            data-testid="input-name"
            className={checkDuplicate ? "border-destructive" : ""}
          />
          {checkDuplicate && (
            <FormErrorText>An item named "{checkDuplicate.name}" already exists</FormErrorText>
          )}
        </FormField>

        {/* Row C: Description (full width) */}
        <FormField>
          <FormLabel htmlFor="ps-description" srOnly>Description</FormLabel>
          <Textarea
            id="ps-description"
            value={formData.description}
            onChange={(e) => setField("description", e.target.value)}
            rows={2}
            data-testid="input-description"
          />
        </FormField>

        {/* Row D: Pricing section */}
        <FormSection title="Pricing" className="border-t pt-2">
          <FormRow className="grid-cols-3">
            <FormField>
              <FormLabel htmlFor="ps-cost" srOnly>Cost</FormLabel>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="ps-cost"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.cost}
                  onChange={handleCostChange}
                  placeholder="0.00"
                  className="pl-7"
                  data-testid="input-cost"
                />
              </div>
            </FormField>
            <FormField>
              <FormLabel htmlFor="ps-markup" srOnly>Markup</FormLabel>
              <div className="relative">
                <Input
                  id="ps-markup"
                  type="number"
                  step="1"
                  min="0"
                  value={formData.markupPercent}
                  onChange={handleMarkupChange}
                  placeholder="50"
                  className="pr-7"
                  data-testid="input-markup"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
              </div>
            </FormField>
            <FormField>
              <FormLabel htmlFor="ps-price" srOnly>Price</FormLabel>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="ps-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.unitPrice}
                  onChange={(e) => setField("unitPrice", e.target.value)}
                  placeholder="0.00"
                  className="pl-7"
                  data-testid="input-price"
                />
              </div>
            </FormField>
          </FormRow>
        </FormSection>

        {/* Row E: Duration | Category — Category is a Select so keeps visible label */}
        <FormRow className="grid-cols-2 border-t pt-2">
          <FormField>
            <FormLabel htmlFor="ps-duration" srOnly>Duration (minutes)</FormLabel>
            <Input
              id="ps-duration"
              type="number"
              step="1"
              min="0"
              value={formData.estimatedDurationMinutes}
              onChange={(e) => setField("estimatedDurationMinutes", e.target.value)}
              placeholder="Duration (minutes)"
              data-testid="input-duration"
            />
          </FormField>
          <FormField>
            <FormLabel>Category</FormLabel>
            <Select value={formData.category || "__none__"} onValueChange={(v) => setField("category", v === "__none__" ? "" : v)}>
              <SelectTrigger data-testid="select-category">
                <SelectValue placeholder="Uncategorized" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Uncategorized</SelectItem>
                {uniqueCategories.map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </FormRow>

        {/* Row F: Checkboxes — keep visible Label per canonical rule for checkboxes */}
        <div className="flex items-center gap-4 border-t pt-2">
          <div className="flex items-center gap-2">
            <Checkbox id="taxable" checked={formData.isTaxable} onCheckedChange={(c) => setField("isTaxable", c as boolean)} />
            <Label htmlFor="taxable" className="font-normal cursor-pointer">Taxable</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="active" checked={formData.isActive} onCheckedChange={(c) => setField("isActive", c as boolean)} />
            <Label htmlFor="active" className="font-normal cursor-pointer">Active</Label>
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        {editingProduct && (onDeleteClick || onArchiveClick) && (
          <div className="flex gap-2 mr-auto">
            {onDeleteClick && (
              <Button variant="outline" size="sm" onClick={onDeleteClick} data-testid="button-delete-item">
                Delete
              </Button>
            )}
            {onArchiveClick && (
              <Button variant="outline" size="sm" onClick={onArchiveClick} data-testid="button-archive-item">
                {editingProduct.isActive === false ? "Restore" : "Archive"}
              </Button>
            )}
          </div>
        )}
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={onSave} disabled={isSaving || !!checkDuplicate} data-testid="button-save">
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
          {editingProduct ? "Save" : "Create"}
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}
