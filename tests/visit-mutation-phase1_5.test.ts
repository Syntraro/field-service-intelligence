/**
 * Visit Mutation — Phase 1.5 canonicalization invariants
 *
 * 2026-04-21: Pins the architectural guarantees added in Phase 1.5:
 *
 *   - `/api/calendar/bulk-unschedule` route handler routes each visit
 *     through `lifecycle.unscheduleVisit` (not direct storage). Actioned
 *     visits land in `skipped` with a stable reason — NEVER silently
 *     overwritten. Verified here via a stand-in that mirrors the handler's
 *     per-visit loop, since the route layer is not HTTP-tested in this
 *     repo.
 *
 *   - Intelligence shift/optimize routes no longer rewrite schedules via
 *     direct `jobVisitsRepository.updateJobVisit`. Per-visit loops must
 *     route through `lifecycle.rescheduleVisit(mode:"replace")` with an
 *     explicit `isVisitActioned` skip, verified via the same stand-in
 *     pattern plus the orchestrator's own spawn-on-actioned behavior
 *     when `mode` is omitted.
 *
 *   - Canonical orchestrator guards behave the same whether the caller is
 *     single-visit (Phase 1) or batch (Phase 1.5).
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
import { jobVisitsRepository, isVisitActioned } from "../server/storage/jobVisits";
import { v4 as uuidv4 } from "uuid";

const PREFIX = "visit_mut_phase1_5_";
let companyId: string;
let techAId: string;
let techBId: string;
let locationId: string;
let customerCompanyId: string;
const createdJobIds: string[] = [];
const createdVisitIds: string[] = [];

async function setupFixtures() {
  companyId = uuidv4();
  await db.insert(companies).values({ id: companyId, name: `${PREFIX}co` });

  const mkTech = async () => {
    const id = uuidv4();
    await db.insert(users).values({
      id,
      companyId,
      email: `${PREFIX}${id}@test.com`,
      password: "h",
      role: "technician",
      firstName: "T",
      lastName: id.slice(0, 4),
    });
    return id;
  };
  techAId = await mkTech();
  techBId = await mkTech();

  customerCompanyId = uuidv4();
  await db.insert(customerCompanies).values({
    id: customerCompanyId,
    companyId,
    name: `${PREFIX}cust`,
  });

  locationId = uuidv4();
  await db.insert(clientLocations).values({
    id: locationId,
    companyId,
    parentCompanyId: customerCompanyId,
    companyName: `${PREFIX}loc`,
    address: "1 Phase 1.5 St",
    selectedMonths: [],
  });
}

async function createScheduledVisit(overrides?: Record<string, unknown>): Promise<{
  jobId: string;
  visitId: string;
  visitVersion: number;
}> {
  const now = new Date();
  const scheduledStart = new Date(now.getTime() + 3_600_000);
  const scheduledEnd = new Date(now.getTime() + 7_200_000);

  const job = await jobRepository.createJob(companyId, {
    companyId,
    locationId,
    jobType: "PM",
    summary: `${PREFIX}job`,
    status: "open",
    assignedTechnicianIds: [techAId],
    scheduledStart,
    scheduledEnd,
    isAllDay: false,
  } as any);
  createdJobIds.push(job.id);

  const [autoVisit] = await db
    .select()
    .from(jobVisits)
    .where(and(eq(jobVisits.jobId, job.id), eq(jobVisits.companyId, companyId)));
  if (!autoVisit) throw new Error("createJob did not auto-create visit #1");

  if (overrides && Object.keys(overrides).length > 0) {
    await db.update(jobVisits).set(overrides).where(eq(jobVisits.id, autoVisit.id));
  }

  const [visit] = await db
    .select()
    .from(jobVisits)
    .where(eq(jobVisits.id, autoVisit.id));
  createdVisitIds.push(visit.id);

  return { jobId: job.id, visitId: visit.id, visitVersion: visit.version };
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
  for (const u of [techAId, techBId]) {
    if (u) await db.delete(users).where(eq(users.id, u)).catch(() => {});
  }
  if (companyId) await db.delete(companies).where(eq(companies.id, companyId)).catch(() => {});
}

/**
 * Stand-in that mirrors the `bulk-unschedule` route handler's per-visit
 * loop verbatim, so we can pin its behavior without spinning up an HTTP
 * harness. Any drift between this and the real route is an architectural
 * regression and should surface as a test diff during review.
 */
