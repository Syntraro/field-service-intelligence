/**
 * PricebookPickerModal — canonical bulk-select catalog picker.
 *
 * Domain wrapper (modal taxonomy rule #4). Internally mounts the
 * canonical `<ModalShell>` + `<ModalHeader>` / `<ModalFooter>` per the
 * primitives in `client/src/components/ui/modal.tsx`. Owns its own
 * width — `ModalShell` stays width-neutral.
 *
 * 2026-05-07 polish — fast bulk-selection model:
 *   • Always-visible quantity controls. No two-mode card; user never
 *     needs a pre-selecting click. Plus / minus mutate quantity
 *     directly. Reaching 0 clears the selection for that item.
 *   • Cards are compact + dense — desktop ≈ 4 cols via `auto-fill /
 *     minmax(200px, 1fr)`, tablet 2–3 cols, mobile 1 col.
 *   • One canonical close button — `<DialogPrimitive.Close>` baked
 *     into `<DialogContent>` is the only X. The earlier manual button
 *     duplicated it.
 *   • Per-item card is `React.memo`'d with stable parent callbacks so
 *     clicking + on one card doesn't re-render the others. Rapid
 *     clicking across many cards stays snappy.
 *
 * Behavior contract (also pinned by tests/pricebook-picker.test.ts):
 *   - Plus increments quantity on the same selection entry (no dupes).
 *   - Minus decrements; quantity 0 → unselected.
 *   - Submit is disabled when the selection is empty.
 *   - Submit calls `onSubmit(drafts)` where each item with qty N is
 *     ONE draft with quantity N.
 *   - Selection survives search filter changes; cleared on close.
 *   - Submit label is caller-driven via `surface`.
 */

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Minus, Plus, Search } from "lucide-react";

import { apiRequest } from "@/lib/queryClient";
// 2026-05-08 Phase 4 — capability-gated stock overlay on picker rows.
import { useFeatureEnabled } from "@/hooks/useEntitlements";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalFooter,
  ModalPrimaryAction,
  ModalSecondaryAction,
} from "@/components/ui/modal";
import {
  normalizeProductRow,
  type ProductOption,
} from "@/lib/entities/productEntity";
import { formatCurrency } from "@/lib/formatters";
import type { LineItemDraft } from "@shared/lineItem";
import type { LineItemsAdapter } from "./types";
import {
  buildPricebookSubmitEntries,
  decrementSelection,
  expandedGroupChildCount,
  filterPricebookItems,
  incrementSelection,
  pricebookSubmitLabel,
  selectedCount,
  selectedGroupsTotal,
  selectedTotal,
  toggleGroupSelection,
  type PricebookGroupSelections,
  type PricebookSelections,
} from "./pricebookHelpers";
import { PricebookGroupsRail } from "./PricebookGroupsRail";
import { PricebookGroupModal } from "./PricebookGroupModal";
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
  recordPricebookGroupUsage,
  useDeletePricebookGroup,
  usePricebookGroups,
  type RecordPricebookGroupUsageBody,
} from "@/lib/pricebook/usePricebookGroups";
import type { PricebookGroupSummaryDto } from "./pricebookHelpers";

export interface PricebookPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surface: LineItemsAdapter["surface"];
  /**
   * Submit handler. Receives one entry per selected item with quantity
   * pre-applied; re-shapes for `useLineItemsDrafts.appendMany`. Caller
   * is responsible for closing the modal — we leave that to the host
   * so it can also fire toasts / focus changes alongside.
   */
  onSubmit: (
    entries: Array<{ draft: LineItemDraft; product: ProductOption }>,
  ) => void;
}

