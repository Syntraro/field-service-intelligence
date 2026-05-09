/**
 * Inventory list audit — canonical list/table conformance (2026-05-08).
 *
 * Verifies that InventoryPage uses the SAME canonical list infrastructure
 * (EntityListTable) and surface conventions used by every other core
 * entity list (Jobs, Leads, Quotes, Invoices, Suppliers, Price Book).
 *
 * What this pins:
 *   - EntityListTable import from the canonical path (not a one-off table)
 *   - Items / Locations / Low Stock tabs all mount EntityListTable
 *   - No raw HTML table elements (<table / <tr / <th / <td) in the page
 *   - All column definitions use canonical EntityListColumn kinds
 *     (primary / text / badge / money / status)
 *   - Row click handler toggles the right-side rail (same toggle pattern
 *     as Jobs / Invoices / Clients)
 *   - Selected-row key is wired through to EntityListTable
 *   - Loading state uses the canonical Skeleton primitive
 *   - FilterChip usage for filter bars (canonical chip, not ad-hoc buttons)
 *   - StatusChip usage for inventory status chips (no inline span pills)
 *   - SummaryCard typography uses the canonical text-caption / text-page-title
 *     tokens matching the Jobs.tsx / InvoicesListPage SummaryCard pattern
 *
 * KPI card status: no shared stat-card primitive exists in this codebase.
 * Every list page that shows summary tiles (Jobs, Invoices, Inventory)
 * implements an inline SummaryCard — this is the established convention.
 * The Inventory SummaryCard (Locations tab) mirrors the InvoicesListPage
 * pattern exactly (px-5 py-4 padding, text-caption label, text-page-title
 * value + mt-2, tabular-nums, bg-white rounded-md border shadow-sm).
 *
 * Visual polish applied (2026-05-08):
 *   - Outer container: px-6 py-5 space-y-4 → p-6 space-y-5 (matches Jobs/Invoices)
 *   - KPI card grid: gap-3 → gap-4
 *   - SummaryCard: px-4 py-3 → px-5 py-4 (matches InvoicesListPage)
 *   - SummaryCard value: mt-1.5 → mt-2 (matches InvoicesListPage)
 *   - Filter bars: gap-2 → gap-3 (matches Jobs filter row)
 *
 * Source-pin tests (no live DB / no live render).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const PAGE_PATH = path("client/src/pages/InventoryPage.tsx");
const JOBS_PATH = path("client/src/pages/Jobs.tsx");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

// ── 1. EntityListTable import ──────────────────────────────────────────

describe("InventoryPage — EntityListTable import", () => {
  const src = read(PAGE_PATH);

  it("imports EntityListTable from the canonical path", () => {
    expect(src).toMatch(
      /import \{ EntityListTable[^}]*\} from "@\/components\/lists\/EntityListTable"/,
    );
  });

  it("imports the EntityListColumn type from the canonical path", () => {
    expect(src).toMatch(/type EntityListColumn/);
    expect(src).toMatch(/@\/components\/lists\/EntityListTable/);
  });
});

// ── 2. All three active tabs use EntityListTable ───────────────────────

describe("InventoryPage — three tabs mount EntityListTable (no one-off table)", () => {
  const src = read(PAGE_PATH);

  it("Items tab mounts EntityListTable<InventoryItemRow>", () => {
    expect(src).toMatch(/<EntityListTable<InventoryItemRow>/);
  });

  it("Locations tab mounts EntityListTable<LocationWithAggregates>", () => {
    expect(src).toMatch(/<EntityListTable<LocationWithAggregates>/);
  });

  it("Low Stock tab mounts EntityListTable<LowStockRow>", () => {
    expect(src).toMatch(/<EntityListTable<LowStockRow>/);
  });

  it("NO raw HTML table elements anywhere in the page (uses CSS Grid via EntityListTable)", () => {
    // EntityListTable renders a CSS-Grid surface — no semantic <table>.
    // A raw <table> would mean a one-off implementation that bypasses the
    // canonical sizing, truncation, and row-click rules.
    expect(src).not.toMatch(/<table[\s>]/i);
    expect(src).not.toMatch(/<\/table>/i);
    expect(src).not.toMatch(/<tr[\s>]/i);
    expect(src).not.toMatch(/<th[\s>]/i);
    expect(src).not.toMatch(/<td[\s>]/i);
  });
});

// ── 3. Items tab column kinds ──────────────────────────────────────────

describe("InventoryPage Items tab — canonical column kinds", () => {
  const src = read(PAGE_PATH);

  it("Item column uses kind: primary (entity name density, min-w-0 truncate)", () => {
    // The primary-kind column receives text-caption font-medium styling from
    // EntityListTable — matching ENTITY_NAME_CLASS in typography.tsx.
    expect(src).toMatch(/id:\s*"item",[\s\S]+?kind:\s*"primary"/);
  });

  it("SKU/Model and Category columns use kind: text", () => {
    expect(src).toMatch(/id:\s*"sku",[\s\S]+?kind:\s*"text"/);
    expect(src).toMatch(/id:\s*"category",[\s\S]+?kind:\s*"text"/);
  });

  it("Type column uses kind: badge (renders ItemStockBadge chip)", () => {
    expect(src).toMatch(/id:\s*"type",[\s\S]+?kind:\s*"badge"/);
  });

  it("On Hand, Available, Unit Cost, Unit Price columns use kind: money (right-align + tabular-nums)", () => {
    expect(src).toMatch(/id:\s*"on_hand",[\s\S]+?kind:\s*"money"/);
    expect(src).toMatch(/id:\s*"available",[\s\S]+?kind:\s*"money"/);
    expect(src).toMatch(/id:\s*"unit_cost",[\s\S]+?kind:\s*"money"/);
    expect(src).toMatch(/id:\s*"unit_price",[\s\S]+?kind:\s*"money"/);
  });

  it("Status column uses kind: status (flex-wrap multi-badge container)", () => {
    expect(src).toMatch(/id:\s*"status",[\s\S]+?kind:\s*"status"/);
  });
});

// ── 4. Locations tab column kinds ─────────────────────────────────────

describe("InventoryPage Locations tab — canonical column kinds", () => {
  const src = read(PAGE_PATH);

  it("Name column uses kind: primary", () => {
    expect(src).toMatch(/id:\s*"name",[\s\S]+?kind:\s*"primary"/);
  });

  it("Type and Actions columns use kind: badge", () => {
    expect(src).toMatch(/id:\s*"type",[\s\S]+?kind:\s*"badge"/);
    expect(src).toMatch(/id:\s*"actions",[\s\S]+?kind:\s*"badge"/);
  });

  it("Assigned User and Address columns use kind: text", () => {
    expect(src).toMatch(/id:\s*"assigned",[\s\S]+?kind:\s*"text"/);
    expect(src).toMatch(/id:\s*"address",[\s\S]+?kind:\s*"text"/);
  });

  it("Items and Qty columns use kind: money (right-align tabular-nums)", () => {
    expect(src).toMatch(/id:\s*"items",[\s\S]+?kind:\s*"money"/);
    expect(src).toMatch(/id:\s*"qty",[\s\S]+?kind:\s*"money"/);
  });
});

// ── 5. Row click toggles the right-side rail ──────────────────────────

describe("InventoryPage — row click wiring matches canonical toggle pattern", () => {
  const src = read(PAGE_PATH);

  it("Items tab onRowClick closes the rail when clicking the already-selected row", () => {
    // Same pattern used by Jobs + Invoices: click the selected row → close.
    expect(src).toMatch(
      /onRowClick=\{\(it\) =>[\s\S]+?it\.id === selectedItemId[\s\S]+?onCloseItemRail\(\)[\s\S]+?onSelectItem\(it\.id\)/,
    );
  });

  it("Locations tab onRowClick closes the rail when clicking the already-selected row", () => {
    expect(src).toMatch(
      /onRowClick=\{\(loc\) =>[\s\S]+?loc\.id === selectedLocationId[\s\S]+?onCloseLocationRail\(\)[\s\S]+?onSelectLocation\(loc\.id\)/,
    );
  });
});

// ── 6. selectedRowKey is threaded to EntityListTable ──────────────────

describe("InventoryPage — selectedRowKey highlight wiring", () => {
  const src = read(PAGE_PATH);

  it("Items tab passes selectedRowKey to EntityListTable so the selected row is highlighted", () => {
    expect(src).toMatch(/selectedRowKey=\{selectedItemId \?\? undefined\}/);
  });

  it("Locations tab passes selectedRowKey to EntityListTable", () => {
    expect(src).toMatch(/selectedRowKey=\{selectedLocationId \?\? undefined\}/);
  });
});

// ── 7. Loading state uses canonical Skeleton ───────────────────────────

describe("InventoryPage — loading state uses Skeleton primitive", () => {
  const src = read(PAGE_PATH);

  it("imports Skeleton from the canonical path", () => {
    expect(src).toMatch(/import \{ Skeleton \} from "@\/components\/ui\/skeleton"/);
  });

  it("Items tab loadingState uses <Skeleton> (not a custom spinner)", () => {
    expect(src).toMatch(/itemsQuery\.isLoading[\s\S]+?<Skeleton/);
  });

  it("Locations tab loadingState uses <Skeleton>", () => {
    expect(src).toMatch(/locationsQuery\.isLoading[\s\S]+?<Skeleton/);
  });
});

// ── 8. FilterChip from canonical chip (not ad-hoc buttons) ────────────

describe("InventoryPage — filter bar uses canonical FilterChip", () => {
  const src = read(PAGE_PATH);

  it("imports FilterChip from the canonical chip module", () => {
    // May import alongside StatusChip from the same barrel.
    expect(src).toMatch(/FilterChip[\s\S]+?from "@\/components\/ui\/chip"/);
  });

  it("Items type filter chips are canonical FilterChip (not <button> with inline style)", () => {
    expect(src).toMatch(/<FilterChip[\s\S]+?data-testid="inventory-items-filter-type-product"/);
    expect(src).toMatch(/<FilterChip[\s\S]+?data-testid="inventory-items-filter-type-service"/);
  });

  it("Items stock filter chips are canonical FilterChip", () => {
    expect(src).toMatch(/<FilterChip[\s\S]+?data-testid="inventory-items-filter-stock-tracked"/);
    expect(src).toMatch(/<FilterChip[\s\S]+?data-testid="inventory-items-filter-stock-non"/);
  });

  it("Locations active/inactive filter chips are canonical FilterChip", () => {
    expect(src).toMatch(/<FilterChip[\s\S]+?data-testid="inventory-locations-filter-active"/);
    expect(src).toMatch(/<FilterChip[\s\S]+?data-testid="inventory-locations-filter-inactive"/);
  });
});

// ── 9. No ad-hoc inline status spans ──────────────────────────────────

describe("InventoryPage — no ad-hoc chip-shaped spans (canonical chip only)", () => {
  const src = read(PAGE_PATH);

  it("no rounded-full px-1.5 py-0.5 inline span status pills in the page itself", () => {
    // Canonical chips come from chip.tsx / InventoryStatusBadges.tsx.
    // The page file must not roll its own.
    expect(src).not.toMatch(
      /className="[^"]*rounded-full[^"]*px-1\.5[^"]*py-0\.5[^"]*"[\s\S]{0,200}>(Active|Inactive|Stock|Service|Low Stock)/,
    );
  });

  it("uses StatusChip from the canonical chip module for in-page chips", () => {
    // LocationsTabBody uses StatusChip for the low-stock count chip.
    expect(src).toMatch(/StatusChip[\s\S]+?from "@\/components\/ui\/chip"/);
    expect(src).toMatch(/<StatusChip[\s\S]+?tone="warning"/);
  });
});

// ── 10. SummaryCard typography matches canonical pattern ───────────────

describe("InventoryPage SummaryCard — canonical typography tokens", () => {
  const src = read(PAGE_PATH);
  const jobsSrc = read(JOBS_PATH);

  it("SummaryCard label uses text-caption (matches Jobs.tsx SummaryCard token)", () => {
    // Both pages use text-caption for the label line. This is the
    // canonical pattern; new summary-card surfaces should match it.
    expect(src).toMatch(/text-caption[\s\S]+?text-slate-500/);
    expect(jobsSrc).toMatch(/text-caption[\s\S]+?text-slate-500/);
  });

  it("SummaryCard value uses text-page-title font-bold tabular-nums (matches Jobs.tsx)", () => {
    expect(src).toMatch(/text-page-title font-bold text-slate-900 tabular-nums/);
    expect(jobsSrc).toMatch(/text-page-title font-bold text-slate-900 tabular-nums/);
  });

  it("SummaryCard card surface uses bg-white rounded-md border shadow-sm (matches Jobs.tsx)", () => {
    expect(src).toMatch(/bg-white rounded-md border border-slate-200 shadow-sm/);
    expect(jobsSrc).toMatch(/bg-white rounded-md border border-slate-200 shadow-sm/);
  });

  it("SummaryCard comment acknowledges no shared stat-card primitive (inline-mirror pattern)", () => {
    // The page itself documents that no shared primitive exists — every
    // list page that shows KPI tiles implements the same inline pattern.
    // The comment spans a line break ("No shared\n *  stat-card primitive"),
    // so we match the unique fragment that appears on the second line.
    expect(src).toMatch(/stat-card primitive exists today/);
  });
});

// ── 11. CanonicalEmpty emptyState — no table-based layout ─────────────

describe("InventoryPage CanonicalEmpty — centered non-table empty state", () => {
  const src = read(PAGE_PATH);

  it("CanonicalEmpty uses text-center py-12 (canonical centering, not a table cell)", () => {
    expect(src).toMatch(/text-center py-12/);
  });

  it("emptyState slot is provided on all three active EntityListTable mounts", () => {
    // Three emptyState props — one per active tab (Items / Locations / LowStock).
    const emptyStateMatches = src.match(/emptyState=\{/g);
    expect(emptyStateMatches).not.toBeNull();
    expect(emptyStateMatches!.length).toBeGreaterThanOrEqual(3);
  });

  it("Items empty state has data-testid inventory-items-empty", () => {
    expect(src).toMatch(/testId="inventory-items-empty"/);
  });

  it("Locations empty state has data-testid inventory-locations-empty", () => {
    expect(src).toMatch(/testId="inventory-locations-empty"/);
  });

  it("Low Stock empty state has data-testid inventory-low-stock-empty", () => {
    expect(src).toMatch(/testId="inventory-low-stock-empty"/);
  });
});

// ── 12. InventoryPage data-testid conformance ──────────────────────────

describe("InventoryPage — canonical testid wiring", () => {
  const src = read(PAGE_PATH);

  it("page root carries data-testid inventory-page", () => {
    expect(src).toMatch(/data-testid="inventory-page"/);
  });

  it("tab list carries data-testid inventory-tabs", () => {
    expect(src).toMatch(/data-testid="inventory-tabs"/);
  });

  it("each tab trigger carries data-testid rendered from the tab key (dynamic template literal)", () => {
    // The page uses `data-testid={`inventory-tab-${t.key}`}` in a .map()
    // over TAB_DEFS, so static per-key strings don't appear. Pin the
    // template form and confirm TAB_DEFS covers all 6 expected keys.
    expect(src).toMatch(/data-testid=\{`inventory-tab-\$\{t\.key\}`\}/);
    for (const key of ["items", "locations", "transfers", "adjustments", "counts", "low_stock"]) {
      // Each key must appear in the TAB_DEFS array definition.
      expect(src).toMatch(new RegExp(`key:\\s*"${key}"`));
    }
  });

  it("New Item button carries data-testid inventory-new-item", () => {
    expect(src).toMatch(/data-testid="inventory-new-item"/);
  });

  it("New Location button carries data-testid inventory-new-location", () => {
    expect(src).toMatch(/data-testid="inventory-new-location"/);
  });
});

// ── 13. Visual polish — spacing tokens match canonical pages ───────────

describe("InventoryPage — spacing tokens match Jobs/Invoices canonical baseline", () => {
  const src = read(PAGE_PATH);

  it("outer container uses p-6 space-y-5 (matches Jobs + InvoicesListPage inner wrapper)", () => {
    // Previously px-6 py-5 space-y-4 — aligned to the canonical p-6 space-y-5
    // inner wrapper used by every other entity list page.
    expect(src).toMatch(/className="p-6 space-y-5" data-testid="inventory-page"/);
  });

  it("KPI card grid uses gap-4 (matches Jobs + InvoicesListPage card grids)", () => {
    // Previously gap-3 — aligned to gap-4 used on Jobs + Invoices summary rows.
    expect(src).toMatch(/grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4/);
  });

  it("SummaryCard padding is px-5 py-4 (matches InvoicesListPage SummaryCard)", () => {
    // Previously px-4 py-3 — aligned to the px-5 py-4 canonical card padding.
    expect(src).toMatch(/bg-white rounded-md border border-slate-200 shadow-sm px-5 py-4/);
  });

  it("SummaryCard value uses mt-2 (matches InvoicesListPage SummaryCard)", () => {
    // Previously mt-1.5 — aligned to mt-2 used on the Invoices SummaryCard.
    expect(src).toMatch(/text-page-title font-bold text-slate-900 tabular-nums mt-2/);
  });

  it("filter bar outer flex uses gap-3 (matches Jobs filter row gap)", () => {
    // Previously gap-2 — aligned to gap-3 used in Jobs / Invoices filter rows.
    // Both ItemsFilterBar and LocationsFilterBar are covered by the regex.
    const matches = src.match(/flex flex-wrap items-center gap-3/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });
});