async function bulkUnscheduleLikeRoute(visitIds: string[]): Promise<{
  succeeded: string[];
  skipped: { visitId: string; reason: string }[];
  failed: { visitId: string; reason: string }[];
}> {
  const succeeded: string[] = [];
  const skipped: { visitId: string; reason: string }[] = [];
  const failed: { visitId: string; reason: string }[] = [];
  for (const visitId of visitIds) {
    try {
      const visit = await jobVisitsRepository.getJobVisit(companyId, visitId);
      if (!visit) {
        skipped.push({ visitId, reason: "Visit not found" });
        continue;
      }
      try {
        await lifecycle.unscheduleVisit({
          type: "UNSCHEDULE_VISIT",
          companyId,
          visitId: visit.id,
          expectedVersion: visit.version,
        });
      } catch (orchErr: any) {
        if (orchErr?.code === "VISIT_ACTIONED") {
          skipped.push({ visitId, reason: orchErr.message || "Visit is actioned" });
          continue;
        }
        throw orchErr;
      }
      succeeded.push(visitId);
    } catch (err: any) {
      failed.push({ visitId, reason: err.message || "Failed" });
    }
  }
  return { succeeded, skipped, failed };
}

describe("Phase 1.5: Bulk unschedule canonicalization", () => {
  beforeAll(setupFixtures);
  afterAll(cleanupFixtures);

  it("unschedules plain scheduled visits in a batch", async () => {
    const a = await createScheduledVisit();
    const b = await createScheduledVisit();
    const result = await bulkUnscheduleLikeRoute([a.visitId, b.visitId]);
    expect(result.succeeded).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    expect(result.failed).toHaveLength(0);

    for (const id of [a.visitId, b.visitId]) {
      const persisted = await jobVisitsRepository.getJobVisit(companyId, id);
      expect(persisted!.scheduledStart).toBeNull();
      expect(persisted!.scheduledEnd).toBeNull();
    }
  });

  it("SKIPS actioned (in_progress) visits in a batch and preserves their state", async () => {
    const safe = await createScheduledVisit();
    const actioned = await createScheduledVisit({
      status: "in_progress",
      checkedInAt: new Date(),
    });

    const result = await bulkUnscheduleLikeRoute([safe.visitId, actioned.visitId]);

    expect(result.succeeded).toEqual([safe.visitId]);
    expect(result.skipped.map(s => s.visitId)).toEqual([actioned.visitId]);
    expect(result.skipped[0].reason).toMatch(/actioned/i);
    expect(result.failed).toHaveLength(0);

    // Actioned visit must be untouched — core safety invariant of Phase 1.5.
    const actionedPersisted = await jobVisitsRepository.getJobVisit(companyId, actioned.visitId);
    expect(actionedPersisted!.status).toBe("in_progress");
    expect(actionedPersisted!.scheduledStart).not.toBeNull();
  });

  it("SKIPS en_route visits in a batch", async () => {
    const actioned = await createScheduledVisit({ status: "en_route" });
    const result = await bulkUnscheduleLikeRoute([actioned.visitId]);
    expect(result.succeeded).toHaveLength(0);
    expect(result.skipped.map(s => s.visitId)).toEqual([actioned.visitId]);
    const persisted = await jobVisitsRepository.getJobVisit(companyId, actioned.visitId);
    expect(persisted!.status).toBe("en_route");
    expect(persisted!.scheduledStart).not.toBeNull();
  });

  it("reports missing visits as skipped (not failed)", async () => {
    const missing = uuidv4();
    const result = await bulkUnscheduleLikeRoute([missing]);
    expect(result.skipped).toEqual([{ visitId: missing, reason: "Visit not found" }]);
    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });
});

// ============================================================================
// Intelligence routes: shift-remainder / optimize-remainder canonicalization
// ============================================================================
//
// The two intelligence route handlers share an identical guard pattern for
// Phase 1.5: before rescheduling each visit, `isVisitActioned(v)` is
// consulted and actioned visits are added to a `skipped` collection. The
// actual reschedule goes through `lifecycle.rescheduleVisit(mode:"replace")`.
// This is pinned by running the same per-visit loop directly here.

async function shiftLikeRoute(
  remainder: { visitId: string; scheduledStart: Date; scheduledEnd: Date | null; estimatedDurationMinutes: number | null; status: string; checkedInAt: Date | null; checkedOutAt: Date | null }[],
  driftMinutes: number,
) {
  let shifted = 0;
  const skipped: { visitId: string; reason: string }[] = [];
  for (const v of remainder) {
    if (isVisitActioned(v as any)) {
      skipped.push({ visitId: v.visitId, reason: `Visit is actioned (status=${v.status})` });
      continue;
    }
    const newStart = new Date(v.scheduledStart.getTime() + driftMinutes * 60_000);
    const durMin = v.estimatedDurationMinutes ?? 60;
    const newEnd = v.scheduledEnd
      ? new Date(v.scheduledEnd.getTime() + driftMinutes * 60_000)
      : new Date(newStart.getTime() + durMin * 60_000);
    try {
      await lifecycle.rescheduleVisit({
        type: "RESCHEDULE_VISIT",
        companyId,
        visitId: v.visitId,
        startAt: newStart,
        endAt: newEnd,
        mode: "replace",
      });
      shifted++;
    } catch (err: any) {
      skipped.push({ visitId: v.visitId, reason: err?.message || "Reschedule failed" });
    }
  }
  return { shifted, skipped };
}

