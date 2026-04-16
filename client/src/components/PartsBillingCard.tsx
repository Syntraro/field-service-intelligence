/**
 * PartsBillingCard — Job parts editor on the Job Detail page.
 *
 * 2026-04-10 (P9-P10 Phase B): Migrated to the canonical client pipeline.
 *
 *   - Local `LocalLineItem` / `OriginalItemState` shadow types: REMOVED.
 *   - Direct `/api/items?limit=1000` prefetch: REMOVED.
 *   - Custom inline product-search dropdown: REPLACED with the canonical
 *     `CreateOrSelectField` + `useProductSearch` selector.
 *   - Inline catalog→draft mapping in `handleSelectProduct`: REPLACED with
 *     `catalogItemToDraft(productOptionToCatalogItem(product), {...})`.
 *   - Inline POST/PUT job-part payload construction: REPLACED with
 *     `draftToJobPartPayload(draft)` (server-side projection via
 *     `canonicalToJobPartFields` in `server/routes/jobs.ts`).
 *   - Dead `LineItemRow` component (defined but never rendered — only
 *     `SortableLineItemRow` was used): REMOVED.
 *   - Per-row notes textarea: REMOVED. The canonical model uses a single
 *     editable description field per row. The persisted `description`
 *     column on `job_parts` is the line label; if a user picked a product,
 *     the catalog name auto-fills and they can edit it.
 *
 * Preserved behavior:
 *   - Add / edit / delete / save / cancel row workflow
 *   - Drag-and-drop reorder
 *   - Apply Template (replace / merge) flow + AddProductModal create-new
 *   - Margin / profit / total reporting to parent
 *   - Same query keys + invalidation cadence (no SSE/refetch drift)
 */
import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Loader2, Check, X, FileText, GripVertical, Search, Star } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  draftToJobPartPayload,
} from "@/lib/entities/lineItemMapper";
import { useAuth } from "@/lib/auth";

// Office roles that can apply templates
const OFFICE_ROLES = ["owner", "admin", "manager", "dispatcher"];

interface PartsBillingCardProps {
  jobId: string;
  /** Report computed totals to parent (for displaying in section header) */
  onTotalsChange?: (totals: { totalPrice: number; totalCost: number; profit: number }) => void;
}

/**
 * Display-only currency formatter.
 *
 * Uses the standard browser `Intl.NumberFormat` for the `$1,234.56` rendering
 * — this is the only display-side helper. Money parsing always goes through
 * `parseMoney` from `@shared/lineItem`; never through bare `parseFloat`.
 */
function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

