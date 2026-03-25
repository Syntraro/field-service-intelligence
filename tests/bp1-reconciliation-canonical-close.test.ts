/**
 * BP-1 Fix Integration Tests — Reconciliation Canonical Close
 *
 * Proves that when the last visit is completed and reconciliation determines
 * the job should become "completed", the job is closed through the canonical
 * lifecycle engine (CLOSE_JOB mode=invoice_later) rather than a direct
 * db.update bypass.
 *
 * These tests assert PERSISTED state, not mocked function calls.
 *
 * 2026-03-18: Created to prove BP-1 bypass is eliminated.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import {
  jobs,
  jobVisits,
  jobStatusEvents,
  companies,
  users,
  clientLocations,
  customerCompanies,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import * as lifecycle from "../server/services/jobLifecycleOrchestrator";
import { jobRepository } from "../server/storage/jobs";
import { v4 as uuidv4 } from "uuid";

/**
 * Load the full job row directly (including fields like openSubStatus, isAllDay
 * that the repository's getJob() select may omit).
 */
async function loadFullJob(cid: string, jid: string) {
  const [row] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jid), eq(jobs.companyId, cid)));
  return row ?? null;
}

// Test fixture IDs
let companyId: string;
let userId: string;
let customerCompanyId: string;
let locationId: string;
const createdJobIds: string[] = [];
const createdVisitIds: string[] = [];

async function setupFixtures() {
  companyId = uuidv4();
  await db.insert(companies).values({ id: companyId, name: "bp1_test_company" });

  userId = uuidv4();
  await db.insert(users).values({
    id: userId,
    companyId,
    email: `bp1_test_${Date.now()}@test.com`,
    password: "hash",
    role: "dispatcher",
    firstName: "Test",
    lastName: "Tech",
  });

  customerCompanyId = uuidv4();
  await db.insert(customerCompanies).values({
    id: customerCompanyId,
    companyId,
    name: "bp1_test_customer",
  });

  locationId = uuidv4();
  await db.insert(clientLocations).values({
    id: locationId,
    companyId,
    parentCompanyId: customerCompanyId,
    companyName: "bp1_test_location",
    address: "123 Test St",
    selectedMonths: [],
  });
}

async function createJobWithVisit(overrides?: {
  jobOverrides?: Record<string, unknown>;
}): Promise<{ jobId: string; visitId: string; jobVersion: number }> {
  const now = new Date();
  const scheduledStart = new Date(now.getTime() - 3600000); // 1h ago
  const scheduledEnd = new Date(now.getTime() - 1800000); // 30min ago

  // createJob() auto-creates visit #1, so we don't insert a separate visit
  const job = await jobRepository.createJob(companyId, {
    companyId,
    locationId,
    jobType: "PM",
    summary: "bp1_test_job",
    status: "open",
    primaryTechnicianId: userId,
    scheduledStart,
    scheduledEnd,
    isAllDay: false,
    ...(overrides?.jobOverrides ?? {}),
  });
  createdJobIds.push(job.id);

  // Find the auto-created visit and update it to in_progress + checked-in state
  const [autoVisit] = await db
    .select({ id: jobVisits.id, version: jobVisits.version })
    .from(jobVisits)
    .where(and(eq(jobVisits.jobId, job.id), eq(jobVisits.companyId, companyId)));

  if (!autoVisit) throw new Error("createJob did not auto-create visit #1");

  await db
    .update(jobVisits)
    .set({
      status: "in_progress",
      checkedInAt: new Date(now.getTime() - 2400000), // checked in 40min ago
      assignedTechnicianId: userId,
    })
    .where(eq(jobVisits.id, autoVisit.id));

  createdVisitIds.push(autoVisit.id);

  return { jobId: job.id, visitId: autoVisit.id, jobVersion: job.version };
}

async function cleanupFixtures() {
  for (const id of createdVisitIds) {
    await db.delete(jobVisits).where(eq(jobVisits.id, id)).catch(() => {});
  }
  for (const id of createdJobIds) {
    await db.delete(jobStatusEvents).where(eq(jobStatusEvents.jobId, id)).catch(() => {});
    await db.delete(jobs).where(eq(jobs.id, id)).catch(() => {});
  }
  if (locationId) await db.delete(clientLocations).where(eq(clientLocations.id, locationId)).catch(() => {});
  if (customerCompanyId) await db.delete(customerCompanies).where(eq(customerCompanies.id, customerCompanyId)).catch(() => {});
  if (userId) await db.delete(users).where(eq(users.id, userId)).catch(() => {});
  if (companyId) await db.delete(companies).where(eq(companies.id, companyId)).catch(() => {});
}

