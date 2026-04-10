/**
 * Tech Visit Workflow Controls Tests (2026-04-09)
 *
 * Covers the new reversible workflow + pause/resume controls plus the
 * sub-1-minute discard policy:
 *
 *   - server/services/jobLifecycleOrchestrator.ts (cancelVisitRoute,
 *     cancelVisitStart, pauseVisit, resumeVisit)
 *   - server/storage/timeTracking.ts (stopAndDiscardIfTrivial,
 *     "resumed" case in recordJobStatus, sub-1-min discard wired into
 *     "paused" and "completed" cases and the autoStopOpen guard)
 *
 * The tests do NOT spin up the HTTP layer — they call the orchestrator and
 * timeTracking repository directly. The route handlers are thin wrappers
 * over these and are exercised by the existing tech-field smoke tests.
 *
 * Locked product decisions verified:
 *   1. Cancel Route reverts en_route → scheduled.
 *   2. Cancel Start reverts in_progress → en_route, preserves checkedInAt.
 *   3. Pause sets in_progress → paused.
 *   4. Resume sets paused → in_progress.
 *   5. stopAndDiscardIfTrivial discards entries with durationMinutes < 1.
 *   6. stopAndDiscardIfTrivial preserves entries with durationMinutes >= 1.
 *   7. recordJobStatus("resumed") starts a fresh on_site time entry.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../server/db";
import {
  jobs,
  jobVisits,
  timeEntries,
  technicianJobStatusEvents,
  companies,
  users,
  clientLocations,
  customerCompanies,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { jobRepository } from "../server/storage/jobs";
import { timeTrackingRepository } from "../server/storage/timeTracking";
import {
  cancelVisitRoute,
  cancelVisitStart,
  pauseVisit,
  resumeVisit,
  cancelVisit,
  bulkCompleteVisits,
} from "../server/services/jobLifecycleOrchestrator";
import { v4 as uuidv4 } from "uuid";

const TEST_PREFIX = "tech_workflow_test_";
let companyId: string;
let userId: string;
let customerCompanyId: string;
let locationId: string;
let jobId: string;
let visitId: string;

async function createFixtures() {
  companyId = uuidv4();
  await db.insert(companies).values({ id: companyId, name: `${TEST_PREFIX}company` });

  userId = uuidv4();
  await db.insert(users).values({
    id: userId,
    companyId,
    email: `${TEST_PREFIX}${Date.now()}@test.com`,
    password: "test_password_hash",
    role: "technician",
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

  // jobRepository.createJob also creates the initial visit row.
  const job = await jobRepository.createJob(companyId, {
    companyId,
    locationId,
    summary: `${TEST_PREFIX}job`,
    status: "open",
    jobType: "maintenance",
    priority: "medium",
  });
  jobId = job.id;

  const [visit] = await db
    .select()
    .from(jobVisits)
    .where(and(eq(jobVisits.companyId, companyId), eq(jobVisits.jobId, jobId)))
    .limit(1);
  visitId = visit.id;

  // Assign the test technician to the visit.
  await db
    .update(jobVisits)
    .set({ assignedTechnicianId: userId, assignedTechnicianIds: [userId] })
    .where(eq(jobVisits.id, visitId));
}

async function cleanupFixtures() {
  await db.delete(timeEntries).where(eq(timeEntries.companyId, companyId));
  await db.delete(technicianJobStatusEvents).where(eq(technicianJobStatusEvents.companyId, companyId));
  await db.delete(jobVisits).where(eq(jobVisits.companyId, companyId));
  await db.delete(jobs).where(eq(jobs.companyId, companyId));
  await db.delete(clientLocations).where(eq(clientLocations.companyId, companyId));
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, companyId));
  await db.delete(users).where(eq(users.companyId, companyId));
  await db.delete(companies).where(eq(companies.id, companyId));
}

async function setVisitStatus(status: string, patch: Record<string, unknown> = {}) {
  await db
    .update(jobVisits)
    .set({ status: status as any, ...patch })
    .where(eq(jobVisits.id, visitId));
}

async function clearTimeEntries() {
  await db.delete(timeEntries).where(eq(timeEntries.companyId, companyId));
}

describe("Tech Visit Workflow Controls", () => {
  beforeAll(async () => {
    await createFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  beforeEach(async () => {
    await clearTimeEntries();
  });

  // ─────────────────────────────────────────────────────────────────────
  // Sub-1-minute discard helper
  // ─────────────────────────────────────────────────────────────────────
  describe("stopAndDiscardIfTrivial", () => {
    it("discards an entry with duration < 1 minute", async () => {
      const startAt = new Date();
      // 30 seconds later
      const endAt = new Date(startAt.getTime() + 30 * 1000);

      const entry = await timeTrackingRepository.startTimeEntry(
        companyId,
        userId,
        { type: "on_site", jobId, at: startAt },
      );

      const result = await timeTrackingRepository.stopAndDiscardIfTrivial(
        companyId,
        userId,
        { timeEntryId: entry.id, at: endAt },
      );

      expect(result.discarded).toBe(true);
      expect(result.stopped).toBeNull();

      // Entry row should be physically gone.
      const [row] = await db
        .select()
        .from(timeEntries)
        .where(eq(timeEntries.id, entry.id));
      expect(row).toBeUndefined();
    });

    it("preserves an entry with duration >= 1 minute", async () => {
      const startAt = new Date();
      const endAt = new Date(startAt.getTime() + 90 * 1000); // 90 seconds = 2 min rounded

      const entry = await timeTrackingRepository.startTimeEntry(
        companyId,
        userId,
        { type: "on_site", jobId, at: startAt },
      );

      const result = await timeTrackingRepository.stopAndDiscardIfTrivial(
        companyId,
        userId,
        { timeEntryId: entry.id, at: endAt },
      );

      expect(result.discarded).toBe(false);
      expect(result.stopped).not.toBeNull();
      expect(result.stopped?.id).toBe(entry.id);

      // Entry row should still exist with endAt set.
      const [row] = await db
        .select()
        .from(timeEntries)
        .where(eq(timeEntries.id, entry.id));
      expect(row).toBeDefined();
      expect(row.endAt).not.toBeNull();
      // Math.round(90s/60) === 2
      expect(row.durationMinutes).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // cancelVisitRoute
  // ─────────────────────────────────────────────────────────────────────
  describe("cancelVisitRoute", () => {
    it("reverts en_route → scheduled", async () => {
      await setVisitStatus("en_route");
      await cancelVisitRoute({
        type: "CANCEL_VISIT_ROUTE",
        companyId,
        visitId,
        jobId,
      });

      const [row] = await db.select().from(jobVisits).where(eq(jobVisits.id, visitId));
      expect(row.status).toBe("scheduled");
    });

    it("rejects when visit is not en_route", async () => {
      await setVisitStatus("scheduled");
      await expect(
        cancelVisitRoute({
          type: "CANCEL_VISIT_ROUTE",
          companyId,
          visitId,
          jobId,
        }),
      ).rejects.toThrow(/Only en_route visits can be reverted/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // cancelVisitStart (2026-04-10 patch: #1 + #2)
  // ─────────────────────────────────────────────────────────────────────
  describe("cancelVisitStart", () => {
    it("(>= 1 min) preserves checkedInAt and restores to en_route fallback", async () => {
      // 5-minute checkedInAt = real labor session, must be preserved.
      const checkedIn = new Date(Date.now() - 5 * 60 * 1000);
      await setVisitStatus("in_progress", { checkedInAt: checkedIn, previousStatus: null });

      await cancelVisitStart({
        type: "CANCEL_VISIT_START",
        companyId,
        visitId,
        jobId,
      });

      const [row] = await db.select().from(jobVisits).where(eq(jobVisits.id, visitId));
      // Fallback restore (no previousStatus) → en_route.
      expect(row.status).toBe("en_route");
      // FIX #1: checkedInAt preserved for >= 1 minute.
      expect(row.checkedInAt).not.toBeNull();
      expect(row.checkedInAt?.getTime()).toBe(checkedIn.getTime());
    });

    it("(< 1 min) clears checkedInAt for accidental sub-minute starts", async () => {
      // 30-second checkedInAt = trivial mistaken start.
      const checkedIn = new Date(Date.now() - 30 * 1000);
      await setVisitStatus("in_progress", { checkedInAt: checkedIn, previousStatus: null });

      await cancelVisitStart({
        type: "CANCEL_VISIT_START",
        companyId,
        visitId,
        jobId,
      });

      const [row] = await db.select().from(jobVisits).where(eq(jobVisits.id, visitId));
      // FIX #1: checkedInAt cleared for < 1 minute.
      expect(row.checkedInAt).toBeNull();
    });

    it("restores to the captured previousStatus (scheduled, no en_route step)", async () => {
      // Tech tapped Start Job directly from scheduled — Cancel Start should
      // restore to scheduled, not en_route. previousStatus was captured by
      // startVisit at transition time.
      const checkedIn = new Date(Date.now() - 30 * 1000);
      await setVisitStatus("in_progress", { checkedInAt: checkedIn, previousStatus: "scheduled" });

      await cancelVisitStart({
        type: "CANCEL_VISIT_START",
        companyId,
        visitId,
        jobId,
      });

      const [row] = await db.select().from(jobVisits).where(eq(jobVisits.id, visitId));
      // FIX #2: restored to the actual prior state.
      expect(row.status).toBe("scheduled");
      // previousStatus cleared after cancel.
      expect((row as any).previousStatus).toBeNull();
    });

    it("restores to en_route when previousStatus was en_route", async () => {
      const checkedIn = new Date(Date.now() - 30 * 1000);
      await setVisitStatus("in_progress", { checkedInAt: checkedIn, previousStatus: "en_route" });

      await cancelVisitStart({
        type: "CANCEL_VISIT_START",
        companyId,
        visitId,
        jobId,
      });

      const [row] = await db.select().from(jobVisits).where(eq(jobVisits.id, visitId));
      expect(row.status).toBe("en_route");
      expect((row as any).previousStatus).toBeNull();
    });

    it("rejects when visit is not in_progress / on_site", async () => {
      await setVisitStatus("scheduled");
      await expect(
        cancelVisitStart({
          type: "CANCEL_VISIT_START",
          companyId,
          visitId,
          jobId,
        }),
      ).rejects.toThrow(/Only in_progress \/ on_site visits can be reverted/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // startVisit captures previousStatus (2026-04-10 patch #2)
  // ─────────────────────────────────────────────────────────────────────
  describe("startVisit capture of previousStatus", () => {
    it("captures 'scheduled' when starting directly from scheduled", async () => {
      await setVisitStatus("scheduled", { previousStatus: null, checkedInAt: null });
      const { startVisit } = await import("../server/services/jobLifecycleOrchestrator");
      await startVisit({
        type: "START_VISIT",
        companyId,
        visitId,
        jobId,
      });
      const [row] = await db.select().from(jobVisits).where(eq(jobVisits.id, visitId));
      expect(row.status).toBe("in_progress");
      expect((row as any).previousStatus).toBe("scheduled");
    });

    it("captures 'en_route' when starting after Start Route", async () => {
      await setVisitStatus("en_route", { previousStatus: null, checkedInAt: null });
      const { startVisit } = await import("../server/services/jobLifecycleOrchestrator");
      await startVisit({
        type: "START_VISIT",
        companyId,
        visitId,
        jobId,
      });
      const [row] = await db.select().from(jobVisits).where(eq(jobVisits.id, visitId));
      expect(row.status).toBe("in_progress");
      expect((row as any).previousStatus).toBe("en_route");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Single-active-visit enforcement (2026-04-10 patch #3)
  // ─────────────────────────────────────────────────────────────────────
  describe("single-active-visit enforcement", () => {
    let secondVisitId: string;

    beforeEach(async () => {
      // Create a SECOND visit on the same job, assigned to the same tech.
      // Reset state on the primary visit so each test starts clean.
      await db
        .update(jobVisits)
        .set({ status: "scheduled", checkedInAt: null, previousStatus: null })
        .where(eq(jobVisits.id, visitId));

      const [second] = await db
        .insert(jobVisits)
        .values({
          companyId,
          jobId,
          scheduledDate: new Date(),
          status: "scheduled",
          assignedTechnicianId: userId,
          assignedTechnicianIds: [userId],
        } as any)
        .returning();
      secondVisitId = second.id;
    });

    afterEach(async () => {
      await db.delete(jobVisits).where(eq(jobVisits.id, secondVisitId));
    });

    it("setVisitEnRoute refuses when another visit is already en_route", async () => {
      // First visit is en_route
      await db
        .update(jobVisits)
        .set({ status: "en_route" })
        .where(eq(jobVisits.id, visitId));

      const { setVisitEnRoute } = await import("../server/services/jobLifecycleOrchestrator");
      await expect(
        setVisitEnRoute({
          type: "SET_VISIT_EN_ROUTE",
          companyId,
          visitId: secondVisitId,
          jobId,
          actingUserId: userId,
        }),
      ).rejects.toThrow(/ACTIVE_VISIT_CONFLICT/);
    });

    it("startVisit refuses when another visit is in_progress", async () => {
      await db
        .update(jobVisits)
        .set({ status: "in_progress" })
        .where(eq(jobVisits.id, visitId));

      const { startVisit } = await import("../server/services/jobLifecycleOrchestrator");
      await expect(
        startVisit({
          type: "START_VISIT",
          companyId,
          visitId: secondVisitId,
          jobId,
          actingUserId: userId,
        }),
      ).rejects.toThrow(/ACTIVE_VISIT_CONFLICT/);
    });

    it("resumeVisit refuses when another visit is active", async () => {
      // The second visit will be paused; the first visit is in_progress.
      await db
        .update(jobVisits)
        .set({ status: "paused" })
        .where(eq(jobVisits.id, secondVisitId));
      await db
        .update(jobVisits)
        .set({ status: "in_progress" })
        .where(eq(jobVisits.id, visitId));

      await expect(
        resumeVisit({
          type: "RESUME_VISIT",
          companyId,
          visitId: secondVisitId,
          jobId,
          actingUserId: userId,
        }),
      ).rejects.toThrow(/ACTIVE_VISIT_CONFLICT/);
    });

    it("guard is no-op when actingUserId is omitted (legacy/office callers)", async () => {
      await db
        .update(jobVisits)
        .set({ status: "in_progress" })
        .where(eq(jobVisits.id, visitId));

      // No actingUserId → no guard fires → succeeds even though another visit is active.
      const { setVisitEnRoute } = await import("../server/services/jobLifecycleOrchestrator");
      await setVisitEnRoute({
        type: "SET_VISIT_EN_ROUTE",
        companyId,
        visitId: secondVisitId,
        jobId,
      });
      const [row] = await db.select().from(jobVisits).where(eq(jobVisits.id, secondVisitId));
      expect(row.status).toBe("en_route");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // pauseVisit + resumeVisit
  // ─────────────────────────────────────────────────────────────────────
  describe("pauseVisit + resumeVisit", () => {
    it("pause sets in_progress → paused", async () => {
      await setVisitStatus("in_progress");
      await pauseVisit({
        type: "PAUSE_VISIT",
        companyId,
        visitId,
        jobId,
      });
      const [row] = await db.select().from(jobVisits).where(eq(jobVisits.id, visitId));
      expect(row.status).toBe("paused");
    });

    it("resume sets paused → in_progress", async () => {
      await setVisitStatus("paused");
      await resumeVisit({
        type: "RESUME_VISIT",
        companyId,
        visitId,
        jobId,
      });
      const [row] = await db.select().from(jobVisits).where(eq(jobVisits.id, visitId));
      expect(row.status).toBe("in_progress");
    });

    it("pause rejects when visit is not in_progress / on_site", async () => {
      await setVisitStatus("scheduled");
      await expect(
        pauseVisit({
          type: "PAUSE_VISIT",
          companyId,
          visitId,
          jobId,
        }),
      ).rejects.toThrow(/Only in_progress \/ on_site visits can be paused/);
    });

    it("resume rejects when visit is not paused", async () => {
      await setVisitStatus("in_progress");
      await expect(
        resumeVisit({
          type: "RESUME_VISIT",
          companyId,
          visitId,
          jobId,
        }),
      ).rejects.toThrow(/Only paused visits can be resumed/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // recordJobStatus("resumed") starts a fresh on_site entry
  // ─────────────────────────────────────────────────────────────────────
  describe("recordJobStatus resumed", () => {
    it("starts a new on_site time entry on resume", async () => {
      // Make sure the job is open so the activeWorkJobFilter inside
      // recordJobStatus accepts it.
      await db.update(jobs).set({ status: "open" }).where(eq(jobs.id, jobId));

      const before = await db
        .select()
        .from(timeEntries)
        .where(and(eq(timeEntries.companyId, companyId), eq(timeEntries.jobId, jobId)));
      expect(before.length).toBe(0);

      const { timeEntry } = await timeTrackingRepository.recordJobStatus(
        companyId,
        userId,
        jobId,
        { status: "resumed", source: "mobile" },
      );

      expect(timeEntry).toBeDefined();
      expect(timeEntry?.type).toBe("on_site");
      expect(timeEntry?.endAt).toBeNull(); // running

      const after = await db
        .select()
        .from(timeEntries)
        .where(and(eq(timeEntries.companyId, companyId), eq(timeEntries.jobId, jobId)));
      expect(after.length).toBe(1);
      expect(after[0].type).toBe("on_site");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 2026-04-10 micro-patch: resume guard against orphan running time entry
  // ─────────────────────────────────────────────────────────────────────
  describe("resumeVisit running-time-entry guard", () => {
    it("rejects with RUNNING_TIME_ENTRY_EXISTS when an orphan running entry exists", async () => {
      // State drift simulation: visit is paused but a running time entry
      // somehow still exists (stale tab, partial failure, prior bug, etc).
      await db.update(jobs).set({ status: "open" }).where(eq(jobs.id, jobId));
      await setVisitStatus("paused");

      // Plant an orphan running entry on a different job-less context — use
      // the same job as the visit so we exercise the same-job-still-running
      // edge case (the worst possible drift state).
      await timeTrackingRepository.startTimeEntry(companyId, userId, {
        type: "on_site",
        jobId,
        at: new Date(),
      });
      const planted = await timeTrackingRepository.getRunningTimeEntry(companyId, userId);
      expect(planted).not.toBeNull();

      await expect(
        resumeVisit({
          type: "RESUME_VISIT",
          companyId,
          visitId,
          jobId,
          actingUserId: userId,
        }),
      ).rejects.toThrow(/^RUNNING_TIME_ENTRY_EXISTS:/);

      // Visit must remain paused — the rejection happens before the update.
      const [row] = await db.select().from(jobVisits).where(eq(jobVisits.id, visitId));
      expect(row.status).toBe("paused");

      // The orphan entry must NOT have been silently auto-stopped — the whole
      // point of the guard is that the operator sees the inconsistency.
      const stillRunning = await timeTrackingRepository.getRunningTimeEntry(companyId, userId);
      expect(stillRunning).not.toBeNull();
      expect(stillRunning!.id).toBe(planted!.id);
    });

    it("succeeds when no running time entry exists (happy path unchanged)", async () => {
      await db.update(jobs).set({ status: "open" }).where(eq(jobs.id, jobId));
      await setVisitStatus("paused");
      // beforeEach already cleared time entries — verify.
      const running = await timeTrackingRepository.getRunningTimeEntry(companyId, userId);
      expect(running).toBeNull();

      await resumeVisit({
        type: "RESUME_VISIT",
        companyId,
        visitId,
        jobId,
        actingUserId: userId,
      });

      const [row] = await db.select().from(jobVisits).where(eq(jobVisits.id, visitId));
      expect(row.status).toBe("in_progress");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 2026-04-10 micro-patch: previousStatus must be cleared by every
  // terminal cleanup path touched by the new reversible workflow.
  // ─────────────────────────────────────────────────────────────────────
  describe("previousStatus terminal cleanup", () => {
    it("cancelVisit (CANCEL_VISIT intent) clears previousStatus on a paused visit", async () => {
      // Simulate a paused visit that still carries the cancel-start restore
      // marker captured by an earlier startVisit call.
      await setVisitStatus("paused", { previousStatus: "en_route" });
      const [before] = await db.select().from(jobVisits).where(eq(jobVisits.id, visitId));
      expect((before as any).previousStatus).toBe("en_route");

      await cancelVisit({
        type: "CANCEL_VISIT",
        companyId,
        visitId,
        jobId,
      });

      const [after] = await db.select().from(jobVisits).where(eq(jobVisits.id, visitId));
      expect(after.status).toBe("cancelled");
      expect((after as any).previousStatus).toBeNull();
    });

    it("bulkCompleteVisits clears previousStatus on a paused visit caught up in a force-close", async () => {
      // Paused visit with a stale cancel-start marker — the office force-closes
      // the parent job, which calls bulkCompleteVisitsInternal.
      await db.update(jobs).set({ status: "open" }).where(eq(jobs.id, jobId));
      await setVisitStatus("paused", { previousStatus: "en_route" });
      const [before] = await db.select().from(jobVisits).where(eq(jobVisits.id, visitId));
      expect((before as any).previousStatus).toBe("en_route");

      const result = await bulkCompleteVisits({
        type: "BULK_COMPLETE_VISITS",
        companyId,
        jobId,
      });

      expect(result.completedCount).toBeGreaterThanOrEqual(1);
      const [after] = await db.select().from(jobVisits).where(eq(jobVisits.id, visitId));
      expect(after.status).toBe("completed");
      expect((after as any).previousStatus).toBeNull();
    });

    it("happy-path completeVisit (already covered) still clears previousStatus", async () => {
      // Defense-in-depth assertion: the existing completeVisit clearing on
      // line 459 of the orchestrator should keep working. We exercise it
      // through the paused → resume → complete flow described in the patch.
      await db.update(jobs).set({ status: "open" }).where(eq(jobs.id, jobId));
      await setVisitStatus("paused", { previousStatus: "en_route" });

      await resumeVisit({
        type: "RESUME_VISIT",
        companyId,
        visitId,
        jobId,
        actingUserId: userId,
      });

      // After resume, the visit is in_progress and previousStatus is still en_route
      // (resume preserves the marker; it is the terminal step that clears it).
      const [resumed] = await db.select().from(jobVisits).where(eq(jobVisits.id, visitId));
      expect(resumed.status).toBe("in_progress");
      expect((resumed as any).previousStatus).toBe("en_route");

      // Now complete via the canonical orchestrator path used by every other
      // completion site. Reuse the existing import from the orchestrator.
      const { completeVisit } = await import("../server/services/jobLifecycleOrchestrator");
      await completeVisit({
        type: "COMPLETE_VISIT",
        companyId,
        visitId,
        jobId,
        outcome: "completed",
        completedByUserId: userId,
      });

      const [done] = await db.select().from(jobVisits).where(eq(jobVisits.id, visitId));
      expect(done.status).toBe("completed");
      expect((done as any).previousStatus).toBeNull();
    });
  });
});
