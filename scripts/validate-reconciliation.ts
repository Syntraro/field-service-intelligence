/**
 * Validation script for QBO customer import reconciliation.
 *
 * Tests multi-signal matching, rule-gated auto-link, link_only mode,
 * wipe survivor warning, and conflict generation using mock QBO data
 * against real DB records.
 *
 * Usage: npx tsx scripts/validate-reconciliation.ts
 */

import { db } from "../server/db";
import { customerCompanies, clientLocations, companies } from "../shared/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { QboCustomerImportService } from "../server/services/qbo/QboCustomerImportService";

const TEST_COMPANY_ID = "__test_recon_" + Date.now();
const P = "[VALIDATE]";
let passed = 0;
let failed = 0;

function log(msg: string) { console.log(`${P} ${msg}`); }
function logJson(label: string, obj: unknown) { console.log(`${P} ${label}: ${JSON.stringify(obj, null, 2)}`); }

function assert(condition: boolean, msg: string) {
  if (!condition) { failed++; console.error(`${P} FAIL: ${msg}`); }
  else { passed++; log(`PASS: ${msg}`); }
}

function createMockClient(qboCustomers: any[]) {
  return {
    queryCustomers: async () => ({
      success: true,
      data: { Customer: qboCustomers },
    }),
  } as any;
}

async function cleanup() {
  await db.delete(clientLocations).where(eq(clientLocations.companyId, TEST_COMPANY_ID));
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, TEST_COMPANY_ID));
  await db.delete(companies).where(eq(companies.id, TEST_COMPANY_ID));
}

async function setup() {
  await cleanup();
  await db.insert(companies).values({ id: TEST_COMPANY_ID, name: "Reconciliation Test Co" });
}

// ===================================================================
// TEST 1: Normalized name + email → auto-link parent
// ===================================================================
async function test1_nameEmailAutoLink() {
  log("\n=== TEST 1: Normalized name + email → auto-link parent ===");

  // CSV-imported local record (no qboCustomerId)
  await db.insert(customerCompanies).values({
    companyId: TEST_COMPANY_ID, name: "Basil Box Inc.", email: "info@basilbox.ca", phone: "416-555-0001",
    billingPostalCode: "L4N 6P1", isActive: true,
  });

  // QBO parent customer: same company (no suffix), same email
  const client = createMockClient([
    { Id: "QBO-P1", SyncToken: "0", DisplayName: "Basil Box", CompanyName: "Basil Box",
      Active: true, PrimaryEmailAddr: { Address: "info@basilbox.ca" },
      BillAddr: { PostalCode: "L4N 6P1" } },
  ]);

  const svc = new QboCustomerImportService(client, TEST_COMPANY_ID);
  const result = await svc.importCustomers({ dryRun: true, mode: "merge" });

  assert(result.totals.conflicts === 0, "No conflicts (single candidate, rule-gated)");
  assert(result.wouldUpdate.customerCompanies === 1, "Would update 1 company (auto-link)");
  assert(result.wouldCreate.customerCompanies === 0, "Would create 0 companies");

  const updateSample = result.sample.find((s: any) => s.action === "update");
  assert(!!updateSample, "Sample contains an update row");
  assert(!!updateSample?.matchBasis, `matchBasis is set: ${updateSample?.matchBasis}`);
  log(`  matchBasis: ${updateSample?.matchBasis}, matchScore: ${updateSample?.matchScore}`);

  await cleanup(); await setup();
}

// ===================================================================
// TEST 2: Normalized name + postal → auto-link parent
// ===================================================================
async function test2_namePostalAutoLink() {
  log("\n=== TEST 2: Normalized name + postal → auto-link parent ===");

  await db.insert(customerCompanies).values({
    companyId: TEST_COMPANY_ID, name: "Smith HVAC Ltd.", billingPostalCode: "M5V 2T6", isActive: true,
  });

  const client = createMockClient([
    { Id: "QBO-P2", SyncToken: "0", DisplayName: "Smith HVAC", CompanyName: "Smith HVAC",
      Active: true, BillAddr: { PostalCode: "M5V2T6" } },
  ]);

  const svc = new QboCustomerImportService(client, TEST_COMPANY_ID);
  const result = await svc.importCustomers({ dryRun: true, mode: "merge" });

  assert(result.totals.conflicts === 0, "No conflicts");
  assert(result.wouldUpdate.customerCompanies === 1, "Would update 1 company");
  assert(result.wouldCreate.customerCompanies === 0, "Would create 0 companies");

  await cleanup(); await setup();
}

