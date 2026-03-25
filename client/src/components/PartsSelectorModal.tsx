/**
 * PartsSelectorModal — Row-based multi-add for location PM parts.
 *
 * Each row: server-side search input → dropdown → quantity.
 * "Add another part" appends rows. One "Save" bulk-upserts all rows.
 * Search calls GET /api/items?q=TERM (debounced 300ms, min 2 chars).
 * Users can create a new part inline if no exact match exists via POST /api/items.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { LocationPMPartTemplate } from "@shared/schema";

/** PM part template with joined item fields (returned by GET /api/locations/:id/pm-parts) */
interface PMPartWithItem extends LocationPMPartTemplate {
  itemName: string | null;
  itemSku: string | null;
  itemCategory: string | null;
  itemCost: string | null;
}

// ========================================
// TYPES
// ========================================

interface PartSearchResult {
  id: string;
  name: string | null;
  sku: string | null;
  category: string | null;
  cost: string | null;
}

interface PartRow {
  tempId: string;
  searchTerm: string;
  selected: PartSearchResult | null;
  qty: string;
}

interface PartsSelectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  existingParts?: PMPartWithItem[];
}

// ========================================
// HELPERS
// ========================================

let _counter = 0;
function tempId(): string {
  return `row-${Date.now()}-${++_counter}`;
}

function newRow(): PartRow {
  return { tempId: tempId(), searchTerm: "", selected: null, qty: "1" };
}

// ========================================
// COMPONENT
// ========================================

