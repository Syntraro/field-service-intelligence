import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Loader2, Check, X, FileText, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { JobPart, Item, JobTemplate } from "@shared/schema";
import { useAuth } from "@/lib/auth";

// Office roles that can apply templates
const OFFICE_ROLES = ["owner", "admin", "manager", "dispatcher"];

interface PartsBillingCardProps {
  jobId: string;
}

interface LocalLineItem {
  id: string;
  isNew?: boolean;
  isDraft?: boolean;
  productId?: string | null;
  description: string;
  notes: string;
  quantity: string;
  unitCost: string;
  unitPrice: string;
  source: string;
  sortOrder: number;
}

interface OriginalItemState {
  productId?: string | null;
  description: string;
  notes: string;
  quantity: string;
  unitCost: string;
  unitPrice: string;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

export function PartsBillingCard({ jobId }: PartsBillingCardProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const isOfficeUser = Boolean(user?.role && OFFICE_ROLES.includes(user.role));

  const [items, setItems] = useState<LocalLineItem[]>([]);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [originalItems, setOriginalItems] = useState<Record<string, OriginalItemState>>({});
  const [productModalState, setProductModalState] = useState<{
    open: boolean;
    seedName: string;
    lineItemId: string | null;
  }>({ open: false, seedName: "", lineItemId: null });
  const [templateConfirmState, setTemplateConfirmState] = useState<{
    open: boolean;
    templateId: string | null;
    templateName: string;
    mode: "replace" | "merge";
  }>({ open: false, templateId: null, templateName: "", mode: "replace" });
  const lastSyncedPartsRef = useRef<string>("");

  const { data: jobParts = [], isLoading: partsLoading } = useQuery<JobPart[]>({
    queryKey: ["/api/jobs", jobId, "parts"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/parts`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch job parts");
      return res.json();
    },
  });

  const { data: jobTemplates = [] } = useQuery<JobTemplate[]>({
    queryKey: ["/api/job-templates"],
    queryFn: async () => {
      const res = await fetch("/api/job-templates", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch job templates");
      return res.json();
    },
  });

  const applyTemplateMutation = useMutation({
    mutationFn: async ({ templateId, mode }: { templateId: string; mode: "replace" | "merge" }) => {
      if (mode === "replace" && jobParts.length > 0) {
        // Delete all existing line items before applying template
        for (const part of jobParts) {
          await apiRequest(`/api/jobs/${jobId}/parts/${part.id}`, {
            method: "DELETE",
          });
        }
      }
      return apiRequest<{ appliedCount: number; skippedCount: number; parts: any[] }>(
        "/api/job-templates/apply-to-job",
        {
          method: "POST",
          body: JSON.stringify({ jobId, templateId, mode }),
        }
      );
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "parts"] });
      // Phase 4 Step C5: canonical family key
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      const modeLabel = variables.mode === "replace" ? "replaced" : "merged";
      const skipMsg = data.skippedCount > 0 ? ` (${data.skippedCount} duplicates skipped)` : "";
      toast({
        title: "Template applied",
        description: `${data.appliedCount} items ${modeLabel}${skipMsg}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleApplyTemplate = (templateId: string) => {
    const template = jobTemplates.find(t => t.id === templateId);
    const templateName = template?.name || "selected template";

    // If no existing items, apply directly as replace
    if (items.filter(i => !i.isNew).length === 0) {
      applyTemplateMutation.mutate({ templateId, mode: "replace" });
    } else {
      // Show dialog to choose between Replace and Merge
      setTemplateConfirmState({ open: true, templateId, templateName, mode: "replace" });
    }
  };

  const handleConfirmTemplateApply = () => {
    if (templateConfirmState.templateId) {
      applyTemplateMutation.mutate({
        templateId: templateConfirmState.templateId,
        mode: templateConfirmState.mode,
      });
    }
    setTemplateConfirmState({ open: false, templateId: null, templateName: "", mode: "replace" });
  };

  const { data: catalogData } = useQuery<{ items: Item[] }>({
    queryKey: ["/api/items", { limit: 200 }],
    queryFn: async () => {
      const res = await fetch("/api/items?limit=200", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch catalog");
      return res.json();
    },
  });
  const catalogParts = useMemo(() => {
    if (!catalogData) return [];
    if (Array.isArray(catalogData)) return catalogData;
    return catalogData?.items ?? (catalogData as any)?.data ?? [];
  }, [catalogData]);

  useEffect(() => {
    if (!jobParts || editingRowId) return;
    
    const catalogKey = catalogParts.map(p => p.id + p.cost + p.unitPrice).join(",");
    const partsKey = JSON.stringify(jobParts.map(jp => jp.id + jp.quantity + jp.unitCost + jp.unitPrice + jp.productId + jp.sortOrder)) + "|" + catalogKey;
    if (partsKey === lastSyncedPartsRef.current) return;
    
    const mappedItems = jobParts.map((jp, index) => {
      const catalogItem = catalogParts.find((p) => p.id === jp.productId);
      const productName = catalogItem?.name || catalogItem?.description || "";
      return {
        id: jp.id,
        isNew: false,
        isDraft: false,
        productId: jp.productId,
        description: productName || jp.description,
        notes: productName ? jp.description : "",
        quantity: jp.quantity,
        unitCost: jp.unitCost || catalogItem?.cost || "0",
        unitPrice: jp.unitPrice || "0",
        source: "manual",
        sortOrder: jp.sortOrder ?? index,
      };
    });
    lastSyncedPartsRef.current = partsKey;
    setItems(mappedItems);
  }, [jobParts, catalogParts, editingRowId]);

  const reorderMutation = useMutation({
    mutationFn: async (newOrder: { id: string; sortOrder: number }[]) => {
      return await apiRequest(`/api/jobs/${jobId}/parts/reorder`, {
        method: "PATCH",
        body: JSON.stringify({ parts: newOrder }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "parts"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to reorder items.", variant: "destructive" });
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    
    const newItems = arrayMove(items, oldIndex, newIndex).map((item, idx) => ({
      ...item,
      sortOrder: idx,
    }));
    
    setItems(newItems);
    reorderMutation.mutate(
      newItems.filter(i => !i.isNew).map((item, idx) => ({ id: item.id, sortOrder: idx }))
    );
  };

  const { totalPrice, totalCost, profit, margin } = useMemo(() => {
    const totalPrice = items.reduce(
      (sum, i) => sum + parseFloat(i.unitPrice || "0") * parseFloat(i.quantity || "0"),
      0
    );
    const totalCost = items.reduce(
      (sum, i) => sum + parseFloat(i.unitCost || "0") * parseFloat(i.quantity || "0"),
      0
    );
    const profit = totalPrice - totalCost;
    const margin = totalPrice > 0 ? (profit / totalPrice) * 100 : 0;
    return { totalPrice, totalCost, profit, margin };
  }, [items]);

  const handleAddLineItem = () => {
    const id = `new_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newItem: LocalLineItem = {
      id,
      isNew: true,
      isDraft: true,
      description: "",
      notes: "",
      quantity: "1",
      unitCost: "",
      unitPrice: "",
      source: "manual",
      sortOrder: items.length,
    };
    setItems((prev) => [...prev, newItem]);
    setEditingRowId(id);
    setOriginalItems((prev) => ({
      ...prev,
      [id]: {
        productId: null,
        description: "",
        notes: "",
        quantity: "1",
        unitCost: "",
        unitPrice: "",
      },
    }));
  };

  const handleEnterEdit = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (item) {
      setOriginalItems((prev) => ({
        ...prev,
        [id]: {
          productId: item.productId,
          description: item.description,
          notes: item.notes,
          quantity: item.quantity,
          unitCost: item.unitCost,
          unitPrice: item.unitPrice,
        },
      }));
    }
    setEditingRowId(id);
  };

  const handleRowChange = (id: string, patch: Partial<LocalLineItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch, isDraft: true } : item))
    );
  };

  const handleRowCancel = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (item?.isNew) {
      setItems((prev) => prev.filter((i) => i.id !== id));
    } else {
      const orig = originalItems[id];
      if (orig) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === id
              ? { ...i, ...orig, isDraft: false }
              : i
          )
        );
      }
    }
    setEditingRowId(null);
  };

  const handleRowDelete = async (id: string) => {
    const item = items.find((i) => i.id === id);
    if (item?.isNew) {
      setItems((prev) => prev.filter((i) => i.id !== id));
      if (editingRowId === id) setEditingRowId(null);
      return;
    }
    
    try {
      setSavingRowId(id);
      await apiRequest(`/api/jobs/${jobId}/parts/${id}`, {
        method: "DELETE",
      });
      await queryClient.refetchQueries({ queryKey: ["/api/jobs", jobId, "parts"] });
      if (editingRowId === id) setEditingRowId(null);
      toast({ title: "Deleted", description: "Line item removed." });
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete line item.", variant: "destructive" });
    } finally {
      setSavingRowId(null);
    }
  };

  const handleRowSave = async (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;

    try {
      setSavingRowId(id);
      const qty = String(parseFloat(item.quantity) || 1);
      const price = String(parseFloat(item.unitPrice) || 0);
      const desc = item.notes?.trim() || item.description || "Unnamed item";
        
      const cost = String(parseFloat(item.unitCost) || 0);
      
      if (item.isNew) {
        await apiRequest(`/api/jobs/${jobId}/parts`, {
          method: "POST",
          body: JSON.stringify({
            description: desc,
            quantity: qty,
            unitCost: cost,
            unitPrice: price,
            productId: item.productId || null,
            source: item.source || "manual",
          }),
        });
      } else {
        await apiRequest(`/api/jobs/${jobId}/parts/${item.id}`, {
          method: "PUT",
          body: JSON.stringify({
            description: desc,
            quantity: qty,
            unitCost: cost,
            unitPrice: price,
            productId: item.productId || null,
            source: item.source,
          }),
        });
      }

      await queryClient.refetchQueries({ queryKey: ["/api/jobs", jobId, "parts"] });
      setEditingRowId(null);
      toast({ title: "Saved", description: "Line item saved." });
    } catch (error) {
      toast({ title: "Error", description: "Failed to save line item.", variant: "destructive" });
    } finally {
      setSavingRowId(null);
    }
  };

  const handleSelectProduct = (lineId: string, product: Item) => {
    handleRowChange(lineId, {
      productId: product.id,
      description: product.name || product.description || "",
      notes: "",
      unitCost: product.cost || "0",
      unitPrice: product.unitPrice || "0",
    });
  };

  const createProductMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; cost: string; unitPrice: string; type: string }) => {
      return await apiRequest<Item>("/api/items", {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          description: data.description || null,
          cost: String(parseFloat(data.cost) || 0),
          unitPrice: String(parseFloat(data.unitPrice) || 0),
          type: data.type,
          isTaxable: true,
          isActive: true,
        }),
      });
    },
    onSuccess: (newPart: Item) => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      if (productModalState.lineItemId) {
        handleRowChange(productModalState.lineItemId, {
          productId: newPart.id,
          description: newPart.name || newPart.description || "",
          unitCost: newPart.cost || "0",
          unitPrice: newPart.unitPrice || "0",
        });
      }
      setProductModalState({ open: false, seedName: "", lineItemId: null });
      toast({ title: "Product created", description: "New product added to catalog." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create product.", variant: "destructive" });
    },
  });

  if (partsLoading) {
    return (
      <Card data-testid="card-parts-billing">
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card data-testid="card-parts-billing">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-sm font-semibold">Parts & Billing</CardTitle>
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg bg-muted/50 border">
              <div className="text-center">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Price</div>
                <div className="text-base font-bold">{formatCurrency(totalPrice)}</div>
              </div>
              <div className="text-center">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Cost</div>
                <div className="text-base font-bold">{formatCurrency(totalCost)}</div>
              </div>
              <div className="text-center">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Profit</div>
                <div className={`text-base font-bold ${profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {formatCurrency(profit)}
                  <span className="ml-1 text-xs font-medium text-muted-foreground">({margin.toFixed(1)}%)</span>
                </div>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-visible">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <table className="min-w-full text-xs">
                <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-2 w-8"></th>
                    <th className="py-2 pr-3 text-left font-medium">Product / Service</th>
                    <th className="py-2 px-3 text-right font-medium w-20">Qty</th>
                    <th className="py-2 px-3 text-right font-medium w-28">Cost</th>
                    <th className="py-2 px-3 text-right font-medium w-28">Price</th>
                    <th className="py-2 pl-3 text-right font-medium w-28">Total</th>
                  </tr>
                </thead>
                <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  <tbody>
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-xs text-muted-foreground">
                          No line items yet. Add parts or services to this job.
                        </td>
                      </tr>
                    )}
                    {items.map((item) => (
                      <SortableLineItemRow
                        key={item.id}
                        item={item}
                        catalog={catalogParts.filter((p) => p.isActive !== false)}
                        isEditing={editingRowId === item.id}
                        isSaving={savingRowId === item.id}
                        onEnterEdit={() => handleEnterEdit(item.id)}
                        onChange={(patch) => handleRowChange(item.id, patch)}
                        onSave={() => handleRowSave(item.id)}
                        onCancel={() => handleRowCancel(item.id)}
                        onDelete={() => handleRowDelete(item.id)}
                        onSelectProduct={(product) => handleSelectProduct(item.id, product)}
                        onRequestAddProduct={(name) =>
                          setProductModalState({ open: true, seedName: name, lineItemId: item.id })
                        }
                      />
                    ))}
                  </tbody>
                </SortableContext>
              </table>
            </DndContext>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddLineItem}
              data-testid="button-add-line-item"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Line Item
            </Button>
            {isOfficeUser && jobTemplates.length > 0 && (
              <Select
                onValueChange={(templateId) => {
                  if (templateId) {
                    handleApplyTemplate(templateId);
                  }
                }}
                disabled={applyTemplateMutation.isPending}
              >
                <SelectTrigger
                  className="h-8 w-auto min-w-[160px]"
                  data-testid="select-apply-template"
                >
                  <FileText className="h-3 w-3 mr-1" />
                  <SelectValue placeholder="Apply Template..." />
                </SelectTrigger>
                <SelectContent>
                  {jobTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                      {template.isDefaultForJobType && (
                        <span className="ml-1 text-xs text-muted-foreground">(Default)</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {applyTemplateMutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={templateConfirmState.open}
        onOpenChange={(open) => !open && setTemplateConfirmState({ open: false, templateId: null, templateName: "", mode: "replace" })}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apply Template</DialogTitle>
            <DialogDescription>
              How would you like to apply the "{templateConfirmState.templateName}" template to this job?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <div
              className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                templateConfirmState.mode === "replace"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/50"
              }`}
              onClick={() => setTemplateConfirmState((prev) => ({ ...prev, mode: "replace" }))}
              data-testid="option-replace"
            >
              <div className="flex items-center gap-2">
                <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                  templateConfirmState.mode === "replace" ? "border-primary" : "border-muted-foreground/50"
                }`}>
                  {templateConfirmState.mode === "replace" && (
                    <div className="h-2 w-2 rounded-full bg-primary" />
                  )}
                </div>
                <span className="font-medium text-sm">Replace existing items</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground ml-6">
                Remove all current line items and replace with template items.
              </p>
            </div>
            <div
              className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                templateConfirmState.mode === "merge"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/50"
              }`}
              onClick={() => setTemplateConfirmState((prev) => ({ ...prev, mode: "merge" }))}
              data-testid="option-merge"
            >
              <div className="flex items-center gap-2">
                <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                  templateConfirmState.mode === "merge" ? "border-primary" : "border-muted-foreground/50"
                }`}>
                  {templateConfirmState.mode === "merge" && (
                    <div className="h-2 w-2 rounded-full bg-primary" />
                  )}
                </div>
                <span className="font-medium text-sm">Merge with existing items</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground ml-6">
                Add template items without removing existing ones. Duplicates (same product) will be skipped.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTemplateConfirmState({ open: false, templateId: null, templateName: "", mode: "replace" })}
              data-testid="button-cancel-template"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmTemplateApply}
              disabled={applyTemplateMutation.isPending}
              data-testid="button-confirm-template"
            >
              {applyTemplateMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Apply Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddProductModal
        open={productModalState.open}
        initialName={productModalState.seedName}
        onClose={() => setProductModalState({ open: false, seedName: "", lineItemId: null })}
        onSave={(data) => createProductMutation.mutate(data)}
        isSaving={createProductMutation.isPending}
      />
    </>
  );
}

interface LineItemRowProps {
  item: LocalLineItem;
  catalog: Item[];
  isEditing: boolean;
  isSaving: boolean;
  onEnterEdit: () => void;
  onChange: (patch: Partial<LocalLineItem>) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onSelectProduct: (product: Item) => void;
  onRequestAddProduct: (name: string) => void;
}

function LineItemRow({
  item,
  catalog,
  isEditing,
  isSaving,
  onEnterEdit,
  onChange,
  onSave,
  onCancel,
  onDelete,
  onSelectProduct,
  onRequestAddProduct,
}: LineItemRowProps) {
  const [query, setQuery] = useState(item.description ?? "");
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    setQuery(item.description ?? "");
  }, [item.description]);

  const suggestions = useMemo(() => {
    if (!query.trim()) return catalog.slice(0, 8);
    const lower = query.toLowerCase();
    return catalog
      .filter((c) => (c.name || c.description || "").toLowerCase().includes(lower))
      .slice(0, 8);
  }, [catalog, query]);

  const lineTotal = parseFloat(item.unitPrice || "0") * parseFloat(item.quantity || "0");

  if (!isEditing) {
    return (
      <tr
        className={`border-b border-border/50 hover:bg-muted/50 cursor-pointer ${item.isDraft ? 'bg-amber-50 dark:bg-amber-950/20 border-l-2 border-l-amber-400' : ''}`}
        onClick={onEnterEdit}
        data-testid={`row-line-item-${item.id}`}
      >
        <td className="py-3 pr-3 align-top">
          <div className="flex items-center gap-2">
            <div className="text-xs font-medium">
              {item.description || <span className="italic text-muted-foreground">No product</span>}
            </div>
            {item.isDraft && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium">
                Draft
              </span>
            )}
          </div>
          {item.notes && (
            <div className="mt-0.5 text-[11px] text-muted-foreground">{item.notes}</div>
          )}
        </td>
        <td className="py-3 px-3 text-right align-top text-xs">{item.quantity}</td>
        <td className="py-3 px-3 text-right align-top text-xs">{formatCurrency(parseFloat(item.unitCost || "0"))}</td>
        <td className="py-3 px-3 text-right align-top text-xs">{formatCurrency(parseFloat(item.unitPrice || "0"))}</td>
        <td className="py-3 pl-3 pr-1 text-right align-top text-xs font-semibold">{formatCurrency(lineTotal)}</td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-border/50 bg-primary/5">
      <td className="py-2.5 pr-3 align-top">
        <div className="relative">
          <Input
            className="text-xs"
            placeholder="Search product / service..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              onChange({ description: e.target.value });
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            data-testid={`input-product-search-${item.id}`}
          />
          {showDropdown && (
            <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover shadow-lg">
              {suggestions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelectProduct(c);
                    setQuery(c.name || c.description || "");
                    setShowDropdown(false);
                  }}
                  className="flex w-full flex-col items-start px-2.5 py-1.5 text-left hover:bg-muted"
                >
                  <span className="text-xs">{c.name || c.description}</span>
                  {c.sku && <span className="text-[11px] text-muted-foreground">SKU: {c.sku}</span>}
                </button>
              ))}
              <div className="border-t" />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onRequestAddProduct(query)}
                className="flex w-full items-center px-2.5 py-1.5 text-left text-xs text-primary hover:bg-primary/10"
              >
                + Add "{query || "new item"}" as product
              </button>
            </div>
          )}
        </div>
        <Input
          className="mt-1.5 text-xs"
          placeholder="Description / notes..."
          value={item.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          data-testid={`input-notes-${item.id}`}
        />
        <div className="flex items-center gap-2 mt-2">
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={isSaving}
            data-testid={`button-save-line-${item.id}`}
            className="h-7 text-xs"
          >
            {isSaving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                <Check className="h-3 w-3 mr-1" />
                Save
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={isSaving}
            data-testid={`button-cancel-line-${item.id}`}
            className="h-7 text-xs"
          >
            <X className="h-3 w-3 mr-1" />
            Cancel
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={isSaving}
            className="h-7 text-xs text-destructive hover:text-destructive"
            data-testid={`button-delete-line-${item.id}`}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Delete
          </Button>
        </div>
      </td>
      <td className="py-2.5 px-3 align-top">
        <Input
          type="number"
          min={0}
          className="text-xs text-right w-full"
          value={item.quantity}
          onChange={(e) => onChange({ quantity: e.target.value || "0" })}
          data-testid={`input-qty-${item.id}`}
        />
      </td>
      <td className="py-2.5 px-3 align-top">
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
          <Input
            type="number"
            min={0}
            step="0.01"
            placeholder="0.00"
            className="text-xs text-right w-full pl-5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            value={item.unitCost || ""}
            onChange={(e) => onChange({ unitCost: e.target.value })}
            data-testid={`input-cost-${item.id}`}
          />
        </div>
      </td>
      <td className="py-2.5 px-3 align-top">
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
          <Input
            type="number"
            min={0}
            step="0.01"
            placeholder="0.00"
            className="text-xs text-right w-full pl-5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            value={item.unitPrice || ""}
            onChange={(e) => onChange({ unitPrice: e.target.value })}
            data-testid={`input-price-${item.id}`}
          />
        </div>
      </td>
      <td className="py-2.5 pl-3 pr-1 align-top text-right text-xs font-semibold">{formatCurrency(lineTotal)}</td>
    </tr>
  );
}

function SortableLineItemRow(props: LineItemRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const [query, setQuery] = useState(props.item.description ?? "");
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    setQuery(props.item.description ?? "");
  }, [props.item.description]);

  const suggestions = useMemo(() => {
    if (!query.trim()) return props.catalog.slice(0, 8);
    const lower = query.toLowerCase();
    return props.catalog
      .filter((c) => (c.name || c.description || "").toLowerCase().includes(lower))
      .slice(0, 8);
  }, [props.catalog, query]);

  const lineTotal = parseFloat(props.item.unitPrice || "0") * parseFloat(props.item.quantity || "0");

  if (!props.isEditing) {
    return (
      <tr
        ref={setNodeRef}
        style={style}
        className={`border-b border-border/50 hover:bg-muted/50 cursor-pointer ${props.item.isDraft ? 'bg-amber-50 dark:bg-amber-950/20 border-l-2 border-l-amber-400' : ''}`}
        onClick={props.onEnterEdit}
        data-testid={`row-line-item-${props.item.id}`}
      >
        <td className="py-3 pr-2 align-top w-8">
          <div
            className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            role="button"
            tabIndex={0}
            data-testid={`drag-handle-${props.item.id}`}
          >
            <GripVertical className="h-4 w-4" />
          </div>
        </td>
        <td className="py-3 pr-3 align-top">
          <div className="flex items-center gap-2">
            <div className="text-xs font-medium">
              {props.item.description || <span className="italic text-muted-foreground">No product</span>}
            </div>
            {props.item.isDraft && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium">
                Draft
              </span>
            )}
          </div>
          {props.item.notes && (
            <div className="mt-0.5 text-[11px] text-muted-foreground">{props.item.notes}</div>
          )}
        </td>
        <td className="py-3 px-3 text-right align-top text-xs">{props.item.quantity}</td>
        <td className="py-3 px-3 text-right align-top text-xs">{formatCurrency(parseFloat(props.item.unitCost || "0"))}</td>
        <td className="py-3 px-3 text-right align-top text-xs">{formatCurrency(parseFloat(props.item.unitPrice || "0"))}</td>
        <td className="py-3 pl-3 pr-1 text-right align-top text-xs font-semibold">
          {formatCurrency(lineTotal)}
        </td>
      </tr>
    );
  }

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className="border-b border-border/50 bg-primary/5"
    >
      <td className="py-2.5 pr-2 align-top w-8">
        <div
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
          {...attributes}
          {...listeners}
          role="button"
          tabIndex={0}
          data-testid={`drag-handle-${props.item.id}`}
        >
          <GripVertical className="h-4 w-4" />
        </div>
      </td>
      <td className="py-2.5 pr-3 align-top">
        <div className="relative">
          <Input
            className="text-xs"
            placeholder="Search product / service..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              props.onChange({ description: e.target.value });
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            data-testid={`input-product-search-${props.item.id}`}
          />
          {showDropdown && (
            <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover shadow-lg">
              {suggestions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    props.onSelectProduct(c);
                    setQuery(c.name || c.description || "");
                    setShowDropdown(false);
                  }}
                  className="flex w-full flex-col items-start px-2.5 py-1.5 text-left hover:bg-muted"
                >
                  <span className="text-xs">{c.name || c.description}</span>
                  {c.sku && <span className="text-[11px] text-muted-foreground">SKU: {c.sku}</span>}
                </button>
              ))}
              <div className="border-t" />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => props.onRequestAddProduct(query)}
                className="flex w-full items-center px-2.5 py-1.5 text-left text-xs text-primary hover:bg-primary/10"
              >
                + Add "{query || "new item"}" as product
              </button>
            </div>
          )}
        </div>
        <Input
          className="mt-1.5 text-xs"
          placeholder="Description / notes..."
          value={props.item.notes}
          onChange={(e) => props.onChange({ notes: e.target.value })}
          data-testid={`input-notes-${props.item.id}`}
        />
        <div className="flex items-center gap-2 mt-2">
          <Button
            type="button"
            size="sm"
            onClick={props.onSave}
            disabled={props.isSaving}
            data-testid={`button-save-line-${props.item.id}`}
            className="h-7 text-xs"
          >
            {props.isSaving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                <Check className="h-3 w-3 mr-1" />
                Save
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={props.onCancel}
            disabled={props.isSaving}
            data-testid={`button-cancel-line-${props.item.id}`}
            className="h-7 text-xs"
          >
            <X className="h-3 w-3 mr-1" />
            Cancel
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={props.onDelete}
            disabled={props.isSaving}
            className="h-7 text-xs text-destructive hover:text-destructive"
            data-testid={`button-delete-line-${props.item.id}`}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Delete
          </Button>
        </div>
      </td>
      <td className="py-2.5 px-3 align-top">
        <Input
          type="number"
          min={0}
          className="text-xs text-right w-full"
          value={props.item.quantity}
          onChange={(e) => props.onChange({ quantity: e.target.value || "0" })}
          data-testid={`input-qty-${props.item.id}`}
        />
      </td>
      <td className="py-2.5 px-3 align-top">
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
          <Input
            type="number"
            min={0}
            step="0.01"
            placeholder="0.00"
            className="text-xs text-right w-full pl-5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            value={props.item.unitCost || ""}
            onChange={(e) => props.onChange({ unitCost: e.target.value })}
            data-testid={`input-cost-${props.item.id}`}
          />
        </div>
      </td>
      <td className="py-2.5 px-3 align-top">
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
          <Input
            type="number"
            min={0}
            step="0.01"
            placeholder="0.00"
            className="text-xs text-right w-full pl-5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            value={props.item.unitPrice || ""}
            onChange={(e) => props.onChange({ unitPrice: e.target.value })}
            data-testid={`input-price-${props.item.id}`}
          />
        </div>
      </td>
      <td className="py-2.5 pl-3 pr-1 align-top text-right text-xs font-semibold">{formatCurrency(lineTotal)}</td>
    </tr>
  );
}

interface AddProductModalProps {
  open: boolean;
  initialName: string;
  onClose: () => void;
  onSave: (data: { name: string; description?: string; cost: string; unitPrice: string; type: string }) => void;
  isSaving: boolean;
}

function AddProductModal({ open, initialName, onClose, onSave, isSaving }: AddProductModalProps) {
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
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add new product</DialogTitle>
            <DialogDescription>
              This item will be added to your Products & Services and linked to this line item.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-xs font-medium">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                data-testid="input-new-product-name"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Description (optional)</label>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                data-testid="input-new-product-description"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium">Type</label>
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
                <label className="text-xs font-medium">Unit Cost</label>
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
                <label className="text-xs font-medium">Unit Price</label>
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-add-product">
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving || !name.trim()} data-testid="button-save-product">
              {isSaving ? "Saving..." : "Save product"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default PartsBillingCard;
