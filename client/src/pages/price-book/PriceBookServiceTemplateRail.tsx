import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Search, Plus, Minus, Loader2, AlertTriangle, Info } from "lucide-react";
import { ItemImageUpload } from "@/components/pricebook/ItemImageUpload";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/chip";
import { InlineInput, FormSection } from "@/components/ui/form-field";
import { WorkspaceRailScrollContainer } from "@/components/workspace/WorkspaceRailScrollContainer";
import { ConfirmModal } from "@/components/ui/modal";
import {
  useUpdateServiceTemplate,
  useSetServiceTemplateComponents,
  useDeleteServiceTemplate,
} from "@/lib/serviceTemplates/useServiceTemplates";
import {
  normalizeProductRow,
  type ProductOption,
} from "@/lib/entities/productEntity";
import type { ServiceTemplateDto, ComponentInput } from "@/lib/serviceTemplates/serviceTemplateTypes";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMoney(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  return isNaN(n) ? "—" : `$${n.toFixed(2)}`;
}

interface ComponentEntry {
  product: ProductOption;
  quantity: number;
}

function componentsFromTemplate(t: ServiceTemplateDto): Map<string, ComponentEntry> {
  const out = new Map<string, ComponentEntry>();
  for (const c of t.components) {
    if (!c.itemId) continue;
    out.set(c.itemId, {
      product: {
        id: c.itemId,
        name: c.itemName ?? "",
        type: c.itemType ?? "service",
        unitPrice: null,
        cost: c.unitCostSnapshot,
        description: null,
        isTaxable: true,
      },
      quantity: Math.max(1, Number(c.quantity) || 1),
    });
  }
  return out;
}

// ─── Item search hook ──────────────────────────────────────────────

function useItemSearch(searchText: string) {
  return useQuery<ProductOption[]>({
    queryKey: ["/api/items", "service-template-rail", searchText],
    queryFn: async () => {
      const trimmed = searchText.trim();
      const qs = trimmed
        ? `?q=${encodeURIComponent(trimmed)}&limit=50`
        : "?sort=most_used&limit=50";
      const res = await apiRequest<any>(`/api/items${qs}`);
      const rows = Array.isArray(res) ? res : (res?.data ?? res?.items ?? []);
      return rows.map(normalizeProductRow);
    },
    staleTime: 30_000,
    refetchIntervalInBackground: false,
  });
}

// ─── Warnings ────────────────────────────────────────────────────────────────

