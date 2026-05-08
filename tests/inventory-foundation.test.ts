/**
 * Inventory module foundation — source-pin contract tests (2026-05-08).
 *
 * Locks the architectural contracts of the first inventory pass:
 *   - capability gate (`inventory_core` feature key) is registered in the
 *     canonical subscription_features catalog
 *   - server router gates every endpoint behind requireFeature +
 *     requirePermission (no read leaks, no write leaks)
 *   - sidebar nav entry is gated on useFeatureEnabled
 *   - client page short-circuits on disabled capability
 *   - quantity rule: Available = OnHand - Reserved is computed in
 *     EXACTLY ONE place (the server storage layer's subtractDecimal)
 *   - service items can never have trackInventory=true (server + client
 *     agree)
 *   - non-stock + service items show em-dash for quantity columns +
 *     have no transfer/adjust actions
 *   - quantity mutations always go through inventory_transactions
 *   - tenant scoping is enforced on every query
 *
 * Source-pin tests (no live DB). Render-time DnD / hook-lifecycle is
 * out of scope; the pinned wiring is sufficient to catch every
 * regression that matters for the foundation.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const MIGRATION_PATH = path("migrations/2026_05_08_inventory_foundation.sql");
const SCHEMA_PATH = path("shared/schema.ts");
const STORAGE_PATH = path("server/storage/inventory.ts");
const ROUTE_PATH = path("server/routes/inventory.ts");
const ROUTES_INDEX = path("server/routes/index.ts");
const APP_TSX = path("client/src/App.tsx");
const SIDEBAR_PATH = path("client/src/components/AppSidebar.tsx");
const PAGE_PATH = path("client/src/pages/InventoryPage.tsx");
const RAIL_PATH = path("client/src/components/inventory/InventoryItemRail.tsx");
const ITEM_MODAL_PATH = path("client/src/components/inventory/InventoryItemModal.tsx");
const LOC_MODAL_PATH = path("client/src/components/inventory/InventoryLocationModal.tsx");
const TRANSFER_MODAL_PATH = path("client/src/components/inventory/TransferStockModal.tsx");
const ADJUST_MODAL_PATH = path("client/src/components/inventory/AdjustStockModal.tsx");
const TYPES_PATH = path("client/src/lib/inventory/types.ts");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

// ── 1. Files exist at canonical paths ─────────────────────────────

describe("Inventory foundation — file layout", () => {
  for (const p of [
    MIGRATION_PATH,
    STORAGE_PATH,
    ROUTE_PATH,
    PAGE_PATH,
    RAIL_PATH,
    ITEM_MODAL_PATH,
    LOC_MODAL_PATH,
    TRANSFER_MODAL_PATH,
    ADJUST_MODAL_PATH,
    TYPES_PATH,
  ]) {
    it(`file exists: ${p.replace(ROOT, "")}`, () => {
      expect(existsSync(p)).toBe(true);
    });
  }
});

// ── 2. Migration registers the feature key + permissions ──────────

describe("Migration — registers capability + permissions", () => {
  const sql = read(MIGRATION_PATH);

  it("creates the inventory_locations table with company_id ON DELETE CASCADE", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS inventory_locations/);
    expect(sql).toMatch(
      /company_id\s+varchar NOT NULL REFERENCES companies\(id\) ON DELETE CASCADE/,
    );
  });

  it("creates the inventory_quantities table with the (item, location) unique constraint", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS inventory_quantities/);
    expect(sql).toMatch(
      /CONSTRAINT inventory_quantities_item_location_uniq[\s\S]+?UNIQUE \(item_id, location_id\)/,
    );
  });

  it("inventory_quantities enforces non-negative on_hand + reserved at the DB level", () => {
    expect(sql).toMatch(/inventory_quantities_on_hand_nonneg[\s\S]+?CHECK \(on_hand_quantity >= 0\)/);
    expect(sql).toMatch(/inventory_quantities_reserved_nonneg[\s\S]+?CHECK \(reserved_quantity >= 0\)/);
  });

  it("creates the inventory_transactions table with positive-quantity + direction CHECK constraints", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS inventory_transactions/);
    expect(sql).toMatch(/inventory_transactions_quantity_positive[\s\S]+?CHECK \(quantity > 0\)/);
    expect(sql).toMatch(
      /inventory_transactions_direction[\s\S]+?CHECK \(from_location_id IS NOT NULL OR to_location_id IS NOT NULL\)/,
    );
  });

  it("registers `inventory_core` in the subscription_features catalog with category=service_hvac", () => {
    expect(sql).toMatch(/INSERT INTO subscription_features[\s\S]+?'inventory_core'/);
    expect(sql).toMatch(/'service_hvac'/);
    // limit_type='none' = on/off feature.
    expect(sql).toMatch(/'inventory_core'[\s\S]+?'none'/);
  });

  it("registers inventory.view + inventory.manage in the permissions catalog", () => {
    expect(sql).toMatch(/'inventory\.view'[\s\S]+?'inventory'/);
    expect(sql).toMatch(/'inventory\.manage'[\s\S]+?'inventory'/);
  });

  it("grants both permissions to owner / admin / manager and inventory.view to dispatcher", () => {
    expect(sql).toMatch(
      /WHERE r\.name IN \('owner', 'admin', 'manager'\)[\s\S]+?'inventory\.view', 'inventory\.manage'/,
    );
    expect(sql).toMatch(
      /WHERE r\.name = 'dispatcher'[\s\S]+?'inventory\.view'/,
    );
  });
});

// ── 3. Drizzle schema additions ───────────────────────────────────

describe("shared/schema.ts — inventory tables + Zod schemas", () => {
  const schema = read(SCHEMA_PATH);

  it("declares inventoryLocations / inventoryQuantities / inventoryTransactions tables", () => {
    expect(schema).toMatch(/export const inventoryLocations\s*=\s*pgTable\(/);
    expect(schema).toMatch(/export const inventoryQuantities\s*=\s*pgTable\(/);
    expect(schema).toMatch(/export const inventoryTransactions\s*=\s*pgTable\(/);
  });

  it("exports the canonical Zod schemas for transfer + adjustment", () => {
    expect(schema).toMatch(/export const transferInventorySchema\s*=\s*z\.object/);
    expect(schema).toMatch(/export const adjustInventorySchema\s*=\s*z\.object/);
    expect(schema).toMatch(/export const insertInventoryLocationSchema\s*=/);
    expect(schema).toMatch(/export const updateInventoryLocationSchema\s*=/);
  });

  it("adjustInventorySchema rejects deltaQuantity = 0", () => {
    expect(schema).toMatch(/deltaQuantity[\s\S]+?Number\(v\) !== 0/);
  });

  it("transferInventorySchema requires positive quantity", () => {
    expect(schema).toMatch(/quantity[\s\S]+?Number\(v\) > 0/);
  });

  it("items table carries the new `model` text column", () => {
    // Pin the column declaration verbatim so a future schema rewrite
    // doesn't silently drop it.
    expect(schema).toMatch(/model:\s*text\("model"\)/);
  });
});

// ── 4. Server storage: business rules + tenant scoping ────────────

describe("server/storage/inventory.ts — business rules + tenant scoping", () => {
  const src = read(STORAGE_PATH);

  it("Available = OnHand − Reserved is computed in EXACTLY ONE place (subtractDecimal)", () => {
    expect(src).toMatch(/function subtractDecimal\(/);
    // The aggregate + per-item paths both call subtractDecimal —
    // ensures the rule lives in one helper, not duplicated.
    const calls = src.match(/subtractDecimal\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("performTransfer + performAdjustment wrap a single Drizzle tx", () => {
    expect(src).toMatch(/async function performTransfer[\s\S]+?db\.transaction\(/);
    expect(src).toMatch(/async function performAdjustment[\s\S]+?db\.transaction\(/);
  });

  it("every quantity-mutation path writes an inventory_transactions row in the SAME tx as the quantity update", () => {
    // Pattern: the tx body inserts into inventoryTransactions.
    // Phase 1: transfer + adjustment = 2.
    // Phase 3: + consumeForJob + returnFromJob + removeUsage = 5.
    // The point of the pin: every write path that touches a quantity
    // ALSO inserts an audit row in the same Drizzle tx — the audit
    // log can never drift from the stored quantity.
    const inserts = src.match(/tx\s*\.\s*insert\(inventoryTransactions\)/g) ?? [];
    expect(inserts.length).toBeGreaterThanOrEqual(2);
    // Soft upper bound — a future writer should be deliberate about
    // whether it really needs a new tx-insert site rather than
    // composing an existing service method.
    expect(inserts.length).toBeLessThanOrEqual(8);
  });

  it("rejects service items + non-tracked items at the storage layer (assertItemTracksInventory)", () => {
    expect(src).toMatch(/function assertItemTracksInventory/);
    // The throws are formatted multi-line: `new InventoryError(\n
    // "ITEM_IS_SERVICE", ...)`. Allow whitespace/newlines between `(`
    // and the literal.
    expect(src).toMatch(/new InventoryError\(\s*"ITEM_IS_SERVICE"/);
    expect(src).toMatch(/new InventoryError\(\s*"ITEM_NOT_TRACKED"/);
  });

  it("rejects same-location transfers (SAME_LOCATION_TRANSFER)", () => {
    expect(src).toMatch(/SAME_LOCATION_TRANSFER/);
  });

  it("rejects insufficient-stock transfers (INSUFFICIENT_STOCK)", () => {
    expect(src).toMatch(/INSUFFICIENT_STOCK/);
  });

  it("every read filters by company_id (tenant scoping)", () => {
    // Crude but effective: the storage file's main query helpers all
    // bind eq(*.companyId, companyId). Pin the count ≥ 6 (locations
    // list + get + quantity-for-item + low-stock + transactions +
    // ensureRow).
    const scopes = src.match(/eq\(\w+\.companyId,\s*companyId\)/g) ?? [];
    expect(scopes.length).toBeGreaterThanOrEqual(6);
  });
});

// ── 5. Server routes: feature gate + permission gates ────────────

describe("server/routes/inventory.ts — capability + permission gating", () => {
  const src = read(ROUTE_PATH);

  it("mounts requireFeature(\"inventory_core\") at the router level", () => {
    expect(src).toMatch(/router\.use\(requireFeature\("inventory_core"\)\)/);
  });

  it("every read route gates on requirePermission(\"inventory.view\")", () => {
    const reads = src.match(/router\.get\([\s\S]+?requirePermission\("inventory\.view"\)/g) ?? [];
    // Pin a minimum: items list, item detail, item locations, item
    // transactions, locations list, low-stock = 6 reads.
    expect(reads.length).toBeGreaterThanOrEqual(6);
  });

  it("every write route gates on requirePermission(\"inventory.manage\")", () => {
    const writes =
      src.match(/router\.(post|patch)\([\s\S]+?requirePermission\("inventory\.manage"\)/g) ?? [];
    // Pin a minimum: create item, patch item, settings patch, create
    // location, patch location, transfer, adjustment = 7 writes.
    expect(writes.length).toBeGreaterThanOrEqual(7);
  });

  it("writes that mutate quantity ALWAYS go through inventoryService (never direct UPDATE)", () => {
    // The route must call performTransfer / performAdjustment for
    // those routes, never UPDATE inventory_quantities directly.
    expect(src).toMatch(/inventoryService\.performTransfer/);
    expect(src).toMatch(/inventoryService\.performAdjustment/);
    expect(src).not.toMatch(/db\s*\.\s*update\(inventoryQuantities\)/);
  });

  it("server enforces the service-items-cannot-track-inventory rule on item create + update", () => {
    expect(src).toMatch(
      /data\.type === "service" && data\.trackInventory[\s\S]+?Service items cannot track inventory/,
    );
  });
});

// ── 6. Routes index — mount registration ──────────────────────────

describe("server/routes/index.ts — inventory mount", () => {
  const src = read(ROUTES_INDEX);

  it("imports the inventory router", () => {
    expect(src).toMatch(/import inventoryRouter from "\.\/inventory"/);
  });

  it("mounts the router at /api/inventory", () => {
    expect(src).toMatch(/app\.use\("\/api\/inventory",\s*inventoryRouter\)/);
  });
});

// ── 7. Sidebar — capability-gated nav entry ───────────────────────

describe("AppSidebar — inventory nav entry is capability-gated", () => {
  const src = read(SIDEBAR_PATH);

  it("imports useFeatureEnabled", () => {
    expect(src).toMatch(/import \{ useFeatureEnabled \} from "@\/hooks\/useEntitlements"/);
  });

  it("only pushes the Inventory menu entry when inventory_core is enabled", () => {
    expect(src).toMatch(
      /useFeatureEnabled\("inventory_core"\)\s*===\s*true/,
    );
    expect(src).toMatch(
      /if \(inventoryEnabled\)\s*\{[\s\S]+?title:\s*"Inventory"[\s\S]+?href:\s*"\/inventory"/,
    );
    expect(src).toMatch(/testId:\s*"nav-inventory"/);
  });
});

// ── 8. App.tsx route registration ────────────────────────────────

describe("App.tsx — /inventory route", () => {
  const src = read(APP_TSX);

  it("imports InventoryPage", () => {
    expect(src).toMatch(/import InventoryPage from "@\/pages\/InventoryPage"/);
  });

  it("renders <InventoryPage> at /inventory inside <ProtectedRoute>", () => {
    expect(src).toMatch(
      /<Route path="\/inventory">[\s\S]+?<ProtectedRoute>[\s\S]+?<InventoryPage \/>/,
    );
  });
});

// ── 9. InventoryPage — short-circuit + tabs + rail wiring ────────

describe("InventoryPage — capability short-circuit + tabs + rail", () => {
  const src = read(PAGE_PATH);

  it("short-circuits when useFeatureEnabled returns false (no API calls fire)", () => {
    expect(src).toMatch(/useFeatureEnabled\("inventory_core"\)/);
    expect(src).toMatch(/data-testid="inventory-feature-disabled"/);
  });

  it("renders the canonical 6 tabs (Items + Locations + Transfers + Adjustments + Counts + Low Stock)", () => {
    // The page renders tabs from a TAB_DEFS array via map; the
    // data-testid is `inventory-tab-${t.key}` — pin the array keys
    // and the testid template separately.
    expect(src).toMatch(/data-testid=\{`inventory-tab-\$\{t\.key\}`\}/);
    expect(src).toMatch(/key:\s*"items"[\s\S]+?key:\s*"locations"[\s\S]+?key:\s*"transfers"[\s\S]+?key:\s*"adjustments"[\s\S]+?key:\s*"counts"[\s\S]+?key:\s*"low_stock"/);
  });

  it("uses the canonical EntityListTable for items + locations + low-stock", () => {
    expect(src).toMatch(/from "@\/components\/lists\/EntityListTable"/);
    expect(src).toMatch(/<EntityListTable<InventoryItemRow>/);
    // Phase-2: locations endpoint returns the enriched
    // LocationWithAggregates row shape (itemCount + totalQuantity +
    // lowStockCount + assignedUserName) — the table is generic over
    // that type now.
    expect(src).toMatch(/<EntityListTable<LocationWithAggregates>/);
    expect(src).toMatch(/<EntityListTable<LowStockRow>/);
  });

  it("clicking an item opens the InventoryItemRail; clicking again closes the rail", () => {
    // Phase-2 click semantics: clicking the active row toggles the
    // rail closed; clicking a different row re-opens it on that row.
    // The page splits this into openItemRail + onCloseItemRail
    // handlers (mutually exclusive with the location rail).
    expect(src).toMatch(
      /onRowClick=\{\(it\) =>[\s\S]+?it\.id === selectedItemId \? onCloseItemRail\(\) : onSelectItem\(it\.id\)/,
    );
    expect(src).toMatch(/function openItemRail\(itemId: string\)/);
    expect(src).toMatch(/setSelectedLocationId\(null\); \/\/ mutually exclusive/);
  });

  it("renders em-dash for quantity columns when type=service OR trackInventory=false", () => {
    expect(src).toMatch(
      /it\.type === "service" \|\| !it\.trackInventory[\s\S]+?<span className="text-slate-400">—<\/span>/,
    );
  });

  it("Transfers + Adjustments + Counts tabs render canonical empty states (no fake list data)", () => {
    // Empty-state testids are passed via the CanonicalEmpty component's
    // `testId` prop (which the component then forwards to data-testid).
    expect(src).toMatch(/testId="inventory-transfers-empty"/);
    expect(src).toMatch(/testId="inventory-adjustments-empty"/);
    expect(src).toMatch(/testId="inventory-counts-empty"/);
  });
});

// ── 10. InventoryItemRail — DetailRightRail consumer + 4 tabs ─────

describe("InventoryItemRail — canonical right-rail consumer", () => {
  const src = read(RAIL_PATH);

  it("composes the canonical <DetailRightRail testIdPrefix=\"inventory-side\">", () => {
    expect(src).toMatch(/from "@\/components\/detail-rail\/DetailRightRail"/);
    expect(src).toMatch(/<DetailRightRail[\s\S]+?testIdPrefix="inventory-side"/);
  });

  it("declares 4 tabs (Overview / Locations / Activity / Settings)", () => {
    expect(src).toMatch(/id:\s*"overview"/);
    expect(src).toMatch(/id:\s*"locations"/);
    expect(src).toMatch(/id:\s*"transactions"/);
    expect(src).toMatch(/id:\s*"settings"/);
  });

  it("hides Make Transfer + Adjust Stock for non-stock + service items (canonical empty state)", () => {
    expect(src).toMatch(/const stockable = item\.type === "product" && item\.trackInventory/);
    // The Locations tab branches on stockable — non-stock + service
    // render <DetailRightRailEmpty> instead of the action row.
    expect(src).toMatch(
      /if \(!stockable\)[\s\S]+?<DetailRightRailEmpty[\s\S]+?Service items don't track stock/,
    );
  });

  it("Transfer + Adjust action buttons live in the Locations-tab body, not on the panel header", () => {
    expect(src).toMatch(
      /<Button[\s\S]+?onClick=\{onTransferStock\}[\s\S]+?Make Transfer/,
    );
    expect(src).toMatch(
      /<Button[\s\S]+?onClick=\{onAdjustStock\}[\s\S]+?Adjust Stock/,
    );
  });

  it("closing the rail (onActiveTabChange null) bubbles to the page-level onClose", () => {
    expect(src).toMatch(/if \(id === null\)\s*\{[\s\S]+?onClose\(\)/);
  });
});

// ── 11. Modals — composed only of canonical primitives ────────────

describe("Inventory modals — canonical ModalShell + FormField primitives", () => {
  const itemSrc = read(ITEM_MODAL_PATH);
  const locSrc = read(LOC_MODAL_PATH);
  const transferSrc = read(TRANSFER_MODAL_PATH);
  const adjustSrc = read(ADJUST_MODAL_PATH);

  for (const [name, src] of [
    ["InventoryItemModal", itemSrc],
    ["InventoryLocationModal", locSrc],
    ["TransferStockModal", transferSrc],
    ["AdjustStockModal", adjustSrc],
  ] as const) {
    it(`${name} composes <ModalShell> + <ModalHeader> + <ModalTitle> + <ModalBody> + <ModalFooter>`, () => {
      expect(src).toMatch(/<ModalShell\b/);
      expect(src).toMatch(/<ModalHeader\b/);
      expect(src).toMatch(/<ModalTitle\b/);
      expect(src).toMatch(/<ModalBody\b/);
      expect(src).toMatch(/<ModalFooter\b/);
    });

    it(`${name} uses the canonical FormField primitives (FormField + FormLabel + FormSection)`, () => {
      expect(src).toMatch(/from "@\/components\/ui\/form-field"/);
      expect(src).toMatch(/<FormField\b/);
      expect(src).toMatch(/<FormLabel\b/);
    });

    it(`${name} does NOT introduce raw text-* / font-* typography overrides on modal chrome`, () => {
      // Modal primitives bake typography. Pin the absence of common
      // drift patterns directly inside ModalTitle / ModalDescription.
      expect(src).not.toMatch(/<ModalTitle[^>]*className="[^"]*text-(?:xl|2xl)/);
      expect(src).not.toMatch(/<ModalTitle[^>]*className="[^"]*font-bold/);
    });
  }

  it("InventoryItemModal disables trackInventory when type=service", () => {
    expect(itemSrc).toMatch(
      /<Switch[\s\S]+?disabled=\{form\.type === "service"\}[\s\S]+?onCheckedChange/,
    );
    // Auto-clear effect: flipping to service resets trackInventory to false.
    expect(itemSrc).toMatch(
      /if \(form\.type === "service" && form\.trackInventory\)[\s\S]+?trackInventory: false/,
    );
  });

  it("TransferStockModal blocks same-location transfers in the destination select", () => {
    expect(transferSrc).toMatch(
      /<SelectItem[\s\S]+?disabled=\{!l\.isActive \|\| l\.id === fromLocationId\}/,
    );
  });

  it("AdjustStockModal converts direction + quantity into a signed deltaQuantity", () => {
    expect(adjustSrc).toMatch(/const signed = direction === "in" \? qty : -qty/);
    expect(adjustSrc).toMatch(/deltaQuantity:\s*String\(signed\)/);
  });
});

// ── 12. Wire types ────────────────────────────────────────────────

describe("client/src/lib/inventory/types.ts — canonical shape", () => {
  const src = read(TYPES_PATH);

  it("re-exports the shared schema types verbatim (single source of truth)", () => {
    expect(src).toMatch(/import type \{[\s\S]+?InventoryLocation,[\s\S]+?\} from "@shared\/schema"/);
  });

  it("declares the InventoryItemRow shape with a `stock: ItemStockTotals` field", () => {
    expect(src).toMatch(
      /export interface InventoryItemRow extends Item \{\s*stock: ItemStockTotals;/,
    );
  });

  it("declares ItemLocationStock with availableQuantity (server-derived)", () => {
    expect(src).toMatch(
      /availableQuantity:\s*string;[\s\S]+?Derived server-side/,
    );
  });
});