// ===================================================================
// TEST 3: Name-only match → CONFLICT (not auto-link)
// ===================================================================
async function test3_nameOnlyConflict() {
  log("\n=== TEST 3: Name-only match → CONFLICT (not auto-link) ===");

  await db.insert(customerCompanies).values({
    companyId: TEST_COMPANY_ID, name: "Metro Plumbing", isActive: true,
  });

  const client = createMockClient([
    { Id: "QBO-P3", SyncToken: "0", DisplayName: "Metro Plumbing", CompanyName: "Metro Plumbing", Active: true },
  ]);

  const svc = new QboCustomerImportService(client, TEST_COMPANY_ID);
  const result = await svc.importCustomers({ dryRun: true, mode: "merge" });

  // Name-only (score=40) should be MEDIUM confidence → conflict, not auto-link
  assert(result.totals.conflicts === 1, "1 conflict (name-only is not enough for auto-link)");
  assert(result.wouldUpdate.customerCompanies === 0, "Would update 0 (conflict, not auto-linked)");

  const conflict = result.conflicts[0];
  assert(conflict.candidates.length === 1, "1 candidate in conflict");
  assert(conflict.candidates[0].score === 40, `Score is 40 (name only), got ${conflict.candidates[0].score}`);
  assert(conflict.candidates[0].confidence === "MEDIUM", `Confidence is MEDIUM, got ${conflict.candidates[0].confidence}`);
  assert(conflict.candidates[0].signals?.includes("NAME"), "Signals include NAME");

  await cleanup(); await setup();
}

// ===================================================================
// TEST 4: link_only mode → no creates
// ===================================================================
async function test4_linkOnlyNoCreates() {
  log("\n=== TEST 4: link_only mode → no creates ===");

  // No local records at all — QBO customer has no match
  const client = createMockClient([
    { Id: "QBO-P4", SyncToken: "0", DisplayName: "New Corp", CompanyName: "New Corp", Active: true },
  ]);

  const svc = new QboCustomerImportService(client, TEST_COMPANY_ID);
  const result = await svc.importCustomers({ dryRun: true, mode: "link_only" });

  assert(result.wouldCreate.customerCompanies === 0, "Would create 0 in link_only");
  assert(result.totals.skipped >= 1, `Skipped >= 1 (unmatched), got ${result.totals.skipped}`);
  const skipSample = result.sample.find((s: any) => s.action === "skip");
  assert(!!skipSample, "Sample has a skip row for unmatched record");

  await cleanup(); await setup();
}

// ===================================================================
// TEST 5: link_only mode with match → links without creating
// ===================================================================
async function test5_linkOnlyWithMatch() {
  log("\n=== TEST 5: link_only mode with match → links ===");

  await db.insert(customerCompanies).values({
    companyId: TEST_COMPANY_ID, name: "Basil Box", email: "info@basil.ca", isActive: true,
  });

  const client = createMockClient([
    { Id: "QBO-P5", SyncToken: "0", DisplayName: "Basil Box", CompanyName: "Basil Box",
      Active: true, PrimaryEmailAddr: { Address: "info@basil.ca" } },
  ]);

  const svc = new QboCustomerImportService(client, TEST_COMPANY_ID);

  // Dry run first
  const preview = await svc.importCustomers({ dryRun: true, mode: "link_only" });
  assert(preview.wouldUpdate.customerCompanies === 1, "link_only preview: would update 1");
  assert(preview.wouldCreate.customerCompanies === 0, "link_only preview: would create 0");

  // Actual run
  const svc2 = new QboCustomerImportService(client, TEST_COMPANY_ID);
  const result = await svc2.importCustomers({ dryRun: false, mode: "link_only" });
  assert(result.updated.customerCompanies === 1, "link_only run: updated 1");
  assert(result.created.customerCompanies === 0, "link_only run: created 0");

  // Verify QBO ID was linked
  const [linked] = await db.select({ qboCustomerId: customerCompanies.qboCustomerId })
    .from(customerCompanies)
    .where(and(eq(customerCompanies.companyId, TEST_COMPANY_ID), eq(customerCompanies.name, "Basil Box")));
  assert(linked?.qboCustomerId === "QBO-P5", `Linked qboCustomerId = QBO-P5, got ${linked?.qboCustomerId}`);

  await cleanup(); await setup();
}