function computeWarnings(template: ServiceTemplateDto, componentEntries: ComponentEntry[]): string[] {
  const warnings: string[] = [];
  const price = parseFloat(template.flatRatePrice ?? "0");
  if (price <= 0) warnings.push("Flat rate price is zero — this template will bill $0.");
  let cost = 0;
  for (const e of componentEntries) {
    cost += e.quantity * (parseFloat(e.product.cost ?? "0") || 0);
  }
  if (componentEntries.length > 0 && cost > 0 && price < cost) {
    warnings.push("Flat rate price is below estimated component cost (negative margin).");
  }
  if (componentEntries.length === 0) {
    warnings.push("No components defined — cost basis is unknown.");
  }
  return warnings;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface PriceBookServiceTemplateRailProps {
  template: ServiceTemplateDto;
  onClose: () => void;
  onSaved: (updated: ServiceTemplateDto) => void;
}

export function PriceBookServiceTemplateRail({
  template,
  onClose,
  onSaved,
}: PriceBookServiceTemplateRailProps) {
  const { toast } = useToast();

  const [draftName, setDraftName] = useState(template.name);
  const [draftPrice, setDraftPrice] = useState(template.flatRatePrice);
  const [draftDescription, setDraftDescription] = useState(template.description ?? "");
  const [draftInternalNotes, setDraftInternalNotes] = useState(template.internalNotes ?? "");
  const [draftCategory, setDraftCategory] = useState(template.category ?? "");
  const [draftDuration, setDraftDuration] = useState(
    template.estimatedDurationMinutes != null ? String(template.estimatedDurationMinutes) : "",
  );
  const [components, setComponents] = useState<Map<string, ComponentEntry>>(
    () => componentsFromTemplate(template),
  );
  const [itemSearch, setItemSearch] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  useEffect(() => {
    setDraftName(template.name);
    setDraftPrice(template.flatRatePrice);
    setDraftDescription(template.description ?? "");
    setDraftInternalNotes(template.internalNotes ?? "");
    setDraftCategory(template.category ?? "");
    setDraftDuration(
      template.estimatedDurationMinutes != null ? String(template.estimatedDurationMinutes) : "",
    );
    setComponents(componentsFromTemplate(template));
    setItemSearch("");
  }, [template.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: searchResults = [], isFetching: isSearching } = useItemSearch(itemSearch);

  const componentEntries = useMemo(() => Array.from(components.values()), [components]);

  const dirty = useMemo(() => {
    if (draftName !== template.name) return true;
    if (draftPrice !== template.flatRatePrice) return true;
    if (draftDescription !== (template.description ?? "")) return true;
    if (draftInternalNotes !== (template.internalNotes ?? "")) return true;
    if (draftCategory !== (template.category ?? "")) return true;
    const dur = draftDuration.trim() ? parseInt(draftDuration, 10) : null;
    if (dur !== template.estimatedDurationMinutes) return true;
    if (components.size !== template.components.length) return true;
    for (const c of template.components) {
      const entry = components.get(c.itemId);
      if (!entry) return true;
      if (entry.quantity !== Math.max(1, Number(c.quantity) || 1)) return true;
    }
    return false;
  }, [draftName, draftPrice, draftDescription, draftInternalNotes, draftCategory, draftDuration, components, template]);

  const warnings = useMemo(
    () => computeWarnings(template, componentEntries),
    [template, componentEntries],
  );

  const updateMutation = useUpdateServiceTemplate(template.id);
  const setComponentsMutation = useSetServiceTemplateComponents(template.id);
  const deleteMutation = useDeleteServiceTemplate();

  async function handleSave() {
    if (!draftName.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (!draftPrice.trim() || !/^\d+(\.\d{1,2})?$/.test(draftPrice.trim())) {
      toast({ title: "Enter a valid flat rate price", variant: "destructive" });
      return;
    }

    try {
      await updateMutation.mutateAsync({
        name: draftName.trim(),
        flatRatePrice: draftPrice.trim(),
        description: draftDescription.trim() || null,
        internalNotes: draftInternalNotes.trim() || null,
        category: draftCategory.trim() || null,
        estimatedDurationMinutes: draftDuration.trim() ? parseInt(draftDuration, 10) : null,
      });

      const newComponents: ComponentInput[] = Array.from(components.values()).map((e, idx) => ({
        itemId: e.product.id,
        quantity: String(e.quantity),
        unitCostSnapshot: e.product.cost ?? null,
        sortOrder: idx,
      }));

      const final = await setComponentsMutation.mutateAsync({ components: newComponents });
      toast({ title: "Template saved" });
      onSaved(final);
    } catch (err: any) {
      const msg = err?.message ?? "Could not save template";
      if (msg.toLowerCase().includes("already exists")) {
        toast({ title: "Name conflict", description: msg, variant: "destructive" });
      } else {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    }
  }

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync(template.id);
      toast({ title: "Template deleted" });
      onClose();
    } catch (err: any) {
      toast({ title: "Error", description: err?.message ?? "Could not delete", variant: "destructive" });
    }
    setDeleteConfirmOpen(false);
  }

  function addComponent(product: ProductOption) {
    setComponents((prev) => {
      const next = new Map(prev);
      const existing = next.get(product.id);
      if (existing) {
        next.set(product.id, { ...existing, quantity: existing.quantity + 1 });
      } else {
        next.set(product.id, { product, quantity: 1 });
      }
      return next;
    });
    setItemSearch("");
  }

  function removeComponent(itemId: string) {
    setComponents((prev) => {
      const next = new Map(prev);
      next.delete(itemId);
      return next;
    });
  }

  function adjustQuantity(itemId: string, delta: number) {
    setComponents((prev) => {
      const entry = prev.get(itemId);
      if (!entry) return prev;
      const next = new Map(prev);
      const newQty = entry.quantity + delta;
      if (newQty <= 0) {
        next.delete(itemId);
      } else {
        next.set(itemId, { ...entry, quantity: newQty });
      }
      return next;
    });
  }

  const isMutating = updateMutation.isPending || setComponentsMutation.isPending;

  const estimatedCost = useMemo(() => {
    let cost = 0;
    for (const e of componentEntries) {
      cost += e.quantity * (parseFloat(e.product.cost ?? "0") || 0);
    }
    return cost > 0 ? cost : null;
  }, [componentEntries]);

  const estimatedMargin = useMemo(() => {
    const price = parseFloat(draftPrice || "0");
    if (estimatedCost == null || price <= 0) return null;
    return price - estimatedCost;
  }, [draftPrice, estimatedCost]);

  return (
    <>
      <WorkspaceRailScrollContainer>
        {/* Rail header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <StatusChip tone={template.isActive ? "success" : "neutral"}>
              {template.isActive ? "Active" : "Archived"}
            </StatusChip>
            <span className="truncate text-helper font-medium text-slate-500">
              {template.usageCount} use{template.usageCount !== 1 ? "s" : ""}
            </span>
          </div>
          <button
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-300"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-5 px-4 py-4">
          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2.5">
              {warnings.map((w) => (
                <div key={w} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <span className="text-helper text-amber-800">{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* Summary KPIs */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5">
              <p className="text-helper text-muted-foreground">Flat Rate</p>
              <p className="text-row font-semibold tabular-nums">{formatMoney(draftPrice)}</p>
            </div>
            <div className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5">
              <p className="text-helper text-muted-foreground">Est. Cost</p>
              <p className="text-row font-semibold tabular-nums">
                {estimatedCost != null ? `$${estimatedCost.toFixed(2)}` : "—"}
              </p>
            </div>
            <div className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5">
              <p className="text-helper text-muted-foreground">Margin</p>
              <p className={`text-row font-semibold tabular-nums ${estimatedMargin != null && estimatedMargin < 0 ? "text-red-600" : ""}`}>
                {estimatedMargin != null ? `$${estimatedMargin.toFixed(2)}` : "—"}
              </p>
            </div>
          </div>

          {/* Item image */}
          <ItemImageUpload
            entityType="service-template"
            entityId={template.id}
            currentImage={template}
            onChanged={onSaved}
            invalidateKeys={[["/api/service-templates"]]}
          />

          {/* Customer-facing section */}
          <FormSection title="Customer-Facing">
            <InlineInput
              label="Template name"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Template name"
            />
            <InlineInput
              label="Flat rate price"
              value={draftPrice}
              onChange={(e) => setDraftPrice(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
            />
            <InlineInput
              label="Description"
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
              placeholder="Customer-visible description"
            />
          </FormSection>

          {/* Internal operational section */}
          <FormSection title="Internal">
            <InlineInput
              label="Category"
              value={draftCategory}
              onChange={(e) => setDraftCategory(e.target.value)}
              placeholder="e.g. HVAC Maintenance"
            />
            <InlineInput
              label="Est. duration (min)"
              value={draftDuration}
              onChange={(e) => setDraftDuration(e.target.value)}
              placeholder="e.g. 90"
              inputMode="numeric"
            />
            <InlineInput
              label="Internal notes"
              value={draftInternalNotes}
              onChange={(e) => setDraftInternalNotes(e.target.value)}
              placeholder="Internal notes for technicians"
            />
          </FormSection>

          {/* Components section */}
          <FormSection title="Components">
            {componentEntries.length > 0 && (
              <div className="flex flex-col gap-1.5 mb-2">
                {componentEntries.map((e) => (
                  <div
                    key={e.product.id}
                    className="flex items-center gap-2 rounded border border-slate-100 bg-white px-2 py-1.5"
                  >
                    <span className="flex-1 min-w-0 truncate text-helper text-slate-800">
                      {e.product.name}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
                        onClick={() => adjustQuantity(e.product.id, -1)}
                        aria-label="Decrease quantity"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-5 text-center text-helper tabular-nums">{e.quantity}</span>
                      <button
                        className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
                        onClick={() => adjustQuantity(e.product.id, 1)}
                        aria-label="Increase quantity"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <button
                        className="flex h-5 w-5 items-center justify-center rounded text-red-300 hover:bg-red-50 hover:text-red-600"
                        onClick={() => removeComponent(e.product.id)}
                        aria-label="Remove component"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Item search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <Input
                className="pl-8 h-8"
                placeholder="Search catalog items to add…"
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
              />
              {isSearching && (
                <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-slate-400" />
              )}
            </div>
            {itemSearch.trim() && searchResults.length > 0 && (
              <div className="mt-1 flex flex-col gap-0.5 rounded border border-slate-200 bg-white shadow-sm max-h-48 overflow-y-auto">
                {searchResults.map((p) => (
                  <button
                    key={p.id}
                    className="flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:bg-slate-50"
                    onClick={() => addComponent(p)}
                  >
                    <span className="flex-1 min-w-0 truncate text-helper text-slate-800">{p.name}</span>
                    <span className="shrink-0 text-helper text-slate-400 capitalize">{p.type}</span>
                  </button>
                ))}
              </div>
            )}
            {itemSearch.trim() && !isSearching && searchResults.length === 0 && (
              <p className="text-helper text-muted-foreground mt-1">No catalog items match.</p>
            )}
          </FormSection>

          {/* Boundary notice */}
          <div className="flex items-start gap-2 rounded border border-blue-100 bg-blue-50/50 px-3 py-2.5">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
            <p className="text-helper text-blue-700">
              Components are internal only — they are used to estimate cost and
              plan technician work. Only the flat rate price appears on quotes and invoices.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-1">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!dirty || isMutating}
              className="w-full"
            >
              {isMutating ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Saving…</>
              ) : (
                "Save Changes"
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="w-full text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={isMutating || deleteMutation.isPending}
            >
              Delete Template
            </Button>
          </div>
        </div>
      </WorkspaceRailScrollContainer>

      <ConfirmModal
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete template?"
        description={`"${template.name}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={handleDelete}
        testIdPrefix="service-template-delete"
      />
    </>
  );
}
