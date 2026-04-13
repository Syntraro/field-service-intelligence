/**
 * Calendar Drag & Drop Tests
 *
 * Tests the calendar scheduling operations that power drag & drop:
 * 1. Schedule job (drag from unscheduled to calendar)
 * 2. Reschedule job (drag to new date/time)
 * 3. Change technician (drag to different tech column)
 * 4. Unassign technician (drag to unassigned column)
 * 5. Unschedule job (drag back to unscheduled sidebar)
 * 6. Version mismatch handling (optimistic locking)
 * 7. All-day event scheduling
 *
 * Created 2026-01-28: Tests for optimistic update improvements
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../server/db";
import { jobs, jobVisits, companies, users, clientLocations, customerCompanies } from "@shared/schema";
import { eq } from "drizzle-orm";
import { jobRepository } from "../server/storage/jobs";
import { schedulingRepository } from "../server/storage/scheduling";
import { v4 as uuidv4 } from "uuid";

// Test data IDs - cleaned up after tests
const TEST_PREFIX = "calendar_dnd_test_";
let testCompanyId: string;
let testTechnicianId: string;
let testTechnician2Id: string;
let testCustomerCompanyId: string;
let testLocationId: string;
let testJobIds: string[] = [];

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

  // Create test technician 1
  testTechnicianId = uuidv4();
  await db.insert(users).values({
    id: testTechnicianId,
    companyId: testCompanyId,
    email: `${TEST_PREFIX}tech1_${Date.now()}@test.com`,
    password: "test_password_hash",
    role: "technician",
    firstName: "Tech",
    lastName: "One",
  });

  // Create test technician 2 (for reassignment tests)
  testTechnician2Id = uuidv4();
  await db.insert(users).values({
    id: testTechnician2Id,
    companyId: testCompanyId,
    email: `${TEST_PREFIX}tech2_${Date.now()}@test.com`,
    password: "test_password_hash",
    role: "technician",
    firstName: "Tech",
    lastName: "Two",
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
  // Clean up jobs first
  for (const jobId of testJobIds) {
    try {
      await db.delete(jobs).where(eq(jobs.id, jobId));
    } catch (e) {
      // Ignore if already deleted
    }
  }

  // Clean up in reverse order of creation
  if (testLocationId) {
    await db.delete(clientLocations).where(eq(clientLocations.id, testLocationId));
  }
  if (testCustomerCompanyId) {
    await db.delete(customerCompanies).where(eq(customerCompanies.id, testCustomerCompanyId));
  }
  if (testTechnician2Id) {
    await db.delete(users).where(eq(users.id, testTechnician2Id));
  }
  if (testTechnicianId) {
    await db.delete(users).where(eq(users.id, testTechnicianId));
  }
  if (testCompanyId) {
    await db.delete(companies).where(eq(companies.id, testCompanyId));
  }
}

/**
 * Helper to create UTC midnight start date for all-day events
 * Returns a Date that toISOString() will produce T00:00:00.000Z
 */
function createAllDayStartUTC(baseDate?: Date): Date {
  const d = baseDate || new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

/**
 * Helper to create UTC end-of-day date for all-day events
 * Returns a Date that toISOString() will produce T23:59:59.000Z
 * (DB constraint requires hour=23, minute=59 in UTC)
 */
function createAllDayEndUTC(baseDate?: Date): Date {
  const d = baseDate || new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 0));
}

/**
 * Helper to create a test job
 * Note: All-day events must end at exactly 23:59:59 UTC per DB constraint
 */
async function createTestJob(options: {
  scheduled?: boolean;
  technician?: string | null;
  allDay?: boolean;
  summary?: string;
}) {
  const now = new Date();
  let scheduledStart: Date | null = null;
  let scheduledEnd: Date | null = null;

  if (options.scheduled) {
    if (options.allDay) {
      // All-day: must be exactly T00:00:00.000Z to T23:59:59.000Z in UTC
      scheduledStart = createAllDayStartUTC(now);
      scheduledEnd = createAllDayEndUTC(now);
    } else {
      // Timed event: use local hours for simplicity
      scheduledStart = new Date(now);
      scheduledStart.setHours(10, 0, 0, 0);
      scheduledEnd = new Date(scheduledStart);
      scheduledEnd.setHours(11, 0, 0, 0); // 1 hour duration
    }
  }

  // 2026-04-12 (Option A): tech on the create payload is forwarded by the
  // server to the seed visit. The job row never persists assignment. We
  // re-fetch via getJob so the returned shape carries the visit-derived
  // `primaryTechnicianId` / `assignedTechnicianIds` used by callers.
  const created = await jobRepository.createJob(testCompanyId, {
    companyId: testCompanyId,
    locationId: testLocationId,
    jobType: "PM",
    summary: options.summary || `${TEST_PREFIX}job_${Date.now()}`,
    status: "open",
    assignedTechnicianIds: [options.technician ?? testTechnicianId],
    scheduledStart,
    scheduledEnd,
    isAllDay: options.allDay ?? false,
  } as any);

  testJobIds.push(created.id);
  const enriched = await jobRepository.getJob(testCompanyId, created.id);
  return enriched as any;
}

