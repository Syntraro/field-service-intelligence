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

import { catalogItemToDraft } from "@/lib/entities/lineItemMapper";
import {
  productOptionToCatalogItem,
  type ProductOption,
} from "@/lib/entities/productEntity";
import { type LineItemDraft, parseMoney, formatMoney } from "@shared/lineItem";
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

// ─── Pricebook Groups (2026-05-07 RALPH) ──────────────────────────
//
// Groups are saved bundles that expand into N individual line items
// when added. The picker right rail toggles group selection (Set of
// groupIds); submit fan-outs every selected group's children through
// the canonical line-item mapper, then merges them with the
// individually-selected items. Duplicate handling: when the same
// productId appears across the merged drafts AND the unit price /
// cost / taxable flag all match, quantities combine into ONE draft.
// Anything else stays as separate lines (different price = different
// line-item — merging would be wrong).

/** One row from `GET /api/pricebook-groups`. Mirrors the server's
 *  `PricebookGroupSummary` shape; declared here to avoid importing
 *  server types into the client bundle. */
export interface PricebookGroupSummaryDto {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  isActive: boolean;
  usageCount: number;
  itemCount: number;
  totalEstimate: string;
  children: ReadonlyArray<{
    id: string;
    itemId: string;
    name: string | null;
    description: string | null;
    type: string;
    quantity: string;
    unitPrice: string | null;
    cost: string | null;
    isTaxable: boolean | null;
    sortOrder: number;
  }>;
}

/** Group selection state — Set of selected group ids. Groups are
 *  toggled on/off (no quantity), so a Set is enough. */
export type PricebookGroupSelections = ReadonlySet<string>;

/** Toggle one group in the selection. Returns a new Set. */
export function toggleGroupSelection(
  prev: PricebookGroupSelections,
  groupId: string,
): PricebookGroupSelections {
  const next = new Set(prev);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  return next;
}

/** Total expanded line-item count when the selected groups expand. */
export function expandedGroupChildCount(
  groups: ReadonlyArray<PricebookGroupSummaryDto>,
  selectedGroupIds: PricebookGroupSelections,
): number {
  let count = 0;
  for (const g of groups) {
    if (selectedGroupIds.has(g.id)) count += g.children.length;
  }
  return count;
}

/** Estimated $ total for selected groups — pre-summed by the server
 *  as `totalEstimate`. Sums across selection. */
export function selectedGroupsTotal(
  groups: ReadonlyArray<PricebookGroupSummaryDto>,
  selectedGroupIds: PricebookGroupSelections,
): number {
  let total = 0;
  for (const g of groups) {
    if (selectedGroupIds.has(g.id)) total += parseMoney(g.totalEstimate);
  }
  return total;
}

/**
 * Convert a group's child items into LineItemDraft entries. Each child
 * routes through the canonical `catalogItemToDraft` mapper (same path
 * the single-item picker uses) so productId / price / cost / taxable
 * are populated identically. Quantity comes from the group child row.
 *
 * Children whose underlying pricebook item is missing (deleted out from
 * under the group, or cross-tenant) are silently skipped; the FK
 * cascade should prevent this in practice, but we defend.
 */
export function groupChildrenToDrafts(
  group: PricebookGroupSummaryDto,
): Array<{ draft: LineItemDraft; product: ProductOption }> {
  const drafts: Array<{ draft: LineItemDraft; product: ProductOption }> = [];
  for (const child of group.children) {
    if (!child.itemId) continue;
    const synthetic: ProductOption = {
      id: child.itemId,
      name: child.name ?? "",
      type: child.type,
      unitPrice: child.unitPrice,
      cost: child.cost,
      description: child.description,
      isTaxable: child.isTaxable ?? true,
    };
    // Normalize the persisted numeric string ("2") to the canonical
    // money string ("2.00") so the resulting draft and downstream
    // payloads match the rest of the line-item mapper's output.
    const qtyNum = parseMoney(child.quantity);
    const qtyString = formatMoney(qtyNum);
    const baseDraft = catalogItemToDraft(productOptionToCatalogItem(synthetic), {
      quantity: qtyString,
    });
    const subtotal = formatMoney(qtyNum * parseMoney(baseDraft.unitPrice));
    drafts.push({
      draft: { ...baseDraft, lineSubtotal: subtotal, lineTotal: subtotal },
      product: synthetic,
    });
  }
  return drafts;
}

