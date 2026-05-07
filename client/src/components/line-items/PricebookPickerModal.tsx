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
 * Pricebook fetch — single bulk read of the catalog. Server endpoint is
 * `/api/items` (canonical catalog list). `q` is sent so server-side
 * search still owns the dataset; typing also filters client-side via
 * `filterPricebookItems` for instant feedback.
 */
function usePricebookItems(searchText: string) {
  return useQuery<ProductOption[]>({
    queryKey: ["/api/items", "pricebook", searchText],
    queryFn: async () => {
      const trimmed = searchText.trim();
      const qs = trimmed
        ? `?q=${encodeURIComponent(trimmed)}&limit=200`
        : "?limit=200";
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

  const count = selectedCount(selections);
  const total = useMemo(
    () => selectedTotal(selections, serverItems),
    [selections, serverItems],
  );

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

  const handleSubmit = useCallback(() => {
    const drafts = selectionsToDrafts(selections, serverItems);
    if (drafts.length === 0) return;
    onSubmit(drafts);
    setSelections(new Map());
    onOpenChange(false);
  }, [selections, serverItems, onSubmit, onOpenChange]);

  const submitLabel = pricebookSubmitLabel(surface);
  const submitDisabled = count === 0;

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

      <div
        // 2026-05-07 sizing pass (default-height fix) — body owns the
        // scroll surface.
        //   • `flex-1` distributes leftover shell height into the body
        //     (now possible because the shell has an explicit `sm:h-…`).
        //   • `sm:min-h-[480px]` is a belt-and-suspenders floor: even
        //     if the shell's height calc gives an unexpected result
        //     (e.g. an embedded iframe with a quirky vh), the body
        //     still reserves room for ≈3 compact card rows on
        //     tablets+. Mobile (< sm) intentionally has no min so the
        //     modal stays content-sized.
        //   • `max-h-[min(620px,calc(100vh-220px))]` keeps the scroll
        //     surface inside the viewport when the catalog is large
        //     and the shell's allotted height happens to be tall.
        //     220px subtracts header (~96px), footer (~52px), and
        //     viewport breathing room (~72px).
        className="flex-1 sm:min-h-[480px] max-h-[min(620px,calc(100vh-220px))] overflow-y-auto px-4 py-3 bg-app-bg"
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
          // 2026-05-07 density polish: CSS grid with `auto-fill /
          // minmax(200px, 1fr)`. Yields ≈4 columns on a 1040px modal,
          // 2–3 columns on tablet widths, 1 column on mobile — without
          // hard breakpoint thresholds. Tailwind's arbitrary-grid
          // utility expands to the same `repeat(auto-fill, minmax(...))`
          // declaration; we use the inline style fallback here so the
          // contract is also visible to source-pin tests.
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
            {count === 0
              ? "No items selected"
              : `${count} item${count === 1 ? "" : "s"} · ${formatCurrency(total)}`}
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
