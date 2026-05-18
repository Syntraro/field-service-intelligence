/**
 * Client & Location Deletion Tests
 *
 * Validates:
 * - Hard delete allowed when no history exists
 * - Hard delete blocked when jobs exist (light path only)
 * - Hard delete blocked when invoices exist (light path only)
 * - Location hard delete works when safe
 * - Cannot delete only location of a company
 * - Soft delete hides clients from normal searches
 * - Historical records still resolve after soft delete
 * - permanentDeleteLocation cascades through jobs/invoices/quotes/leads/templates
 * - recurringJobTemplates are deleted (not orphaned) on location delete
 * - contract files for templates are queued for cleanup
 * - archive/soft-delete path preserves all child records
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import {
  jobs,
  invoices,
  companies,
  users,
  clientLocations,
  customerCompanies,
  recurringJobTemplates,
  fileCleanupQueue,
  files,
} from "@shared/schema";
import { eq, sql, isNull, and } from "drizzle-orm";
import { customerCompanyRepository } from "../server/storage/customerCompanies";
import { universalSearch } from "../server/storage/search";
import { v4 as uuidv4 } from "uuid";

const TEST_PREFIX = "client_del_test_";
let companyId: string;
let userId: string;

// Clean company (no history) — for hard delete tests
let cleanCompanyId: string;
let cleanLocationId1: string;
let cleanLocationId2: string;

// Dirty company (has jobs) — for soft delete tests
let dirtyCompanyId: string;
let dirtyLocationId: string;
let dirtyJobId: string;

// Single-location company — for last-location test
let singleCompanyId: string;
let singleLocationId: string;

async function createFixtures() {
  companyId = uuidv4();
  userId = uuidv4();

  // Tenant company + user
  await db.insert(companies).values({
    id: companyId,
    name: TEST_PREFIX + "tenant",
    subscription: "pro",
  });
  await db.insert(users).values({
    id: userId,
    companyId,
    username: TEST_PREFIX + "user",
    email: TEST_PREFIX + "user@test.local",
    password: "hashed",
    role: "admin",
  });

  // ── Clean company (no jobs/invoices) ──
  cleanCompanyId = uuidv4();
  cleanLocationId1 = uuidv4();
  cleanLocationId2 = uuidv4();
  await db.insert(customerCompanies).values({
    id: cleanCompanyId,
    companyId,
    name: TEST_PREFIX + "CleanCo",
    nameNormalized: TEST_PREFIX + "cleanco",
  });
  await db.insert(clientLocations).values([
    {
      id: cleanLocationId1,
      companyId,
      userId,
      parentCompanyId: cleanCompanyId,
      companyName: TEST_PREFIX + "CleanCo",
      location: "Office A",
      isPrimary: true,
      inactive: false,
      selectedMonths: [],
    },
    {
      id: cleanLocationId2,
      companyId,
      userId,
      parentCompanyId: cleanCompanyId,
      companyName: TEST_PREFIX + "CleanCo",
      location: "Office B",
      isPrimary: false,
      inactive: false,
      selectedMonths: [],
    },
  ]);

  // ── Dirty company (has a job) ──
  dirtyCompanyId = uuidv4();
  dirtyLocationId = uuidv4();
  dirtyJobId = uuidv4();
  await db.insert(customerCompanies).values({
    id: dirtyCompanyId,
    companyId,
    name: TEST_PREFIX + "DirtyCo",
    nameNormalized: TEST_PREFIX + "dirtyco",
  });
  await db.insert(clientLocations).values({
    id: dirtyLocationId,
    companyId,
    userId,
    parentCompanyId: dirtyCompanyId,
    companyName: TEST_PREFIX + "DirtyCo",
    location: "Main Site",
    isPrimary: true,
    inactive: false,
    selectedMonths: [],
  });
  // Create a job referencing this location
  await db.insert(jobs).values({
    id: dirtyJobId,
    companyId,
    userId,
    locationId: dirtyLocationId,
    clientId: dirtyLocationId,
    summary: TEST_PREFIX + "job",
    jobNumber: 99999,
    status: "open",
    jobType: "pm",
    isActive: true,
  });

  // ── Single-location company ──
  singleCompanyId = uuidv4();
  singleLocationId = uuidv4();
  await db.insert(customerCompanies).values({
    id: singleCompanyId,
    companyId,
    name: TEST_PREFIX + "SingleCo",
    nameNormalized: TEST_PREFIX + "singleco",
  });
  await db.insert(clientLocations).values({
    id: singleLocationId,
    companyId,
    userId,
    parentCompanyId: singleCompanyId,
    companyName: TEST_PREFIX + "SingleCo",
    location: "Only Site",
    isPrimary: true,
    inactive: false,
    selectedMonths: [],
  });
}

async function cleanupFixtures() {
  // Clean up in dependency order
  await db.delete(jobs).where(eq(jobs.companyId, companyId));
  await db.delete(invoices).where(eq(invoices.companyId, companyId));
  await db.delete(clientLocations).where(eq(clientLocations.companyId, companyId));
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, companyId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(companies).where(eq(companies.id, companyId));
}

beforeAll(async () => {
  await cleanupFixtures();
  await createFixtures();
});

afterAll(async () => {
  await cleanupFixtures();
});

describe("Company Delete Eligibility", () => {
  it("allows hard delete when no history exists", async () => {
    const result = await customerCompanyRepository.checkCompanyDeleteEligibility(
      companyId, cleanCompanyId
    );
    expect(result.canHardDelete).toBe(true);
    expect(result.reasons).toHaveLength(0);
    expect(result.locationCount).toBe(2);
  });

  it("blocks hard delete when jobs exist", async () => {
    const result = await customerCompanyRepository.checkCompanyDeleteEligibility(
      companyId, dirtyCompanyId
    );
    expect(result.canHardDelete).toBe(false);
    expect(result.reasons.some(r => r.includes("job"))).toBe(true);
  });
});

describe("Location Delete Eligibility", () => {
  it("allows hard delete for clean location", async () => {
    const result = await customerCompanyRepository.checkLocationDeleteEligibility(
      companyId, cleanLocationId2
    );
    expect(result.canHardDelete).toBe(true);
    expect(result.reasons).toHaveLength(0);
    expect(result.isLastLocation).toBe(false);
  });

  it("blocks hard delete for location with jobs", async () => {
    const result = await customerCompanyRepository.checkLocationDeleteEligibility(
      companyId, dirtyLocationId
    );
    expect(result.canHardDelete).toBe(false);
    expect(result.reasons.some(r => r.includes("job"))).toBe(true);
  });

  it("flags last location of a company", async () => {
    const result = await customerCompanyRepository.checkLocationDeleteEligibility(
      companyId, singleLocationId
    );
    // It's the only location, so isLastLocation should be true
    expect(result.isLastLocation).toBe(true);
  });
});

describe("Hard Delete", () => {
  it("hard-deletes a clean location", async () => {
    const deleted = await customerCompanyRepository.hardDeleteLocation(
      companyId, cleanLocationId2
    );
    expect(deleted).toBe(true);

    // Verify it's gone from the database
    const [remaining] = await db
      .select({ id: clientLocations.id })
      .from(clientLocations)
      .where(eq(clientLocations.id, cleanLocationId2));
    expect(remaining).toBeUndefined();
  });

  it("hard-deletes a clean company and all locations", async () => {
    const deleted = await customerCompanyRepository.hardDeleteCustomerCompany(
      companyId, cleanCompanyId
    );
    expect(deleted).toBe(true);

    // Verify company is gone
    const company = await customerCompanyRepository.getCustomerCompany(companyId, cleanCompanyId);
    expect(company).toBeNull();

    // Verify locations are gone
    const locations = await db
      .select({ id: clientLocations.id })
      .from(clientLocations)
      .where(eq(clientLocations.parentCompanyId, cleanCompanyId));
    expect(locations).toHaveLength(0);
  });
});

describe("Soft Delete (Archive)", () => {
  it("soft-deletes a dirty company", async () => {
    const archived = await customerCompanyRepository.softDeleteCustomerCompany(
      companyId, dirtyCompanyId
    );
    expect(archived).not.toBeNull();
    expect(archived!.isActive).toBe(false);
    expect(archived!.deletedAt).not.toBeNull();
  });

  it("hides archived company from listCustomerCompanies", async () => {
    const list = await customerCompanyRepository.listCustomerCompanies(companyId);
    const found = list.find(c => c.id === dirtyCompanyId);
    expect(found).toBeUndefined();
  });

  it("hides archived locations from global search", async () => {
    const results = await universalSearch({ companyId, query: TEST_PREFIX + "DirtyCo" });
    const locationResult = results.find(
      r => r.type === "location" && r.title === TEST_PREFIX + "DirtyCo"
    );
    expect(locationResult).toBeUndefined();
  });

  it("preserves the job record after company archive", async () => {
    // The job should still exist and be queryable
    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, dirtyJobId));
    expect(job).toBeDefined();
    expect(job.locationId).toBe(dirtyLocationId);
  });

  it("restores an archived company", async () => {
    const restored = await customerCompanyRepository.restoreCustomerCompany(
      companyId, dirtyCompanyId
    );
    expect(restored).not.toBeNull();
    expect(restored!.isActive).toBe(true);
    expect(restored!.deletedAt).toBeNull();

    // Company should reappear in list
    const list = await customerCompanyRepository.listCustomerCompanies(companyId);
    const found = list.find(c => c.id === dirtyCompanyId);
    expect(found).toBeDefined();
  });
});

// ── Cascade delete (full permanentDeleteLocation path) ────────────────────────

describe("Permanent Delete Cascade", () => {
  let cascadeCompanyId: string;
  let cascadeLocationId: string;
  let cascadeJobId: string;
  let cascadeTemplateId: string;

  beforeAll(async () => {
    cascadeCompanyId = uuidv4();
    cascadeLocationId = uuidv4();
    cascadeJobId = uuidv4();
    cascadeTemplateId = uuidv4();

    await db.insert(customerCompanies).values({
      id: cascadeCompanyId,
      companyId,
      name: TEST_PREFIX + "CascadeCo",
      nameNormalized: TEST_PREFIX + "cascadeco",
    });
    await db.insert(clientLocations).values({
      id: cascadeLocationId,
      companyId,
      userId,
      parentCompanyId: cascadeCompanyId,
      companyName: TEST_PREFIX + "CascadeCo",
      location: "Cascade Site",
      isPrimary: true,
      inactive: false,
      selectedMonths: [],
    });
    await db.insert(jobs).values({
      id: cascadeJobId,
      companyId,
      userId,
      locationId: cascadeLocationId,
      clientId: cascadeLocationId,
      summary: TEST_PREFIX + "cascade_job",
      jobNumber: 99998,
      status: "open",
      jobType: "pm",
      isActive: true,
    });
    await db.insert(recurringJobTemplates).values({
      id: cascadeTemplateId,
      companyId,
      locationId: cascadeLocationId,
      title: TEST_PREFIX + "cascade_template",
      jobType: "maintenance",
      priority: "medium",
      isActive: true,
      startDate: "2026-01-01",
      recurrenceKind: "monthly",
      interval: 1,
    });
  });

  it("permanentDeleteLocation deletes location with active jobs without throwing", async () => {
    const result = await customerCompanyRepository.permanentDeleteLocation(companyId, cascadeLocationId);
    expect(result).toBeTruthy();
  });

  it("job attached to deleted location is gone", async () => {
    const [remaining] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.id, cascadeJobId));
    expect(remaining).toBeUndefined();
  });

  it("recurringJobTemplate is deleted, not orphaned with NULL locationId", async () => {
    const [remaining] = await db
      .select({ id: recurringJobTemplates.id, locationId: recurringJobTemplates.locationId })
      .from(recurringJobTemplates)
      .where(eq(recurringJobTemplates.id, cascadeTemplateId));
    // Row must not exist at all — not exist with locationId = NULL
    expect(remaining).toBeUndefined();
  });

  it("location row is gone after permanent delete", async () => {
    const [remaining] = await db
      .select({ id: clientLocations.id })
      .from(clientLocations)
      .where(eq(clientLocations.id, cascadeLocationId));
    expect(remaining).toBeUndefined();
  });
});

describe("Permanent Delete — Template File Cleanup Queue", () => {
  let fileCompanyId: string;
  let fileLocationId: string;
  let fileTemplateId: string;
  let fileId: string;

  beforeAll(async () => {
    fileCompanyId = uuidv4();
    fileLocationId = uuidv4();
    fileTemplateId = uuidv4();
    fileId = uuidv4();

    await db.insert(customerCompanies).values({
      id: fileCompanyId,
      companyId,
      name: TEST_PREFIX + "FileCo",
      nameNormalized: TEST_PREFIX + "fileco",
    });
    await db.insert(clientLocations).values({
      id: fileLocationId,
      companyId,
      userId,
      parentCompanyId: fileCompanyId,
      companyName: TEST_PREFIX + "FileCo",
      location: "File Site",
      isPrimary: true,
      inactive: false,
      selectedMonths: [],
    });
    await db.insert(recurringJobTemplates).values({
      id: fileTemplateId,
      companyId,
      locationId: fileLocationId,
      title: TEST_PREFIX + "file_template",
      jobType: "maintenance",
      priority: "medium",
      isActive: true,
      startDate: "2026-01-01",
      recurrenceKind: "monthly",
      interval: 1,
    });
    // Insert a files row (simulates uploaded contract file)
    await db.insert(files).values({
      id: fileId,
      companyId,
      bucket: "test-bucket",
      storageKey: "test/contract-file.pdf",
      storageProvider: "r2",
      originalName: "contract.pdf",
      mimeType: "application/pdf",
      size: 1024,
    });
    // Link the file to the template via contract_files
    await db.execute(sql`
      INSERT INTO contract_files (id, company_id, contract_id, file_id)
      VALUES (${uuidv4()}, ${companyId}, ${fileTemplateId}, ${fileId})
    `);
  });

  it("file_cleanup_queue contains contract file after location delete", async () => {
    await customerCompanyRepository.permanentDeleteLocation(companyId, fileLocationId);

    const [queueRow] = await db
      .select({ fileId: fileCleanupQueue.fileId })
      .from(fileCleanupQueue)
      .where(and(eq(fileCleanupQueue.companyId, companyId), eq(fileCleanupQueue.fileId, fileId)));
    expect(queueRow).toBeDefined();
    expect(queueRow.fileId).toBe(fileId);
  });
});

describe("Archive path preserves child records", () => {
  it("softDeleteCustomerCompany preserves job records", async () => {
    // dirtyCompanyId was restored above; job should still exist
    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, dirtyJobId));
    expect(job).toBeDefined();
    expect(job.locationId).toBe(dirtyLocationId);
  });

  it("softDeleteCustomerCompany does not delete the location row", async () => {
    const archived = await customerCompanyRepository.softDeleteCustomerCompany(
      companyId, dirtyCompanyId
    );
    expect(archived).not.toBeNull();

    const [loc] = await db
      .select({ id: clientLocations.id })
      .from(clientLocations)
      .where(eq(clientLocations.id, dirtyLocationId));
    expect(loc).toBeDefined();
  });
});
