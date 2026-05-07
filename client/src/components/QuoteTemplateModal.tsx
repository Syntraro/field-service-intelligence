import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Trash2, Loader2, GripVertical } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { QuoteTemplate } from "@shared/schema";
import { CreateOrSelectField } from "@/components/shared/CreateOrSelectField";
import {
  useProductSearch, getProductKey, getProductLabel, getProductDescription,
  productOptionToCatalogItem,
  type ProductOption,
} from "@/lib/entities/productEntity";
import type { LineItemDraft } from "@shared/lineItem";
import {
  catalogItemToDraft,
  blankDraft,
  hydrateDraft,
} from "@/lib/entities/lineItemMapper";

interface QuoteTemplateModalProps {
  open: boolean;
  onClose: () => void;
  template: QuoteTemplate | null;
}

// 2026-04-09 (P9-P10 Phase A): The local `LineItemDraft` shadow interface that
// used to live here has been removed. The canonical `LineItemDraft` from
// `@shared/lineItem` is now the in-memory editing shape — same draft type as
// invoice and quote line surfaces. The on-the-wire template payload is still
// the lightweight `{productId, description, quantity, unitPrice, sortOrder}`
// shape (template tables don't store tax/total fields by design). The
// projection happens in exactly one place: `templateLineFromDraft` below.

/**
 * Project a canonical `LineItemDraft` down to the lightweight quote-template
 * line payload the server expects. Templates are content references — they
 * never store tax or computed totals — so the canonical `taxRate`,
 * `taxAmount`, `lineSubtotal`, `lineTotal`, `lineItemType`, and `source`
 * fields are intentionally dropped here.
 *
 * This is the "one obvious projection function" for quote template lines.
 * If a future template surface (job templates, PM templates) needs the same
 * lightweight projection, lift it into `lineItemMapper.ts`. Until then it
 * stays local to this file to avoid premature abstraction.
 */
function templateLineFromDraft(draft: LineItemDraft, sortOrder: number) {
  return {
    productId: draft.productId,
    description: draft.description.trim(),
    quantity: draft.quantity,
    unitPrice: draft.unitPrice || "0.00",
    sortOrder,
  };
}

interface QuickAddPartData {
  name: string;
  type: "product" | "service";
  sku: string;
  description: string;
  unitPrice: string;
}