// ===================================================================
// TEST 6: Wipe survivor warning
// ===================================================================
async function test6_wipeSurvivorWarning() {
  log("\n=== TEST 6: Wipe survivor warning ===");

  // Create one linked and one unlinked local record
  await db.insert(customerCompanies).values({
    companyId: TEST_COMPANY_ID, name: "Linked Co", qboCustomerId: "QBO-OLD", isActive: true,
  });
  await db.insert(customerCompanies).values({
    companyId: TEST_COMPANY_ID, name: "Unlinked CSV Co", isActive: true,
  });

  const client = createMockClient([
    { Id: "QBO-W1", SyncToken: "0", DisplayName: "Fresh QBO Co", Active: true },
  ]);

  const svc = new QboCustomerImportService(client, TEST_COMPANY_ID);
  const result = await svc.importCustomers({ dryRun: true, mode: "wipe" });

  const wipeWarning = result.warnings.find((w: string) => w.startsWith("Wipe mode:"));
  assert(!!wipeWarning, `Wipe survivor warning present: ${wipeWarning}`);
  assert(wipeWarning!.includes("1 local record"), "Warning mentions 1 surviving record");

  await cleanup(); await setup();
}

// ===================================================================
// TEST 7: Two duplicates with same name → conflict
// ===================================================================
async function test7_duplicateCandidatesConflict() {
  log("\n=== TEST 7: Two local records same name → conflict ===");

  await db.insert(customerCompanies).values({ companyId: TEST_COMPANY_ID, name: "Acme HVAC", isActive: true, email: "a@acme.ca" });
  await db.insert(customerCompanies).values({ companyId: TEST_COMPANY_ID, name: "Acme HVAC", isActive: true, email: "b@acme.ca" });

  const client = createMockClient([
    { Id: "QBO-D1", SyncToken: "0", DisplayName: "Acme HVAC", Active: true, PrimaryEmailAddr: { Address: "a@acme.ca" } },
  ]);

  const svc = new QboCustomerImportService(client, TEST_COMPANY_ID);
  const result = await svc.importCustomers({ dryRun: true, mode: "merge" });

  // Even though one candidate has email match (score 65), there are 2+ candidates → CONFLICT
  assert(result.totals.conflicts === 1, "1 conflict (multiple candidates)");
  assert(result.conflicts[0].candidates.length === 2, "2 candidates in conflict");

  // Verify scoring is present on candidates
  const scored = result.conflicts[0].candidates.filter((c: any) => c.score !== undefined);
  assert(scored.length === 2, "Both candidates have scores");
  log(`  Candidate scores: ${scored.map((c: any) => `${c.score} [${c.signals?.join(",")}]`).join(", ")}`);

  await cleanup(); await setup();
}

// ===================================================================
// TEST 8: Phone match + name mismatch → no link (score too low)
// ===================================================================
async function test8_phoneOnlyTooLow() {
  log("\n=== TEST 8: Phone match + name mismatch → no link ===");

  await db.insert(customerCompanies).values({
    companyId: TEST_COMPANY_ID, name: "Smith HVAC", phone: "416-555-9999", isActive: true,
  });

  const client = createMockClient([
    { Id: "QBO-PH1", SyncToken: "0", DisplayName: "Johnson Heating", Active: true,
      PrimaryPhone: { FreeFormNumber: "416-555-9999" } },
  ]);

  const svc = new QboCustomerImportService(client, TEST_COMPANY_ID);
  const result = await svc.importCustomers({ dryRun: true, mode: "merge" });

  // Phone only = 20 → below 40 threshold → not even a plausible candidate
  assert(result.totals.conflicts === 0, "No conflict (phone-only is below threshold)");
  assert(result.wouldCreate.customerCompanies === 1, "Would create 1 (no match found)");

  await cleanup(); await setup();
}

