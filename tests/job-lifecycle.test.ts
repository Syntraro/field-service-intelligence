/**
 * Job Lifecycle Hardening Tests
 *
 * Validates lifecycle transition invariants:
 * 1) Terminal transitions clear scheduling fields
 * 2) Version checking (409 on mismatch)
 * 3) RBAC: Only LIFECYCLE_ROLES can perform transitions
 * 4) Audit logging on transitions
 * 5) Undo window expiration
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import {
  jobs,
  jobStatusEvents,
  companies,
  users,
  clientLocations,
  customerCompanies,
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { jobRepository } from "../server/storage/jobs";
import {
  applyLifecycleTransition,
  LifecycleTransitionError,
  LIFECYCLE_ROLES,
  getScheduleClearingPatch,
  hasScheduleFields,
  UNDO_WINDOW_MS,
  type LifecycleIntent,
  type TransitionActor,
} from "../server/domain/jobLifecycle";
import { v4 as uuidv4 } from "uuid";

// Test data IDs - cleaned up after tests
const TEST_PREFIX = "lifecycle_test_";
let testCompanyId: string;
let testUserId: string;
let testCustomerCompanyId: string;
let testLocationId: string;
let testJobId: string;

/**
 * Helper to create test fixtures
 */
async function createTestFixtures() {
  testCompanyId = uuidv4();
  await db.insert(companies).values({
    id: testCompanyId,
    name: `${TEST_PREFIX}company`,
  });

  testUserId = uuidv4();
  await db.insert(users).values({
    id: testUserId,
    companyId: testCompanyId,
    email: `${TEST_PREFIX}${Date.now()}@test.com`,
    password: "test_password_hash",
    role: "dispatcher",
    firstName: "Test",
    lastName: "Dispatcher",
  });

  testCustomerCompanyId = uuidv4();
  await db.insert(customerCompanies).values({
    id: testCustomerCompanyId,
    companyId: testCompanyId,
    name: `${TEST_PREFIX}customer`,
  });

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
  if (testJobId) {
    await db.delete(jobStatusEvents).where(eq(jobStatusEvents.jobId, testJobId));
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

/**
 * Helper to create a scheduled job for testing
 */
async function createScheduledJob(): Promise<string> {
  const scheduledStart = new Date();
  scheduledStart.setHours(10, 0, 0, 0);
  const scheduledEnd = new Date(scheduledStart);
  scheduledEnd.setHours(11, 0, 0, 0);

  const job = await jobRepository.createJob(testCompanyId, {
    companyId: testCompanyId,
    locationId: testLocationId,
    jobType: "PM",
    summary: `${TEST_PREFIX}scheduled_job`,
    status: "in_progress",
    primaryTechnicianId: testUserId,
    scheduledStart,
    scheduledEnd,
    isAllDay: false,
  });

  return job.id;
}

describe("Job Lifecycle Hardening Tests", () => {
  beforeAll(async () => {
    await createTestFixtures();
  });

  afterAll(async () => {
    await cleanupTestFixtures();
  });

  // ============================================================================
  // Test 1: Terminal transitions clear scheduling fields
  // ============================================================================
  describe("Terminal transitions clear scheduling fields", () => {
    it("CLOSE_JOB with archive mode clears schedule", async () => {
      testJobId = await createScheduledJob();

      // Get the job
      const job = await jobRepository.getJob(testCompanyId, testJobId);
      expect(job).toBeDefined();
      expect(job!.scheduledStart).toBeDefined();

      const actor: TransitionActor = { userId: testUserId, role: "dispatcher" };
      const intent: LifecycleIntent = { type: "CLOSE_JOB", mode: "archive" };

      // Apply transition
      const result = applyLifecycleTransition(job!, intent, actor);

      // Verify schedule clearing patch
      expect(result.patch.scheduledStart).toBeNull();
      expect(result.patch.scheduledEnd).toBeNull();
      expect(result.patch.isAllDay).toBe(false);
      expect(result.patch.calendarAssignmentId).toBeNull();
      expect(result.finalStatus).toBe("archived");
    });

    it("CANCEL_JOB clears schedule", async () => {
      // Create new job for this test
      const jobId = await createScheduledJob();
      const job = await jobRepository.getJob(testCompanyId, jobId);

      const actor: TransitionActor = { userId: testUserId, role: "dispatcher" };
      const intent: LifecycleIntent = { type: "CANCEL_JOB", reason: "Test cancellation" };

      const result = applyLifecycleTransition(job!, intent, actor);

      expect(result.patch.scheduledStart).toBeNull();
      expect(result.patch.scheduledEnd).toBeNull();
      expect(result.finalStatus).toBe("canceled");

      // Clean up
      await db.delete(jobs).where(eq(jobs.id, jobId));
    });

    it("getScheduleClearingPatch returns correct fields", () => {
      const patch = getScheduleClearingPatch();

      expect(patch.scheduledStart).toBeNull();
      expect(patch.scheduledEnd).toBeNull();
      expect(patch.isAllDay).toBe(false);
      expect(patch.calendarAssignmentId).toBeNull();
    });

    it("hasScheduleFields detects scheduled jobs", () => {
      const scheduled = {
        scheduledStart: new Date(),
        scheduledEnd: new Date(),
        isAllDay: false,
      };

      const unscheduled = {
        scheduledStart: null,
        scheduledEnd: null,
        isAllDay: false,
      };

      const allDay = {
        scheduledStart: null,
        scheduledEnd: null,
        isAllDay: true,
      };

      expect(hasScheduleFields(scheduled)).toBe(true);
      expect(hasScheduleFields(unscheduled)).toBe(false);
      expect(hasScheduleFields(allDay)).toBe(true);
    });
  });

  // ============================================================================
  // Test 2: RBAC enforcement
  // ============================================================================
  describe("RBAC enforcement", () => {
    it("LIFECYCLE_ROLES contains correct roles", () => {
      expect(LIFECYCLE_ROLES).toContain("owner");
      expect(LIFECYCLE_ROLES).toContain("admin");
      expect(LIFECYCLE_ROLES).toContain("dispatcher");
      expect(LIFECYCLE_ROLES).toContain("manager");
      expect(LIFECYCLE_ROLES).not.toContain("technician");
    });

    it("Technician cannot perform lifecycle transitions", async () => {
      const job = await jobRepository.getJob(testCompanyId, testJobId);

      const techActor: TransitionActor = { userId: testUserId, role: "technician" };
      const intent: LifecycleIntent = { type: "CLOSE_JOB", mode: "archive" };

      expect(() => {
        applyLifecycleTransition(job!, intent, techActor);
      }).toThrow(LifecycleTransitionError);

      try {
        applyLifecycleTransition(job!, intent, techActor);
      } catch (error) {
        expect(error).toBeInstanceOf(LifecycleTransitionError);
        const lifecycleError = error as LifecycleTransitionError;
        expect(lifecycleError.code).toBe("FORBIDDEN");
        expect(lifecycleError.statusCode).toBe(403);
      }
    });

    it("Dispatcher can perform lifecycle transitions", async () => {
      const job = await jobRepository.getJob(testCompanyId, testJobId);

      const dispatcherActor: TransitionActor = { userId: testUserId, role: "dispatcher" };
      const intent: LifecycleIntent = { type: "CLOSE_JOB", mode: "archive" };

      // Should not throw
      const result = applyLifecycleTransition(job!, intent, dispatcherActor);
      expect(result.finalStatus).toBe("archived");
    });

    it("Owner can perform lifecycle transitions", async () => {
      const job = await jobRepository.getJob(testCompanyId, testJobId);

      const ownerActor: TransitionActor = { userId: testUserId, role: "owner" };
      const intent: LifecycleIntent = { type: "CLOSE_JOB", mode: "invoice_later" };

      const result = applyLifecycleTransition(job!, intent, ownerActor);
      expect(result.finalStatus).toBe("requires_invoicing");
    });
  });

  // ============================================================================
  // Test 3: Audit events are generated
  // ============================================================================
  describe("Audit events generation", () => {
    it("CLOSE_JOB generates audit events", async () => {
      const job = await jobRepository.getJob(testCompanyId, testJobId);

      const actor: TransitionActor = { userId: testUserId, role: "dispatcher" };
      const intent: LifecycleIntent = { type: "CLOSE_JOB", mode: "archive" };

      const result = applyLifecycleTransition(job!, intent, actor);

      expect(result.auditEvents.length).toBeGreaterThan(0);

      // Should have archive event
      const archiveEvent = result.auditEvents.find((e) => e.action === "archive");
      expect(archiveEvent).toBeDefined();
      expect(archiveEvent!.toStatus).toBe("archived");
    });

    it("CANCEL_JOB includes reason in audit", async () => {
      const jobId = await createScheduledJob();
      const job = await jobRepository.getJob(testCompanyId, jobId);

      const actor: TransitionActor = { userId: testUserId, role: "dispatcher" };
      const reason = "Customer request";
      const intent: LifecycleIntent = { type: "CANCEL_JOB", reason };

      const result = applyLifecycleTransition(job!, intent, actor);

      const cancelEvent = result.auditEvents.find((e) => e.action === "cancel");
      expect(cancelEvent).toBeDefined();
      expect(cancelEvent!.note).toBe(reason);
      expect(cancelEvent!.meta?.reason).toBe(reason);

      // Clean up
      await db.delete(jobs).where(eq(jobs.id, jobId));
    });
  });

  // ============================================================================
  // Test 4: Close mode validation
  // ============================================================================
  describe("Close mode validation", () => {
    it("invoice_now requires invoiceId", async () => {
      const job = await jobRepository.getJob(testCompanyId, testJobId);

      const actor: TransitionActor = { userId: testUserId, role: "dispatcher" };
      const intent: LifecycleIntent = { type: "CLOSE_JOB", mode: "invoice_now" };

      expect(() => {
        applyLifecycleTransition(job!, intent, actor);
      }).toThrow(LifecycleTransitionError);

      try {
        applyLifecycleTransition(job!, intent, actor);
      } catch (error) {
        const lifecycleError = error as LifecycleTransitionError;
        expect(lifecycleError.code).toBe("MISSING_INVOICE");
      }
    });

    it("invoice_now with invoiceId succeeds", async () => {
      const job = await jobRepository.getJob(testCompanyId, testJobId);

      const actor: TransitionActor = { userId: testUserId, role: "dispatcher" };
      const invoiceId = uuidv4();
      const intent: LifecycleIntent = { type: "CLOSE_JOB", mode: "invoice_now", invoiceId };

      const result = applyLifecycleTransition(job!, intent, actor);

      expect(result.finalStatus).toBe("invoiced");
      expect(result.patch.invoiceId).toBe(invoiceId);
    });
  });

  // ============================================================================
  // Test 5: Undo window
  // ============================================================================
  describe("Undo window", () => {
    it("UNDO_WINDOW_MS is 20 seconds", () => {
      expect(UNDO_WINDOW_MS).toBe(20 * 1000);
    });

    it("UNDO_CLOSE fails without closedAt", async () => {
      const job = await jobRepository.getJob(testCompanyId, testJobId);
      // Simulate job without closedAt
      const jobWithoutClose = { ...job!, closedAt: null, previousStatus: null };

      const actor: TransitionActor = { userId: testUserId, role: "dispatcher" };
      const intent: LifecycleIntent = { type: "UNDO_CLOSE" };

      expect(() => {
        applyLifecycleTransition(jobWithoutClose as any, intent, actor);
      }).toThrow(LifecycleTransitionError);

      try {
        applyLifecycleTransition(jobWithoutClose as any, intent, actor);
      } catch (error) {
        const lifecycleError = error as LifecycleTransitionError;
        expect(lifecycleError.code).toBe("NO_CLOSE_DATA");
      }
    });

    it("UNDO_CLOSE fails after window expires", async () => {
      const job = await jobRepository.getJob(testCompanyId, testJobId);

      // Simulate job closed 30 seconds ago
      const oldClosedAt = new Date(Date.now() - 30 * 1000);
      const closedJob = {
        ...job!,
        closedAt: oldClosedAt,
        previousStatus: "in_progress",
        status: "archived",
      };

      const actor: TransitionActor = { userId: testUserId, role: "dispatcher" };
      const intent: LifecycleIntent = { type: "UNDO_CLOSE" };

      expect(() => {
        applyLifecycleTransition(closedJob as any, intent, actor);
      }).toThrow(LifecycleTransitionError);

      try {
        applyLifecycleTransition(closedJob as any, intent, actor);
      } catch (error) {
        const lifecycleError = error as LifecycleTransitionError;
        expect(lifecycleError.code).toBe("UNDO_WINDOW_EXPIRED");
      }
    });

    it("UNDO_CLOSE succeeds within window", async () => {
      const job = await jobRepository.getJob(testCompanyId, testJobId);

      // Simulate job closed 5 seconds ago
      const recentClosedAt = new Date(Date.now() - 5 * 1000);
      const closedJob = {
        ...job!,
        closedAt: recentClosedAt,
        previousStatus: "in_progress",
        status: "archived",
      };

      const actor: TransitionActor = { userId: testUserId, role: "dispatcher" };
      const intent: LifecycleIntent = { type: "UNDO_CLOSE" };

      const result = applyLifecycleTransition(closedJob as any, intent, actor);

      expect(result.finalStatus).toBe("in_progress");
      expect(result.patch.closedAt).toBeNull();
      expect(result.patch.previousStatus).toBeNull();
    });
  });

  // ============================================================================
  // Test 6: Reopen validation
  // ============================================================================
  describe("Reopen validation", () => {
    it("Cannot reopen invoiced job", async () => {
      const job = await jobRepository.getJob(testCompanyId, testJobId);
      const invoicedJob = { ...job!, status: "invoiced" };

      const actor: TransitionActor = { userId: testUserId, role: "dispatcher" };
      const intent: LifecycleIntent = { type: "REOPEN_JOB", targetStatus: "in_progress" };

      expect(() => {
        applyLifecycleTransition(invoicedJob as any, intent, actor);
      }).toThrow(LifecycleTransitionError);

      try {
        applyLifecycleTransition(invoicedJob as any, intent, actor);
      } catch (error) {
        const lifecycleError = error as LifecycleTransitionError;
        expect(lifecycleError.code).toBe("INVOICED_JOB");
      }
    });

    it("Can reopen archived job", async () => {
      const job = await jobRepository.getJob(testCompanyId, testJobId);
      const archivedJob = { ...job!, status: "archived" };

      const actor: TransitionActor = { userId: testUserId, role: "dispatcher" };
      const intent: LifecycleIntent = { type: "REOPEN_JOB", targetStatus: "in_progress" };

      const result = applyLifecycleTransition(archivedJob as any, intent, actor);

      expect(result.finalStatus).toBe("in_progress");
      expect(result.auditEvents[0].action).toBe("reopen");
    });

    it("Reopen clears close metadata", async () => {
      const job = await jobRepository.getJob(testCompanyId, testJobId);
      const archivedJob = {
        ...job!,
        status: "archived",
        closedAt: new Date(),
        closedBy: testUserId,
        previousStatus: "in_progress",
      };

      const actor: TransitionActor = { userId: testUserId, role: "dispatcher" };
      const intent: LifecycleIntent = { type: "REOPEN_JOB", targetStatus: "in_progress" };

      const result = applyLifecycleTransition(archivedJob as any, intent, actor);

      expect(result.patch.closedAt).toBeNull();
      expect(result.patch.closedBy).toBeNull();
      expect(result.patch.previousStatus).toBeNull();
    });
  });

  // ============================================================================
  // Test 7: Version mismatch error structure
  // ============================================================================
  describe("Version mismatch handling", () => {
    it("transitionJobStatus throws on version mismatch", async () => {
      const jobId = await createScheduledJob();
      const job = await jobRepository.getJob(testCompanyId, jobId);

      const actor: TransitionActor = { userId: testUserId, role: "dispatcher" };
      const intent: LifecycleIntent = { type: "CLOSE_JOB", mode: "archive" };

      // Pass wrong version
      const wrongVersion = (job?.version ?? 0) + 10;

      try {
        await jobRepository.transitionJobStatus(
          testCompanyId,
          jobId,
          wrongVersion,
          intent,
          actor
        );
        expect.fail("Should have thrown VERSION_MISMATCH error");
      } catch (error: any) {
        expect(error.code).toBe("VERSION_MISMATCH");
        expect(error.statusCode).toBe(409);
      }

      // Clean up
      await db.delete(jobs).where(eq(jobs.id, jobId));
    });

    it("transitionJobStatus succeeds with correct version", async () => {
      const jobId = await createScheduledJob();
      const job = await jobRepository.getJob(testCompanyId, jobId);

      const actor: TransitionActor = { userId: testUserId, role: "dispatcher" };
      const intent: LifecycleIntent = { type: "CLOSE_JOB", mode: "archive" };

      const updated = await jobRepository.transitionJobStatus(
        testCompanyId,
        jobId,
        job!.version,
        intent,
        actor
      );

      expect(updated.status).toBe("archived");
      expect(updated.version).toBe((job!.version ?? 0) + 1);
      expect(updated.scheduledStart).toBeNull();
      expect(updated.scheduledEnd).toBeNull();

      // Clean up
      await db.delete(jobStatusEvents).where(eq(jobStatusEvents.jobId, jobId));
      await db.delete(jobs).where(eq(jobs.id, jobId));
    });
  });
});
