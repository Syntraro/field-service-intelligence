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
 * 2026-04-18 Section-level edit mode:
 *   - Per-row Save / Cancel / click-to-edit is replaced by a card-level
 *     Edit → (bulk staged edits) → Save Changes / Cancel lifecycle.
 *   - Deletes are staged (hidden) until section Save; Cancel restores them.
 *   - Reorder is local-only in edit mode; PATCH /reorder fires once on Save.
 *   - Server endpoints are unchanged: POST/PUT/DELETE /api/jobs/:jobId/parts
 *     and PATCH /api/jobs/:jobId/parts/reorder. No new backend route.
 *   - Apply Template is hidden during section edit — user must save or
 *     cancel first. Template application itself is unchanged.
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
import { Plus, Trash2, Loader2, FileText, GripVertical, Search, Star } from "lucide-react";
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
  /**
   * Section-edit flag driven by the parent's card-header Edit button.
   * When this flips false → true, the component snapshots `items` for Cancel
   * restore; when it flips true → false, the snapshot clears. Cancel and
   * Save success call `onExitEdit` to flip it back to false.
   */
  isEditing: boolean;
  /** Parent-owned exit callback — invoked on Cancel and on Save success. */
  onExitEdit: () => void;
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

// Diff helper: determines whether a persisted row's tracked fields changed
// versus its pre-edit snapshot. Used by both the dirty indicator (to enable
// Save) and the Save orchestrator (to decide PUT vs skip).
function rowIsChanged(current: LineItemDraft, original: LineItemDraft): boolean {
  return (
    current.description !== original.description ||
    current.productId !== original.productId ||
    current.quantity !== original.quantity ||
    current.unitCost !== original.unitCost ||
    current.unitPrice !== original.unitPrice
  );
}

