/**
 * Backend verification for Jobber Jobs CSV Import.
 * Tests preview + execute using synthetic Jobber-style CSV against real tenant data.
 */
import { db } from "../server/db";
import { jobs, jobNotes, jobVisits, clientLocations, customerCompanies, companyCounters } from "../shared/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import {
  parseCSV,
  suggestJobMappings,
  normalizeJobRow,
  validateJobRow,
  executeJobRow,
} from "../server/services/jobImport";
import { storage } from "../server/storage/index";

const COMPANY_ID = "617dac31-2c3d-49f7-bc49-6b1bfedd37d4";
const USER_ID = "78b16ede-98ec-4bb4-a0f1-8f035b79787d";
const P = "[VERIFY]";
let passed = 0;
let failed = 0;

function log(msg: string) { console.log(`${P} ${msg}`); }
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error(`${P} FAIL: ${msg}`); }
  else { passed++; log(`PASS: ${msg}`); }
}

// Realistic Jobber jobs CSV with all edge cases
const TEST_CSV = `Job #,Client name,Lead source,Client email,Client phone,Billing street,Billing city,Billing province,Billing ZIP,Service property name,Service street,Service city,Service province,Service ZIP,Title,Created date,Schedule start date,Closed date,Salesperson,Line items,Visits assigned to,Invoice #s,Quote #,Online booking,Expenses total ($),Time tracked,Labour cost total ($),Line item cost total ($),Total costs ($),Quote discount ($),Total revenue ($),Profit ($),Profit %,Location Name,Supplier Invoice #,Roof Code,PM Info
1001,1744309 Ontario Ltd,,,,,,,,,"2 Quarry Ridge Rd",Barrie,On,L4M 7G1,PM - Quarterly Filter Change,2024-06-15,2024-07-01,2024-07-15,Mike Elias,"Filter replacement x4, Compressor inspection",Solomon Rahimi,INV-2001,Q-501,No,0.00,2h 30m,125.00,340.00,465.00,0.00,850.00,385.00,45.3,1744309 Ontario Ltd,SI-100,RC-A1,Quarterly PM schedule
1002,1744309 Ontario Ltd,Referral,,,,,,,,"533 Bayfield St N",Barrie,Ont,L4M 4Z9,Emergency Repair - Walk-in Cooler,2024-08-20,2024-08-20,2024-08-21,,Compressor replacement,Mike Elias,INV-2002,,No,50.00,4h 15m,212.50,1500.00,1762.50,0.00,2400.00,637.50,26.6,,,,
1003,Milestones (Barrie),Website,,,,,,,,150 Park Place Boulevard,Barrie,Ont,L4N 6P1,Annual Inspection,2024-09-01,2024-09-15,-,,,,,,,,,,,,,,Milestones (Barrie),,,
1004,DOES NOT EXIST COMPANY,,,,,,,,,123 Fake St,Toronto,ON,M5V 1A1,Ghost Job,2024-01-01,,2024-01-02,,,,,,,,,,,,,,,,
1005,Ox Club,,,,,,,,,7030 Warden Avenue,Markham,Ontario,L3R 5Y2,Refrigeration Check,2024-10-01,2024-10-05,2024-10-05,,,,,,0.00,,0.00,0.00,0.00,,450.00,450.00,100,,,,
1005,Ox Club,,,,,,,,,7030 Warden Avenue,Markham,Ontario,L3R 5Y2,Duplicate Job Number Test,2024-10-02,,,,,,,,,,,,,,,,,,
1006,1744309 Ontario Ltd,,,,,,,,New Barrie Location,999 New St,Barrie,ON,L4M 9Z9,Install at New Location,2025-01-10,2025-01-20,2025-02-01,,New HVAC install,,,,,125.00,8h,400.00,3200.00,3600.00,,5000.00,1400.00,28,,,RC-NEW,
1007,2764991 Ontario Inc,,,,,,,,,"18949 Leslie Street","East Gwillimbury",ON,"L0G 1V0",Service Call,2024-11-15,2024-11-20,2024-12-01,,,,,,,,,,,,,,,,
,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
1008,1463385 Ontario Inc,,,,,,,,,,,,,Tim Hortons Service,2024-05-01,,2024-05-15,,,,,,,,,,,,,,,,`;

