/**
 * Inventory Phase 3 — consumption + return workflows
 * (2026-05-08).
 *
 * Locks the architectural contracts of the third inventory pass:
 *   - new job_inventory_usage table + Drizzle schema + Zod
 *   - two-row return model (kind=consumption | return; returns
 *     attach to a parent via parent_usage_id)
 *   - inventoryService.consumeForJob / returnFromJob / removeUsage
 *     all wrap a single Drizzle tx (transaction-driven invariant
 *     preserved); each writes an inventory_transactions audit row in
 *     the same tx as the inventory_quantities update + the
 *     job_inventory_usage intent row
 *   - snapshot unit_cost at consumption time (later cost changes do
 *     NOT mutate historical job totals)
 *   - guards: cannot consume service items / non-stock items /
 *     inactive locations / more than available; cannot return more
 *     than the parent's remaining returnable; cannot remove a
 *     consumption that has child returns
 *   - new endpoints under /api/inventory (gated by requireFeature +
 *     requirePermission); ?stockOnly=true on /items
 *   - JobDetailPage mounts the canonical capability-gated section
 *   - canonical query-key invalidation set after each mutation
 *   - Item rail + Location rail surface a compact RecentUsageStrip
 *
 * Source-pin tests (no live DB / no live render).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const MIGRATION_PATH = path("migrations/2026_05_08_inventory_consumption.sql");
const SCHEMA_PATH = path("shared/schema.ts");
const STORAGE_PATH = path("server/storage/inventory.ts");
const USAGE_REPO_PATH = path("server/storage/jobInventoryUsage.ts");
const ROUTE_PATH = path("server/routes/inventory.ts");
const TYPES_PATH = path("client/src/lib/inventory/types.ts");
const SECTION_PATH = path(
  "client/src/components/inventory/JobInventoryUsageSection.tsx",
);
const ADD_MODAL_PATH = path(
  "client/src/components/inventory/AddInventoryToJobModal.tsx",
);
const RETURN_MODAL_PATH = path(
  "client/src/components/inventory/ReturnInventoryFromJobModal.tsx",
);
const STRIP_PATH = path(
  "client/src/components/inventory/RecentUsageStrip.tsx",
);
const ITEM_RAIL_PATH = path(
  "client/src/components/inventory/InventoryItemRail.tsx",
);
const LOC_RAIL_PATH = path(
  "client/src/components/inventory/InventoryLocationRail.tsx",
);
const JOB_DETAIL_PATH = path("client/src/pages/JobDetailPage.tsx");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

// ── 1. Migration ───────────────────────────────────────────────────

describe("Migration — job_inventory_usage table", () => {
  const sql = read(MIGRATION_PATH);

  it("creates the table tenant-scoped via company_id ON DELETE CASCADE", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS job_inventory_usage/);
    expect(sql).toMatch(
      /company_id\s+varchar NOT NULL REFERENCES companies\(id\) ON DELETE CASCADE/,
    );
  });

  it("FKs job_id ON DELETE CASCADE; item_id + location_id ON DELETE RESTRICT", () => {
    expect(sql).toMatch(/job_id\s+varchar NOT NULL REFERENCES jobs\(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/item_id\s+varchar NOT NULL REFERENCES items\(id\) ON DELETE RESTRICT/);
    expect(sql).toMatch(
      /location_id\s+varchar NOT NULL REFERENCES inventory_locations\(id\) ON DELETE RESTRICT/,
    );
  });

  it("kind CHECK constraint locks the two-row model (consumption | return)", () => {
    expect(sql).toMatch(
      /CONSTRAINT job_inventory_usage_kind_check\s+CHECK \(kind IN \('consumption', 'return'\)\)/,
    );
  });

  it("quantity is positive at the DB level", () => {
    expect(sql).toMatch(
      /CONSTRAINT job_inventory_usage_quantity_positive\s+CHECK \(quantity > 0\)/,
    );
  });

  it("parent_shape CHECK enforces returns reference a parent + consumptions don't", () => {
    expect(sql).toMatch(
      /CONSTRAINT job_inventory_usage_parent_shape\s+CHECK \([\s\S]+?kind = 'return' AND parent_usage_id IS NOT NULL[\s\S]+?kind = 'consumption' AND parent_usage_id IS NULL/,
    );
  });

  it("links back to inventory_transactions via inventory_transaction_id (ON DELETE SET NULL)", () => {
    expect(sql).toMatch(
      /inventory_transaction_id\s+varchar REFERENCES inventory_transactions\(id\) ON DELETE SET NULL/,
    );
  });

  it("snapshot unit_cost is NOT NULL on every row (cost stability)", () => {
    expect(sql).toMatch(/unit_cost_snapshot\s+numeric\(12, 2\) NOT NULL/);
  });

  it("supports soft-delete for the Remove Usage flow", () => {
    expect(sql).toMatch(/deleted_at\s+timestamp/);
  });
});

// ── 2. Drizzle schema + Zod ────────────────────────────────────────

describe("shared/schema.ts — job_inventory_usage Drizzle table + Zod", () => {
  const src = read(SCHEMA_PATH);

  it("declares jobInventoryUsage pgTable", () => {
    expect(src).toMatch(/export const jobInventoryUsage\s*=\s*pgTable\(/);
  });

  it("exports the canonical Zod schemas for consume + return", () => {
    expect(src).toMatch(
      /export const consumeInventoryForJobSchema\s*=\s*z\.object/,
    );
    expect(src).toMatch(
      /export const returnInventoryFromJobSchema\s*=\s*z\.object/,
    );
  });

  it("registers job_return as a canonical inventory transaction type (additive — keeps `return`)", () => {
    expect(src).toMatch(/inventoryTransactionTypeEnum =[\s\S]+?"job_return"/);
    // Inverse check: the older `return` value is preserved for the
    // AdjustStockModal's existing "Return to stock" reason.
    expect(src).toMatch(/inventoryTransactionTypeEnum =[\s\S]+?"return"/);
  });

  it("declares the kind enum (consumption | return)", () => {
    expect(src).toMatch(
      /jobInventoryUsageKindEnum\s*=\s*\["consumption",\s*"return"\]/,
    );
  });
});

// ── 3. Storage: usage repository ───────────────────────────────────

describe("jobInventoryUsageRepository — read shape + returnable math", () => {
  const src = read(USAGE_REPO_PATH);

  it("listForJob joins items + locations + users in one query", () => {
    expect(src).toMatch(
      /\.leftJoin\(items, eq\(jobInventoryUsage\.itemId, items\.id\)\)/,
    );
    expect(src).toMatch(
      /\.leftJoin\(inventoryLocations, eq\(jobInventoryUsage\.locationId, inventoryLocations\.id\)\)/,
    );
    expect(src).toMatch(
      /\.leftJoin\(users, eq\(jobInventoryUsage\.consumedByUserId, users\.id\)\)/,
    );
  });

  it("listForJob excludes soft-deleted rows", () => {
    expect(src).toMatch(
      /listForJob[\s\S]+?isNull\(jobInventoryUsage\.deletedAt\)/,
    );
  });

  it("computes per-row removable flag based on child return rows", () => {
    expect(src).toMatch(/childCount\.set\(r\.parentUsageId,/);
    expect(src).toMatch(
      /removable\s*=\s*\s*r\.kind === "return"\s*\?\s*true\s*:\s*\(childCount\.get\(r\.id\) \?\? 0\) === 0/,
    );
  });

  it("summary aggregates consumption / return / net quantities + net cost", () => {
    expect(src).toMatch(/totalConsumptionQuantity:/);
    expect(src).toMatch(/totalReturnQuantity:/);
    expect(src).toMatch(/totalNetQuantity:/);
    expect(src).toMatch(/netCost:/);
    // Net cost subtracts return cost from consumption cost.
    expect(src).toMatch(
      /if \(r\.kind === "consumption"\)[\s\S]+?net \+= q \* cost[\s\S]+?else[\s\S]+?net -= q \* cost/,
    );
  });

  it("returnableQuantityFor reads parent quantity − sum(existing returns)", () => {
    expect(src).toMatch(/async function returnableQuantityFor/);
    expect(src).toMatch(
      /COALESCE\(SUM\(\$\{jobInventoryUsage\.quantity\}\),\s*0\)/,
    );
    expect(src).toMatch(
      /Number\(parent\.quantity\) - Number\(existing\?\.total \?\? 0\)/,
    );
  });

  it("recent-usage reads exclude soft-deleted rows + sort DESC", () => {
    expect(src).toMatch(/listRecentForItem[\s\S]+?isNull\(jobInventoryUsage\.deletedAt\)/);
    expect(src).toMatch(/listRecentForLocation[\s\S]+?isNull\(jobInventoryUsage\.deletedAt\)/);
    // Both use desc(createdAt).
    const descs = src.match(/desc\(jobInventoryUsage\.createdAt\)/g) ?? [];
    expect(descs.length).toBeGreaterThanOrEqual(2);
  });
});

// ── 4. Storage service: consume / return / remove invariants ───────

describe("inventoryService — consume / return / remove single-tx invariants", () => {
  const src = read(STORAGE_PATH);

  it("consumeForJob wraps a single Drizzle tx", () => {
    expect(src).toMatch(/async function consumeForJob[\s\S]+?db\.transaction\(/);
  });

  it("returnFromJob wraps a single Drizzle tx", () => {
    expect(src).toMatch(/async function returnFromJob[\s\S]+?db\.transaction\(/);
  });

  it("removeUsage wraps a single Drizzle tx + soft-deletes the row", () => {
    expect(src).toMatch(/async function removeUsage[\s\S]+?db\.transaction\(/);
    expect(src).toMatch(
      /removeUsage[\s\S]+?\.update\(jobInventoryUsage\)\s*\.set\(\{ deletedAt:/,
    );
  });

  it("consumeForJob inserts the audit row + the intent row in the same tx", () => {
    // Slice the consumeForJob function body precisely (between its
    // declaration and the next top-level `async function `) so the
    // adjacency check isn't tripped by other function bodies.
    const start = src.indexOf("async function consumeForJob(");
    expect(start).toBeGreaterThan(-1);
    const tail = src.slice(start + 1);
    const nextFn = tail.search(/\nasync function /);
    const body = src.slice(start, start + 1 + (nextFn > 0 ? nextFn : tail.length));
    // Both inserts must be present inside the SAME function body.
    expect(body).toMatch(/tx\s*\.\s*insert\(inventoryTransactions\)/);
    expect(body).toMatch(/tx\s*\.\s*insert\(jobInventoryUsage\)/);
  });

  it("returnFromJob inserts the audit row + the intent row in the same tx", () => {
    const start = src.indexOf("async function returnFromJob(");
    expect(start).toBeGreaterThan(-1);
    const tail = src.slice(start + 1);
    const nextFn = tail.search(/\nasync function /);
    const body = src.slice(start, start + 1 + (nextFn > 0 ? nextFn : tail.length));
    expect(body).toMatch(/tx\s*\.\s*insert\(inventoryTransactions\)/);
    expect(body).toMatch(/tx\s*\.\s*insert\(jobInventoryUsage\)/);
  });

  it("consumeForJob snapshots item.cost into unit_cost_snapshot", () => {
    expect(src).toMatch(/const unitCostSnapshot = itemRow\.cost \?\? "0"/);
    expect(src).toMatch(/unitCostSnapshot,/);
  });

  it("returnFromJob reuses the parent's snapshot (no fresh cost lookup)", () => {
    expect(src).toMatch(
      /returnFromJob[\s\S]+?unitCostSnapshot:\s*parent\.unitCostSnapshot/,
    );
  });

  it("consumeForJob rejects service items + non-tracked items + insufficient stock", () => {
    expect(src).toMatch(
      /consumeForJob[\s\S]+?Service items cannot be consumed onto a job/,
    );
    expect(src).toMatch(
      /consumeForJob[\s\S]+?This item is not tracked as stock/,
    );
    expect(src).toMatch(
      /consumeForJob[\s\S]+?Source location does not have enough stock/,
    );
  });

  it("consumeForJob rejects inactive locations via assertLocationActive", () => {
    expect(src).toMatch(
      /consumeForJob[\s\S]+?await assertLocationActive\(tx, companyId, input\.locationId\)/,
    );
  });

  it("returnFromJob blocks over-return against parent remaining capacity", () => {
    expect(src).toMatch(
      /returnFromJob[\s\S]+?Cannot return more than \$\{returnable\}/,
    );
  });

  it("removeUsage blocks when downstream return rows reference the parent", () => {
    expect(src).toMatch(
      /removeUsage[\s\S]+?This usage already has returns recorded against it\. Remove the returns first\./,
    );
  });

  it("removeUsage writes a reversing job_return audit row + restores stock", () => {
    const start = src.indexOf("async function removeUsage(");
    expect(start).toBeGreaterThan(-1);
    const tail = src.slice(start + 1);
    const nextFn = tail.search(/\nasync function |\nexport const inventoryService/);
    const body = src.slice(start, start + 1 + (nextFn > 0 ? nextFn : tail.length));
    expect(body).toMatch(/transactionType:\s*"job_return"/);
    expect(body).toMatch(
      /onHandQuantity:\s*sql`\$\{inventoryQuantities\.onHandQuantity\} \+ \$\{row\.quantity\}`/,
    );
  });

  it("inventoryService exports the new consume / return / remove methods", () => {
    expect(src).toMatch(
      /export const inventoryService = \{[\s\S]+?performTransfer,[\s\S]+?performAdjustment,[\s\S]+?consumeForJob,[\s\S]+?returnFromJob,[\s\S]+?removeUsage,[\s\S]+?\};/,
    );
  });
});

// ── 5. Routes: gating + new endpoints + ?stockOnly ─────────────────

describe("server/routes/inventory.ts — Phase-3 endpoints", () => {
  const src = read(ROUTE_PATH);

  it("GET /items honors ?stockOnly=true (server-side filter)", () => {
    expect(src).toMatch(/const stockOnly = req\.query\.stockOnly === "true"/);
    expect(src).toMatch(
      /eq\(items\.type, "product"\),\s*eq\(items\.trackInventory, true\),\s*eq\(items\.isActive, true\)/,
    );
  });

  it("registers GET /items/:id/recent-usage + /locations/:id/recent-usage (read-gated)", () => {
    expect(src).toMatch(
      /router\.get\(\s*"\/items\/:id\/recent-usage",[\s\S]+?requirePermission\("inventory\.view"\)[\s\S]+?listRecentForItem/,
    );
    expect(src).toMatch(
      /router\.get\(\s*"\/locations\/:id\/recent-usage",[\s\S]+?requirePermission\("inventory\.view"\)[\s\S]+?listRecentForLocation/,
    );
  });

  it("registers GET /jobs/:jobId/usage (inventory.view) + POST + DELETE (inventory.manage)", () => {
    expect(src).toMatch(
      /router\.get\(\s*"\/jobs\/:jobId\/usage",[\s\S]+?requirePermission\("inventory\.view"\)/,
    );
    expect(src).toMatch(
      /router\.post\(\s*"\/jobs\/:jobId\/usage",[\s\S]+?requirePermission\("inventory\.manage"\)[\s\S]+?inventoryService\.consumeForJob/,
    );
    expect(src).toMatch(
      /router\.post\(\s*"\/jobs\/:jobId\/usage\/:usageId\/return",[\s\S]+?requirePermission\("inventory\.manage"\)[\s\S]+?inventoryService\.returnFromJob/,
    );
    expect(src).toMatch(
      /router\.delete\(\s*"\/jobs\/:jobId\/usage\/:usageId",[\s\S]+?requirePermission\("inventory\.manage"\)[\s\S]+?inventoryService\.removeUsage/,
    );
  });

  it("the URL :usageId wins over the body usageId on the return route (no spoofing)", () => {
    expect(src).toMatch(
      /validateSchema\(returnInventoryFromJobSchema,\s*\{[\s\S]+?usageId:\s*req\.params\.usageId/,
    );
  });

  it("inventory_core gate at the router root applies to every Phase-3 route too", () => {
    // Phase 1 mounts requireFeature once at the top — that gate
    // automatically applies to every route below it. Pin the line so
    // a future refactor that sub-router-splits the file can't drop
    // the gate by accident.
    expect(src).toMatch(/router\.use\(requireFeature\("inventory_core"\)\)/);
  });
});

// ── 6. Wire types ──────────────────────────────────────────────────

describe("client wire types — Phase 3 shapes", () => {
  const src = read(TYPES_PATH);

  it("declares JobInventoryUsageRow with the canonical fields", () => {
    expect(src).toMatch(
      /export interface JobInventoryUsageRow \{[\s\S]+?kind: JobInventoryUsageKind;[\s\S]+?parentUsageId: string \| null;[\s\S]+?unitCostSnapshot: string;[\s\S]+?lineCost: string;[\s\S]+?removable: boolean;/,
    );
  });

  it("declares JobInventoryUsageSummary + JobInventoryUsageResponse", () => {
    expect(src).toMatch(/export interface JobInventoryUsageSummary/);
    expect(src).toMatch(/export interface JobInventoryUsageResponse/);
  });

  it("declares RecentUsageRow", () => {
    expect(src).toMatch(/export interface RecentUsageRow/);
  });
});

// ── 7. JobDetailPage section + insertion point ─────────────────────

describe("JobDetailPage — Inventory Usage section is mounted between Line Items and Billing Summary", () => {
  const src = read(JOB_DETAIL_PATH);

  it("imports the canonical capability-gated section component", () => {
    expect(src).toMatch(
      /import \{ JobInventoryUsageSection \} from "@\/components\/inventory\/JobInventoryUsageSection"/,
    );
  });

  it("renders <JobInventoryUsageSection> AFTER <LineItemsTable> and BEFORE the billing summary card", () => {
    expect(src).toMatch(
      /<LineItemsTable[\s\S]+?\/>[\s\S]+?<JobInventoryUsageSection jobId=\{jobId!\} \/>[\s\S]+?<CardShell data-testid="card-billing-summary">/,
    );
  });
});

// ── 8. JobInventoryUsageSection — contract + invalidation ──────────

describe("JobInventoryUsageSection — contract", () => {
  const src = read(SECTION_PATH);

  it("hides itself when useFeatureEnabled('inventory_core') is false", () => {
    expect(src).toMatch(/useFeatureEnabled\("inventory_core"\) === true/);
    expect(src).toMatch(/if \(!inventoryEnabled\) return null/);
  });

  it("gates the underlying query on the same capability (no API call when disabled)", () => {
    expect(src).toMatch(/enabled: inventoryEnabled/);
  });

  it("uses the canonical Card + StatusChip primitives (no ad-hoc card chrome)", () => {
    expect(src).toMatch(/from "@\/components\/ui\/card"/);
    expect(src).toMatch(/from "@\/components\/ui\/chip"/);
    expect(src).toMatch(/<Card data-testid="card-job-inventory-usage">/);
  });

  it("renders the Add Inventory CTA + the empty state with canonical patterns", () => {
    expect(src).toMatch(/data-testid="job-inventory-add-button"/);
    expect(src).toMatch(/data-testid="job-inventory-usage-empty"/);
  });

  it("Return action only appears when remaining > 0 on a consumption row", () => {
    expect(src).toMatch(
      /!isReturn && remaining > 0 && \(\s*<Button[\s\S]+?onClick=\{onReturn\}/,
    );
  });

  it("Remove action only appears when row.removable is true (server-derived flag)", () => {
    expect(src).toMatch(
      /\{row\.removable && \(\s*<DropdownMenu/,
    );
  });

  it("Removal POSTs to DELETE /api/inventory/jobs/:jobId/usage/:usageId + invalidates the canonical key set", () => {
    // The fetch URL precedes the method literal in the source — pin
    // each independently rather than requiring an order.
    expect(src).toMatch(
      /\/api\/inventory\/jobs\/\$\{jobId\}\/usage\/\$\{usageId\}/,
    );
    expect(src).toMatch(/method:\s*"DELETE"/);
    expect(src).toMatch(/queryKey:\s*\["\/api\/inventory\/items"\]/);
    expect(src).toMatch(
      /queryKey:\s*\["\/api\/inventory\/locations",\s*"with-aggregates"\]/,
    );
    expect(src).toMatch(/queryKey:\s*\["\/api\/inventory\/low-stock"\]/);
    expect(src).toMatch(
      /queryKey:\s*\["\/api\/inventory\/jobs",\s*jobId,\s*"usage"\]/,
    );
  });
});

// ── 9. Add + Return modals — canonical primitives + safety ─────────

describe("AddInventoryToJobModal + ReturnInventoryFromJobModal — canonical contract", () => {
  const addSrc = read(ADD_MODAL_PATH);
  const retSrc = read(RETURN_MODAL_PATH);

  for (const [name, src] of [
    ["AddInventoryToJobModal", addSrc],
    ["ReturnInventoryFromJobModal", retSrc],
  ] as const) {
    it(`${name} composes the canonical modal stack (ModalShell + Header + Title + Body + Footer)`, () => {
      expect(src).toMatch(/<ModalShell\b/);
      expect(src).toMatch(/<ModalHeader\b/);
      expect(src).toMatch(/<ModalTitle\b/);
      expect(src).toMatch(/<ModalBody\b/);
      expect(src).toMatch(/<ModalFooter\b/);
    });
    it(`${name} uses canonical FormField primitives`, () => {
      expect(src).toMatch(/from "@\/components\/ui\/form-field"/);
      expect(src).toMatch(/<FormField\b/);
      expect(src).toMatch(/<FormLabel\b/);
    });
  }

  it("Add modal fetches stock items via ?stockOnly=true (server-side filter)", () => {
    expect(addSrc).toMatch(
      /\/api\/inventory\/items\?stockOnly=true/,
    );
  });

  it("Add modal blocks insufficient quantity client-side with a precise message", () => {
    expect(addSrc).toMatch(/qty > availableHere/);
    expect(addSrc).toMatch(
      /Source location only has \$\{availableHere\} available\./,
    );
  });

  it("Add modal disables inactive locations in the picker (Phase 1 invariant preserved)", () => {
    expect(addSrc).toMatch(
      /<SelectItem[\s\S]+?disabled=\{!l\.isActive\}/,
    );
  });

  it("Add modal POSTs to /api/inventory/jobs/:jobId/usage + invalidates the canonical key set", () => {
    expect(addSrc).toMatch(
      /\/api\/inventory\/jobs\/\$\{jobId\}\/usage/,
    );
    // Must invalidate item, location, low-stock, with-aggregates, and the per-job usage feed.
    expect(addSrc).toMatch(/queryKey:\s*\["\/api\/inventory\/items"\]/);
    expect(addSrc).toMatch(
      /queryKey:\s*\["\/api\/inventory\/locations",\s*"with-aggregates"\]/,
    );
    expect(addSrc).toMatch(/queryKey:\s*\["\/api\/inventory\/low-stock"\]/);
    expect(addSrc).toMatch(
      /queryKey:\s*\["\/api\/inventory\/jobs",\s*jobId,\s*"usage"\]/,
    );
  });

  it("Return modal blocks over-return client-side against parent remaining capacity", () => {
    expect(retSrc).toMatch(/qty > remaining/);
    expect(retSrc).toMatch(
      /Cannot return more than \$\{remaining\}/,
    );
  });

  it("Return modal POSTs to /usage/:usageId/return + invalidates the canonical key set", () => {
    expect(retSrc).toMatch(
      /\/api\/inventory\/jobs\/\$\{jobId\}\/usage\/\$\{parent\.id\}\/return/,
    );
    expect(retSrc).toMatch(
      /queryKey:\s*\["\/api\/inventory\/jobs",\s*jobId,\s*"usage"\]/,
    );
  });
});

// ── 10. Recent Usage strip + rail integration ──────────────────────

describe("RecentUsageStrip + rail integration", () => {
  const stripSrc = read(STRIP_PATH);
  const itemRailSrc = read(ITEM_RAIL_PATH);
  const locRailSrc = read(LOC_RAIL_PATH);

  it("RecentUsageStrip handles both scopes with one query function (compact, single source)", () => {
    // The component takes a `scope` prop and branches both the URL
    // and the queryKey on it. Pin the prop type + the branch shapes
    // (without prescribing which branch is the ternary's true side).
    expect(stripSrc).toMatch(/scope:\s*"item"\s*\|\s*"location"/);
    expect(stripSrc).toMatch(
      /scope === "item"\s*\?\s*`\/api\/inventory\/items\/\$\{id\}\/recent-usage/,
    );
    // QueryKey branch: item → items array key; else → locations array key.
    expect(stripSrc).toMatch(
      /scope === "item"\s*\?\s*\["\/api\/inventory\/items",[\s\S]{0,80}?:\s*\["\/api\/inventory\/locations",/,
    );
  });

  it("RecentUsageStrip uses the canonical StatusChip primitive", () => {
    expect(stripSrc).toMatch(/from "@\/components\/ui\/chip"/);
  });

  it("Item rail mounts RecentUsageStrip inside the Activity tab content (no new tab)", () => {
    expect(itemRailSrc).toMatch(
      /import \{ RecentUsageStrip \} from "\.\/RecentUsageStrip"/,
    );
    expect(itemRailSrc).toMatch(
      /<RecentUsageStrip\b[\s\S]+?scope="item"[\s\S]+?id=\{item\.id\}/,
    );
  });

  it("Location rail mounts RecentUsageStrip inside the Activity tab content (no new tab)", () => {
    expect(locRailSrc).toMatch(
      /import \{ RecentUsageStrip \} from "\.\/RecentUsageStrip"/,
    );
    expect(locRailSrc).toMatch(
      /<RecentUsageStrip\b[\s\S]+?scope="location"[\s\S]+?id=\{location\.id\}/,
    );
  });
});

// ── 11. Safety + integrity invariants (cross-cutting) ──────────────

describe("Safety: no quantity-mutation shortcuts", () => {
  const routeSrc = read(ROUTE_PATH);
  const sectionSrc = read(SECTION_PATH);
  const addSrc = read(ADD_MODAL_PATH);
  const retSrc = read(RETURN_MODAL_PATH);

  it("the route layer NEVER directly UPDATEs inventory_quantities (writes go through inventoryService)", () => {
    expect(routeSrc).not.toMatch(/db\s*\.\s*update\(inventoryQuantities\)/);
  });

  it("client mutation paths POST through the canonical /api/inventory endpoints (no shortcuts)", () => {
    // The section + the two modals together must hit only the
    // following endpoints — no client-side quantity mutation, no
    // direct items.cost write.
    for (const src of [sectionSrc, addSrc, retSrc]) {
      expect(src).not.toMatch(/\/api\/inventory\/quantities\b/);
      expect(src).not.toMatch(/\/api\/items\/[^/]+\/cost/);
    }
  });
});
