/**
 * Canonical product/service entity — owns search, mapping, and option formatting
 * for Products & Services selection across quote templates, line items, and parts flows.
 *
 * Consumers should use this module instead of raw /api/items queries.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { CatalogItem } from "@shared/lineItem";

// ── Canonical product option shape ──

export interface ProductOption {
  id: string;
  name: string;
  type: string; // "product" | "service"
  unitPrice: string | null;
  cost: string | null;
  /**
   * 2026-04-10 (P9-P10 Phase E): optional catalog metadata used for selector
   * disambiguation. Both fields are additive — every existing consumer that
   * only reads the original 5 fields keeps working unchanged. The catalog
   * search endpoint (`GET /api/items?q=...`) ships these columns when
   * present; missing/null values mean the catalog row does not have them.
   *
   * Display: surfaces that show a secondary description line (e.g. PM bulk
   * modal, tech AddPart, office cells) get more disambiguating context for
   * free via `getProductDescription`.
   *
   * Save contracts: NOT touched. The office canonical payload helpers
   * (`draftToInvoiceLinePayload` / `draftToQuoteLinePayload` /
   * `draftToJobPartPayload`) and the tech ref-based payload do not include
   * `sku` or `category` on the wire — these are display-only.
   */
  sku?: string | null;
  category?: string | null;
  /**
   * 2026-04-18: Catalog description (distinct from the draft's line-label
   * `description`). Surfaced in `getProductDescription` so the selector
   * chip and search-dropdown rows can show catalog text like "A421ABD"
   * underneath the item name. Display-only; never reaches a save payload.
   */
  description?: string | null;
}

// ── Search ──

export function useProductSearch(searchText: string, options?: { limit?: number; enabled?: boolean }) {
  const minLength = 2;
  const isEnabled = (options?.enabled ?? true) && (searchText?.length ?? 0) >= minLength;
  const limit = options?.limit ?? 20;

  return useQuery<ProductOption[]>({
    queryKey: ["/api/items", "search", searchText],
    queryFn: async () => {
      const res = await apiRequest<any>(`/api/items?q=${encodeURIComponent(searchText)}&limit=${limit}`);
      const rows = Array.isArray(res) ? res : (res?.data ?? res?.items ?? []);
      return rows.map(normalizeProductRow);
    },
    enabled: isEnabled,
  });
}

// ── Normalization ──

export function normalizeProductRow(r: any): ProductOption {
  return {
    id: r.id,
    name: r.name ?? "Unknown",
    type: r.type ?? "product",
    unitPrice: r.unitPrice ?? r.unit_price ?? null,
    cost: r.cost ?? null,
    // 2026-04-10 (Phase E): additive sku/category — read both camelCase and
    // snake_case in case a legacy endpoint serializer is still around.
    sku: r.sku ?? null,
    category: r.category ?? null,
    // 2026-04-18: propagate catalog description for the selector chip.
    description: r.description ?? null,
  };
}

// ── Option helpers for selector shell ──

export function getProductKey(p: ProductOption): string {
  return p.id;
}

export function getProductLabel(p: ProductOption): string {
  return p.name;
}

/**
 * Build the secondary description line for a `ProductOption` row in the
 * canonical CreateOrSelectField dropdown / chip.
 *
 * Composition (left → right, dot-separated):
 *   - Type: "Service" or "Product" (based on `type`)
 *   - SKU: shown only when present
 *   - Category: shown only when present
 *   - Price: shown only when present
 *
 * 2026-04-10 (Phase E): SKU and category were added so PM bulk and tech
 * selectors that previously rendered SKU/category in their bespoke result
 * lists now get the same disambiguation through the canonical helper. The
 * fields are display-only — they never reach any save payload.
 */
export function getProductDescription(p: ProductOption): string | undefined {
  const parts: string[] = [];
  // 2026-04-18: Catalog description comes first when present. Example:
  //   "A421ABD · Product · $45.00"  (description · type · price)
  // Falls back to the original type/sku/category/price format for items
  // that don't have a catalog description.
  if (p.description) parts.push(p.description);
  if (p.type) parts.push(p.type === "service" ? "Service" : "Product");
  if (p.sku) parts.push(p.sku);
  if (p.category) parts.push(p.category);
  if (p.unitPrice) parts.push(`$${parseFloat(p.unitPrice).toFixed(2)}`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

// ── Adapter: ProductOption → CatalogItem ──
//
// `useProductSearch` returns the narrow `ProductOption` shape (now 7 fields:
// id, name, type, unitPrice, cost, sku?, category?) because the catalog
// search endpoint only ships the columns the selector needs. The canonical
// line-item mapper (`catalogItemToDraft`) accepts the wider `CatalogItem`
// shape from `@shared/lineItem` (12 fields). This adapter bridges the two
// so callers can do:
//
//     setDraft(catalogItemToDraft(productOptionToCatalogItem(product)));
//
// Missing fields default to safe values. The catalog item type is normalized to
// the canonical `"product" | "service"` enum (any unknown value falls back to
// "product"). This is the only sanctioned bridge between these two shapes —
// do not inline the field map at call sites.
//
// 2026-04-09: Created in Phase A of the P9-P10 client-side consolidation.
// 2026-04-10 (Phase E): sku/category propagated from ProductOption when
// present (was hard-null'd before). The canonical `catalogItemToDraft`
// description-fallback chain (name → description → sku → "(unnamed item)")
// now sees the SKU when name is missing, instead of skipping straight to
// the placeholder. Save contracts unchanged — `LineItemDraft` does not
// store sku/category as separate fields; both are display-only metadata.
export function productOptionToCatalogItem(p: ProductOption): CatalogItem {
  return {
    id: p.id,
    type: p.type === "service" ? "service" : "product",
    name: p.name,
    sku: p.sku ?? null,
    // 2026-04-18: propagate catalog description so downstream consumers
    // (currently just the selector chip via the row's lookup map) see it.
    description: p.description ?? null,
    cost: p.cost,
    unitPrice: p.unitPrice,
    isTaxable: false,
    taxCode: null,
    category: p.category ?? null,
    isActive: true,
  };
}
