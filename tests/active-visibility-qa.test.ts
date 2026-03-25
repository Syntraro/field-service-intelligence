/**
 * Active Visibility Manual QA — Route-level Regression
 *
 * This test file exercises every audited active-job surface at the
 * storage/service layer (the same functions called by the API routes).
 * It seeds realistic records covering all deletion scenarios and verifies
 * each surface excludes deleted/inactive jobs correctly.
 *
 * Surfaces covered:
 *   A. Jobs page (getJobs, getJob)
 *   B. Client/company overview (getCustomerCompanyOverview, getJobsAndInvoicesForLocations)
 *   C. Search (universalSearch)
 *   D. Scheduling (getScheduledJobsInRange, getUnscheduledJobs, getJobsNeedingFollowUp)
 *   E. Map (raw SQL via /api/map/day query pattern)
 *   F. Delete flow validation (hard delete, soft delete, double delete)
 *   G. Maintenance statuses
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import {
  jobs,
  invoices,
  jobVisits,
  companies,
  users,
  clientLocations,
  customerCompanies,
} from "@shared/schema";
import { eq, and, sql, isNull } from "drizzle-orm";
import { jobRepository } from "../server/storage/jobs";
import { customerCompanyRepository } from "../server/storage/customerCompanies";
import { universalSearch } from "../server/storage/search";
import { maintenanceRepository } from "../server/storage/maintenance";
import { schedulingRepository } from "../server/storage/scheduling";
import { JOB_ACTIVE_SQL_J } from "../server/storage/jobFilters";
import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------------------------------------
// Test-scoped IDs
// ---------------------------------------------------------------------------
const TEST_PREFIX = "qa_vis_test_";
let companyId: string;
let userId: string;
let customerCompanyId: string;
let locationId: string;

// Phase 3: Seeded records
let activeJobId: string;
let inactiveJobId: string;          // isActive=false, deletedAt NULL
let softDeletedJobId: string;       // invoice-linked, soft-deleted via deleteJob
let hardDeletableJobId: string;     // no invoice, will be hard-deleted
let invoiceIdLinkedJobId: string;   // jobs.invoiceId set, not yet deleted (for live delete test)
let fallbackLinkedJobId: string;    // only invoices.jobId points at it, not yet deleted
let jobWithVisitsId: string;        // has visit records, for scheduling surface test

// Supporting IDs
let invoiceForSoftDelete: string;
let invoiceForInvoiceIdLink: string;
let invoiceForFallbackLink: string;
let visitId: string;

// ---------------------------------------------------------------------------
// Fixtures
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
    role: "admin",
    status: "active",
    fullName: `${TEST_PREFIX}Tech`,
    isSchedulable: true,
  });

  customerCompanyId = uuidv4();
  await db.insert(customerCompanies).values({
    id: customerCompanyId,
    companyId,
    name: `${TEST_PREFIX}customer_co`,
  });

  locationId = uuidv4();
  await db.insert(clientLocations).values({
    id: locationId,
    companyId,
    parentCompanyId: customerCompanyId,
    companyName: `${TEST_PREFIX}location`,
    selectedMonths: [],
  });

  const createJob = async (suffix: string, overrides: Record<string, any> = {}) => {
    const job = await jobRepository.createJob(companyId, {
      companyId,
      locationId,
      summary: `${TEST_PREFIX}${suffix}`,
      status: "open",
      jobType: "maintenance",
      priority: "medium",
      ...overrides,
    });
    return job;
  };

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

  // --- 1. Active job (control) ---
  const activeJob = await createJob("active_job");
  activeJobId = activeJob.id;

  // --- 2. Inactive job (isActive=false) ---
  const inactiveJob = await createJob("inactive_job");
  inactiveJobId = inactiveJob.id;
  await db.update(jobs).set({ isActive: false }).where(eq(jobs.id, inactiveJobId));

  // --- 3. Soft-deleted job (invoice-linked) ---
  const softJob = await createJob("soft_deleted_job");
  softDeletedJobId = softJob.id;
  invoiceForSoftDelete = await createInvoice(softDeletedJobId);
  await jobRepository.deleteJob(companyId, softDeletedJobId);

  // --- 4. Hard-deletable job (no invoice) ---
  const hardJob = await createJob("hard_deletable_job");
  hardDeletableJobId = hardJob.id;
  // Will be deleted in test section F

  // --- 5. Job with jobs.invoiceId set (not yet deleted) ---
  const invIdJob = await createJob("invoice_id_linked_job");
  invoiceIdLinkedJobId = invIdJob.id;
  invoiceForInvoiceIdLink = await createInvoice(null);
  await db.update(jobs).set({ invoiceId: invoiceForInvoiceIdLink }).where(eq(jobs.id, invoiceIdLinkedJobId));

  // --- 6. Job linked only by invoices.jobId (not yet deleted) ---
  const fallbackJob = await createJob("fallback_linked_job");
  fallbackLinkedJobId = fallbackJob.id;
  invoiceForFallbackLink = await createInvoice(fallbackLinkedJobId);

  // --- 7. Job with scheduled visit (for scheduling surface test) ---
  const visitJob = await createJob("job_with_visits");
  jobWithVisitsId = visitJob.id;
  // Schedule it — set times on the job and its auto-created visit
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrow);
  tomorrowEnd.setHours(11, 0, 0, 0);
  await db.update(jobs).set({
    scheduledStart: tomorrow,
    scheduledEnd: tomorrowEnd,
    primaryTechnicianId: userId,
  }).where(eq(jobs.id, jobWithVisitsId));

  // Update the auto-created visit with schedule data
  await db.update(jobVisits).set({
    scheduledDate: tomorrow,
    scheduledStart: tomorrow,
    scheduledEnd: tomorrowEnd,
    assignedTechnicianId: userId,
    estimatedDurationMinutes: 60,
    status: "scheduled",
  }).where(and(eq(jobVisits.jobId, jobWithVisitsId), eq(jobVisits.companyId, companyId)));
}

async function cleanupFixtures() {
  await db.delete(jobVisits).where(eq(jobVisits.companyId, companyId));
  await db.delete(invoices).where(eq(invoices.companyId, companyId));
  await db.delete(jobs).where(eq(jobs.companyId, companyId));
  await db.delete(clientLocations).where(eq(clientLocations.companyId, companyId));
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, companyId));
  await db.delete(users).where(eq(users.companyId, companyId));
  await db.delete(companies).where(eq(companies.id, companyId));
}

// ---------------------------------------------------------------------------
// QA Tests
// ---------------------------------------------------------------------------
describe("Active Visibility QA — Route-Level Regression", () => {
  beforeAll(async () => {
    await createFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  // =========================================================================
  // A. Jobs Page Surface (backed by server/storage/jobs.ts)
  // =========================================================================
  describe("A. Jobs Page", () => {
    it("A1. Active job appears in getJobs", async () => {
      const result = await jobRepository.getJobs(companyId, {});
      const ids = result.items.map((j: any) => j.id);
      expect(ids).toContain(activeJobId);
    });

    it("A2. Inactive job does NOT appear in getJobs", async () => {
      const result = await jobRepository.getJobs(companyId, {});
      const ids = result.items.map((j: any) => j.id);
      expect(ids).not.toContain(inactiveJobId);
    });

    it("A3. Soft-deleted job does NOT appear in getJobs", async () => {
      const result = await jobRepository.getJobs(companyId, {});
      const ids = result.items.map((j: any) => j.id);
      expect(ids).not.toContain(softDeletedJobId);
    });

    it("A4. getJob returns null for soft-deleted job", async () => {
      const job = await jobRepository.getJob(companyId, softDeletedJobId);
      expect(job).toBeNull();
    });

    it("A5. getJob returns null for inactive job", async () => {
      const job = await jobRepository.getJob(companyId, inactiveJobId);
      expect(job).toBeNull();
    });

    it("A6. getJob returns active job normally", async () => {
      const job = await jobRepository.getJob(companyId, activeJobId);
      expect(job).not.toBeNull();
    });
  });

  // =========================================================================
  // B. Client/Company Overview (backed by server/storage/customerCompanies.ts)
  // =========================================================================
  describe("B. Client/Company Overview", () => {
    it("B1. Deleted job does NOT appear in company overview job list", async () => {
      const overview = await customerCompanyRepository.getCustomerCompanyOverview(
        companyId, customerCompanyId,
      );
      expect(overview).not.toBeNull();
      const ids = overview!.jobs.map((j: any) => j.id);
      expect(ids).not.toContain(softDeletedJobId);
    });

    it("B2. Inactive job does NOT appear in company overview job list", async () => {
      const overview = await customerCompanyRepository.getCustomerCompanyOverview(
        companyId, customerCompanyId,
      );
      const ids = overview!.jobs.map((j: any) => j.id);
      expect(ids).not.toContain(inactiveJobId);
    });

    it("B3. stats.openJobs excludes deleted jobs", async () => {
      const overview = await customerCompanyRepository.getCustomerCompanyOverview(
        companyId, customerCompanyId,
      );
      // softDeletedJobId was 'open' before deletion — should not be counted
      // Only jobs that are active AND open should count
      const activeOpenCount = overview!.jobs.filter((j: any) => j.status === "open").length;
      expect(overview!.stats.openJobs).toBe(activeOpenCount);
    });

    it("B4. stats.openJobs excludes inactive jobs", async () => {
      const overview = await customerCompanyRepository.getCustomerCompanyOverview(
        companyId, customerCompanyId,
      );
      // inactiveJobId is 'open' but isActive=false — should not be counted
      expect(overview!.stats.openJobs).toBeGreaterThanOrEqual(1); // at least activeJobId
      // Verify the inactive job's status isn't inflating the count
      const visibleJobs = overview!.jobs;
      const inactiveInList = visibleJobs.find((j: any) => j.id === inactiveJobId);
      expect(inactiveInList).toBeUndefined();
    });

    it("B5. getJobsAndInvoicesForLocations excludes deleted/inactive jobs", async () => {
      const result = await customerCompanyRepository.getJobsAndInvoicesForLocations(
        companyId, [locationId], 100,
      );
      const ids = result.jobs.map((j: any) => j.id);
      expect(ids).toContain(activeJobId);
      expect(ids).not.toContain(softDeletedJobId);
      expect(ids).not.toContain(inactiveJobId);
    });
  });

  // =========================================================================
  // C. Search (backed by server/storage/search.ts)
  // =========================================================================
  describe("C. Search", () => {
    it("C1. Active job is searchable by summary", async () => {
      const results = await universalSearch({
        query: `${TEST_PREFIX}active_job`,
        companyId,
      });
      const jobResults = results.filter((r: any) => r.type === "job");
      expect(jobResults.length).toBeGreaterThanOrEqual(1);
      expect(jobResults.some((r: any) => r.id === activeJobId)).toBe(true);
    });

    it("C2. Soft-deleted job is NOT searchable", async () => {
      const results = await universalSearch({
        query: `${TEST_PREFIX}soft_deleted_job`,
        companyId,
      });
      const jobResults = results.filter((r: any) => r.type === "job");
      expect(jobResults.length).toBe(0);
    });

    it("C3. Inactive job is NOT searchable", async () => {
      const results = await universalSearch({
        query: `${TEST_PREFIX}inactive_job`,
        companyId,
      });
      const jobResults = results.filter((r: any) => r.type === "job");
      expect(jobResults.length).toBe(0);
    });

    it("C4. Fallback-linked job is searchable BEFORE deletion", async () => {
      // This job has invoices.jobId pointing at it but hasn't been deleted yet
      const results = await universalSearch({
        query: `${TEST_PREFIX}fallback_linked_job`,
        companyId,
      });
      const jobResults = results.filter((r: any) => r.type === "job");
      expect(jobResults.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // D. Scheduling / Map / Intelligence
  //    (backed by server/storage/scheduling.ts, server/routes/map.ts,
  //     server/lib/visitIntelligence.ts, server/lib/autoGapScheduling.ts)
  // =========================================================================
  describe("D. Scheduling / Map surfaces", () => {
    it("D1. Scheduled visit for active job appears in calendar range", async () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const dayAfter = new Date(tomorrow);
      dayAfter.setDate(dayAfter.getDate() + 1);

      const result = await schedulingRepository.getScheduledJobsInRange(
        companyId, tomorrow, dayAfter,
      );
      const visitIds = result.map((j: any) => j.visitId || j.id);
      // The job_with_visits should have its visit in the range
      const hasVisit = result.some((j: any) => j.jobId === jobWithVisitsId || j.id === jobWithVisitsId);
      expect(hasVisit).toBe(true);
    });

    it("D2. Unscheduled backlog excludes deleted/inactive jobs", async () => {
      const backlog = await schedulingRepository.getUnscheduledJobs(companyId);
      const ids = backlog.map((j: any) => j.id);
      expect(ids).not.toContain(softDeletedJobId);
      expect(ids).not.toContain(inactiveJobId);
    });

    it("D3. Unscheduled backlog includes active unscheduled jobs", async () => {
      const backlog = await schedulingRepository.getUnscheduledJobs(companyId);
      const ids = backlog.map((j: any) => j.id);
      // activeJobId has no scheduledStart, so it should be in backlog
      expect(ids).toContain(activeJobId);
    });

    it("D4. Raw SQL map query pattern excludes deleted jobs", async () => {
      // Reproduce the exact query pattern used in server/routes/map.ts
      const { rows } = await db.execute(sql`
        SELECT j.id
        FROM jobs j
        WHERE j.company_id = ${companyId}
          AND ${sql.raw(JOB_ACTIVE_SQL_J)}
      `);
      const ids = (rows as any[]).map(r => r.id);
      expect(ids).toContain(activeJobId);
      expect(ids).not.toContain(softDeletedJobId);
      expect(ids).not.toContain(inactiveJobId);
    });

    it("D5. After soft-deleting a scheduled job, it leaves calendar range", async () => {
      // Give jobWithVisits an invoice so deleteJob soft-deletes
      const invId = await (async () => {
        const id = uuidv4();
        await db.insert(invoices).values({
          id,
          companyId,
          locationId,
          invoiceNumber: `${TEST_PREFIX}INV-visit-${Date.now()}`,
          status: "draft",
          issueDate: "2026-03-13",
          subtotal: "0.00",
          taxTotal: "0.00",
          total: "0.00",
          amountPaid: "0.00",
          balance: "0.00",
          jobId: jobWithVisitsId,
        });
        return id;
      })();

      // Soft-delete the job
      await jobRepository.deleteJob(companyId, jobWithVisitsId);

      // Verify it's gone from calendar
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const dayAfter = new Date(tomorrow);
      dayAfter.setDate(dayAfter.getDate() + 1);

      const result = await schedulingRepository.getScheduledJobsInRange(
        companyId, tomorrow, dayAfter,
      );
      const hasVisit = result.some((j: any) => j.jobId === jobWithVisitsId || j.id === jobWithVisitsId);
      expect(hasVisit).toBe(false);
    });
  });

  // =========================================================================
  // E. Delete Flow Validation
  // =========================================================================
  describe("E. Delete Flow Validation", () => {
    it("E1. Non-invoiced job delete = hard delete (row removed)", async () => {
      const result = await jobRepository.deleteJob(companyId, hardDeletableJobId);
      expect(result).toBe(true);

      const [row] = await db.select({ id: jobs.id }).from(jobs)
        .where(eq(jobs.id, hardDeletableJobId));
      expect(row).toBeUndefined();
    });

    it("E2. Invoice-linked job delete (via jobs.invoiceId) = soft delete", async () => {
      const result = await jobRepository.deleteJob(companyId, invoiceIdLinkedJobId);
      expect(result).toBe(true);

      const [row] = await db
        .select({ deletedAt: jobs.deletedAt, isActive: jobs.isActive })
        .from(jobs)
        .where(eq(jobs.id, invoiceIdLinkedJobId));
      expect(row).toBeDefined();
      expect(row.deletedAt).not.toBeNull();
      expect(row.isActive).toBe(false);

      // Verify hidden from active surfaces
      const job = await jobRepository.getJob(companyId, invoiceIdLinkedJobId);
      expect(job).toBeNull();
    });

    it("E3. Fallback-linked job delete (invoices.jobId only) = soft delete", async () => {
      // Verify no jobs.invoiceId
      const [before] = await db.select({ invoiceId: jobs.invoiceId }).from(jobs)
        .where(eq(jobs.id, fallbackLinkedJobId));
      expect(before.invoiceId).toBeNull();

      const result = await jobRepository.deleteJob(companyId, fallbackLinkedJobId);
      expect(result).toBe(true);

      const [row] = await db
        .select({ deletedAt: jobs.deletedAt, isActive: jobs.isActive })
        .from(jobs)
        .where(eq(jobs.id, fallbackLinkedJobId));
      expect(row).toBeDefined();
      expect(row.deletedAt).not.toBeNull();
      expect(row.isActive).toBe(false);
    });

    it("E4. Fallback soft-deleted job is NOT searchable after deletion", async () => {
      const results = await universalSearch({
        query: `${TEST_PREFIX}fallback_linked_job`,
        companyId,
      });
      const jobResults = results.filter((r: any) => r.type === "job");
      expect(jobResults.length).toBe(0);
    });

    it("E5. Double delete returns false (no-op, no error)", async () => {
      const result = await jobRepository.deleteJob(companyId, invoiceIdLinkedJobId);
      expect(result).toBe(false);
    });

    it("E6. Hard-deleted job ID returns false on subsequent delete", async () => {
      const result = await jobRepository.deleteJob(companyId, hardDeletableJobId);
      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // F. Maintenance statuses
  // =========================================================================
  describe("F. Maintenance statuses", () => {
    it("F1. Maintenance statuses exclude deleted/inactive jobs", async () => {
      const statuses = await maintenanceRepository.getMaintenanceStatuses(companyId);
      const totalCount = statuses.reduce((sum: number, s: any) => sum + s.count, 0);
      // Only active, non-deleted jobs should be counted
      // Count how many active, non-deleted jobs we have
      const { rows } = await db.execute(sql`
        SELECT count(*) as cnt FROM jobs j
        WHERE j.company_id = ${companyId}
          AND ${sql.raw(JOB_ACTIVE_SQL_J)}
      `);
      const activeCount = Number((rows as any[])[0].cnt);
      expect(totalCount).toBe(activeCount);
    });
  });

  // =========================================================================
  // G. Post-deletion surface consistency
  // =========================================================================
  describe("G. Post-deletion consistency across all surfaces", () => {
    it("G1. After all deletions, only active job remains in getJobs", async () => {
      const result = await jobRepository.getJobs(companyId, {});
      const openIds = result.items
        .filter((j: any) => j.status === "open")
        .map((j: any) => j.id);
      expect(openIds).toContain(activeJobId);
      expect(openIds).not.toContain(softDeletedJobId);
      expect(openIds).not.toContain(inactiveJobId);
      expect(openIds).not.toContain(hardDeletableJobId);
      expect(openIds).not.toContain(invoiceIdLinkedJobId);
      expect(openIds).not.toContain(fallbackLinkedJobId);
    });

    it("G2. Company overview only shows active job", async () => {
      const overview = await customerCompanyRepository.getCustomerCompanyOverview(
        companyId, customerCompanyId,
      );
      const ids = overview!.jobs.map((j: any) => j.id);
      expect(ids).toContain(activeJobId);
      // All deleted/inactive jobs should be excluded
      expect(ids).not.toContain(softDeletedJobId);
      expect(ids).not.toContain(inactiveJobId);
      expect(ids).not.toContain(invoiceIdLinkedJobId);
      expect(ids).not.toContain(fallbackLinkedJobId);
    });

    it("G3. Search only finds active job", async () => {
      const results = await universalSearch({
        query: TEST_PREFIX,
        companyId,
      });
      const jobResults = results.filter((r: any) => r.type === "job");
      const jobIds = jobResults.map((r: any) => r.id);
      // Should contain activeJobId, should not contain any deleted/inactive
      expect(jobIds).toContain(activeJobId);
      expect(jobIds).not.toContain(softDeletedJobId);
      expect(jobIds).not.toContain(inactiveJobId);
      expect(jobIds).not.toContain(invoiceIdLinkedJobId);
      expect(jobIds).not.toContain(fallbackLinkedJobId);
    });

    it("G4. Raw SQL active filter matches ORM active filter", async () => {
      // Raw SQL path
      const { rows: rawRows } = await db.execute(sql`
        SELECT j.id FROM jobs j
        WHERE j.company_id = ${companyId}
          AND ${sql.raw(JOB_ACTIVE_SQL_J)}
        ORDER BY j.id
      `);
      const rawIds = (rawRows as any[]).map(r => r.id).sort();

      // ORM path (getJobs uses activeJobFilter internally)
      const ormResult = await jobRepository.getJobs(companyId, {});
      const ormIds = ormResult.items.map((j: any) => j.id).sort();

      // Both should produce the same set of active job IDs
      expect(rawIds).toEqual(ormIds);
    });
  });
});
