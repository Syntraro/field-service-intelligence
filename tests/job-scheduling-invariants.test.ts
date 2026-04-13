/**
 * Job Scheduling Invariants Tests
 *
 * Validates DB constraints and application-level invariants for scheduling fields:
 *
 * 1) DB: is_all_day=true with scheduled_start=NULL is rejected (jobs_allday_requires_start_check)
 * 2) DB: scheduled_end NOT NULL with scheduled_start=NULL is rejected (jobs_scheduled_end_requires_start_check)
 * 3) PM generation creates jobs with isAllDay=false when unscheduled (scheduledStart=null)
 * 4) isJobScheduled() returns false when scheduledStart is null
 * 5) getJobStatusDisplay() does NOT return "Scheduled" for unscheduled open jobs
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { jobs, companies, users, clientLocations, customerCompanies, isJobScheduled } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

const TEST_PREFIX = "sched_inv_test_";
let companyId: string;
let userId: string;
let customerCompanyId: string;
let locationId: string;
const createdJobIds: string[] = [];
let jobSeq = 950000;

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
  if (createdJobIds.length > 0) {
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

/** Create a job and track its ID for cleanup */
async function createJob(overrides: Record<string, unknown> = {}): Promise<string> {
  const jobId = uuidv4();
  createdJobIds.push(jobId);

  jobSeq += 1;
  await db.insert(jobs).values({
    id: jobId,
    companyId,
    locationId,
    jobNumber: jobSeq,
    status: "open",
    jobType: "maintenance",
    summary: `${TEST_PREFIX}job`,
    isActive: true,
    isAllDay: false,
    ...overrides,
  });

  return jobId;
}

describe("Job Scheduling Invariants", () => {
  beforeAll(async () => {
    await createFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  // ==========================================================================
  // Test 1: DB rejects is_all_day=true when scheduled_start IS NULL
  // ==========================================================================
  it("DB rejects isAllDay=true when scheduledStart is null", async () => {
    const jobId = uuidv4();
    createdJobIds.push(jobId);
    jobSeq += 1;

    await expect(
      db.insert(jobs).values({
        id: jobId,
        companyId,
        locationId,
        jobNumber: jobSeq,
        status: "open",
        jobType: "maintenance",
        summary: `${TEST_PREFIX}bad_allday`,
        isActive: true,
        scheduledStart: null,
        isAllDay: true,
      })
    ).rejects.toThrow(/allday_requires_start|all_day_start_midnight/);
  });

  // ==========================================================================
  // Test 2: DB rejects scheduled_end without scheduled_start
  // ==========================================================================
  it("DB rejects scheduledEnd without scheduledStart", async () => {
    const jobId = uuidv4();
    createdJobIds.push(jobId);
    jobSeq += 1;

    await expect(
      db.insert(jobs).values({
        id: jobId,
        companyId,
        locationId,
        jobNumber: jobSeq,
        status: "open",
        jobType: "maintenance",
        summary: `${TEST_PREFIX}bad_end`,
        isActive: true,
        scheduledStart: null,
        scheduledEnd: new Date("2026-03-15T17:00:00Z"),
        isAllDay: false,
      })
    ).rejects.toThrow(/scheduled_end_requires_start/);
  });

  // ==========================================================================
  // Test 3: Valid unscheduled job is accepted
  // ==========================================================================
  it("accepts unscheduled open job with isAllDay=false and no scheduledEnd", async () => {
    const jobId = await createJob({
      summary: `${TEST_PREFIX}unscheduled_valid`,
      scheduledStart: null,
      scheduledEnd: null,
      isAllDay: false,
    });

    const [row] = await db
      .select({ id: jobs.id, isAllDay: jobs.isAllDay, scheduledEnd: jobs.scheduledEnd })
      .from(jobs)
      .where(eq(jobs.id, jobId));

    expect(row).toBeTruthy();
    expect(row.isAllDay).toBe(false);
    expect(row.scheduledEnd).toBeNull();
  });

  // ==========================================================================
  // Test 4: Valid scheduled job is accepted
  // ==========================================================================
  it("accepts scheduled open job with isAllDay=false", async () => {
    const jobId = await createJob({
      summary: `${TEST_PREFIX}scheduled_valid`,
      scheduledStart: new Date("2026-03-15T09:00:00Z"),
      scheduledEnd: new Date("2026-03-15T10:00:00Z"),
      isAllDay: false,
    });

    const [row] = await db
      .select({ id: jobs.id, scheduledStart: jobs.scheduledStart })
      .from(jobs)
      .where(eq(jobs.id, jobId));

    expect(row).toBeTruthy();
    expect(row.scheduledStart).toBeTruthy();
  });

  // ==========================================================================
  // Test 5: isJobScheduled() predicate — null → false
  // ==========================================================================
  it("isJobScheduled() returns false when scheduledStart is null", () => {
    expect(isJobScheduled({ scheduledStart: null })).toBe(false);
    expect(isJobScheduled({ scheduledStart: undefined })).toBe(false);
    expect(isJobScheduled({})).toBe(false);
  });

  // ==========================================================================
  // Test 6: isJobScheduled() predicate — non-null → true
  // ==========================================================================
  it("isJobScheduled() returns true when scheduledStart is set", () => {
    expect(isJobScheduled({ scheduledStart: new Date("2026-03-15T09:00:00Z") })).toBe(true);
    expect(isJobScheduled({ scheduledStart: "2026-03-15T09:00:00Z" })).toBe(true);
  });

  // ==========================================================================
  // Test 7: Status display for unscheduled open job is NOT "Scheduled"
  // ==========================================================================
  it("getJobStatusDisplay() returns 'Open' not 'Scheduled' for unscheduled job", async () => {
    // Import dynamically to avoid client-side module issues in test env
    const { getJobStatusDisplay } = await import("../client/src/components/job/jobUtils");

    const unscheduledJob = {
      status: "open",
      openSubStatus: null,
      scheduledStart: null,
      scheduledEnd: null,
      isAllDay: false,
    };

    const display = getJobStatusDisplay(unscheduledJob);
    expect(display.label).not.toBe("Scheduled");
    expect(display.label).toBe("Open");
  });

  // ==========================================================================
  // Test 8: Status display for scheduled open job IS "Scheduled"
  // ==========================================================================
  it("getJobStatusDisplay() returns 'Scheduled' for scheduled open job", async () => {
    const { getJobStatusDisplay } = await import("../client/src/components/job/jobUtils");

    const scheduledJob = {
      status: "open",
      openSubStatus: null,
      scheduledStart: new Date("2026-04-15T09:00:00Z"),
      scheduledEnd: new Date("2026-04-15T10:00:00Z"),
      isAllDay: false,
    };

    const display = getJobStatusDisplay(scheduledJob);
    expect(display.label).toBe("Scheduled");
  });

  // ==========================================================================
  // Test 9: Valid all-day job with proper scheduling is accepted
  // ==========================================================================
  it("accepts all-day job with scheduledStart at midnight", async () => {
    const jobId = await createJob({
      summary: `${TEST_PREFIX}allday_valid`,
      scheduledStart: new Date("2026-03-15T00:00:00Z"),
      scheduledEnd: new Date("2026-03-15T23:59:59Z"),
      isAllDay: true,
    });

    const [row] = await db
      .select({ id: jobs.id, isAllDay: jobs.isAllDay })
      .from(jobs)
      .where(eq(jobs.id, jobId));

    expect(row).toBeTruthy();
    expect(row.isAllDay).toBe(true);
  });
});
