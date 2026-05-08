/**
 * Canonical inventory status badges (2026-05-08 Phase 2).
 *
 * Thin wrappers over `<StatusChip>` from the canonical chip primitive.
 * Every inventory surface (Items table, Locations table, Item rail,
 * Location rail, Low Stock list) routes through THIS file rather than
 * inlining `rounded-full px-1.5 py-0.5` spans with hardcoded slate /
 * emerald / blue tints.
 *
 * Why a wrapper layer at all
 * --------------------------
 * The chip primitive's tones are abstract (neutral / success / warning
 * / danger / info) — the inventory module needs a tighter vocabulary
 * (Active / Inactive / Stock Item / Non-Stock / Low Stock / Out of
 * Stock + the location-type lens). This file pins the mapping ONCE so
 * a future tone tweak (e.g. moving "Low Stock" from warning to danger)
 * happens in one place.
 *
 * Industry-agnostic: every label here is generic. No HVAC-specific or
 * trade-specific copy.
 */

import { StatusChip } from "@/components/ui/chip";
import type { ChipTone } from "@/lib/chipVariants";

// ── Item active state ─────────────────────────────────────────────

interface ItemActiveBadgeProps {
  active: boolean;
  /** Optional `data-testid` override. Defaults to
   *  `inventory-active-badge` (active) / `inventory-inactive-badge`. */
  testId?: string;
}

/** Active / Inactive — applies to both items and locations. The same
 *  badge rendering is used in both surfaces so a future tweak to the
 *  active-pill semantic ripples consistently. */
export function ItemActiveBadge({ active, testId }: ItemActiveBadgeProps) {
  return (
    <StatusChip
      tone={active ? "success" : "neutral"}
      data-testid={testId ?? (active ? "inventory-active-badge" : "inventory-inactive-badge")}
    >
      {active ? "Active" : "Inactive"}
    </StatusChip>
  );
}

// ── Item stock-tracking flavor ────────────────────────────────────

interface ItemStockBadgeProps {
  /** The item's `type` ("product" | "service"). Service items always
   *  render as a static "Service" pill — the tracking flag is not
   *  meaningful for services. */
  itemType: string;
  /** The item's `trackInventory` boolean. Ignored when `itemType ==
   *  "service"`. */
  trackInventory: boolean;
  /** Optional override; e.g. when a Low Stock surface wants the
   *  badge to read "Low Stock" instead of "Stock Item". */
  forceLabel?: "low_stock" | "out_of_stock";
}

/** Renders one of:
 *    - Service       (neutral)  — type === "service"
 *    - Stock Item    (info)     — type === "product" && trackInventory
 *    - Non-Stock     (neutral)  — type === "product" && !trackInventory
 *    - Low Stock     (warning)  — forced via forceLabel
 *    - Out of Stock  (danger)   — forced via forceLabel */
export function ItemStockBadge({
  itemType,
  trackInventory,
  forceLabel,
}: ItemStockBadgeProps) {
  if (forceLabel === "out_of_stock") {
    return (
      <StatusChip tone="danger" data-testid="inventory-out-of-stock-badge">
        Out of Stock
      </StatusChip>
    );
  }
  if (forceLabel === "low_stock") {
    return (
      <StatusChip tone="warning" data-testid="inventory-low-stock-badge">
        Low Stock
      </StatusChip>
    );
  }
  if (itemType === "service") {
    return (
      <StatusChip tone="neutral" data-testid="inventory-service-badge">
        Service
      </StatusChip>
    );
  }
  if (trackInventory) {
    return (
      <StatusChip tone="info" data-testid="inventory-stock-item-badge">
        Stock Item
      </StatusChip>
    );
  }
  return (
    <StatusChip tone="neutral" data-testid="inventory-non-stock-badge">
      Non-Stock
    </StatusChip>
  );
}

// ── Location type lens ────────────────────────────────────────────

const LOCATION_TYPE_LABELS: Record<string, string> = {
  warehouse: "Warehouse",
  vehicle: "Vehicle",
  office: "Office",
  storage: "Storage",
  temporary: "Temporary",
  other: "Other",
};

const LOCATION_TYPE_TONES: Record<string, ChipTone> = {
  warehouse: "info",
  vehicle: "warning",
  office: "neutral",
  storage: "neutral",
  temporary: "neutral",
  other: "neutral",
};

interface LocationTypeBadgeProps {
  /** One of the canonical inventoryLocationTypeEnum values. Unknown
   *  types fall back to neutral / capitalized literal. */
  type: string;
  /** Optional testId override. */
  testId?: string;
}

/** Location type pill — Warehouse / Vehicle / Office / Storage /
 *  Temporary / Other. Every surface that displays a location type
 *  routes through this so the (label, tone) mapping lives in one
 *  place. */
export function LocationTypeBadge({ type, testId }: LocationTypeBadgeProps) {
  const label = LOCATION_TYPE_LABELS[type] ?? type;
  const tone = LOCATION_TYPE_TONES[type] ?? "neutral";
  return (
    <StatusChip
      tone={tone}
      data-testid={testId ?? `inventory-location-type-${type}`}
    >
      {label}
    </StatusChip>
  );
}

// ── Stock-status badge (for the per-row Reorder Status column) ────

interface StockStatusBadgeProps {
  onHand: string;
  available: string;
  minimum: string | null;
  reorderPoint: string | null;
}

/** Computes Out of Stock / Low Stock / OK from the row's quantities.
 *  Reused by the Item rail's Locations tab and the Location rail's
 *  Inventory tab so the rule lives in one place. */
export function StockStatusBadge({
  onHand,
  available,
  minimum,
  reorderPoint,
}: StockStatusBadgeProps) {
  const onHandN = Number(onHand);
  const availableN = Number(available);
  const minN = minimum != null ? Number(minimum) : null;
  if (onHandN <= 0) {
    return <ItemStockBadge itemType="product" trackInventory forceLabel="out_of_stock" />;
  }
  if (minN != null && availableN <= minN) {
    return <ItemStockBadge itemType="product" trackInventory forceLabel="low_stock" />;
  }
  // OK — render a quiet neutral pill so the column never looks empty.
  return (
    <StatusChip tone="success" data-testid="inventory-stock-ok-badge">
      OK
    </StatusChip>
  );
}
