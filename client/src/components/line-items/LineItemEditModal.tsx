/**
 * LineItemEditModal — canonical add/edit modal for persisted-mode
 * line items.
 *
 * Domain wrapper (modal taxonomy rule #4) — same shape as the
 * Pricebook picker. Mounts the canonical `<ModalShell>` primitives,
 * owns its own dimensions, exposes ONE shared form for both
 * "add new line" and "edit existing line" flows.
 *
 * The modal is dumb: it manages local form state, calls
 * `onSave(draft)` when the user clicks the primary action, and
 * defers all mutation work to the host adapter. The host (the
 * surface page's adapter) decides whether `onSave` fires
 * `addLine` (mode="add") or `updateLine` (mode="edit").
 *
 * Field set matches the inline `<AddLineItemForm>` / `<EditCells>`
 * pair so users see the same controls regardless of entry point.
 * `taxable` and `markup` are NOT surfaced — they don't exist on
 * the canonical `LineItemDraft` shape (`isTaxable` lives on the
 * catalog item; `markupPercent` on the catalog item only).
 */

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalFooter,
  ModalPrimaryAction,
  ModalSecondaryAction,
} from "@/components/ui/modal";
import { CreateOrSelectField } from "@/components/shared/CreateOrSelectField";
import {
  useProductSearch,
  getProductKey,
  getProductLabel,
  getProductDescription,
  productOptionToCatalogItem,
  type ProductOption,
} from "@/lib/entities/productEntity";
import {
  type LineItemDraft,
  parseMoney,
  formatMoney,
} from "@shared/lineItem";
import { applyCatalogItemToDraft } from "@/lib/entities/lineItemMapper";
import { formatCurrency } from "@/lib/formatters";
import type { LineItemsAdapter } from "./types";

// ── Title resolver ───────────────────────────────────────────────────

/** Caller surface + mode → modal title. */
export function lineItemEditModalTitle(
  surface: LineItemsAdapter["surface"],
  mode: "add" | "edit",
): string {
  const noun =
    surface === "invoice"
      ? "invoice item"
      : surface === "quote" || surface === "quote-template"
        ? "quote item"
        : "job item";
  return mode === "add"
    ? `Add ${noun}`
    : `Edit ${noun}`;
}

// ── Form state ───────────────────────────────────────────────────────

interface LineItemEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surface: LineItemsAdapter["surface"];
  mode: "add" | "edit";
  /** Initial draft for the form. Required in "edit" mode. In "add"
   *  mode, supply a blank draft (e.g. `blankDraft()`) — the modal
   *  doesn't construct one itself so the host can seed defaults. */
  initialDraft: LineItemDraft;
  /** Initially selected product chip (for edit-mode hydration). */
  initialProduct?: ProductOption | null;
  /** Render the Cost field. Job Parts = true; Invoice / Quote = false. */
  showCost: boolean;
  /** Save handler. Receives the finalized draft; must resolve to
   *  signal success (modal will close) or reject (modal stays open).
   *  Toast/error reporting is the host's responsibility. */
  onSave: (draft: LineItemDraft) => Promise<void>;
  /** Optional — opens the canonical AddProductModal mid-flow. */
  onRequestCreateProduct?: (name: string) => Promise<ProductOption | null>;
}

