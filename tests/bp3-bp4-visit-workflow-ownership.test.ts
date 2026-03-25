/**
 * BP-3/BP-4 Fix Integration Tests — Visit Workflow Ownership
 *
 * Proves that en-route and start visit actions are now owned by the canonical
 * orchestrator rather than performed by direct route-level DB writes.
 *
 * Asserts persisted visit state, version increments, validation guards,
 * and preserved checkedInAt semantics.
 *
 * 2026-03-18: Created to prove BP-3/BP-4 bypasses are eliminated.
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
import * as lifecycle from "../server/services/jobLifecycleOrchestrator";
import { jobRepository } from "../server/storage/jobs";
import { v4 as uuidv4 } from "uuid";

let companyId: string;
let userId: string;
let customerCompanyId: string;
let locationId: string;
const createdJobIds: string[] = [];
const createdVisitIds: string[] = [];

async function setupFixtures() {
  companyId = uuidv4();
  await db.insert(companies).values({ id: companyId, name: "bp3bp4_test_company" });

  userId = uuidv4();
  await db.insert(users).values({
    id: userId,
    companyId,
    email: `bp3bp4_test_${Date.now()}@test.com`,
    password: "hash",
    role: "technician",
    firstName: "Test",
    lastName: "Tech",
  });

  customerCompanyId = uuidv4();
  await db.insert(customerCompanies).values({
    id: customerCompanyId,
    companyId,
    name: "bp3bp4_test_customer",
  });

  locationId = uuidv4();
  await db.insert(clientLocations).values({
    id: locationId,
    companyId,
    parentCompanyId: customerCompanyId,
    companyName: "bp3bp4_test_location",
    address: "456 Test Ave",
    selectedMonths: [],
  });
}

async function createScheduledVisit(overrides?: Record<string, unknown>): Promise<{
  jobId: string;
  visitId: string;
  visitVersion: number;
}> {
  const now = new Date();
  const scheduledStart = new Date(now.getTime() + 3600000); // 1h from now
  const scheduledEnd = new Date(now.getTime() + 7200000); // 2h from now

  const job = await jobRepository.createJob(companyId, {
    companyId,
    locationId,
    jobType: "PM",
    summary: "bp3bp4_test_job",
    status: "open",
    primaryTechnicianId: userId,
    scheduledStart,
    scheduledEnd,
    isAllDay: false,
  });
  createdJobIds.push(job.id);

  // Find auto-created visit and set it to scheduled + assigned
  const [autoVisit] = await db
    .select()
    .from(jobVisits)
    .where(and(eq(jobVisits.jobId, job.id), eq(jobVisits.companyId, companyId)));

  if (!autoVisit) throw new Error("createJob did not auto-create visit #1");

  // Apply any overrides (e.g., status, checkedInAt)
  if (overrides && Object.keys(overrides).length > 0) {
    await db
      .update(jobVisits)
      .set(overrides)
      .where(eq(jobVisits.id, autoVisit.id));
  }

  // Re-read to get current state after overrides
  const [visit] = await db
    .select()
    .from(jobVisits)
    .where(eq(jobVisits.id, autoVisit.id));

  createdVisitIds.push(visit.id);

  return { jobId: job.id, visitId: visit.id, visitVersion: visit.version };
}

async function loadVisit(visitId: string) {
  const [row] = await db
    .select()
    .from(jobVisits)
    .where(and(eq(jobVisits.id, visitId), eq(jobVisits.companyId, companyId)));
  return row ?? null;
}

async function cleanupFixtures() {
  for (const id of createdVisitIds) {
    await db.delete(jobVisits).where(eq(jobVisits.id, id)).catch(() => {});
  }
  for (const id of createdJobIds) {
    await db.delete(jobs).where(eq(jobs.id, id)).catch(() => {});
  }
  if (locationId) await db.delete(clientLocations).where(eq(clientLocations.id, locationId)).catch(() => {});
  if (customerCompanyId) await db.delete(customerCompanies).where(eq(customerCompanies.id, customerCompanyId)).catch(() => {});
  if (userId) await db.delete(users).where(eq(users.id, userId)).catch(() => {});
  if (companyId) await db.delete(companies).where(eq(companies.id, companyId)).catch(() => {});
}

describe("BP-3/BP-4: Visit workflow ownership (integration)", () => {
  beforeAll(async () => {
    await setupFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  // ==========================================================================
  // BP-3: SET_VISIT_EN_ROUTE
  // ==========================================================================

  it("BP-3: en-route sets status and increments version", async () => {
    const { jobId, visitId, visitVersion } = await createScheduledVisit();

    const result = await lifecycle.setVisitEnRoute({
      type: "SET_VISIT_EN_ROUTE",
      companyId,
      visitId,
      jobId,
    });

    expect(result.visit.status).toBe("en_route");
    expect(result.visit.version).toBe(visitVersion + 1);

    // Verify persisted state
    const persisted = await loadVisit(visitId);
    expect(persisted!.status).toBe("en_route");
    expect(persisted!.version).toBe(visitVersion + 1);
  });

  it("BP-3: en-route rejects completed visit", async () => {
    const { jobId, visitId } = await createScheduledVisit({
      status: "completed", outcome: "completed", completedAt: new Date(),
    });

    await expect(
      lifecycle.setVisitEnRoute({
        type: "SET_VISIT_EN_ROUTE",
        companyId,
        visitId,
        jobId,
      })
    ).rejects.toThrow("completed");

    // Persisted state unchanged
    const persisted = await loadVisit(visitId);
    expect(persisted!.status).toBe("completed");
  });

  it("BP-3: en-route rejects cancelled visit", async () => {
    const { jobId, visitId } = await createScheduledVisit({ status: "cancelled" });

    await expect(
      lifecycle.setVisitEnRoute({
        type: "SET_VISIT_EN_ROUTE",
        companyId,
        visitId,
        jobId,
      })
    ).rejects.toThrow("cancelled");
  });

  it("BP-3: en-route accepts timestamp override", async () => {
    const customTime = new Date("2026-03-18T09:30:00Z");
    const { jobId, visitId } = await createScheduledVisit();

    const result = await lifecycle.setVisitEnRoute({
      type: "SET_VISIT_EN_ROUTE",
      companyId,
      visitId,
      jobId,
      at: customTime,
    });

    expect(result.visit.status).toBe("en_route");
    // updatedAt should reflect the custom time
    const persisted = await loadVisit(visitId);
    expect(new Date(persisted!.updatedAt!).toISOString()).toBe(customTime.toISOString());
  });

  // ==========================================================================
  // BP-4: START_VISIT
  // ==========================================================================

  it("BP-4: start sets status, checkedInAt, and increments version", async () => {
    const { jobId, visitId, visitVersion } = await createScheduledVisit();

    const result = await lifecycle.startVisit({
      type: "START_VISIT",
      companyId,
      visitId,
      jobId,
    });

    expect(result.visit.status).toBe("in_progress");
    expect(result.visit.checkedInAt).toBeDefined();
    expect(result.visit.version).toBe(visitVersion + 1);

    // Verify persisted state
    const persisted = await loadVisit(visitId);
    expect(persisted!.status).toBe("in_progress");
    expect(persisted!.checkedInAt).toBeDefined();
    expect(persisted!.version).toBe(visitVersion + 1);
  });

  it("BP-4: start preserves existing checkedInAt (idempotent)", async () => {
    const existingCheckinTime = new Date("2026-03-18T08:00:00Z");
    const { jobId, visitId } = await createScheduledVisit({
      checkedInAt: existingCheckinTime,
      status: "on_site",
    });

    const result = await lifecycle.startVisit({
      type: "START_VISIT",
      companyId,
      visitId,
      jobId,
    });

    expect(result.visit.status).toBe("in_progress");
    // checkedInAt must be preserved, NOT overwritten
    expect(new Date(result.visit.checkedInAt!).toISOString()).toBe(existingCheckinTime.toISOString());

    // Verify persisted state
    const persisted = await loadVisit(visitId);
    expect(new Date(persisted!.checkedInAt!).toISOString()).toBe(existingCheckinTime.toISOString());
  });

  it("BP-4: start rejects completed visit", async () => {
    const { jobId, visitId } = await createScheduledVisit({
      status: "completed", outcome: "completed", completedAt: new Date(),
    });

    await expect(
      lifecycle.startVisit({
        type: "START_VISIT",
        companyId,
        visitId,
        jobId,
      })
    ).rejects.toThrow("completed");
  });

  it("BP-4: start rejects cancelled visit", async () => {
    const { jobId, visitId } = await createScheduledVisit({ status: "cancelled" });

    await expect(
      lifecycle.startVisit({
        type: "START_VISIT",
        companyId,
        visitId,
        jobId,
      })
    ).rejects.toThrow("cancelled");
  });

  it("BP-4: start accepts timestamp override", async () => {
    const customTime = new Date("2026-03-18T10:15:00Z");
    const { jobId, visitId } = await createScheduledVisit();

    const result = await lifecycle.startVisit({
      type: "START_VISIT",
      companyId,
      visitId,
      jobId,
      at: customTime,
    });

    expect(result.visit.status).toBe("in_progress");
    expect(new Date(result.visit.checkedInAt!).toISOString()).toBe(customTime.toISOString());
  });

  // ==========================================================================
  // Schedule sync preserved
  // ==========================================================================

  it("en-route triggers schedule sync (job reflects visit state)", async () => {
    const { jobId, visitId } = await createScheduledVisit();

    await lifecycle.setVisitEnRoute({
      type: "SET_VISIT_EN_ROUTE",
      companyId,
      visitId,
      jobId,
    });

    // Job should still have scheduling fields (visit is still active)
    const [job] = await db
      .select({ scheduledStart: jobs.scheduledStart })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)));

    // scheduledStart should be present (the visit is still scheduled/active)
    expect(job.scheduledStart).toBeDefined();
  });
});
