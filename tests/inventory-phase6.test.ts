/**
 * Inventory Phase 6 — streamlined tech-on-active-job consume flow
 * (2026-05-08).
 *
 * Locks the architectural contracts of the sixth inventory pass:
 *   - new server endpoint GET /api/inventory/locations/assigned-to-me,
 *     gated on inventory_core + inventory.view, returning the (single)
 *     active inventory_location whose assignedUserId matches the
 *     caller, or null
 *   - the literal /assigned-to-me route is registered BEFORE the
 *     /:id param route so Express does not swallow it
 *   - inventoryLocationsRepository.getAssignedLocationForUser uses
 *     the canonical tenant + isActive filters and orders by updatedAt
 *     desc when more than one assignment exists
 *   - ProductOption.trackInventory threaded additively through
 *     normalizeProductRow (camelCase + snake_case fallback, defaults
 *     to false) so the tech sheet can gate on a single canonical flag
 *   - useTechVisitDetail exposes a new consumeFromTechSheet mutation
 *     that posts to the canonical /api/inventory/jobs/:jobId/usage
 *     endpoint and invalidates the canonical Phase 3-5 query set
 *   - AddPartSheet renders an inline consume disclosure ONLY when
 *     ALL gates pass: inventory_core enabled, product is product +
 *     trackInventory, visit has a parent jobId, AND a consume
 *     location is resolved
 *   - the consume toggle defaults ON; off by default ONLY for
 *     surfaces where the disclosure does not render
 *   - the chained consume mutation never rolls back the line on
 *     failure (line is the primary operation; consume failure is
 *     surfaced via the canonical error toast)
 *   - service items, non-stock products, and ad-hoc visits with no
 *     parent job NEVER trigger the consume disclosure
 *   - the office add-line flow (Pricebook → /api/jobs/:jobId/parts)
 *     is NOT wired to auto-consume — only the tech surface is
 *
 * Source-pin tests (no live DB / no live render).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const STORAGE_PATH = path("server/storage/inventory.ts");
const ROUTE_PATH = path("server/routes/inventory.ts");
const PRODUCT_ENTITY_PATH = path("client/src/lib/entities/productEntity.ts");
const TECH_HOOK_PATH = path("client/src/tech-app/hooks/useTechVisitDetail.ts");
const TECH_VISIT_PATH = path("client/src/tech-app/pages/VisitDetailPage.tsx");
const JOB_DETAIL_PATH = path("client/src/pages/JobDetailPage.tsx");

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

// ── 1. Server: assigned-location resolver ──────────────────────────

describe("inventoryLocationsRepository.getAssignedLocationForUser", () => {
  const src = read(STORAGE_PATH);

  it("filters by tenant + assignedUserId + isActive (canonical filter trio)", () => {
    expect(src).toMatch(
      /async function getAssignedLocationForUser[\s\S]+?eq\(inventoryLocations\.companyId, companyId\)[\s\S]+?eq\(inventoryLocations\.assignedUserId, userId\)[\s\S]+?eq\(inventoryLocations\.isActive, true\)/,
    );
  });

  it("returns deterministically (most-recently-updated row first)", () => {
    expect(src).toMatch(
      /getAssignedLocationForUser[\s\S]+?\.orderBy\(desc\(inventoryLocations\.updatedAt\)\)[\s\S]+?\.limit\(1\)/,
    );
  });

  it("repository re-exports the new method alongside the Phase 1-5 set", () => {
    expect(src).toMatch(
      /export const inventoryLocationsRepository = \{[\s\S]+?getAssignedLocationForUser,[\s\S]+?\};/,
    );
  });
});

// ── 2. Server: route ───────────────────────────────────────────────

describe("server/routes/inventory.ts — assigned-to-me endpoint", () => {
  const src = read(ROUTE_PATH);

  it("registers GET /locations/assigned-to-me gated on inventory.view", () => {
    expect(src).toMatch(
      /router\.get\(\s*"\/locations\/assigned-to-me",[\s\S]+?requirePermission\("inventory\.view"\)[\s\S]+?getAssignedLocationForUser/,
    );
  });

  it("registers the literal route BEFORE the /:id param route (Express ordering)", () => {
    const literalIdx = src.indexOf('"/locations/assigned-to-me"');
    const paramIdx = src.indexOf('"/locations/:id"');
    expect(literalIdx).toBeGreaterThan(-1);
    expect(paramIdx).toBeGreaterThan(-1);
    expect(literalIdx).toBeLessThan(paramIdx);
  });

  it("returns { location: ... | null } so the client can short-circuit on no assignment", () => {
    expect(src).toMatch(/res\.json\(\{\s*location:\s*row \?\? null\s*\}\)/);
  });

  it("inventory_core mount-level gate STILL applies", () => {
    expect(src).toMatch(/router\.use\(requireFeature\("inventory_core"\)\)/);
  });
});

// ── 3. Client: ProductOption.trackInventory ────────────────────────

describe("ProductOption — trackInventory threading", () => {
  const src = read(PRODUCT_ENTITY_PATH);

  it("declares trackInventory as an optional boolean", () => {
    expect(src).toMatch(/trackInventory\?:\s*boolean;/);
  });

  it("normalizeProductRow reads camelCase first, then snake_case, defaulting to false", () => {
    expect(src).toMatch(
      /trackInventory:\s*\n?\s*typeof r\.trackInventory === "boolean"\s*\?\s*r\.trackInventory\s*:\s*typeof r\.track_inventory === "boolean"\s*\?\s*r\.track_inventory\s*:\s*false,/,
    );
  });
});

// ── 4. Tech hook: consumeFromTechSheet mutation ────────────────────

describe("useTechVisitDetail — consumeFromTechSheet companion mutation", () => {
  const src = read(TECH_HOOK_PATH);

  it("posts to the canonical /api/inventory/jobs/:jobId/usage endpoint", () => {
    expect(src).toMatch(
      /consumeFromTechSheetMutation = useMutation\(\{[\s\S]+?`\/api\/inventory\/jobs\/\$\{jobId\}\/usage`/,
    );
  });

  it("invalidates the full Phase 3-5 query set on success", () => {
    expect(src).toMatch(
      /consumeFromTechSheetMutation[\s\S]+?queryKey:\s*\["\/api\/inventory\/items"\]/,
    );
    expect(src).toMatch(
      /consumeFromTechSheetMutation[\s\S]+?queryKey:\s*\["\/api\/inventory\/jobs",\s*variables\.jobId,\s*"usage"\]/,
    );
    expect(src).toMatch(
      /consumeFromTechSheetMutation[\s\S]+?queryKey:\s*\["\/api\/inventory\/jobs",\s*variables\.jobId,\s*"line-fulfillment"\]/,
    );
    expect(src).toMatch(
      /consumeFromTechSheetMutation[\s\S]+?queryKey:\s*\["\/api\/inventory\/jobs",\s*variables\.jobId,\s*"reservations"\]/,
    );
    expect(src).toMatch(
      /consumeFromTechSheetMutation[\s\S]+?queryKey:\s*\["\/api\/inventory\/low-stock"\]/,
    );
  });

  it("hook return shape exposes consumeFromTechSheet as a peer of addPart (NOT a replacement)", () => {
    expect(src).toMatch(/addPart:\s*addPartMutation,/);
    expect(src).toMatch(/consumeFromTechSheet:\s*consumeFromTechSheetMutation,/);
  });
});

// ── 5. AddPartSheet: inline disclosure gates ───────────────────────

describe("AddPartSheet — inventory consume disclosure", () => {
  const src = read(TECH_VISIT_PATH);

  it("imports the canonical capability hook + inventory wire types", () => {
    expect(src).toMatch(
      /import \{ useFeatureEnabled \} from "@\/hooks\/useEntitlements"/,
    );
    expect(src).toMatch(
      /import type \{[\s\S]+?InventoryLocation,[\s\S]+?ItemLocationStock,[\s\S]+?\} from "@\/lib\/inventory\/types"/,
    );
  });

  it("accepts jobId + consumeFromTechSheet props on the sheet", () => {
    expect(src).toMatch(/jobId:\s*string \| null;/);
    expect(src).toMatch(
      /consumeFromTechSheet:\s*\{\s*mutateAsync:\s*\(p:\s*\{[\s\S]+?jobId:\s*string;[\s\S]+?itemId:\s*string;[\s\S]+?locationId:\s*string;/,
    );
  });

  it("gates the disclosure on the canonical four-condition rule", () => {
    // Capability + tracked product + active job + resolved location.
    expect(src).toMatch(
      /const showConsumeDisclosure =\s*\n?\s*inventoryEnabled && isTrackedProduct && !!jobId && !!consumeLocationId;/,
    );
  });

  it("isTrackedProduct guard requires product type AND trackInventory flag", () => {
    expect(src).toMatch(
      /const isTrackedProduct =\s*\n?\s*!!selected && selected\.type === "product" && selected\.trackInventory === true;/,
    );
  });

  it("toggle defaults ON (operational rule: techs add tracked products AFTER use)", () => {
    expect(src).toMatch(/useState\(true\);[\s\S]*?(?:\/\/.*|\n)?\s*const \[consumeLocationOverride/);
  });

  it("availability hint pulls from the canonical /items/:id/locations endpoint", () => {
    expect(src).toMatch(
      /useQuery<\{ rows:\s*ItemLocationStock\[\] \}>\(\{[\s\S]+?queryKey:\s*\["\/api\/inventory\/items",\s*selected\?\.id \?\? null,\s*"locations"\][\s\S]+?enabled:\s*inventoryEnabled && isTrackedProduct/,
    );
  });

  it("assigned-location query is gated on the inventory capability", () => {
    expect(src).toMatch(
      /useQuery<\{\s*location:\s*InventoryLocation \| null\s*\}>\(\{[\s\S]+?queryKey:\s*\["\/api\/inventory\/locations\/assigned-to-me"\][\s\S]+?enabled:\s*inventoryEnabled/,
    );
  });

  it("renders the disclosure with canonical testids", () => {
    expect(src).toMatch(/data-testid="add-part-inventory-consume-disclosure"/);
    expect(src).toMatch(/data-testid="add-part-consume-toggle"/);
    expect(src).toMatch(/data-testid="add-part-consume-source-name"/);
    expect(src).toMatch(/data-testid="add-part-consume-available"/);
  });
});

// ── 6. AddPartSheet: chained submit semantics ──────────────────────

describe("AddPartSheet handleSubmit — chained consume semantics", () => {
  const src = read(TECH_VISIT_PATH);

  it("fires the line-create mutation FIRST, then the consume hop", () => {
    // Line POST must complete and return the line id before the
    // chained consume runs.
    expect(src).toMatch(
      /const partResp = await addPart\.mutateAsync\(\{[\s\S]+?\}\);[\s\S]+?if \(showConsumeDisclosure && consumeEnabled && jobId && consumeLocationId\)/,
    );
  });

  it("forwards the new line id as lineItemId so per-line fulfillment reflects the consume", () => {
    expect(src).toMatch(
      /lineItemId:[\s\S]+?\(partResp && typeof partResp === "object" && "id" in partResp\)[\s\S]+?\(partResp as any\)\.id[\s\S]+?: null,/,
    );
  });

  it("soft-guards insufficient stock locally before round-tripping (faster failure)", () => {
    expect(src).toMatch(
      /if \(availableHere != null && qtyNum > availableHere\)[\s\S]+?Source has only \$\{availableHere\} available[\s\S]+?line saved without inventory deduction/,
    );
  });

  it("on consume failure the line is NEVER rolled back (line is the primary intent)", () => {
    // The chained consume catch only sets `consumeFailed` and bubbles
    // through onError — no undo of the line happens.
    expect(src).toMatch(/consumeFailed = err;/);
    // Inverse pin: no rollback path in handleSubmit.
    const slice = src.slice(
      src.indexOf("const handleSubmit ="),
      src.indexOf("const handleChipTap ="),
    );
    expect(slice).not.toMatch(/deletePart|rollback|undo/i);
  });

  it("multi-add reset (keepOpen) restores the toggle to ON for the next selection", () => {
    expect(src).toMatch(/setConsumeEnabled\(true\);/);
    expect(src).toMatch(/setConsumeLocationOverride\(null\);/);
  });
});

// ── 7. AddPartSheet mount: passes the new props ────────────────────

describe("VisitDetailPage — AddPartSheet mount", () => {
  const src = read(TECH_VISIT_PATH);

  it("destructures consumeFromTechSheet from useTechVisitDetail", () => {
    expect(src).toMatch(/consumeFromTechSheet,/);
  });

  it("threads visit.jobId + consumeFromTechSheet into the sheet", () => {
    expect(src).toMatch(
      /<AddPartSheet[\s\S]+?jobId=\{visit\.jobId \?\? null\}[\s\S]+?consumeFromTechSheet=\{consumeFromTechSheet\}/,
    );
  });
});

// ── 8. Office surface: NOT wired to auto-consume ───────────────────

describe("JobDetailPage — office add-line flow stays separate from auto-consume", () => {
  const src = read(JOB_DETAIL_PATH);

  it("does NOT chain a consume call from bulkAddLines / jobPartsAdapter", () => {
    // Phase 6's auto-consume is intentionally tech-only. The office
    // pricebook flow continues to add lines without consuming
    // inventory; office users use the JobInventoryUsageSection's
    // canonical Add Inventory modal (Phase 3) when they want to
    // record a consumption.
    const slice = src.slice(
      src.indexOf("bulkAddLines:"),
      src.indexOf("hydrateDraft:"),
    );
    expect(slice).not.toMatch(/\/api\/inventory\/jobs\/.*\/usage/);
    expect(slice).not.toMatch(/consumeFromTechSheet/);
    expect(slice).not.toMatch(/inventoryService\.consumeForJob/);
  });
});
