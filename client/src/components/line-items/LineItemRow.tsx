/**
 * LineItemRow — canonical row for line-items surfaces.
 *
 * Renders one of three states:
 *   1. Display row (read-only, when isEditing=false). Shows the
 *      persisted values from the row's underlying server line.
 *   2. Edit row for an EXISTING line (serverId !== null). Shows the
 *      product chip + Change button, qty / rate / amount / trash, and
 *      a progressively-disclosed description override textarea.
 *   3. Edit row for a NEW draft line (serverId === null) — handled by
 *      <AddLineItemForm>, NOT this component. Parent dispatches between
 *      the two.
 *
 * Adopts the canonical CreateOrSelectField for product selection. The
 * carry-over rule on Change → Pick lives in `useLineItemsDrafts`; this
 * component just bubbles the selection event up.
 *
 * 2026-04-29 (Phase 1) — extracted from InvoiceDetailPage's
 * SortableLineRow + SortableLineRowEditCells.
 */
import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { format } from "date-fns";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CreateOrSelectField } from "@/components/shared/CreateOrSelectField";
import {
  useProductSearch,
  getProductKey,
  getProductLabel,
  getProductDescription,
  type ProductOption,
} from "@/lib/entities/productEntity";
import { type LineItemDraft, parseMoney } from "@shared/lineItem";
import { formatCurrency } from "@/lib/formatters";

interface DisplayLine {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  unitCost?: string | null;
  lineSubtotal: string;
  lineTotal: string;
  date?: string | null;
}

export interface LineItemRowProps {
  /** dnd-kit / React key. For existing rows this equals the server id. */
  clientKey: string;
  /** Persisted row used for the read-only display branch. Required when
   *  `isEditing` is false. */
  displayLine: DisplayLine | null;
  /** When true, the row renders the controlled edit form (existing-row
   *  variant). When false, the read-only display row renders. */
  isEditing: boolean;
  /** Live editable draft. Required when `isEditing` is true. */
  editDraft?: LineItemDraft;
  /** Currently bound product. Drives the chip vs. search-field state. */
  selectedProduct?: ProductOption | null;
  /** Whether the description override textarea is revealed. */
  showDescription?: boolean;
  /** Column visibility. */
  showCost?: boolean;
  showDragHandle?: boolean;
  /** Callbacks bubbled up to the hook. */
  onChangeDraft?: (patch: Partial<LineItemDraft>) => void;
  onSelectProduct?: (product: ProductOption | null) => void;
  onChangeShowDescription?: (next: boolean) => void;
  onDelete?: () => void;
  /** Optional: opens the canonical Add Product modal. */
  onRequestCreateProduct?: (name: string) => Promise<ProductOption | null>;
}