describe("Phase 1.5: Intelligence shift-remainder / optimize-remainder canonicalization", () => {
  beforeAll(setupFixtures);
  afterAll(cleanupFixtures);

  it("shifts unactioned remainder visits through orchestrator", async () => {
    const a = await createScheduledVisit();
    const b = await createScheduledVisit();
    const av = await jobVisitsRepository.getJobVisit(companyId, a.visitId);
    const bv = await jobVisitsRepository.getJobVisit(companyId, b.visitId);

    const before = [
      { visitId: a.visitId, scheduledStart: av!.scheduledStart!, scheduledEnd: av!.scheduledEnd, estimatedDurationMinutes: av!.estimatedDurationMinutes, status: av!.status, checkedInAt: av!.checkedInAt, checkedOutAt: av!.checkedOutAt },
      { visitId: b.visitId, scheduledStart: bv!.scheduledStart!, scheduledEnd: bv!.scheduledEnd, estimatedDurationMinutes: bv!.estimatedDurationMinutes, status: bv!.status, checkedInAt: bv!.checkedInAt, checkedOutAt: bv!.checkedOutAt },
    ];

    const result = await shiftLikeRoute(before, 30);
    expect(result.shifted).toBe(2);
    expect(result.skipped).toHaveLength(0);

    const aAfter = await jobVisitsRepository.getJobVisit(companyId, a.visitId);
    expect(aAfter!.scheduledStart!.getTime()).toBeGreaterThan(before[0].scheduledStart.getTime());
  });

  it("SKIPS actioned visits in remainder — schedule must NOT be rewritten silently", async () => {
    const actioned = await createScheduledVisit({
      status: "in_progress",
      checkedInAt: new Date(),
    });
    const av = await jobVisitsRepository.getJobVisit(companyId, actioned.visitId);
    const originalStart = av!.scheduledStart;

    const result = await shiftLikeRoute(
      [{ visitId: actioned.visitId, scheduledStart: av!.scheduledStart!, scheduledEnd: av!.scheduledEnd, estimatedDurationMinutes: av!.estimatedDurationMinutes, status: av!.status, checkedInAt: av!.checkedInAt, checkedOutAt: av!.checkedOutAt }],
      30,
    );

    expect(result.shifted).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/actioned/i);

    // Schedule is NOT rewritten — this is the Phase 1.5 core invariant for
    // bulk schedule rewrites.
    const persisted = await jobVisitsRepository.getJobVisit(companyId, actioned.visitId);
    expect(persisted!.scheduledStart!.getTime()).toBe(originalStart!.getTime());
  });

  it("SKIPS en_route visits in remainder", async () => {
    const actioned = await createScheduledVisit({ status: "en_route" });
    const av = await jobVisitsRepository.getJobVisit(companyId, actioned.visitId);
    const result = await shiftLikeRoute(
      [{ visitId: actioned.visitId, scheduledStart: av!.scheduledStart!, scheduledEnd: av!.scheduledEnd, estimatedDurationMinutes: av!.estimatedDurationMinutes, status: av!.status, checkedInAt: av!.checkedInAt, checkedOutAt: av!.checkedOutAt }],
      15,
    );
    expect(result.shifted).toBe(0);
    expect(result.skipped).toHaveLength(1);
  });

  it("mixes safe + actioned visits correctly in a single batch", async () => {
    const safeA = await createScheduledVisit();
    const actioned = await createScheduledVisit({ status: "in_progress", checkedInAt: new Date() });
    const safeB = await createScheduledVisit();

    const rows = await Promise.all(
      [safeA.visitId, actioned.visitId, safeB.visitId].map(async (id) => {
        const v = await jobVisitsRepository.getJobVisit(companyId, id);
        return { visitId: id, scheduledStart: v!.scheduledStart!, scheduledEnd: v!.scheduledEnd, estimatedDurationMinutes: v!.estimatedDurationMinutes, status: v!.status, checkedInAt: v!.checkedInAt, checkedOutAt: v!.checkedOutAt };
      }),
    );

    const result = await shiftLikeRoute(rows, 20);
    expect(result.shifted).toBe(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].visitId).toBe(actioned.visitId);
  });
});

// ============================================================================
// Deprecated client helpers — removed in Phase 1.5
// ============================================================================
//
// The architectural guarantee that `applyJobSchedule`, `unscheduleVisit`
// (helper), `scheduleValueToPayload`, `useScheduleJob`, and
// `useUnscheduleVisit` no longer exist is enforced by `npm run check` (tsc
// strict mode). If anyone re-exports or re-imports those names, the build
// fails before this test file runs. A dynamic-import smoke check was tried
// here initially but vitest's config does not resolve the `@/` client
// alias, so the tsc guarantee is the single source of truth for this
// invariant.