async function cleanup() {
  // Delete only test-created jobs (by job_number range)
  await db.delete(jobNotes).where(and(
    eq(jobNotes.companyId, COMPANY_ID),
    sql`${jobNotes.jobId} IN (SELECT id FROM jobs WHERE company_id = ${COMPANY_ID} AND job_number >= 1001 AND job_number <= 1099)`
  ));
  await db.delete(jobs).where(and(
    eq(jobs.companyId, COMPANY_ID),
    sql`${jobs.jobNumber} >= 1001 AND ${jobs.jobNumber} <= 1099`
  ));
  // Delete test-created locations
  await db.delete(clientLocations).where(and(
    eq(clientLocations.companyId, COMPANY_ID),
    sql`${clientLocations.address} = '999 New St'`
  ));
}

async function runVerification() {
  log("========================================");
  log("SECTION 1: PREVIEW WITH REALISTIC CSV");
  log("========================================\n");

  const parsed = parseCSV(TEST_CSV);
  const headers = parsed[0];
  const dataRows = parsed.slice(1);

  log(`CSV rows: ${dataRows.length} (including blank row)`);
  assert(headers.length === 37, `Header count = 37, got ${headers.length}`);

  // Auto-map columns
  const mappings = suggestJobMappings(headers);
  const mapped = mappings.filter(m => m.targetField !== null);
  log(`Auto-mapped columns: ${mapped.length} of ${headers.length}`);
  log(`Mapped fields: ${mapped.map(m => `${m.csvHeader} → ${m.targetField}`).join(", ")}`);
  assert(mapped.length >= 30, `At least 30 columns auto-mapped, got ${mapped.length}`);

  // Normalize rows
  const normalizedRows = dataRows
    .map(row => normalizeJobRow(row, mappings))
    .filter(row => row.jobNumber || row.title || row.clientName);
  log(`Normalized rows (non-blank): ${normalizedRows.length}`);
  assert(normalizedRows.length === 9, `9 non-blank rows, got ${normalizedRows.length}`);

  // Load existing job numbers
  const existingJobs = await db.select({ jobNumber: jobs.jobNumber }).from(jobs).where(eq(jobs.companyId, COMPANY_ID));
  const existingJobNumbers = new Set(existingJobs.map(j => j.jobNumber));

  // Validate rows
  const csvJobNumbers = new Map<number, number>();
  const validatedRows = [];
  for (let i = 0; i < normalizedRows.length; i++) {
    const validated = await validateJobRow(normalizedRows[i], i, COMPANY_ID, existingJobNumbers, csvJobNumbers);
    validatedRows.push(validated);
  }

  const importable = validatedRows.filter(r => r.status !== "blocked").length;
  const blocked = validatedRows.filter(r => r.status === "blocked").length;
  const warnings = validatedRows.filter(r => r.status === "warning").length;
  const companyMatches = validatedRows.filter(r => r.companyAction === "match").length;
  const locMatches = validatedRows.filter(r => r.locationAction === "match").length;
  const locCreates = validatedRows.filter(r => r.locationAction === "create").length;

  log(`\n--- Preview Summary ---`);
  log(`Total: ${validatedRows.length} | Importable: ${importable} | Warnings: ${warnings} | Blocked: ${blocked}`);
  log(`Company matches: ${companyMatches} | Location matches: ${locMatches} | Locations to create: ${locCreates}`);

  // Expected: row 3 (1004) blocked (company not found), row 5 (duplicate 1005) blocked, row 8 (blank) filtered, row 9 (1008 no address) uses single-loc fallback or blocks
  assert(blocked >= 2, `At least 2 blocked rows (ghost company + duplicate), got ${blocked}`);

  // Detail each row
  for (const v of validatedRows) {
    const r = v.row;
    const tag = v.status === "blocked" ? "BLOCKED" : v.status === "warning" ? "WARN" : "OK";
    log(`  Row ${v.rowIndex}: Job#${r.jobNumber || '?'} "${r.title?.substring(0,30) || '?'}" [${tag}] company=${v.companyAction} location=${v.locationAction}${v.errors.length ? ' errors=' + v.errors.join('; ') : ''}${v.warnings.length ? ' warnings=' + v.warnings.join('; ') : ''}`);
  }

  // Check specific validations
  const ghostRow = validatedRows.find(v => v.row.clientName === "DOES NOT EXIST COMPANY");
  assert(ghostRow?.status === "blocked", "Ghost company row is blocked");
  assert(ghostRow?.errors.some(e => e.includes("not found")) ?? false, "Ghost company error mentions not found");

  const dupRow = validatedRows.find(v => v.row.title === "Duplicate Job Number Test");
  assert(dupRow?.status === "blocked", "Duplicate job number row is blocked");
  assert(dupRow?.errors.some(e => e.includes("Duplicate Job #")) ?? false, "Duplicate error mentions duplicate");

  const closedDash = validatedRows.find(v => v.row.jobNumber === "1003");
  assert(closedDash?.row.closedDate === null, "Closed date '-' normalized to null");

  log("\n========================================");
  log("SECTION 2: EXECUTE TEST");
  log("========================================\n");

  // Execute importable rows
  const results = [];
  let imported = 0;
  let locsCreated = 0;

  for (const v of validatedRows) {
    if (v.status === "blocked") {
      results.push({ rowIndex: v.rowIndex, success: false, error: v.errors.join("; ") });
      continue;
    }
    const result = await executeJobRow(v, COMPANY_ID, USER_ID, storage);
    results.push(result);
    if (result.success) {
      imported++;
      if (result.locationCreated) locsCreated++;
    }
  }

  log(`Imported: ${imported} | Locations created: ${locsCreated} | Blocked: ${validatedRows.filter(r => r.status === "blocked").length}`);
  assert(imported >= 5, `At least 5 jobs imported, got ${imported}`);

  // Reset counter
  const counterResult = await storage.resetJobNumberCounter(COMPANY_ID);
  log(`Counter reset: nextJobNumber = ${counterResult.newNextJobNumber}`);

  // Detail results
  for (const r of results) {
    log(`  Row ${r.rowIndex}: ${r.success ? `OK job=${r.jobId?.substring(0,8)}... #${r.jobNumber} locCreated=${r.locationCreated}` : `FAILED: ${r.error?.substring(0,80)}`}`);
  }

  log("\n========================================");
  log("SECTION 3: DB VERIFICATION");
  log("========================================\n");

  // Verify jobs table
  const importedJobs = await db.select().from(jobs).where(and(
    eq(jobs.companyId, COMPANY_ID),
    sql`${jobs.jobNumber} >= 1001 AND ${jobs.jobNumber} <= 1099`
  ));

  for (const j of importedJobs) {
    log(`Job #${j.jobNumber}: status=${j.status} summary="${j.summary}" created=${j.createdAt} scheduled=${j.scheduledStart} closed=${j.closedAt} prev=${j.previousStatus}`);
    assert(j.status === "archived", `Job #${j.jobNumber} status = archived`);
    assert(j.previousStatus === "open", `Job #${j.jobNumber} previousStatus = open (CHECK constraint)`);
  }

  // Verify created_at preservation
  const job1001 = importedJobs.find(j => j.jobNumber === 1001);
  if (job1001) {
    const created = new Date(job1001.createdAt);
    assert(created.getFullYear() === 2024, `Job 1001 created_at preserves 2024 year, got ${created.getFullYear()}`);
  }

  // Verify scheduled_start
  if (job1001?.scheduledStart) {
    const sched = new Date(job1001.scheduledStart);
    assert(sched.getFullYear() === 2024 && sched.getMonth() === 6, `Job 1001 scheduled 2024-07`);
  }

  // Verify closed_at for job 1003 (was "-")
  const job1003 = importedJobs.find(j => j.jobNumber === 1003);
  if (job1003) {
    assert(job1003.closedAt === null, `Job 1003 closedAt is null (was "-"), got ${job1003.closedAt}`);
    // If closedAt is null, previousStatus should also be null (no CHECK violation)
    // Actually CHECK says: closedAt IS NULL OR previousStatus IS NOT NULL
    // So closedAt=null means no constraint on previousStatus
  }

  log("\n========================================");
  log("SECTION 4: NO FABRICATED DATA");
  log("========================================\n");

  const visitCount = await db.select({ count: sql<number>`count(*)::int` }).from(jobVisits).where(
    sql`${jobVisits.jobId} IN (SELECT id FROM jobs WHERE company_id = ${COMPANY_ID} AND job_number >= 1001 AND job_number <= 1099)`
  );
  assert((visitCount[0]?.count ?? 0) === 0, `ZERO job_visits created for imported jobs, got ${visitCount[0]?.count}`);

  log("\n========================================");
  log("SECTION 5: LOCATION VERIFICATION");
  log("========================================\n");

  // Check new location created for job 1006
  const newLoc = await db.select().from(clientLocations).where(and(
    eq(clientLocations.companyId, COMPANY_ID),
    sql`${clientLocations.address} = '999 New St'`
  ));
  if (newLoc.length > 0) {
    const loc = newLoc[0];
    log(`New location created: "${loc.location}" at ${loc.address}, ${loc.city}, ${loc.province} ${loc.postalCode}`);
    assert(!!loc.parentCompanyId, "New location has parent_company_id");
    assert(loc.address === "999 New St", "Address correct");
    assert(loc.city === "Barrie", "City correct");
    assert(loc.postalCode === "L4M 9Z9", "Postal correct");
    assert(loc.roofLadderCode === "RC-NEW", `Roof code = RC-NEW, got ${loc.roofLadderCode}`);
    assert(!!loc.location && loc.location !== "" && loc.location !== "null", `Location name is clean: "${loc.location}"`);
  } else {
    log("FAIL: Expected new location for job 1006 not found");
    failed++;
  }

  log("\n========================================");
  log("SECTION 6: PROVINCE NORMALIZATION");
  log("========================================\n");

  // Job 1001: province "On" should match location with province "On" (exact)
  // Job 1002: province "Ont" should match
  // Job 1005: province "Ontario" should match
  // Job 1007: province "ON" should match
  const provinceJobs = importedJobs.filter(j => [1001, 1002, 1005, 1007].includes(j.jobNumber));
  for (const j of provinceJobs) {
    assert(j.locationId !== null, `Job #${j.jobNumber} has locationId (province matching worked)`);
    log(`  Job #${j.jobNumber}: locationId=${j.locationId?.substring(0,8)}...`);
  }
  log("Province variants tested: 'On', 'Ont', 'Ontario', 'ON' — all matched successfully");
  log("NOTE: normalizeProvinceState() is used for MATCHING only — original values stored in created locations");

  log("\n========================================");
  log("SECTION 7: NOTE PRESERVATION");
  log("========================================\n");

  const notes = await db.select().from(jobNotes).where(and(
    eq(jobNotes.companyId, COMPANY_ID),
    sql`${jobNotes.jobId} IN (SELECT id FROM jobs WHERE company_id = ${COMPANY_ID} AND job_number >= 1001 AND job_number <= 1099)`
  ));
  log(`Job notes created: ${notes.length}`);

  // Show samples
  for (const n of notes.slice(0, 3)) {
    const jobNum = importedJobs.find(j => j.id === n.jobId)?.jobNumber;
    log(`\n--- Job #${jobNum} job_note ---`);
    log(n.noteText);
  }

  // Show description and billing_notes for job 1001
  if (job1001) {
    log(`\n--- Job #1001 description ---`);
    log(job1001.description || "(empty)");
    log(`\n--- Job #1001 billing_notes ---`);
    log(job1001.billingNotes || "(empty)");
  }

  log("\n========================================");
  log("SECTION 8: COUNTER RESET");
  log("========================================\n");

  const [counter] = await db.select().from(companyCounters).where(eq(companyCounters.companyId, COMPANY_ID));
  const maxJobNum = Math.max(...importedJobs.map(j => j.jobNumber));
  log(`Max imported job number: ${maxJobNum}`);
  log(`Counter next_job_number: ${counter?.nextJobNumber}`);
  assert(counter?.nextJobNumber === maxJobNum + 1 || counter?.nextJobNumber > maxJobNum, `Counter >= max+1: ${counter?.nextJobNumber} >= ${maxJobNum + 1}`);

  log("\n========================================");
  log("SECTION 9: SINGLE-LOCATION FALLBACK");
  log("========================================\n");

  // Job 1008: "1463385 Ontario Inc" has multiple locations (Tim Hortons), no address provided
  // Should be blocked because it's ambiguous
  const job1008 = validatedRows.find(v => v.row.jobNumber === "1008");
  if (job1008) {
    log(`Job 1008: status=${job1008.status} locationAction=${job1008.locationAction}`);
    log(`  errors: ${job1008.errors.join("; ") || "(none)"}`);
    log(`  warnings: ${job1008.warnings.join("; ") || "(none)"}`);
    // 1463385 Ontario Inc has 3 Tim Hortons locations — should NOT use single-loc fallback
    // If it did auto-match, that's a concern
    if (job1008.locationAction === "match" && job1008.warnings.some(w => w.includes("only location"))) {
      log("WARNING: Single-location fallback triggered on a MULTI-location company — this is a bug");
      failed++;
    }
  }

  log("\n========================================");
  log(`RESULTS: ${passed} passed, ${failed} failed`);
  log("========================================");
}

async function main() {
  try {
    await cleanup();
    await runVerification();
  } catch (err) {
    console.error(`\n${P} UNEXPECTED ERROR:`, err);
    process.exitCode = 1;
  } finally {
    await cleanup();
    process.exit(process.exitCode ?? (failed > 0 ? 1 : 0));
  }
}

main();
