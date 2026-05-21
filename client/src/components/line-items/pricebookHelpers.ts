/**
 * Pricebook picker — pure helpers extracted for unit testability.
 *
 * The repo has no React component-test harness (no jsdom + RTL), so the
 * picker's selection / submit logic is split here as pure functions and
 * tested directly. The modal renders these results.
 *
 * No state, no fetches, no rendering — keep it that way so a single
 * vitest run can exercise the whole bulk-mapping path.
 */

import { catalogItemToDraft, blankDraft } from "@/lib/entities/lineItemMapper";
import {
  productOptionToCatalogItem,
  type ProductOption,
} from "@/lib/entities/productEntity";
import { type LineItemDraft, parseMoney, formatMoney } from "@shared/lineItem";
import type { ServiceTemplateDto } from "@/lib/serviceTemplates/serviceTemplateTypes";
import type { CatalogPickerRow } from "./catalogPickerTypes";
import type { LineItemsAdapter } from "./types";

/** Caller surface → primary submit button label. */
export function pricebookSubmitLabel(
  surface: LineItemsAdapter["surface"],
): string {
  if (surface === "invoice") return "Add to invoice";
  if (surface === "quote" || surface === "quote-template") return "Add to quote";
  return "Add to job";
}

/**
 * Selection map — itemId → quantity. Numeric quantity (not money string)
 * because the picker increments/decrements in whole units. The map shape
 * intentionally guarantees that re-clicking the same item increments
 * rather than creating a duplicate pending row.
 */
export type PricebookSelections = Map<string, number>;

/**
 * Increment the selection for `itemId`. If the item is not yet selected,
 * sets quantity to 1. Mutates `prev` immutably (returns a new Map).
 */
export function incrementSelection(
  prev: PricebookSelections,
  itemId: string,
): PricebookSelections {
  const next = new Map(prev);
  next.set(itemId, (next.get(itemId) ?? 0) + 1);
  return next;
}

/**
 * Decrement the selection for `itemId`. If quantity reaches 0, removes
 * the entry (item becomes unselected). Returns a new Map.
 */
export function decrementSelection(
  prev: PricebookSelections,
  itemId: string,
): PricebookSelections {
  const next = new Map(prev);
  const current = next.get(itemId);
  if (current === undefined) return prev;
  if (current <= 1) {
    next.delete(itemId);
    return next;
  }
  next.set(itemId, current - 1);
  return next;
}

/** Remove an item from the selection outright (clear/remove control). */
export function clearSelection(
  prev: PricebookSelections,
  itemId: string,
): PricebookSelections {
  if (!prev.has(itemId)) return prev;
  const next = new Map(prev);
  next.delete(itemId);
  return next;
}

/** Total $ across the current selection — qty × unitPrice per item. */
export function selectedTotal(
  selections: PricebookSelections,
  items: ProductOption[],
): number {
  // Use Array.from over Map iteration so the file compiles cleanly
  // without `target: es2015+` in tsconfig (project default is ES3).
  let total = 0;
  Array.from(selections.entries()).forEach(([itemId, qty]) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    total += qty * parseMoney(item.unitPrice ?? "0");
  });
  return total;
}

/** Number of distinct items in the current selection. */
export function selectedCount(selections: PricebookSelections): number {
  return selections.size;
}

/**
 * Convert the current selection into LineItemDraft entries ready for
 * `useLineItemsDrafts.appendMany`. Each selected item with quantity N
 * becomes ONE draft with quantity N (not N drafts) — this is the bulk
 * picker's defining contract.
 *
 * Routes through the canonical `catalogItemToDraft` mapper, so every
 * existing field (productId, unitPrice, unitCost, taxRate seed, etc.)
 * is populated identically to the single-select picker. We then patch
 * the resulting draft with the picker quantity, refreshed lineSubtotal,
 * and a "pricebook" source tag for observability.
 */
export function selectionsToDrafts(
  selections: PricebookSelections,
  items: ProductOption[],
): Array<{ draft: LineItemDraft; product: ProductOption }> {
  const drafts: Array<{ draft: LineItemDraft; product: ProductOption }> = [];
  for (const item of items) {
    const qty = selections.get(item.id);
    if (qty === undefined || qty <= 0) continue;
    const baseDraft = catalogItemToDraft(productOptionToCatalogItem(item), {
      quantity: formatMoney(qty),
    });
    const subtotal = formatMoney(qty * parseMoney(baseDraft.unitPrice));
    drafts.push({
      draft: {
        ...baseDraft,
        lineSubtotal: subtotal,
        lineTotal: subtotal,
      },
      product: item,
    });
  }
  return drafts;
}

/**
 * Case-insensitive client-side filter for the picker grid. Used as a
 * preview while the user types — server search still owns the
 * authoritative dataset, but typing in the picker should feel instant.
 */
