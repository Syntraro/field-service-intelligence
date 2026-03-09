/**
 * Job Creation → Initial Visit Invariant Tests
 *
 * Locks the invariant that storage.createJob() atomically creates
 * an initial job_visits row in the same DB transaction.
 *
 * Test A: Scheduled job (scheduledStart + durationMinutes)
 *   → visit count = 1, visit.scheduledStart is not null, estimatedDurationMinutes matches
 *
 * Test B: Unscheduled job (no scheduledStart)
 *   → visit count = 1, visit.scheduledStart is null, estimatedDurationMinutes = default 60
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
import { eq, and, inArray } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { storage } from "../server/storage/index";
import { schedulingRepository } from "../server/storage/scheduling";

const TEST_PREFIX = "visit_inv_test_";
let companyId: string;
let userId: string;
let customerCompanyId: string;
let locationId: string;
const createdJobIds: string[] = [];

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
}

async function cleanupFixtures() {
  // Delete visits first (FK to jobs)
  if (createdJobIds.length > 0) {
    await db.delete(jobVisits).where(inArray(jobVisits.jobId, createdJobIds));
    await db.delete(jobs).where(inArray(jobs.id, createdJobIds));
  }
  if (locationId) {
    await db.delete(clientLocations).where(eq(clientLocations.id, locationId));
  }
  if (customerCompanyId) {
    await db.delete(customerCompanies).where(eq(customerCompanies.id, customerCompanyId));
  }
  if (userId) {
    await db.delete(users).where(eq(users.id, userId));
  }
  if (companyId) {
    await db.delete(companies).where(eq(companies.id, companyId));
  }
}

describe("Job Creation → Initial Visit Invariant", () => {
  beforeAll(async () => {
    await createFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  // ==========================================================================
  // Test A: Scheduled job produces 1 visit with matching schedule fields
  // ==========================================================================
  it("scheduled job creates exactly 1 visit with matching scheduledStart and durationMinutes", async () => {
    const scheduledStart = new Date("2026-03-20T09:00:00Z");
    const scheduledEnd = new Date("2026-03-20T10:30:00Z");
    const durationMinutes = 90;

    const job = await storage.createJob(companyId, {
      locationId,
      summary: `${TEST_PREFIX}scheduled_job`,
      scheduledStart: scheduledStart.toISOString(),
      scheduledEnd: scheduledEnd.toISOString(),
      durationMinutes,
      isAllDay: false,
      status: "open",
      jobType: "maintenance",
      priority: "medium",
    } as any);

    createdJobIds.push(job.id);

    // Job created successfully
    expect(job).toBeTruthy();
    expect(job.id).toBeTruthy();
    expect(job.scheduledStart).toBeTruthy();

    // Query visits for this job
    const visits = await db
      .select({
        id: jobVisits.id,
        scheduledStart: jobVisits.scheduledStart,
        scheduledEnd: jobVisits.scheduledEnd,
        estimatedDurationMinutes: jobVisits.estimatedDurationMinutes,
        isAllDay: jobVisits.isAllDay,
        status: jobVisits.status,
        visitNumber: jobVisits.visitNumber,
      })
      .from(jobVisits)
      .where(and(eq(jobVisits.jobId, job.id), eq(jobVisits.companyId, companyId)));

    // Exactly 1 visit
    expect(visits).toHaveLength(1);

    const visit = visits[0];
    // Visit has matching scheduling fields
    expect(visit.scheduledStart).not.toBeNull();
    expect(visit.scheduledEnd).not.toBeNull();
    expect(visit.estimatedDurationMinutes).toBe(durationMinutes);
    expect(visit.isAllDay).toBe(false);
    expect(visit.status).toBe("scheduled");
    expect(visit.visitNumber).toBe(1);
  });

  // ==========================================================================
  // Test B: Unscheduled job produces 1 placeholder visit
  // ==========================================================================
  it("unscheduled job creates exactly 1 placeholder visit with null scheduledStart", async () => {
    const job = await storage.createJob(companyId, {
      locationId,
      summary: `${TEST_PREFIX}unscheduled_job`,
      isAllDay: false,
      status: "open",
      jobType: "maintenance",
      priority: "medium",
    } as any);

    createdJobIds.push(job.id);

    // Job created successfully
    expect(job).toBeTruthy();
    expect(job.id).toBeTruthy();

    // Query visits for this job
    const visits = await db
      .select({
        id: jobVisits.id,
        scheduledStart: jobVisits.scheduledStart,
        scheduledEnd: jobVisits.scheduledEnd,
        scheduledDate: jobVisits.scheduledDate,
        estimatedDurationMinutes: jobVisits.estimatedDurationMinutes,
        isAllDay: jobVisits.isAllDay,
        status: jobVisits.status,
        visitNumber: jobVisits.visitNumber,
      })
      .from(jobVisits)
      .where(and(eq(jobVisits.jobId, job.id), eq(jobVisits.companyId, companyId)));

    // Exactly 1 visit
    expect(visits).toHaveLength(1);

    const visit = visits[0];
    // Placeholder visit: scheduledStart is null but scheduledDate is set (legacy field)
    expect(visit.scheduledStart).toBeNull();
    expect(visit.scheduledEnd).toBeNull();
    expect(visit.scheduledDate).toBeTruthy(); // legacy placeholder = now
    expect(visit.estimatedDurationMinutes).toBe(60); // default when no durationMinutes on job
    expect(visit.isAllDay).toBe(false);
    expect(visit.status).toBe("scheduled");
    expect(visit.visitNumber).toBe(1);
  });

  // ==========================================================================
  // Test C: Calendar scheduling updates placeholder visit (no duplicate)
  // ==========================================================================
  it("scheduling an unscheduled job updates placeholder visit #1 instead of inserting a duplicate", async () => {
    // 1. Create unscheduled job (creates placeholder visit #1 with scheduledStart=null)
    const job = await storage.createJob(companyId, {
      locationId,
      summary: `${TEST_PREFIX}schedule_placeholder`,
      isAllDay: false,
      status: "open",
      jobType: "maintenance",
      priority: "medium",
    } as any);

    createdJobIds.push(job.id);

    // Verify placeholder visit exists
    const beforeVisits = await db
      .select({ id: jobVisits.id, scheduledStart: jobVisits.scheduledStart, visitNumber: jobVisits.visitNumber })
      .from(jobVisits)
      .where(and(eq(jobVisits.jobId, job.id), eq(jobVisits.isActive, true)));

    expect(beforeVisits).toHaveLength(1);
    expect(beforeVisits[0].scheduledStart).toBeNull();
    expect(beforeVisits[0].visitNumber).toBe(1);

    // 2. Schedule the job via calendar (simulates drag-drop)
    const scheduledStart = new Date("2026-04-10T14:00:00Z");
    const scheduledEnd = new Date("2026-04-10T15:00:00Z");

    await schedulingRepository.scheduleJob(companyId, {
      jobId: job.id,
      startAt: scheduledStart,
      endAt: scheduledEnd,
      expectedVersion: job.version,
    });

    // 3. Assert: still only 1 visit, visit_number=1, scheduledStart is set
    const afterVisits = await db
      .select({
        id: jobVisits.id,
        scheduledStart: jobVisits.scheduledStart,
        scheduledEnd: jobVisits.scheduledEnd,
        visitNumber: jobVisits.visitNumber,
        status: jobVisits.status,
        isActive: jobVisits.isActive,
      })
      .from(jobVisits)
      .where(and(eq(jobVisits.jobId, job.id), eq(jobVisits.isActive, true)));

    expect(afterVisits).toHaveLength(1);
    expect(afterVisits[0].visitNumber).toBe(1);
    expect(afterVisits[0].scheduledStart).not.toBeNull();
    expect(afterVisits[0].scheduledEnd).not.toBeNull();
    expect(afterVisits[0].status).toBe("scheduled");

    // Same visit ID — was updated, not replaced
    expect(afterVisits[0].id).toBe(beforeVisits[0].id);
  });

  // ==========================================================================
  // Test D: Round-trip schedule → unschedule → schedule keeps same visit
  // ==========================================================================
  it("unschedule converts visit to placeholder; re-schedule updates it without collision", async () => {
    // 1. Create unscheduled job (placeholder visit #1)
    const job = await storage.createJob(companyId, {
      locationId,
      summary: `${TEST_PREFIX}roundtrip`,
      isAllDay: false,
      status: "open",
      jobType: "maintenance",
      priority: "medium",
    } as any);

    createdJobIds.push(job.id);

    // Capture placeholder visit ID
    const [initial] = await db
      .select({ id: jobVisits.id, visitNumber: jobVisits.visitNumber })
      .from(jobVisits)
      .where(and(eq(jobVisits.jobId, job.id), eq(jobVisits.isActive, true)));

    expect(initial).toBeTruthy();
    expect(initial.visitNumber).toBe(1);
    const originalVisitId = initial.id;

    // 2. Schedule the job
    const start1 = new Date("2026-05-01T10:00:00Z");
    const end1 = new Date("2026-05-01T11:00:00Z");
    await schedulingRepository.scheduleJob(companyId, {
      jobId: job.id,
      startAt: start1,
      endAt: end1,
      expectedVersion: job.version,
    });

    // 3. Unschedule the job (should convert visit to placeholder, not soft-delete)
    const afterSchedule = await db
      .select({ version: jobs.version })
      .from(jobs)
      .where(eq(jobs.id, job.id));
    const versionAfterSchedule = afterSchedule[0].version;

    await schedulingRepository.unscheduleJob(companyId, job.id, versionAfterSchedule!);

    // Verify visit is now a placeholder (isActive=true, scheduledStart=null)
    const afterUnschedule = await db
      .select({
        id: jobVisits.id,
        scheduledStart: jobVisits.scheduledStart,
        scheduledEnd: jobVisits.scheduledEnd,
        visitNumber: jobVisits.visitNumber,
        isActive: jobVisits.isActive,
      })
      .from(jobVisits)
      .where(and(eq(jobVisits.jobId, job.id), eq(jobVisits.isActive, true)));

    expect(afterUnschedule).toHaveLength(1);
    expect(afterUnschedule[0].id).toBe(originalVisitId);
    expect(afterUnschedule[0].scheduledStart).toBeNull();
    expect(afterUnschedule[0].scheduledEnd).toBeNull();
    expect(afterUnschedule[0].visitNumber).toBe(1);
    expect(afterUnschedule[0].isActive).toBe(true);

    // 4. Re-schedule the job (should update placeholder, no collision)
    const afterUnscheduleJob = await db
      .select({ version: jobs.version })
      .from(jobs)
      .where(eq(jobs.id, job.id));
    const versionAfterUnschedule = afterUnscheduleJob[0].version;

    const start2 = new Date("2026-05-02T14:00:00Z");
    const end2 = new Date("2026-05-02T15:00:00Z");
    await schedulingRepository.scheduleJob(companyId, {
      jobId: job.id,
      startAt: start2,
      endAt: end2,
      expectedVersion: versionAfterUnschedule!,
    });

    // 5. Assert: still 1 visit, same ID, visitNumber=1, scheduled
    const finalVisits = await db
      .select({
        id: jobVisits.id,
        scheduledStart: jobVisits.scheduledStart,
        scheduledEnd: jobVisits.scheduledEnd,
        visitNumber: jobVisits.visitNumber,
        isActive: jobVisits.isActive,
      })
      .from(jobVisits)
      .where(and(eq(jobVisits.jobId, job.id), eq(jobVisits.isActive, true)));

    expect(finalVisits).toHaveLength(1);
    expect(finalVisits[0].id).toBe(originalVisitId);
    expect(finalVisits[0].visitNumber).toBe(1);
    expect(finalVisits[0].scheduledStart).not.toBeNull();
    expect(finalVisits[0].scheduledEnd).not.toBeNull();
    expect(finalVisits[0].isActive).toBe(true);
  });
});