/**
 * Merge two draft lists: when the SAME productId appears in both AND
 * the unit price + cost + taxable flag all match, combine quantities
 * into ONE entry. Any difference -> keep as separate entries (a
 * different price means a different line, and merging would silently
 * overwrite the user's catalog choice).
 *
 * Order is preserved: the FIRST occurrence of a productId wins the
 * merged slot; subsequent matching duplicates fold into it.
 *
 * This is the duplicate-handling rule promised by the spec:
 * "preferred: combine quantities into one resulting line if
 * productId/itemId matches and unit price/cost/taxable are the same;
 * if not safe, keep as separate lines."
 */
export function mergeCompatibleDrafts(
  entries: ReadonlyArray<{ draft: LineItemDraft; product: ProductOption }>,
): Array<{ draft: LineItemDraft; product: ProductOption }> {
  const out: Array<{ draft: LineItemDraft; product: ProductOption }> = [];
  // Index = position in `out` of the first compatible entry per
  // productId+price+cost+taxable signature. Manual lines (no
  // productId) never merge.
  const signatureIndex = new Map<string, number>();
  for (const entry of entries) {
    const productId = entry.draft.productId;
    if (!productId) {
      out.push({ draft: { ...entry.draft }, product: entry.product });
      continue;
    }
    // `LineItemDraft` does not carry `isTaxable` directly; the
    // taxable flag lives on the paired `ProductOption.isTaxable`
    // (catalog snapshot). Read it from `entry.product` so the merge
    // signature reflects the real catalog flag — two children with
    // matching productId/price/cost but different taxability still
    // produce two lines.
    const taxFlag = entry.product.isTaxable === false ? "0" : "1";
    const sig = [
      productId,
      entry.draft.unitPrice,
      entry.draft.unitCost ?? "",
      taxFlag,
    ].join("|");
    const existingIdx = signatureIndex.get(sig);
    if (existingIdx === undefined) {
      signatureIndex.set(sig, out.length);
      out.push({ draft: { ...entry.draft }, product: entry.product });
      continue;
    }
    const existing = out[existingIdx];
    const combinedQty = formatMoney(
      parseMoney(existing.draft.quantity) + parseMoney(entry.draft.quantity),
    );
    const combinedSubtotal = formatMoney(
      parseMoney(combinedQty) * parseMoney(existing.draft.unitPrice),
    );
    out[existingIdx] = {
      ...existing,
      draft: {
        ...existing.draft,
        quantity: combinedQty,
        lineSubtotal: combinedSubtotal,
        lineTotal: combinedSubtotal,
      },
    };
  }
  return out;
}

/**
 * Canonical bulk-add resolver: combine the picker's individual-item
 * selection AND its group selection into one merged draft list, ready
 * for `useLineItemsDrafts.appendMany`. Duplicate handling per
 * `mergeCompatibleDrafts` rules.
 */
export function buildPricebookSubmitEntries(
  itemSelections: PricebookSelections,
  items: ProductOption[],
  groups: ReadonlyArray<PricebookGroupSummaryDto>,
  selectedGroupIds: PricebookGroupSelections,
): Array<{ draft: LineItemDraft; product: ProductOption }> {
  const itemDrafts = selectionsToDrafts(itemSelections, items);
  const groupDrafts: Array<{ draft: LineItemDraft; product: ProductOption }> = [];
  for (const g of groups) {
    if (!selectedGroupIds.has(g.id)) continue;
    groupDrafts.push(...groupChildrenToDrafts(g));
  }
  return mergeCompatibleDrafts([...itemDrafts, ...groupDrafts]);
}
