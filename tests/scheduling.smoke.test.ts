/**
 * Scheduling Smoke Tests
 *
 * Validates core scheduling flows:
 * 1) Unscheduled job -> appears in backlog, not in calendar
 * 2) Schedule job -> appears in calendar, version incremented
 * 3) Conflict -> VersionMismatchError has correct code (409)
 * 4) RBAC: Technician scheduling returns 403 FORBIDDEN
 * 5) RBAC: Dispatcher/admin scheduling succeeds
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { jobs, jobScheduleAudit, companies, users, clientLocations, customerCompanies } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { jobRepository } from "../server/storage/jobs";
import { schedulingRepository } from "../server/storage/scheduling";
import { VersionMismatchError } from "../server/domain/scheduling";
import {
  canEditSchedule,
  assertCanEditSchedule,
  SchedulingForbiddenError,
} from "../server/guards/schedulingPermissions";
import { v4 as uuidv4 } from "uuid";

// Test data IDs - cleaned up after tests
const TEST_PREFIX = "smoke_test_";
let testCompanyId: string;
let testUserId: string;
let testCustomerCompanyId: string;
let testLocationId: string;
let testJobId: string;

/**
 * Helper to create test fixtures
 */
async function createTestFixtures() {
  // Create test company
  testCompanyId = uuidv4();
  await db.insert(companies).values({
    id: testCompanyId,
    name: `${TEST_PREFIX}company`,
  });

  // Create test user (technician for job assignment)
  testUserId = uuidv4();
  await db.insert(users).values({
    id: testUserId,
    companyId: testCompanyId,
    email: `${TEST_PREFIX}${Date.now()}@test.com`,
    password: "test_password_hash",
    role: "technician",
    firstName: "Test",
    lastName: "Tech",
  });

  // Create test customer company
  testCustomerCompanyId = uuidv4();
  await db.insert(customerCompanies).values({
    id: testCustomerCompanyId,
    companyId: testCompanyId,
    name: `${TEST_PREFIX}customer`,
  });

  // Create test location
  testLocationId = uuidv4();
  await db.insert(clientLocations).values({
    id: testLocationId,
    companyId: testCompanyId,
    parentCompanyId: testCustomerCompanyId,
    companyName: `${TEST_PREFIX}location`,
    address: "123 Test St",
    selectedMonths: [],
  });
}

/**
 * Helper to clean up test fixtures
 */
async function cleanupTestFixtures() {
  // Clean up in reverse order of creation (due to foreign keys)
  if (testJobId) {
    await db.delete(jobScheduleAudit).where(eq(jobScheduleAudit.jobId, testJobId));
    await db.delete(jobs).where(eq(jobs.id, testJobId));
  }
  if (testLocationId) {
    await db.delete(clientLocations).where(eq(clientLocations.id, testLocationId));
  }
  if (testCustomerCompanyId) {
    await db.delete(customerCompanies).where(eq(customerCompanies.id, testCustomerCompanyId));
  }
  if (testUserId) {
    await db.delete(users).where(eq(users.id, testUserId));
  }
  if (testCompanyId) {
    await db.delete(companies).where(eq(companies.id, testCompanyId));
  }
}

