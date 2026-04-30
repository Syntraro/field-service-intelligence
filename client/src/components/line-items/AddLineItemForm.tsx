/**
 * AddLineItemForm — controlled new-row form for the canonical
 * LineItemsCard.
 *
 * One instance per `serverId === null` entry in `lineDrafts`. Renders
 * inside the same `<table>` as `<LineItemRow>` and shares the column
 * layout. The ONLY structural difference vs. `<LineItemRow>` is
 * progressive disclosure: until a product is picked, the row shows only
 * the search field — qty / rate / amount cells render empty so the user
 * isn't asked to fill numerical fields without a product context.
 *
 * 2026-04-29 (Phase 1) — extracted from InvoiceDetailPage's
 * AddLineItemRow. State is fully controlled by the parent hook.
 */
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

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

export interface AddLineItemFormProps {
  clientKey: string;
  draft: LineItemDraft;
  selectedProduct: ProductOption | null;
  showDescription: boolean;
  /** Render the per-row Cost column (Job Parts). Invoice/Quote = false. */
  showCost?: boolean;
  onChangeDraft: (patch: Partial<LineItemDraft>) => void;
  onSelectProduct: (product: ProductOption | null) => void;
  onChangeShowDescription: (next: boolean) => void;
  onDelete: () => void;
  onRequestCreateProduct?: (name: string) => Promise<ProductOption | null>;
}

export function AddLineItemForm({
  clientKey,
  draft,
  selectedProduct,
  showDescription,
  showCost = false,
  onChangeDraft,
  onSelectProduct,
  onChangeShowDescription,
  onDelete,
  onRequestCreateProduct,
}: AddLineItemFormProps) {
  const [productSearch, setProductSearch] = useState("");
  const { data: searchResults = [], isLoading: searchLoading } = useProductSearch(productSearch);

  const setDraft = (patch: Partial<LineItemDraft>) => onChangeDraft(patch);
  const lineTotal = formatCurrency(parseMoney(draft.quantity) * parseMoney(draft.unitPrice));

  // 2026-04-29 (Audit Critical+High pass): the previous "product must be
  // picked first" gate hid qty / rate / cost / amount and the
  // "+ Add description" affordance until a catalog product was bound.
  // That made manual one-off lines unreachable — the only escape was
  // "Create '<X>'" → AddProductModal, which permanently added an item to
  // the catalog. The gate is removed: numeric inputs render unconditionally
  // (matching `<LineItemRow>` in edit mode) and the description button is
  // always available so users can type free-text descriptions on a new
  // row without touching the product selector.

  const handleCreateNew = async (text: string) => {
    if (!onRequestCreateProduct) return;
    const created = await onRequestCreateProduct(text.trim());
    if (created) onSelectProduct(created);
    setProductSearch("");
  };

  return (
    <tr
      className="border-b border-border/50 bg-primary/5"
      data-testid={`add-line-item-form-${clientKey}`}
    >
      <td className="py-2.5 pr-2 align-top w-8" />
      <td className="py-2.5 pr-3 align-top">
        <CreateOrSelectField<ProductOption>
          label=""
          compact
          value={selectedProduct}
          onChange={onSelectProduct}
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
              <span className="text-sm font-medium text-slate-800 truncate" data-testid="text-selected-product-name">
                {product.name}
              </span>
              <Button variant="ghost" size="sm" className="h-6 text-xs shrink-0" onClick={onClear} data-testid="button-change-product">
                Change
              </Button>
            </div>
          )}
          placeholder="Search product / service..."
        />
        {showDescription ? (
          <Textarea
            className="mt-1.5 text-xs min-h-[2.25rem] resize-y"
            rows={2}
            placeholder="Description / notes..."
            value={draft.description}
            onChange={(e) => setDraft({ description: e.target.value })}
            data-testid={`input-new-line-desc-${clientKey}`}
          />
        ) : (
          <button
            type="button"
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-700"
            onClick={() => onChangeShowDescription(true)}
            data-testid={`button-add-description-${clientKey}`}
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
          min={0}
          className="text-xs text-right w-full [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          value={draft.quantity}
          onChange={(e) => setDraft({ quantity: e.target.value })}
          step="0.01"
          data-testid={`input-new-line-qty-${clientKey}`}
        />
      </td>
      <td className="py-2.5 px-3 align-top w-32">
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            placeholder="0.00"
            className="text-xs text-right w-full pl-5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            value={draft.unitPrice}
            onChange={(e) => setDraft({ unitPrice: e.target.value })}
            data-testid={`input-new-line-price-${clientKey}`}
          />
        </div>
      </td>
      {showCost && (
        <td className="py-2.5 px-3 align-top w-[110px]">
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="0.00"
              className="text-xs text-right w-full pl-5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              value={draft.unitCost ?? ""}
              onChange={(e) => setDraft({ unitCost: e.target.value })}
              data-testid={`input-new-line-cost-${clientKey}`}
            />
          </div>
        </td>
      )}
      <td className="py-2.5 pl-3 pr-1 align-top text-right text-xs font-semibold w-[110px]">
        {lineTotal}
      </td>
      <td className="py-2.5 pl-1 pr-2 align-top w-9 text-right">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-rose-500 hover:bg-rose-50 hover:text-rose-600"
          onClick={onDelete}
          aria-label="Discard new line item"
          data-testid={`button-discard-new-line-${clientKey}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </td>
    </tr>
  );
}
