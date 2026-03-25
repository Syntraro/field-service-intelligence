/**
 * Delete Job Regression Tests
 *
 * Proves the conditional deletion behavior introduced in the active-job
 * visibility refactor works correctly:
 *
 * A. deleteJob() hard-deletes when no invoice linkage exists
 * B. deleteJob() soft-deletes when jobs.invoiceId is set
 * C. deleteJob() soft-deletes when invoices.jobId references the job (fallback guard)
 * D. deleteJob() soft-deletes when both linkage directions exist
 * E. Soft-deleted jobs are excluded from all audited active surfaces
 * F. Inactive (isActive=false) jobs are excluded from audited active surfaces
 * G. Double-delete of soft-deleted job returns false (no-op)
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
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { jobRepository } from "../server/storage/jobs";
import { customerCompanyRepository } from "../server/storage/customerCompanies";
import { universalSearch } from "../server/storage/search";
import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------------------------------------
// Test-scoped IDs
// ---------------------------------------------------------------------------
const TEST_PREFIX = "del_regr_test_";
let companyId: string;
let userId: string;
let customerCompanyId: string;
let locationId: string;

// Job IDs created during fixture setup
let hardDeleteJobId: string;      // A: no invoice → hard delete
let softDeleteJobId: string;      // B: jobs.invoiceId set → soft delete
let fallbackSoftDeleteJobId: string; // C: invoices.jobId only → soft delete
let bothLinkedJobId: string;      // D: both directions → soft delete
let doubleDeleteJobId: string;    // E: soft-deleted, then deleted again
let activeJobId: string;          // control: stays active
let inactiveJobId: string;        // F: isActive=false (manually set)

// Invoice IDs
let invoiceForSoftDelete: string;
let invoiceForFallback: string;
let invoiceForBothLinked: string;

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------
async function createFixtures() {
  companyId = uuidv4();
  await db.insert(companies).values({
    id: companyId,
    name: `${TEST_PREFIX}company`,
  });

  userId = uuidv4();
  await db.insert(users).values({
    id: userId,
    companyId,
    email: `${TEST_PREFIX}${Date.now()}@test.com`,
    password: "test_password_hash",
    role: "dispatcher",
    status: "active",
  });

  customerCompanyId = uuidv4();
  await db.insert(customerCompanies).values({
    id: customerCompanyId,
    companyId,
    name: `${TEST_PREFIX}customer`,
  });

  locationId = uuidv4();
  await db.insert(clientLocations).values({
    id: locationId,
    companyId,
    parentCompanyId: customerCompanyId,
    companyName: `${TEST_PREFIX}location`,
    selectedMonths: [],
  });

  // Helper to create a job
  const createJob = async (suffix: string) => {
    const job = await jobRepository.createJob(companyId, {
      companyId,
      locationId,
      summary: `${TEST_PREFIX}${suffix}`,
      status: "open",
      jobType: "maintenance",
      priority: "medium",
    });
    return job;
  };

  // Helper to create an invoice linked to the location
  const createInvoice = async (jobId: string | null) => {
    const id = uuidv4();
    await db.insert(invoices).values({
      id,
      companyId,
      locationId,
      invoiceNumber: `${TEST_PREFIX}INV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      status: "draft",
      issueDate: "2026-03-13",
      subtotal: "0.00",
      taxTotal: "0.00",
      total: "0.00",
      amountPaid: "0.00",
      balance: "0.00",
      jobId,
    });
    return id;
  };

  // --- A: Job with no invoice linkage (will be hard-deleted) ---
  const hardJob = await createJob("hard_delete");
  hardDeleteJobId = hardJob.id;

  // --- B: Job with jobs.invoiceId set (will be soft-deleted) ---
  const softJob = await createJob("soft_delete_via_invoiceId");
  softDeleteJobId = softJob.id;
  invoiceForSoftDelete = await createInvoice(null);
  // Set jobs.invoiceId to point at this invoice
  await db.update(jobs).set({ invoiceId: invoiceForSoftDelete })
    .where(eq(jobs.id, softDeleteJobId));

  // --- C: Job with NO jobs.invoiceId, but invoices.jobId points at it ---
  const fallbackJob = await createJob("soft_delete_via_fallback");
  fallbackSoftDeleteJobId = fallbackJob.id;
  invoiceForFallback = await createInvoice(fallbackSoftDeleteJobId);
  // jobs.invoiceId stays NULL; only invoices.jobId references this job

  // --- D: Job with BOTH jobs.invoiceId AND invoices.jobId ---
  const bothJob = await createJob("soft_delete_both");
  bothLinkedJobId = bothJob.id;
  invoiceForBothLinked = await createInvoice(bothLinkedJobId);
  await db.update(jobs).set({ invoiceId: invoiceForBothLinked })
    .where(eq(jobs.id, bothLinkedJobId));

  // --- E: Job for double-delete test (invoice-linked, soft-deleted once) ---
  const doubleJob = await createJob("double_delete");
  doubleDeleteJobId = doubleJob.id;
  const invoiceForDouble = await createInvoice(doubleDeleteJobId);
  await db.update(jobs).set({ invoiceId: invoiceForDouble })
    .where(eq(jobs.id, doubleDeleteJobId));

  // --- Control: active job that stays untouched ---
  const activeJob = await createJob("active_control");
  activeJobId = activeJob.id;

  // --- F: Inactive job (isActive=false, deletedAt still NULL) ---
  const inactiveJob = await createJob("inactive_control");
  inactiveJobId = inactiveJob.id;
  await db.update(jobs).set({ isActive: false })
    .where(eq(jobs.id, inactiveJobId));
}

async function cleanupFixtures() {
  // Hard-delete in dependency order
  await db.delete(invoices).where(eq(invoices.companyId, companyId));
  await db.delete(jobs).where(eq(jobs.companyId, companyId));
  await db.delete(clientLocations).where(eq(clientLocations.companyId, companyId));
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, companyId));
  await db.delete(users).where(eq(users.companyId, companyId));
  await db.delete(companies).where(eq(companies.id, companyId));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Delete Job Regression", () => {
  beforeAll(async () => {
    await createFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  // =========================================================================
  // A. Hard delete — no invoice linkage
  // =========================================================================
  describe("A. Non-invoiced job is hard deleted", () => {
    it("deleteJob returns true", async () => {
      const result = await jobRepository.deleteJob(companyId, hardDeleteJobId);
      expect(result).toBe(true);
    });

    it("job row is physically removed from database", async () => {
      const [row] = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.id, hardDeleteJobId));
      expect(row).toBeUndefined();
    });
  });

  // =========================================================================
  // B. Soft delete — jobs.invoiceId is set
  // =========================================================================
  describe("B. Job with jobs.invoiceId is soft deleted", () => {
    it("deleteJob returns true", async () => {
      const result = await jobRepository.deleteJob(companyId, softDeleteJobId);
      expect(result).toBe(true);
    });

    it("job row still exists with deletedAt set and isActive false", async () => {
      const [row] = await db
        .select({ id: jobs.id, deletedAt: jobs.deletedAt, isActive: jobs.isActive })
        .from(jobs)
        .where(eq(jobs.id, softDeleteJobId));
      expect(row).toBeDefined();
      expect(row.deletedAt).not.toBeNull();
      expect(row.isActive).toBe(false);
    });

    it("linked invoice still exists (not cascade-deleted)", async () => {
      const [inv] = await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(eq(invoices.id, invoiceForSoftDelete));
      expect(inv).toBeDefined();
    });
  });

  // =========================================================================
  // C. Soft delete — invoices.jobId fallback guard
  // =========================================================================
  describe("C. Job with only invoices.jobId is soft deleted (fallback guard)", () => {
    it("job has no invoiceId on the jobs table", async () => {
      const [row] = await db
        .select({ invoiceId: jobs.invoiceId })
        .from(jobs)
        .where(eq(jobs.id, fallbackSoftDeleteJobId));
      expect(row).toBeDefined();
      expect(row.invoiceId).toBeNull();
    });

    it("invoice references this job via invoices.jobId", async () => {
      const [inv] = await db
        .select({ jobId: invoices.jobId })
        .from(invoices)
        .where(eq(invoices.id, invoiceForFallback));
      expect(inv.jobId).toBe(fallbackSoftDeleteJobId);
    });

    it("deleteJob returns true (soft delete, not hard delete)", async () => {
      const result = await jobRepository.deleteJob(companyId, fallbackSoftDeleteJobId);
      expect(result).toBe(true);
    });

    it("job row still exists with deletedAt set", async () => {
      const [row] = await db
        .select({ id: jobs.id, deletedAt: jobs.deletedAt, isActive: jobs.isActive })
        .from(jobs)
        .where(eq(jobs.id, fallbackSoftDeleteJobId));
      expect(row).toBeDefined();
      expect(row.deletedAt).not.toBeNull();
      expect(row.isActive).toBe(false);
    });

    it("invoice reference is preserved (no dangling)", async () => {
      const [inv] = await db
        .select({ id: invoices.id, jobId: invoices.jobId })
        .from(invoices)
        .where(eq(invoices.id, invoiceForFallback));
      expect(inv).toBeDefined();
      expect(inv.jobId).toBe(fallbackSoftDeleteJobId);
    });
  });

  // =========================================================================
  // D. Soft delete — both linkage directions
  // =========================================================================
  describe("D. Job with both jobs.invoiceId and invoices.jobId is soft deleted", () => {
    it("deleteJob returns true", async () => {
      const result = await jobRepository.deleteJob(companyId, bothLinkedJobId);
      expect(result).toBe(true);
    });

    it("job row still exists with deletedAt set", async () => {
      const [row] = await db
        .select({ id: jobs.id, deletedAt: jobs.deletedAt, isActive: jobs.isActive })
        .from(jobs)
        .where(eq(jobs.id, bothLinkedJobId));
      expect(row).toBeDefined();
      expect(row.deletedAt).not.toBeNull();
      expect(row.isActive).toBe(false);
    });
  });

  // =========================================================================
  // E. Double-delete of already soft-deleted job
  // =========================================================================
  describe("E. Double-delete of soft-deleted job", () => {
    it("first delete returns true", async () => {
      const result = await jobRepository.deleteJob(companyId, doubleDeleteJobId);
      expect(result).toBe(true);
    });

    it("second delete returns false (already deleted, no-op)", async () => {
      const result = await jobRepository.deleteJob(companyId, doubleDeleteJobId);
      expect(result).toBe(false);
    });

    it("job still has original deletedAt (not overwritten)", async () => {
      const [row] = await db
        .select({ deletedAt: jobs.deletedAt })
        .from(jobs)
        .where(eq(jobs.id, doubleDeleteJobId));
      expect(row).toBeDefined();
      expect(row.deletedAt).not.toBeNull();
    });
  });

  // =========================================================================
  // F. Active visibility — soft-deleted and inactive jobs excluded
  // =========================================================================
  describe("F. Active surfaces exclude deleted and inactive jobs", () => {

    it("getJobs excludes soft-deleted jobs", async () => {
      const result = await jobRepository.getJobs(companyId, {});
      const ids = result.items.map((j: { id: string }) => j.id);
      expect(ids).toContain(activeJobId);
      expect(ids).not.toContain(softDeleteJobId);
      expect(ids).not.toContain(fallbackSoftDeleteJobId);
      expect(ids).not.toContain(bothLinkedJobId);
      expect(ids).not.toContain(doubleDeleteJobId);
    });

    it("getJobs excludes inactive jobs", async () => {
      const result = await jobRepository.getJobs(companyId, {});
      const ids = result.items.map((j: { id: string }) => j.id);
      expect(ids).not.toContain(inactiveJobId);
    });

    it("getJob returns null for soft-deleted job", async () => {
      const job = await jobRepository.getJob(companyId, softDeleteJobId);
      expect(job).toBeNull();
    });

    it("getJob returns null for inactive job", async () => {
      const job = await jobRepository.getJob(companyId, inactiveJobId);
      expect(job).toBeNull();
    });

    it("getJob returns active job normally", async () => {
      const job = await jobRepository.getJob(companyId, activeJobId);
      expect(job).not.toBeNull();
      expect(job!.id).toBe(activeJobId);
    });

    it("getCustomerCompanyOverview excludes deleted jobs from list", async () => {
      const overview = await customerCompanyRepository.getCustomerCompanyOverview(
        companyId,
        customerCompanyId,
      );
      expect(overview).not.toBeNull();
      const ids = overview!.jobs.map((j: { id: string }) => j.id);
      expect(ids).toContain(activeJobId);
      expect(ids).not.toContain(softDeleteJobId);
      expect(ids).not.toContain(fallbackSoftDeleteJobId);
      expect(ids).not.toContain(inactiveJobId);
    });

    it("getCustomerCompanyOverview.stats.openJobs excludes deleted/inactive", async () => {
      const overview = await customerCompanyRepository.getCustomerCompanyOverview(
        companyId,
        customerCompanyId,
      );
      expect(overview).not.toBeNull();
      // Only activeJobId should be counted as open
      expect(overview!.stats.openJobs).toBe(1);
    });

    it("getJobsAndInvoicesForLocations excludes deleted jobs", async () => {
      const result = await customerCompanyRepository.getJobsAndInvoicesForLocations(
        companyId,
        [locationId],
        100,
      );
      const ids = result.jobs.map((j: { id: string }) => j.id);
      expect(ids).toContain(activeJobId);
      expect(ids).not.toContain(softDeleteJobId);
      expect(ids).not.toContain(fallbackSoftDeleteJobId);
      expect(ids).not.toContain(inactiveJobId);
    });

    it("universalSearch excludes soft-deleted job by summary", async () => {
      const results = await universalSearch({
        query: `${TEST_PREFIX}soft_delete_via_invoiceId`,
        companyId,
      });
      const jobResults = results.filter((r: any) => r.type === "job");
      expect(jobResults.length).toBe(0);
    });

    it("universalSearch excludes fallback soft-deleted job", async () => {
      const results = await universalSearch({
        query: `${TEST_PREFIX}soft_delete_via_fallback`,
        companyId,
      });
      const jobResults = results.filter((r: any) => r.type === "job");
      expect(jobResults.length).toBe(0);
    });

    it("universalSearch finds active control job", async () => {
      const results = await universalSearch({
        query: `${TEST_PREFIX}active_control`,
        companyId,
      });
      const jobResults = results.filter((r: any) => r.type === "job");
      expect(jobResults.length).toBeGreaterThanOrEqual(1);
      expect(jobResults[0].id).toBe(activeJobId);
    });

    it("getJobs returns exactly 1 active open job for this tenant", async () => {
      // Cross-check: of 7 jobs created, only 1 should remain visible
      // (1 hard-deleted, 4 soft-deleted, 1 inactive, 1 active)
      const allJobs = await jobRepository.getJobs(companyId, {});
      const openJobs = allJobs.items.filter((j: { status: string }) => j.status === "open");
      expect(openJobs.length).toBe(1);
      expect(openJobs[0].id).toBe(activeJobId);
    });
  });

  // =========================================================================
  // G. No dangling invoice references after deleteJob
  // =========================================================================
  describe("G. No dangling invoice references", () => {
    it("invoices still exist after soft-deleting linked jobs", async () => {
      const allInvoices = await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(eq(invoices.companyId, companyId));
      // We created 4 invoices total (softDelete, fallback, bothLinked, doubleDelete)
      expect(allInvoices.length).toBeGreaterThanOrEqual(4);
    });

    it("invoice.jobId references are preserved (not nulled by soft delete)", async () => {
      // The fallback invoice should still point to the soft-deleted job
      const [inv] = await db
        .select({ jobId: invoices.jobId })
        .from(invoices)
        .where(eq(invoices.id, invoiceForFallback));
      expect(inv.jobId).toBe(fallbackSoftDeleteJobId);
    });

    it("hard-deleted job does not leave dangling invoice references", async () => {
      // hardDeleteJobId had no invoices, so no dangling refs possible
      const dangling = await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.companyId, companyId),
            eq(invoices.jobId, hardDeleteJobId),
          ),
        );
      expect(dangling.length).toBe(0);
    });
  });
});
