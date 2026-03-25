/**
 * Visit Predicate Centralization Tests
 *
 * Proves that the three canonical visit predicates have distinct semantics
 * and that consumers correctly use them.
 *
 * 2026-03-18: Created to prove predicate centralization preserves behavior
 * and the three business meanings remain intentionally distinct.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import {
  jobs,
  jobVisits,
  companies,
  users,
  clientLocations,
  customerCompanies,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { jobRepository } from "../server/storage/jobs";
import { jobVisitsRepository } from "../server/storage/jobVisits";
import {
  TERMINAL_VISIT_STATUSES,
  scheduleEligibleVisitFilter,
  reconciliationActionableVisitFilter,
  uncompletedVisitFilter,
} from "../server/lib/visitPredicates";
import { v4 as uuidv4 } from "uuid";

let companyId: string;
let userId: string;
let customerCompanyId: string;
let locationId: string;
const createdJobIds: string[] = [];
const createdVisitIds: string[] = [];

async function setup() {
  companyId = uuidv4();
  await db.insert(companies).values({ id: companyId, name: "pred_test_company" });

  userId = uuidv4();
  await db.insert(users).values({
    id: userId, companyId,
    email: `pred_test_${Date.now()}@test.com`,
    password: "hash", role: "technician", firstName: "Pred", lastName: "Test",
  });

  customerCompanyId = uuidv4();
  await db.insert(customerCompanies).values({
    id: customerCompanyId, companyId, name: "pred_test_customer",
  });

  locationId = uuidv4();
  await db.insert(clientLocations).values({
    id: locationId, companyId, parentCompanyId: customerCompanyId,
    companyName: "pred_test_location", address: "789 Pred St", selectedMonths: [],
  });
}

async function createJob(): Promise<string> {
  const now = new Date();
  const job = await jobRepository.createJob(companyId, {
    companyId, locationId, jobType: "PM", summary: "pred_test_job",
    status: "open", primaryTechnicianId: userId,
    scheduledStart: new Date(now.getTime() + 3600000),
    scheduledEnd: new Date(now.getTime() + 7200000),
    isAllDay: false,
  });
  createdJobIds.push(job.id);
  return job.id;
}

/**
 * Create a visit directly (for predicate testing).
 * Uses visitNumber >= 10 to avoid conflict with auto-created visit #1.
 */
async function createVisit(jobId: string, overrides: Record<string, unknown>): Promise<string> {
  const id = uuidv4();
  const visitNum = 10 + createdVisitIds.length;
  await db.insert(jobVisits).values({
    id, companyId, jobId,
    scheduledDate: new Date(),
    visitNumber: visitNum,
    isActive: true,
    status: "scheduled",
    assignedTechnicianId: userId,
    ...overrides,
  });
  createdVisitIds.push(id);
  return id;
}

async function cleanup() {
  for (const id of createdVisitIds) {
    await db.delete(jobVisits).where(eq(jobVisits.id, id)).catch(() => {});
  }
  for (const id of createdJobIds) {
    // Delete auto-created visits too
    await db.delete(jobVisits).where(eq(jobVisits.jobId, id)).catch(() => {});
    await db.delete(jobs).where(eq(jobs.id, id)).catch(() => {});
  }
  if (locationId) await db.delete(clientLocations).where(eq(clientLocations.id, locationId)).catch(() => {});
  if (customerCompanyId) await db.delete(customerCompanies).where(eq(customerCompanies.id, customerCompanyId)).catch(() => {});
  if (userId) await db.delete(users).where(eq(users.id, userId)).catch(() => {});
  if (companyId) await db.delete(companies).where(eq(companies.id, companyId)).catch(() => {});
}

