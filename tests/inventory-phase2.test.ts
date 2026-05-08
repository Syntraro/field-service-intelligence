/**
 * Inventory Phase 2 — operational workflows + location rail
 * (2026-05-08).
 *
 * Locks the architectural contracts of the second inventory pass:
 *   - location aggregates + per-location reads on the server
 *   - low-stock formula change to `available <= minimum_quantity` +
 *     suggestedReplenishment derivation
 *   - canonical inventory status badges via the StatusChip primitive
 *     (no parallel pill implementations)
 *   - Location Rail mounts the same DetailRightRail primitive as the
 *     Item Rail
 *   - Item Rail keyboard ESC + ArrowUp/ArrowDown + prev/next nav
 *     buttons
 *   - Transfer/Adjust modal contextual prefill
 *   - InventoryPage Locations tab summary cards + filters + DropdownMenu
 *     row actions
 *   - mutually-exclusive item/location rail state
 *   - archive endpoint + storage helper
 *
 * Source-pin tests (no live DB / no live render). The pinned wiring is
 * sufficient to catch every regression that matters for the operational
 * inventory workflows.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const STORAGE_PATH = path("server/storage/inventory.ts");
const ROUTE_PATH = path("server/routes/inventory.ts");
const PAGE_PATH = path("client/src/pages/InventoryPage.tsx");
const ITEM_RAIL_PATH = path("client/src/components/inventory/InventoryItemRail.tsx");
const LOC_RAIL_PATH = path("client/src/components/inventory/InventoryLocationRail.tsx");
const BADGES_PATH = path("client/src/components/inventory/InventoryStatusBadges.tsx");
const TRANSFER_PATH = path("client/src/components/inventory/TransferStockModal.tsx");
const ADJUST_PATH = path("client/src/components/inventory/AdjustStockModal.tsx");
const TYPES_PATH = path("client/src/lib/inventory/types.ts");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

// ── 1. Storage layer: aggregates + low-stock + per-location ─────────

describe("server/storage/inventory.ts — Phase-2 reads", () => {
  const src = read(STORAGE_PATH);

  it("listLocationsWithAggregates groups by location_id and returns itemCount / totalQuantity / lowStockCount", () => {
    expect(src).toMatch(/async function listLocationsWithAggregates/);
    expect(src).toMatch(/groupBy\(inventoryQuantities\.locationId\)/);
    expect(src).toMatch(/itemCount:\s*sql<number>`COUNT\(\*\)::int`/);
    expect(src).toMatch(
      /totalQuantity:\s*sql<string>`COALESCE\(SUM\(\$\{inventoryQuantities\.onHandQuantity\}\),\s*0\)`/,
    );
    expect(src).toMatch(
      /lowStockCount:\s*sql<number>`COUNT\(\*\) FILTER \([\s\S]+?<=\s*\$\{inventoryQuantities\.minimumQuantity\}[\s\S]+?\)::int`/,
    );
  });

  it("listLocations LEFT JOINs users to expose assignedUserName", () => {
    expect(src).toMatch(
      /\.leftJoin\(users,\s*eq\(inventoryLocations\.assignedUserId,\s*users\.id\)\)/,
    );
    expect(src).toMatch(
      /assignedUserName:\s*sql<string \| null>`COALESCE\(\$\{users\.firstName\} \|\| ' ' \|\| \$\{users\.lastName\},\s*\$\{users\.email\}\)`/,
    );
  });

  it("listInventoryAtLocation joins items + computes isLowStock per row", () => {
    expect(src).toMatch(/async function listInventoryAtLocation/);
    expect(src).toMatch(/\.innerJoin\(items,\s*eq\(inventoryQuantities\.itemId,\s*items\.id\)\)/);
    expect(src).toMatch(
      /isLowStock\s*=\s*[\s\S]+?Number\(availableQuantity\) <= Number\(r\.minimumQuantity\)/,
    );
  });

  it("listTransactionsForLocation matches transactions where the location is EITHER source or destination", () => {
    expect(src).toMatch(/async function listTransactionsForLocation/);
    // OR-predicate over from/to.
    expect(src).toMatch(
      /or\(\s*eq\(inventoryTransactions\.fromLocationId,\s*locationId\),\s*eq\(inventoryTransactions\.toLocationId,\s*locationId\)/,
    );
  });

  it("archiveLocation soft-disables (sets isActive=false) — does NOT hard-delete", () => {
    expect(src).toMatch(/async function archiveLocation[\s\S]+?updateLocation\(companyId, id, \{ isActive: false \}\)/);
    // Inverse pin: no `db.delete(inventoryLocations)` anywhere.
    expect(src).not.toMatch(/db\s*\.\s*delete\(inventoryLocations\)/);
  });

  it("listLowStock filters on `available <= minimum_quantity` (NOT on_hand <= reorder_point)", () => {
    // Phase 2 brief: the filter is `(on_hand - reserved) <= minimum`.
    // Pin both halves of the new SQL predicate.
    expect(src).toMatch(/\$\{inventoryQuantities\.minimumQuantity\}\s*IS NOT NULL/);
    expect(src).toMatch(
      /\(\$\{inventoryQuantities\.onHandQuantity\}\s*-\s*\$\{inventoryQuantities\.reservedQuantity\}\)\s*<=\s*\$\{inventoryQuantities\.minimumQuantity\}/,
    );
    // Inverse pin: the prior reorder-point-based filter must not return.
    expect(src).not.toMatch(
      /\$\{inventoryQuantities\.reorderPoint\}\s*IS NOT NULL[\s\S]+?<=\s*\$\{inventoryQuantities\.reorderPoint\}/,
    );
  });

  it("listLowStock derives suggestedReplenishment as max(0, target − available)", () => {
    // Target prefers reorder_point when set, falls back to minimum.
    expect(src).toMatch(/const target = r\.reorderPoint \?\? r\.minimumQuantity \?\? "0"/);
    expect(src).toMatch(/const diff = Number\(target\) - Number\(availableQuantity\)/);
    expect(src).toMatch(/diff > 0 \?[\s\S]+?:\s*"0"/);
  });

  it("repository exposes the new Phase-2 helpers", () => {
    expect(src).toMatch(/listWithAggregates: listLocationsWithAggregates/);
    expect(src).toMatch(/archive: archiveLocation/);
    expect(src).toMatch(/listInventoryAtLocation/);
    expect(src).toMatch(/listForLocation: listTransactionsForLocation/);
  });
});

// ── 2. Routes: Phase-2 endpoints + gates ────────────────────────────

describe("server/routes/inventory.ts — Phase-2 endpoints", () => {
  const src = read(ROUTE_PATH);

  it("GET /locations returns the enriched (listWithAggregates) shape", () => {
    expect(src).toMatch(
      /router\.get\(\s*"\/locations",[\s\S]+?inventoryLocationsRepository\.listWithAggregates/,
    );
  });

  it("registers GET /locations/:id and gates on inventory.view", () => {
    expect(src).toMatch(
      /router\.get\(\s*"\/locations\/:id",[\s\S]+?requirePermission\("inventory\.view"\)/,
    );
  });

  it("registers GET /locations/:id/inventory + /locations/:id/transactions (read-gated)", () => {
    expect(src).toMatch(
      /router\.get\(\s*"\/locations\/:id\/inventory",[\s\S]+?requirePermission\("inventory\.view"\)[\s\S]+?listInventoryAtLocation/,
    );
    expect(src).toMatch(
      /router\.get\(\s*"\/locations\/:id\/transactions",[\s\S]+?requirePermission\("inventory\.view"\)[\s\S]+?listForLocation/,
    );
  });

  it("registers POST /locations/:id/archive and gates on inventory.manage", () => {
    expect(src).toMatch(
      /router\.post\(\s*"\/locations\/:id\/archive",[\s\S]+?requirePermission\("inventory\.manage"\)[\s\S]+?inventoryLocationsRepository\.archive/,
    );
  });
});

// ── 3. Wire types include Phase-2 shapes ────────────────────────────

describe("client/src/lib/inventory/types.ts — Phase-2 shapes", () => {
  const src = read(TYPES_PATH);

  it("declares LocationWithAggregates with itemCount + totalQuantity + lowStockCount", () => {
    expect(src).toMatch(
      /export interface LocationWithAggregates extends LocationListRow \{\s*itemCount: number;\s*totalQuantity: string;\s*lowStockCount: number;/,
    );
  });

  it("declares LocationItemStock with the item-side display fields + isLowStock", () => {
    expect(src).toMatch(
      /export interface LocationItemStock \{[\s\S]+?itemName: string \| null;[\s\S]+?itemSku: string \| null;[\s\S]+?itemModel: string \| null;[\s\S]+?isLowStock: boolean;/,
    );
  });

  it("LowStockRow now carries suggestedReplenishment", () => {
    expect(src).toMatch(/suggestedReplenishment: string;/);
  });
});

// ── 4. Inventory status badges canonicalize via StatusChip ──────────

describe("InventoryStatusBadges — canonical chip primitives", () => {
  const src = read(BADGES_PATH);

  it("composes the canonical StatusChip — no parallel pill implementations", () => {
    expect(src).toMatch(/from "@\/components\/ui\/chip"/);
    expect(src).toMatch(/import \{ StatusChip \}/);
    // Inverse pin: no inline `rounded-full px-1.5 py-0.5` ad-hoc spans.
    expect(src).not.toMatch(/className="[^"]*rounded-full[^"]*px-1\.5[^"]*py-0\.5/);
  });

  it("exports ItemActiveBadge, ItemStockBadge, LocationTypeBadge, StockStatusBadge", () => {
    expect(src).toMatch(/export function ItemActiveBadge/);
    expect(src).toMatch(/export function ItemStockBadge/);
    expect(src).toMatch(/export function LocationTypeBadge/);
    expect(src).toMatch(/export function StockStatusBadge/);
  });

  it("ItemStockBadge maps the canonical 5-status vocabulary", () => {
    // Service / Stock Item / Non-Stock / Low Stock / Out of Stock.
    // Labels live as JSX children inside <StatusChip> blocks; allow
    // whitespace / newlines between the literal and the closing tag.
    expect(src).toMatch(/Service\s*<\/StatusChip>/);
    expect(src).toMatch(/Stock Item\s*<\/StatusChip>/);
    expect(src).toMatch(/Non-Stock\s*<\/StatusChip>/);
    expect(src).toMatch(/Low Stock\s*<\/StatusChip>/);
    expect(src).toMatch(/Out of Stock\s*<\/StatusChip>/);
  });

  it("LocationTypeBadge declares the canonical (label, tone) map", () => {
    expect(src).toMatch(/LOCATION_TYPE_LABELS:\s*Record<string,\s*string>/);
    expect(src).toMatch(/LOCATION_TYPE_TONES:\s*Record<string,\s*ChipTone>/);
    // All 6 canonical types covered.
    for (const t of ["warehouse", "vehicle", "office", "storage", "temporary", "other"]) {
      expect(src).toContain(`${t}:`);
    }
  });
});

// ── 5. InventoryPage uses canonical badges, NOT inline pills ────────

describe("InventoryPage — canonicalization sweep", () => {
  const src = read(PAGE_PATH);

  it("imports the canonical badge components instead of inlining pills", () => {
    expect(src).toMatch(
      /from "@\/components\/inventory\/InventoryStatusBadges"/,
    );
    expect(src).toMatch(/ItemActiveBadge/);
    expect(src).toMatch(/ItemStockBadge/);
    expect(src).toMatch(/LocationTypeBadge/);
  });

  it("does NOT emit ad-hoc rounded-full px-1.5 py-0.5 status pills", () => {
    // Allow text-helper rounded-full chip-shaped use only via the
    // canonical chip primitive. The page itself must not roll its own.
    expect(src).not.toMatch(
      /className="[^"]*inline-flex[^"]*rounded-full[^"]*px-1\.5[^"]*py-0\.5[^"]*"[^>]*>[\s\S]+?(Active|Inactive|Stock Item|Non-Stock)/,
    );
  });

  it("uses canonical FilterChip + Search input for filter bars", () => {
    expect(src).toMatch(/import \{ FilterChip[\s\S]+?\} from "@\/components\/ui\/chip"/);
    expect(src).toMatch(/data-testid="inventory-items-search"/);
    expect(src).toMatch(/data-testid="inventory-locations-search"/);
    expect(src).toMatch(/data-testid="inventory-items-filter-type-product"/);
    expect(src).toMatch(/data-testid="inventory-locations-filter-active"/);
  });
});

// ── 6. Locations tab — summary cards, columns, row click, dropdown ──

describe("Locations tab — Phase-2 upgrades", () => {
  const src = read(PAGE_PATH);

  it("renders the 5-card summary strip (Total / Vehicles / Warehouses / Low Stock / Total Qty)", () => {
    // The wrapping div carries data-testid; per-card testids are
    // passed via the SummaryCard `testId` prop (which the component
    // forwards to data-testid at render).
    expect(src).toMatch(/data-testid="inventory-locations-summary"/);
    expect(src).toMatch(/testId="inventory-summary-total"/);
    expect(src).toMatch(/testId="inventory-summary-vehicles"/);
    expect(src).toMatch(/testId="inventory-summary-warehouses"/);
    expect(src).toMatch(/testId="inventory-summary-low-stock"/);
    expect(src).toMatch(/testId="inventory-summary-total-qty"/);
  });

  it("declares the new columns (Assigned User, Items, Total Qty, Status)", () => {
    expect(src).toMatch(/header:\s*"Assigned User"/);
    expect(src).toMatch(/header:\s*<span>Items<\/span>/);
    expect(src).toMatch(/header:\s*<span>Total Qty<\/span>/);
    // Per-row testids the rail / table both consume.
    expect(src).toMatch(/`inventory-location-itemcount-\$\{loc\.id\}`/);
    expect(src).toMatch(/`inventory-location-totalqty-\$\{loc\.id\}`/);
  });

  it("clicking a location row toggles the location rail", () => {
    expect(src).toMatch(
      /onRowClick=\{\(loc\) =>[\s\S]+?loc\.id === selectedLocationId[\s\S]+?onCloseLocationRail\(\)[\s\S]+?onSelectLocation\(loc\.id\)/,
    );
  });

  it("renders DropdownMenu row actions (View / Edit / Archive)", () => {
    expect(src).toMatch(/import \{[\s\S]+?DropdownMenu,/);
    expect(src).toMatch(/`inventory-location-actions-\$\{loc\.id\}`/);
    // Archive only renders when the location is currently active.
    expect(src).toMatch(/loc\.isActive && \(\s*<DropdownMenuItem[\s\S]+?Archive/);
  });

  it("archive action POSTs to the canonical /locations/:id/archive endpoint + invalidates the locations query", () => {
    expect(src).toMatch(
      /apiRequest\(`\/api\/inventory\/locations\/\$\{locationId\}\/archive`,\s*\{\s*method:\s*"POST"/,
    );
    expect(src).toMatch(/queryClient\.invalidateQueries\(\{\s*queryKey:\s*\["\/api\/inventory\/locations"\]/);
  });

  it("low-stock count column renders an amber StatusChip when > 0", () => {
    expect(src).toMatch(
      /loc\.lowStockCount > 0 && \(\s*<StatusChip[\s\S]+?tone="warning"[\s\S]+?lowStockCount\}\s*low/,
    );
  });
});

// ── 7. Mutually-exclusive item/location rail state ──────────────────

describe("InventoryPage — rails are mutually exclusive", () => {
  const src = read(PAGE_PATH);

  it("openItemRail clears selectedLocationId before setting selectedItemId", () => {
    expect(src).toMatch(
      /function openItemRail\(itemId: string\) \{\s*setSelectedLocationId\(null\); \/\/ mutually exclusive\s*setSelectedItemId\(itemId\);/,
    );
  });

  it("openLocationRail clears selectedItemId before setting selectedLocationId", () => {
    expect(src).toMatch(
      /function openLocationRail\(locationId: string\) \{\s*setSelectedItemId\(null\); \/\/ mutually exclusive\s*setSelectedLocationId\(locationId\);/,
    );
  });
});

// ── 8. Item Rail — keyboard ESC + ArrowUp/Down + prev/next buttons ──

describe("InventoryItemRail — Phase-2 enhancements", () => {
  const src = read(ITEM_RAIL_PATH);

  it("declares onSelectPrev / onSelectNext optional props", () => {
    expect(src).toMatch(/onSelectPrev\?:\s*\(\)\s*=>\s*void/);
    expect(src).toMatch(/onSelectNext\?:\s*\(\)\s*=>\s*void/);
  });

  it("registers a keyboard handler that closes on Escape and navigates on ArrowUp/ArrowDown", () => {
    expect(src).toMatch(/document\.addEventListener\("keydown"/);
    expect(src).toMatch(/if \(e\.key === "Escape"\)/);
    expect(src).toMatch(/if \(e\.key === "ArrowUp" && onSelectPrev\)/);
    expect(src).toMatch(/if \(e\.key === "ArrowDown" && onSelectNext\)/);
  });

  it("the keydown handler ignores key events fired inside form fields", () => {
    // The shortcut must NOT hijack typing in an Input / Textarea /
    // Select / contentEditable surface.
    expect(src).toMatch(/tag === "input"[\s\S]+?tag === "textarea"[\s\S]+?tag === "select"[\s\S]+?isContentEditable/);
  });

  it("renders prev/next nav buttons in the rail header (with disabled state when neighbour is null)", () => {
    expect(src).toMatch(/data-testid="inventory-rail-nav-prev"/);
    expect(src).toMatch(/data-testid="inventory-rail-nav-next"/);
    expect(src).toMatch(/disabled=\{!onSelectPrev\}/);
    expect(src).toMatch(/disabled=\{!onSelectNext\}/);
  });

  it("uses canonical badge components in the identity strip (not inline pills)", () => {
    expect(src).toMatch(/import[\s\S]+?ItemActiveBadge[\s\S]+?from "\.\/InventoryStatusBadges"/);
    expect(src).toMatch(/<ItemActiveBadge active=\{item\.isActive \?\? true\}/);
  });
});

// ── 9. InventoryPage wires prev/next using the FILTERED list ────────

describe("InventoryPage — prev/next uses the filtered list", () => {
  const src = read(PAGE_PATH);

  it("walks filteredItems (not items) so prev/next respects the active filter/search", () => {
    expect(src).toMatch(/const selectedIdx = filteredItems\.findIndex/);
    expect(src).toMatch(/prevItem = selectedIdx > 0 \? filteredItems\[selectedIdx - 1\] : null/);
    expect(src).toMatch(/nextItem =[\s\S]+?selectedIdx < filteredItems\.length - 1[\s\S]+?filteredItems\[selectedIdx \+ 1\]/);
  });

  it("threads onSelectPrev / onSelectNext into InventoryItemRail (or undefined when at edges)", () => {
    expect(src).toMatch(/onSelectPrev=\{prevItem \? \(\) => onSelectItem\(prevItem\.id\) : undefined\}/);
    expect(src).toMatch(/onSelectNext=\{nextItem \? \(\) => onSelectItem\(nextItem\.id\) : undefined\}/);
  });
});

// ── 10. Location Rail (4 tabs) ──────────────────────────────────────

describe("InventoryLocationRail — canonical right-rail consumer", () => {
  const src = read(LOC_RAIL_PATH);

  it("composes the canonical <DetailRightRail testIdPrefix=\"inventory-loc-side\">", () => {
    expect(src).toMatch(/from "@\/components\/detail-rail\/DetailRightRail"/);
    expect(src).toMatch(/<DetailRightRail[\s\S]+?testIdPrefix="inventory-loc-side"/);
  });

  it("declares the four canonical tabs (overview / inventory / transfers / activity)", () => {
    expect(src).toMatch(/id:\s*"overview"/);
    expect(src).toMatch(/id:\s*"inventory"/);
    expect(src).toMatch(/id:\s*"transfers"/);
    expect(src).toMatch(/id:\s*"activity"/);
  });

  it("Inventory tab cross-navigates to the item rail via onSelectItem(itemId)", () => {
    expect(src).toMatch(/onSelectItem:\s*\(itemId: string\)\s*=>\s*void/);
    expect(src).toMatch(/onClick=\{\(\)\s*=>\s*onSelectItem\(r\.itemId\)\}/);
  });

  it("Inventory tab rows expose Transfer + Adjust + View Item actions per row", () => {
    expect(src).toMatch(/`inventory-loc-rail-item-transfer-\$\{r\.itemId\}`/);
    expect(src).toMatch(/`inventory-loc-rail-item-adjust-\$\{r\.itemId\}`/);
    expect(src).toMatch(/`inventory-loc-rail-item-view-\$\{r\.itemId\}`/);
  });

  it("Transfers tab filters the same transactions feed by transactionType=transfer (single fetch)", () => {
    expect(src).toMatch(
      /allTx\.filter\(\(t\)\s*=>\s*t\.transactionType === "transfer"\)/,
    );
    // Single useQuery — both Transfers + Activity tabs share it.
    const useQueryCalls = src.match(/useQuery</g) ?? [];
    expect(useQueryCalls.length).toBe(2); // one for inventory, one for transactions
  });

  it("uses canonical badges (LocationTypeBadge + ItemActiveBadge + StockStatusBadge)", () => {
    expect(src).toMatch(/LocationTypeBadge/);
    expect(src).toMatch(/ItemActiveBadge/);
    expect(src).toMatch(/StockStatusBadge/);
  });

  it("closing the rail (onActiveTabChange null) bubbles to the page-level onClose", () => {
    expect(src).toMatch(/if \(id === null\)\s*\{[\s\S]+?onClose\(\)/);
  });
});

// ── 11. Modal prefill plumbing ──────────────────────────────────────

describe("Transfer + Adjust modals — Phase-2 contextual prefill", () => {
  const transferSrc = read(TRANSFER_PATH);
  const adjustSrc = read(ADJUST_PATH);

  it("TransferStockModal accepts prefillFromLocationId / prefillToLocationId props", () => {
    expect(transferSrc).toMatch(/prefillFromLocationId\?:\s*string \| null/);
    expect(transferSrc).toMatch(/prefillToLocationId\?:\s*string \| null/);
  });

  it("TransferStockModal applies prefill on open + resets on close", () => {
    expect(transferSrc).toMatch(
      /useEffect\(\(\)\s*=>\s*\{[\s\S]+?setFromLocationId\(prefillFromLocationId \?\? ""\)[\s\S]+?setToLocationId\(prefillToLocationId \?\? ""\)/,
    );
    expect(transferSrc).toMatch(
      /\}, \[open, prefillFromLocationId, prefillToLocationId\]\);/,
    );
  });

  it("AdjustStockModal accepts prefillLocationId + applies it on open", () => {
    expect(adjustSrc).toMatch(/prefillLocationId\?:\s*string \| null/);
    expect(adjustSrc).toMatch(/setLocationId\(prefillLocationId \?\? ""\)/);
    expect(adjustSrc).toMatch(/\}, \[open, prefillLocationId\]\);/);
  });

  it("InventoryPage threads prefill state through to both modals", () => {
    const src = read(PAGE_PATH);
    expect(src).toMatch(/transferPrefillFromLocId/);
    expect(src).toMatch(/adjustPrefillLocId/);
    expect(src).toMatch(
      /<TransferStockModal\b[\s\S]+?prefillFromLocationId=\{transferPrefillFromLocId\}/,
    );
    expect(src).toMatch(
      /<AdjustStockModal\b[\s\S]+?prefillLocationId=\{adjustPrefillLocId\}/,
    );
  });

  it("Transfer flow STILL prevents same-location selection (Phase-1 invariant preserved)", () => {
    expect(transferSrc).toMatch(
      /<SelectItem[\s\S]+?disabled=\{!l\.isActive \|\| l\.id === fromLocationId\}/,
    );
  });

  it("Transfer flow STILL prevents over-transferring source on-hand (Phase-1 invariant preserved)", () => {
    expect(transferSrc).toMatch(/qty > fromOnHand/);
    expect(transferSrc).toMatch(/Source location only has \$\{fromOnHand\} on hand/);
  });

  it("Adjust flow STILL converts direction + quantity into a signed deltaQuantity (Phase-1 invariant preserved)", () => {
    expect(adjustSrc).toMatch(/const signed = direction === "in" \? qty : -qty/);
    expect(adjustSrc).toMatch(/deltaQuantity:\s*String\(signed\)/);
  });
});

// ── 12. Filtering / search behavior ─────────────────────────────────

describe("InventoryPage — search + filter logic", () => {
  const src = read(PAGE_PATH);

  it("Items search matches name / sku / model / category (case-insensitive)", () => {
    expect(src).toMatch(/const haystack =\s*\[[\s\S]+?it\.name[\s\S]+?it\.sku[\s\S]+?it\.model[\s\S]+?it\.category/);
    expect(src).toMatch(/\.toLowerCase\(\)/);
  });

  it("Locations search matches name / assigned user / address / city / notes", () => {
    expect(src).toMatch(
      /const haystack =\s*\[[\s\S]+?loc\.name[\s\S]+?loc\.assignedUserName[\s\S]+?loc\.address[\s\S]+?loc\.city[\s\S]+?loc\.notes/,
    );
  });

  it("Locations active filter defaults to 'active' (archived rows hidden by default)", () => {
    expect(src).toMatch(
      /useState<LocationActiveFilter>\("active"\)/,
    );
  });
});

// ── 13. Low Stock tab — Phase-2 columns ─────────────────────────────

describe("Low Stock tab — Phase-2 columns + Suggested Replenishment", () => {
  const src = read(PAGE_PATH);

  it("renders Available / Minimum / Reorder At / Suggested columns", () => {
    expect(src).toMatch(/header:\s*<span>Available<\/span>/);
    expect(src).toMatch(/header:\s*<span>Minimum<\/span>/);
    expect(src).toMatch(/header:\s*<span>Reorder At<\/span>/);
    expect(src).toMatch(/header:\s*<span>Suggested<\/span>/);
  });

  it("Suggested cell consumes the server-derived suggestedReplenishment field", () => {
    expect(src).toMatch(/`inventory-low-stock-suggested-\$\{r\.id\}`/);
    expect(src).toMatch(/r\.suggestedReplenishment/);
  });

  it("empty-state copy reflects the Phase-2 rule (available <= minimum)", () => {
    expect(src).toMatch(
      /Items appear here when their available quantity \(on-hand minus reserved\) drops to or below the configured minimum\./,
    );
  });
});
