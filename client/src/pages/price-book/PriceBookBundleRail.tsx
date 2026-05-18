import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Minus, Plus, Search, X, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusChip } from "@/components/ui/chip";
import { InlineInput, InlineTextarea, FormSection } from "@/components/ui/form-field";
import { WorkspaceRailScrollContainer } from "@/components/workspace/WorkspaceRailScrollContainer";
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
  useUpdatePricebookGroup,
  useDeletePricebookGroup,
} from "@/lib/pricebook/usePricebookGroups";
import {
  normalizeProductRow,
  type ProductOption,
} from "@/lib/entities/productEntity";
import type { PricebookGroupSummaryDto } from "@/components/line-items/pricebookHelpers";

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface ChildEntry {
  product: ProductOption;
  quantity: number;
}

function childrenFromGroup(
  group: PricebookGroupSummaryDto,
): Map<string, ChildEntry> {
  const out = new Map<string, ChildEntry>();
  for (const child of group.children) {
    if (!child.itemId) continue;
    out.set(child.itemId, {
      product: {
        id: child.itemId,
        name: child.name ?? "",
        type: child.type,
        unitPrice: child.unitPrice,
        cost: child.cost,
        description: child.description,
        isTaxable: child.isTaxable ?? true,
      },
      quantity: Math.max(1, Number(child.quantity) || 1),
    });
  }
  return out;
}

function mapToSortedEntries(m: Map<string, ChildEntry>): ChildEntry[] {
  return Array.from(m.values());
}

function formatMoney(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  return isNaN(n) ? "—" : `$${n.toFixed(2)}`;
}

// ─── Item search hook (mirrors PricebookGroupModal pattern) ───────────────────

