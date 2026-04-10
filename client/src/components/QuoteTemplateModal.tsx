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

export function QuoteTemplateModal({ open, onClose, template }: QuoteTemplateModalProps) {
  const { toast } = useToast();
  const isEditing = !!template;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([]);

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

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
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
          <Button variant="outline" onClick={onClose} data-testid="button-cancel">
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
    </Dialog>
  );
}

// ── Line item product cell using canonical selector ──
// 2026-04-09 (Phase A): `item` is now the canonical `LineItemDraft` from
// `@shared/lineItem`. The selected `ProductOption` is reconstructed from the
// draft's catalog-bound fields (productId, description, productType, unitPrice,
// unitCost) so the selector renders the correct chip without a parallel
// `selectedProduct` state.
function LineItemProductCell({ item, onSelect, onClear, onDescriptionChange }: {
  item: LineItemDraft;
  onSelect: (product: ProductOption) => void;
  onClear: () => void;
  onDescriptionChange: (value: string) => void;
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
      placeholder="Search products or type description"
    />
  );
}