export function PartsBillingCard({ jobId, onTotalsChange }: PartsBillingCardProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const isOfficeUser = Boolean(user?.role && OFFICE_ROLES.includes(user.role));

  // 2026-04-10 Phase B: items are canonical `LineItemDraft[]` — same shape as
  // every other line-item surface in the client. No local shadow type.
  const [items, setItems] = useState<LineItemDraft[]>([]);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  // Snapshot of the original draft at edit-start, for cancel-restore.
  const [originalDrafts, setOriginalDrafts] = useState<Record<string, LineItemDraft>>({});
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
  // Template picker dialog state
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  const lastSyncedPartsRef = useRef<string>("");

  const { data: jobParts = [], isLoading: partsLoading } = useQuery<(JobPart & { itemType?: string | null })[]>({
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

  // 2026-04-10 Phase B: Hydrate persisted job_parts rows into canonical drafts.
  // No catalog prefetch — the persisted `description` is the canonical line
  // label. Catalog reads are now per-row via `useProductSearch`.
  useEffect(() => {
    if (!jobParts || editingRowId) return;

    const partsKey = JSON.stringify(
      jobParts.map(jp => jp.id + jp.quantity + jp.unitCost + jp.unitPrice + jp.productId + jp.sortOrder),
    );
    if (partsKey === lastSyncedPartsRef.current) return;

    const mappedItems: LineItemDraft[] = jobParts.map((jp, index) => {
      const draft = hydrateDraft({
        ...jp,
        // job_parts has no `notes`, no tax/total fields, no `lineItemType`,
        // no `source` — hydrateDraft fills safe defaults.
        sortOrder: jp.sortOrder ?? index,
      });
      // Carry the catalog itemType through so the row can show the right
      // affordance (product vs service) without re-fetching the catalog.
      if (jp.itemType === "product" || jp.itemType === "service") {
        draft.productType = jp.itemType;
      }
      return draft;
    });
    lastSyncedPartsRef.current = partsKey;
    setItems(mappedItems);
  }, [jobParts, editingRowId]);

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
    // 2026-04-10 Phase B: parseMoney is the canonical money parser; do not use
    // bare parseFloat on money strings.
    const totalPrice = items.reduce(
      (sum, i) => sum + parseMoney(i.unitPrice) * parseMoney(i.quantity),
      0
    );
    const totalCost = items.reduce(
      (sum, i) => sum + parseMoney(i.unitCost) * parseMoney(i.quantity),
      0
    );
    const profit = totalPrice - totalCost;
    const margin = totalPrice > 0 ? (profit / totalPrice) * 100 : 0;
    return { totalPrice, totalCost, profit, margin };
  }, [items]);

  // Report totals to parent for section header display
  useEffect(() => {
    onTotalsChange?.({ totalPrice, totalCost, profit });
  }, [totalPrice, totalCost, profit, onTotalsChange]);

  const handleAddLineItem = () => {
    // 2026-04-10 Phase B: blank canonical draft instead of inline literal.
    const draft = blankDraft({ source: "manual", sortOrder: items.length });
    setItems((prev) => [...prev, draft]);
    setEditingRowId(draft.id);
    setOriginalDrafts((prev) => ({ ...prev, [draft.id]: draft }));
  };

  const handleEnterEdit = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (item) {
      setOriginalDrafts((prev) => ({ ...prev, [id]: item }));
    }
    setEditingRowId(id);
  };

  const handleRowChange = (id: string, patch: Partial<LineItemDraft>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch, isDraft: true } : item))
    );
  };

  const handleRowCancel = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (item?.isNew) {
      setItems((prev) => prev.filter((i) => i.id !== id));
    } else {
      const orig = originalDrafts[id];
      if (orig) {
        setItems((prev) =>
          prev.map((i) => (i.id === id ? { ...orig, isDraft: false } : i))
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
      // 2026-04-10 Phase B: canonical payload via draftToJobPartPayload.
      // The server route validates against canonicalLineItemInput and
      // projects the input down to the persisted job_parts subset via
      // `canonicalToJobPartFields` in server/routes/jobs.ts. We send the
      // full canonical shape (the server drops what it doesn't store).
      const payload = draftToJobPartPayload(item);

      if (item.isNew) {
        await apiRequest(`/api/jobs/${jobId}/parts`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest(`/api/jobs/${jobId}/parts/${item.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
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

  /**
   * 2026-04-10 Phase B: canonical catalog→draft mapping. Replaces the inline
   * field map. Preserves the row id, sortOrder, and existing quantity so the
   * table doesn't reorder and the user's edited quantity isn't reset.
   */
  const handleSelectProduct = (lineId: string, product: ProductOption) => {
    setItems((prev) =>
      prev.map((li) => {
        if (li.id !== lineId) return li;
        const fresh = catalogItemToDraft(productOptionToCatalogItem(product), {
          source: "manual",
          quantity: li.quantity,
          sortOrder: li.sortOrder,
        });
        return { ...fresh, id: li.id, isDraft: true };
      }),
    );
  };

  const createProductMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; cost: string; unitPrice: string; type: string }) => {
      return await apiRequest<Item>("/api/items", {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          description: data.description || null,
          cost: String(parseMoney(data.cost)),
          unitPrice: String(parseMoney(data.unitPrice)),
          type: data.type,
          isTaxable: true,
          isActive: true,
        }),
      });
    },
    onSuccess: (newPart: Item) => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      if (productModalState.lineItemId) {
        // Apply the freshly-created catalog item to the row via the canonical
        // mapper — same path as a normal product selection.
        setItems((prev) =>
          prev.map((li) => {
            if (li.id !== productModalState.lineItemId) return li;
            const productOption: ProductOption = {
              id: newPart.id,
              name: newPart.name ?? newPart.description ?? "Untitled",
              type: (newPart.type as string) ?? "product",
              unitPrice: newPart.unitPrice ?? null,
              cost: newPart.cost ?? null,
            };
            const fresh = catalogItemToDraft(productOptionToCatalogItem(productOption), {
              source: "manual",
              quantity: li.quantity,
              sortOrder: li.sortOrder,
            });
            return { ...fresh, id: li.id, isDraft: true };
          }),
        );
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
        <CardContent className="pt-4 space-y-4">
          <div className="overflow-visible">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <table className="min-w-full text-xs">
                <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
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
              className="border-slate-400 text-slate-800 bg-slate-50 hover:bg-slate-100 hover:border-slate-500 font-medium shadow-sm"
              data-testid="button-add-line-item"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Line Item
            </Button>
            {isOfficeUser && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setTemplatePickerOpen(true); setTemplateSearch(""); }}
                disabled={applyTemplateMutation.isPending || jobTemplates.length === 0}
                title={jobTemplates.length === 0 ? "No templates available — create one in Settings → Job Templates" : "Apply a template"}
                className="border-slate-400 text-slate-800 bg-slate-50 hover:bg-slate-100 hover:border-slate-500 font-medium shadow-sm"
                data-testid="button-apply-template"
              >
                <FileText className="h-3 w-3 mr-1" />
                Apply Template
              </Button>
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
              className={`p-3 rounded-md border cursor-pointer transition-colors ${
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
              className={`p-3 rounded-md border cursor-pointer transition-colors ${
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

      {/* Template Picker Dialog — search, recent/default, full list */}
      <Dialog open={templatePickerOpen} onOpenChange={setTemplatePickerOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Apply Template</DialogTitle>
            <DialogDescription>
              Select a template to populate line items on this job.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search templates..."
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
              className="pl-8 h-9"
              autoFocus
              data-testid="input-template-search"
            />
          </div>
          <TemplatePickerList
            templates={jobTemplates}
            search={templateSearch}
            onSelect={(templateId) => {
              setTemplatePickerOpen(false);
              handleApplyTemplate(templateId);
            }}
          />
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

/**
 * Template Picker List — shows defaults/recent first, then all templates.
 * Supports search filtering by name.
 */
function TemplatePickerList({
  templates,
  search,
  onSelect,
}: {
  templates: JobTemplate[];
  search: string;
  onSelect: (templateId: string) => void;
}) {
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return templates;
    return templates.filter((t) => t.name.toLowerCase().includes(q));
  }, [templates, search]);

  // Split into default and rest
  const defaults = useMemo(() => filtered.filter((t) => t.isDefaultForJobType), [filtered]);
  const rest = useMemo(() => filtered.filter((t) => !t.isDefaultForJobType), [filtered]);

  if (filtered.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {search ? "No templates match your search." : "No templates available."}
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-[320px]">
      <div className="space-y-1 py-1">
        {defaults.length > 0 && (
          <>
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <Star className="h-3 w-3" />
              Default Templates
            </div>
            {defaults.map((t) => (
              <button
                key={t.id}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-left hover:bg-muted transition-colors"
                onClick={() => onSelect(t.id)}
                data-testid={`template-option-${t.id}`}
              >
                <FileText className="h-4 w-4 text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{t.name}</div>
                  {t.description && <div className="text-xs text-muted-foreground truncate">{t.description}</div>}
                </div>
              </button>
            ))}
          </>
        )}
        {rest.length > 0 && (
          <>
            {defaults.length > 0 && (
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                All Templates
              </div>
            )}
            {rest.map((t) => (
              <button
                key={t.id}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-left hover:bg-muted transition-colors"
                onClick={() => onSelect(t.id)}
                data-testid={`template-option-${t.id}`}
              >
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{t.name}</div>
                  {t.description && <div className="text-xs text-muted-foreground truncate">{t.description}</div>}
                </div>
              </button>
            ))}
          </>
        )}
      </div>
    </ScrollArea>
  );
}

// ── Sortable line item row — uses canonical CreateOrSelectField for catalog selection ──

interface SortableLineItemRowProps {
  item: LineItemDraft;
  isEditing: boolean;
  isSaving: boolean;
  onEnterEdit: () => void;
  onChange: (patch: Partial<LineItemDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onSelectProduct: (product: ProductOption) => void;
  onRequestAddProduct: (name: string) => void;
}

function SortableLineItemRow(props: SortableLineItemRowProps) {
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

  // 2026-04-10 Phase B: per-row catalog search via canonical useProductSearch.
  // No prefetched 1000-row catalog; the hook only fires after 2 chars.
  const [searchText, setSearchText] = useState("");
  const { data: searchResults = [], isLoading: isSearchLoading } = useProductSearch(searchText);

  // Reconstruct a ProductOption from the canonical draft for the selector chip.
  const selectedValue: ProductOption | null = props.item.productId
    ? {
        id: props.item.productId,
        name: props.item.description,
        type: props.item.productType ?? "product",
        unitPrice: props.item.unitPrice,
        cost: props.item.unitCost,
      }
    : null;

  const lineTotal = parseMoney(props.item.unitPrice) * parseMoney(props.item.quantity);
  const productDisplay = props.item.description;

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
              {productDisplay || <span className="italic text-muted-foreground">No product</span>}
            </div>
            {props.item.isDraft && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium">
                Draft
              </span>
            )}
          </div>
        </td>
        <td className="py-3 px-3 text-right align-top text-xs">{props.item.quantity}</td>
        <td className="py-3 px-3 text-right align-top text-xs">{formatCurrency(parseMoney(props.item.unitCost))}</td>
        <td className="py-3 px-3 text-right align-top text-xs">{formatCurrency(parseMoney(props.item.unitPrice))}</td>
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
        {/* 2026-04-10 Phase B: canonical CreateOrSelectField replaces the
            custom in-row dropdown + manual catalog filter. The catalog
            search fires only after 2 chars. The "create new" callback opens
            the existing AddProductModal seeded with the current search text. */}
        <CreateOrSelectField<ProductOption>
          label=""
          compact
          value={selectedValue}
          onChange={(product) => {
            if (product) {
              props.onSelectProduct(product);
              setSearchText("");
            } else {
              // Clear: drop catalog link, keep description editable for manual entry
              props.onChange({ productId: null });
              setSearchText("");
            }
          }}
          searchResults={searchResults}
          searchLoading={isSearchLoading}
          searchText={searchText || (selectedValue ? "" : props.item.description)}
          onSearchTextChange={(text) => {
            setSearchText(text);
            // Manual-entry fallback: if no product is selected, mirror text to description
            if (!props.item.productId) props.onChange({ description: text });
          }}
          getKey={getProductKey}
          getLabel={getProductLabel}
          getDescription={getProductDescription}
          createLabel={`Add "${searchText || "new item"}" as product`}
          onCreateNew={(text) => props.onRequestAddProduct(text)}
          placeholder="Search product / service..."
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
