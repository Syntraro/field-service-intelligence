/**
 * PricebookPickerModal — canonical bulk-select catalog picker.
 *
 * Domain wrapper (modal taxonomy rule #4). Internally mounts the
 * canonical `<ModalShell>` + `<ModalHeader>` / `<ModalFooter>` per the
 * primitives in `client/src/components/ui/modal.tsx`. Owns its own
 * width — `ModalShell` stays width-neutral.
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
import { ModalStateBody } from "@/components/ui/modal";

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
  decrementSelection,
  filterPricebookItems,
  incrementSelection,
  pricebookSubmitLabel,
  selectedCount,
  selectedTotal,
  selectionsToDrafts,
  type PricebookSelections,
} from "./pricebookHelpers";

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
 * Pricebook fetch — single bulk read of the catalog.
 *
 *   • Empty search  → `?sort=most_used&limit=200`. The route ranks
 *     items by historical usage count across invoice_lines,
 *     quote_lines, and job_parts (tenant-scoped).
 *   • Non-empty search → `?q=…&limit=200`. Server applies case-
 *     insensitive ILIKE search across name / sku / description.
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

  // Selection survives search filter changes (per brief). Cleared only
  // on close — re-opening yields a fresh canvas.
  useEffect(() => {
    if (!open) {
      setSelections(new Map());
      setSearch("");
    }
  }, [open]);

  const { data: serverItems = [], isLoading, isError, refetch } =
    usePricebookItems(search);

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

  // Stable per-item callbacks. Passing these to the memoized card
  // means clicking + on one card does NOT re-render the others.
  const onIncrement = useCallback((itemId: string) => {
    setSelections((prev) => incrementSelection(prev, itemId));
  }, []);
  const onDecrement = useCallback((itemId: string) => {
    setSelections((prev) => decrementSelection(prev, itemId));
  }, []);

  const handleSubmit = useCallback(() => {
    const entries = selectionsToDrafts(selections, serverItems);
    if (entries.length === 0) return;
    onSubmit(entries);
    setSelections(new Map());
    onOpenChange(false);
  }, [selections, serverItems, onSubmit, onOpenChange]);

  const submitLabel = pricebookSubmitLabel(surface);
  const submitDisabled = itemCount === 0;

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className="w-[min(1040px,calc(100vw-32px))] max-w-[1040px] sm:max-w-[1040px] sm:h-[min(720px,calc(100vh-80px))] flex flex-col"
      data-testid="pricebook-picker-modal"
    >
      <ModalHeader className="space-y-2">
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

      <div
        className="flex-1 sm:min-h-[480px] max-h-[min(620px,calc(100vh-220px))] overflow-y-auto px-4 py-3 bg-app-bg min-h-0"
        data-testid="pricebook-body"
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
              : `${itemCount} item${itemCount === 1 ? "" : "s"} · Estimated total ${formatCurrency(itemTotal)}`}
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
          drops the selection automatically via `decrementSelection`.
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