/**
 * Pricebook fetch — single bulk read of the catalog. Server endpoint is
 * `/api/items` (canonical catalog list).
 *
 *   • Empty search  → `?sort=most_used&limit=200`. The route ranks
 *     items by historical usage count across invoice_lines,
 *     quote_lines, and job_parts (tenant-scoped). Top-12 most-used
 *     surface in the first row of the grid; items with zero usage
 *     fall to the end alphabetical. This is the picker's default
 *     "what does this tenant tend to add?" experience.
 *   • Non-empty search → `?q=…&limit=200`. Server applies the
 *     existing case-insensitive ILIKE search across name / sku /
 *     description. Sort defaults to alphabetical for search results
 *     (relevance-ish — the user is already filtering by typed text).
 *
 * Typing also filters client-side via `filterPricebookItems` for
 * instant feedback before the server query settles.
 */
function usePricebookItems(searchText: string) {
  return useQuery<ProductOption[]>({
    queryKey: ["/api/items", "pricebook", searchText],
    queryFn: async () => {
      const trimmed = searchText.trim();
      const qs = trimmed
        ? `?q=${encodeURIComponent(trimmed)}&limit=200`
        : "?sort=most_used&limit=200";
      const res = await apiRequest<any>(`/api/items${qs}`);
      const rows = Array.isArray(res) ? res : (res?.data ?? res?.items ?? []);
      return rows.map(normalizeProductRow);
    },
    staleTime: 30_000,
  });
}

/**
 * Phase 4 (2026-05-08) — capability-gated stock overlay for picker
 * rows. Returns `null` when the tenant doesn't have the inventory_core
 * feature (no API call fires); otherwise returns a Map keyed by item
 * id carrying the per-item aggregate stock the picker card needs to
 * render the In Stock / Out of Stock chip.
 *
 * Reuses the canonical /api/inventory/items endpoint from Phase 1 +
 * its cache key shape so the picker overlay stays consistent with
 * the InventoryPage Items tab — a refresh on either surface
 * benefits the other.
 */