export function QuoteTemplateModal({ open, onClose, template }: QuoteTemplateModalProps) {
  const { toast } = useToast();
  const isEditing = !!template;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([]);
  // 2026-04-14: Inline "create new part/service" from a template line.
  // Mirrors the canonical QuickAdd pattern in JobTemplateModal — same
  // `POST /api/items` endpoint, same catalog→draft projection, same UX.
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddForLineId, setQuickAddForLineId] = useState<string | null>(null);
  const [quickAddData, setQuickAddData] = useState<QuickAddPartData>({
    name: "",
    type: "product",
    sku: "",
    description: "",
    unitPrice: "",
  });

  const { data: templateDetails, isLoading: isLoadingDetails } = useQuery<
    QuoteTemplate & { lines: any[] }
  >({
    queryKey: ["/api/quote-templates", template?.id],
    queryFn: async () => {
      const res = await fetch(`/api/quote-templates/${template!.id}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch template details");
      return res.json();
    },
    enabled: open && !!template?.id,
  });

  const [isFormReady, setIsFormReady] = useState(false);

  useEffect(() => {
    if (open) {
      if (template) {
        if (templateDetails) {
          setName(templateDetails.name);
          setDescription(templateDetails.description || "");
          setIsDefault(templateDetails.isDefault);
          setIsActive(templateDetails.isActive);
          // 2026-04-09 (Phase A): Hydrate persisted template lines through the
          // canonical `hydrateDraft` so the editor sees the full canonical
          // shape (zero-defaulted tax/total fields the template doesn't store).
          // `hydrateDraft` requires a non-empty `id`; fall back to a synthetic
          // index-based id for legacy rows that somehow lack one.
          setLineItems(
            (templateDetails.lines || []).map((line: any, index: number) =>
              hydrateDraft({
                ...line,
                id: line.id || `line_${index}`,
                source: "template",
              }),
            ),
          );
          setIsFormReady(true);
        } else {
          setIsFormReady(false);
        }
      } else {
        setName("");
        setDescription("");
        setIsDefault(false);
        setIsActive(true);
        setLineItems([]);
        setIsFormReady(true);
      }
    } else {
      setIsFormReady(false);
    }
  }, [open, template, templateDetails]);

  // 2026-04-14: canonical QuickAdd mutation — same POST /api/items the
  // office Parts catalog uses, so the freshly-created item is immediately
  // available to every other catalog-driven surface (invoices, jobs, tech).
  const quickAddPartMutation = useMutation({
    mutationFn: async (data: QuickAddPartData) => {
      const priceStr = data.unitPrice.trim();
      const unitPrice = priceStr === "" ? null : priceStr;
      return await apiRequest("/api/items", {
        method: "POST",
        body: JSON.stringify({
          type: data.type,
          name: data.name,
          sku: data.sku || null,
          description: data.description || null,
          unitPrice,
          isActive: true,
        }),
      });
    },
    onSuccess: (newPart: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({ title: "Part created", description: `"${newPart.name}" has been added to your catalog.` });
      if (quickAddForLineId) {
        setLineItems((prev) =>
          prev.map((li) => {
            if (li.id !== quickAddForLineId) return li;
            const productOption: ProductOption = {
              id: newPart.id,
              name: newPart.name ?? newPart.description ?? "Untitled",
              type: (newPart.type as string) ?? "product",
              unitPrice: newPart.unitPrice ?? null,
              cost: newPart.cost ?? null,
            };
            const fresh = catalogItemToDraft(
              productOptionToCatalogItem(productOption),
              { source: "template", quantity: li.quantity, sortOrder: li.sortOrder },
            );
            return { ...fresh, id: li.id };
          }),
        );
      }
      setQuickAddOpen(false);
      setQuickAddForLineId(null);
      setQuickAddData({ name: "", type: "product", sku: "", description: "", unitPrice: "" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create part.", variant: "destructive" });
    },
  });

  const openQuickAddDialog = (lineItemId: string, searchValue: string) => {
    setQuickAddForLineId(lineItemId);
    setQuickAddData({ name: searchValue, type: "product", sku: "", description: "", unitPrice: "" });
    setQuickAddOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const url = isEditing
        ? `/api/quote-templates/${template!.id}`
        : "/api/quote-templates";
      const method = isEditing ? "PATCH" : "POST";

      return apiRequest(url, {
        method,
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quote-templates/list"] });
      toast({
        title: isEditing ? "Template updated" : "Template created",
        description: isEditing
          ? "Your changes have been saved."
          : "The new template is ready to use.",
      });
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleAddLineItem = () => {
    // Phase A: blank canonical draft instead of inline literal
    setLineItems((prev) => [...prev, blankDraft({ source: "template" })]);
  };

  const handleRemoveLineItem = (id: string) => {
    setLineItems((prev) => prev.filter((item) => item.id !== id));
  };

  // Field updater scoped to the editable text fields the template UI exposes.
  // The wider canonical draft has 17 fields; templates only edit description,
  // quantity, unitPrice in this surface.
  const handleLineItemChange = (
    id: string,
    field: "description" | "quantity" | "unitPrice",
    value: string,
  ) => {
    setLineItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  };

  const handleSave = () => {
    if (!name.trim()) {
      toast({ title: "Validation error", description: "Name is required.", variant: "destructive" });
      return;
    }

    const validLineItems = lineItems.filter((li) => li.description.trim());

    for (const li of validLineItems) {
      const qty = parseFloat(li.quantity);
      if (isNaN(qty) || qty <= 0) {
        toast({
          title: "Validation error",
          description: "Quantity must be greater than 0 for all line items.",
          variant: "destructive",
        });
        return;
      }
    }

    // Phase A: lines projected from canonical drafts via the local
    // `templateLineFromDraft` projection function. Template tables don't
    // store tax/total fields by design, so the lightweight subset wire shape
    // is unchanged.
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      isDefault,
      lines: validLineItems.map((draft, index) => templateLineFromDraft(draft, index)),
    };

    saveMutation.mutate(payload);
  };

  const calculateLineTotal = (quantity: string, unitPrice: string): string => {
    const qty = parseFloat(quantity) || 0;
    const price = parseFloat(unitPrice) || 0;
    return (qty * price).toFixed(2);
  };

  const calculateTotal = (): string => {
    return lineItems
      .reduce((sum, li) => {
        const qty = parseFloat(li.quantity) || 0;
        const price = parseFloat(li.unitPrice) || 0;
        return sum + qty * price;
      }, 0)
      .toFixed(2);
  };

  // 2026-04-14: guard close paths on `isPending` so a mid-flight save can't
  // silently complete after the user dismisses the modal. Without this guard,
  // clicking Save then closing (outside-click / Escape / Cancel) looked like
  // "it saved when I closed it" — because TanStack Query does not cancel the
  // mutation when the modal unmounts, and `onSuccess` still invalidates the
  // list.
  const handleAttemptClose = () => {
    if (!saveMutation.isPending) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleAttemptClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-modal-title">
            {isEditing ? "Edit Quote Template" : "New Quote Template"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the template details and line items."
              : "Create a reusable template with predefined line items for quotes."}
          </DialogDescription>
        </DialogHeader>

        {!isFormReady || (isEditing && isLoadingDetails) ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Template Details</h3>

              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Standard Service Quote"
                  data-testid="input-template-name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description..."
                  rows={2}
                  data-testid="input-template-description"
                />
              </div>

              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={isDefault}
                    onCheckedChange={(checked) => setIsDefault(checked === true)}
                    data-testid="checkbox-is-default"
                  />
                  Use as default template
                </label>

                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={isActive}
                    onCheckedChange={(checked) => setIsActive(checked === true)}
                    data-testid="checkbox-is-active"
                  />
                  Active
                </label>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Line Items</h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddLineItem}
                  data-testid="button-add-line-item"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Line Item
                </Button>
              </div>

              {lineItems.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground border border-dashed rounded-md">
                  <p className="text-sm">No line items yet.</p>
                  <p className="text-xs">Add items to include in this template.</p>
                </div>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="w-24">Qty</TableHead>
                        <TableHead className="w-32">Unit Price</TableHead>
                        <TableHead className="w-28 text-right">Total</TableHead>
                        <TableHead className="w-16"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lineItems.map((item, index) => (
                        <TableRow key={item.id}>
                          <TableCell className="text-muted-foreground cursor-grab">
                            <GripVertical className="h-4 w-4" />
                          </TableCell>
                          <TableCell>
                            <LineItemProductCell
                              item={item}
                              onRequestAddProduct={(searchText) => openQuickAddDialog(item.id, searchText)}
                              onSelect={(product) => {
                                // Phase A: replace inline catalog→draft mapping with the
                                // canonical mapper. Preserve the existing row id, sortOrder,
                                // and quantity so the table doesn't reorder and the user's
                                // edited quantity isn't reset.
                                setLineItems(prev => prev.map(li => {
                                  if (li.id !== item.id) return li;
                                  const fresh = catalogItemToDraft(
                                    productOptionToCatalogItem(product),
                                    { source: "template", quantity: li.quantity },
                                  );
                                  return { ...fresh, id: li.id, sortOrder: li.sortOrder };
                                }));
                              }}
                              onClear={() => {
                                setLineItems(prev => prev.map(li =>
                                  li.id === item.id ? { ...li, productId: null } : li
                                ));
                              }}
                              onDescriptionChange={(value) => handleLineItemChange(item.id, "description", value)}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={item.quantity}
                              onChange={(e) =>
                                handleLineItemChange(item.id, "quantity", e.target.value)
                              }
                              className="text-sm"
                              data-testid={`input-quantity-${index}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.unitPrice}
                              onChange={(e) =>
                                handleLineItemChange(item.id, "unitPrice", e.target.value)
                              }
                              placeholder="0.00"
                              className="text-sm"
                              data-testid={`input-price-${index}`}
                            />
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            ${calculateLineTotal(item.quantity, item.unitPrice)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveLineItem(item.id)}
                              data-testid={`button-remove-${index}`}
                            >
                              <Trash2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/50">
                        <TableCell colSpan={4} className="text-right font-semibold">
                          Template Total:
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          ${calculateTotal()}
                        </TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleAttemptClose} disabled={saveMutation.isPending} data-testid="button-cancel">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            data-testid="button-save"
          >
            {saveMutation.isPending && (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            )}
            {isEditing ? "Save Changes" : "Create Template"}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* 2026-04-14: QuickAdd part/service dialog — mirrors JobTemplateModal's
          canonical pattern. Posts to /api/items so the new catalog entry is
          immediately available to every other catalog-driven surface. */}
      <Dialog open={quickAddOpen} onOpenChange={setQuickAddOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add New Product/Service</DialogTitle>
            <DialogDescription>
              Create a new item to add to your catalog and this template.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Type *</Label>
                <Select
                  value={quickAddData.type}
                  onValueChange={(v: "product" | "service") =>
                    setQuickAddData((prev) => ({ ...prev, type: v }))
                  }
                >
                  <SelectTrigger data-testid="quick-add-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="product">Product</SelectItem>
                    <SelectItem value="service">Service</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>SKU</Label>
                <Input
                  value={quickAddData.sku}
                  onChange={(e) => setQuickAddData((prev) => ({ ...prev, sku: e.target.value }))}
                  placeholder="Optional"
                  data-testid="quick-add-sku"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input
                value={quickAddData.name}
                onChange={(e) => setQuickAddData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Product or service name"
                data-testid="quick-add-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={quickAddData.description}
                onChange={(e) => setQuickAddData((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Optional description"
                data-testid="quick-add-description"
              />
            </div>
            <div className="space-y-2">
              <Label>Unit Price</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={quickAddData.unitPrice}
                onChange={(e) => setQuickAddData((prev) => ({ ...prev, unitPrice: e.target.value }))}
                placeholder="0.00"
                data-testid="quick-add-price"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickAddOpen(false)} data-testid="quick-add-cancel">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!quickAddData.name.trim()) {
                  toast({ title: "Validation error", description: "Name is required.", variant: "destructive" });
                  return;
                }
                quickAddPartMutation.mutate(quickAddData);
              }}
              disabled={quickAddPartMutation.isPending}
              data-testid="quick-add-save"
            >
              {quickAddPartMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Add to Catalog
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

// ── Line item product cell using canonical selector ──
// 2026-04-09 (Phase A): `item` is now the canonical `LineItemDraft` from
// `@shared/lineItem`. The selected `ProductOption` is reconstructed from the
// draft's catalog-bound fields (productId, description, productType, unitPrice,
// unitCost) so the selector renders the correct chip without a parallel
// `selectedProduct` state.
function LineItemProductCell({ item, onSelect, onClear, onDescriptionChange, onRequestAddProduct }: {
  item: LineItemDraft;
  onSelect: (product: ProductOption) => void;
  onClear: () => void;
  onDescriptionChange: (value: string) => void;
  /** 2026-04-14: called when the user chooses the inline "Add new" affordance
   *  in the CreateOrSelectField search popover. Opens the QuickAdd dialog
   *  rather than creating quote-template-specific logic. */
  onRequestAddProduct: (searchText: string) => void;
}) {
  const [searchText, setSearchText] = useState("");
  const { data: results = [], isLoading } = useProductSearch(searchText);

  // If product is selected, show as selected state; otherwise show search.
  // Reconstructed purely from the canonical draft — no parallel state.
  const selectedValue: ProductOption | null = item.productId
    ? {
        id: item.productId,
        name: item.description,
        type: item.productType ?? "product",
        unitPrice: item.unitPrice,
        cost: item.unitCost,
      }
    : null;

  return (
    <CreateOrSelectField<ProductOption>
      label=""
      compact
      value={selectedValue}
      onChange={(product) => {
        if (product) {
          onSelect(product);
          setSearchText("");
        } else {
          onClear();
          onDescriptionChange("");
        }
      }}
      searchResults={results}
      searchLoading={isLoading}
      searchText={searchText || (selectedValue ? "" : item.description)}
      onSearchTextChange={(text) => {
        setSearchText(text);
        // Also update description for manual-entry fallback
        if (!item.productId) onDescriptionChange(text);
      }}
      getKey={getProductKey}
      getLabel={getProductLabel}
      getDescription={getProductDescription}
      createLabel={`Add "${searchText || "new part/service"}"`}
      onCreateNew={(text) => onRequestAddProduct(text)}
      placeholder="Search products or type description"
    />
  );
}
