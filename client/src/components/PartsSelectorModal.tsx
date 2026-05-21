/**
 * PartsSelectorModal — Row-based multi-add for location PM parts.
 *
 * Each row: canonical product selector → quantity. "Add another part"
 * appends rows. One "Save" bulk-upserts all rows via PUT
 * /api/locations/:id/pm-parts.
 *
 * 2026-04-10 (P9-P10 Phase D): Migrated to the canonical client pipeline.
 *
 *   - Local `PartSearchResult` and `PartRow` shadow types: REMOVED.
 *   - Direct `fetch("/api/items?q=...")` per-row search: REPLACED with the
 *     canonical `useProductSearch(searchText)` hook (now per-row, owned by
 *     the new `PartsSelectorRow` child component).
 *   - Manual per-row `resultsByRow` / `loadingByRow` maps + 300ms debounce
 *     timer scaffold: REMOVED. The canonical `useProductSearch` is
 *     per-instance and the cache key already debounces by query string.
 *   - Manual `<Input>` + button-list result rendering with custom
 *     "create new" empty-state branch: REPLACED with the canonical
 *     `CreateOrSelectField<ProductOption>` plus `getProductKey`,
 *     `getProductLabel`, `getProductDescription`. Inline create flows
 *     through the `onCreateNew` callback.
 *   - Inline `selectResult` field map: REPLACED with
 *     `catalogItemToDraft(productOptionToCatalogItem(product), {...})`.
 *   - Inline `handleInlineCreate` field map after the `POST /api/items`
 *     response: REPLACED with the same canonical mapper path
 *     (`normalizeProductRow` → `productOptionToCatalogItem` →
 *     `catalogItemToDraft`).
 *   - In-memory row state: REWORKED to use the canonical `LineItemDraft`
 *     shape (same as every other selector surface in Phase A–C). The PM
 *     bulk-upsert wire format is unchanged — a small local projection
 *     (`pmBulkRowFromDraft`) maps each canonical draft to the persisted
 *     `{productId, quantity}` shape at save time.
 *
 * The PM bulk-save contract is INTENTIONALLY UNCHANGED:
 *
 *     PUT /api/locations/:locationId/pm-parts
 *     payload: { parts: [{ productId, quantity }] }
 *
 * Do NOT use `draftToJobPartPayload` here — that's the office job_parts
 * route, not the PM/location-parts route. The local
 * `pmBulkRowFromDraft` is the one obvious projection helper at the save
 * boundary, mirroring the same pattern as `templateLineFromDraft` /
 * `pmTemplateLineFromDraft` from Phase B.
 */

import { useMemo, useState, useEffect } from "react";
import { ModalShell, ModalHeader, ModalTitle } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { LocationPMPartTemplate } from "@shared/schema";
import type { LineItemDraft } from "@shared/lineItem";
import { parseMoney } from "@shared/lineItem";
import { CreateOrSelectField } from "@/components/shared/CreateOrSelectField";
import {
  useProductSearch,
  getProductKey,
  getProductLabel,
  getProductDescription,
  normalizeProductRow,
  productOptionToCatalogItem,
  type ProductOption,
} from "@/lib/entities/productEntity";
import {
  catalogItemToDraft,
  blankDraft,
  hydrateDraft,
} from "@/lib/entities/lineItemMapper";

/** PM part template with joined item fields (returned by GET /api/locations/:id/pm-parts) */
interface PMPartWithItem extends LocationPMPartTemplate {
  itemName: string | null;
  itemSku: string | null;
  itemCategory: string | null;
  itemCost: string | null;
}

interface PartsSelectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  existingParts?: PMPartWithItem[];
}

/**
 * Project a canonical `LineItemDraft` down to the PM bulk-upsert row shape
 * the server expects: `{ productId, quantity }`. The PM/location-parts
 * persistence model only stores those two fields per row (the table also
 * has `equipmentId` / `descriptionOverride` / `equipmentLabel` columns,
 * but this modal does not edit them — that flow lives elsewhere).
 *
 * Local to this file, mirroring the same projection pattern as
 * `templateLineFromDraft` / `pmTemplateLineFromDraft` in Phase B.
 *
 * `quantity` is round-tripped through `parseMoney` so a malformed string
 * never reaches the wire — invalid input becomes `1` per the canonical
 * default. The server's PM bulk-upsert validator is the final authority.
 */
function pmBulkRowFromDraft(draft: LineItemDraft): { productId: string; quantity: string } {
  // canSave gate guarantees draft.productId is non-null before this is called
  const productId = draft.productId!;
  const qtyNum = parseMoney(draft.quantity);
  return {
    productId,
    quantity: String(qtyNum > 0 ? qtyNum : 1),
  };
}