export function PartsBillingCard({ jobId, isEditing, onExitEdit, onTotalsChange }: PartsBillingCardProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const isOfficeUser = Boolean(user?.role && OFFICE_ROLES.includes(user.role));

  // Canonical `LineItemDraft[]` — same shape as every other line-item surface.
  const [items, setItems] = useState<LineItemDraft[]>([]);

  // Section-level edit lifecycle state — `isEditing` is parent-driven; the
  // snapshot + pendingDeletes are owned here because they require access to
  // the current `items` at transition time.
  const [originalItems, setOriginalItems] = useState<LineItemDraft[] | null>(null);
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());
  const [isSavingSection, setIsSavingSection] = useState(false);

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
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  const lastSyncedPartsRef = useRef<string>("");

  // Display-only lookup: catalog description keyed by productId. Populated
  // from jobParts.itemDescription on hydration and from the just-selected
  // ProductOption in `handleSelectProduct`. Held in a ref so mutations
  // don't re-render on their own — rows re-render via the `items` update
  // that accompanies every write, and look up their description at render
  // time. Never reaches any save payload.
  const catalogDescByProductIdRef = useRef<Map<string, string>>(new Map());

  const { data: jobParts = [], isLoading: partsLoading } = useQuery<(JobPart & { itemType?: string | null; itemDescription?: string | null })[]>({
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

  // Hydrate persisted job_parts rows into canonical drafts. Suspended while
  // section edit mode is active so refetches don't clobber in-flight edits.
  useEffect(() => {
    if (!jobParts || isEditing) return;

    const partsKey = JSON.stringify(
      jobParts.map(jp => jp.id + jp.quantity + jp.unitCost + jp.unitPrice + jp.productId + jp.sortOrder),
    );
    if (partsKey === lastSyncedPartsRef.current) return;

    const mappedItems: LineItemDraft[] = jobParts.map((jp, index) => {
      const draft = hydrateDraft({
        ...jp,
        sortOrder: jp.sortOrder ?? index,
      });
      if (jp.itemType === "product" || jp.itemType === "service") {
        draft.productType = jp.itemType;
      }
      // 2026-04-18: cache catalog description for the selector chip display.
      if (jp.productId && jp.itemDescription) {
        catalogDescByProductIdRef.current.set(jp.productId, jp.itemDescription);
      }
      return draft;
    });
    lastSyncedPartsRef.current = partsKey;
    setItems(mappedItems);
  }, [jobParts, isEditing]);

  // Snapshot / clear on the isEditing transition. Snapshot uses the current
  // `items` at the moment the parent enters edit mode; on exit, the snapshot
  // and any staged deletes are cleared.
  useEffect(() => {
    if (isEditing) {
      setOriginalItems(items.map((i) => ({ ...i })));
      setPendingDeletes(new Set());
    } else {
      setOriginalItems(null);
      setPendingDeletes(new Set());
    }
    // Only react to the edit-mode transition — `items` at snapshot time is
    // captured via closure, and re-running on every keystroke would defeat
    // the point of the snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Drag reorder is local-only. In section edit mode it mutates `items` and
  // rebases sortOrder; PATCH /reorder is deferred until Save. Drag is
  // effectively disabled outside edit mode since the grip handle isn't
  // rendered in read-only rows.
  const handleDragEnd = (event: DragEndEvent) => {
    if (!isEditing) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const newItems = arrayMove(items, oldIndex, newIndex).map((item, idx) => ({
      ...item,
      sortOrder: idx,
    }));
    setItems(newItems);
  };

  // Visible rows exclude staged-for-delete persisted rows. New-but-deleted
  // rows are never in `items` (handleRowDelete drops them on click).
  const visibleItems = useMemo(
    () => items.filter((i) => !pendingDeletes.has(i.id)),
    [items, pendingDeletes],
  );

  const { totalPrice, totalCost, profit, margin } = useMemo(() => {
    // Totals are computed over visible rows so staged deletions don't count.
    // `parseMoney` is the canonical money parser; never use bare parseFloat.
    const totalPrice = visibleItems.reduce(
      (sum, i) => sum + parseMoney(i.unitPrice) * parseMoney(i.quantity),
      0
    );
    const totalCost = visibleItems.reduce(
      (sum, i) => sum + parseMoney(i.unitCost) * parseMoney(i.quantity),
      0
    );
    const profit = totalPrice - totalCost;
    const margin = totalPrice > 0 ? (profit / totalPrice) * 100 : 0;
    return { totalPrice, totalCost, profit, margin };
  }, [visibleItems]);

  // Report totals to parent for section header display
  useEffect(() => {
    onTotalsChange?.({ totalPrice, totalCost, profit });
  }, [totalPrice, totalCost, profit, onTotalsChange]);

  // Dirty detection drives Save-button enablement and the reorder PATCH.
  const { isDirty, orderChanged } = useMemo(() => {
    if (!isEditing || !originalItems) {
      return { isDirty: false, orderChanged: false };
    }
    const origById = new Map(originalItems.map((i) => [i.id, i]));
    const hasCreates = items.some((i) => i.isNew && !pendingDeletes.has(i.id));
    const hasDeletes = pendingDeletes.size > 0;
    const hasUpdates = items.some((i) => {
      if (i.isNew || pendingDeletes.has(i.id)) return false;
      const orig = origById.get(i.id);
      return orig ? rowIsChanged(i, orig) : false;
    });
    const currentOrderIds = items
      .filter((i) => !pendingDeletes.has(i.id))
      .map((i) => i.id);
    const originalOrderIds = originalItems
      .filter((i) => !pendingDeletes.has(i.id))
      .map((i) => i.id);
    const orderChanged =
      hasCreates ||
      currentOrderIds.length !== originalOrderIds.length ||
      currentOrderIds.some((id, idx) => originalOrderIds[idx] !== id);
    return {
      isDirty: hasCreates || hasUpdates || hasDeletes || orderChanged,
      orderChanged,
    };
  }, [isEditing, originalItems, items, pendingDeletes]);

  // ── Section edit lifecycle ────────────────────────────────────────────
  // Enter is driven by the parent (Edit button in the card header). The
  // snapshot/clear is handled by the `isEditing` effect above. Cancel below
  // restores the local items from the snapshot before notifying the parent.

  const handleSectionCancel = () => {
    if (originalItems) setItems(originalItems.map((i) => ({ ...i })));
    onExitEdit();
  };

  // ── Row handlers (only active while isEditing === true) ─────────

  const handleAddLineItem = () => {
    const draft = blankDraft({ source: "manual", sortOrder: items.length });
    setItems((prev) => [...prev, draft]);
  };

  const handleRowChange = (id: string, patch: Partial<LineItemDraft>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch, isDraft: true } : item))
    );
  };

  // Delete is staged: isNew rows drop from local state immediately; persisted
  // rows are added to `pendingDeletes` and hidden from the table. Section
  // Cancel restores both paths; section Save commits the DELETEs.
  const handleRowDelete = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (item?.isNew) {
      setItems((prev) => prev.filter((i) => i.id !== id));
      return;
    }
    setPendingDeletes((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  /**
   * Canonical catalog→draft mapping. Preserves the row id, sortOrder, and
   * existing quantity so the table doesn't reorder and the user's edited
   * quantity isn't reset.
   *
   * 2026-04-18: Also preserves `li.isNew`. `catalogItemToDraft` constructs a
   * fresh draft with `isNew: true` (correct for net-new additions), but when
   * this handler is called on a persisted row — e.g. the user replaces the
   * product on an existing line — the row must stay non-new so section Save
   * routes it through PUT, not POST. Without this, changing the product on
   * an existing row would create a duplicate on the server.
   */
  const handleSelectProduct = (lineId: string, product: ProductOption) => {
    // 2026-04-18: cache catalog description for the chip's secondary line.
    if (product.description) {
      catalogDescByProductIdRef.current.set(product.id, product.description);
    }
    setItems((prev) =>
      prev.map((li) => {
        if (li.id !== lineId) return li;
        const fresh = catalogItemToDraft(productOptionToCatalogItem(product), {
          source: "manual",
          quantity: li.quantity,
          sortOrder: li.sortOrder,
        });
        return { ...fresh, id: li.id, isNew: li.isNew, isDraft: true };
      }),
    );
  };

  // ── Section Save orchestration ────────────────────────────────────────

  const handleSectionSave = async () => {
    if (isSavingSection || !originalItems) return;

    // Block save if any visible row lacks a description — matches the
    // canonical Zod requirement (`description.min(1)`) that the server
    // would reject anyway. Catching it early avoids partial-save state.
    const invalidRow = visibleItems.find((i) => !i.description?.trim());
    if (invalidRow) {
      toast({
        title: "Missing description",
        description: "Every line item needs a product, service, or description.",
        variant: "destructive",
      });
      return;
    }

    setIsSavingSection(true);
    try {
      const origById = new Map(originalItems.map((i) => [i.id, i]));
      const localToServerId = new Map<string, string>();

      // 1. POST creates (isNew rows that weren't staged-deleted)
      const creates = items.filter((i) => i.isNew && !pendingDeletes.has(i.id));
      for (const draft of creates) {
        const payload = draftToJobPartPayload(draft);
        const created = await apiRequest<JobPart>(`/api/jobs/${jobId}/parts`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        localToServerId.set(draft.id, created.id);
      }

      // 2. PUT updates (persisted rows with a diff against the snapshot)
      const updates = items.filter((i) => {
        if (i.isNew || pendingDeletes.has(i.id)) return false;
        const orig = origById.get(i.id);
        return orig ? rowIsChanged(i, orig) : false;
      });
      for (const draft of updates) {
        const payload = draftToJobPartPayload(draft);
        await apiRequest(`/api/jobs/${jobId}/parts/${draft.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      }

      // 3. DELETE staged deletions (persisted ids only; isNew was dropped locally)
      for (const id of Array.from(pendingDeletes)) {
        await apiRequest(`/api/jobs/${jobId}/parts/${id}`, {
          method: "DELETE",
        });
      }

      // 4. PATCH reorder — one call, surviving rows only. localIds for
      // freshly-created rows are translated to their server ids before send.
      if (orderChanged) {
        const survivors = items.filter((i) => !pendingDeletes.has(i.id));
        const reorderPayload = survivors.map((i, idx) => ({
          id: localToServerId.get(i.id) ?? i.id,
          sortOrder: idx,
        }));
        if (reorderPayload.length > 0) {
          await apiRequest(`/api/jobs/${jobId}/parts/reorder`, {
            method: "PATCH",
            body: JSON.stringify({ parts: reorderPayload }),
          });
        }
      }

      // 5. Refetch canonical state. Hydration effect is still gated by
      // isEditing (true) so it won't fire until we exit edit mode.
      await queryClient.refetchQueries({ queryKey: ["/api/jobs", jobId, "parts"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });

      // 6. Notify parent to exit edit mode. The isEditing effect clears the
      // snapshot + pendingDeletes; the hydrator then repopulates `items` from
      // the refreshed server data.
      onExitEdit();
      toast({ title: "Saved", description: "Line items updated." });
    } catch (error: any) {
      // Stay in edit mode so the user can retry or cancel. Draft state
      // (items, pendingDeletes, originalItems) is deliberately preserved.
      toast({
        title: "Save failed",
        description: error?.message || "Some changes could not be saved.",
        variant: "destructive",
      });
    } finally {
      setIsSavingSection(false);
    }
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
      // The catalog item persists even if the user subsequently cancels the
      // section edit — a new product/service is a tenant-wide resource and
      // cannot be cleanly rolled back. Intentional carve-out.
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
            return { ...fresh, id: li.id, isNew: li.isNew, isDraft: true };
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
                <SortableContext items={visibleItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  <tbody>
                    {visibleItems.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-xs text-muted-foreground">
                          {isEditing
                            ? "No line items. Use Add Line Item below."
                            : "No line items yet. Click Edit to add parts or services."}
                        </td>
                      </tr>
                    )}
                    {visibleItems.map((item) => (
                      <SortableLineItemRow
                        key={item.id}
                        item={item}
                        isEditing={isEditing}
                        isSaving={isSavingSection}
                        getCatalogDescription={(productId) =>
                          catalogDescByProductIdRef.current.get(productId) ?? null
                        }
                        onChange={(patch) => handleRowChange(item.id, patch)}
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

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {isEditing && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddLineItem}
                  disabled={isSavingSection}
                  className="border-slate-400 text-slate-800 bg-slate-50 hover:bg-slate-100 hover:border-slate-500 font-medium shadow-sm"
                  data-testid="button-add-line-item"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Line Item
                </Button>
              )}
              {/* 2026-04-26: hide the Apply Template button entirely
                  when no templates exist. Surfacing a disabled button
                  with a "create one in Settings" tooltip clutters the
                  card on tenants that haven't set up templates. The
                  feature itself isn't removed — once a template exists
                  the button reappears with full behaviour. */}
              {!isEditing && isOfficeUser && jobTemplates.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setTemplatePickerOpen(true); setTemplateSearch(""); }}
                  disabled={applyTemplateMutation.isPending}
                  title="Apply a template"
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

            {isEditing && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSectionCancel}
                  disabled={isSavingSection}
                  data-testid="button-cancel-section-edit"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSectionSave}
                  disabled={isSavingSection || !isDirty}
                  data-testid="button-save-section-edit"
                >
                  {isSavingSection && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                  Save Changes
                </Button>
              </div>
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

// ── Sortable line item row — rendering is driven by section edit mode. ──

interface SortableLineItemRowProps {
  item: LineItemDraft;
  /** Section-level edit flag; when true, all rows render their edit branch. */
  isEditing: boolean;
  /** Section-level saving flag; disables row inputs during Save orchestration. */
  isSaving: boolean;
  /** Lookup for the catalog description to show in the selected-row chip. */
  getCatalogDescription: (productId: string) => string | null;
  onChange: (patch: Partial<LineItemDraft>) => void;
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

  // Per-row catalog search via canonical useProductSearch.
  // The hook only fires after 2 chars.
  const [searchText, setSearchText] = useState("");
  const { data: searchResults = [], isLoading: isSearchLoading } = useProductSearch(searchText);

  // Bug #1 fix: distinguishes the post-select / post-clear empty-string
  // cascade that CreateOrSelectField emits from a genuine user delete-to-
  // empty. Set synchronously in `onChange`; consumed and reset in the
  // immediately-following `onSearchTextChange("")`. Lets user deletions
  // reach `draft.description` so the input can be fully cleared, while
  // still protecting the catalog-hydrated description that `handleSelectProduct`
  // just wrote (the "Truck Charge" bug).
  const suppressNextSearchChangeRef = useRef(false);

  // Reconstruct a ProductOption from the canonical draft for the selector chip.
  // `description` comes from the parent-owned lookup (populated by the
  // server-joined `itemDescription` or by the selection path).
  const catalogDescription = props.item.productId
    ? props.getCatalogDescription(props.item.productId)
    : null;
  const selectedValue: ProductOption | null = props.item.productId
    ? {
        id: props.item.productId,
        name: props.item.description,
        type: props.item.productType ?? "product",
        unitPrice: props.item.unitPrice,
        cost: props.item.unitCost,
        description: catalogDescription,
      }
    : null;

  const lineTotal = parseMoney(props.item.unitPrice) * parseMoney(props.item.quantity);
  const productDisplay = props.item.description;

  if (!props.isEditing) {
    // Read-only row. No click-to-edit — edit lifecycle is card-level.
    // 2026-04-18: Saved/view rows mirror edit-mode chip content for parity:
    // when a catalog description exists, render the same secondary line
    // that `getProductDescription` composes for the chip. When the catalog
    // has no description, no secondary line is added — preserving the
    // original single-line view for those rows.
    const viewSecondary =
      selectedValue && catalogDescription ? getProductDescription(selectedValue) : null;
    return (
      <tr
        ref={setNodeRef}
        style={style}
        className="border-b border-border/50"
        data-testid={`row-line-item-${props.item.id}`}
      >
        <td className="py-3 pr-2 align-top w-8"></td>
        <td className="py-3 pr-3 align-top">
          <div className="text-xs font-medium">
            {productDisplay || <span className="italic text-muted-foreground">No product</span>}
          </div>
          {viewSecondary && (
            <div className="text-xs text-muted-foreground truncate" data-testid={`row-line-item-secondary-${props.item.id}`}>
              {viewSecondary}
            </div>
          )}
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
        {/* Selector + compact trash icon on one row, so the row height stays
            tight and Delete never consumes a whole line below the selector. */}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <CreateOrSelectField<ProductOption>
              label=""
              compact
              disabled={props.isSaving}
              value={selectedValue}
              onChange={(product) => {
                // CreateOrSelectField emits `onSearchTextChange("")` right
                // after any selection-or-clear. Suppress the mirror path
                // on that cascade so it doesn't stomp the just-written
                // `description` via a stale closure on `productId`.
                suppressNextSearchChangeRef.current = true;
                if (product) {
                  props.onSelectProduct(product);
                } else {
                  // Clear: drop catalog link, keep description editable for manual entry
                  props.onChange({ productId: null });
                }
                setSearchText("");
              }}
              searchResults={searchResults}
              searchLoading={isSearchLoading}
              searchText={searchText || (selectedValue ? "" : props.item.description)}
              onSearchTextChange={(text) => {
                setSearchText(text);
                if (suppressNextSearchChangeRef.current) {
                  // Post-select / post-clear cascade — don't mirror.
                  suppressNextSearchChangeRef.current = false;
                  return;
                }
                // User typing on a manual-entry row. Mirror EVERY value to
                // `description`, including empty — the user's delete-to-
                // empty intent must reach the draft so the controlled input
                // can actually clear. (The earlier `text.length > 0` guard
                // made the input stick at the first character.)
                if (!props.item.productId) {
                  props.onChange({ description: text });
                }
              }}
              getKey={getProductKey}
              getLabel={getProductLabel}
              getDescription={getProductDescription}
              createLabel={`Add "${searchText || "new item"}" as product`}
              onCreateNew={(text) => props.onRequestAddProduct(text)}
              placeholder="Search product / service..."
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={props.onDelete}
            disabled={props.isSaving}
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
            title="Remove line item"
            aria-label="Remove line item"
            data-testid={`button-delete-line-${props.item.id}`}
          >
            <Trash2 className="h-4 w-4" />
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
          disabled={props.isSaving}
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
            disabled={props.isSaving}
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
            disabled={props.isSaving}
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