export function LineItemEditModal({
  open,
  onOpenChange,
  surface,
  mode,
  initialDraft,
  initialProduct = null,
  showCost,
  onSave,
  onRequestCreateProduct,
}: LineItemEditModalProps) {
  const [draft, setDraft] = useState<LineItemDraft>(initialDraft);
  const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>(
    initialProduct,
  );
  const [productSearch, setProductSearch] = useState("");
  const [showDescription, setShowDescription] = useState(
    (initialDraft.description ?? "").trim().length > 0,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 2026-05-07 polish — root cause of the "stale item after Create"
  // bug. The parent (LineItemsCard) computes `editingDraftSeed` /
  // `editingProductSeed` via `adapter.hydrateDraft(line)` on every
  // render — fresh object references each time. When a parent
  // re-render fired DURING the create-product flow (e.g. when
  // AddProductModal opens and JobDetailPage state changes), the deps
  // `[open, initialDraft, initialProduct]` saw new references, the
  // effect re-ran, and `selectedProduct` was reset to the OLD
  // initialProduct — wiping the just-created item out of the chip.
  //
  // Fix: depend ONLY on `open`. The effect captures the latest
  // `initialDraft` / `initialProduct` from the closure at the moment
  // open transitions; subsequent parent re-renders no longer reset
  // mid-edit state. If the parent ever needs to swap rows without
  // closing the modal first, that's a parent bug — keep the
  // contract simple here.
  useEffect(() => {
    if (open) {
      setDraft(initialDraft);
      setSelectedProduct(initialProduct);
      setProductSearch("");
      setShowDescription((initialDraft.description ?? "").trim().length > 0);
      setSaving(false);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { data: searchResults = [], isLoading: searchLoading } =
    useProductSearch(productSearch);

  const lineTotalLabel = useMemo(
    () => formatCurrency(parseMoney(draft.quantity) * parseMoney(draft.unitPrice)),
    [draft.quantity, draft.unitPrice],
  );

  // Validate the same way `useLineItemsDrafts.buildSavePlan` does:
  // need a description (or a selected product whose name fills in)
  // AND quantity > 0.
  const fallbackDescription = (selectedProduct?.name ?? "").trim();
  const finalDescription = (draft.description.trim() || fallbackDescription).trim();
  const quantity = parseMoney(draft.quantity);
  const canSave =
    !saving && finalDescription.length > 0 && quantity > 0;

  // ── Handlers ────────────────────────────────────────────────────────

  const handleSelectProduct = (product: ProductOption | null) => {
    setSelectedProduct(product);
    if (!product) {
      // Clearing the chip leaves description / qty / price as-is —
      // don't surprise the user by wiping their typed values.
      setDraft((prev) => ({
        ...prev,
        productId: null,
        productType: undefined,
      }));
      return;
    }
    // 2026-05-07 — route through the canonical
    // `applyCatalogItemToDraft` helper. Selecting a saved item
    // OVERWRITES every catalog-derived field (productId, productType,
    // description, unitPrice, unitCost, lineSubtotal, lineTotal). Only
    // the user-entered quantity is preserved. The previous logic kept
    // `prev.description` whenever it was non-empty, which silently
    // carried over the OLD item's description (e.g. switching from
    // Window Cleaning → Thermostat left "Window Cleaning" on the
    // line). Same helper is used by the create-new-product flow
    // because `handleCreateNew` calls `handleSelectProduct(created)`.
    const updates = applyCatalogItemToDraft(
      draft,
      productOptionToCatalogItem(product),
    );
    setDraft((prev) => ({ ...prev, ...updates }));
    setShowDescription(true);
  };

  const handleCreateNew = async (text: string) => {
    if (!onRequestCreateProduct) return;
    const created = await onRequestCreateProduct(text.trim());
    if (created) handleSelectProduct(created);
    setProductSearch("");
  };

  const handleSubmit = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    // Recompute lineSubtotal at save time so the persisted row
    // matches qty × price (mirrors the hook's buildSavePlan rule).
    const subtotal = formatMoney(quantity * parseMoney(draft.unitPrice));
    const finalDraft: LineItemDraft = {
      ...draft,
      description: finalDescription,
      lineSubtotal: subtotal,
      lineTotal: subtotal,
    };
    try {
      await onSave(finalDraft);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed.";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      // Comfortable for a single-line form; no need to match the
      // wider Pricebook picker. Keeps the canonical close X reachable.
      className="w-[min(560px,calc(100vw-32px))] max-w-[560px] sm:max-w-[560px] flex flex-col"
      data-testid="line-item-edit-modal"
    >
      <ModalHeader className="space-y-1.5 pr-8">
        <ModalTitle data-testid="line-item-edit-modal-title">
          {lineItemEditModalTitle(surface, mode)}
        </ModalTitle>
        <ModalDescription>
          {mode === "add"
            ? "Add a single line. Use Pricebook for bulk."
            : "Update this line. Changes save immediately."}
        </ModalDescription>
      </ModalHeader>

      <div className="px-5 py-4 space-y-3.5">
        {/* Product picker — same primitive the inline AddLineItemForm
            uses, so saved-item lookup behaves identically. */}
        <div className="space-y-1">
          <label className="text-caption font-medium text-slate-700">
            Saved item
          </label>
          <CreateOrSelectField<ProductOption>
            label=""
            compact
            value={selectedProduct}
            onChange={handleSelectProduct}
            searchResults={searchResults}
            searchLoading={searchLoading}
            searchText={productSearch}
            onSearchTextChange={setProductSearch}
            getKey={getProductKey}
            getLabel={getProductLabel}
            getDescription={getProductDescription}
            createLabel={
              onRequestCreateProduct && productSearch.trim()
                ? `Create "${productSearch.trim()}"`
                : undefined
            }
            onCreateNew={
              onRequestCreateProduct && productSearch.trim()
                ? handleCreateNew
                : undefined
            }
            renderSelected={(product, onClear) => (
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-md">
                <span className="text-sm font-medium text-slate-800 truncate">
                  {product.name}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs shrink-0"
                  onClick={onClear}
                  data-testid="line-item-edit-product-change"
                >
                  Change
                </Button>
              </div>
            )}
            placeholder="Search product / service..."
          />
        </div>

        {/* Description — always visible in the modal (unlike the
            inline form's progressive disclosure). Single-row context
            tolerates the field being open. */}
        <div className="space-y-1">
          <label
            className="text-caption font-medium text-slate-700"
            htmlFor="line-item-edit-description"
          >
            Description
          </label>
          <Textarea
            id="line-item-edit-description"
            rows={2}
            placeholder={
              selectedProduct?.name
                ? `Defaults to "${selectedProduct.name}"`
                : "Required"
            }
            value={draft.description}
            onChange={(e) => {
              setDraft((prev) => ({ ...prev, description: e.target.value }));
              setShowDescription(true);
            }}
            data-testid="line-item-edit-description"
            className="resize-y min-h-[2.25rem] text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label
              className="text-caption font-medium text-slate-700"
              htmlFor="line-item-edit-qty"
            >
              Quantity
            </label>
            <Input
              id="line-item-edit-qty"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              className="text-sm text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              value={draft.quantity}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, quantity: e.target.value }))
              }
              data-testid="line-item-edit-qty"
            />
          </div>
          {/* 2026-05-01 column order convention: Cost BEFORE Rate. */}
          {showCost && (
            <div className="space-y-1">
              <label
                className="text-caption font-medium text-slate-700"
                htmlFor="line-item-edit-cost"
              >
                Cost
              </label>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                  $
                </span>
                <Input
                  id="line-item-edit-cost"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                  className="text-sm text-right pl-5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  value={draft.unitCost ?? ""}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, unitCost: e.target.value }))
                  }
                  data-testid="line-item-edit-cost"
                />
              </div>
            </div>
          )}
          <div className={showCost ? "space-y-1 col-span-2" : "space-y-1"}>
            <label
              className="text-caption font-medium text-slate-700"
              htmlFor="line-item-edit-price"
            >
              Rate
            </label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                $
              </span>
              <Input
                id="line-item-edit-price"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="0.00"
                className="text-sm text-right pl-5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                value={draft.unitPrice}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, unitPrice: e.target.value }))
                }
                data-testid="line-item-edit-price"
              />
            </div>
          </div>
        </div>

        <div
          className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
          data-testid="line-item-edit-total"
        >
          <span className="text-caption font-medium text-slate-700">Amount</span>
          <span className="text-sm font-semibold tabular-nums text-slate-900">
            {lineTotalLabel}
          </span>
        </div>

        {/* Hide the description-toggle hint after the user types — it
            implies the field can be re-hidden, which it can't. */}
        {!showDescription && (
          <p className="text-[11px] text-slate-500">
            Description defaults to the saved item's name when blank.
          </p>
        )}

        {error && (
          <div
            className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
            data-testid="line-item-edit-error"
          >
            {error}
          </div>
        )}
      </div>

      <ModalFooter>
        <ModalSecondaryAction
          onClick={() => onOpenChange(false)}
          disabled={saving}
          data-testid="line-item-edit-cancel"
        >
          Cancel
        </ModalSecondaryAction>
        <ModalPrimaryAction
          onClick={handleSubmit}
          disabled={!canSave}
          data-testid="line-item-edit-save"
        >
          {saving ? "Saving…" : mode === "add" ? "Add" : "Save"}
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}