export function PartsSelectorModal({ open, onOpenChange, locationId, existingParts = [] }: PartsSelectorModalProps) {
  const { toast } = useToast();
  const [rows, setRows] = useState<PartRow[]>([newRow()]);
  const [isSaving, setIsSaving] = useState(false);

  // Per-row search results & loading state
  const [resultsByRow, setResultsByRow] = useState<Record<string, PartSearchResult[]>>({});
  const [loadingByRow, setLoadingByRow] = useState<Record<string, boolean>>({});
  // Per-row inline create loading (prevents double-clicks)
  const [creatingByRow, setCreatingByRow] = useState<Record<string, boolean>>({});

  // Debounce timers keyed by tempId
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Prefill rows from existing parts when modal opens
  useEffect(() => {
    if (!open) return;
    if (existingParts.length > 0) {
      setRows(
        existingParts.map((ep) => ({
          tempId: tempId(),
          searchTerm: ep.itemName || "Unknown Part",
          selected: {
            id: ep.productId,
            name: ep.itemName,
            sku: ep.itemSku,
            category: ep.itemCategory,
            cost: ep.itemCost,
          },
          qty: ep.quantityPerVisit,
        }))
      );
    } else {
      setRows([newRow()]);
    }
    setResultsByRow({});
    setLoadingByRow({});
    setCreatingByRow({});
  }, [open, existingParts]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach(clearTimeout);
    };
  }, []);

  // ========================================
  // SEARCH
  // ========================================

  const fetchResults = useCallback(async (rowId: string, term: string) => {
    if (term.trim().length < 2) {
      setResultsByRow((prev) => ({ ...prev, [rowId]: [] }));
      setLoadingByRow((prev) => ({ ...prev, [rowId]: false }));
      return;
    }

    setLoadingByRow((prev) => ({ ...prev, [rowId]: true }));
    try {
      const res = await fetch(`/api/items?q=${encodeURIComponent(term.trim())}`, { credentials: "include" });
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      // API returns raw array (paginatedCompat with explicit=false)
      const items: PartSearchResult[] = Array.isArray(data) ? data : (data.data ?? data.items ?? []);
      setResultsByRow((prev) => ({ ...prev, [rowId]: items.slice(0, 50) }));
    } catch {
      setResultsByRow((prev) => ({ ...prev, [rowId]: [] }));
    } finally {
      setLoadingByRow((prev) => ({ ...prev, [rowId]: false }));
    }
  }, []);

  const handleSearchChange = useCallback((rowId: string, value: string) => {
    // Update searchTerm and clear selection (forces re-search / re-select)
    setRows((prev) =>
      prev.map((r) => (r.tempId === rowId ? { ...r, searchTerm: value, selected: null } : r))
    );

    // Debounce server search
    if (timersRef.current[rowId]) clearTimeout(timersRef.current[rowId]);
    timersRef.current[rowId] = setTimeout(() => fetchResults(rowId, value), 300);
  }, [fetchResults]);

  const selectResult = useCallback((rowId: string, result: PartSearchResult) => {
    setRows((prev) =>
      prev.map((r) =>
        r.tempId === rowId ? { ...r, selected: result, searchTerm: result.name || "" } : r
      )
    );
    // Clear dropdown for this row
    setResultsByRow((prev) => ({ ...prev, [rowId]: [] }));
  }, []);

  // ========================================
  // INLINE CREATE
  // ========================================

  /** Create a new part via POST /api/items, then auto-select it in the row */
  const handleInlineCreate = useCallback(async (rowId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    // Prevent double-click
    setCreatingByRow((prev) => {
      if (prev[rowId]) return prev;
      return { ...prev, [rowId]: true };
    });

    try {
      const created = await apiRequest("/api/items", {
        method: "POST",
        body: JSON.stringify({ type: "product", name: trimmed }),
      }) as PartSearchResult;

      // Auto-select the newly created part
      selectResult(rowId, {
        id: created.id,
        name: created.name,
        sku: created.sku ?? null,
        category: created.category ?? null,
        cost: created.cost ?? null,
      });

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
  }, [selectResult, toast]);

  // ========================================
  // ROW MANAGEMENT
  // ========================================

  const updateQty = useCallback((rowId: string, qty: string) => {
    setRows((prev) => prev.map((r) => (r.tempId === rowId ? { ...r, qty } : r)));
  }, []);

  const removeRow = useCallback((rowId: string) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.tempId !== rowId);
      return next.length === 0 ? [newRow()] : next;
    });
    // Cleanup results/loading for removed row
    setResultsByRow((prev) => { const n = { ...prev }; delete n[rowId]; return n; });
    setLoadingByRow((prev) => { const n = { ...prev }; delete n[rowId]; return n; });
    setCreatingByRow((prev) => { const n = { ...prev }; delete n[rowId]; return n; });
  }, []);

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, newRow()]);
  }, []);

  // ========================================
  // SAVE
  // ========================================

  const allValid = rows.every((r) => r.selected && parseFloat(r.qty) >= 0.01);

  // Check for duplicate productIds
  const productIdCounts: Record<string, number> = {};
  rows.forEach((r) => {
    if (r.selected) {
      productIdCounts[r.selected.id] = (productIdCounts[r.selected.id] || 0) + 1;
    }
  });
  const hasDuplicates = Object.values(productIdCounts).some((c) => c > 1);

  const canSave = allValid && !hasDuplicates && !isSaving;

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      const payload = {
        parts: rows.map((r) => ({
          productId: r.selected!.id,
          quantity: String(parseFloat(r.qty) || 1),
        })),
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Location Parts</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 py-2 px-1">
          {rows.map((row, idx) => {
            const results = resultsByRow[row.tempId] || [];
            const isLoading = loadingByRow[row.tempId] || false;
            const isCreating = creatingByRow[row.tempId] || false;
            const isDuplicate = row.selected && productIdCounts[row.selected.id] > 1;
            const showResults = !row.selected && (results.length > 0 || (!isLoading && row.searchTerm.trim().length >= 2));

            // Determine if "Create new" option should appear
            const trimmedSearch = row.searchTerm.trim();
            const hasExactMatch = results.some(
              (r) => r.name?.toLowerCase() === trimmedSearch.toLowerCase()
            );
            const showCreateOption = showResults && trimmedSearch.length >= 1 && !hasExactMatch && !isLoading;

            return (
              <div key={row.tempId} className="border rounded-lg p-3 space-y-2">
                {/* Row header: search input + qty + remove */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground w-6 shrink-0">#{idx + 1}</span>

                  <div className="relative flex-1">
                    <Input
                      type="text"
                      placeholder="Search parts by name or SKU..."
                      value={row.searchTerm}
                      onChange={(e) => handleSearchChange(row.tempId, e.target.value)}
                      className={`h-9 text-sm ${row.selected ? "border-primary bg-primary/5" : ""}`}
                      data-testid={`input-search-part-${idx}`}
                    />
                    {(isLoading || isCreating) && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs text-muted-foreground">Qty:</span>
                    <Input
                      type="number"
                      min={0.01}
                      step="any"
                      value={row.qty}
                      onChange={(e) => updateQty(row.tempId, e.target.value)}
                      className="w-16 h-9 text-center text-sm"
                      data-testid={`input-qty-${idx}`}
                    />
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => removeRow(row.tempId)}
                    data-testid={`button-remove-row-${idx}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {/* Inline search results + create option */}
                {showResults && (
                  <div className="ml-8 border rounded-md max-h-52 overflow-y-auto bg-popover">
                    {results.length > 0 ? (
                      results.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors border-b last:border-b-0"
                          onClick={() => selectResult(row.tempId, item)}
                          data-testid={`result-${item.id}`}
                        >
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.sku || "No SKU"} {item.category ? `• ${item.category}` : ""}
                            {item.cost ? ` • $${parseFloat(item.cost).toFixed(2)}` : ""}
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        No matching parts found
                      </div>
                    )}

                    {/* Create new part action row */}
                    {showCreateOption && (
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors border-t flex items-center gap-2 text-primary font-medium"
                        onClick={() => handleInlineCreate(row.tempId, trimmedSearch)}
                        disabled={isCreating}
                        data-testid={`create-part-${idx}`}
                      >
                        <Plus className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          Create new part "<span className="font-semibold">{trimmedSearch}</span>"
                        </span>
                      </button>
                    )}
                  </div>
                )}

                {/* Selected part summary */}
                {row.selected && (
                  <div className="ml-8 text-xs text-muted-foreground">
                    Selected: <span className="font-medium text-foreground">{row.selected.name}</span>
                    {row.selected.sku ? ` (${row.selected.sku})` : ""}
                  </div>
                )}

                {/* Duplicate warning */}
                {isDuplicate && (
                  <div className="ml-8 text-xs text-destructive">
                    Duplicate part — each part should only appear once.
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between pt-2 border-t">
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
      </DialogContent>
    </Dialog>
  );
}