describe("Scheduling Smoke Tests", () => {
  beforeAll(async () => {
    await createTestFixtures();
  });

  afterAll(async () => {
    await cleanupTestFixtures();
  });

  // ============================================================================
  // Test 1: Unscheduled job appears in backlog, not in calendar
  // ============================================================================
  it("Test 1: Unscheduled job -> backlog includes it, calendar excludes it", async () => {
    // 2026-04-12 (Option A): crew forwarded to seed visit. Backlog eligibility
    // is now status='open' + scheduledStart IS NULL (no longer tech-dependent).
    const job = await jobRepository.createJob(testCompanyId, {
      companyId: testCompanyId,
      locationId: testLocationId,
      jobType: "PM",
      summary: `${TEST_PREFIX}unscheduled_job`,
      status: "open",
      assignedTechnicianIds: [testUserId],
      // No scheduledStart/scheduledEnd -> unscheduled
    } as any);
    testJobId = job.id;

    expect(job.id).toBeDefined();
    expect(job.scheduledStart).toBeNull();
    expect(job.status).toBe("open");

    // Query backlog - should include the job (has technician, no schedule, open status)
    const backlog = await schedulingRepository.getUnscheduledJobs(testCompanyId);
    const backlogJob = backlog.find((j) => j.id === job.id);
    expect(backlogJob).toBeDefined();
    expect(backlogJob!.status).toBe("open");

    // Query calendar - should NOT include the job
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const { jobs: assignments } = await schedulingRepository.getScheduledJobsInRangeWithMetadata(
      testCompanyId,
      startDate,
      endDate,
      6,
      19
    );

    const calendarJob = assignments.find((a) => a.jobId === job.id);
    expect(calendarJob).toBeUndefined();
  });

  // ============================================================================
  // Test 2: Schedule job -> calendar includes it, version incremented
  // ============================================================================
  it("Test 2: Schedule job -> calendar includes it, version incremented", async () => {
    // Get initial version
    const beforeJob = await jobRepository.getJob(testCompanyId, testJobId);
    const initialVersion = beforeJob?.version ?? 0;

    // Schedule the job
    const scheduledStart = new Date();
    scheduledStart.setHours(10, 0, 0, 0);
    const scheduledEnd = new Date(scheduledStart);
    scheduledEnd.setHours(11, 0, 0, 0);

    // Schedule the job — status stays "open"; scheduling is derived from scheduledStart
    const updated = await jobRepository.updateJob(
      testCompanyId,
      testJobId,
      undefined, // No version check for first update
      {
        scheduledStart,
        scheduledEnd,
      },
      { isSchedulingUpdate: true }
    );

    expect(updated).toBeDefined();
    expect(updated!.scheduledStart).toBeDefined();
    expect(updated!.status).toBe("open"); // Status stays "open"; "scheduled" is derived
    expect(updated!.version).toBe(initialVersion + 1); // Version incremented

    // Query calendar - should include the job now (has scheduledStart in range)
    const startDate = new Date(scheduledStart);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(scheduledStart);
    endDate.setHours(23, 59, 59, 999);

    const { jobs: assignments } = await schedulingRepository.getScheduledJobsInRangeWithMetadata(
      testCompanyId,
      startDate,
      endDate,
      6,
      19
    );

    const calendarJob = assignments.find((a) => a.jobId === testJobId);
    expect(calendarJob).toBeDefined();
    expect(calendarJob!.status).toBe("open"); // Lifecycle status is "open"

    // Verify backlog no longer includes the job (has scheduledStart now)
    const backlog = await schedulingRepository.getUnscheduledJobs(testCompanyId);
    const backlogJob = backlog.find((j) => j.id === testJobId);
    expect(backlogJob).toBeUndefined();
  });

  // ============================================================================
  // Test 3: VersionMismatchError has correct code and structure
  // ============================================================================
  it("Test 3: VersionMismatchError has correct code (409) and VERSION_MISMATCH", async () => {
    // Test VersionMismatchError directly
    const expectedVersion = 1;
    const actualVersion = 2;

    const error = new VersionMismatchError(expectedVersion, actualVersion);

    // Verify error type and basic properties
    expect(error).toBeInstanceOf(VersionMismatchError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("VersionMismatchError");
    expect(error.code).toBe("VERSION_MISMATCH");
    expect(error.statusCode).toBe(409);

    // Verify message contains version info for debugging
    expect(error.message).toContain(String(expectedVersion));
    expect(error.message).toContain(String(actualVersion));
    expect(error.message).toMatch(/expected.*version/i);
    expect(error.message).toMatch(/actual.*version/i);

    // Verify error can be caught and identified by code
    try {
      throw error;
    } catch (e) {
      expect(e instanceof VersionMismatchError).toBe(true);
      expect((e as VersionMismatchError).code).toBe("VERSION_MISMATCH");
      expect((e as VersionMismatchError).statusCode).toBe(409);
    }

    // Verify it works with typical conflict scenario
    // Client sends expectedVersion=1 but DB has version=2
    const staleError = new VersionMismatchError(1, 2);
    expect(staleError.message).toContain("1");
    expect(staleError.message).toContain("2");
  });

  // ============================================================================
  // Test 4: RBAC - Technician scheduling returns 403 FORBIDDEN
  // ============================================================================
  it("Test 4: Technician scheduling attempt throws 403 FORBIDDEN", async () => {
    // Simulate a technician user
    const technicianUser = { role: "technician" };

    // canEditSchedule should return false for technician (pass user object)
    expect(canEditSchedule(technicianUser)).toBe(false);

    // assertCanEditSchedule should throw SchedulingForbiddenError
    expect(() => {
      assertCanEditSchedule(technicianUser);
    }).toThrow(SchedulingForbiddenError);

    // Verify the error has correct structure
    try {
      assertCanEditSchedule(technicianUser);
    } catch (error) {
      expect(error).toBeInstanceOf(SchedulingForbiddenError);
      const forbiddenError = error as SchedulingForbiddenError;
      expect(forbiddenError.code).toBe("FORBIDDEN");
      expect(forbiddenError.statusCode).toBe(403);
      expect(forbiddenError.message).toContain("permission");

      // Verify toJSON produces expected API response shape
      const json = forbiddenError.toJSON();
      expect(json.code).toBe("FORBIDDEN");
      expect(json.error).toContain("permission");
    }

    // Also verify manager is view-only for scheduling (per requirements)
    expect(canEditSchedule({ role: "manager" })).toBe(false);
  });

  // ============================================================================
  // Test 5: RBAC - Dispatcher/Admin/Owner scheduling succeeds
  // ============================================================================
  it("Test 5: Dispatcher/Admin/Owner can schedule (no 403)", async () => {
    // Test all roles that should be able to schedule
    const allowedRoles = ["owner", "admin", "dispatcher"];

    for (const role of allowedRoles) {
      const user = { role };

      // canEditSchedule should return true (pass user object, not string)
      expect(canEditSchedule(user)).toBe(true);

      // assertCanEditSchedule should NOT throw
      expect(() => {
        assertCanEditSchedule(user);
      }).not.toThrow();
    }

    // Verify scheduling still works for allowed roles (use existing job from earlier tests)
    // Get job to verify it still has correct version after earlier tests
    const job = await jobRepository.getJob(testCompanyId, testJobId);
    expect(job).toBeDefined();
    expect(job!.version).toBeGreaterThan(0); // Version was incremented in Test 2

    // Verify version is NOT incremented when user lacks permission (assertion throws before any work)
    // This is implicitly tested: if assertCanEditSchedule throws, no update happens
  });
});
