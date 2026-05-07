import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
// 2026-05-06 Phase 1 modal canonicalization: swapped raw Dialog primitives
// for the canonical ModalShell + Modal* primitives per CLAUDE.md Modal
// Taxonomy rule #2 (generic / simple form modal). Body is a standard
// space-y form layout with intra-body `border-t pt-2` section separators
// (Pricing / Duration+Category / Checkboxes rows) — fits cleanly inside
// <ModalBody>. Width (`sm:max-w-[550px]`) + `overflow-visible` (lets the
// Type and Category Select dropdowns extend outside the modal) passed at
// the call-site per Modal Taxonomy rule #5.
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
}: ProductServiceFormDialogProps) {
  const setFormField = <K extends keyof ProductFormData>(field: K, value: ProductFormData[K]) => {
    onFormDataChange({ ...formData, [field]: value });
  };

  const handleCostChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cost = parseFloat(e.target.value) || 0;
    const markup = parseFloat(formData.markupPercent) || 0;
    const calculatedPrice = markup > 0 ? (cost * (1 + markup / 100)).toFixed(2) : "";
    onFormDataChange({
      ...formData,
      cost: e.target.value,
      unitPrice: calculatedPrice
    });
  };

  const handleMarkupChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const markup = parseFloat(e.target.value) || 0;
    const cost = parseFloat(formData.cost) || 0;
    const calculatedPrice = cost > 0 ? (cost * (1 + markup / 100)).toFixed(2) : "";
    onFormDataChange({
      ...formData,
      markupPercent: e.target.value,
      unitPrice: calculatedPrice
    });
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
        {/* Row A: Type | SKU */}
        <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type *</Label>
              <Select value={formData.type} onValueChange={(v: "service" | "product") => setFormField("type", v)}>
                <SelectTrigger data-testid="select-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="product">Product</SelectItem>
                  <SelectItem value="service">Service</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>SKU</Label>
              <Input value={formData.sku} onChange={(e) => setFormField("sku", e.target.value)} placeholder="e.g. HVAC-001" data-testid="input-sku" />
            </div>
          </div>

          {/* Row B: Name (full width) */}
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormField("name", e.target.value)}
              placeholder="Enter name"
              data-testid="input-name"
              className={checkDuplicate ? "border-destructive" : ""}
            />
            {checkDuplicate && (
              <p className="text-xs text-destructive">An item named "{checkDuplicate.name}" already exists</p>
            )}
          </div>

          {/* Row C: Description (full width) */}
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={formData.description} onChange={(e) => setFormField("description", e.target.value)} rows={2} data-testid="input-description" />
          </div>

          {/* Row D: Pricing (3 columns) */}
          <div className="border-t pt-2">
            <p className="text-sm font-medium mb-2">Pricing</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Cost</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input type="number" step="0.01" min="0" value={formData.cost} onChange={handleCostChange} placeholder="0.00" className="pl-7" data-testid="input-cost" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Markup</Label>
                <div className="relative">
                  <Input type="number" step="1" min="0" value={formData.markupPercent} onChange={handleMarkupChange} placeholder="50" className="pr-7" data-testid="input-markup" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Price</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input type="number" step="0.01" min="0" value={formData.unitPrice} onChange={(e) => setFormField("unitPrice", e.target.value)} placeholder="0.00" className="pl-7" data-testid="input-price" />
                </div>
              </div>
            </div>
          </div>

          {/* Row E: Duration | Category */}
          <div className="grid grid-cols-2 gap-3 border-t pt-2">
            <div className="space-y-1.5">
              <Label>Duration (minutes)</Label>
              <Input type="number" step="1" min="0" value={formData.estimatedDurationMinutes} onChange={(e) => setFormField("estimatedDurationMinutes", e.target.value)} placeholder="e.g. 60" data-testid="input-duration" />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={formData.category || "__none__"} onValueChange={(v) => setFormField("category", v === "__none__" ? "" : v)}>
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
            </div>
          </div>

        {/* Row F: Checkboxes */}
        <div className="flex items-center gap-4 border-t pt-2">
          <div className="flex items-center gap-2">
            <Checkbox id="taxable" checked={formData.isTaxable} onCheckedChange={(c) => setFormField("isTaxable", c as boolean)} />
            <Label htmlFor="taxable" className="font-normal cursor-pointer">Taxable</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="active" checked={formData.isActive} onCheckedChange={(c) => setFormField("isActive", c as boolean)} />
            <Label htmlFor="active" className="font-normal cursor-pointer">Active</Label>
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={onSave} disabled={isSaving || !!checkDuplicate} data-testid="button-save">
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
          {editingProduct ? "Save" : "Create"}
        </Button>
      </ModalFooter>
    </ModalShell>
  );
}
