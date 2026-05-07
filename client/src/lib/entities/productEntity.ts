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
  /**
   * 2026-04-26: per-service default duration in minutes. Already populated
   * via the Products & Services UI (column `items.estimated_duration_minutes`)
   * but historically dropped at normalization. Surfacing it lets every service
   * picker (Create Job, Edit Visit) auto-fill / auto-bump the schedule
   * duration on add. Optional + nullable — products and services without a
   * default duration set keep the field as `null` and consumers fall back
   * to whatever default the surface uses.
   */
  estimatedDurationMinutes?: number | null;
  /**
   * 2026-05-07: taxable indicator surfaced for the Pricebook bulk picker.
   * Optional — older callers that ignore it keep working. The DB column
   * (`items.is_taxable`) defaults true; we propagate that default here when
   * the row is missing the field. Display-only on existing surfaces; the
   * canonical line-item mapper still uses the catalog `isTaxable` flag
   * only when constructing fresh drafts via `productOptionToCatalogItem`.
   */
  isTaxable?: boolean;
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

// ── Suggested-services (no-search-text) selector helper ──
//
// 2026-04-26: empty-state replacement for the "Type to search the service
// catalog" empty state. When a service combobox opens with no typed text,
// callers want the top N most-recently-used services (per tenant), with an
// alphabetical fallback when the recency log is empty. No backend change —
// recency lives in `localStorage` keyed by company id; `/api/items?type=service`
// supplies the alphabetical universe.
//
// Recency is INTENTIONALLY namespaced by company id so a user logging into
// Tenant B on the same browser doesn't see Tenant A's recent picks.

const SERVICE_RECENCY_STORAGE_PREFIX = "syntraro:recent-services:";
const SERVICE_RECENCY_MAX_ENTRIES = 50;

function recencyStorageKey(companyId: string | null | undefined): string | null {
  if (!companyId) return null;
  return `${SERVICE_RECENCY_STORAGE_PREFIX}${companyId}`;
}

interface RecencyMap {
  [serviceId: string]: number; // epoch ms of last use
}

function readRecencyMap(companyId: string | null | undefined): RecencyMap {
  const key = recencyStorageKey(companyId);
  if (!key || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as RecencyMap) : {};
  } catch {
    return {};
  }
}

/**
 * Mark `serviceId` as just-used for the current tenant. Trims the map to
 * `SERVICE_RECENCY_MAX_ENTRIES` newest. Safe to call from a non-browser
 * environment (no-op when `window` is undefined).
 */
export function recordServiceUsage(
  companyId: string | null | undefined,
  serviceId: string,
): void {
  const key = recencyStorageKey(companyId);
  if (!key || !serviceId || typeof window === "undefined") return;
  try {
    const next = { ...readRecencyMap(companyId), [serviceId]: Date.now() };
    const entries = Object.entries(next);
    if (entries.length > SERVICE_RECENCY_MAX_ENTRIES) {
      entries.sort((a, b) => b[1] - a[1]);
      const trimmed = Object.fromEntries(entries.slice(0, SERVICE_RECENCY_MAX_ENTRIES));
      window.localStorage.setItem(key, JSON.stringify(trimmed));
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Quota / private-mode failures are non-fatal — fall back silently to
    // alphabetical-only ordering on next open.
  }
}

/**
 * Suggested-services hook for empty-state combobox panels. Fetches services
 * from the canonical `/api/items?type=service` endpoint, applies a recency
 * overlay sourced from `localStorage`, removes already-selected ids, and
 * returns up to `limit` rows.
 *
 * Ordering rule: any service whose id appears in the recency map sorts
 * first by `lastUsedAt DESC`, then any remaining services sort by `name
 * ASC` (server already orders alphabetically). The result is a smooth
 * "your most-used services first, then everything else" list.
 */
export function useTopServiceSuggestions(opts: {
  companyId: string | null | undefined;
  excludeIds: string[];
  /** Description-fallback exclusion — matches services whose name was
   *  hand-typed onto a job_part with `productId === null`. Case-insensitive. */
  excludeDescriptions?: string[];
  limit?: number;
  enabled?: boolean;
}) {
  const { companyId, excludeIds, excludeDescriptions, limit = 3, enabled = true } = opts;

  return useQuery<ProductOption[]>({
    queryKey: ["/api/items", "service-suggestions", companyId ?? "anon"],
    queryFn: async () => {
      const res = await apiRequest<any>(`/api/items?type=service&limit=50`);
      const rows = Array.isArray(res) ? res : (res?.data ?? res?.items ?? []);
      const services: ProductOption[] = rows
        .map(normalizeProductRow)
        .filter((r: ProductOption) => r.type === "service");
      return services;
    },
    enabled,
    staleTime: 60_000,
    select: (services) => {
      const excludeIdSet = new Set(excludeIds.filter(Boolean));
      const excludeNameSet = new Set(
        (excludeDescriptions ?? [])
          .map((d) => (d || "").trim().toLowerCase())
          .filter((d) => d.length > 0),
      );
      const recency = readRecencyMap(companyId);

      const eligible = services.filter((s) => {
        if (excludeIdSet.has(s.id)) return false;
        if (excludeNameSet.size > 0 && excludeNameSet.has(s.name.trim().toLowerCase())) return false;
        return true;
      });

      // Two-bucket sort: recent (DESC by timestamp), then rest (ASC by name).
      const recent: Array<{ s: ProductOption; t: number }> = [];
      const rest: ProductOption[] = [];
      for (const s of eligible) {
        const t = recency[s.id];
        if (typeof t === "number" && Number.isFinite(t)) {
          recent.push({ s, t });
        } else {
          rest.push(s);
        }
      }
      recent.sort((a, b) => b.t - a.t);
      rest.sort((a, b) => a.name.localeCompare(b.name));

      return [...recent.map((r) => r.s), ...rest].slice(0, Math.max(0, limit));
    },
  });
}

// ── Normalization ──

export function normalizeProductRow(r: any): ProductOption {
  // Read camelCase first, fall back to snake_case so a legacy endpoint
  // serializer doesn't drop a populated value.
  const rawDuration =
    r?.estimatedDurationMinutes ?? r?.estimated_duration_minutes ?? null;
  const parsedDuration =
    typeof rawDuration === "number"
      ? rawDuration
      : typeof rawDuration === "string" && rawDuration.trim() !== ""
        ? Number(rawDuration)
        : null;
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
    // 2026-04-26: propagate `estimatedDurationMinutes` so service pickers
    // can auto-fill / auto-bump schedule duration on add. NaN-safe.
    estimatedDurationMinutes: Number.isFinite(parsedDuration as number)
      ? (parsedDuration as number)
      : null,
    // 2026-05-07: propagate `isTaxable` for the Pricebook picker badge.
    // Reads camelCase first, falls back to snake_case. DB default is
    // true; treat missing/null as true to match.
    isTaxable:
      typeof r.isTaxable === "boolean"
        ? r.isTaxable
        : typeof r.is_taxable === "boolean"
          ? r.is_taxable
          : true,
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
    // 2026-05-07: was hard-coded false; now propagates the catalog flag
    // when the ProductOption carries it (Pricebook picker normalization
    // surfaces `isTaxable`). Older callers that build a ProductOption
    // without the flag still see the historical `false` default.
    isTaxable: p.isTaxable ?? false,
    taxCode: null,
    category: p.category ?? null,
    isActive: true,
  };
}
