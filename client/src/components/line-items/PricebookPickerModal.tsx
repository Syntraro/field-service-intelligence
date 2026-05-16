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
// 2026-05-09: group-delete AlertDialog migrated to canonical ConfirmModal.
import { ModalStateBody, ConfirmModal } from "@/components/ui/modal";

import { apiRequest } from "@/lib/queryClient";
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
            className="pl-8 text-sm"
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
          {/* 2026-05-09: loading/error/empty replaced with canonical ModalStateBody */}
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
            <ModalStateBody
              variant="error"
              message="Couldn't load pricebook items. Please try again."
              onRetry={() => refetch()}
              data-testid="pricebook-error"
            />
          ) : visibleItems.length === 0 ? (
            search.trim().length > 0 ? (
              <ModalStateBody
                variant="empty"
                message={`No pricebook items match "${search.trim()}".`}
                data-testid="pricebook-empty-search"
              />
            ) : (
              <ModalStateBody
                variant="empty"
                message="You don't have any saved pricebook items yet."
                submessage="Add items from Settings → Pricebook to use the bulk picker."
                data-testid="pricebook-empty"
              />
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

      {/* 2026-05-09: group-delete confirm migrated from AlertDialog to ConfirmModal.
          The e.preventDefault() workaround for Radix auto-close is unnecessary here —
          ConfirmModal does not auto-close on confirm; deleteTarget controls closure. */}
      <ConfirmModal
        open={deleteTarget !== null}
        onOpenChange={(next) => { if (!next) cancelDelete(); }}
        title="Delete group?"
        description={
          deleteTarget
            ? `This deletes the group "${deleteTarget.name}" only. Pricebook items inside it will not be deleted.`
            : ""
        }
        emphasis={
          deleteMutation.isError
            ? ((deleteMutation.error as Error)?.message ?? "Could not delete the group. Please try again.")
            : undefined
        }
        confirmLabel={deleteMutation.isPending ? "Deleting…" : "Delete group"}
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={() => void confirmDelete()}
        testIdPrefix="pricebook-group-delete"
      />


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

interface PricebookItemCardProps {
  item: ProductOption;
  quantity: number;
  onIncrement: (itemId: string) => void;
  onDecrement: (itemId: string) => void;
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
