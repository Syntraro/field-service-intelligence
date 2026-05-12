/**
 * JobTemplateModal — Job template editor.
 *
 * 2026-04-10 (P9-P10 Phase B): Migrated to the canonical client pipeline.
 *
 *   - Local `LineItemDraft` shadow interface: REMOVED. The canonical
 *     `LineItemDraft` from `@shared/lineItem` is now the in-memory editing
 *     shape (same as invoice, quote, quote-template, job parts, PM template,
 *     visit parts).
 *   - Direct `/api/items?limit=200` prefetch: REMOVED. The catalog is now
 *     queried per-row via `useProductSearch` (fires after 2 chars).
 *   - Custom Popover/Command product selector: REPLACED with the canonical
 *     `CreateOrSelectField` + `useProductSearch`.
 *   - Inline catalog→draft mapping in `handleProductSelect`: REPLACED with
 *     `catalogItemToDraft(productOptionToCatalogItem(product), {...})`.
 *
 * Persistence rule: job_templates.lines stores the lightweight shape
 * `{ productId, descriptionOverride, quantity, unitPriceOverride, sortOrder }`.
 * The save payload still uses that shape via the local
 * `templateLineFromDraft` projection helper. Templates are content references
 * — they never store tax/totals — so the canonical `LineItemDraft` lives in
 * memory and the projection happens at save time.
 */
import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  FormField,
  FormLabel,
  FormRow,
} from "@/components/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus, Trash2, Loader2, GripVertical, HelpCircle } from "lucide-react";
import type { JobTemplate } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import type { LineItemDraft } from "@shared/lineItem";
import { parseMoney } from "@shared/lineItem";
import { CreateOrSelectField } from "@/components/shared/CreateOrSelectField";
import {
  useProductSearch,
  getProductKey,
  getProductLabel,
  getProductDescription,
  productOptionToCatalogItem,
  type ProductOption,
} from "@/lib/entities/productEntity";
import {
  catalogItemToDraft,
  blankDraft,
  hydrateDraft,
} from "@/lib/entities/lineItemMapper";

interface JobTemplateModalProps {
  open: boolean;
  onClose: () => void;
  template: JobTemplate | null;
}

interface QuickAddPartData {
  name: string;
  type: "product" | "service";
  sku: string;
  description: string;
  unitPrice: string;
}

/**
 * Project a canonical `LineItemDraft` down to the lightweight job-template
 * line payload the server expects: `{ productId, descriptionOverride,
 * quantity, unitPriceOverride, sortOrder }`. Templates are content references
 * — they never store tax/computed totals — so the canonical `taxRate`,
 * `taxAmount`, `lineSubtotal`, `lineTotal`, `lineItemType`, and `source`
 * fields are intentionally dropped here.
 *
 * `descriptionOverride` is the canonical `description` field with one
 * subtlety: in the legacy job-template schema, an empty `descriptionOverride`
 * meant "use the catalog product's default name at apply time". The same
 * convention is preserved here — when the user has not typed a custom
 * description, the field is sent as `null`.
 *
 * Local to this file, matching the same pattern as `templateLineFromDraft`
 * in QuoteTemplateModal.tsx. If a future template surface needs the same
 * lightweight shape, lift it into `lineItemMapper.ts` — until then it stays
 * local to avoid premature abstraction.
 */
function templateLineFromDraft(
  draft: LineItemDraft,
  defaultName: string,
  sortOrder: number,
) {
  const description = draft.description.trim();
  const hasOverride = description.length > 0 && description !== defaultName.trim();
  return {
    productId: draft.productId,
    descriptionOverride: hasOverride ? description : null,
    quantity: draft.quantity,
    unitPriceOverride: draft.unitPrice && draft.unitPrice !== "0.00" ? draft.unitPrice : null,
    sortOrder,
  };
}

const JOB_TYPE_OPTIONS = [
  { value: "", label: "None" },
  { value: "service_call", label: "Service Call" },
  { value: "maintenance", label: "PM" },
  { value: "install", label: "Install" },
  { value: "repair", label: "Repair" },
  { value: "inspection", label: "Inspection" },
  { value: "other", label: "Other" },
];