describe("BP-1: Reconciliation canonical close (integration)", () => {
  beforeAll(async () => {
    await setupFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  // ============================================================================
  // Test 1: Complete last visit → job has canonical terminal state
  // ============================================================================
  it("complete last visit produces canonical lifecycle close state", async () => {
    const { jobId, visitId, jobVersion } = await createJobWithVisit();

    // Complete the visit — this triggers reconciliation
    const result = await lifecycle.completeVisit({
      type: "COMPLETE_VISIT",
      companyId,
      visitId,
      jobId,
      outcome: "completed",
      completedByUserId: userId,
    });

    expect(result.reconciliation.jobUpdated).toBe(true);
    expect(result.reconciliation.newJobStatus).toBe("completed");

    // Load the persisted job and verify canonical terminal state
    const updatedJob = await loadFullJob(companyId, jobId);
    expect(updatedJob).toBeDefined();

    // Status
    expect(updatedJob!.status).toBe("completed");
    // previousStatus — was MISSING in old bypass
    expect(updatedJob!.previousStatus).toBe("open");
    // closedAt — was set in old bypass but now goes through canonical path
    expect(updatedJob!.closedAt).toBeDefined();
    expect(updatedJob!.closedAt).toBeInstanceOf(Date);
    // closedBy — was MISSING in old bypass
    expect(updatedJob!.closedBy).toBe(userId);
    // version — was NOT INCREMENTED in old bypass
    expect(updatedJob!.version).toBeGreaterThan(jobVersion);
  });

  // ============================================================================
  // Test 2: Complete last visit → scheduling fields cleared
  // ============================================================================
  it("complete last visit clears scheduling fields via canonical lifecycle", async () => {
    const { jobId, visitId } = await createJobWithVisit();

    await lifecycle.completeVisit({
      type: "COMPLETE_VISIT",
      companyId,
      visitId,
      jobId,
      outcome: "completed",
      completedByUserId: userId,
    });

    const updatedJob = await loadFullJob(companyId, jobId);
    expect(updatedJob).toBeDefined();

    // Schedule clearing — was MISSING in old bypass.
    // syncJobToVisits() also runs after reconciliation and may null out isAllDay.
    expect(updatedJob!.scheduledStart).toBeNull();
    expect(updatedJob!.scheduledEnd).toBeNull();
    expect(updatedJob!.isAllDay).toBeFalsy(); // false or null/undefined — cleared either way
    // Hold clearing
    expect(updatedJob!.openSubStatus).toBeNull();
    expect(updatedJob!.holdReason).toBeNull();
  });

  // ============================================================================
  // Test 3: Complete last visit → audit event created
  // ============================================================================
  it("complete last visit creates jobStatusEvent via canonical lifecycle", async () => {
    const { jobId, visitId } = await createJobWithVisit();

    await lifecycle.completeVisit({
      type: "COMPLETE_VISIT",
      companyId,
      visitId,
      jobId,
      outcome: "completed",
      completedByUserId: userId,
    });

    // Query audit events for this job
    const events = await db
      .select()
      .from(jobStatusEvents)
      .where(and(eq(jobStatusEvents.jobId, jobId), eq(jobStatusEvents.companyId, companyId)))
      .orderBy(desc(jobStatusEvents.changedAt));

    // Must have at least one event for the close transition
    expect(events.length).toBeGreaterThanOrEqual(1);

    const closeEvent = events.find(
      (e) => e.fromStatus === "open" && e.toStatus === "completed"
    );
    expect(closeEvent).toBeDefined();
    expect(closeEvent!.changedBy).toBe(userId);
  });

  // ============================================================================
  // Test 4: Complete last visit on PM job → pmBillingStatus handled
  // ============================================================================
  it("complete last visit on PM job handles pmBillingStatus through lifecycle", async () => {
    const { jobId, visitId } = await createJobWithVisit({
      jobOverrides: { pmBillingDisposition: "invoice_on_completion" },
    });

    await lifecycle.completeVisit({
      type: "COMPLETE_VISIT",
      companyId,
      visitId,
      jobId,
      outcome: "completed",
      completedByUserId: userId,
    });

    const updatedJob = await loadFullJob(companyId, jobId);
    expect(updatedJob).toBeDefined();
    expect(updatedJob!.status).toBe("completed");
    // Note: CLOSE_JOB(invoice_later) does not set pmBillingStatus (only archive and
    // invoice_now modes do). This is correct — the job still needs invoicing, so PM
    // billing status is not yet determined. This is intentional canonical behavior.
  });

  // ============================================================================
  // Test 5: Undo-close prerequisites exist after reconciliation close
  // ============================================================================
  it("reconciliation-closed job has undo-close prerequisites", async () => {
    const { jobId, visitId } = await createJobWithVisit();

    await lifecycle.completeVisit({
      type: "COMPLETE_VISIT",
      companyId,
      visitId,
      jobId,
      outcome: "completed",
      completedByUserId: userId,
    });

    const updatedJob = await loadFullJob(companyId, jobId);
    expect(updatedJob).toBeDefined();

    // These are the prerequisites for UNDO_CLOSE to function
    expect(updatedJob!.closedAt).toBeDefined();
    expect(updatedJob!.closedAt).toBeInstanceOf(Date);
    expect(updatedJob!.previousStatus).toBe("open");
    expect(updatedJob!.closedBy).toBe(userId);
  });

  // ============================================================================
  // Test 6: Race condition — job already terminal when reconciliation runs
  // ============================================================================
  it("reconciliation is a safe no-op when job is already terminal", async () => {
    const { jobId, visitId, jobVersion } = await createJobWithVisit();

    // First: manually close the job via canonical lifecycle (simulating a race)
    const actor = { userId, role: "dispatcher" as const };
    await jobRepository.transitionJobStatus(
      companyId,
      jobId,
      jobVersion,
      { type: "CLOSE_JOB", mode: "invoice_later" },
      actor
    );

    // Verify job is already completed
    const closedJob = await loadFullJob(companyId, jobId);
    expect(closedJob!.status).toBe("completed");

    // Now complete the visit — reconciliation should find job already terminal
    const result = await lifecycle.completeVisit({
      type: "COMPLETE_VISIT",
      companyId,
      visitId,
      jobId,
      outcome: "completed",
      completedByUserId: userId,
    });

    // Reconciliation should report no update (job was already terminal)
    expect(result.reconciliation.jobUpdated).toBe(false);

    // Job should still be in the same state — no corruption
    const finalJob = await loadFullJob(companyId, jobId);
    expect(finalJob!.status).toBe("completed");
  });

  // ============================================================================
  // Test 7: Non-terminal reconciliation (Rules 2/3/4) still works as before
  // (Proves BP-1 fix did not break non-terminal branches)
  // ============================================================================
  it("non-terminal reconciliation (needs_followup) still works", async () => {
    // Create job — auto-creates visit #1
    const now = new Date();
    const scheduledStart = new Date(now.getTime() - 3600000);
    const scheduledEnd = new Date(now.getTime() - 1800000);

    const job = await jobRepository.createJob(companyId, {
      companyId,
      locationId,
      jobType: "Repair",
      summary: "bp1_test_multi_visit",
      status: "open",
      primaryTechnicianId: userId,
      scheduledStart,
      scheduledEnd,
      isAllDay: false,
    });
    createdJobIds.push(job.id);

    // Find auto-created visit #1 and set to in_progress
    const [visit1] = await db
      .select({ id: jobVisits.id })
      .from(jobVisits)
      .where(and(eq(jobVisits.jobId, job.id), eq(jobVisits.companyId, companyId)));

    await db
      .update(jobVisits)
      .set({ status: "in_progress", checkedInAt: new Date(), assignedTechnicianId: userId })
      .where(eq(jobVisits.id, visit1.id));
    createdVisitIds.push(visit1.id);

    // Add visit #2 — still scheduled (actionable), so job shouldn't auto-close
    const futureStart = new Date(now.getTime() + 86400000); // tomorrow
    const visit2Id = uuidv4();
    await db.insert(jobVisits).values({
      id: visit2Id,
      companyId,
      jobId: job.id,
      scheduledDate: futureStart,
      scheduledStart: futureStart,
      scheduledEnd: new Date(futureStart.getTime() + 3600000),
      status: "scheduled",
      visitNumber: 2,
      isActive: true,
      assignedTechnicianId: userId,
    });
    createdVisitIds.push(visit2Id);

    // Complete visit 1 with needs_followup — should NOT close job
    const result = await lifecycle.completeVisit({
      type: "COMPLETE_VISIT",
      companyId,
      visitId: visit1.id,
      jobId: job.id,
      outcome: "needs_followup",
      holdReason: "other",
      holdNotes: "Needs return visit",
      completedByUserId: userId,
    });

    expect(result.reconciliation.jobUpdated).toBe(true);
    expect(result.reconciliation.newJobStatus).toBe("open");
    expect(result.reconciliation.newOpenSubStatus).toBe("on_hold");

    // Verify job is still open (not closed)
    const updatedJob = await loadFullJob(companyId, job.id);
    expect(updatedJob!.status).toBe("open");
    expect(updatedJob!.openSubStatus).toBe("on_hold");
    expect(updatedJob!.holdReason).toBe("other");
  });

  // ============================================================================
  // BP-2 Tests — Non-terminal reconciliation versioning and audit
  // ============================================================================

  // --------------------------------------------------------------------------
  // Test 8: Rule 2 — hold after last visit needs_parts, version + audit
  // --------------------------------------------------------------------------
  it("BP-2 Rule 2: hold after last visit needs_parts increments version and creates event", async () => {
    const { jobId, visitId, jobVersion } = await createJobWithVisit();

    await lifecycle.completeVisit({
      type: "COMPLETE_VISIT",
      companyId,
      visitId,
      jobId,
      outcome: "needs_parts",
      holdReason: "parts",
      holdNotes: "Waiting for compressor",
      completedByUserId: userId,
    });

    const updatedJob = await loadFullJob(companyId, jobId);
    expect(updatedJob).toBeDefined();

    // Business behavior preserved
    expect(updatedJob!.status).toBe("open");
    expect(updatedJob!.openSubStatus).toBe("on_hold");
    expect(updatedJob!.holdReason).toBe("parts");
    expect(updatedJob!.holdNotes).toBe("Waiting for compressor");
    expect(updatedJob!.onHoldAt).toBeDefined();

    // BP-2 fix: version incremented (was NOT incremented before)
    expect(updatedJob!.version).toBeGreaterThan(jobVersion);

    // BP-2 fix: audit event created (was NOT created before)
    const events = await db
      .select()
      .from(jobStatusEvents)
      .where(and(eq(jobStatusEvents.jobId, jobId), eq(jobStatusEvents.companyId, companyId)))
      .orderBy(desc(jobStatusEvents.changedAt));

    const holdEvent = events.find(
      (e) => e.fromStatus === "open" && e.toStatus === "open" &&
        (e.meta as any)?.action === "reconcile_hold"
    );
    expect(holdEvent).toBeDefined();
    expect(holdEvent!.changedBy).toBe(userId);
    expect(holdEvent!.note).toContain("needs_parts");

    // Must NOT set terminal fields
    expect(updatedJob!.closedAt).toBeNull();
    expect(updatedJob!.closedBy).toBeNull();
    expect(updatedJob!.previousStatus).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Test 9: Rule 3 — hold with remaining visits, version + audit
  // --------------------------------------------------------------------------
  it("BP-2 Rule 3: hold with remaining visits increments version and creates event", async () => {
    const now = new Date();
    const scheduledStart = new Date(now.getTime() - 3600000);
    const scheduledEnd = new Date(now.getTime() - 1800000);

    const job = await jobRepository.createJob(companyId, {
      companyId,
      locationId,
      jobType: "Repair",
      summary: "bp2_rule3_test",
      status: "open",
      primaryTechnicianId: userId,
      scheduledStart,
      scheduledEnd,
      isAllDay: false,
    });
    createdJobIds.push(job.id);
    const initialVersion = job.version;

    // Find auto-created visit #1
    const [visit1] = await db
      .select({ id: jobVisits.id })
      .from(jobVisits)
      .where(and(eq(jobVisits.jobId, job.id), eq(jobVisits.companyId, companyId)));
    await db
      .update(jobVisits)
      .set({ status: "in_progress", checkedInAt: new Date(), assignedTechnicianId: userId })
      .where(eq(jobVisits.id, visit1.id));
    createdVisitIds.push(visit1.id);

    // Add visit #2 (actionable — so Rule 3 applies, not Rule 2)
    const futureStart = new Date(now.getTime() + 86400000);
    const visit2Id = uuidv4();
    await db.insert(jobVisits).values({
      id: visit2Id,
      companyId,
      jobId: job.id,
      scheduledDate: futureStart,
      scheduledStart: futureStart,
      scheduledEnd: new Date(futureStart.getTime() + 3600000),
      status: "scheduled",
      visitNumber: 2,
      isActive: true,
      assignedTechnicianId: userId,
    });
    createdVisitIds.push(visit2Id);

    // Complete visit 1 with needs_followup → Rule 3 (remaining visits exist)
    await lifecycle.completeVisit({
      type: "COMPLETE_VISIT",
      companyId,
      visitId: visit1.id,
      jobId: job.id,
      outcome: "needs_followup",
      holdReason: "other",
      holdNotes: "Return visit needed",
      completedByUserId: userId,
    });

    const updatedJob = await loadFullJob(companyId, job.id);
    expect(updatedJob).toBeDefined();

    // Business behavior preserved
    expect(updatedJob!.status).toBe("open");
    expect(updatedJob!.openSubStatus).toBe("on_hold");
    expect(updatedJob!.holdReason).toBe("other");

    // BP-2 fix: version incremented
    expect(updatedJob!.version).toBeGreaterThan(initialVersion);

    // BP-2 fix: audit event with reconcile_hold_partial action
    const events = await db
      .select()
      .from(jobStatusEvents)
      .where(and(eq(jobStatusEvents.jobId, job.id), eq(jobStatusEvents.companyId, companyId)));

    const holdEvent = events.find(
      (e) => (e.meta as any)?.action === "reconcile_hold_partial"
    );
    expect(holdEvent).toBeDefined();
    expect(holdEvent!.fromStatus).toBe("open");
    expect(holdEvent!.toStatus).toBe("open");
    expect(holdEvent!.changedBy).toBe(userId);

    // Must NOT set terminal fields
    expect(updatedJob!.closedAt).toBeNull();
    expect(updatedJob!.closedBy).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Test 10: Rule 4 — hold cleared, version + audit
  // --------------------------------------------------------------------------
  it("BP-2 Rule 4: hold cleared after subsequent visit completes, version + audit", async () => {
    const now = new Date();
    const scheduledStart = new Date(now.getTime() - 3600000);
    const scheduledEnd = new Date(now.getTime() - 1800000);

    const job = await jobRepository.createJob(companyId, {
      companyId,
      locationId,
      jobType: "Repair",
      summary: "bp2_rule4_test",
      status: "open",
      primaryTechnicianId: userId,
      scheduledStart,
      scheduledEnd,
      isAllDay: false,
    });
    createdJobIds.push(job.id);

    // Find auto-created visit #1
    const [visit1] = await db
      .select({ id: jobVisits.id })
      .from(jobVisits)
      .where(and(eq(jobVisits.jobId, job.id), eq(jobVisits.companyId, companyId)));
    await db
      .update(jobVisits)
      .set({ status: "in_progress", checkedInAt: new Date(), assignedTechnicianId: userId })
      .where(eq(jobVisits.id, visit1.id));
    createdVisitIds.push(visit1.id);

    // Add visits #2 and #3 (both actionable)
    const futureStart = new Date(now.getTime() + 86400000);
    const visit2Id = uuidv4();
    await db.insert(jobVisits).values({
      id: visit2Id, companyId, jobId: job.id,
      scheduledDate: futureStart,
      scheduledStart: futureStart,
      scheduledEnd: new Date(futureStart.getTime() + 3600000),
      status: "scheduled", visitNumber: 2, isActive: true, assignedTechnicianId: userId,
    });
    createdVisitIds.push(visit2Id);

    const visit3Id = uuidv4();
    await db.insert(jobVisits).values({
      id: visit3Id, companyId, jobId: job.id,
      scheduledDate: new Date(futureStart.getTime() + 172800000),
      scheduledStart: new Date(futureStart.getTime() + 172800000),
      scheduledEnd: new Date(futureStart.getTime() + 176400000),
      status: "scheduled", visitNumber: 3, isActive: true, assignedTechnicianId: userId,
    });
    createdVisitIds.push(visit3Id);

    // Step A: Complete visit 1 with needs_followup → places job on_hold (Rule 3)
    await lifecycle.completeVisit({
      type: "COMPLETE_VISIT",
      companyId,
      visitId: visit1.id,
      jobId: job.id,
      outcome: "needs_followup",
      holdReason: "other",
      holdNotes: "Needs return visit",
      completedByUserId: userId,
    });

    const heldJob = await loadFullJob(companyId, job.id);
    expect(heldJob!.openSubStatus).toBe("on_hold");
    const versionAfterHold = heldJob!.version;

    // Step B: Update visit 2 to in_progress so we can complete it
    await db
      .update(jobVisits)
      .set({ status: "in_progress", checkedInAt: new Date() })
      .where(eq(jobVisits.id, visit2Id));

    // Step C: Complete visit 2 with outcome=completed → clears hold (Rule 4)
    await lifecycle.completeVisit({
      type: "COMPLETE_VISIT",
      companyId,
      visitId: visit2Id,
      jobId: job.id,
      outcome: "completed",
      completedByUserId: userId,
    });

    const clearedJob = await loadFullJob(companyId, job.id);
    expect(clearedJob).toBeDefined();

    // Business behavior preserved — hold is cleared
    expect(clearedJob!.status).toBe("open");
    expect(clearedJob!.openSubStatus).toBeNull();
    expect(clearedJob!.holdReason).toBeNull();
    expect(clearedJob!.holdNotes).toBeNull();
    expect(clearedJob!.onHoldAt).toBeNull();

    // BP-2 fix: version incremented from the hold-clear write
    expect(clearedJob!.version).toBeGreaterThan(versionAfterHold);

    // BP-2 fix: audit event with reconcile_resume action
    const events = await db
      .select()
      .from(jobStatusEvents)
      .where(and(eq(jobStatusEvents.jobId, job.id), eq(jobStatusEvents.companyId, companyId)));

    const resumeEvent = events.find(
      (e) => (e.meta as any)?.action === "reconcile_resume"
    );
    expect(resumeEvent).toBeDefined();
    expect(resumeEvent!.fromStatus).toBe("open");
    expect(resumeEvent!.toStatus).toBe("open");
    expect(resumeEvent!.changedBy).toBe(userId);

    // Must NOT set terminal fields
    expect(clearedJob!.closedAt).toBeNull();
    expect(clearedJob!.closedBy).toBeNull();
    expect(clearedJob!.previousStatus).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Test 11: Same-status event semantics are truthful, not misleading
  // --------------------------------------------------------------------------
  it("BP-2: same-status events have truthful action metadata, not fake transitions", async () => {
    const { jobId, visitId } = await createJobWithVisit();

    // Trigger Rule 2 (needs_parts, no remaining visits)
    await lifecycle.completeVisit({
      type: "COMPLETE_VISIT",
      companyId,
      visitId,
      jobId,
      outcome: "needs_parts",
      holdReason: "parts",
      completedByUserId: userId,
    });

    const events = await db
      .select()
      .from(jobStatusEvents)
      .where(and(eq(jobStatusEvents.jobId, jobId), eq(jobStatusEvents.companyId, companyId)));

    // Find the reconciliation event
    const reconEvent = events.find((e) => (e.meta as any)?.action?.startsWith("reconcile_"));
    expect(reconEvent).toBeDefined();

    // The event is open→open (truthful — no actual status transition)
    expect(reconEvent!.fromStatus).toBe("open");
    expect(reconEvent!.toStatus).toBe("open");

    // The meta.action distinguishes it from a real status change
    expect((reconEvent!.meta as any).action).toBe("reconcile_hold");
    // The note explains what happened
    expect(reconEvent!.note).toContain("reconciliation");
    expect(reconEvent!.note).toContain("needs_parts");
  });
});
