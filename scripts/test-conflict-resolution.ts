/**
 * End-to-end conflict resolution test script.
 *
 * Exercises:
 *   1. Catalog conflict: two local items with same name → preview shows conflict → run behaviors
 *   2. Customer conflict: two local customer_companies with same name → preview shows conflict → run behaviors
 *   3. Invariant checks after each run
 *
 * Usage:
 *   npx tsx scripts/test-conflict-resolution.ts
 *
 * Requires DATABASE_URL to be set.
 */

import { db } from "../server/db";
import { items, customerCompanies, clientLocations, companies } from "../shared/schema";
import { eq, and, isNull, isNotNull, sql } from "drizzle-orm";
import { QboCatalogImportService } from "../server/services/qbo/QboCatalogImportService";
import { QboCustomerImportService } from "../server/services/qbo/QboCustomerImportService";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_COMPANY_ID = "__test_conflict_" + Date.now();
const PREFIX = "[TEST]";

function log(msg: string) {
  console.log(`${PREFIX} ${msg}`);
}
function logJson(label: string, obj: unknown) {
  console.log(`${PREFIX} ${label}:`);
  console.log(JSON.stringify(obj, null, 2));
}

/** Minimal mock QboClient that returns canned QBO items/customers */
function createMockCatalogClient(qboItems: Array<{ Id: string; Name: string; Sku?: string; Type: string; Active: boolean; SyncToken: string; Description?: string; UnitPrice?: number; PurchaseCost?: number; Taxable?: boolean }>) {
  // The service reads response.raw.QueryResponse.Item and requires response.data to be truthy
  return {
    get: async (_path: string) => ({
      success: true,
      data: { QueryResponse: { Item: qboItems } },
      raw: { QueryResponse: { Item: qboItems } },
    }),
  } as any;
}

function createMockCustomerClient(qboCustomers: Array<{ Id: string; SyncToken: string; DisplayName: string; CompanyName?: string; Active: boolean; ParentRef?: { value: string }; BillWithParent?: boolean; PrimaryEmailAddr?: { Address: string } }>) {
  return {
    queryCustomers: async (_query: string) => ({
      success: true,
      data: { Customer: qboCustomers },
    }),
  } as any;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
async function cleanup() {
  log("Cleaning up test data...");
  await db.delete(items).where(eq(items.companyId, TEST_COMPANY_ID));
  await db.delete(clientLocations).where(eq(clientLocations.companyId, TEST_COMPANY_ID));
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, TEST_COMPANY_ID));
  await db.delete(companies).where(eq(companies.id, TEST_COMPANY_ID));
  log("Cleanup done.");
}