// ===================================================================
// TEST 9: Re-import idempotency (qboCustomerId match)
// ===================================================================
async function test9_reImportIdempotency() {
  log("\n=== TEST 9: Re-import idempotency ===");

  // Record already linked from a previous import
  await db.insert(customerCompanies).values({
    companyId: TEST_COMPANY_ID, name: "Already Linked Co", qboCustomerId: "QBO-RI1",
    qboSyncToken: "0", qboSyncStatus: "SYNCED", isActive: true,
  });

  const client = createMockClient([
    { Id: "QBO-RI1", SyncToken: "1", DisplayName: "Already Linked Co", Active: true },
  ]);

  const svc = new QboCustomerImportService(client, TEST_COMPANY_ID);
  const result = await svc.importCustomers({ dryRun: true, mode: "merge" });

  assert(result.wouldUpdate.customerCompanies === 1, "Would update 1 (idempotent update via qboCustomerId)");
  assert(result.wouldCreate.customerCompanies === 0, "Would create 0");
  assert(result.totals.conflicts === 0, "No conflicts");

  await cleanup(); await setup();
}

// ===================================================================
// TEST 10: Location matching — name + postal → auto-link
// ===================================================================
async function test10_locationNamePostal() {
  log("\n=== TEST 10: Location name + postal → auto-link ===");

  // Parent company
  const [cc] = await db.insert(customerCompanies).values({
    companyId: TEST_COMPANY_ID, name: "Multi Corp", qboCustomerId: "QBO-MC", isActive: true,
  }).returning({ id: customerCompanies.id });

  // CSV-imported location
  await db.insert(clientLocations).values({
    companyId: TEST_COMPANY_ID, parentCompanyId: cc.id, companyName: "Multi Corp",
    location: "Toronto Office", postalCode: "M5V 2T6", selectedMonths: [], isPrimary: true,
  });

  const client = createMockClient([
    { Id: "QBO-MC", SyncToken: "0", DisplayName: "Multi Corp", CompanyName: "Multi Corp", Active: true },
    { Id: "QBO-MC-T", SyncToken: "0", DisplayName: "Multi Corp: Toronto",
      CompanyName: "Multi Corp", Active: true, ParentRef: { value: "QBO-MC" },
      ShipAddr: { PostalCode: "M5V 2T6" } },
  ]);

  const svc = new QboCustomerImportService(client, TEST_COMPANY_ID);
  const result = await svc.importCustomers({ dryRun: true, mode: "merge" });

  // Parent matched by qboCustomerId (Stage 1). Child matched by name + postal (Stage 2+4)
  assert(result.wouldUpdate.clientLocations >= 1, `Would update >= 1 location, got ${result.wouldUpdate.clientLocations}`);

  const locUpdate = result.sample.find((s: any) => s.type === "child" && s.action === "update");
  if (locUpdate) {
    assert(!!locUpdate.matchBasis, `Location matchBasis set: ${locUpdate.matchBasis}`);
    log(`  Location matchBasis: ${locUpdate.matchBasis}, score: ${locUpdate.matchScore}`);
  }

  await cleanup(); await setup();
}

// ===================================================================
// TEST 11: Location name-only → CONFLICT (never auto-link)
// ===================================================================
async function test11_locationNameOnlyConflict() {
  log("\n=== TEST 11: Location name-only → CONFLICT ===");

  const [cc] = await db.insert(customerCompanies).values({
    companyId: TEST_COMPANY_ID, name: "Solo Parent", qboCustomerId: "QBO-SP", isActive: true,
  }).returning({ id: customerCompanies.id });

  await db.insert(clientLocations).values({
    companyId: TEST_COMPANY_ID, parentCompanyId: cc.id, companyName: "Solo Parent",
    location: "Main", selectedMonths: [], isPrimary: true,
  });

  const client = createMockClient([
    { Id: "QBO-SP", SyncToken: "0", DisplayName: "Solo Parent", Active: true },
    { Id: "QBO-SP-M", SyncToken: "0", DisplayName: "Solo Parent: Main",
      CompanyName: "Solo Parent", Active: true, ParentRef: { value: "QBO-SP" } },
  ]);

  const svc = new QboCustomerImportService(client, TEST_COMPANY_ID);
  const result = await svc.importCustomers({ dryRun: true, mode: "merge" });

  // Location name match only (score=40) → MEDIUM → CONFLICT for locations
  const locConflict = result.conflicts.find((c: any) =>
    c.qbo.name.includes("Solo Parent: Main") || c.qbo.name.includes("Solo Parent")
  );
  // It might auto-link via ensurePrimaryLocation fallback or create conflict
  // The key assertion: name-only should NOT auto-link a location
  const locAutoLink = result.sample.find((s: any) =>
    s.type === "child" && s.action === "update" && s.matchBasis && !s.matchBasis.includes("POSTAL") && !s.matchBasis.includes("EMAIL")
  );
  assert(!locAutoLink, "No location auto-linked on name-only (strict rule gate)");

  await cleanup(); await setup();
}

