import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus, Trash2, Loader2, GripVertical, Check, ChevronsUpDown, HelpCircle, PlusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JobTemplate, Item } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

interface JobTemplateModalProps {
  open: boolean;
  onClose: () => void;
  template: JobTemplate | null;
}

interface LineItemDraft {
  id: string;
  productId: string;
  descriptionOverride: string;
  quantity: string;
  unitPriceOverride: string;
  productSearchOpen?: boolean;
  searchValue?: string;
}

interface QuickAddPartData {
  name: string;
  type: "product" | "service";
  sku: string;
  description: string;
  unitPrice: string;
}

const JOB_TYPE_OPTIONS = [
  { value: "", label: "None" },
  { value: "service_call", label: "Service Call" },
  { value: "pm", label: "PM" },
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
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddForLineId, setQuickAddForLineId] = useState<string | null>(null);
  const [quickAddData, setQuickAddData] = useState<QuickAddPartData>({
    name: "",
    type: "product",
    sku: "",
    description: "",
    unitPrice: "",
  });

  const { data: catalogData } = useQuery<Item[]>({
    queryKey: ["/api/items", { limit: 200 }],
    queryFn: async () => {
      const res = await fetch("/api/items?limit=200", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch catalog");
      const json = await res.json();
      // Unwrap paginated response: backend returns { data: [...] } when ?limit is explicit
      return Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
    },
    enabled: open,
  });
  // Defensive: normalize in case TanStack Query cache holds a wrapped response from a shared queryKey
  const rawCatalog: Item[] = Array.isArray(catalogData) ? catalogData
    : Array.isArray((catalogData as any)?.data) ? (catalogData as any).data
    : [];
  if (rawCatalog.length === 0 && catalogData && process.env.NODE_ENV !== "production") {
    console.warn("[JobTemplateModal] catalogData was not an array:", typeof catalogData);
  }
  const catalogParts = rawCatalog.filter((p: Item) => p?.isActive !== false);

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
          setLineItems(
            (templateDetails.lines || []).map((line: any, index: number) => ({
              id: line.id || `line_${index}`,
              productId: line.productId || "",
              descriptionOverride: line.descriptionOverride || "",
              quantity: String(line.quantity || "1"),
              unitPriceOverride: line.unitPriceOverride || "",
            }))
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
        setLineItems((prev) =>
          prev.map((item) =>
            item.id === quickAddForLineId
              ? {
                  ...item,
                  productId: newPart.id,
                  unitPriceOverride: newPart.unitPrice?.toString() || "",
                  productSearchOpen: false,
                  searchValue: "",
                }
              : item
          )
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
    toggleProductSearch(lineItemId, false);
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
    const newId = `new_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setLineItems((prev) => [
      ...prev,
      {
        id: newId,
        productId: "",
        descriptionOverride: "",
        quantity: "1",
        unitPriceOverride: "",
      },
    ]);
  };

  const handleRemoveLineItem = (id: string) => {
    setLineItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleLineItemChange = (
    id: string,
    field: keyof LineItemDraft,
    value: string
  ) => {
    setLineItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  };

  const handleProductSelect = (itemId: string, productId: string) => {
    const product = catalogParts.find((p) => p.id === productId);
    setLineItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? {
              ...item,
              productId,
              unitPriceOverride: item.unitPriceOverride || (product?.unitPrice?.toString() ?? ""),
              productSearchOpen: false,
            }
          : item
      )
    );
  };

  const toggleProductSearch = (itemId: string, open: boolean) => {
    setLineItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, productSearchOpen: open } : item
      )
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

    const payload = {
      name: name.trim(),
      jobType: jobType || null,
      description: description.trim() || null,
      isDefaultForJobType: jobType ? isDefaultForJobType : false,
      isActive,
      lines: validLineItems.map((li, index) => ({
        productId: li.productId,
        descriptionOverride: li.descriptionOverride.trim() || null,
        quantity: li.quantity,
        unitPriceOverride: li.unitPriceOverride.trim() || null,
        sortOrder: index,
      })),
    };

    saveMutation.mutate(payload);
  };

  const getProductPrice = (productId: string): string => {
    const product = catalogParts.find((p) => p.id === productId);
    return product?.unitPrice || "0";
  };

  const getProductName = (productId: string): string => {
    const product = catalogParts.find((p) => p.id === productId);
    return product?.name || product?.description || "";
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
                <div className="space-y-2">
                  <Label htmlFor="name">Name *</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Standard Service Call"
                    data-testid="input-template-name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="jobType">Job Type</Label>
                  <Select
                    value={jobType || "none"}
                    onValueChange={(val) => setJobType(val === "none" ? "" : val)}
                  >
                    <SelectTrigger data-testid="select-job-type">
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
                </div>
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
                      {lineItems.map((item, index) => {
                        const defaultPrice = item.productId
                          ? getProductPrice(item.productId)
                          : "";
                        const selectedProduct = item.productId
                          ? catalogParts.find((p) => p.id === item.productId)
                          : null;
                        return (
                          <TableRow key={item.id}>
                            <TableCell className="text-muted-foreground cursor-grab">
                              <GripVertical className="h-4 w-4" />
                            </TableCell>
                            <TableCell>
                              <Popover
                                open={item.productSearchOpen}
                                onOpenChange={(open) => toggleProductSearch(item.id, open)}
                              >
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={item.productSearchOpen}
                                    className="w-full justify-between text-sm font-normal"
                                    data-testid={`select-product-${index}`}
                                  >
                                    <span className="truncate">
                                      {selectedProduct
                                        ? selectedProduct.name || selectedProduct.description
                                        : "Select product..."}
                                    </span>
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[300px] p-0" align="start">
                                  <Command>
                                    <CommandInput
                                      placeholder="Search products..."
                                      value={item.searchValue || ""}
                                      onValueChange={(val) =>
                                        setLineItems((prev) =>
                                          prev.map((li) =>
                                            li.id === item.id
                                              ? { ...li, searchValue: val }
                                              : li
                                          )
                                        )
                                      }
                                    />
                                    <CommandList>
                                      <CommandEmpty>
                                        <div className="py-2 text-center">
                                          <p className="text-sm text-muted-foreground mb-2">
                                            No products found.
                                          </p>
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                              openQuickAddDialog(
                                                item.id,
                                                item.searchValue || ""
                                              )
                                            }
                                            data-testid={`button-add-part-${index}`}
                                          >
                                            <PlusCircle className="h-4 w-4 mr-1" />
                                            Add "{item.searchValue || "new part"}"
                                          </Button>
                                        </div>
                                      </CommandEmpty>
                                      <CommandGroup>
                                        {catalogParts.map((p) => (
                                          <CommandItem
                                            key={p.id}
                                            value={p.name || p.description || p.id}
                                            onSelect={() => handleProductSelect(item.id, p.id)}
                                          >
                                            <Check
                                              className={cn(
                                                "mr-2 h-4 w-4",
                                                item.productId === p.id
                                                  ? "opacity-100"
                                                  : "opacity-0"
                                              )}
                                            />
                                            <div className="flex flex-col">
                                              <span>{p.name || p.description}</span>
                                              {p.sku && (
                                                <span className="text-xs text-muted-foreground">
                                                  SKU: {p.sku}
                                                </span>
                                              )}
                                            </div>
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>
                            </TableCell>
                            <TableCell>
                              <Input
                                value={item.descriptionOverride}
                                onChange={(e) =>
                                  handleLineItemChange(
                                    item.id,
                                    "descriptionOverride",
                                    e.target.value
                                  )
                                }
                                placeholder={selectedProduct?.description || "Leave blank for default"}
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
                                  handleLineItemChange(
                                    item.id,
                                    "quantity",
                                    e.target.value
                                  )
                                }
                                className="text-sm"
                                data-testid={`input-quantity-${index}`}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={item.unitPriceOverride}
                                  onChange={(e) =>
                                    handleLineItemChange(
                                      item.id,
                                      "unitPriceOverride",
                                      e.target.value
                                    )
                                  }
                                  placeholder={defaultPrice ? `$${defaultPrice}` : ""}
                                  className="text-sm"
                                  data-testid={`input-price-${index}`}
                                />
                                {item.productId && !item.unitPriceOverride && (
                                  <p className="text-[10px] text-muted-foreground">
                                    Default: ${defaultPrice}
                                  </p>
                                )}
                              </div>
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
                        );
                      })}
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Type *</Label>
                <Select
                  value={quickAddData.type}
                  onValueChange={(v: "product" | "service") =>
                    setQuickAddData((prev) => ({ ...prev, type: v }))
                  }
                >
                  <SelectTrigger data-testid="quick-add-type">
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
                <Input
                  value={quickAddData.sku}
                  onChange={(e) =>
                    setQuickAddData((prev) => ({ ...prev, sku: e.target.value }))
                  }
                  placeholder="Optional"
                  data-testid="quick-add-sku"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Name *</Label>
              <Input
                value={quickAddData.name}
                onChange={(e) =>
                  setQuickAddData((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Product or service name"
                data-testid="quick-add-name"
              />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Input
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
            </div>

            <div className="space-y-2">
              <Label>Unit Price</Label>
              <Input
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
            </div>
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
