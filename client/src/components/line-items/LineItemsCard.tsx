/**
 * LineItemsCard — canonical card shell for line-items surfaces.
 *
 * Standardizes:
 *   • Card chrome (rounded border, header / column-header / body / footer)
 *   • Header strip: title + count + revenue/cost/profit/margin metrics
 *     + edit pencil OR Save/Cancel pair
 *   • Column header row (drag / Description / Qty / Rate / [Cost] / Amount / trash)
 *   • Body: routes to <LineItemRow> for persisted entries, <AddLineItemForm>
 *     for new (serverId === null) entries
 *   • Empty-state CTA — primary button centered
 *   • Bottom action row (in edit only): "+ Add another line item" left,
 *     Cancel / Save right
 *   • Surface-specific tax/discount/totals via `renderTotalsFooter` slot
 *
 * Wires DnD-kit context for reorder. Adapter decides whether reorder
 * fires immediately (Invoice) or batches into Save (Job Parts) via the
 * `onReorder` callback.
 *
 * 2026-04-29 (Phase 1) — extracted from InvoiceDetailPage's line-items
 * card JSX.
 */
import { Fragment, type ReactNode } from "react";
import {
  DndContext,
  type DragEndEvent,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import { Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/formatters";
import { LineItemRow } from "./LineItemRow";
import { AddLineItemForm } from "./AddLineItemForm";
import type { HeaderMetrics, LineItemsAdapter } from "./types";
import type { LineItemsDraftsAPI } from "./useLineItemsDrafts";

const META_LABEL_CLASS = "text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500";

/**
 * 2026-05-03 alignment fix — single source of truth for line-item
 * column widths. Used by BOTH the header (CSS Grid `gridTemplateColumns`)
 * AND the body (HTML `<table>` `<colgroup>`). Previously the header
 * declared widths via `grid-cols-[...]` while the body relied on per-`<td>`
 * `w-*` classes inside a `min-w-full` table without `table-layout: fixed`,
 * which let the browser's auto-table algorithm reflow body columns based
 * on content width while the header stayed rigid — causing visible
 * header↔body drift, especially when the description column's content
 * shrank or grew.
 *
 * The two surface variants:
 *   - `WITH_COST` — Job Parts (Job Detail) shows a Cost column.
 *   - `NO_COST`   — Invoice / Quote / NewInvoice surfaces.
 *
 * Width syntax `1fr` is the CSS Grid token used in
 * `grid-template-columns`. For `<col>` it is translated to `auto` by
 * `colWidth(...)` because grid units don't apply inside an HTML table;
 * with `table-layout: fixed`, the lone auto column receives the
 * leftover space — semantically equivalent to grid's `1fr`.
 */
type LineItemColumnSpec = { key: string; width: string };

const LINE_ITEM_COLUMNS_WITH_COST: readonly LineItemColumnSpec[] = [
  { key: "drag",        width: "32px"  },
  { key: "description", width: "1fr"   },
  { key: "qty",         width: "96px"  },
  { key: "cost",        width: "110px" },
  { key: "rate",        width: "128px" },
  { key: "amount",      width: "110px" },
  { key: "trash",       width: "36px"  },
];

const LINE_ITEM_COLUMNS_NO_COST: readonly LineItemColumnSpec[] = [
  { key: "drag",        width: "32px"  },
  { key: "description", width: "1fr"   },
  { key: "qty",         width: "96px"  },
  { key: "rate",        width: "128px" },
  { key: "amount",      width: "110px" },
  { key: "trash",       width: "36px"  },
];

/** Build the `gridTemplateColumns` string for the header CSS-grid row. */
function gridTemplate(cols: readonly LineItemColumnSpec[]): string {
  return cols.map((c) => c.width).join(" ");
}

/** Translate a column spec width into a value valid inside `<col>`.
 *  `1fr` is a grid-only unit; `auto` is its table equivalent under
 *  `table-layout: fixed`. */
function colWidth(width: string): string {
  return width === "1fr" ? "auto" : width;
}

interface DisplayLine {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  unitCost?: string | null;
  lineSubtotal: string;
  lineTotal: string;
  date?: string | null;
  lineNumber?: number;
}

export interface LineItemsCardProps<TServerLine extends DisplayLine> {
  adapter: LineItemsAdapter<TServerLine>;
  drafts: LineItemsDraftsAPI;
  /** Persisted server rows used in the display branch (when not editing). */
  serverItems: TServerLine[];
  /** Override the card's pencil/Save state (e.g. status-locked invoices). */
  isLocked?: boolean;
  /** Surface-specific footer rendered inside the card border, below the
   *  body. Invoice fills it with the discount editor + subtotal/tax/
   *  total/balance block. Quote: subtotal/tax/total. Job Parts: total
   *  price/cost/profit. */
  renderTotalsFooter?: ReactNode;
  /** Optional title override. Default "Line items". */
  title?: string;
  /** 2026-04-29 (Phase 3): Suppress the in-card pencil button so a
   *  parent-driven edit lifecycle (Job Parts uses an external Edit
   *  button on the JobDetail section header) is the only entry point.
   *  Save / Cancel inside the card still render normally when editing. */
  hidePencilButton?: boolean;
  /** Suppress the empty-state primary CTA so users can only enter edit
   *  mode via the parent's external trigger. The empty-state caption
   *  still renders. */
  hideEmptyStateCta?: boolean;
}

export function LineItemsCard<TServerLine extends DisplayLine>({
  adapter,
  drafts,
  serverItems,
  isLocked = false,
  renderTotalsFooter,
  title = "Line items",
  hidePencilButton = false,
  hideEmptyStateCta = false,
}: LineItemsCardProps<TServerLine>) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const editing = drafts.editing;
  const showCost = adapter.showCost;
  const sortedServer = [...serverItems].sort((a, b) =>
    (a.lineNumber ?? 0) - (b.lineNumber ?? 0),
  );

  const visibleEntries = drafts.drafts?.filter((e) => !e.isDeleted) ?? [];
  const headerCount =
    editing && drafts.drafts ? visibleEntries.length : serverItems.length;

  // ── DnD handler ───────────────────────────────────────────────────
  // In edit mode: reorder local drafts; if at least one persisted row
  // was moved AND the adapter allows reorder, notify the adapter so it
  // can fire the canonical reorder mutation.
  const handleDragEnd = (event: DragEndEvent) => {
    if (!editing || !drafts.drafts) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const list = drafts.drafts;
    const oldIndex = list.findIndex((e) => e.clientKey === active.id);
    const newIndex = list.findIndex((e) => e.clientKey === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    drafts.reorderLocal(oldIndex, newIndex);

    if (adapter.allowReorder && adapter.onReorder) {
      const reordered = arrayMove(list, oldIndex, newIndex);
      const persistedIds = reordered
        .filter((e) => !e.isDeleted && e.serverId)
        .map((e) => e.serverId!) as string[];
      if (persistedIds.length > 0) adapter.onReorder(persistedIds);
    }
  };

  // ── Header metrics ────────────────────────────────────────────────
  // Always render Revenue when there are lines. Profit + margin only
  // when at least one line carries cost — avoids the "NaN%" surface
  // from the prior invoice fix.
  const m = drafts.headerMetrics;
  const showRevenue = m.revenue > 0;
  const showProfit = m.cost !== null && m.profit !== null && m.margin !== null;

  // ── Empty state guard ─────────────────────────────────────────────
  const isEmpty = !editing && serverItems.length === 0;

  return (
    // 2026-04-29 Color Phase 3: hardcoded `border-stone-200 bg-white`
    // chrome migrated to canonical `border-card-border bg-card` plus
    // `shadow-card` for the lifted-from-page elevation. Inner dividers
    // and the column header strip follow the same migration below.
    <div
      className="overflow-hidden rounded-lg border border-card-border bg-card shadow-card"
      data-testid="card-invoice-line-items"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-card-border px-5 py-3">
        <h3 className={META_LABEL_CLASS}>
          {title}{" "}
          <span className="ml-1 font-medium normal-case tracking-normal text-slate-400">
            {headerCount}
          </span>
        </h3>
        <div className="flex items-center gap-3">
          {showRevenue && (
            <span className="text-xs text-slate-500" data-testid="text-line-items-metrics">
              Rev{" "}
              <span className="font-semibold text-slate-700">{formatCurrency(m.revenue)}</span>
              {showProfit && (
                <>
                  {" · "}Profit{" "}
                  <span
                    className={`font-semibold ${(m.profit ?? 0) >= 0 ? "text-emerald-700" : "text-rose-600"}`}
                  >
                    {formatCurrency(m.profit ?? 0)} ({(m.margin ?? 0).toFixed(0)}%)
                  </span>
                </>
              )}
            </span>
          )}
          {!isLocked && !editing && !hidePencilButton && (
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 flex-shrink-0"
              onClick={drafts.enterEdit}
              aria-label="Edit line items"
              data-testid="button-toggle-edit-lines"
            >
              <Pencil className="h-4 w-4 text-slate-400" />
            </Button>
          )}
          {!isLocked && editing && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={drafts.cancel}
                disabled={drafts.saving}
                data-testid="button-cancel-lines-top"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => void drafts.save()}
                disabled={drafts.saving}
                data-testid="button-save-lines-top"
              >
                {drafts.saving ? "Saving..." : "Save"}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/*
        Header + body share one horizontal-scroll container so their
        columns line up at any viewport width. The inner `min-w-...`
        prevents the description `1fr` column from collapsing on narrow
        viewports — without it, fixed-width numeric columns would
        squeeze the description to zero width and overlap.

        Per-cell paddings on each grid header span mirror the
        corresponding `<td>` paddings in `LineItemRow` /
        `AddLineItemForm` (drag: pr-2, desc: pr-3, qty/rate/cost:
        px-3 + text-right, amount: pl-3 pr-1 + text-right, trash:
        pl-1 pr-2). Combined with the `px-5` parent inset on both the
        header and the body table wrapper, every column's content edge
        sits at the same horizontal coordinate in both rows. The
        previous `gap-2` on the grid was dropped because cell-internal
        paddings now provide all column spacing — running both systems
        would re-introduce the alignment drift this fix removes.
      */}
      <div className="overflow-x-auto">
        <div className={showCost ? "min-w-[720px]" : "min-w-[640px]"}>
          {(() => {
            // 2026-05-03 alignment fix: header grid-template-columns
            // and body <colgroup> derive from the SAME column spec so
            // the column edges line up at every viewport width. See
            // LINE_ITEM_COLUMNS_WITH_COST / _NO_COST near the top of
            // this file for the canonical width values.
            const columns = showCost ? LINE_ITEM_COLUMNS_WITH_COST : LINE_ITEM_COLUMNS_NO_COST;
            return (
              <>
                {/* Column header row */}
                <div
                  className="grid border-b border-card-border bg-surface-subtle px-5 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500"
                  style={{ gridTemplateColumns: gridTemplate(columns) }}
                >
                  <span className="pr-2" />
                  <span className="pr-3">Description</span>
                  <span className="px-3 text-right">Qty</span>
                  {showCost && <span className="px-3 text-right">Cost</span>}
                  <span className="px-3 text-right">Rate</span>
                  <span className="pl-3 pr-1 text-right">Amount</span>
                  <span className="pl-1 pr-2" />
                </div>

                {/* Body */}
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <div className="px-5">
                    <table className="w-full table-fixed text-xs">
                      {/* 2026-05-03 alignment fix: explicit <colgroup>
                          + `table-fixed` on the table forces column
                          widths to honor the spec exactly, instead of
                          letting the browser's auto-table algorithm
                          flex them based on content. The widths come
                          from the same `columns` array the header
                          uses, so header and body line up at any
                          viewport width. Per-`<td>` `w-*` classes in
                          LineItemRow / AddLineItemForm are now
                          redundant but harmless (kept for now to
                          minimise diff scope). */}
                      <colgroup>
                        {columns.map((c) => (
                          <col key={c.key} style={{ width: colWidth(c.width) }} />
                        ))}
                      </colgroup>
                {editing && drafts.drafts ? (
              <SortableContext
                items={visibleEntries.map((e) => e.clientKey)}
                strategy={verticalListSortingStrategy}
              >
                <tbody>
                  {visibleEntries.length === 0 && (
                    <tr>
                      <td
                        colSpan={showCost ? 7 : 6}
                        className="py-8 text-center text-xs text-slate-500"
                      >
                        No line items. Use "+ Add another line item" below to add one.
                      </td>
                    </tr>
                  )}
                  {visibleEntries.map((entry) => {
                    if (!entry.serverId) {
                      return (
                        <AddLineItemForm
                          key={entry.clientKey}
                          clientKey={entry.clientKey}
                          draft={entry.draft}
                          selectedProduct={entry.uiSelectedProduct ?? null}
                          showDescription={entry.uiShowDescription ?? false}
                          showCost={showCost}
                          onChangeDraft={(patch) => drafts.updateDraft(entry.clientKey, patch)}
                          onSelectProduct={(p) => drafts.selectProduct(entry.clientKey, p)}
                          onChangeShowDescription={(v) => drafts.setShowDescription(entry.clientKey, v)}
                          onDelete={() => drafts.removeNewDraft(entry.clientKey)}
                          onRequestCreateProduct={adapter.requestCreateProduct}
                        />
                      );
                    }
                    const serverLine = sortedServer.find((l) => l.id === entry.serverId) ?? null;
                    return (
                      <LineItemRow
                        key={entry.clientKey}
                        clientKey={entry.clientKey}
                        displayLine={serverLine}
                        isEditing={true}
                        editDraft={entry.draft}
                        selectedProduct={entry.uiSelectedProduct ?? null}
                        showDescription={entry.uiShowDescription ?? false}
                        showCost={showCost}
                        showDragHandle={adapter.allowReorder}
                        onChangeDraft={(patch) => drafts.updateDraft(entry.clientKey, patch)}
                        onSelectProduct={(p) => drafts.selectProduct(entry.clientKey, p)}
                        onChangeShowDescription={(v) => drafts.setShowDescription(entry.clientKey, v)}
                        onDelete={() => drafts.markDeleted(entry.clientKey)}
                        onRequestCreateProduct={adapter.requestCreateProduct}
                      />
                    );
                  })}
                </tbody>
              </SortableContext>
            ) : (
              <SortableContext
                items={sortedServer.map((l) => l.id)}
                strategy={verticalListSortingStrategy}
              >
                <tbody>
                  {isEmpty && (
                    <tr>
                      <td
                        colSpan={showCost ? 7 : 6}
                        className="py-12 text-center text-xs text-slate-500"
                      >
                        {isLocked || hideEmptyStateCta ? (
                          <span>{adapter.emptyStateLabel}</span>
                        ) : (
                          <div className="flex flex-col items-center gap-3">
                            <p className="m-0 text-xs text-slate-500">
                              {adapter.emptyStateLabel}
                            </p>
                            <Button
                              size="default"
                              className="h-9 gap-1.5 text-sm"
                              onClick={() => {
                                drafts.enterEdit();
                                drafts.appendNew();
                              }}
                              data-testid="button-empty-add-line"
                            >
                              <Plus className="h-4 w-4" />
                              {adapter.emptyStateCtaLabel}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  {sortedServer.length > 0 &&
                    sortedServer.map((line) => (
                      <Fragment key={line.id}>
                        <LineItemRow
                          clientKey={line.id}
                          displayLine={line}
                          isEditing={false}
                          showCost={showCost}
                        />
                      </Fragment>
                    ))}
                </tbody>
              </SortableContext>
            )}
              </table>
            </div>
          </DndContext>
              </>
            );
          })()}
        </div>
      </div>

      {/* Bottom action row (edit only) */}
      {editing && !isLocked && (
        <div className="flex items-center justify-between border-t border-card-border bg-card px-5 py-3">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => drafts.appendNew()}
            disabled={drafts.saving}
            data-testid="button-add-another-line-item"
          >
            <Plus className="h-3 w-3 mr-1" />
            Add another line item
          </Button>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={drafts.cancel}
              disabled={drafts.saving}
              data-testid="button-cancel-lines-bottom"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={() => void drafts.save()}
              disabled={drafts.saving}
              data-testid="button-save-lines-bottom"
            >
              {drafts.saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      )}

      {/* Surface-specific totals slot (discount editor + tax + totals
          for invoice; subtotal/tax/total for quote; profit metric strip
          for job parts). Rendered inside the card border, below the
          body/action-row. */}
      {renderTotalsFooter}
    </div>
  );
}
