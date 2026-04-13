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
    // 2026-04-12 (Option A): crew forwarded to seed visit.
    assignedTechnicianIds: [testUserId],
    scheduledStart,
    scheduledEnd,
    isAllDay: false,
  } as any);

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

    // 2026-03-18: Harmonization test — invoice_now must set terminal metadata
    it("invoice_now sets previousStatus, closedAt, closedBy (harmonized with MARK_INVOICED)", async () => {
      const job = await jobRepository.getJob(testCompanyId, testJobId);

      const actor: TransitionActor = { userId: testUserId, role: "dispatcher" };
      const invoiceId = uuidv4();
      const intent: LifecycleIntent = { type: "CLOSE_JOB", mode: "invoice_now", invoiceId };

      const result = applyLifecycleTransition(job!, intent, actor);

      // Terminal metadata — must match MARK_INVOICED semantics
      expect(result.patch.previousStatus).toBeDefined();
      expect(result.patch.closedAt).toBeInstanceOf(Date);
      expect(result.patch.closedBy).toBe(actor.userId);
      // Schedule and hold clearing
      expect(result.patch.scheduledStart).toBeNull();
      expect(result.patch.scheduledEnd).toBeNull();
      expect(result.patch.openSubStatus).toBeNull();
      // Audit event
      expect(result.auditEvents).toHaveLength(1);
      expect(result.auditEvents[0].action).toBe("close_and_invoice");
      expect(result.auditEvents[0].meta?.invoiceId).toBe(invoiceId);
    });

    it("invoice_now and MARK_INVOICED produce consistent terminal metadata", () => {
      const baseJob = {
        id: "j-compare", status: "open", openSubStatus: "in_progress",
        scheduledStart: new Date(), scheduledEnd: new Date(), isAllDay: true,
        invoiceId: null, closedAt: null, closedBy: null, previousStatus: null,
        holdReason: null, holdNotes: null, nextActionDate: null, onHoldAt: null,
        pmBillingDisposition: "invoice_on_completion",
      } as any;

      const actor: TransitionActor = { userId: "test-user", role: "dispatcher" };
      const invoiceId = "inv-compare-test";

      const closeResult = applyLifecycleTransition(
        { ...baseJob },
        { type: "CLOSE_JOB", mode: "invoice_now", invoiceId },
        actor
      );
      const markResult = applyLifecycleTransition(
        { ...baseJob },
        { type: "MARK_INVOICED", invoiceId },
        actor
      );

      // Both must reach invoiced with identical terminal metadata fields
      expect(closeResult.finalStatus).toBe("invoiced");
      expect(markResult.finalStatus).toBe("invoiced");

      // Terminal metadata consistency
      expect(closeResult.patch.status).toBe(markResult.patch.status);
      expect(closeResult.patch.previousStatus).toBe(markResult.patch.previousStatus);
      expect(closeResult.patch.closedBy).toBe(markResult.patch.closedBy);
      expect(closeResult.patch.closedAt).toBeInstanceOf(Date);
      expect(markResult.patch.closedAt).toBeInstanceOf(Date);

      // Invoice link
      expect(closeResult.patch.invoiceId).toBe(markResult.patch.invoiceId);

      // Schedule/hold clearing
      expect(closeResult.patch.scheduledStart).toBeNull();
      expect(markResult.patch.scheduledStart).toBeNull();
      expect(closeResult.patch.openSubStatus).toBeNull();
      expect(markResult.patch.openSubStatus).toBeNull();

      // PM billing
      expect(closeResult.patch.pmBillingStatus).toBe("invoiced");
      expect(markResult.patch.pmBillingStatus).toBe("invoiced");

      // Audit actions remain intentionally different
      expect(closeResult.auditEvents[0].action).toBe("close_and_invoice");
      expect(markResult.auditEvents[0].action).toBe("mark_invoiced");
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

  // ============================================================================
  // Test 8: MARK_INVOICED lifecycle transition
  // ============================================================================
  describe("MARK_INVOICED transition", () => {
    const actor: TransitionActor = { userId: "test-user", role: "dispatcher" };
    const invoiceId = "inv-test-123";

    it("transitions open job to invoiced", () => {
      const job = {
        id: "j1", status: "open", openSubStatus: null,
        scheduledStart: new Date(), scheduledEnd: new Date(), isAllDay: false,
        invoiceId: null, closedAt: null, closedBy: null, previousStatus: null,
        holdReason: null, holdNotes: null, nextActionDate: null, onHoldAt: null,
        pmBillingDisposition: null,
      } as any;

      const intent: LifecycleIntent = { type: "MARK_INVOICED", invoiceId };
      const result = applyLifecycleTransition(job, intent, actor);

      expect(result.finalStatus).toBe("invoiced");
      expect(result.patch.status).toBe("invoiced");
      expect(result.patch.invoiceId).toBe(invoiceId);
      expect(result.patch.previousStatus).toBe("open");
      expect(result.patch.closedAt).toBeDefined();
      expect(result.patch.closedBy).toBe(actor.userId);
      // Schedule clearing
      expect(result.patch.scheduledStart).toBeNull();
      expect(result.patch.scheduledEnd).toBeNull();
      // Hold clearing
      expect(result.patch.openSubStatus).toBeNull();
      expect(result.patch.holdReason).toBeNull();
      // Audit event
      expect(result.auditEvents).toHaveLength(1);
      expect(result.auditEvents[0].fromStatus).toBe("open");
      expect(result.auditEvents[0].toStatus).toBe("invoiced");
      expect(result.auditEvents[0].action).toBe("mark_invoiced");
    });

    it("transitions completed job to invoiced", () => {
      const job = {
        id: "j2", status: "completed", openSubStatus: null,
        scheduledStart: null, scheduledEnd: null, isAllDay: false,
        invoiceId: null, closedAt: new Date(), closedBy: "someone", previousStatus: "open",
        holdReason: null, holdNotes: null, nextActionDate: null, onHoldAt: null,
        pmBillingDisposition: null,
      } as any;

      const intent: LifecycleIntent = { type: "MARK_INVOICED", invoiceId };
      const result = applyLifecycleTransition(job, intent, actor);

      expect(result.finalStatus).toBe("invoiced");
      expect(result.patch.status).toBe("invoiced");
      expect(result.patch.previousStatus).toBe("completed");
    });

    it("idempotent for already-invoiced job", () => {
      const job = {
        id: "j3", status: "invoiced", openSubStatus: null,
        scheduledStart: null, scheduledEnd: null, isAllDay: false,
        invoiceId: "existing-inv", closedAt: new Date(), closedBy: "someone",
        previousStatus: "open",
        holdReason: null, holdNotes: null, nextActionDate: null, onHoldAt: null,
        pmBillingDisposition: null,
      } as any;

      const intent: LifecycleIntent = { type: "MARK_INVOICED", invoiceId };
      const result = applyLifecycleTransition(job, intent, actor);

      expect(result.finalStatus).toBe("invoiced");
      expect(result.patch).toEqual({}); // No-op
      expect(result.auditEvents).toHaveLength(0);
    });

    it("rejects archived job", () => {
      const job = {
        id: "j4", status: "archived", openSubStatus: null,
        scheduledStart: null, scheduledEnd: null, isAllDay: false,
        invoiceId: null, closedAt: new Date(), closedBy: "someone",
        previousStatus: "open",
        holdReason: null, holdNotes: null, nextActionDate: null, onHoldAt: null,
        pmBillingDisposition: null,
      } as any;

      const intent: LifecycleIntent = { type: "MARK_INVOICED", invoiceId };

      expect(() => applyLifecycleTransition(job, intent, actor)).toThrow(LifecycleTransitionError);
      try {
        applyLifecycleTransition(job, intent, actor);
      } catch (error: any) {
        expect(error.code).toBe("INVALID_STATE");
      }
    });

    it("RBAC: technician cannot mark invoiced", () => {
      const job = {
        id: "j5", status: "open", openSubStatus: null,
        scheduledStart: null, scheduledEnd: null, isAllDay: false,
        invoiceId: null, closedAt: null, closedBy: null, previousStatus: null,
        holdReason: null, holdNotes: null, nextActionDate: null, onHoldAt: null,
        pmBillingDisposition: null,
      } as any;

      const techActor: TransitionActor = { userId: "tech", role: "technician" };
      const intent: LifecycleIntent = { type: "MARK_INVOICED", invoiceId };

      expect(() => applyLifecycleTransition(job, intent, techActor)).toThrow(LifecycleTransitionError);
      try {
        applyLifecycleTransition(job, intent, techActor);
      } catch (error: any) {
        expect(error.code).toBe("FORBIDDEN");
      }
    });

    it("sets pmBillingStatus for PM jobs", () => {
      const job = {
        id: "j6", status: "completed", openSubStatus: null,
        scheduledStart: null, scheduledEnd: null, isAllDay: false,
        invoiceId: null, closedAt: new Date(), closedBy: "someone",
        previousStatus: "open", pmBillingDisposition: "invoice_on_completion",
        holdReason: null, holdNotes: null, nextActionDate: null, onHoldAt: null,
      } as any;

      const intent: LifecycleIntent = { type: "MARK_INVOICED", invoiceId };
      const result = applyLifecycleTransition(job, intent, actor);

      expect(result.patch.pmBillingStatus).toBe("invoiced");
    });

    it("domain transition produces correct patch with all fields", () => {
      // Full patch validation — verifies every field the transition sets
      const job = {
        id: "j-full", status: "open", openSubStatus: "on_hold",
        scheduledStart: new Date(), scheduledEnd: new Date(), isAllDay: true,
        invoiceId: null, closedAt: null, closedBy: null, previousStatus: null,
        holdReason: "parts", holdNotes: "waiting on compressor",
        nextActionDate: "2026-04-01", onHoldAt: new Date(),
        pmBillingDisposition: null,
      } as any;

      const intent: LifecycleIntent = { type: "MARK_INVOICED", invoiceId: "inv-full-test" };
      const result = applyLifecycleTransition(job, intent, actor);

      // Status
      expect(result.finalStatus).toBe("invoiced");
      expect(result.patch.status).toBe("invoiced");
      // Invoice link
      expect(result.patch.invoiceId).toBe("inv-full-test");
      // Close metadata
      expect(result.patch.previousStatus).toBe("open");
      expect(result.patch.closedAt).toBeInstanceOf(Date);
      expect(result.patch.closedBy).toBe(actor.userId);
      // Schedule clearing
      expect(result.patch.scheduledStart).toBeNull();
      expect(result.patch.scheduledEnd).toBeNull();
      expect(result.patch.isAllDay).toBe(false);
      // Hold clearing
      expect(result.patch.openSubStatus).toBeNull();
      expect(result.patch.holdReason).toBeNull();
      expect(result.patch.holdNotes).toBeNull();
      expect(result.patch.nextActionDate).toBeNull();
      expect(result.patch.onHoldAt).toBeNull();
      // Audit
      expect(result.auditEvents).toHaveLength(1);
      expect(result.auditEvents[0].action).toBe("mark_invoiced");
      expect(result.auditEvents[0].meta).toEqual({ invoiceId: "inv-full-test" });
    });
  });

  // ============================================================================
  // Test 9: BP-1 fix — CLOSE_JOB(invoice_later) produces canonical terminal state
  // for reconciliation auto-close
  // ============================================================================
  describe("BP-1: CLOSE_JOB(invoice_later) canonical terminal state", () => {
    const actor: TransitionActor = { userId: "completing-tech-123", role: "system" };

    it("produces full terminal metadata from open job", () => {
      const job = {
        id: "bp1-1", status: "open", openSubStatus: "in_progress",
        scheduledStart: new Date(), scheduledEnd: new Date(), isAllDay: true,
        invoiceId: null, closedAt: null, closedBy: null, previousStatus: null,
        holdReason: "parts", holdNotes: "waiting", nextActionDate: "2026-04-01",
        onHoldAt: new Date(), pmBillingDisposition: null,
      } as any;

      const intent: LifecycleIntent = { type: "CLOSE_JOB", mode: "invoice_later" };
      const result = applyLifecycleTransition(job, intent, actor);

      // Status
      expect(result.finalStatus).toBe("completed");
      expect(result.patch.status).toBe("completed");
      // Terminal metadata — these were MISSING in the old bypass
      expect(result.patch.previousStatus).toBe("open");
      expect(result.patch.closedAt).toBeInstanceOf(Date);
      expect(result.patch.closedBy).toBe("completing-tech-123");
      // Schedule clearing
      expect(result.patch.scheduledStart).toBeNull();
      expect(result.patch.scheduledEnd).toBeNull();
      expect(result.patch.isAllDay).toBe(false);
      // Hold clearing
      expect(result.patch.openSubStatus).toBeNull();
      expect(result.patch.holdReason).toBeNull();
      expect(result.patch.holdNotes).toBeNull();
      expect(result.patch.nextActionDate).toBeNull();
      expect(result.patch.onHoldAt).toBeNull();
      // Audit event
      expect(result.auditEvents).toHaveLength(1);
      expect(result.auditEvents[0].action).toBe("close");
      expect(result.auditEvents[0].fromStatus).toBe("open");
      expect(result.auditEvents[0].toStatus).toBe("completed");
      expect(result.auditEvents[0].meta).toEqual({ mode: "invoice_later" });
    });

    it("handles PM job pmBillingStatus (no billing disposition)", () => {
      const job = {
        id: "bp1-2", status: "open", openSubStatus: null,
        scheduledStart: null, scheduledEnd: null, isAllDay: false,
        invoiceId: null, closedAt: null, closedBy: null, previousStatus: null,
        holdReason: null, holdNotes: null, nextActionDate: null, onHoldAt: null,
        pmBillingDisposition: null,
      } as any;

      const intent: LifecycleIntent = { type: "CLOSE_JOB", mode: "invoice_later" };
      const result = applyLifecycleTransition(job, intent, actor);

      // No pmBillingDisposition → no pmBillingStatus in patch
      expect(result.patch.pmBillingStatus).toBeUndefined();
    });

    it("system role is accepted by RBAC", () => {
      const job = {
        id: "bp1-3", status: "open", openSubStatus: null,
        scheduledStart: null, scheduledEnd: null, isAllDay: false,
        invoiceId: null, closedAt: null, closedBy: null, previousStatus: null,
        holdReason: null, holdNotes: null, nextActionDate: null, onHoldAt: null,
        pmBillingDisposition: null,
      } as any;

      const systemActor: TransitionActor = { userId: "tech-user", role: "system" };
      const intent: LifecycleIntent = { type: "CLOSE_JOB", mode: "invoice_later" };

      // Should NOT throw FORBIDDEN
      const result = applyLifecycleTransition(job, intent, systemActor);
      expect(result.finalStatus).toBe("completed");
    });

    it("rejects close on already-terminal job", () => {
      const job = {
        id: "bp1-4", status: "completed", openSubStatus: null,
        scheduledStart: null, scheduledEnd: null, isAllDay: false,
        invoiceId: null, closedAt: new Date(), closedBy: "someone",
        previousStatus: "open",
        holdReason: null, holdNotes: null, nextActionDate: null, onHoldAt: null,
        pmBillingDisposition: null,
      } as any;

      const intent: LifecycleIntent = { type: "CLOSE_JOB", mode: "invoice_later" };

      expect(() => applyLifecycleTransition(job, intent, actor)).toThrow(LifecycleTransitionError);
      try {
        applyLifecycleTransition(job, intent, actor);
      } catch (error: any) {
        expect(error.code).toBe("INVALID_STATE");
      }
    });

    it("undo-close prerequisites exist after canonical close", () => {
      const job = {
        id: "bp1-5", status: "open", openSubStatus: null,
        scheduledStart: new Date(), scheduledEnd: new Date(), isAllDay: false,
        invoiceId: null, closedAt: null, closedBy: null, previousStatus: null,
        holdReason: null, holdNotes: null, nextActionDate: null, onHoldAt: null,
        pmBillingDisposition: null,
      } as any;

      const intent: LifecycleIntent = { type: "CLOSE_JOB", mode: "invoice_later" };
      const result = applyLifecycleTransition(job, intent, actor);

      // These are the undo-close prerequisites that were missing in the old bypass
      expect(result.patch.closedAt).toBeInstanceOf(Date);
      expect(result.patch.previousStatus).toBe("open");
      // closedBy is set so audit trail knows who closed it
      expect(result.patch.closedBy).toBe(actor.userId);
    });
  });
});