export function LineItemRow({
  clientKey,
  displayLine,
  isEditing,
  editDraft,
  selectedProduct,
  showDescription,
  showCost = false,
  showDragHandle = true,
  onChangeDraft,
  onSelectProduct,
  onChangeShowDescription,
  onDelete,
  onRequestCreateProduct,
}: LineItemRowProps) {
  const sortable = useSortable({ id: clientKey });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
  };

  // ── Edit branch (existing row) ────────────────────────────────────
  if (isEditing && editDraft && onChangeDraft) {
    return (
      <EditCells
        clientKey={clientKey}
        sortable={sortable}
        style={style}
        draft={editDraft}
        selectedProduct={selectedProduct ?? null}
        showDescription={showDescription ?? false}
        showCost={showCost}
        showDragHandle={showDragHandle}
        onChangeDraft={onChangeDraft}
        onSelectProduct={onSelectProduct}
        onChangeShowDescription={onChangeShowDescription}
        onDelete={onDelete}
        onRequestCreateProduct={onRequestCreateProduct}
      />
    );
  }

  // ── Display branch (read-only) ────────────────────────────────────
  if (!displayLine) return null;
  return (
    <tr
      ref={sortable.setNodeRef}
      style={style}
      data-testid={`row-line-item-${displayLine.id}`}
      className={`border-b border-border/50 hover:bg-muted/50 ${sortable.isDragging ? "bg-muted" : ""}`}
    >
      <td className="py-2.5 pr-2 align-top w-8" />
      <td className="py-2.5 pr-3 align-top">
        <div className="flex items-center gap-2">
          <div className="text-xs font-medium">{displayLine.description}</div>
        </div>
        {displayLine.date && (
          <div className="mt-0.5 text-xs font-normal text-muted-foreground whitespace-pre-line">
            {format(new Date(displayLine.date), "MMM d, yyyy")}
          </div>
        )}
      </td>
      <td className="py-2.5 px-3 text-right align-top text-xs w-24">{displayLine.quantity}</td>
      {/* 2026-05-01: Cost moved BEFORE Rate (job surfaces only). */}
      {showCost && (
        <td className="py-2.5 px-3 text-right align-top text-xs w-[110px]">
          {displayLine.unitCost ? formatCurrency(displayLine.unitCost) : "—"}
        </td>
      )}
      <td className="py-2.5 px-3 text-right align-top text-xs w-32">{formatCurrency(displayLine.unitPrice)}</td>
      <td className="py-2.5 pl-3 pr-1 text-right align-top text-xs font-semibold w-[110px]">
        {formatCurrency(displayLine.lineSubtotal)}
      </td>
      <td className="py-2.5 pl-1 pr-2 align-top w-9" />
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────
// EditCells — internal sub-component for the existing-row edit form.
// Kept inside the same file because it shares the same row dnd-kit
// context and the same column geometry.
// ─────────────────────────────────────────────────────────────────────

interface EditCellsProps {
  clientKey: string;
  sortable: ReturnType<typeof useSortable>;
  style: React.CSSProperties;
  draft: LineItemDraft;
  selectedProduct: ProductOption | null;
  showDescription: boolean;
  showCost: boolean;
  showDragHandle: boolean;
  onChangeDraft: (patch: Partial<LineItemDraft>) => void;
  onSelectProduct?: (product: ProductOption | null) => void;
  onChangeShowDescription?: (next: boolean) => void;
  onDelete?: () => void;
  onRequestCreateProduct?: (name: string) => Promise<ProductOption | null>;
}

function EditCells({
  clientKey,
  sortable,
  style,
  draft,
  selectedProduct,
  showDescription,
  showCost,
  showDragHandle,
  onChangeDraft,
  onSelectProduct,
  onChangeShowDescription,
  onDelete,
  onRequestCreateProduct,
}: EditCellsProps) {
  const [productSearch, setProductSearch] = useState("");
  const { data: searchResults = [], isLoading: searchLoading } = useProductSearch(productSearch);

  const setDraft = (patch: Partial<LineItemDraft>) => onChangeDraft(patch);
  const lineTotal = formatCurrency(parseMoney(draft.quantity) * parseMoney(draft.unitPrice));

  const handleCreateNew = async (text: string) => {
    if (!onRequestCreateProduct || !onSelectProduct) return;
    const created = await onRequestCreateProduct(text.trim());
    if (created) onSelectProduct(created);
    setProductSearch("");
  };

  return (
    <tr
      ref={sortable.setNodeRef}
      style={style}
      className="border-b border-border/50 bg-primary/5"
      data-testid={`row-line-item-edit-${clientKey}`}
    >
      <td className="py-2.5 pr-2 align-top w-8">
        {showDragHandle && (
          <div
            className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
            {...sortable.attributes}
            {...sortable.listeners}
            data-testid={`drag-handle-${clientKey}`}
          >
            <GripVertical className="h-4 w-4" />
          </div>
        )}
      </td>
      <td className="py-2.5 pr-3 align-top">
        <CreateOrSelectField<ProductOption>
          label=""
          compact
          value={selectedProduct}
          onChange={(p) => onSelectProduct?.(p)}
          searchResults={searchResults}
          searchLoading={searchLoading}
          searchText={productSearch}
          onSearchTextChange={setProductSearch}
          getKey={getProductKey}
          getLabel={getProductLabel}
          getDescription={getProductDescription}
          createLabel={onRequestCreateProduct && productSearch.trim() ? `Create "${productSearch.trim()}"` : undefined}
          onCreateNew={onRequestCreateProduct && productSearch.trim() ? handleCreateNew : undefined}
          renderSelected={(product, onClear) => (
            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-md">
              <span className="text-sm font-medium text-slate-800 truncate">{product.name}</span>
              <Button variant="ghost" size="sm" className="h-6 text-xs shrink-0" onClick={onClear}>
                Change
              </Button>
            </div>
          )}
          placeholder="Search product / service..."
        />
        {showDescription ? (
          <Textarea
            value={draft.description}
            onChange={(e) => setDraft({ description: e.target.value })}
            className="mt-1.5 text-xs min-h-[2.25rem] resize-y"
            rows={2}
            placeholder="Description (optional override)"
            data-testid={`input-edit-desc-${clientKey}`}
          />
        ) : (
          <button
            type="button"
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-700"
            onClick={() => onChangeShowDescription?.(true)}
            data-testid={`button-add-description-saved-${clientKey}`}
          >
            <Plus className="h-3 w-3" />
            Add description
          </button>
        )}
      </td>
      <td className="py-2.5 px-3 align-top w-24">
        <Input
          type="number"
          inputMode="decimal"
          value={draft.quantity}
          onChange={(e) => setDraft({ quantity: e.target.value })}
          className="text-xs text-right w-full [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          step="0.01"
          min="0"
          data-testid={`input-edit-qty-${clientKey}`}
        />
      </td>
      {/* 2026-05-01: Cost cell moved BEFORE Rate cell (job surfaces only). */}
      {showCost && (
        <td className="py-2.5 px-3 align-top w-[110px]">
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
            <Input
              type="number"
              inputMode="decimal"
              value={draft.unitCost ?? ""}
              onChange={(e) => setDraft({ unitCost: e.target.value })}
              className="text-xs text-right w-full pl-5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              step="0.01"
              min="0"
              placeholder="0.00"
              data-testid={`input-edit-cost-${clientKey}`}
            />
          </div>
        </td>
      )}
      <td className="py-2.5 px-3 align-top w-32">
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
          <Input
            type="number"
            inputMode="decimal"
            value={draft.unitPrice}
            onChange={(e) => setDraft({ unitPrice: e.target.value })}
            className="text-xs text-right w-full pl-5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            step="0.01"
            min="0"
            placeholder="0.00"
            data-testid={`input-edit-price-${clientKey}`}
          />
        </div>
      </td>
      <td className="py-2.5 pl-3 pr-1 align-top text-right text-xs font-semibold w-[110px]">
        {lineTotal}
      </td>
      <td className="py-2.5 pl-1 pr-2 align-top w-9 text-right">
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-rose-500 hover:bg-rose-50 hover:text-rose-600"
            onClick={onDelete}
            aria-label="Delete line item"
            data-testid={`button-delete-line-${clientKey}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </td>
    </tr>
  );
}
