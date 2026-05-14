/**
 * AddProductModal — canonical "create new product / service" modal.
 *
 * 2026-04-29 (Phase 3 cleanup): The legacy `PartsBillingCard` component +
 * its `SortableLineItemRow` / `TemplatePickerList` / `rowIsChanged` /
 * `formatCurrency` / `OFFICE_ROLES` helpers were deleted. The Job Parts
 * surface is now driven by the canonical `<LineItemsCard>` mounted directly
 * inside `client/src/pages/JobDetailPage.tsx` (the inline `LineItemsTable`
 * wrapper). Invoice + Quote already consume the canonical card.
 *
 * What survives in this file: `AddProductModal`. It is exported because
 * Invoice, Quote, and the Job-Parts wrapper all open the same modal via the
 * canonical "request → resolver" flow when a user clicks "Create '<X>'" on
 * the product/service selector. Keeping a single instance per page (rather
 * than one per row) is a deliberate canonical-flow rule.
 *
 * The file path is kept as `PartsBillingCard.tsx` for stability — three
 * pages currently import from `@/components/PartsBillingCard`. A future
 * cleanup may rename it to `AddProductModal.tsx`; until then, this header
 * documents the actual purpose.
 *
 * 2026-05-13: Extended with full pricebook fields (SKU, markup, duration,
 * category, taxable, active) and an `initialType` prop so service-picker
 * callers can default the Type selector to "service".
 */
import { useEffect, useState } from "react";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalFooter,
  ModalPrimaryAction,
  ModalSecondaryAction,
} from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface AddProductModalSaveData {
  name: string;
  description?: string;
  sku?: string;
  cost: string;
  markupPercent?: string;
  unitPrice: string;
  estimatedDurationMinutes?: number | null;
  category?: string;
  isTaxable?: boolean;
  isActive?: boolean;
  type: string;
}

export interface AddProductModalProps {
  open: boolean;
  initialName: string;
  /** Pre-selects the Type field. Defaults to "product". Pass "service" when
   *  opened from a service-picker so the user doesn't have to switch it. */
  initialType?: string;
  onClose: () => void;
  onSave: (data: AddProductModalSaveData) => void;
  isSaving: boolean;
}

export function AddProductModal({
  open,
  initialName,
  initialType = "product",
  onClose,
  onSave,
  isSaving,
}: AddProductModalProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState("");
  const [sku, setSku] = useState("");
  const [type, setType] = useState<string>(initialType);
  const [cost, setCost] = useState<string>("");
  const [markupPercent, setMarkupPercent] = useState<string>("");
  const [price, setPrice] = useState("");
  const [estimatedDurationMinutes, setEstimatedDurationMinutes] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [isTaxable, setIsTaxable] = useState(true);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setDescription("");
      setSku("");
      setType(initialType);
      setCost("");
      setMarkupPercent("");
      setPrice("");
      setEstimatedDurationMinutes("");
      setCategory("");
      setIsTaxable(true);
      setIsActive(true);
    }
  }, [open, initialName, initialType]);

  const handleCostChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const c = e.target.value;
    setCost(c);
    const m = parseFloat(markupPercent) || 0;
    if (m > 0) setPrice(((parseFloat(c) || 0) * (1 + m / 100)).toFixed(2));
  };

  const handleMarkupChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const m = e.target.value;
    setMarkupPercent(m);
    const c = parseFloat(cost) || 0;
    if (c > 0) setPrice((c * (1 + (parseFloat(m) || 0) / 100)).toFixed(2));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const dur = estimatedDurationMinutes.trim()
      ? parseInt(estimatedDurationMinutes, 10) || null
      : null;
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      sku: sku.trim() || undefined,
      cost,
      markupPercent: markupPercent || undefined,
      unitPrice: price,
      estimatedDurationMinutes: dur,
      category: category.trim() || undefined,
      isTaxable,
      isActive,
      type,
    });
  };

  return (
    <ModalShell
      open={open}
      onOpenChange={(isOpen) => !isOpen && onClose()}
      className="sm:max-w-[520px]"
    >
      <form onSubmit={handleSubmit}>
        <ModalHeader>
          <ModalTitle>Add new item</ModalTitle>
          <ModalDescription>
            This item will be added to your Pricebook and linked to this line item.
          </ModalDescription>
        </ModalHeader>
        <div className="px-5 py-4 space-y-4">
          {/* Row 1: Type + SKU */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger data-testid="select-product-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="product">Product</SelectItem>
                  <SelectItem value="service">Service</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>SKU (optional)</Label>
              <Input
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="e.g. HVAC-001"
                data-testid="input-new-product-sku"
              />
            </div>
          </div>

          {/* Row 2: Name */}
          <div>
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              data-testid="input-new-product-name"
            />
          </div>

          {/* Row 3: Description */}
          <div>
            <Label>Description (optional)</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="input-new-product-description"
            />
          </div>

          {/* Row 4: Cost | Markup | Price */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Unit Cost</Label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                  className="pl-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  value={cost || ""}
                  onChange={handleCostChange}
                  data-testid="input-new-product-cost"
                />
              </div>
            </div>
            <div>
              <Label>Markup %</Label>
              <div className="relative">
                <Input
                  type="number"
                  min={0}
                  step="1"
                  placeholder="50"
                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  value={markupPercent || ""}
                  onChange={handleMarkupChange}
                  data-testid="input-new-product-markup"
                />
              </div>
            </div>
            <div>
              <Label>Unit Price</Label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                  className="pl-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  value={price || ""}
                  onChange={(e) => setPrice(e.target.value)}
                  data-testid="input-new-product-price"
                />
              </div>
            </div>
          </div>

          {/* Row 5: Duration + Category */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Duration (minutes)</Label>
              <Input
                type="number"
                min={0}
                step="1"
                placeholder="e.g. 60"
                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                value={estimatedDurationMinutes || ""}
                onChange={(e) => setEstimatedDurationMinutes(e.target.value)}
                data-testid="input-new-product-duration"
              />
            </div>
            <div>
              <Label>Category (optional)</Label>
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. HVAC"
                data-testid="input-new-product-category"
              />
            </div>
          </div>

          {/* Row 6: Taxable + Active */}
          <div className="flex items-center gap-6 pt-1">
            <div className="flex items-center gap-2">
              <Checkbox
                id="add-product-taxable"
                checked={isTaxable}
                onCheckedChange={(c) => setIsTaxable(c as boolean)}
                data-testid="checkbox-new-product-taxable"
              />
              <Label htmlFor="add-product-taxable" className="font-normal cursor-pointer">Taxable</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="add-product-active"
                checked={isActive}
                onCheckedChange={(c) => setIsActive(c as boolean)}
                data-testid="checkbox-new-product-active"
              />
              <Label htmlFor="add-product-active" className="font-normal cursor-pointer">Active</Label>
            </div>
          </div>
        </div>
        <ModalFooter>
          <ModalSecondaryAction
            type="button"
            onClick={onClose}
            data-testid="button-cancel-add-product"
          >
            Cancel
          </ModalSecondaryAction>
          <ModalPrimaryAction
            type="submit"
            disabled={isSaving || !name.trim()}
            data-testid="button-save-product"
          >
            {isSaving ? "Saving..." : "Create"}
          </ModalPrimaryAction>
        </ModalFooter>
      </form>
    </ModalShell>
  );
}