function useStockOverlay(opts: {
  enabled: boolean;
}): Map<string, PricebookItemStockOverlay> | null {
  const inventoryEnabled = useFeatureEnabled("inventory_core") === true;
  const query = useQuery<{ items: any[] }>({
    queryKey: ["/api/inventory/items"],
    queryFn: async () => {
      const res = await fetch("/api/inventory/items", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load inventory overlay (${res.status})`);
      return res.json();
    },
    enabled: opts.enabled && inventoryEnabled,
    staleTime: 30_000,
  });
  return useMemo(() => {
    if (!inventoryEnabled || !query.data) return null;
    const m = new Map<string, PricebookItemStockOverlay>();
    for (const it of query.data.items ?? []) {
      m.set(it.id, {
        trackInventory: Boolean(it.trackInventory),
        totalAvailable: String(it.stock?.totalAvailable ?? "0"),
        totalOnHand: String(it.stock?.totalOnHand ?? "0"),
        // Phase 5: surface reserved totals so the picker can render
        // "Fully reserved" as a distinct state (totalAvailable === 0
        // AND totalReserved > 0 means stock exists but is all
        // promised) vs "Out of stock" (totalOnHand === 0).
        totalReserved: String(it.stock?.totalReserved ?? "0"),
        locationCount: Number(it.stock?.locationCount ?? 0),
      });
    }
    return m;
  }, [inventoryEnabled, query.data]);
}

export function PricebookPickerModal({
  open,
  onOpenChange,
  surface,
  onSubmit,
}: PricebookPickerModalProps) {
  const [search, setSearch] = useState("");
  const [selections, setSelections] = useState<PricebookSelections>(new Map());
  // 2026-05-07 RALPH (Pricebook Groups): saved bundles selected via
  // the right rail. Group selection is independent of item selection;
  // submit fans both into one merged draft list (with duplicate
  // merging — see `buildPricebookSubmitEntries`).
  const [groupSelections, setGroupSelections] = useState<PricebookGroupSelections>(
    new Set(),
  );
  // 2026-05-07 RALPH (Pricebook Groups — edit/delete UX): one
  // modal instance for both create + edit. `groupModalMode` flips
  // between "create" and "edit"; `editingGroup` carries the snapshot
  // for the edit path. Delete uses a separate AlertDialog.
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupModalMode, setGroupModalMode] = useState<"create" | "edit">("create");
  const [editingGroup, setEditingGroup] = useState<PricebookGroupSummaryDto | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<PricebookGroupSummaryDto | null>(
    null,
  );
  const deleteMutation = useDeletePricebookGroup();

  // Selection survives search filter changes (per brief). Cleared only
  // on close — re-opening yields a fresh canvas.
  useEffect(() => {
    if (!open) {
      setSelections(new Map());
      setSearch("");
      setGroupSelections(new Set());
      setGroupModalOpen(false);
      setGroupModalMode("create");
      setEditingGroup(null);
      setDeleteTarget(null);
    }
  }, [open]);

  const { data: serverItems = [], isLoading, isError, refetch } =
    usePricebookItems(search);

  // Saved groups for the right rail. Only fetched while the picker is
  // open so closed pickers don't pay for the round-trip.
  const groupsQuery = usePricebookGroups({ enabled: open });
  const groups = groupsQuery.data ?? [];

  // Phase 4: stock overlay. When the tenant has the inventory_core
  // feature, fetch /api/inventory/items in parallel with the catalog
  // and build a Map<itemId, PricebookItemStockOverlay>. The card
  // renders a chip when (a) the overlay row exists AND (b) the item
  // is product + trackInventory. Service items + non-stock products
  // are silently filtered out — they never see a chip. The query is
  // gated on the feature so tenants without inventory pay zero
  // network cost for the overlay.
  const stockOverlay = useStockOverlay({ enabled: open });

  // Client-side filter as a preview while typing — keeps the grid
  // responsive even before the server query settles.
  const visibleItems = useMemo(
    () => filterPricebookItems(serverItems, search),
    [serverItems, search],
  );

  const itemCount = selectedCount(selections);
  const itemTotal = useMemo(
    () => selectedTotal(selections, serverItems),
    [selections, serverItems],
  );
  const groupCount = groupSelections.size;
  const expandedItemCount = useMemo(
    () => expandedGroupChildCount(groups, groupSelections),
    [groups, groupSelections],
  );
  const groupsTotal = useMemo(
    () => selectedGroupsTotal(groups, groupSelections),
    [groups, groupSelections],
  );
  const totalLineCount = itemCount + expandedItemCount;
  const grandTotal = itemTotal + groupsTotal;

  // Stable per-item callbacks. Passing these to the memoized card
  // means clicking + on one card does NOT re-render the others —
  // only the targeted card sees a quantity change. Empty deps because
  // setSelections (functional updater form) is stable.
  const onIncrement = useCallback((itemId: string) => {
    setSelections((prev) => incrementSelection(prev, itemId));
  }, []);
  const onDecrement = useCallback((itemId: string) => {
    setSelections((prev) => decrementSelection(prev, itemId));
  }, []);
  const onToggleGroup = useCallback((groupId: string) => {
    setGroupSelections((prev) => toggleGroupSelection(prev, groupId));
  }, []);

  // Map the picker surface onto the usage-tracking target enum. The
  // service treats any unrecognized value as "job", so the fallback
  // is safe.
  const usageTarget: RecordPricebookGroupUsageBody["target"] =
    surface === "invoice"
      ? "invoice"
      : surface === "quote"
        ? "quote"
        : surface === "quote-template"
          ? "quote_template"
          : "job";

  const handleSubmit = useCallback(() => {
    const entries = buildPricebookSubmitEntries(
      selections,
      serverItems,
      groups,
      groupSelections,
    );
    if (entries.length === 0) return;
    onSubmit(entries);
    // Fire-and-forget usage increments per selected group. Failures
    // are intentionally swallowed — usage tracking is advisory and
    // must never block the bulk-add UX.
    if (groupSelections.size > 0) {
      groupSelections.forEach((groupId) => {
        recordPricebookGroupUsage(groupId, { target: usageTarget }).catch(
          () => undefined,
        );
      });
    }
    setSelections(new Map());
    setGroupSelections(new Set());
    onOpenChange(false);
  }, [
    selections,
    serverItems,
    groups,
    groupSelections,
    onSubmit,
    onOpenChange,
    usageTarget,
  ]);

  const submitLabel = pricebookSubmitLabel(surface);
  const submitDisabled = itemCount === 0 && groupCount === 0;

  // ── Group lifecycle handlers (rail action plumbing) ──
  // Open the New Group flow.
  const openNewGroup = useCallback(() => {
    setGroupModalMode("create");
    setEditingGroup(null);
    setGroupModalOpen(true);
  }, []);
  // Open the Edit Group flow. Carries the current snapshot so the
  // modal preloads name / description / children without a refetch.
  const openEditGroup = useCallback((group: PricebookGroupSummaryDto) => {
    setGroupModalMode("edit");
    setEditingGroup(group);
    setGroupModalOpen(true);
  }, []);
  // Stage a delete confirmation. The actual hard-delete fires from
  // the AlertDialog confirm handler below.
  const askDeleteGroup = useCallback((group: PricebookGroupSummaryDto) => {
    setDeleteTarget(group);
  }, []);
  const cancelDelete = useCallback(() => setDeleteTarget(null), []);
  const confirmDelete = useCallback(async () => {
    const target = deleteTarget;
    if (!target) return;
    try {
      await deleteMutation.mutateAsync(target.id);
      // If the deleted group was selected, drop it from the
      // selection set so the footer summary reflects reality. The
      // list query is invalidated by the mutation so the rail
      // disappears the card on its own.
      setGroupSelections((prev) => {
        if (!prev.has(target.id)) return prev;
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
      setDeleteTarget(null);
    } catch {
      // Mutation surfaces the error on the AlertDialog body via
      // `deleteMutation.error`. Keep the dialog open so the user
      // can retry.
      // (Hard-delete is irreversible from the UI; once committed,
      // the user must re-create the group from scratch — that's the
      // intended UX for v1.)
    }
  }, [deleteMutation, deleteTarget]);

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      // 2026-05-07 sizing pass (default-height fix) — domain wrapper
      // owns its own dimensions per modal taxonomy rule #5.
      //   • Width: `min(1040px, viewport - 32px)` keeps the modal
      //     comfortably inside iPad landscape (1180px) and any common
      //     desktop, and never spills into a horizontal scroll on
      //     narrower phones. `max-w-[1040px]` overrides the base
      //     DialogContent's `max-w-lg` (512px).
      //   • Height: EXPLICIT `sm:h-[min(720px,calc(100vh-80px))]`,
      //     not just `max-h`. Shell needs a defined height so the
      //     body's `flex-1` has a parent to distribute from — without
      //     it, `flex-1` collapses to content height and the modal
      //     opens short whenever the catalog is sparse. The `min(...)`
      //     also acts as the viewport-safe cap, so we don't need a
      //     separate max-h. Below `sm:` (mobile), no height is set —
      //     phones get natural content height with normal scroll.
      //   • `flex flex-col` lets the body grow into the leftover
      //     space between header and footer.
      className="w-[min(1040px,calc(100vw-32px))] max-w-[1040px] sm:max-w-[1040px] sm:h-[min(720px,calc(100vh-80px))] flex flex-col"
      data-testid="pricebook-picker-modal"
    >
      <ModalHeader className="space-y-2">
        {/*
          Title block. The X close button is rendered automatically by
          `<DialogContent>` (Radix `DialogPrimitive.Close`) — see
          `client/src/components/ui/dialog.tsx`. Do NOT add a second
          manual close button here; that produced two X's in the prior
          revision. `pr-8` reserves space so the title can't slide
          under the canonical X.
        */}
        <div className="space-y-1.5 pr-8">
          <ModalTitle data-testid="pricebook-modal-title">Pricebook</ModalTitle>
          <ModalDescription>
            Select saved items to add them in bulk.
          </ModalDescription>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search pricebook items"
            className="pl-8 h-9 text-sm"
            data-testid="pricebook-search-input"
          />
        </div>
      </ModalHeader>

      {/*
        2026-05-07 RALPH (Pricebook Groups): the picker body is now a
        2-column flex on desktop / iPad landscape — items grid on the
        left, groups rail on the right. On narrow widths the rail
        wraps below the items grid (flex-wrap), keeping the existing
        item card density unchanged. The grid + rail share one scroll
        ancestor so the scroll feel matches the prior single-pane
        layout.
      */}
      <div
        className="flex-1 sm:min-h-[480px] max-h-[min(620px,calc(100vh-220px))] overflow-y-auto px-4 py-3 bg-app-bg flex flex-col md:flex-row gap-3 md:gap-3 min-h-0"
        data-testid="pricebook-body"
      >
        <div
          className="flex-1 min-w-0 min-h-0"
          data-testid="pricebook-items-pane"
        >
          {isLoading ? (
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}
            >
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <Skeleton key={i} className="h-[96px] w-full rounded-md" />
              ))}
            </div>
          ) : isError ? (
            <div
              className="rounded-md border border-rose-200 bg-rose-50 px-4 py-6 text-center"
              data-testid="pricebook-error"
            >
              <p className="text-sm text-rose-700">
                Couldn't load pricebook items. Please try again.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 h-8 text-xs"
                onClick={() => refetch()}
              >
                Retry
              </Button>
            </div>
          ) : visibleItems.length === 0 ? (
            search.trim().length > 0 ? (
              <div
                className="rounded-md border border-slate-200 bg-white px-4 py-8 text-center"
                data-testid="pricebook-empty-search"
              >
                <p className="text-sm text-slate-600">
                  No pricebook items match "{search.trim()}".
                </p>
              </div>
            ) : (
              <div
                className="rounded-md border border-slate-200 bg-white px-4 py-8 text-center"
                data-testid="pricebook-empty"
              >
                <p className="text-sm text-slate-600">
                  You don't have any saved pricebook items yet.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Add items from Settings → Pricebook to use the bulk picker.
                </p>
              </div>
            )
          ) : (
            <ul
              className="grid gap-2"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}
              data-testid="pricebook-items"
            >
              {visibleItems.map((item) => {
                const qty = selections.get(item.id) ?? 0;
                return (
                  <li key={item.id}>
                    <PricebookItemCard
                      item={item}
                      quantity={qty}
                      onIncrement={onIncrement}
                      onDecrement={onDecrement}
                      stock={stockOverlay?.get(item.id)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <PricebookGroupsRail
          groups={groups}
          isLoading={groupsQuery.isLoading}
          isError={groupsQuery.isError}
          selectedGroupIds={groupSelections}
          onToggleGroup={onToggleGroup}
          onNewGroup={openNewGroup}
          onEditGroup={openEditGroup}
          onDeleteGroup={askDeleteGroup}
          disabled={deleteMutation.isPending}
        />
      </div>

      <PricebookGroupModal
        open={groupModalOpen}
        onOpenChange={setGroupModalOpen}
        mode={groupModalMode}
        group={editingGroup}
        onCreated={(groupId) => {
          // Auto-select the freshly created group so it shows up in
          // the footer summary immediately. The list query is
          // invalidated by the create mutation so the rail picks up
          // the new card on its own.
          setGroupSelections((prev) => {
            const next = new Set(prev);
            next.add(groupId);
            return next;
          });
        }}
        onUpdated={(_groupId) => {
          // Selection persists across edits — if the edited group
          // was selected before save, it remains selected after.
          // The list query invalidation refreshes its `children`
          // snapshot in the rail automatically.
        }}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) cancelDelete();
        }}
      >
        <AlertDialogContent data-testid="pricebook-group-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete group?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `This deletes the group "${deleteTarget.name}" only. Pricebook items inside it will not be deleted.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteMutation.isError ? (
            <p
              className="text-xs text-rose-700 px-1"
              role="alert"
              data-testid="pricebook-group-delete-error"
            >
              {(deleteMutation.error as Error)?.message ??
                "Could not delete the group. Please try again."}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleteMutation.isPending}
              data-testid="pricebook-group-delete-cancel"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Prevent Radix from auto-closing before the mutation
                // resolves; we close manually on success.
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleteMutation.isPending}
              data-testid="pricebook-group-delete-confirm"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete group"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      <ModalFooter className="justify-between">
        <ModalSecondaryAction
          onClick={() => onOpenChange(false)}
          data-testid="pricebook-cancel"
        >
          Cancel
        </ModalSecondaryAction>
        <div className="flex items-center gap-3">
          <span
            className="text-xs text-slate-600 tabular-nums"
            data-testid="pricebook-summary"
          >
            {submitDisabled
              ? "No items selected"
              : formatPickerSummary({
                  itemCount,
                  groupCount,
                  totalLineCount,
                  grandTotal,
                })}
          </span>
          <ModalPrimaryAction
            onClick={handleSubmit}
            disabled={submitDisabled}
            data-testid="pricebook-submit"
          >
            {submitLabel}
          </ModalPrimaryAction>
        </div>
      </ModalFooter>
    </ModalShell>
  );
}

/** Footer summary: combines individual item and group counts into one
 *  human line. Shape: "{N groups} {M items} {· total}". When only
 *  one side is selected, the other side is omitted. Exposed as a
 *  helper so the source-pin tests can assert the shape without
 *  rendering. */
function formatPickerSummary({
  itemCount,
  groupCount,
  totalLineCount,
  grandTotal,
}: {
  itemCount: number;
  groupCount: number;
  totalLineCount: number;
  grandTotal: number;
}): string {
  const parts: string[] = [];
  if (groupCount > 0) {
    parts.push(`${groupCount} group${groupCount === 1 ? "" : "s"} selected`);
  }
  if (totalLineCount > 0) {
    parts.push(`${totalLineCount} item${totalLineCount === 1 ? "" : "s"}`);
  }
  const summary = parts.join(" · ");
  if (totalLineCount === 0 && grandTotal === 0) {
    return summary;
  }
  return `${summary} · Estimated total ${formatCurrency(grandTotal)}`;
}

// ── Item card ────────────────────────────────────────────────────────

/** Phase 4 (2026-05-08) — optional stock overlay for inventory-aware
 *  visibility on picker rows. The picker fetches /api/inventory/items
 *  in parallel with the catalog query when the inventory_core feature
 *  is enabled, then maps results by item id and passes the per-row
 *  entry into the card. The card renders a small "In Stock" / "Out of
 *  Stock" chip only when (a) the overlay row exists and (b) the item
 *  is product + trackInventory. Service items + non-stock products
 *  never see a chip. */
export interface PricebookItemStockOverlay {
  trackInventory: boolean;
  totalAvailable: string;
  totalOnHand: string;
  /** Phase 5: total reserved across locations. Used to distinguish
   *  "fully reserved" (stock exists but is held) from "out of stock"
   *  (no physical stock). */
  totalReserved: string;
  locationCount: number;
}

interface PricebookItemCardProps {
  item: ProductOption;
  quantity: number;
  onIncrement: (itemId: string) => void;
  onDecrement: (itemId: string) => void;
  stock?: PricebookItemStockOverlay;
}

/**
 * Memoized so a click on one card only re-renders that card. The
 * parent passes stable `useCallback`-wrapped handlers; the card calls
 * them with its own `item.id`, so prop equality holds for siblings
 * whose quantity didn't change.
 */
const PricebookItemCard = memo(function PricebookItemCard({
  item,
  quantity,
  onIncrement,
  onDecrement,
  stock,
}: PricebookItemCardProps) {
  const isSelected = quantity > 0;
  const typeLabel = item.type === "service" ? "Service" : "Product";
  const typeBadgeClass =
    item.type === "service"
      ? "bg-sky-50 text-sky-700 border-sky-200"
      : "bg-emerald-50 text-emerald-700 border-emerald-200";
  const priceLabel = formatCurrency(Number(item.unitPrice ?? 0) || 0);

  const handleIncrement = useCallback(
    () => onIncrement(item.id),
    [onIncrement, item.id],
  );
  const handleDecrement = useCallback(
    () => onDecrement(item.id),
    [onDecrement, item.id],
  );

  return (
    <div
      className={
        "h-full rounded-md border bg-white p-2.5 transition-colors flex flex-col " +
        (isSelected
          ? "border-emerald-500 ring-1 ring-emerald-200 bg-emerald-50/40"
          : "border-card-border hover:border-slate-300 hover:bg-slate-50")
      }
      data-testid={`pricebook-item-${item.id}`}
      data-selected={isSelected ? "true" : "false"}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className={
            "shrink-0 inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded border " +
            typeBadgeClass
          }
        >
          {typeLabel}
        </span>
        <h4 className="text-sm font-semibold text-slate-900 truncate min-w-0">
          {item.name}
        </h4>
      </div>

      {item.description && (
        <p
          className="mt-1 text-[11px] text-slate-600 leading-snug overflow-hidden"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {item.description}
        </p>
      )}

      {/* Phase 4 + Phase 5: inventory stock chip. Only renders when
          the tenant has inventory_core enabled AND the item is a
          product that tracks inventory. Three mutually-exclusive
          states (Phase 5 added "fully reserved"):
            - Out of stock     : totalOnHand <= 0 (nothing physical)
            - Fully reserved   : totalAvailable <= 0 AND totalOnHand > 0
                                 (stock exists but is all held by
                                 active reservations)
            - In stock         : totalAvailable > 0
          We don't compute "low stock" at this level (low-stock is
          per-(item, location) and surfaces in the rails — appropriate
          for triage, not picker selection). */}
      {stock && stock.trackInventory && (
        <div className="mt-1.5" data-testid={`pricebook-item-stock-${item.id}`}>
          {Number(stock.totalOnHand) <= 0 ? (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200"
              data-testid={`pricebook-item-stock-out-${item.id}`}
            >
              Out of stock
            </span>
          ) : Number(stock.totalAvailable) <= 0 ? (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200"
              data-testid={`pricebook-item-stock-fully-reserved-${item.id}`}
            >
              Fully reserved · {Number(stock.totalReserved)}
            </span>
          ) : (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200"
              data-testid={`pricebook-item-stock-in-${item.id}`}
            >
              {Number(stock.totalAvailable)} available
              {stock.locationCount > 1 ? ` · ${stock.locationCount} locations` : ""}
            </span>
          )}
        </div>
      )}

      <div className="mt-auto pt-1.5 flex items-center justify-between gap-1.5">
        <div className="min-w-0 flex flex-col">
          <span className="text-sm font-semibold tabular-nums text-slate-900 leading-tight">
            {priceLabel}
          </span>
          <span className="text-[10px] leading-tight text-slate-500">
            {item.isTaxable === false ? "Non-taxable" : "Taxable"}
          </span>
        </div>

        {/*
          Always-visible quantity affordance. At qty=0 a single prominent
          + button sits flush right; at qty>0 the trio (− / qty / +)
          replaces it. No explicit remove control — decrementing past 1
          drops the selection automatically via `decrementSelection`,
          which is the canonical way to unselect.
        */}
        {isSelected ? (
          <div
            className="flex items-center gap-0.5"
            data-testid={`pricebook-quantity-controls-${item.id}`}
          >
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7 shrink-0"
              onClick={handleDecrement}
              aria-label={`Decrease quantity for ${item.name}`}
              data-testid={`pricebook-decrement-${item.id}`}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <span
              className="min-w-[1.75rem] text-center text-sm font-semibold tabular-nums text-slate-900"
              data-testid={`pricebook-quantity-${item.id}`}
            >
              {quantity}
            </span>
            <Button
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={handleIncrement}
              aria-label={`Increase quantity for ${item.name}`}
              data-testid={`pricebook-increment-${item.id}`}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <Button
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={handleIncrement}
            aria-label={`Add ${item.name}`}
            data-testid={`pricebook-add-${item.id}`}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
});