export function filterPricebookItems(
  items: ProductOption[],
  search: string,
): ProductOption[] {
  const q = search.trim().toLowerCase();
  if (q.length === 0) return items;
  return items.filter((item) => {
    const name = (item.name ?? "").toLowerCase();
    if (name.includes(q)) return true;
    const description = (item.description ?? "").toLowerCase();
    if (description.includes(q)) return true;
    const sku = (item.sku ?? "").toLowerCase();
    if (sku.includes(q)) return true;
    const category = (item.category ?? "").toLowerCase();
    if (category.includes(q)) return true;
    return false;
  });
}

// ── Unified catalog helpers (CatalogPickerRow — items + templates) ─────────
//
// These are additive to the item-only helpers above. The item-only functions
// remain unchanged so existing unit tests and callers keep working.

/** Compute estimated cost from service template component snapshots. */
function computeTemplateEstimatedCost(template: ServiceTemplateDto): number {
  return template.components.reduce((sum, c) => {
    return sum + parseMoney(c.quantity) * parseMoney(c.unitCostSnapshot ?? "0");
  }, 0);
}

/**
 * Build a LineItemDraft from a ServiceTemplateDto selection.
 *
 * Maps: flatRatePrice → unitPrice, computed component cost → unitCost,
 * template.id → serviceTemplateId, productId = null (no catalog link).
 * Uses blankDraft as base so the newDraftId() pattern in lineItemMapper
 * remains the sole ID generator.
 */
function serviceTemplateToDraft(
  template: ServiceTemplateDto,
  qty: number,
): LineItemDraft {
  const price = parseMoney(template.flatRatePrice);
  const cost = computeTemplateEstimatedCost(template);
  const subtotal = formatMoney(qty * price);
  const base = blankDraft({ source: "template" });
  return {
    ...base,
    description: template.name,
    quantity: formatMoney(qty),
    unitPrice: formatMoney(price),
    unitCost: formatMoney(cost),
    lineSubtotal: subtotal,
    lineTotal: subtotal,
    productId: null,
    lineItemType: "service",
    productType: "service",
    serviceTemplateId: template.id,
  };
}

/**
 * Case-insensitive filter across CatalogPickerRow[].
 *
 * Searches name, description (customer-facing only), and category.
 * Does NOT search internalNotes or component internals.
 */
export function filterCatalogRows(
  rows: CatalogPickerRow[],
  search: string,
): CatalogPickerRow[] {
  const q = search.trim().toLowerCase();
  if (q.length === 0) return rows;
  return rows.filter((row) => {
    if (row.name.toLowerCase().includes(q)) return true;
    if ((row.description ?? "").toLowerCase().includes(q)) return true;
    if ((row.category ?? "").toLowerCase().includes(q)) return true;
    // For pricebook items, also match SKU
    if (row._source === "pricebook" && (row._raw.sku ?? "").toLowerCase().includes(q)) return true;
    return false;
  });
}

/** Total price across the selection — qty × row.price. Handles null prices as 0. */
export function catalogSelectedTotal(
  selections: PricebookSelections,
  rows: CatalogPickerRow[],
): number {
  let total = 0;
  Array.from(selections.entries()).forEach(([rowId, qty]) => {
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    total += qty * parseMoney(row.price ?? "0");
  });
  return total;
}

/**
 * Convert a unified catalog selection into LineItemDraft entries.
 *
 * Pricebook rows: productId set, serviceTemplateId null (unchanged path).
 * Template rows: productId null, serviceTemplateId set, cost computed from snapshots.
 *
 * The return type widens `product` to `ProductOption | null` so callers
 * can pass entries directly to `useLineItemsDrafts.appendMany`, which
 * already accepts `product?: ProductOption | null`.
 */
export function catalogSelectionsToDrafts(
  selections: PricebookSelections,
  rows: CatalogPickerRow[],
): Array<{ draft: LineItemDraft; product: ProductOption | null }> {
  const results: Array<{ draft: LineItemDraft; product: ProductOption | null }> = [];

  for (const row of rows) {
    const qty = selections.get(row.id);
    if (qty === undefined || qty <= 0) continue;

    if (row._source === "pricebook") {
      const item = row._raw;
      const baseDraft = catalogItemToDraft(productOptionToCatalogItem(item), {
        quantity: formatMoney(qty),
      });
      const subtotal = formatMoney(qty * parseMoney(baseDraft.unitPrice));
      results.push({
        draft: { ...baseDraft, lineSubtotal: subtotal, lineTotal: subtotal },
        product: item,
      });
    } else {
      results.push({
        draft: serviceTemplateToDraft(row._raw, qty),
        product: null,
      });
    }
  }

  return results;
}