describe("Calendar Drag & Drop Tests", () => {
  beforeAll(async () => {
    await createTestFixtures();
  });

  afterAll(async () => {
    await cleanupTestFixtures();
  });

  // ============================================================================
  // Test 1: Schedule unscheduled job (drag from sidebar to calendar)
  // ============================================================================
  describe("Schedule Job (createAssignment equivalent)", () => {
    it("should move job from unscheduled to calendar when scheduled", async () => {
      // Create unscheduled job
      const job = await createTestJob({ scheduled: false });
      expect(job.scheduledStart).toBeNull();

      // Verify it's in backlog
      const backlogBefore = await schedulingRepository.getUnscheduledJobs(testCompanyId);
      const inBacklog = backlogBefore.find((j) => j.id === job.id);
      expect(inBacklog).toBeDefined();

      // Schedule the job (simulates drag to calendar)
      const scheduledStart = new Date();
      scheduledStart.setHours(14, 30, 0, 0); // 2:30 PM
      const scheduledEnd = new Date(scheduledStart);
      scheduledEnd.setMinutes(scheduledEnd.getMinutes() + 60); // 1 hour duration

      const updated = await jobRepository.updateJob(
        testCompanyId,
        job.id,
        job.version,
        { scheduledStart, scheduledEnd },
        { isSchedulingUpdate: true }
      );

      expect(updated).toBeDefined();
      expect(updated!.scheduledStart).toBeDefined();
      expect(updated!.version).toBe(job.version + 1);

      // Verify it's no longer in backlog
      const backlogAfter = await schedulingRepository.getUnscheduledJobs(testCompanyId);
      const stillInBacklog = backlogAfter.find((j) => j.id === job.id);
      expect(stillInBacklog).toBeUndefined();

      // Verify it's in calendar
      const startOfDay = new Date(scheduledStart);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(scheduledStart);
      endOfDay.setHours(23, 59, 59, 999);

      const { jobs: calendarJobs } = await schedulingRepository.getScheduledJobsInRangeWithMetadata(
        testCompanyId,
        startOfDay,
        endOfDay,
        0,
        24
      );
      const inCalendar = calendarJobs.find((j) => j.jobId === job.id);
      expect(inCalendar).toBeDefined();
    });

    it("should increment version when scheduling", async () => {
      const job = await createTestJob({ scheduled: false });
      const initialVersion = job.version;

      const scheduledStart = new Date();
      scheduledStart.setHours(9, 0, 0, 0);
      const scheduledEnd = new Date(scheduledStart);
      scheduledEnd.setHours(10, 0, 0, 0);

      const updated = await jobRepository.updateJob(
        testCompanyId,
        job.id,
        job.version,
        { scheduledStart, scheduledEnd },
        { isSchedulingUpdate: true }
      );

      expect(updated!.version).toBe(initialVersion + 1);
    });
  });

  // ============================================================================
  // Test 2: Reschedule job (drag to new date/time)
  // ============================================================================
  describe("Reschedule Job (updateAssignment equivalent)", () => {
    it("should update job time when rescheduled", async () => {
      // Create scheduled job
      const job = await createTestJob({ scheduled: true });
      const originalStart = job.scheduledStart!;

      // Reschedule to different time (simulates drag to new slot)
      const newStart = new Date(originalStart);
      newStart.setHours(newStart.getHours() + 3); // Move 3 hours later
      const newEnd = new Date(newStart);
      newEnd.setHours(newEnd.getHours() + 1);

      const updated = await jobRepository.updateJob(
        testCompanyId,
        job.id,
        job.version,
        { scheduledStart: newStart, scheduledEnd: newEnd },
        { isSchedulingUpdate: true }
      );

      expect(updated).toBeDefined();
      expect(updated!.scheduledStart!.getHours()).toBe(newStart.getHours());
      expect(updated!.version).toBe(job.version + 1);
    });

    it("should update job date when rescheduled to different day", async () => {
      const job = await createTestJob({ scheduled: true });

      // Move to tomorrow
      const newStart = new Date(job.scheduledStart!);
      newStart.setDate(newStart.getDate() + 1);
      const newEnd = new Date(newStart);
      newEnd.setHours(newEnd.getHours() + 1);

      const updated = await jobRepository.updateJob(
        testCompanyId,
        job.id,
        job.version,
        { scheduledStart: newStart, scheduledEnd: newEnd },
        { isSchedulingUpdate: true }
      );

      expect(updated).toBeDefined();
      expect(updated!.scheduledStart!.getDate()).toBe(newStart.getDate());
    });
  });

  // ============================================================================
  // Test 3: Change technician (drag to different tech column)
  // ============================================================================
  // 2026-04-12 (Option A): tech-change via job columns no longer exists.
  // Drag-to-tech-column and drag-to-unassigned now mutate the visit crew
  // directly through the canonical scheduling path.
  describe("Change Technician Assignment (visit-level)", () => {
    it("should change the visit crew when job dragged to different tech column", async () => {
      const job = await createTestJob({ scheduled: true, technician: testTechnicianId });
      expect(job.assignedTechnicianIds).toContain(testTechnicianId);

      const [visit] = await db
        .select()
        .from(jobVisits)
        .where(eq(jobVisits.jobId, job.id))
        .limit(1);

      await schedulingRepository.updateVisitCrew(
        testCompanyId,
        visit.id,
        [testTechnician2Id],
        visit.version,
      );

      const refetched = await jobRepository.getJob(testCompanyId, job.id);
      expect(refetched!.assignedTechnicianIds).toEqual([testTechnician2Id]);
      expect(refetched!.primaryTechnicianId).toBe(testTechnician2Id);
    });

    it("should unassign the visit crew when dragged to unassigned column", async () => {
      const job = await createTestJob({ scheduled: true, technician: testTechnicianId });
      expect(job.assignedTechnicianIds).toContain(testTechnicianId);

      const [visit] = await db
        .select()
        .from(jobVisits)
        .where(eq(jobVisits.jobId, job.id))
        .limit(1);

      await schedulingRepository.updateVisitCrew(
        testCompanyId,
        visit.id,
        [],
        visit.version,
      );

      const refetched = await jobRepository.getJob(testCompanyId, job.id);
      expect(refetched!.assignedTechnicianIds).toEqual([]);
      expect(refetched!.primaryTechnicianId).toBeNull();
    });
  });

  // ============================================================================
  // Test 4: Unschedule job (drag back to unscheduled sidebar)
  // ============================================================================
  describe("Unschedule Job (deleteAssignment equivalent)", () => {
    it("should move job back to unscheduled when unscheduled", async () => {
      // Create scheduled job
      const job = await createTestJob({ scheduled: true });
      expect(job.scheduledStart).toBeDefined();

      // Unschedule the job (simulates drag back to sidebar)
      const updated = await jobRepository.updateJob(
        testCompanyId,
        job.id,
        job.version,
        { scheduledStart: null, scheduledEnd: null },
        { isSchedulingUpdate: true }
      );

      expect(updated).toBeDefined();
      expect(updated!.scheduledStart).toBeNull();
      expect(updated!.scheduledEnd).toBeNull();

      // Verify it's back in backlog
      const backlog = await schedulingRepository.getUnscheduledJobs(testCompanyId);
      const inBacklog = backlog.find((j) => j.id === job.id);
      expect(inBacklog).toBeDefined();
    });
  });

  // ============================================================================
  // Test 5: Version mismatch (optimistic locking)
  // ============================================================================
  describe("Version Mismatch Handling", () => {
    it("should reject update with stale version", async () => {
      const job = await createTestJob({ scheduled: true });
      const staleVersion = job.version - 1; // Pretend we have an old version

      const newStart = new Date();
      newStart.setHours(15, 0, 0, 0);
      const newEnd = new Date(newStart);
      newEnd.setHours(16, 0, 0, 0);

      // Attempt update with stale version should fail
      await expect(
        jobRepository.updateJob(
          testCompanyId,
          job.id,
          staleVersion,
          { scheduledStart: newStart, scheduledEnd: newEnd },
          { isSchedulingUpdate: true }
        )
      ).rejects.toThrow();
    });

    it("should accept update with correct version", async () => {
      const job = await createTestJob({ scheduled: true });

      const newStart = new Date();
      newStart.setHours(16, 0, 0, 0);
      const newEnd = new Date(newStart);
      newEnd.setHours(17, 0, 0, 0);

      // Update with correct version should succeed
      const updated = await jobRepository.updateJob(
        testCompanyId,
        job.id,
        job.version, // Correct version
        { scheduledStart: newStart, scheduledEnd: newEnd },
        { isSchedulingUpdate: true }
      );

      expect(updated).toBeDefined();
      expect(updated!.version).toBe(job.version + 1);
    });

    it("should increment version on each update", async () => {
      const job = await createTestJob({ scheduled: true });
      let currentVersion = job.version;

      // First update
      let updated = await jobRepository.updateJob(
        testCompanyId,
        job.id,
        currentVersion,
        { summary: "Update 1" },
        { isSchedulingUpdate: false }
      );
      expect(updated!.version).toBe(currentVersion + 1);
      currentVersion = updated!.version;

      // Second update
      updated = await jobRepository.updateJob(
        testCompanyId,
        job.id,
        currentVersion,
        { summary: "Update 2" },
        { isSchedulingUpdate: false }
      );
      expect(updated!.version).toBe(currentVersion + 1);
    });
  });

  // ============================================================================
  // Test 6: All-day event scheduling
  // Note: DB constraint requires all-day events end at exactly 23:59:00
  // ============================================================================
  describe("All-Day Event Scheduling", () => {
    it("should schedule job as all-day event", async () => {
      const job = await createTestJob({ scheduled: false });

      // Schedule as all-day (simulates drop on all-day lane)
      // DB constraint: must be T00:00:00.000Z to T23:59:59.000Z in UTC
      const targetDate = createAllDayStartUTC();
      const endOfDay = createAllDayEndUTC();

      const updated = await jobRepository.updateJob(
        testCompanyId,
        job.id,
        job.version,
        {
          scheduledStart: targetDate,
          scheduledEnd: endOfDay,
          isAllDay: true,
        },
        { isSchedulingUpdate: true }
      );

      expect(updated).toBeDefined();
      expect(updated!.isAllDay).toBe(true);
      expect(updated!.scheduledStart).toBeDefined();
    });

    it("should convert timed event to all-day", async () => {
      // Create timed job
      const job = await createTestJob({ scheduled: true, allDay: false });
      expect(job.isAllDay).toBe(false);

      // Convert to all-day (simulates drag to all-day lane)
      // DB constraint: must be T00:00:00.000Z to T23:59:59.000Z in UTC
      const targetDate = createAllDayStartUTC(job.scheduledStart!);
      const endOfDay = createAllDayEndUTC(job.scheduledStart!);

      const updated = await jobRepository.updateJob(
        testCompanyId,
        job.id,
        job.version,
        {
          scheduledStart: targetDate,
          scheduledEnd: endOfDay,
          isAllDay: true,
        },
        { isSchedulingUpdate: true }
      );

      expect(updated).toBeDefined();
      expect(updated!.isAllDay).toBe(true);
    });

    it("should convert all-day event to timed", async () => {
      // Create all-day job
      const job = await createTestJob({ scheduled: true, allDay: true });
      expect(job.isAllDay).toBe(true);

      // Convert to timed (simulates drag from all-day lane to time slot)
      const newStart = new Date();
      newStart.setHours(14, 0, 0, 0);
      const newEnd = new Date(newStart);
      newEnd.setHours(15, 0, 0, 0);

      const updated = await jobRepository.updateJob(
        testCompanyId,
        job.id,
        job.version,
        {
          scheduledStart: newStart,
          scheduledEnd: newEnd,
          isAllDay: false,
        },
        { isSchedulingUpdate: true }
      );

      expect(updated).toBeDefined();
      expect(updated!.isAllDay).toBe(false);
      expect(updated!.scheduledStart!.getHours()).toBe(14);
    });
  });

  // ============================================================================
  // Test 7: Combined operations (reschedule + reassign)
  // ============================================================================
  // 2026-04-12 (Option A): reschedule and crew change are now two separate
  // writes against the visit. Reschedule keeps operating through the job-row
  // scheduling fields (schedule is still job-level). Crew changes go through
  // updateVisitCrew.
  describe("Combined Operations (visit-level crew + job-level schedule)", () => {
    it("should reschedule the job and update visit crew independently", async () => {
      const job = await createTestJob({ scheduled: true, technician: testTechnicianId });

      const newStart = new Date(job.scheduledStart!);
      newStart.setHours(15, 0, 0, 0);
      const newEnd = new Date(newStart);
      newEnd.setHours(16, 0, 0, 0);

      const rescheduled = await jobRepository.updateJob(
        testCompanyId,
        job.id,
        job.version,
        { scheduledStart: newStart, scheduledEnd: newEnd },
        { isSchedulingUpdate: true }
      );
      expect(rescheduled!.scheduledStart!.getHours()).toBe(15);

      const [visit] = await db
        .select()
        .from(jobVisits)
        .where(eq(jobVisits.jobId, job.id))
        .limit(1);
      await schedulingRepository.updateVisitCrew(
        testCompanyId,
        visit.id,
        [testTechnician2Id],
        visit.version,
      );

      const finalJob = await jobRepository.getJob(testCompanyId, job.id);
      expect(finalJob!.assignedTechnicianIds).toEqual([testTechnician2Id]);
    });
  });
});
