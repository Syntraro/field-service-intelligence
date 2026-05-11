import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  InlineInput,
  InlineTextarea,
  InlineSelectTrigger,
  FormField,
  FormRow,
  FormSection,
  FormErrorText,
} from "@/components/ui/form-field";
// 2026-05-06 Phase 1: ModalShell + Modal* primitives.
// 2026-05-09 Phase 2C: FormField / FormLabel / FormRow / FormSection / FormErrorText.
// 2026-05-10 inline-label correction: replaced FormInlineField (label-above) with
// InlineInput / InlineTextarea / InlineSelectTrigger — each owns its bordered shell
// so the label lives physically inside the field box, not above it.
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
        {/* Row A: Type | SKU */}
        <FormRow className="grid-cols-2">
          <Select value={formData.type} onValueChange={(v: "service" | "product") => setField("type", v)}>
            <InlineSelectTrigger id="ps-type" label="Type" required data-testid="select-type">
              <SelectValue />
            </InlineSelectTrigger>
            <SelectContent>
              <SelectItem value="product">Product</SelectItem>
              <SelectItem value="service">Service</SelectItem>
            </SelectContent>
          </Select>
          <InlineInput
            id="ps-sku"
            label="SKU (optional)"
            value={formData.sku}
            onChange={(e) => setField("sku", e.target.value)}
            placeholder="e.g. HVAC-001"
            data-testid="input-sku"
          />
        </FormRow>

        {/* Row B: Name — wrapped in FormField for FormErrorText spacing */}
        <FormField>
          <InlineInput
            id="ps-name"
            label="Name"
            required
            error={!!checkDuplicate}
            value={formData.name}
            onChange={(e) => setField("name", e.target.value)}
            data-testid="input-name"
          />
          {checkDuplicate && (
            <FormErrorText>An item named "{checkDuplicate.name}" already exists</FormErrorText>
          )}
        </FormField>

        {/* Row C: Description */}
        <InlineTextarea
          id="ps-description"
          label="Description"
          value={formData.description}
          onChange={(e) => setField("description", e.target.value)}
          rows={2}
          placeholder="Optional description"
          data-testid="input-description"
        />

        {/* Row D: Pricing — label text carries unit annotation ($ / %) */}
        <FormSection title="Pricing" className="border-t pt-2">
          <FormRow className="grid-cols-3">
            <InlineInput
              id="ps-cost"
              label="Cost ($)"
              type="number"
              step="0.01"
              min="0"
              value={formData.cost}
              onChange={handleCostChange}
              placeholder="0.00"
              data-testid="input-cost"
            />
            <InlineInput
              id="ps-markup"
              label="Markup (%)"
              type="number"
              step="1"
              min="0"
              value={formData.markupPercent}
              onChange={handleMarkupChange}
              placeholder="50"
              data-testid="input-markup"
            />
            <InlineInput
              id="ps-price"
              label="Unit Price ($)"
              type="number"
              step="0.01"
              min="0"
              value={formData.unitPrice}
              onChange={(e) => setField("unitPrice", e.target.value)}
              placeholder="0.00"
              data-testid="input-price"
            />
          </FormRow>
        </FormSection>

        {/* Row E: Duration | Category */}
        <FormRow className="grid-cols-2 border-t pt-2">
          <InlineInput
            id="ps-duration"
            label="Duration (minutes)"
            type="number"
            step="1"
            min="0"
            value={formData.estimatedDurationMinutes}
            onChange={(e) => setField("estimatedDurationMinutes", e.target.value)}
            data-testid="input-duration"
          />
          <Select value={formData.category || "__none__"} onValueChange={(v) => setField("category", v === "__none__" ? "" : v)}>
            <InlineSelectTrigger id="ps-category" label="Category" data-testid="select-category">
              <SelectValue placeholder="Uncategorized" />
            </InlineSelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Uncategorized</SelectItem>
              {uniqueCategories.map((cat) => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