function useItemSearch(searchText: string) {
  return useQuery<ProductOption[]>({
    queryKey: ["/api/items", "bundle-rail", searchText],
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

// ─── Component ────────────────────────────────────────────────────────────────

interface PriceBookBundleRailProps {
  group: PricebookGroupSummaryDto;
  onClose: () => void;
  onSaved: (updated: PricebookGroupSummaryDto) => void;
}

export function PriceBookBundleRail({
  group,
  onClose,
  onSaved,
}: PriceBookBundleRailProps) {
  const { toast } = useToast();

  const [draftName, setDraftName] = useState(group.name);
  const [draftDescription, setDraftDescription] = useState(group.description ?? "");
  const [children, setChildren] = useState<Map<string, ChildEntry>>(
    () => childrenFromGroup(group),
  );
  const [itemSearch, setItemSearch] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Reset all draft state when a different group is selected
  useEffect(() => {
    setDraftName(group.name);
    setDraftDescription(group.description ?? "");
    setChildren(childrenFromGroup(group));
    setItemSearch("");
  }, [group.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: searchResults = [], isFetching: isSearching } = useItemSearch(itemSearch);

  // ── Derived state ──────────────────────────────────────────────────────────

  const childEntries = useMemo(() => mapToSortedEntries(children), [children]);

  const dirty = useMemo(() => {
    if (draftName !== group.name) return true;
    if (draftDescription !== (group.description ?? "")) return true;
    // Children changed?
    if (children.size !== group.children.length) return true;
    for (const child of group.children) {
      const entry = children.get(child.itemId);
      if (!entry) return true;
      if (entry.quantity !== Math.max(1, Number(child.quantity) || 1)) return true;
    }
    return false;
  }, [draftName, draftDescription, children, group]);

  // Computed pricing from draft children
  const { totalPrice, totalCost, margin } = useMemo(() => {
    let price = 0;
    let cost = 0;
    for (const entry of childEntries) {
      price += entry.quantity * parseFloat(entry.product.unitPrice ?? "0");
      cost += entry.quantity * parseFloat(entry.product.cost ?? "0");
    }
    const m = price - cost;
    return { totalPrice: price, totalCost: cost, margin: m };
  }, [childEntries]);

  // Search results: items already in children come first; exclude dupes in search list
  const displayedSearchResults = useMemo(() => {
    if (!itemSearch.trim()) return [];
    return searchResults.filter((item) => !children.has(item.id));
  }, [searchResults, children, itemSearch]);

  // ── Children mutations ─────────────────────────────────────────────────────

  function incrementChild(item: ProductOption) {
    setChildren((prev) => {
      const next = new Map(prev);
      const existing = next.get(item.id);
      if (existing) {
        next.set(item.id, { ...existing, quantity: existing.quantity + 1 });
      } else {
        next.set(item.id, { product: item, quantity: 1 });
      }
      return next;
    });
  }

  function decrementChild(itemId: string) {
    setChildren((prev) => {
      const existing = prev.get(itemId);
      if (!existing) return prev;
      const next = new Map(prev);
      if (existing.quantity <= 1) {
        next.delete(itemId);
      } else {
        next.set(itemId, { ...existing, quantity: existing.quantity - 1 });
      }
      return next;
    });
  }

  function removeChild(itemId: string) {
    setChildren((prev) => {
      const next = new Map(prev);
      next.delete(itemId);
      return next;
    });
  }

  // ── Save / Delete mutations ────────────────────────────────────────────────

  const updateMutation = useUpdatePricebookGroup();
  const deleteMutation = useDeletePricebookGroup();

  async function handleSave() {
    if (!draftName.trim()) {
      toast({ title: "Bundle name is required.", variant: "destructive" });
      return;
    }
    if (children.size === 0) {
      toast({ title: "A bundle must have at least one item.", variant: "destructive" });
      return;
    }
    try {
      const updated = await updateMutation.mutateAsync({
        id: group.id,
        body: {
          name: draftName.trim(),
          description: draftDescription.trim() || null,
          children: Array.from(children.values()).map((entry, idx) => ({
            itemId: entry.product.id,
            quantity: String(entry.quantity),
            sortOrder: idx,
          })),
        },
      });
      toast({ title: "Bundle updated." });
      onSaved(updated);
    } catch {
      toast({ title: "Error", description: "Failed to update bundle.", variant: "destructive" });
    }
  }

  function handleCancel() {
    setDraftName(group.name);
    setDraftDescription(group.description ?? "");
    setChildren(childrenFromGroup(group));
    setItemSearch("");
  }

  const isMutating = updateMutation.isPending || deleteMutation.isPending;

  return (
    <div className="h-full flex flex-col bg-card" data-testid="pricebook-bundle-rail">
      {/* ── Pinned header ────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-3 border-b border-border/40">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-list-primary truncate" data-testid="rail-bundle-name">
              {group.name}
            </p>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <StatusChip tone={group.isActive ? "success" : "neutral"}>
                {group.isActive ? "Active" : "Archived"}
              </StatusChip>
              <StatusChip tone="neutral">
                {group.itemCount} {group.itemCount === 1 ? "item" : "items"}
              </StatusChip>
              {group.usageCount > 0 && (
                <StatusChip tone="info">
                  {group.usageCount} {group.usageCount === 1 ? "use" : "uses"}
                </StatusChip>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close panel"
            data-testid="rail-button-close"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Committed pricing summary */}
        <div className="flex items-center gap-4 mt-3 text-sm">
          <div>
            <span className="block text-[11px] text-muted-foreground">Est. Total</span>
            <span className="font-medium tabular-nums">
              {totalPrice > 0 ? `$${totalPrice.toFixed(2)}` : "—"}
            </span>
          </div>
          <div>
            <span className="block text-[11px] text-muted-foreground">Est. Cost</span>
            <span className="font-medium tabular-nums">
              {totalCost > 0 ? `$${totalCost.toFixed(2)}` : "—"}
            </span>
          </div>
          {(totalPrice > 0 || totalCost > 0) && (
            <div>
              <span className="block text-[11px] text-muted-foreground">Margin</span>
              <span
                className={`font-medium tabular-nums ${
                  margin >= 0 ? "text-emerald-600" : "text-destructive"
                }`}
              >
                {margin >= 0 ? "+" : ""}${margin.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Scrollable body ──────────────────────────────────────────── */}
      <WorkspaceRailScrollContainer
        contentTestId="pricebook-bundle-rail-scroll-body"
        hintTestId="pricebook-bundle-rail-scroll-hint"
        hintText="More below"
        contentClassName="px-4 pt-3 pb-4 space-y-4"
      >
        {/* Bundle Details */}
        <FormSection title="Bundle Details" className="space-y-3">
          <InlineInput
            id="rail-bundle-name"
            label="Name"
            required
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            data-testid="rail-input-bundle-name"
          />
          <InlineTextarea
            id="rail-bundle-description"
            label="Description"
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            rows={2}
            placeholder="Optional description"
          />
        </FormSection>

        {/* Included Items */}
        <FormSection title="Included Items" className="space-y-2">
          {childEntries.length === 0 ? (
            <p className="text-[11px] text-muted-foreground py-1">
              No items yet. Search below to add items to this bundle.
            </p>
          ) : (
            <div className="space-y-1">
              {childEntries.map((entry) => (
                <div
                  key={entry.product.id}
                  className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-muted/40 hover:bg-muted/60 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{entry.product.name}</p>
                    {entry.product.unitPrice && (
                      <p className="text-[11px] text-muted-foreground">
                        {formatMoney(entry.product.unitPrice)} each
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => decrementChild(entry.product.id)}
                      disabled={isMutating}
                      aria-label="Decrease quantity"
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="text-sm tabular-nums w-6 text-center">
                      {entry.quantity}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => incrementChild(entry.product)}
                      disabled={isMutating}
                      aria-label="Increase quantity"
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => removeChild(entry.product.id)}
                      disabled={isMutating}
                      aria-label="Remove item"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </FormSection>

        {/* Add Items */}
        <FormSection title="Add Items" className="space-y-2">
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              placeholder="Search catalog…"
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
              data-testid="rail-input-item-search"
            />
          </div>

          {itemSearch.trim() && (
            <div className="space-y-1 max-h-48 overflow-y-auto rounded-md border border-border/60">
              {isSearching ? (
                <div className="p-2 space-y-1.5">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : displayedSearchResults.length === 0 ? (
                <p className="text-[11px] text-muted-foreground px-3 py-2">
                  No items found.
                </p>
              ) : (
                displayedSearchResults.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                    onClick={() => {
                      incrementChild(item);
                      setItemSearch("");
                    }}
                    disabled={isMutating}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      {item.unitPrice && (
                        <p className="text-[11px] text-muted-foreground">
                          {formatMoney(item.unitPrice)}
                        </p>
                      )}
                    </div>
                    <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                ))
              )}
            </div>
          )}
        </FormSection>

        {/* Usage Context */}
        {group.usageCount > 0 && (
          <FormSection title="Usage" className="space-y-1">
            <p className="text-[11px] text-muted-foreground">
              This bundle has been added to {group.usageCount}{" "}
              {group.usageCount === 1 ? "job, quote, or invoice" : "jobs, quotes, or invoices"}.
            </p>
          </FormSection>
        )}

        {/* QBO Note */}
        <FormSection title="QuickBooks" className="space-y-1">
          <p className="text-[11px] text-muted-foreground leading-snug">
            Bundles are internal only and do not sync to QuickBooks. When a bundle
            is added to a job, quote, or invoice, each item expands as individual
            line items — those items sync to QuickBooks independently.
          </p>
        </FormSection>
      </WorkspaceRailScrollContainer>

      {/* ── Pinned footer ─────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-3 border-t border-border/40 space-y-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive border-destructive/40 hover:border-destructive/60"
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={isMutating}
            data-testid="rail-button-delete-bundle"
          >
            Delete Bundle
          </Button>
        </div>

        {dirty && (
          <div className="flex items-center gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={handleCancel}
              disabled={isMutating}
              data-testid="rail-button-cancel"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleSave}
              disabled={isMutating}
              data-testid="rail-button-save"
            >
              {updateMutation.isPending && (
                <Loader2 className="h-3 w-3 animate-spin mr-1" aria-hidden="true" />
              )}
              Save
            </Button>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete bundle?</AlertDialogTitle>
            <AlertDialogDescription>
              "{group.name}" will be permanently deleted. This cannot be undone.
              The individual items in this bundle will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setDeleteConfirmOpen(false);
                deleteMutation.mutate(group.id, {
                  onSuccess: () => {
                    toast({ title: "Bundle deleted." });
                    onClose();
                  },
                  onError: () =>
                    toast({
                      title: "Error",
                      description: "Failed to delete bundle.",
                      variant: "destructive",
                    }),
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
