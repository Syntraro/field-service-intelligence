/**
 * Inventory Phase 4 — pricebook integration + line linkage
 * (2026-05-08).
 *
 * Locks the architectural contracts of the fourth inventory pass:
 *   - additive nullable line_item_id column on job_inventory_usage
 *     (FK to job_parts.id; ON DELETE SET NULL)
 *   - consumeForJob persists the optional linkage AND validates
 *     line ownership ((company, job) match) — server refuses cross-
 *     job spoofing
 *   - new per-job aggregate read (line-fulfillment) groups by
 *     line_item_id × kind in a single GROUP BY pass
 *   - new line-suggestion read filters to product + trackInventory +
 *     active items so no suggestion ever fails the consume guard
 *   - canonical PricebookPickerModal extended with capability-gated
 *     stock overlay (parallel fetch + client-side join by item id)
 *   - card chip surfaces ONLY for product + trackInventory items
 *     (services + non-stock products never see a chip)
 *   - AddInventoryToJobModal accepts prefillLineItemId + prefillQuantity;
 *     the suggestion strip in JobInventoryUsageSection threads them
 *   - no auto-consumption from quoting (the picker only displays
 *     stock; submit still goes through the existing line-item adapter
 *     contract — it does NOT create inventory_transactions)
 *   - canonical mutation invalidation set extended for the new
 *     line-fulfillment + line-suggestions queries
 *
 * Source-pin tests (no live DB / no live render).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const path = (p: string) => resolve(ROOT, p);

const MIGRATION_PATH = path("migrations/2026_05_08_inventory_line_linkage.sql");
const SCHEMA_PATH = path("shared/schema.ts");
const STORAGE_PATH = path("server/storage/inventory.ts");
const USAGE_REPO_PATH = path("server/storage/jobInventoryUsage.ts");
const ROUTE_PATH = path("server/routes/inventory.ts");
const TYPES_PATH = path("client/src/lib/inventory/types.ts");
const PICKER_PATH = path(
  "client/src/components/line-items/PricebookPickerModal.tsx",
);
const ADD_MODAL_PATH = path(
  "client/src/components/inventory/AddInventoryToJobModal.tsx",
);
const SECTION_PATH = path(
  "client/src/components/inventory/JobInventoryUsageSection.tsx",
);

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

// ── 1. Migration ───────────────────────────────────────────────────

describe("Migration — job_inventory_usage line linkage", () => {
  const sql = read(MIGRATION_PATH);

  it("adds the nullable line_item_id column with ON DELETE SET NULL", () => {
    expect(sql).toMatch(
      /ALTER TABLE job_inventory_usage[\s\S]+?ADD COLUMN IF NOT EXISTS line_item_id varchar[\s\S]+?REFERENCES job_parts\(id\) ON DELETE SET NULL/,
    );
  });

  it("creates a tenant-scoped index that excludes soft-deleted rows", () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS job_inventory_usage_line_idx[\s\S]+?ON job_inventory_usage\(company_id, job_id, line_item_id\)[\s\S]+?WHERE line_item_id IS NOT NULL AND deleted_at IS NULL/,
    );
  });

  it("does NOT alter line tables (line schema stays untouched)", () => {
    expect(sql).not.toMatch(/ALTER TABLE job_parts/);
    expect(sql).not.toMatch(/ALTER TABLE invoice_lines/);
    expect(sql).not.toMatch(/ALTER TABLE quote_lines/);
  });
});

// ── 2. Drizzle schema + Zod ────────────────────────────────────────

describe("shared/schema.ts — Phase 4 additions", () => {
  const src = read(SCHEMA_PATH);

  it("declares the lineItemId column on jobInventoryUsage", () => {
    expect(src).toMatch(/lineItemId:\s*varchar\("line_item_id"\)/);
  });

  it("consumeInventoryForJobSchema accepts optional lineItemId", () => {
    expect(src).toMatch(
      /consumeInventoryForJobSchema\s*=\s*z\.object\(\{[\s\S]+?lineItemId:\s*z\.string\(\)\.nullable\(\)\.optional\(\)/,
    );
  });
});

// ── 3. Storage: consumeForJob persists + validates the linkage ─────

describe("inventoryService.consumeForJob — Phase 4 line linkage", () => {
  const src = read(STORAGE_PATH);

  it("imports jobParts so the line-ownership check can run inside the same tx", () => {
    expect(src).toMatch(/import \{[\s\S]+?jobParts,[\s\S]+?\} from "@shared\/schema"/);
  });

  it("validates the linked line belongs to the same (company, job)", () => {
    expect(src).toMatch(
      /if \(input\.lineItemId\)[\s\S]+?\.from\(jobParts\)[\s\S]+?eq\(jobParts\.id, input\.lineItemId\)[\s\S]+?eq\(jobParts\.jobId, jobId\)[\s\S]+?eq\(jobParts\.companyId, companyId\)/,
    );
  });

  it("rejects cross-job line linkage with a structured error (no silent ignore)", () => {
    expect(src).toMatch(
      /if \(!line\)[\s\S]+?Linked line item does not belong to this job/,
    );
  });

  it("persists lineItemId on the intent row (defaults to NULL when omitted)", () => {
    expect(src).toMatch(/lineItemId:\s*input\.lineItemId \?\? null/);
  });
});

// ── 4. Storage: per-line aggregate + suggestion reads ──────────────

describe("jobInventoryUsageRepository — Phase 4 reads", () => {
  const src = read(USAGE_REPO_PATH);

  it("listForJob projection now carries lineItemId", () => {
    expect(src).toMatch(/lineItemId:\s*jobInventoryUsage\.lineItemId/);
  });

  it("fulfillmentByLineForJob groups by (line_item_id, kind) in a single GROUP BY pass", () => {
    expect(src).toMatch(/async function fulfillmentByLineForJob/);
    expect(src).toMatch(
      /\.groupBy\(jobInventoryUsage\.lineItemId, jobInventoryUsage\.kind\)/,
    );
    // Excludes soft-deleted + null-linkage rows.
    expect(src).toMatch(
      /sql`\$\{jobInventoryUsage\.lineItemId\} IS NOT NULL`/,
    );
    expect(src).toMatch(
      /fulfillmentByLineForJob[\s\S]+?isNull\(jobInventoryUsage\.deletedAt\)/,
    );
  });

  it("fulfillmentByLineForJob computes net = consumed − returned per row", () => {
    expect(src).toMatch(
      /netConsumedQuantity:\s*roundQty\(acc\.consumed - acc\.returned\)/,
    );
  });

  it("suggestLinesForJob mirrors the consume-eligibility guards (product + trackInventory + active)", () => {
    expect(src).toMatch(
      /async function suggestLinesForJob[\s\S]+?eq\(items\.type, "product"\)[\s\S]+?eq\(items\.trackInventory, true\)[\s\S]+?eq\(items\.isActive, true\)/,
    );
  });

  it("suggestLinesForJob computes remainingQuantity clamped at 0", () => {
    expect(src).toMatch(/Math\.max\(0, lineQty - net\)/);
  });

  it("repository exports the new methods", () => {
    expect(src).toMatch(/fulfillmentByLineForJob,/);
    expect(src).toMatch(/suggestLinesForJob,/);
  });
});

// ── 5. Routes: new endpoints + read-gated ──────────────────────────

describe("server/routes/inventory.ts — Phase 4 endpoints", () => {
  const src = read(ROUTE_PATH);

  it("registers GET /jobs/:jobId/line-fulfillment (read-gated)", () => {
    expect(src).toMatch(
      /router\.get\(\s*"\/jobs\/:jobId\/line-fulfillment",[\s\S]+?requirePermission\("inventory\.view"\)[\s\S]+?fulfillmentByLineForJob/,
    );
  });

  it("registers GET /jobs/:jobId/line-suggestions (read-gated)", () => {
    expect(src).toMatch(
      /router\.get\(\s*"\/jobs\/:jobId\/line-suggestions",[\s\S]+?requirePermission\("inventory\.view"\)[\s\S]+?suggestLinesForJob/,
    );
  });

  it("inventory_core mount-level gate STILL applies to every Phase 4 route", () => {
    expect(src).toMatch(/router\.use\(requireFeature\("inventory_core"\)\)/);
  });
});

// ── 6. Wire types ──────────────────────────────────────────────────

describe("client wire types — Phase 4 shapes", () => {
  const src = read(TYPES_PATH);

  it("declares JobLineFulfillment with consumed / returned / net", () => {
    expect(src).toMatch(
      /export interface JobLineFulfillment \{[\s\S]+?lineItemId: string;[\s\S]+?consumedQuantity: string;[\s\S]+?returnedQuantity: string;[\s\S]+?netConsumedQuantity: string;/,
    );
  });

  it("declares JobLineSuggestion with the consume-eligibility hints", () => {
    expect(src).toMatch(
      /export interface JobLineSuggestion \{[\s\S]+?lineItemId: string;[\s\S]+?itemId: string;[\s\S]+?lineQuantity: string;[\s\S]+?netConsumedQuantity: string;[\s\S]+?remainingQuantity: string;/,
    );
  });
});

// ── 7. PricebookPickerModal — capability-gated stock overlay ───────

describe("PricebookPickerModal — Phase 4 stock overlay", () => {
  const src = read(PICKER_PATH);

  it("imports the canonical capability hook (no parallel feature check)", () => {
    expect(src).toMatch(
      /import \{ useFeatureEnabled \} from "@\/hooks\/useEntitlements"/,
    );
  });

  it("declares the canonical PricebookItemStockOverlay shape (exported for any future external picker)", () => {
    // Phase 5 (2026-05-08) added totalReserved between totalOnHand and
    // locationCount — kept additive so the overlay can distinguish
    // "fully reserved" from "out of stock". The pin still locks every
    // Phase 4 field by name; locationCount is verified separately.
    expect(src).toMatch(
      /export interface PricebookItemStockOverlay \{[\s\S]*?trackInventory: boolean;[\s\S]*?totalAvailable: string;[\s\S]*?totalOnHand: string;[\s\S]*?locationCount: number;/,
    );
  });

  it("useStockOverlay returns null when inventory_core is disabled (no fetch fires)", () => {
    expect(src).toMatch(
      /const inventoryEnabled = useFeatureEnabled\("inventory_core"\) === true/,
    );
    expect(src).toMatch(/enabled: opts\.enabled && inventoryEnabled/);
    expect(src).toMatch(/if \(!inventoryEnabled \|\| !query\.data\) return null/);
  });

  it("fetches /api/inventory/items (canonical Phase 1 endpoint — no parallel implementation)", () => {
    expect(src).toMatch(/fetch\("\/api\/inventory\/items"/);
    expect(src).toMatch(/queryKey:\s*\["\/api\/inventory\/items"\]/);
  });

  it("threads the per-row stock overlay into PricebookItemCard", () => {
    expect(src).toMatch(/const stockOverlay = useStockOverlay\(/);
    expect(src).toMatch(/stock=\{stockOverlay\?\.get\(item\.id\)\}/);
  });

  it("PricebookItemCard renders the chip ONLY when item is product + trackInventory", () => {
    // Card has a guard `stock && stock.trackInventory` before
    // emitting any chip JSX. Service items + non-stock products
    // never see a chip even if the overlay row exists.
    expect(src).toMatch(/\{stock && stock\.trackInventory && \(/);
  });

  it("renders Out-of-Stock vs In-Stock chip with canonical testids", () => {
    // Phase 5 inserted a "Fully reserved" intermediate state between
    // out-of-stock and in-stock, and flipped the out-of-stock guard to
    // totalOnHand (was totalAvailable) so a partially-reserved item
    // still reads as "in stock — N available". The two terminal chips
    // (out / in) keep their testids; "Fully reserved" is asserted by
    // the Phase 5 test file.
    expect(src).toMatch(/Out of stock/);
    expect(src).toMatch(/`pricebook-item-stock-out-\$\{item\.id\}`/);
    expect(src).toMatch(/`pricebook-item-stock-in-\$\{item\.id\}`/);
  });
});

// ── 8. AddInventoryToJobModal — prefill linkage ────────────────────

describe("AddInventoryToJobModal — Phase 4 prefill + linkage", () => {
  const src = read(ADD_MODAL_PATH);

  it("accepts the new prefill props (line + quantity)", () => {
    expect(src).toMatch(/prefillLineItemId\?:\s*string \| null/);
    expect(src).toMatch(/prefillQuantity\?:\s*string \| null/);
  });

  it("applies prefill on open + resets on close", () => {
    expect(src).toMatch(
      /useEffect\(\(\)\s*=>\s*\{[\s\S]+?setQuantity\(prefillQuantity \?\? ""\)/,
    );
    expect(src).toMatch(
      /\}, \[open, prefillItemId, prefillLocationId, prefillQuantity\]\);/,
    );
  });

  it("forwards lineItemId to the consume endpoint (server validates ownership)", () => {
    expect(src).toMatch(/lineItemId:\s*prefillLineItemId \?\? null/);
  });

  it("invalidates the new line-fulfillment + line-suggestions queries on success", () => {
    expect(src).toMatch(
      /queryKey:\s*\["\/api\/inventory\/jobs",\s*jobId,\s*"line-fulfillment"\]/,
    );
    expect(src).toMatch(
      /queryKey:\s*\["\/api\/inventory\/jobs",\s*jobId,\s*"line-suggestions"\]/,
    );
  });
});

// ── 9. JobInventoryUsageSection — suggestion strip ─────────────────

describe("JobInventoryUsageSection — Phase 4 suggestion strip", () => {
  const src = read(SECTION_PATH);

  it("imports the JobLineSuggestion wire type", () => {
    expect(src).toMatch(
      /import type \{[\s\S]+?JobLineSuggestion,[\s\S]+?\} from "@\/lib\/inventory\/types"/,
    );
  });

  it("fetches the line-suggestions endpoint, gated on the same capability", () => {
    expect(src).toMatch(
      /useQuery<\{ rows:\s*JobLineSuggestion\[\] \}>\(\{[\s\S]+?\["\/api\/inventory\/jobs",\s*jobId,\s*"line-suggestions"\][\s\S]+?enabled:\s*inventoryEnabled/,
    );
  });

  it("filters out suggestions whose remaining qty is zero (no nagging)", () => {
    expect(src).toMatch(
      /\.filter\(\s*\(s\)\s*=>\s*Number\(s\.remainingQuantity\) > 0,?\s*\)/,
    );
  });

  it("renders the suggestion strip with canonical testid", () => {
    expect(src).toMatch(/data-testid="job-inventory-usage-suggestions"/);
    expect(src).toMatch(/data-testid=\{`job-inventory-suggestion-\$\{s\.lineItemId\}`\}/);
  });

  it("clicking a suggestion sets prefill (item + qty + line linkage) + opens the SAME Add modal", () => {
    expect(src).toMatch(
      /setAddPrefill\(\{[\s\S]+?itemId:\s*s\.itemId,[\s\S]+?quantity:\s*s\.remainingQuantity,[\s\S]+?lineItemId:\s*s\.lineItemId,[\s\S]+?\}\);[\s\S]+?setAddOpen\(true\);/,
    );
    // Same modal mount; no duplicate AddInventoryToJobModal instance.
    const mounts = src.match(/<AddInventoryToJobModal\b/g) ?? [];
    expect(mounts.length).toBe(1);
  });

  it("the rail-driven '+ Add Inventory' button clears prefill so the rail flow stays clean", () => {
    expect(src).toMatch(
      /onClick=\{\(\)\s*=>\s*\{[\s\S]+?setAddPrefill\(null\);[\s\S]+?setAddOpen\(true\);[\s\S]+?\}/,
    );
  });

  it("the modal mount threads prefill props from the strip click", () => {
    expect(src).toMatch(
      /<AddInventoryToJobModal[\s\S]+?prefillItemId=\{addPrefill\?\.itemId\}[\s\S]+?prefillQuantity=\{addPrefill\?\.quantity\}[\s\S]+?prefillLineItemId=\{addPrefill\?\.lineItemId\}/,
    );
  });
});

// ── 10. Safety: no auto-consumption from quoting ───────────────────

describe("Safety: no auto-consumption during quoting / invoice / picker submit", () => {
  const pickerSrc = read(PICKER_PATH);

  it("PricebookPickerModal does NOT call /api/inventory/jobs/* or any consumption endpoint on submit", () => {
    // The picker is read-only against /api/inventory/items (overlay)
    // and writes ONLY through the existing line-item adapter contract.
    // Any /api/inventory/jobs/.../usage call from this file would be
    // a silent inventory mutation triggered by quoting — rejected.
    expect(pickerSrc).not.toMatch(/\/api\/inventory\/jobs\//);
    expect(pickerSrc).not.toMatch(/\/api\/inventory\/transfers\b/);
    expect(pickerSrc).not.toMatch(/\/api\/inventory\/adjustments\b/);
  });

  it("server consumeForJob endpoint is the ONLY mutation surface for usage rows (no shortcut routes)", () => {
    const routeSrc = read(ROUTE_PATH);
    // The only POSTs that touch jobInventoryUsage go through the
    // canonical /jobs/:jobId/usage path. A tester adding a future
    // shortcut would have to add ANOTHER inventoryService call to
    // this file — pin that the existing surface is unique.
    const consumeCalls = routeSrc.match(/inventoryService\.consumeForJob/g) ?? [];
    expect(consumeCalls.length).toBe(1);
  });
});
