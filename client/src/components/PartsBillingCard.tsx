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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface AddProductModalProps {
  open: boolean;
  initialName: string;
  onClose: () => void;
  onSave: (data: {
    name: string;
    description?: string;
    cost: string;
    unitPrice: string;
    type: string;
  }) => void;
  isSaving: boolean;
}

export function AddProductModal({
  open,
  initialName,
  onClose,
  onSave,
  isSaving,
}: AddProductModalProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState("");
  const [type, setType] = useState<string>("product");
  const [cost, setCost] = useState<string>("");
  const [price, setPrice] = useState("");

  useEffect(() => {
    if (open) {
      setName(initialName);
      setDescription("");
      setType("product");
      setCost("");
      setPrice("");
    }
  }, [open, initialName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      cost,
      unitPrice: price,
      type,
    });
  };

  return (
    <ModalShell
      open={open}
      onOpenChange={(isOpen) => !isOpen && onClose()}
      // 2026-05-07 canonicalization — was raw shadcn dialog primitives;
      // now uses the canonical ModalShell/ModalHeader/ModalFooter set
      // per modal taxonomy rule #4. Width matches the pre-migration
      // `sm:max-w-md` (~448px) shape.
      className="sm:max-w-md"
    >
      <form onSubmit={handleSubmit}>
        <ModalHeader>
          <ModalTitle>Add new product</ModalTitle>
          <ModalDescription>
            This item will be added to your Pricebook and linked to this line item.
          </ModalDescription>
        </ModalHeader>
        <div className="px-5 py-4 space-y-4">
          <div>
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              data-testid="input-new-product-name"
            />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="input-new-product-description"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
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
                  onChange={(e) => setCost(e.target.value)}
                  data-testid="input-new-product-cost"
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
            {isSaving ? "Saving..." : "Save product"}
          </ModalPrimaryAction>
        </ModalFooter>
      </form>
    </ModalShell>
  );
}