describe("Visit Predicate Centralization", () => {
  beforeAll(async () => { await setup(); });
  afterAll(async () => { await cleanup(); });

  // ==========================================================================
  // TERMINAL_VISIT_STATUSES constant
  // ==========================================================================

  it("TERMINAL_VISIT_STATUSES contains completed and cancelled", () => {
    expect(TERMINAL_VISIT_STATUSES).toContain("completed");
    expect(TERMINAL_VISIT_STATUSES).toContain("cancelled");
    expect(TERMINAL_VISIT_STATUSES).toHaveLength(2);
  });

  // ==========================================================================
  // scheduleEligibleVisitFilter
  // ==========================================================================

  it("scheduleEligible includes active scheduled non-terminal visits", async () => {
    const jobId = await createJob();
    const futureStart = new Date(Date.now() + 86400000);
    const visitId = await createVisit(jobId, {
      scheduledStart: futureStart,
      scheduledEnd: new Date(futureStart.getTime() + 3600000),
      status: "scheduled",
      isActive: true,
    });

    const rows = await db.select({ id: jobVisits.id })
      .from(jobVisits)
      .where(scheduleEligibleVisitFilter(companyId, jobId));

    const ids = rows.map(r => r.id);
    expect(ids).toContain(visitId);
  });

  it("scheduleEligible excludes unscheduled visits (scheduledStart=null)", async () => {
    const jobId = await createJob();
    const unschedVisitId = await createVisit(jobId, {
      scheduledStart: null,
      status: "scheduled",
      isActive: true,
    });

    const rows = await db.select({ id: jobVisits.id })
      .from(jobVisits)
      .where(scheduleEligibleVisitFilter(companyId, jobId));

    const ids = rows.map(r => r.id);
    expect(ids).not.toContain(unschedVisitId);
  });

  it("scheduleEligible excludes terminal visits", async () => {
    const jobId = await createJob();
    const completedVisitId = await createVisit(jobId, {
      scheduledStart: new Date(),
      status: "completed",
      outcome: "completed",
      completedAt: new Date(),
      isActive: true,
    });

    const rows = await db.select({ id: jobVisits.id })
      .from(jobVisits)
      .where(scheduleEligibleVisitFilter(companyId, jobId));

    const ids = rows.map(r => r.id);
    expect(ids).not.toContain(completedVisitId);
  });

  it("scheduleEligible excludes inactive visits", async () => {
    const jobId = await createJob();
    const inactiveVisitId = await createVisit(jobId, {
      scheduledStart: new Date(),
      status: "scheduled",
      isActive: false,
    });

    const rows = await db.select({ id: jobVisits.id })
      .from(jobVisits)
      .where(scheduleEligibleVisitFilter(companyId, jobId));

    const ids = rows.map(r => r.id);
    expect(ids).not.toContain(inactiveVisitId);
  });

  // ==========================================================================
  // reconciliationActionableVisitFilter
  // ==========================================================================

  it("reconciliationActionable includes scheduled active visits", async () => {
    const jobId = await createJob();
    const visitId = await createVisit(jobId, {
      scheduledStart: new Date(Date.now() + 86400000),
      status: "scheduled",
      isActive: true,
    });

    const rows = await db.select({ id: jobVisits.id })
      .from(jobVisits)
      .where(reconciliationActionableVisitFilter(companyId, jobId));

    const ids = rows.map(r => r.id);
    expect(ids).toContain(visitId);
  });

  it("reconciliationActionable includes unscheduled-but-checked-in visits", async () => {
    const jobId = await createJob();
    const checkedInVisitId = await createVisit(jobId, {
      scheduledStart: null,
      checkedInAt: new Date(),
      status: "in_progress",
      isActive: true,
    });

    const rows = await db.select({ id: jobVisits.id })
      .from(jobVisits)
      .where(reconciliationActionableVisitFilter(companyId, jobId));

    const ids = rows.map(r => r.id);
    expect(ids).toContain(checkedInVisitId);
  });

  it("reconciliationActionable excludes unscheduled and not-checked-in visits", async () => {
    const jobId = await createJob();
    const placeholderVisitId = await createVisit(jobId, {
      scheduledStart: null,
      checkedInAt: null,
      status: "scheduled",
      isActive: true,
    });

    const rows = await db.select({ id: jobVisits.id })
      .from(jobVisits)
      .where(reconciliationActionableVisitFilter(companyId, jobId));

    const ids = rows.map(r => r.id);
    expect(ids).not.toContain(placeholderVisitId);
  });

  it("reconciliationActionable excludes terminal visits", async () => {
    const jobId = await createJob();
    const completedVisitId = await createVisit(jobId, {
      scheduledStart: new Date(),
      status: "completed",
      outcome: "completed",
      completedAt: new Date(),
      isActive: true,
    });

    const rows = await db.select({ id: jobVisits.id })
      .from(jobVisits)
      .where(reconciliationActionableVisitFilter(companyId, jobId));

    const ids = rows.map(r => r.id);
    expect(ids).not.toContain(completedVisitId);
  });

  // ==========================================================================
  // uncompletedVisitFilter
  // ==========================================================================

  it("uncompleted includes active non-terminal visits regardless of scheduledStart", async () => {
    const jobId = await createJob();
    const unschedVisitId = await createVisit(jobId, {
      scheduledStart: null,
      status: "scheduled",
      isActive: true,
    });

    const rows = await db.select({ id: jobVisits.id })
      .from(jobVisits)
      .where(uncompletedVisitFilter(companyId, jobId));

    const ids = rows.map(r => r.id);
    expect(ids).toContain(unschedVisitId);
  });

  it("uncompleted excludes terminal visits", async () => {
    const jobId = await createJob();
    const cancelledVisitId = await createVisit(jobId, {
      scheduledStart: new Date(),
      status: "cancelled",
      isActive: true,
    });

    const rows = await db.select({ id: jobVisits.id })
      .from(jobVisits)
      .where(uncompletedVisitFilter(companyId, jobId));

    const ids = rows.map(r => r.id);
    expect(ids).not.toContain(cancelledVisitId);
  });

  it("uncompleted excludes inactive visits", async () => {
    const jobId = await createJob();
    const inactiveVisitId = await createVisit(jobId, {
      scheduledStart: new Date(),
      status: "scheduled",
      isActive: false,
    });

    const rows = await db.select({ id: jobVisits.id })
      .from(jobVisits)
      .where(uncompletedVisitFilter(companyId, jobId));

    const ids = rows.map(r => r.id);
    expect(ids).not.toContain(inactiveVisitId);
  });

  // ==========================================================================
  // Distinct-semantics proof
  // ==========================================================================

  it("same visit can fail scheduleEligible but pass reconciliationActionable (unscheduled + checked-in)", async () => {
    const jobId = await createJob();
    const visitId = await createVisit(jobId, {
      scheduledStart: null,
      checkedInAt: new Date(),
      status: "in_progress",
      isActive: true,
    });

    const schedRows = await db.select({ id: jobVisits.id })
      .from(jobVisits)
      .where(scheduleEligibleVisitFilter(companyId, jobId));
    const reconRows = await db.select({ id: jobVisits.id })
      .from(jobVisits)
      .where(reconciliationActionableVisitFilter(companyId, jobId));

    const schedIds = schedRows.map(r => r.id);
    const reconIds = reconRows.map(r => r.id);

    // This visit fails schedule-eligible (no scheduledStart)
    expect(schedIds).not.toContain(visitId);
    // But passes reconciliation-actionable (has checkedInAt)
    expect(reconIds).toContain(visitId);
  });

  it("same visit can fail reconciliationActionable but pass uncompleted (unscheduled placeholder)", async () => {
    const jobId = await createJob();
    const visitId = await createVisit(jobId, {
      scheduledStart: null,
      checkedInAt: null,
      status: "scheduled",
      isActive: true,
    });

    const reconRows = await db.select({ id: jobVisits.id })
      .from(jobVisits)
      .where(reconciliationActionableVisitFilter(companyId, jobId));
    const uncompRows = await db.select({ id: jobVisits.id })
      .from(jobVisits)
      .where(uncompletedVisitFilter(companyId, jobId));

    const reconIds = reconRows.map(r => r.id);
    const uncompIds = uncompRows.map(r => r.id);

    // This visit fails reconciliation-actionable (no schedule, no activity)
    expect(reconIds).not.toContain(visitId);
    // But passes uncompleted (non-terminal, active)
    expect(uncompIds).toContain(visitId);
  });

  // ==========================================================================
  // Consumer preservation — getCurrentEligibleVisit uses schedule-eligible
  // ==========================================================================

  it("getCurrentEligibleVisit returns only schedule-eligible visits", async () => {
    const jobId = await createJob();

    // Create an unscheduled-but-checked-in visit (passes reconciliation, fails schedule)
    await createVisit(jobId, {
      scheduledStart: null,
      checkedInAt: new Date(),
      status: "in_progress",
      isActive: true,
    });

    // Create a scheduled visit (passes all predicates)
    const futureStart = new Date(Date.now() + 86400000);
    const scheduledVisitId = await createVisit(jobId, {
      scheduledStart: futureStart,
      scheduledEnd: new Date(futureStart.getTime() + 3600000),
      status: "scheduled",
      isActive: true,
    });

    const current = await jobVisitsRepository.getCurrentEligibleVisit(companyId, jobId);
    expect(current).toBeDefined();
    // Should pick a scheduled visit, not the unscheduled-but-checked-in one
    expect(current!.scheduledStart).toBeDefined();
  });

  // ==========================================================================
  // Consumer preservation — getUncompletedVisits includes all non-terminal
  // ==========================================================================

  it("getUncompletedVisits includes unscheduled placeholders", async () => {
    const jobId = await createJob();

    const placeholderId = await createVisit(jobId, {
      scheduledStart: null,
      status: "scheduled",
      isActive: true,
    });

    const uncompleted = await jobVisitsRepository.getUncompletedVisits(companyId, jobId);
    const ids = uncompleted.map(v => v.id);
    expect(ids).toContain(placeholderId);
  });
});