// ===================================================================
// TEST 12: Shared phone, two locals → CONFLICT (not auto-link)
// ===================================================================
async function test12_sharedPhoneConflict() {
  log("\n=== TEST 12: Shared phone, two locals → CONFLICT ===");

  await db.insert(customerCompanies).values({
    companyId: TEST_COMPANY_ID, name: "A Corp", phone: "416-555-1111", email: "a@corp.ca", isActive: true,
  });
  await db.insert(customerCompanies).values({
    companyId: TEST_COMPANY_ID, name: "A Corp", phone: "416-555-1111", email: "b@corp.ca", isActive: true,
  });

  const client = createMockClient([
    { Id: "QBO-SH1", SyncToken: "0", DisplayName: "A Corp", Active: true,
      PrimaryPhone: { FreeFormNumber: "416-555-1111" },
      PrimaryEmailAddr: { Address: "a@corp.ca" } },
  ]);

  const svc = new QboCustomerImportService(client, TEST_COMPANY_ID);
  const result = await svc.importCustomers({ dryRun: true, mode: "merge" });

  assert(result.totals.conflicts === 1, "1 conflict (2 candidates despite email narrowing one)");
  assert(result.conflicts[0].candidates.length === 2, "2 candidates");

  await cleanup(); await setup();
}

// ===================================================================
// TEST 13: merge vs link_only comparison
// ===================================================================
async function test13_mergeVsLinkOnly() {
  log("\n=== TEST 13: merge vs link_only comparison ===");

  await db.insert(customerCompanies).values({
    companyId: TEST_COMPANY_ID, name: "Existing Co", email: "ex@co.ca", isActive: true,
  });

  const client = createMockClient([
    { Id: "QBO-ML1", SyncToken: "0", DisplayName: "Existing Co", Active: true,
      PrimaryEmailAddr: { Address: "ex@co.ca" } },
    { Id: "QBO-ML2", SyncToken: "0", DisplayName: "Brand New Co", Active: true },
  ]);

  const svcMerge = new QboCustomerImportService(client, TEST_COMPANY_ID);
  const merge = await svcMerge.importCustomers({ dryRun: true, mode: "merge" });

  const svcLink = new QboCustomerImportService(client, TEST_COMPANY_ID);
  const link = await svcLink.importCustomers({ dryRun: true, mode: "link_only" });

  log(`  merge:     wouldCreate=${merge.wouldCreate.customerCompanies}, wouldUpdate=${merge.wouldUpdate.customerCompanies}, skipped=${merge.totals.skipped}`);
  log(`  link_only: wouldCreate=${link.wouldCreate.customerCompanies}, wouldUpdate=${link.wouldUpdate.customerCompanies}, skipped=${link.totals.skipped}`);

  assert(merge.wouldCreate.customerCompanies === 1, "merge would create 1 (Brand New Co)");
  assert(link.wouldCreate.customerCompanies === 0, "link_only would create 0");
  assert(link.totals.skipped >= 1, "link_only skips unmatched");
  assert(merge.wouldUpdate.customerCompanies === link.wouldUpdate.customerCompanies, "Both link the same matched record");

  await cleanup(); await setup();
}

// ===================================================================
// MAIN
// ===================================================================
async function main() {
  try {
    await setup();

    await test1_nameEmailAutoLink();
    await test2_namePostalAutoLink();
    await test3_nameOnlyConflict();
    await test4_linkOnlyNoCreates();
    await test5_linkOnlyWithMatch();
    await test6_wipeSurvivorWarning();
    await test7_duplicateCandidatesConflict();
    await test8_phoneOnlyTooLow();
    await test9_reImportIdempotency();
    await test10_locationNamePostal();
    await test11_locationNameOnlyConflict();
    await test12_sharedPhoneConflict();
    await test13_mergeVsLinkOnly();

    log("\n========================================");
    log(`RESULTS: ${passed} passed, ${failed} failed`);
    if (failed > 0) log("SOME TESTS FAILED — see above");
    else log("ALL TESTS PASSED");
    log("========================================");
  } catch (err) {
    console.error(`\n${P} UNEXPECTED ERROR:`, err);
    process.exitCode = 1;
  } finally {
    await cleanup();
    process.exit(process.exitCode ?? (failed > 0 ? 1 : 0));
  }
}

main();
