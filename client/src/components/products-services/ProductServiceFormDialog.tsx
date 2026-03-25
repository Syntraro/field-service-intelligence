import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] overflow-visible" data-testid="dialog-product">
        <DialogHeader>
          <DialogTitle>{editingProduct ? "Edit Item" : "Add New Item"}</DialogTitle>
          <DialogDescription>
            {editingProduct ? "Update the item details." : "Create a new product or service."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
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
            <div className="space-y-2">
              <Label>SKU</Label>
              <Input value={formData.sku} onChange={(e) => setFormField("sku", e.target.value)} placeholder="e.g. HVAC-001" data-testid="input-sku" />
            </div>
          </div>

          <div className="space-y-2">
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

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={formData.description} onChange={(e) => setFormField("description", e.target.value)} rows={2} data-testid="input-description" />
          </div>

          <div className="border-t pt-3">
            <p className="text-sm font-medium mb-3">Pricing</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Cost</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
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
              </div>
              <div className="space-y-2">
                <Label>Markup</Label>
                <div className="relative">
                  <Input
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
              </div>
              <div className="space-y-2">
                <Label>Price</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.unitPrice}
                    onChange={(e) => setFormField("unitPrice", e.target.value)}
                    placeholder="0.00"
                    className="pl-7"
                    data-testid="input-price"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Duration — most useful for services but available on both */}
          <div className="space-y-2">
            <Label>Duration (minutes)</Label>
            <Input
              type="number"
              step="1"
              min="0"
              value={formData.estimatedDurationMinutes}
              onChange={(e) => setFormField("estimatedDurationMinutes", e.target.value)}
              placeholder="e.g. 60"
              className="w-32"
              data-testid="input-duration"
            />
            <p className="text-xs text-muted-foreground">Estimated time to complete this service or task.</p>
          </div>

          <div className="border-t pt-3">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Checkbox id="taxable" checked={formData.isTaxable} onCheckedChange={(c) => setFormField("isTaxable", c as boolean)} />
                <Label htmlFor="taxable" className="font-normal cursor-pointer">Taxable</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="active" checked={formData.isActive} onCheckedChange={(c) => setFormField("isActive", c as boolean)} />
                <Label htmlFor="active" className="font-normal cursor-pointer">Active</Label>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onSave} disabled={isSaving || !!checkDuplicate} data-testid="button-save">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            {editingProduct ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
