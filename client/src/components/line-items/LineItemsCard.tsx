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
import { Fragment, useState, type ReactNode } from "react";
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
import {
  CardShell,
  CardShellHeader,
  CardShellBody,
  CardShellFooter,
  CardMetricBlock,
} from "@/components/ui/card";
import { formatCurrency } from "@/lib/formatters";
import { LineItemRow } from "./LineItemRow";
import { AddLineItemForm } from "./AddLineItemForm";
import { PricebookPickerModal } from "./PricebookPickerModal";
import { LineItemEditModal } from "./LineItemEditModal";
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
import { blankDraft } from "@/lib/entities/lineItemMapper";
import type { LineItemDraft } from "@shared/lineItem";
import type { ProductOption } from "@/lib/entities/productEntity";
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
  /** Suppress the Revenue/Profit/Margin KPI strip in the card header.
   *  Job Detail passes true — those metrics already appear in the right-rail
   *  Financial Summary and would duplicate on the main column. */
  hideMetrics?: boolean;
  /**
   * Visual surface variant forwarded to the outer CardShell.
   * "contained" (default) — canonical card chrome.
   * "open" — minimal chrome: rounded-md bg-white border border-slate-100.
   * "workspace" — inert wrapper (no border, background, or rounding).
   * "inset" — bg-app-bg surface inside a white parent card (Financial Details).
   */
  surface?: "contained" | "open" | "workspace" | "inset";
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
  hideMetrics = false,
  surface,
}: LineItemsCardProps<TServerLine>) {
  // 2026-05-07: Pricebook bulk picker. One modal mount lives inside the
  // canonical shared card so all three line-item surfaces (invoice,
  // quote, job-parts) inherit it for free — no per-page wiring.
  const [pricebookOpen, setPricebookOpen] = useState(false);

  // 2026-05-07 Phase A — persisted interaction mode (no global edit).
  // Surface adapter declares `interactionMode`; default is "batched"
  // for backwards compat (CreateQuotePage / NewInvoicePage flows
  // depend on the legacy contract). When "persisted":
  //   • header has no pencil / Save / Cancel
  //   • rows render directly from serverItems with row-level actions
  //   • Add item + row Edit open the canonical <LineItemEditModal>
  //   • Delete fires <AlertDialog> → adapter.deleteLine
  //   • Drag-end fires adapter.reorderLines (when allowReorder)
  //   • Pricebook submit fires adapter.bulkAddLines
  const interactionMode: "persisted" | "batched" =
    adapter.interactionMode ?? "batched";
  const isPersisted = interactionMode === "persisted";

  // Persisted-mode UI state. Held here (not in the hook) because the
  // hook's drafts state machine intentionally stays untouched in this
  // mode — all mutations route through the adapter directly.
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [persistedSaving, setPersistedSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // In persisted mode, the legacy `editing` flag must read as `false`
  // unconditionally — there is no draft state machine. The drafts
  // hook is still called (for headerMetrics) but we never trigger
  // `enterEdit` so `drafts.editing` stays false anyway. Pin it here
  // so a future regression can't accidentally route persisted-mode
  // through the edit-only branches.
  const editing = !isPersisted && drafts.editing;
  const showCost = adapter.showCost;
  const sortedServer = [...serverItems].sort((a, b) =>
    (a.lineNumber ?? 0) - (b.lineNumber ?? 0),
  );

  const visibleEntries = drafts.drafts?.filter((e) => !e.isDeleted) ?? [];
  const headerCount =
    editing && drafts.drafts ? visibleEntries.length : serverItems.length;

  // ── DnD handler ───────────────────────────────────────────────────
  // Two paths:
  //   • persisted mode → fire adapter.reorderLines(orderedServerIds)
  //     immediately. Server is the source of truth; the next refetch
  //     will re-sort sortedServer by lineNumber.
  //   • batched mode → reorder local drafts; if at least one persisted
  //     row was moved AND the adapter allows reorder, notify the
  //     adapter so it can fire the canonical reorder mutation.
  const handleDragEnd = (event: DragEndEvent) => {
    if (isPersisted) {
      if (!adapter.allowReorder || !adapter.reorderLines) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = sortedServer.findIndex((l) => l.id === active.id);
      const newIndex = sortedServer.findIndex((l) => l.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      const reordered = arrayMove(sortedServer, oldIndex, newIndex);
      const orderedIds = reordered.map((l) => l.id);
      // Fire and forget — the caller's mutation hook owns toast/error.
      void adapter.reorderLines(orderedIds);
      return;
    }
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

  // ── Persisted-mode handlers ───────────────────────────────────────

  // Currently-edited row (if any). Resolved from `editingLineId` so
  // open-modal + serverItems refetch stay in lockstep.
  const editingLine = editingLineId
    ? serverItems.find((l) => l.id === editingLineId) ?? null
    : null;
  const editingDraftSeed: LineItemDraft | null = editingLine
    ? adapter.hydrateDraft(editingLine)
    : null;
  const editingProductSeed: ProductOption | null = editingLine
    ? adapter.resolveProduct?.(editingLine) ?? null
    : null;

  const handlePersistedAdd = async (draft: LineItemDraft) => {
    if (!adapter.addLine) {
      throw new Error("addLine not implemented for this surface");
    }
    setPersistedSaving(true);
    try {
      await adapter.addLine(draft);
    } finally {
      setPersistedSaving(false);
    }
  };

  const handlePersistedUpdate = async (draft: LineItemDraft) => {
    if (!editingLineId) return;
    if (!adapter.updateLine) {
      throw new Error("updateLine not implemented for this surface");
    }
    setPersistedSaving(true);
    try {
      await adapter.updateLine(editingLineId, draft);
    } finally {
      setPersistedSaving(false);
    }
  };

  const handlePersistedDelete = async () => {
    if (!pendingDeleteId || !adapter.deleteLine) {
      setPendingDeleteId(null);
      return;
    }
    setPersistedSaving(true);
    try {
      await adapter.deleteLine(pendingDeleteId);
      setPendingDeleteId(null);
    } finally {
      setPersistedSaving(false);
    }
  };

  // Bulk-add from Pricebook in persisted mode. Default fan-out is
  // N x addLine; surfaces can override via `bulkAddLines` for a
  // single endpoint. Errors propagate so the caller's mutation
  // hook can toast.
  const handlePersistedBulkAdd = async (drafts: LineItemDraft[]) => {
    if (drafts.length === 0) return;
    if (adapter.bulkAddLines) {
      await adapter.bulkAddLines(drafts);
      return;
    }
    if (!adapter.addLine) {
      throw new Error("Neither bulkAddLines nor addLine implemented");
    }
    // Sequential — keeps per-line server validation deterministic
    // (mirrors the order users picked in the Pricebook).
    for (const draft of drafts) {
      await adapter.addLine(draft);
    }
  };

  // ── Header metrics ────────────────────────────────────────────────
  // Render all three profitability tiles (Full Line Revenue / Profit /
  // Profit Margin) on every consuming surface — quote, invoice, job,
  // create surfaces, all share the same KPI strip. The single gate
  // is `revenue > 0`: when there are no lines at all, the cluster
  // hides entirely so the header isn't loud about a quote/invoice
  // that hasn't started.
  //
  // 2026-05-06: previously this gated Profit + Margin behind a
  // `m.cost !== null` check that hid them on surfaces (Quote / Invoice
  // without persisted cost) where margin visibility is required —
  // these are pricing surfaces, the whole point is margin. The hook
  // now always emits numeric cost (defaulting to 0) so the tiles
  // render unconditionally; if no line carries cost, the header
  // honestly reads 100% margin rather than silently disappearing.
  const m = drafts.headerMetrics;
  const showMetrics = m.revenue > 0;
  // Green for positive profit, rose for negative. Single derivation
  // shared by both Profit and Profit Margin so they cannot drift.
  const profitToneClass =
    m.profit >= 0 ? "text-emerald-700" : "text-rose-600";

  // ── Empty state guard ─────────────────────────────────────────────
  const isEmpty = !editing && serverItems.length === 0;

  return (
    // 2026-04-29 Color Phase 3: outer chrome on canonical
    // `border-card-border bg-card` + `shadow-card` tokens.
    // 2026-05-07 Tier 2: outer wrapper, header band, body region, and
    // bottom action row routed through CardShell / CardShellHeader /
    // CardShellBody / CardShellFooter primitives. The header keeps
    // `px-5 py-3` (overriding CardShellHeader's default `px-4 py-2.5`)
    // because — per the 2026-05-03 alignment fix near the top of this
    // file — the body table is also `px-5`, and the per-cell paddings
    // in LineItemRow / AddLineItemForm are calibrated against the
    // px-5 inset on BOTH the header and the body. Changing either
    // side without the other reintroduces header↔body column drift.
    <CardShell surface={surface} data-testid="card-invoice-line-items">
      {/* Header */}
      <CardShellHeader className="px-5 py-3">
        <h3 className={META_LABEL_CLASS}>
          {title}{" "}
          <span className="ml-1 font-medium normal-case tracking-normal text-slate-400">
            {headerCount}
          </span>
        </h3>
        <div className="flex items-center gap-4 min-w-0">
          {/* 2026-05-06 (canonical profitability header): three-metric
              cluster — Full Line Revenue / Profit / Profit Margin —
              rendered identically on every consuming surface (Quote
              Detail, Create Quote, Invoice Detail, New Invoice, Job
              Detail). Margin is the headline KPI and gets a slightly
              heavier value treatment; Profit + Margin use the
              canonical emerald token (rose for negative). The cluster
              wraps onto a second row below `sm` so it never pushes
              the edit pencil off-screen.
              Single gate: revenue > 0. When cost is absent on a
              surface (e.g., quote_lines has no unit_cost column),
              cost defaults to 0, profit equals revenue, margin reads
              100% — visibility preserved for the pricing-surface
              audit.
              2026-05-07 Tier 2: each tile renders through the
              canonical `<CardMetricBlock>` primitive (extracted
              verbatim from the previous local `HeaderMetricBlock`).
              Tone (`valueClassName`) and emphasis flag stay caller-
              owned — CardMetricBlock has no business-math hooks. */}
          {showMetrics && !hideMetrics && (
            <div
              className="flex flex-wrap items-start gap-x-5 gap-y-1 min-w-0"
              data-testid="text-line-items-metrics"
            >
              <CardMetricBlock
                label="Full Line Revenue"
                value={formatCurrency(m.revenue)}
                data-testid="metric-full-line-revenue"
              />
              <CardMetricBlock
                label="Profit"
                value={formatCurrency(m.profit)}
                valueClassName={profitToneClass}
                data-testid="metric-profit"
              />
              <CardMetricBlock
                label="Profit Margin"
                value={`${m.margin.toFixed(2)}%`}
                valueClassName={profitToneClass}
                emphasis
                data-testid="metric-profit-margin"
              />
            </div>
          )}
          {/* 2026-05-07 Phase A — pencil + Save/Cancel are batched-mode
              only. Persisted-mode surfaces (invoice / quote / job
              detail) fire row-level mutations via the modal; no global
              edit gate. */}
          {!isPersisted && !isLocked && !editing && !hidePencilButton && (
            <Button
              size="icon"
              variant="ghost"
              className="flex-shrink-0"
              onClick={drafts.enterEdit}
              aria-label="Edit line items"
              data-testid="button-toggle-edit-lines"
            >
              <Pencil className="h-4 w-4 text-slate-400" />
            </Button>
          )}
          {!isPersisted && !isLocked && editing && (
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
      </CardShellHeader>

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

        2026-05-07 Tier 2: wrapped in `<CardShellBody>` (full-bleed,
        no `padded` prop) so the body region is marked as the canonical
        card body without altering the px-5 alignment inset that the
        column spec depends on.
      */}
      <CardShellBody className="overflow-x-auto">
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
                  className="grid border-b border-slate-100 bg-transparent px-5 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500"
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
                        className="py-5 text-center text-xs text-slate-500"
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
                        className="py-6 text-center text-xs text-slate-500"
                      >
                        {isLocked || hideEmptyStateCta ? (
                          <span>{adapter.emptyStateLabel}</span>
                        ) : (
                          <div className="flex flex-col items-center gap-3">
                            <p className="m-0 text-xs text-slate-500">
                              {adapter.emptyStateLabel}
                            </p>
                            <div className="flex items-center gap-2">
                              {/* 2026-05-07 Phase A: persisted mode opens
                                  the canonical <LineItemEditModal> in
                                  add mode; batched mode preserves the
                                  legacy enterEdit + appendNew flow. */}
                              <Button
                                size="default"
                                className="gap-1.5 text-sm"
                                onClick={() => {
                                  if (isPersisted) {
                                    setAddModalOpen(true);
                                  } else {
                                    drafts.enterEdit();
                                    drafts.appendNew();
                                  }
                                }}
                                data-testid="button-empty-add-line"
                              >
                                <Plus className="h-4 w-4" />
                                {adapter.emptyStateCtaLabel}
                              </Button>
                              {/* Pricebook bulk picker entry point in
                                  the empty state. Persisted mode skips
                                  enterEdit because there's no draft
                                  state; submit fans drafts out via
                                  adapter.bulkAddLines. */}
                              <Button
                                size="default"
                                variant="outline"
                                className="gap-1.5 text-sm"
                                onClick={() => {
                                  if (!isPersisted && !drafts.editing) drafts.enterEdit();
                                  setPricebookOpen(true);
                                }}
                                data-testid="button-empty-pricebook"
                              >
                                Pricebook
                              </Button>
                            </div>
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
                          // Persisted mode: row exposes drag handle (if
                          // the surface supports reorder) + edit/delete
                          // buttons that drive modal/AlertDialog flows.
                          // Batched display rows (legacy) remain
                          // action-less.
                          showDragHandle={isPersisted && adapter.allowReorder}
                          onEditClick={
                            isPersisted ? () => setEditingLineId(line.id) : undefined
                          }
                          onDelete={
                            isPersisted ? () => setPendingDeleteId(line.id) : undefined
                          }
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
      </CardShellBody>

      {/* Bottom action row (edit only).
          2026-05-07 Tier 2: routed through CardShellFooter. The
          primitive's defaults (`flex items-center justify-end gap-2
          px-4 py-2.5 border-t border-card-border`) are overridden via
          className for `justify-between` (Add-another-line on the
          left + Save/Cancel on the right) and `px-5 py-3` (matches
          the header band's column-aligned inset). The Save/Cancel
          split (top-right of the header AND bottom-right of the
          footer) is intentionally NOT consolidated into a generic
          ActionFooter — the dual placement is workflow-specific. */}
      {/* 2026-05-07 Phase A — persisted-mode footer is the always-on
          add row. Renders only when the card is NOT empty (the
          empty-state CTA owns the first-add affordance) and the
          surface is unlocked. Add item opens the canonical add modal;
          Pricebook opens the bulk picker. No Save/Cancel — every row
          mutation persists immediately through the adapter. */}
      {isPersisted && !isLocked && sortedServer.length > 0 && (
        <CardShellFooter className="justify-start bg-card px-5 py-3 gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => setAddModalOpen(true)}
            disabled={persistedSaving}
            data-testid="button-add-line-item"
          >
            <Plus className="h-3 w-3 mr-1" />
            Add item
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => setPricebookOpen(true)}
            disabled={persistedSaving}
            data-testid="button-pricebook"
          >
            Pricebook
          </Button>
        </CardShellFooter>
      )}
      {editing && !isLocked && (
        <CardShellFooter className="justify-between bg-card px-5 py-3">
          <div className="flex items-center gap-1">
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
            {/* 2026-05-07: Pricebook bulk picker entry point in the
                edit-mode footer. Sits beside the manual add so the two
                paths are visually peer-level. Existing manual add is
                untouched. */}
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => setPricebookOpen(true)}
              disabled={drafts.saving}
              data-testid="button-pricebook"
            >
              Pricebook
            </Button>
          </div>
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
        </CardShellFooter>
      )}

      {/* Surface-specific totals slot (discount editor + tax + totals
          for invoice; subtotal/tax/total for quote; profit metric strip
          for job parts). Rendered inside the card border, below the
          body/action-row. */}
      {renderTotalsFooter}

      {/* 2026-05-07: canonical Pricebook bulk picker. One mount per
          card. In batched mode the submit appends drafts through the
          edit-mode pipeline (enterEdit + appendMany). In persisted
          mode it fans drafts out via `adapter.bulkAddLines` — each
          becomes its own line server-side, no batched Save needed. */}
      <PricebookPickerModal
        open={pricebookOpen}
        onOpenChange={setPricebookOpen}
        surface={adapter.surface}
        onSubmit={(entries) => {
          if (isPersisted) {
            void handlePersistedBulkAdd(entries.map((e) => e.draft));
            return;
          }
          if (!drafts.editing) drafts.enterEdit();
          drafts.appendMany(entries);
        }}
      />

      {/* 2026-05-07 Phase A — canonical add/edit modal. Mounted once
          per card; opens in add mode when `addModalOpen` is true and
          in edit mode when `editingLine` is non-null. Submit fires
          adapter.addLine / updateLine; closing without submit is a
          no-op (cancel). Persisted mode only — batched-mode flows
          continue to use the inline edit-cells pipeline. */}
      {isPersisted && (
        <>
          <LineItemEditModal
            open={addModalOpen}
            onOpenChange={(o) => {
              setAddModalOpen(o);
            }}
            surface={adapter.surface}
            mode="add"
            initialDraft={blankDraft()}
            initialProduct={null}
            showCost={showCost}
            onSave={handlePersistedAdd}
            onRequestCreateProduct={adapter.requestCreateProduct}
          />
          {editingDraftSeed && (
            <LineItemEditModal
              open={!!editingLineId}
              onOpenChange={(o) => {
                if (!o) setEditingLineId(null);
              }}
              surface={adapter.surface}
              mode="edit"
              initialDraft={editingDraftSeed}
              initialProduct={editingProductSeed}
              showCost={showCost}
              onSave={handlePersistedUpdate}
              onRequestCreateProduct={adapter.requestCreateProduct}
            />
          )}
          {/* AlertDialog for delete confirmation — modal taxonomy
              rule #1 (destructive confirm → AlertDialog). One mount;
              `pendingDeleteId` drives open. */}
          <AlertDialog
            open={!!pendingDeleteId}
            onOpenChange={(o) => {
              if (!o) setPendingDeleteId(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete line item?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove the line from this {adapter.surface === "invoice"
                    ? "invoice"
                    : adapter.surface === "quote" || adapter.surface === "quote-template"
                      ? "quote"
                      : "job"}. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel
                  disabled={persistedSaving}
                  data-testid="button-delete-line-cancel"
                >
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    void handlePersistedDelete();
                  }}
                  disabled={persistedSaving}
                  data-testid="button-delete-line-confirm"
                  className="bg-rose-600 text-white hover:bg-rose-700 focus:ring-rose-600"
                >
                  {persistedSaving ? "Deleting…" : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </CardShell>
  );
}