export function PartsSelectorModal({ open, onOpenChange, locationId, existingParts = [] }: PartsSelectorModalProps) {
  const { toast } = useToast();
  // 2026-04-10 Phase D: rows are canonical LineItemDraft[] — same shape as
  // every other selector surface in the client. No local PartRow shadow.
  const [rows, setRows] = useState<LineItemDraft[]>([blankDraft({ source: "manual" })]);
  const [isSaving, setIsSaving] = useState(false);
  // Per-row inline-create-in-progress state. Lives at the parent because the
  // create POST is a parent-owned mutation.
  const [creatingByRow, setCreatingByRow] = useState<Record<string, boolean>>({});

  // Prefill rows from existing parts when modal opens
  useEffect(() => {
    if (!open) return;
    if (existingParts.length > 0) {
      // 2026-04-10 Phase D: hydrate persisted PM template rows through the
      // canonical hydrateDraft. The `LocationPMPartTemplate` row only carries
      // a subset of canonical fields (productId, quantityPerVisit, plus the
      // joined item* fields) — hydrateDraft fills the rest with safe defaults.
      setRows(
        existingParts.map((ep) =>
          hydrateDraft({
            id: ep.id, // persisted PM template UUID
            description: ep.itemName || "Unknown Part",
            quantity: ep.quantityPerVisit,
            unitCost: ep.itemCost ?? "0",
            // unitPrice is not stored on the PM template — leave the
            // canonical default ("0.00"). The PM bulk-upsert route only
            // reads productId + quantity from the wire.
            productId: ep.productId,
            source: "manual",
          }),
        ),
      );
    } else {
      setRows([blankDraft({ source: "manual" })]);
    }
    setCreatingByRow({});
  }, [open, existingParts]);

  // ========================================
  // ROW MUTATIONS — all canonical
  // ========================================

  /**
   * 2026-04-10 Phase D: canonical catalog→draft mapping. Replaces the inline
   * `selectResult` field map. Preserves the row id and the user-entered
   * quantity so the table doesn't reorder and the qty isn't reset.
   */
  const handleSelectProduct = (rowId: string, product: ProductOption) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const fresh = catalogItemToDraft(productOptionToCatalogItem(product), {
          source: "manual",
          quantity: r.quantity,
        });
        return { ...fresh, id: r.id };
      }),
    );
  };

  /**
   * Clear the catalog link without removing the row. Description and price
   * are wiped so the user can re-enter search mode for this row.
   */
  const handleClearProduct = (rowId: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? { ...r, productId: null, description: "", unitPrice: "0.00", unitCost: "0.00" }
          : r,
      ),
    );
  };

  /**
   * Inline create-new: POST /api/items, then auto-select the freshly-created
   * catalog item via the same canonical mapper path as a normal selection.
   * The response is normalized through `normalizeProductRow` so the in-memory
   * shape stays canonical.
   */
  const handleInlineCreate = async (rowId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    // Prevent double-click
    setCreatingByRow((prev) => {
      if (prev[rowId]) return prev;
      return { ...prev, [rowId]: true };
    });

    try {
      const created = await apiRequest<unknown>("/api/items", {
        method: "POST",
        body: JSON.stringify({ type: "product", name: trimmed }),
      });

      // Normalize the create response into a canonical ProductOption, then
      // route through the same selection path the dropdown uses.
      const productOption = normalizeProductRow(created);
      handleSelectProduct(rowId, productOption);

      // Invalidate items cache so the new part shows in future searches
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });

      toast({ title: "Part created", description: `"${trimmed}" has been added to your catalog.` });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create part.",
        variant: "destructive",
      });
    } finally {
      setCreatingByRow((prev) => ({ ...prev, [rowId]: false }));
    }
  };

  const updateQty = (rowId: string, qty: string) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, quantity: qty } : r)));
  };

  const removeRow = (rowId: string) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== rowId);
      return next.length === 0 ? [blankDraft({ source: "manual" })] : next;
    });
    setCreatingByRow((prev) => {
      const n = { ...prev };
      delete n[rowId];
      return n;
    });
  };

  const addRow = () => {
    setRows((prev) => [...prev, blankDraft({ source: "manual" })]);
  };

  // ========================================
  // SAVE — preserves the PM/location-parts bulk-upsert contract verbatim
  // ========================================

  // 2026-04-10 Phase D: parseMoney replaces bare parseFloat for the qty gate.
  const allValid = rows.every((r) => r.productId && parseMoney(r.quantity) >= 0.01);

  // Duplicate productId detection — unchanged in logic, reads from canonical
  // draft.productId instead of the old `selected.id`.
  const productIdCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      if (r.productId) {
        counts[r.productId] = (counts[r.productId] ?? 0) + 1;
      }
    }
    return counts;
  }, [rows]);
  const hasDuplicates = Object.values(productIdCounts).some((c) => c > 1);

  const canSave = allValid && !hasDuplicates && !isSaving;

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      // 2026-04-10 Phase D: canonical drafts → PM bulk-upsert wire shape via
      // the local projection helper. The PM/location-parts route only reads
      // {productId, quantity}. Do NOT route this through draftToJobPartPayload
      // (that's the job_parts contract).
      const payload = {
        parts: rows.map(pmBulkRowFromDraft),
      };

      await apiRequest(`/api/locations/${locationId}/pm-parts`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      queryClient.invalidateQueries({ queryKey: ["/api/locations", locationId, "pm-parts"] });
      toast({ title: "Parts saved", description: "PM parts have been updated for this location." });
      onOpenChange(false);
    } catch (error) {
      console.error("Save error:", error);
      toast({ title: "Error", description: "Failed to save parts.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  // ========================================
  // RENDER
  // ========================================

  return (
    <ModalShell open={open} onOpenChange={onOpenChange} className="max-w-4xl w-[95vw] max-h-[85vh] flex flex-col">
      <ModalHeader>
        <ModalTitle>Location Parts</ModalTitle>
      </ModalHeader>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 py-2 px-5">
        {rows.map((row, idx) => (
          <PartsSelectorRow
            key={row.id}
            row={row}
            index={idx}
            isCreating={!!creatingByRow[row.id]}
            isDuplicate={!!(row.productId && productIdCounts[row.productId] > 1)}
            onSelect={(product) => handleSelectProduct(row.id, product)}
            onClear={() => handleClearProduct(row.id)}
            onCreateNew={(text) => handleInlineCreate(row.id, text)}
            onQtyChange={(qty) => updateQty(row.id, qty)}
            onRemove={() => removeRow(row.id)}
          />
        ))}
      </div>

      <div className="flex items-center justify-between px-5 py-3 border-t">
        <Button variant="outline" size="sm" onClick={addRow} data-testid="button-add-row">
          <Plus className="h-4 w-4 mr-1" />
          Add another part
        </Button>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-parts">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave} data-testid="button-save-parts">
            {isSaving ? "Saving..." : "Save Parts"}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

// ========================================
// Per-row child component
// ========================================
//
// 2026-04-10 Phase D: Each row owns its own search-text state because the
// canonical `useProductSearch` hook is keyed by query string. The selected
// `ProductOption` is reconstructed from the canonical draft fields so the
// CreateOrSelectField chip renders without a parallel selectedProduct state.
//
// Mirror of the per-row cells in QuoteTemplateModal (Phase A), JobTemplateModal
// (Phase B), PMTemplateEditorPage (Phase B), EditVisitModal (Phase B),
// VisitDetailPage tech AddPartSheet (Phase C).

function PartsSelectorRow({
  row,
  index,
  isCreating,
  isDuplicate,
  onSelect,
  onClear,
  onCreateNew,
  onQtyChange,
  onRemove,
}: {
  row: LineItemDraft;
  index: number;
  isCreating: boolean;
  isDuplicate: boolean;
  onSelect: (product: ProductOption) => void;
  onClear: () => void;
  onCreateNew: (searchText: string) => void;
  onQtyChange: (qty: string) => void;
  onRemove: () => void;
}) {
  const [searchText, setSearchText] = useState("");
  const { data: searchResults = [], isLoading } = useProductSearch(searchText);

  // Reconstruct a ProductOption from the canonical draft for the selector chip.
  // No parallel `selectedProduct` state — the canonical draft is the single
  // source of truth for selection.
  const selectedValue: ProductOption | null = row.productId
    ? {
        id: row.productId,
        name: row.description,
        type: row.productType ?? "product",
        unitPrice: row.unitPrice,
        cost: row.unitCost,
      }
    : null;

  return (
    <div className="border rounded-md p-3 space-y-2" data-testid={`row-pm-part-${index}`}>
      {/* Row header: search/select + qty + remove */}
      <div className="flex items-start gap-2">
        <span className="text-helper font-medium text-muted-foreground w-6 shrink-0 mt-2">#{index + 1}</span>

        <div className="flex-1 min-w-0">
          <CreateOrSelectField<ProductOption>
            label=""
            compact
            value={selectedValue}
            disabled={isCreating}
            onChange={(product) => {
              if (product) {
                onSelect(product);
                setSearchText("");
              } else {
                onClear();
                setSearchText("");
              }
            }}
            searchResults={searchResults}
            searchLoading={isLoading}
            searchText={searchText}
            onSearchTextChange={setSearchText}
            getKey={getProductKey}
            getLabel={getProductLabel}
            getDescription={getProductDescription}
            createLabel={`Create new part "${searchText || "new"}"`}
            onCreateNew={(text) => onCreateNew(text)}
            placeholder="Search parts by name or SKU..."
          />
        </div>

        <div className="flex items-center gap-1 shrink-0 mt-1">
          <span className="text-helper text-muted-foreground">Qty:</span>
          <Input
            type="number"
            min={0.01}
            step="any"
            value={row.quantity}
            onChange={(e) => onQtyChange(e.target.value)}
            className="w-16 text-center text-sm"
            data-testid={`input-qty-${index}`}
          />
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive shrink-0 mt-1"
          onClick={onRemove}
          data-testid={`button-remove-row-${index}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Duplicate warning */}
      {isDuplicate && (
        <div className="ml-8 text-xs text-destructive">
          Duplicate part — each part should only appear once.
        </div>
      )}
    </div>
  );
}