export function JobTemplateModal({ open, onClose, template }: JobTemplateModalProps) {
  const { toast } = useToast();
  const isEditing = !!template;

  const [name, setName] = useState("");
  const [jobType, setJobType] = useState("");
  const [description, setDescription] = useState("");
  const [isDefaultForJobType, setIsDefaultForJobType] = useState(false);
  const [isActive, setIsActive] = useState(true);
  // 2026-04-10 Phase B: canonical LineItemDraft, not the local shadow.
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([]);
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
    JobTemplate & { lines: any[] }
  >({
    queryKey: ["/api/job-templates", template?.id],
    queryFn: async () => {
      const res = await fetch(`/api/job-templates/${template!.id}`, {
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
          setJobType(templateDetails.jobType || "");
          setDescription(templateDetails.description || "");
          setIsDefaultForJobType(templateDetails.isDefaultForJobType);
          setIsActive(templateDetails.isActive);
          // 2026-04-10 Phase B: hydrate persisted lines through the canonical
          // hydrateDraft. Legacy template lines store `descriptionOverride` /
          // `unitPriceOverride` — we map those onto the canonical
          // `description` / `unitPrice` fields. The product's default name
          // (resolved from the JOIN-included `productName` field, falling
          // back to `descriptionOverride`) becomes the description when no
          // override is set, so the row reads naturally in the editor.
          setLineItems(
            (templateDetails.lines || []).map((line: any, index: number) => {
              const productName = line.productName || line.product?.name || "";
              const description = line.descriptionOverride || productName || "";
              const unitPrice = line.unitPriceOverride || line.productUnitPrice || line.product?.unitPrice || "0";
              return hydrateDraft({
                id: line.id || `line_${index}`,
                description,
                quantity: String(line.quantity || "1"),
                unitPrice,
                unitCost: line.productCost || line.product?.cost || "0",
                productId: line.productId || null,
                source: "template",
                sortOrder: index,
              });
            }),
          );
          setIsFormReady(true);
        } else {
          setIsFormReady(false);
        }
      } else {
        setName("");
        setJobType("");
        setDescription("");
        setIsDefaultForJobType(false);
        setIsActive(true);
        setLineItems([]);
        setIsFormReady(true);
      }
    } else {
      setIsFormReady(false);
    }
  }, [open, template, templateDetails]);

  const quickAddPartMutation = useMutation({
    mutationFn: async (data: QuickAddPartData) => {
      const priceStr = data.unitPrice.trim();
      const unitPrice = priceStr === "" ? null : priceStr;

      return await apiRequest("/api/items", { method: "POST", body: JSON.stringify({
        type: data.type,
        name: data.name,
        sku: data.sku || null,
        description: data.description || null,
        unitPrice,
        isActive: true,
      }) });
    },
    onSuccess: (newPart) => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({ title: "Part created", description: `"${newPart.name}" has been added to your catalog.` });

      if (quickAddForLineId) {
        // 2026-04-10 Phase B: route the freshly-created catalog item through
        // the canonical mapper, same path as a normal product selection.
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
            const fresh = catalogItemToDraft(productOptionToCatalogItem(productOption), {
              source: "template",
              quantity: li.quantity,
              sortOrder: li.sortOrder,
            });
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
    setQuickAddData({
      name: searchValue,
      type: "product",
      sku: "",
      description: "",
      unitPrice: "",
    });
    setQuickAddOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const url = isEditing
        ? `/api/job-templates/${template!.id}`
        : "/api/job-templates";
      const method = isEditing ? "PATCH" : "POST";

      return apiRequest(url, {
        method,
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/job-templates"] });
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
    // 2026-04-10 Phase B: blank canonical draft instead of inline literal.
    setLineItems((prev) => [...prev, blankDraft({ source: "template", sortOrder: prev.length })]);
  };

  const handleRemoveLineItem = (id: string) => {
    setLineItems((prev) => prev.filter((item) => item.id !== id));
  };

  /**
   * Field updater scoped to the editable text fields the template UI exposes.
   * The wider canonical draft has 17 fields; templates only edit description,
   * quantity, unitPrice in this surface.
   */
  const handleLineItemChange = (
    id: string,
    field: "description" | "quantity" | "unitPrice",
    value: string,
  ) => {
    setLineItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    );
  };

  /**
   * 2026-04-10 Phase B: canonical catalog→draft mapping. Replaces the inline
   * field map. Preserves the row id, sortOrder, and existing quantity so the
   * table doesn't reorder and the user's edited quantity isn't reset.
   */
  const handleProductSelect = (itemId: string, product: ProductOption) => {
    setLineItems((prev) =>
      prev.map((li) => {
        if (li.id !== itemId) return li;
        const fresh = catalogItemToDraft(productOptionToCatalogItem(product), {
          source: "template",
          quantity: li.quantity,
          sortOrder: li.sortOrder,
        });
        return { ...fresh, id: li.id };
      }),
    );
  };

  const handleSave = () => {
    if (!name.trim()) {
      toast({ title: "Validation error", description: "Name is required.", variant: "destructive" });
      return;
    }

    const validLineItems = lineItems.filter((li) => li.productId);
    if (validLineItems.length === 0) {
      toast({
        title: "Validation error",
        description: "At least one line item with a selected product is required.",
        variant: "destructive",
      });
      return;
    }

    for (const li of validLineItems) {
      // 2026-04-10 Phase E polish: parseMoney replaces bare parseFloat. The
      // explicit isNaN guard is no longer needed because parseMoney coerces
      // every malformed input (NaN, "", null, "abc") to 0, which the qty<=0
      // gate already catches.
      const qty = parseMoney(li.quantity);
      if (qty <= 0) {
        toast({
          title: "Validation error",
          description: "Quantity must be greater than 0 for all line items.",
          variant: "destructive",
        });
        return;
      }
    }

    // 2026-04-10 Phase B: lines projected from canonical drafts via the local
    // `templateLineFromDraft` projection function. Template tables don't store
    // tax/total fields by design, so the lightweight subset wire shape is
    // unchanged from before the migration.
    const payload = {
      name: name.trim(),
      jobType: jobType || null,
      description: description.trim() || null,
      isDefaultForJobType: jobType ? isDefaultForJobType : false,
      isActive,
      lines: validLineItems.map((li, index) =>
        templateLineFromDraft(li, li.description, index),
      ),
    };

    saveMutation.mutate(payload);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-modal-title">
            {isEditing ? "Edit Job Template" : "New Job Template"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the template details and line items."
              : "Create a reusable template with predefined line items."}
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

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField>
                  <FormLabel htmlFor="name" srOnly required>Name</FormLabel>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Standard Service Call"
                    data-testid="input-template-name"
                  />
                </FormField>

                <FormField>
                  <FormLabel htmlFor="jobType">Job Type</FormLabel>
                  <Select
                    value={jobType || "none"}
                    onValueChange={(val) => setJobType(val === "none" ? "" : val)}
                  >
                    <SelectTrigger id="jobType" data-testid="select-job-type">
                      <SelectValue placeholder="Select type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {JOB_TYPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value || "none"} value={opt.value || "none"}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              </div>

              <FormField>
                <FormLabel htmlFor="description" srOnly>Description</FormLabel>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description..."
                  rows={2}
                  data-testid="input-template-description"
                />
              </FormField>

              <div className="flex items-center gap-6">
                {jobType && (
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={isDefaultForJobType}
                      onCheckedChange={(checked) =>
                        setIsDefaultForJobType(checked === true)
                      }
                      data-testid="checkbox-is-default"
                    />
                    Use as default template for this job type
                  </label>
                )}

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
                  <p className="text-xs">Add products or services to include in this template.</p>
                </div>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>Product / Service</TableHead>
                        <TableHead>
                          <div className="flex items-center gap-1">
                            Description
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[200px]">
                                <p className="text-xs">If left blank, the product's default description will be used.</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </TableHead>
                        <TableHead className="w-24">Qty</TableHead>
                        <TableHead className="w-32">Unit Price</TableHead>
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
                            {/* 2026-04-10 Phase B: canonical CreateOrSelectField + useProductSearch
                                replaces the custom Popover/Command product picker. The "create new"
                                callback opens the existing QuickAdd dialog seeded with the search text. */}
                            <JobTemplateProductCell
                              item={item}
                              index={index}
                              onSelect={(product) => handleProductSelect(item.id, product)}
                              onClear={() =>
                                setLineItems((prev) =>
                                  prev.map((li) =>
                                    li.id === item.id ? { ...li, productId: null } : li,
                                  ),
                                )
                              }
                              onRequestAddProduct={(searchText) => openQuickAddDialog(item.id, searchText)}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={item.description}
                              onChange={(e) =>
                                handleLineItemChange(item.id, "description", e.target.value)
                              }
                              placeholder="Leave blank for default"
                              className="text-sm"
                              data-testid={`input-description-${index}`}
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

      {/* Quick Add Part Dialog */}
      <Dialog open={quickAddOpen} onOpenChange={setQuickAddOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add New Product/Service</DialogTitle>
            <DialogDescription>
              Create a new item to add to your catalog and this template.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <FormRow className="grid-cols-2">
              <FormField>
                <FormLabel htmlFor="quick-add-type" required>Type</FormLabel>
                <Select
                  value={quickAddData.type}
                  onValueChange={(v: "product" | "service") =>
                    setQuickAddData((prev) => ({ ...prev, type: v }))
                  }
                >
                  <SelectTrigger id="quick-add-type" data-testid="quick-add-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="product">Product</SelectItem>
                    <SelectItem value="service">Service</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField>
                <FormLabel htmlFor="quick-add-sku" srOnly>SKU</FormLabel>
                <Input
                  id="quick-add-sku"
                  value={quickAddData.sku}
                  onChange={(e) =>
                    setQuickAddData((prev) => ({ ...prev, sku: e.target.value }))
                  }
                  placeholder="Optional"
                  data-testid="quick-add-sku"
                />
              </FormField>
            </FormRow>

            <FormField>
              <FormLabel htmlFor="quick-add-name" srOnly required>Name</FormLabel>
              <Input
                id="quick-add-name"
                value={quickAddData.name}
                onChange={(e) =>
                  setQuickAddData((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Product or service name"
                data-testid="quick-add-name"
              />
            </FormField>

            <FormField>
              <FormLabel htmlFor="quick-add-description" srOnly>Description</FormLabel>
              <Input
                id="quick-add-description"
                value={quickAddData.description}
                onChange={(e) =>
                  setQuickAddData((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder="Optional description"
                data-testid="quick-add-description"
              />
            </FormField>

            <FormField>
              <FormLabel htmlFor="quick-add-price" srOnly>Unit Price</FormLabel>
              <Input
                id="quick-add-price"
                type="number"
                min="0"
                step="0.01"
                value={quickAddData.unitPrice}
                onChange={(e) =>
                  setQuickAddData((prev) => ({
                    ...prev,
                    unitPrice: e.target.value,
                  }))
                }
                placeholder="0.00"
                data-testid="quick-add-price"
              />
            </FormField>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setQuickAddOpen(false)}
              data-testid="quick-add-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!quickAddData.name.trim()) {
                  toast({
                    title: "Validation error",
                    description: "Name is required.",
                    variant: "destructive",
                  });
                  return;
                }
                quickAddPartMutation.mutate(quickAddData);
              }}
              disabled={quickAddPartMutation.isPending}
              data-testid="quick-add-save"
            >
              {quickAddPartMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              )}
              Add to Catalog
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

// ── Per-row product cell using the canonical CreateOrSelectField ──
//
// 2026-04-10 Phase B: Replaces the previous Popover/Command custom selector.
// Each row owns its own search-text state because the canonical
// useProductSearch hook is keyed by query string. The selected ProductOption
// is reconstructed from the canonical draft so the chip renders without a
// parallel `selectedProduct` state.
function JobTemplateProductCell({
  item,
  index,
  onSelect,
  onClear,
  onRequestAddProduct,
}: {
  item: LineItemDraft;
  index: number;
  onSelect: (product: ProductOption) => void;
  onClear: () => void;
  onRequestAddProduct: (searchText: string) => void;
}) {
  const [searchText, setSearchText] = useState("");
  const { data: results = [], isLoading } = useProductSearch(searchText);

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
          setSearchText("");
        }
      }}
      searchResults={results}
      searchLoading={isLoading}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      getKey={getProductKey}
      getLabel={getProductLabel}
      getDescription={getProductDescription}
      createLabel={`Add "${searchText || "new part"}"`}
      onCreateNew={(text) => onRequestAddProduct(text)}
      placeholder="Search products..."
    />
  );
}