async function ensureTestCompany() {
  await db.insert(companies).values({ id: TEST_COMPANY_ID, name: "Test Conflict Company" }).onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Invariant checks
// ---------------------------------------------------------------------------
async function checkInvariants(label: string) {
  log(`--- Invariant check: ${label} ---`);

  // items: duplicate qbo_item_id per company
  const dupItemRows = await db.execute(sql`
    SELECT qbo_item_id, count(*) as cnt
    FROM items
    WHERE company_id = ${TEST_COMPANY_ID} AND qbo_item_id IS NOT NULL AND deleted_at IS NULL
    GROUP BY qbo_item_id HAVING count(*) > 1
  `);
  const dupItemCount = dupItemRows.rows?.length ?? 0;
  log(`  items: duplicate qbo_item_id per company = ${dupItemCount}`);

  // customer_companies: duplicate qbo_customer_id per company
  const dupCCRows = await db.execute(sql`
    SELECT qbo_customer_id, count(*) as cnt
    FROM customer_companies
    WHERE company_id = ${TEST_COMPANY_ID} AND qbo_customer_id IS NOT NULL AND deleted_at IS NULL
    GROUP BY qbo_customer_id HAVING count(*) > 1
  `);
  const dupCCCount = dupCCRows.rows?.length ?? 0;
  log(`  customer_companies: duplicate qbo_customer_id per company = ${dupCCCount}`);

  // client_locations: duplicate qbo_customer_id per company
  const dupCLRows = await db.execute(sql`
    SELECT qbo_customer_id, count(*) as cnt
    FROM client_locations
    WHERE company_id = ${TEST_COMPANY_ID} AND qbo_customer_id IS NOT NULL AND deleted_at IS NULL
    GROUP BY qbo_customer_id HAVING count(*) > 1
  `);
  const dupCLCount = dupCLRows.rows?.length ?? 0;
  log(`  client_locations: duplicate qbo_customer_id per company = ${dupCLCount}`);

  // linked items missing sync fields
  const missingSyncRows = await db.execute(sql`
    SELECT count(*)::int as cnt FROM items
    WHERE company_id = ${TEST_COMPANY_ID} AND qbo_item_id IS NOT NULL AND deleted_at IS NULL
      AND (qbo_sync_status IS NULL OR qbo_sync_status = 'NOT_SYNCED')
  `);
  log(`  linked items missing sync fields = ${(missingSyncRows.rows?.[0] as any)?.cnt ?? 0}`);

  if (dupItemCount > 0 || dupCCCount > 0 || dupCLCount > 0) {
    throw new Error("INVARIANT VIOLATION — duplicates detected!");
  }
  log(`  All invariants passed.`);
}

// ===========================================================================
// TEST 1: Catalog conflict
// ===========================================================================
async function testCatalogConflict() {
  log("========================================");
  log("TEST 1: CATALOG CONFLICT");
  log("========================================");

  // Setup: two active, non-deleted local items with SAME normalized name and blank SKU
  const [item1] = await db.insert(items).values({
    companyId: TEST_COMPANY_ID, type: "service", name: "Widget Alpha", sku: null, isActive: true, isTaxable: true,
  }).returning({ id: items.id });
  const [item2] = await db.insert(items).values({
    companyId: TEST_COMPANY_ID, type: "product", name: "Widget Alpha", sku: null, isActive: true, isTaxable: true,
  }).returning({ id: items.id });
  log(`Created two local items: ${item1.id}, ${item2.id} — both named "Widget Alpha"`);

  // QBO item with that same name
  const qboItems = [
    { Id: "QBO-100", Name: "Widget Alpha", Type: "Service", Active: true, SyncToken: "0" },
  ];

  const client = createMockCatalogClient(qboItems);

  // 1a. Preview (merge) — must show conflict
  log("\n--- 1a. Preview (merge) ---");
  const svc1 = new QboCatalogImportService(client, TEST_COMPANY_ID);
  const preview = await svc1.importCatalog({ dryRun: true, mode: "merge" });
  logJson("Preview result (conflicts snippet)", {
    "totals.conflicts": preview.totals.conflicts,
    "totals.fetched": preview.totals.fetched,
    "conflicts.length": preview.conflicts.length,
    conflicts: preview.conflicts.map(c => ({
      qbo: c.qbo,
      matchBasis: c.matchBasis,
      candidateCount: c.candidates.length,
      candidateIds: c.candidates.map(x => x.localId),
      message: c.message,
    })),
    sample: preview.sample,
  });

  if (preview.totals.conflicts !== 1) throw new Error(`Expected 1 conflict, got ${preview.totals.conflicts}`);
  if (preview.conflicts[0].candidates.length !== 2) throw new Error(`Expected 2 candidates, got ${preview.conflicts[0].candidates.length}`);
  log("PASS: Preview returned 1 conflict with 2 candidates.");

  // 1b. Run without resolutions — conflict skipped
  log("\n--- 1b. Run without resolutions ---");
  const svc2 = new QboCatalogImportService(client, TEST_COMPANY_ID);
  const runNoRes = await svc2.importCatalog({ dryRun: false, mode: "merge" });
  logJson("Run (no resolution) result", {
    "totals.conflicts": runNoRes.totals.conflicts,
    "totals.created": runNoRes.totals.created,
    "totals.updated": runNoRes.totals.updated,
    sample: runNoRes.sample,
  });
  if (runNoRes.totals.conflicts !== 1) throw new Error(`Expected 1 conflict, got ${runNoRes.totals.conflicts}`);
  if (runNoRes.totals.created !== 0) throw new Error(`Expected 0 created, got ${runNoRes.totals.created}`);
  log("PASS: Run with no resolution skipped the conflict.");

  // Verify neither item is linked
  const linked1 = await db.select({ qboItemId: items.qboItemId }).from(items).where(eq(items.id, item1.id));
  const linked2 = await db.select({ qboItemId: items.qboItemId }).from(items).where(eq(items.id, item2.id));
  if (linked1[0].qboItemId || linked2[0].qboItemId) throw new Error("Expected both items to remain unlinked");
  log("PASS: Neither item was linked.");

  await checkInvariants("after catalog run (no resolution)");

  // 1c. Run with MAP resolution — chosen local links
  log("\n--- 1c. Run with MAP resolution ---");
  const svc3 = new QboCatalogImportService(client, TEST_COMPANY_ID);
  const runMap = await svc3.importCatalog({
    dryRun: false, mode: "merge",
    resolutions: { "QBO-100": { action: "MAP", localId: item1.id } },
  });
  logJson("Run (MAP) result", {
    "totals.updated": runMap.totals.updated,
    "totals.matched": runMap.totals.matched,
    sample: runMap.sample,
  });
  if (runMap.totals.updated !== 1) throw new Error(`Expected 1 updated, got ${runMap.totals.updated}`);

  const mappedItem = await db.select({ qboItemId: items.qboItemId }).from(items).where(eq(items.id, item1.id));
  const otherItem = await db.select({ qboItemId: items.qboItemId }).from(items).where(eq(items.id, item2.id));
  if (mappedItem[0].qboItemId !== "QBO-100") throw new Error(`Expected item1 linked to QBO-100, got ${mappedItem[0].qboItemId}`);
  if (otherItem[0].qboItemId) throw new Error(`Expected item2 to remain unlinked, got ${otherItem[0].qboItemId}`);
  log("PASS: MAP linked chosen item, other remains unlinked.");

  await checkInvariants("after catalog MAP");

  // 1d. Clean the link, then run with CREATE resolution
  log("\n--- 1d. Run with CREATE resolution ---");
  await db.update(items).set({ qboItemId: null, qboSyncToken: null, qboSyncStatus: "NOT_SYNCED", qboLastSyncedAt: null }).where(eq(items.id, item1.id));

  const svc4 = new QboCatalogImportService(client, TEST_COMPANY_ID);
  const runCreate = await svc4.importCatalog({
    dryRun: false, mode: "merge",
    resolutions: { "QBO-100": { action: "CREATE" } },
  });
  logJson("Run (CREATE) result", {
    "totals.created": runCreate.totals.created,
    sample: runCreate.sample,
  });
  if (runCreate.totals.created !== 1) throw new Error(`Expected 1 created, got ${runCreate.totals.created}`);

  // Verify a new item was created with qboItemId
  const newItems = await db.select({ id: items.id, qboItemId: items.qboItemId, name: items.name })
    .from(items)
    .where(and(eq(items.companyId, TEST_COMPANY_ID), eq(items.qboItemId, "QBO-100"), isNull(items.deletedAt)));
  if (newItems.length !== 1) throw new Error(`Expected 1 item linked to QBO-100, got ${newItems.length}`);
  if (newItems[0].id === item1.id || newItems[0].id === item2.id) throw new Error("Expected new item to be a different ID");
  log(`PASS: CREATE produced new item ${newItems[0].id} linked to QBO-100.`);

  await checkInvariants("after catalog CREATE");
}

// ===========================================================================
// TEST 2: Customer conflict
// ===========================================================================
async function testCustomerConflict() {
  log("\n========================================");
  log("TEST 2: CUSTOMER CONFLICT");
  log("========================================");

  // Setup: two active, non-deleted local customer_companies with SAME name and no qboCustomerId
  const [cc1] = await db.insert(customerCompanies).values({
    companyId: TEST_COMPANY_ID, name: "Acme HVAC Duplicate", isActive: true,
  }).returning({ id: customerCompanies.id });
  const [cc2] = await db.insert(customerCompanies).values({
    companyId: TEST_COMPANY_ID, name: "Acme HVAC Duplicate", isActive: true,
  }).returning({ id: customerCompanies.id });
  log(`Created two local companies: ${cc1.id}, ${cc2.id} — both named "Acme HVAC Duplicate"`);

  // QBO customer with that DisplayName
  const qboCustomers = [
    { Id: "QBO-200", SyncToken: "0", DisplayName: "Acme HVAC Duplicate", CompanyName: "Acme HVAC Duplicate", Active: true },
  ];

  const client = createMockCustomerClient(qboCustomers);

  // 2a. Preview — must show conflict
  log("\n--- 2a. Preview (merge) ---");
  const svc1 = new QboCustomerImportService(client, TEST_COMPANY_ID);
  const preview = await svc1.importCustomers({ dryRun: true, mode: "merge" });
  logJson("Preview result (conflicts snippet)", {
    "totals.conflicts": preview.totals.conflicts,
    "totals.fetched": preview.totals.fetched,
    "conflicts.length": preview.conflicts.length,
    conflicts: preview.conflicts.map(c => ({
      qbo: c.qbo,
      matchBasis: c.matchBasis,
      candidateCount: c.candidates.length,
      candidateIds: c.candidates.map(x => x.localId),
      message: c.message,
    })),
    sample: preview.sample,
  });

  if (preview.totals.conflicts !== 1) throw new Error(`Expected 1 conflict, got ${preview.totals.conflicts}`);
  if (preview.conflicts[0].candidates.length !== 2) throw new Error(`Expected 2 candidates`);
  log("PASS: Preview returned 1 conflict with 2 candidates.");

  // 2b. Run without resolutions — conflict skipped
  log("\n--- 2b. Run without resolutions ---");
  const svc2 = new QboCustomerImportService(client, TEST_COMPANY_ID);
  const runNoRes = await svc2.importCustomers({ dryRun: false, mode: "merge" });
  logJson("Run (no resolution) result", {
    "totals.conflicts": runNoRes.totals.conflicts,
    "wouldCreate": runNoRes.wouldCreate,
    "created": runNoRes.created,
    sample: runNoRes.sample,
  });
  if (runNoRes.totals.conflicts !== 1) throw new Error(`Expected 1 conflict, got ${runNoRes.totals.conflicts}`);

  const linked1 = await db.select({ qboCustomerId: customerCompanies.qboCustomerId }).from(customerCompanies).where(eq(customerCompanies.id, cc1.id));
  const linked2 = await db.select({ qboCustomerId: customerCompanies.qboCustomerId }).from(customerCompanies).where(eq(customerCompanies.id, cc2.id));
  if (linked1[0].qboCustomerId || linked2[0].qboCustomerId) throw new Error("Expected both companies to remain unlinked");
  log("PASS: Run with no resolution skipped the conflict.");

  await checkInvariants("after customer run (no resolution)");

  // 2c. Run with MAP
  log("\n--- 2c. Run with MAP resolution ---");
  const svc3 = new QboCustomerImportService(client, TEST_COMPANY_ID);
  const runMap = await svc3.importCustomers({
    dryRun: false, mode: "merge",
    resolutions: { "QBO-200": { action: "MAP", localId: cc1.id } },
  });
  logJson("Run (MAP) result", {
    "updated": runMap.updated,
    sample: runMap.sample,
  });

  const mappedCC = await db.select({ qboCustomerId: customerCompanies.qboCustomerId }).from(customerCompanies).where(eq(customerCompanies.id, cc1.id));
  const otherCC = await db.select({ qboCustomerId: customerCompanies.qboCustomerId }).from(customerCompanies).where(eq(customerCompanies.id, cc2.id));
  if (mappedCC[0].qboCustomerId !== "QBO-200") throw new Error(`Expected cc1 linked to QBO-200, got ${mappedCC[0].qboCustomerId}`);
  if (otherCC[0].qboCustomerId) throw new Error(`Expected cc2 unlinked`);
  log("PASS: MAP linked chosen company, other remains unlinked.");

  await checkInvariants("after customer MAP");

  // 2d. Clean the link, then run with CREATE
  log("\n--- 2d. Run with CREATE resolution ---");
  await db.update(customerCompanies).set({ qboCustomerId: null, qboSyncToken: null, qboSyncStatus: "NOT_SYNCED", qboLastSyncedAt: null }).where(eq(customerCompanies.id, cc1.id));

  const svc4 = new QboCustomerImportService(client, TEST_COMPANY_ID);
  const runCreate = await svc4.importCustomers({
    dryRun: false, mode: "merge",
    resolutions: { "QBO-200": { action: "CREATE" } },
  });
  logJson("Run (CREATE) result", {
    "created": runCreate.created,
    sample: runCreate.sample,
  });

  const newCCs = await db.select({ id: customerCompanies.id, qboCustomerId: customerCompanies.qboCustomerId })
    .from(customerCompanies)
    .where(and(eq(customerCompanies.companyId, TEST_COMPANY_ID), eq(customerCompanies.qboCustomerId, "QBO-200"), isNull(customerCompanies.deletedAt)));
  if (newCCs.length !== 1) throw new Error(`Expected 1 company linked to QBO-200, got ${newCCs.length}`);
  if (newCCs[0].id === cc1.id || newCCs[0].id === cc2.id) throw new Error("Expected new company to be a different ID");
  log(`PASS: CREATE produced new company ${newCCs[0].id} linked to QBO-200.`);

  await checkInvariants("after customer CREATE");
}

// ===========================================================================
// MAIN
// ===========================================================================
async function main() {
  try {
    await cleanup();
    await ensureTestCompany();
    await testCatalogConflict();
    await testCustomerConflict();

    log("\n========================================");
    log("ALL TESTS PASSED");
    log("========================================");
  } catch (err) {
    console.error(`\n${PREFIX} TEST FAILED:`, err);
    process.exitCode = 1;
  } finally {
    await cleanup();
    process.exit(process.exitCode ?? 0);
  }
}

main();
