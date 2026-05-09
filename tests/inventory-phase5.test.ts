/**
 * Inventory Phase 5 — reservations
 * (2026-05-08).
 *
 * Locks the architectural contracts of the fifth inventory pass:
 *   - new `inventory_reservations` table with two-counter row
 *     (immutable `quantity` + running `consumed_quantity`), 4-status
 *     enum, partial active index, tenant-scoped indexes
 *   - reservations are their OWN audit log — no inventory_transactions
 *     rows are written for reserve/release/cancel
 *   - inventoryService.reserveInventory: single-tx, validates
 *     availability (on_hand − reserved), bumps reserved_quantity, INSERTs
 *     the reservation row inside the SAME transaction
 *   - inventoryService.releaseReservation / cancelReservation: single-tx,
 *     decrements reserved_quantity by the un-consumed remainder, flips
 *     status to 'released' / 'canceled' (preserves audit history)
 *   - inventoryService.consumeForJob extended with a
 *     consume-against-active-reservation hop that pulls from matching
 *     active reservations FIRST (FIFO by createdAt), decrementing
 *     reserved_quantity by what was pulled and updating each
 *     reservation's consumed_quantity counter
 *   - new routes (/jobs/:jobId/reservations, /reservations/:id/release,
 *     /reservations/:id/cancel, /items/:id/reservations,
 *     /locations/:id/reservations) gated on inventory.view + .manage
 *   - PricebookPickerModal stock chip extended with a third
 *     "Fully reserved" state (totalAvailable === 0 AND totalOnHand > 0)
 *   - canonical JobReservationsSection mounted on JobDetailPage,
 *     hidden when inventory_core is disabled
 *   - canonical ReserveInventoryModal composes ModalShell +
 *     FormField primitives only
 *
 * Source-pin tests (no live DB / no live render).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const MIGRATION_PATH = path("migrations/2026_05_08_inventory_reservations.sql");
const SCHEMA_PATH = path("shared/schema.ts");
const STORAGE_PATH = path("server/storage/inventory.ts");
const RES_REPO_PATH = path("server/storage/inventoryReservations.ts");
const ROUTE_PATH = path("server/routes/inventory.ts");
const TYPES_PATH = path("client/src/lib/inventory/types.ts");
const PICKER_PATH = path(
  "client/src/components/line-items/PricebookPickerModal.tsx",
);
const RESERVE_MODAL_PATH = path(
  "client/src/components/inventory/ReserveInventoryModal.tsx",
);
const SECTION_PATH = path(
  "client/src/components/inventory/JobReservationsSection.tsx",
);
const JOB_DETAIL_PATH = path("client/src/pages/JobDetailPage.tsx");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

// ── 1. Migration ───────────────────────────────────────────────────

describe("Migration — inventory_reservations table", () => {
  const sql = read(MIGRATION_PATH);

  it("creates the table with company / item / location FK constraints", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS inventory_reservations/);
    expect(sql).toMatch(
      /company_id\s+varchar NOT NULL REFERENCES companies\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /item_id\s+varchar NOT NULL REFERENCES items\(id\) ON DELETE RESTRICT/,
    );
    expect(sql).toMatch(
      /location_id\s+varchar NOT NULL REFERENCES inventory_locations\(id\) ON DELETE RESTRICT/,
    );
  });

  it("declares the two-counter quantity model with CHECK constraints", () => {
    expect(sql).toMatch(/quantity\s+numeric\(14, 4\) NOT NULL/);
    expect(sql).toMatch(
      /consumed_quantity\s+numeric\(14, 4\) NOT NULL DEFAULT 0/,
    );
    expect(sql).toMatch(/CHECK \(quantity > 0\)/);
    expect(sql).toMatch(/CHECK \(consumed_quantity >= 0\)/);
    expect(sql).toMatch(/CHECK \(consumed_quantity <= quantity\)/);
  });

  it("locks the 4-value status enum at the table level", () => {
    expect(sql).toMatch(
      /CHECK \(status IN \('active', 'consumed', 'released', 'canceled'\)\)/,
    );
  });

  it("creates the active-only partial index for the canonical hot path", () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS inventory_reservations_active_company_idx[\s\S]+?WHERE status = 'active'/,
    );
  });

  it("creates per-job partial index excluding non-job + non-active rows", () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS inventory_reservations_job_active_idx[\s\S]+?WHERE job_id IS NOT NULL AND status = 'active'/,
    );
  });

  it("does NOT enforce a visit FK (forward-compat — see file rationale)", () => {
    // visit_id is declared as a bare varchar with NO REFERENCES clause
    // on its own line. We assert only that the visit_id line itself
    // ends without REFERENCES — other unrelated columns further down
    // the table (e.g. line_item_id) DO carry their own REFERENCES,
    // which is fine.
    const visitLine = sql.match(/^.*visit_id\s+varchar.*$/m);
    expect(visitLine).not.toBeNull();
    expect(visitLine![0]).not.toMatch(/REFERENCES/);
  });
});

// ── 2. Drizzle schema + Zod ────────────────────────────────────────

describe("shared/schema.ts — Phase 5 additions", () => {
  const src = read(SCHEMA_PATH);

  it("declares the canonical 4-value status enum", () => {
    expect(src).toMatch(
      /export const inventoryReservationStatusEnum = \[\s*"active",\s*"consumed",\s*"released",\s*"canceled",\s*\] as const;/,
    );
  });

  it("declares the inventoryReservations pgTable with two-counter columns", () => {
    expect(src).toMatch(/export const inventoryReservations = pgTable\(\s*"inventory_reservations"/);
    expect(src).toMatch(/quantity:\s*numeric\("quantity"/);
    expect(src).toMatch(/consumedQuantity:\s*numeric\("consumed_quantity"/);
  });

  it("reserveInventorySchema accepts the canonical input shape", () => {
    expect(src).toMatch(
      /export const reserveInventorySchema = z\.object\(\{[\s\S]+?itemId:\s*z\.string\(\)\.min\(1\)[\s\S]+?locationId:\s*z\.string\(\)\.min\(1\)[\s\S]+?quantity:\s*z[\s\S]+?jobId:[\s\S]+?visitId:[\s\S]+?lineItemId:/,
    );
  });

  it("exports the canonical types", () => {
    expect(src).toMatch(
      /export type InventoryReservationStatus =\s*\(typeof inventoryReservationStatusEnum\)\[number\];/,
    );
    expect(src).toMatch(
      /export type InventoryReservation = typeof inventoryReservations\.\$inferSelect;/,
    );
    expect(src).toMatch(
      /export type ReserveInventoryInput = z\.infer<typeof reserveInventorySchema>;/,
    );
  });
});

// ── 3. Storage: reserve / release / cancel mutations ───────────────

describe("inventoryService — reserve / release / cancel", () => {
  const src = read(STORAGE_PATH);

  it("imports inventoryReservations + ReserveInventoryInput", () => {
    expect(src).toMatch(/import \{[\s\S]+?inventoryReservations,[\s\S]+?\} from "@shared\/schema"/);
    expect(src).toMatch(/type ReserveInventoryInput,/);
  });

  it("reserveInventory wraps a single Drizzle tx", () => {
    expect(src).toMatch(/async function reserveInventory[\s\S]+?db\.transaction\(/);
  });

  it("reserveInventory validates availability (on_hand − reserved), not raw on_hand", () => {
    expect(src).toMatch(
      /reserveInventory[\s\S]+?Number\(qtyRow\.onHandQuantity\) - Number\(qtyRow\.reservedQuantity\)/,
    );
    expect(src).toMatch(
      /reserveInventory[\s\S]+?Cannot reserve[\s\S]+?available at this location after existing reservations/,
    );
  });

  it("reserveInventory bumps reserved_quantity AND inserts the reservation row in the SAME tx", () => {
    const start = src.indexOf("async function reserveInventory(");
    expect(start).toBeGreaterThan(-1);
    const tail = src.slice(start + 1);
    const nextFn = tail.search(/\nasync function /);
    const body = src.slice(start, start + 1 + (nextFn > 0 ? nextFn : tail.length));
    expect(body).toMatch(
      /reservedQuantity:\s*sql`\$\{inventoryQuantities\.reservedQuantity\} \+ \$\{qty\}`/,
    );
    expect(body).toMatch(/tx\s*\.\s*insert\(inventoryReservations\)/);
  });

  it("reserveInventory does NOT write an inventory_transactions row (reservations are their own audit log)", () => {
    const start = src.indexOf("async function reserveInventory(");
    const tail = src.slice(start + 1);
    const nextFn = tail.search(/\nasync function /);
    const body = src.slice(start, start + 1 + (nextFn > 0 ? nextFn : tail.length));
    expect(body).not.toMatch(/tx\s*\.\s*insert\(inventoryTransactions\)/);
  });

  it("release + cancel share the implementation via releaseOrCancel", () => {
    expect(src).toMatch(/async function releaseReservation[\s\S]+?return releaseOrCancel\(/);
    expect(src).toMatch(/async function cancelReservation[\s\S]+?return releaseOrCancel\(/);
    expect(src).toMatch(/async function releaseOrCancel/);
  });

  it("release / cancel reject non-active reservations (no double-release)", () => {
    expect(src).toMatch(
      /releaseOrCancel[\s\S]+?if \(row\.status !== "active"\)[\s\S]+?nothing to release/,
    );
  });

  it("release / cancel decrement reserved_quantity by the UN-CONSUMED remainder only", () => {
    const start = src.indexOf("async function releaseOrCancel(");
    expect(start).toBeGreaterThan(-1);
    const tail = src.slice(start + 1);
    const nextFn = tail.search(/\nasync function |\nexport const inventoryService/);
    const body = src.slice(start, start + 1 + (nextFn > 0 ? nextFn : tail.length));
    expect(body).toMatch(
      /Number\(row\.quantity\) - Number\(row\.consumedQuantity\)/,
    );
    expect(body).toMatch(
      /reservedQuantity:\s*sql`\$\{inventoryQuantities\.reservedQuantity\} - \$\{remainingStr\}`/,
    );
  });

  it("release / cancel flip status + stamp released_at (NEVER hard-delete)", () => {
    const start = src.indexOf("async function releaseOrCancel(");
    const tail = src.slice(start + 1);
    const nextFn = tail.search(/\nasync function |\nexport const inventoryService/);
    const body = src.slice(start, start + 1 + (nextFn > 0 ? nextFn : tail.length));
    expect(body).toMatch(/status:\s*terminalStatus,/);
    expect(body).toMatch(/releasedAt:\s*new Date\(\),/);
    expect(body).not.toMatch(/tx\s*\.\s*delete\(inventoryReservations\)/);
  });

  it("inventoryService exports the new methods alongside the Phase 1-4 set", () => {
    expect(src).toMatch(
      /export const inventoryService = \{[\s\S]+?reserveInventory,[\s\S]+?releaseReservation,[\s\S]+?cancelReservation,[\s\S]+?\};/,
    );
  });
});

// ── 4. consumeForJob: consume-against-reservation hop ──────────────

describe("inventoryService.consumeForJob — Phase 5 reservation hop", () => {
  const src = read(STORAGE_PATH);

  it("looks up matching active reservations FIFO inside the SAME tx as the on-hand decrement", () => {
    const start = src.indexOf("async function consumeForJob(");
    expect(start).toBeGreaterThan(-1);
    const tail = src.slice(start + 1);
    const nextFn = tail.search(/\nasync function /);
    const body = src.slice(start, start + 1 + (nextFn > 0 ? nextFn : tail.length));
    // Looks up active reservations matching (company, job, item, location).
    expect(body).toMatch(/\.from\(inventoryReservations\)/);
    expect(body).toMatch(/eq\(inventoryReservations\.status,\s*"active"\)/);
    expect(body).toMatch(
      /orderBy\(inventoryReservations\.createdAt\)/,
    );
  });

  it("decrements reserved_quantity by what was pulled from reservations", () => {
    const start = src.indexOf("async function consumeForJob(");
    const tail = src.slice(start + 1);
    const nextFn = tail.search(/\nasync function /);
    const body = src.slice(start, start + 1 + (nextFn > 0 ? nextFn : tail.length));
    expect(body).toMatch(
      /reservedQuantity:\s*sql`\$\{inventoryQuantities\.reservedQuantity\} - \$\{releasedStr\}`/,
    );
  });

  it("transitions a reservation to 'consumed' when fully drawn down", () => {
    const start = src.indexOf("async function consumeForJob(");
    const tail = src.slice(start + 1);
    const nextFn = tail.search(/\nasync function /);
    const body = src.slice(start, start + 1 + (nextFn > 0 ? nextFn : tail.length));
    expect(body).toMatch(/status:\s*nowFull \? "consumed" : "active"/);
  });

  it("preserves the legacy raw-on-hand consume path when no reservation matches (no-op skip)", () => {
    // The hop is wrapped in `if (jobId)` and only runs when matching
    // active reservations exist; otherwise consumeForJob just decrements
    // on-hand and writes the audit row exactly as in Phase 3.
    const start = src.indexOf("async function consumeForJob(");
    const tail = src.slice(start + 1);
    const nextFn = tail.search(/\nasync function /);
    const body = src.slice(start, start + 1 + (nextFn > 0 ? nextFn : tail.length));
    expect(body).toMatch(/if \(jobId\)/);
  });
});

// ── 5. Reservations read repository ────────────────────────────────

describe("inventoryReservationsRepository — read shapes", () => {
  const src = read(RES_REPO_PATH);

  it("exports the canonical read methods", () => {
    expect(src).toMatch(/listForJob,/);
    expect(src).toMatch(/listRecentForItem,/);
    expect(src).toMatch(/listRecentForLocation,/);
    expect(src).toMatch(/getById,/);
    expect(src).toMatch(/aggregateActiveByItem,/);
  });

  it("listForJob filters on status='active' by default (activeOnly opt-in to historical)", () => {
    expect(src).toMatch(
      /async function listForJob[\s\S]+?activeOnly = options\.activeOnly \?\? true/,
    );
    expect(src).toMatch(
      /eq\(inventoryReservations\.status,\s*"active"\)/,
    );
  });

  it("aggregateActiveByItem returns counts only for status='active'", () => {
    expect(src).toMatch(
      /aggregateActiveByItem[\s\S]+?eq\(inventoryReservations\.status,\s*"active"\)/,
    );
  });

  it("derives remainingQuantity = quantity − consumedQuantity (clamped >= 0)", () => {
    expect(src).toMatch(
      /Math\.max\(\s*0,\s*Math\.round\(\(Number\(r\.quantity\) - Number\(r\.consumedQuantity\)\) \* 10000\) \/ 10000,?\s*\)/,
    );
  });
});

// ── 6. Routes: gated reservation endpoints ─────────────────────────

describe("server/routes/inventory.ts — Phase 5 endpoints", () => {
  const src = read(ROUTE_PATH);

  it("imports the canonical read repository + Zod schema", () => {
    expect(src).toMatch(/reserveInventorySchema,/);
    expect(src).toMatch(
      /import \{ inventoryReservationsRepository \} from "\.\.\/storage\/inventoryReservations"/,
    );
  });

  it("registers GET /jobs/:jobId/reservations (read-gated)", () => {
    expect(src).toMatch(
      /router\.get\(\s*"\/jobs\/:jobId\/reservations",[\s\S]+?requirePermission\("inventory\.view"\)[\s\S]+?inventoryReservationsRepository\.listForJob/,
    );
  });

  it("registers POST /jobs/:jobId/reservations (manage-gated, URL jobId wins)", () => {
    expect(src).toMatch(
      /router\.post\(\s*"\/jobs\/:jobId\/reservations",[\s\S]+?requirePermission\("inventory\.manage"\)[\s\S]+?inventoryService\.reserveInventory/,
    );
    // URL job id overrides the body to prevent stale-client tampering.
    expect(src).toMatch(
      /validateSchema\(reserveInventorySchema,\s*\{\s*\.\.\.req\.body,\s*jobId:\s*req\.params\.jobId,\s*\}\)/,
    );
  });

  it("registers POST /reservations/:id/release + /cancel (manage-gated)", () => {
    expect(src).toMatch(
      /router\.post\(\s*"\/reservations\/:id\/release",[\s\S]+?requirePermission\("inventory\.manage"\)[\s\S]+?inventoryService\.releaseReservation/,
    );
    expect(src).toMatch(
      /router\.post\(\s*"\/reservations\/:id\/cancel",[\s\S]+?requirePermission\("inventory\.manage"\)[\s\S]+?inventoryService\.cancelReservation/,
    );
  });

  it("registers GET /items/:id/reservations + /locations/:id/reservations (read-gated)", () => {
    expect(src).toMatch(
      /router\.get\(\s*"\/items\/:id\/reservations",[\s\S]+?requirePermission\("inventory\.view"\)[\s\S]+?listRecentForItem/,
    );
    expect(src).toMatch(
      /router\.get\(\s*"\/locations\/:id\/reservations",[\s\S]+?requirePermission\("inventory\.view"\)[\s\S]+?listRecentForLocation/,
    );
  });

  it("inventory_core mount-level gate STILL applies to every Phase 5 route", () => {
    expect(src).toMatch(/router\.use\(requireFeature\("inventory_core"\)\)/);
  });
});

// ── 7. Wire types ──────────────────────────────────────────────────

describe("client wire types — Phase 5 shapes", () => {
  const src = read(TYPES_PATH);

  it("declares the 4-value reservation status type", () => {
    expect(src).toMatch(
      /export type InventoryReservationStatus =\s*\|\s*"active"\s*\|\s*"consumed"\s*\|\s*"released"\s*\|\s*"canceled";/,
    );
  });

  it("declares InventoryReservationRow with the canonical projection", () => {
    expect(src).toMatch(
      /export interface InventoryReservationRow \{[\s\S]+?itemName: string \| null;[\s\S]+?locationName: string;[\s\S]+?quantity: string;[\s\S]+?consumedQuantity: string;[\s\S]+?remainingQuantity: string;[\s\S]+?status: InventoryReservationStatus;/,
    );
  });
});

// ── 8. PricebookPickerModal — "Fully reserved" chip state ──────────

describe("PricebookPickerModal — Phase 5 fully-reserved chip", () => {
  const src = read(PICKER_PATH);

  it("overlay shape carries totalReserved alongside totalAvailable / totalOnHand", () => {
    expect(src).toMatch(
      /export interface PricebookItemStockOverlay \{[\s\S]+?totalReserved: string;/,
    );
  });

  it("useStockOverlay maps totalReserved into the per-item overlay row", () => {
    expect(src).toMatch(/totalReserved:\s*String\(it\.stock\?\.totalReserved \?\? "0"\)/);
  });

  it("flips the out-of-stock guard from totalAvailable to totalOnHand", () => {
    // Phase 5: an item with on-hand stock that is fully reserved is
    // NOT "out of stock" — it's "fully reserved". The terminal
    // out-of-stock chip now keys on totalOnHand.
    expect(src).toMatch(/Number\(stock\.totalOnHand\) <= 0 \?/);
  });

  it("renders the Fully Reserved chip with canonical testid + amber tone", () => {
    expect(src).toMatch(
      /Number\(stock\.totalAvailable\) <= 0 \?[\s\S]+?Fully reserved/,
    );
    expect(src).toMatch(/`pricebook-item-stock-fully-reserved-\$\{item\.id\}`/);
    expect(src).toMatch(/bg-amber-50 text-amber-700/);
  });
});

// ── 9. ReserveInventoryModal — canonical primitives ────────────────

describe("ReserveInventoryModal — canonical composition", () => {
  const src = read(RESERVE_MODAL_PATH);

  it("composes ModalShell + Modal* primitives only (no raw shadcn Dialog)", () => {
    expect(src).toMatch(
      /import \{[\s\S]+?ModalShell,[\s\S]+?ModalHeader,[\s\S]+?ModalTitle,[\s\S]+?ModalBody,[\s\S]+?ModalFooter,[\s\S]+?\} from "@\/components\/ui\/modal"/,
    );
    expect(src).not.toMatch(/from "@\/components\/ui\/dialog"/);
  });

  it("composes FormField + FormSection primitives (Phase 2 form contract)", () => {
    expect(src).toMatch(
      /import \{[\s\S]+?FormField,[\s\S]+?FormLabel,[\s\S]+?FormSection,[\s\S]+?\} from "@\/components\/ui\/form-field"/,
    );
  });

  it("posts to the job-scoped endpoint when jobId is set, else to the ad-hoc endpoint", () => {
    expect(src).toMatch(
      /jobId\s*\?\s*`\/api\/inventory\/jobs\/\$\{jobId\}\/reservations`\s*:\s*"\/api\/inventory\/reservations"/,
    );
  });

  it("invalidates every surface that displays availability or reservations", () => {
    expect(src).toMatch(
      /queryKey:\s*\["\/api\/inventory\/jobs",\s*jobId,\s*"reservations"\]/,
    );
    expect(src).toMatch(
      /queryKey:\s*\["\/api\/inventory\/items",\s*itemId,\s*"reservations"\]/,
    );
    expect(src).toMatch(
      /queryKey:\s*\["\/api\/inventory\/locations",\s*locationId,\s*"reservations"\]/,
    );
    expect(src).toMatch(/queryKey:\s*\["\/api\/inventory\/low-stock"\]/);
  });

  it("client-side over-reserve guard uses availableQuantity (mirrors server check)", () => {
    expect(src).toMatch(
      /availableHere\s*=\s*locationId[\s\S]+?stockByLocation\.get\(locationId\)\?\.availableQuantity/,
    );
    expect(src).toMatch(/qty > availableHere/);
  });
});

// ── 10. JobReservationsSection — canonical mount + actions ─────────

describe("JobReservationsSection — canonical composition", () => {
  const src = read(SECTION_PATH);

  it("hides itself when inventory_core is disabled (capability hard-gate)", () => {
    expect(src).toMatch(
      /const inventoryEnabled = useFeatureEnabled\("inventory_core"\) === true/,
    );
    expect(src).toMatch(/if \(!inventoryEnabled\) return null;/);
  });

  it("query is gated on the same capability so it never fires when disabled", () => {
    expect(src).toMatch(
      /useQuery<\{ rows:\s*InventoryReservationRow\[\] \}>\(\{[\s\S]+?\["\/api\/inventory\/jobs",\s*jobId,\s*"reservations"\][\s\S]+?enabled:\s*inventoryEnabled/,
    );
  });

  it("provides Release + Cancel row actions through the canonical DropdownMenu", () => {
    expect(src).toMatch(
      /import \{[\s\S]+?DropdownMenu,[\s\S]+?DropdownMenuItem,[\s\S]+?\} from "@\/components\/ui\/dropdown-menu"/,
    );
    expect(src).toMatch(/data-testid=\{`job-reservation-release-\$\{row\.id\}`\}/);
    expect(src).toMatch(/data-testid=\{`job-reservation-cancel-\$\{row\.id\}`\}/);
  });

  it("uses the canonical StatusChip (no ad-hoc badge styling)", () => {
    expect(src).toMatch(
      /import \{ StatusChip \} from "@\/components\/ui\/chip"/,
    );
    expect(src).toMatch(/<StatusChip tone="info">Reserved<\/StatusChip>/);
  });

  it("mounts ReserveInventoryModal scoped to the current jobId", () => {
    expect(src).toMatch(
      /<ReserveInventoryModal[\s\S]+?jobId=\{jobId\}/,
    );
  });
});

// ── 11. JobDetailPage wiring ───────────────────────────────────────

describe("JobDetailPage — Phase 5 section mount", () => {
  const src = read(JOB_DETAIL_PATH);

  it("imports JobReservationsSection from the canonical inventory components folder", () => {
    expect(src).toMatch(
      /import \{ JobReservationsSection \} from "@\/components\/inventory\/JobReservationsSection"/,
    );
  });

  it("mounts JobReservationsSection on the page", () => {
    expect(src).toMatch(/<JobReservationsSection jobId=\{jobId!\} \/>/);
  });
});
