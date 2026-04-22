/**
 * Visit Mutation — Canonical Paths (Phase 1 integration tests)
 *
 * 2026-04-21: Locks in the architectural invariants of the Phase 1
 * canonical visit mutation refactor. Each failure here means a future
 * change has drifted away from the architecture:
 *
 *   - The PATCH /api/jobs/:jobId/visits/:visitId route is METADATA-ONLY.
 *     Only `visitNotes` and `equipmentIds` may be written through it.
 *     Every operational field is rejected by Zod `.strict()`.
 *
 *   - The PATCH /api/calendar/visit/:id/assign-crew route uses the
 *     canonical field name `assignedTechnicianIds`. The legacy
 *     `technicianUserIds` shape is rejected.
 *
 *   - `lifecycle.assignVisitCrew` replaces direct storage writes for crew.
 *     Version check, terminal-visit guard, and normalization all apply.
 *
 *   - `lifecycle.unscheduleVisit` adds actioned-visit protection that the
 *     old direct-storage path silently lacked. An in_progress visit
 *     cannot be unscheduled.
 *
 *   - Equipment selection persists through the metadata PATCH path.
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
import { jobVisitsRepository } from "../server/storage/jobVisits";
import { VersionMismatchError } from "../server/domain/scheduling";
import { updateVisitSchema } from "../server/routes/jobVisits.routes";
import { assignCrewSchema } from "../server/routes/scheduling";
import { v4 as uuidv4 } from "uuid";

const PREFIX = "visit_mut_canonical_";
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
    address: "1 Canonical St",
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

describe("Phase 1: Visit mutation canonical paths", () => {
  beforeAll(setupFixtures);
  afterAll(cleanupFixtures);

  // ==========================================================================
  // Narrow PATCH /api/jobs/:jobId/visits/:visitId — metadata contract
  // ==========================================================================
  describe("updateVisitSchema (PATCH visit narrow contract)", () => {
    it("accepts visitNotes + equipmentIds", () => {
      const r = updateVisitSchema.safeParse({
        visitNotes: "hello",
        equipmentIds: [uuidv4(), uuidv4()],
      });
      expect(r.success).toBe(true);
    });

    it("accepts an empty body (no metadata changed)", () => {
      const r = updateVisitSchema.safeParse({});
      expect(r.success).toBe(true);
    });

    it("rejects scheduledStart", () => {
      const r = updateVisitSchema.safeParse({ scheduledStart: new Date().toISOString() });
      expect(r.success).toBe(false);
    });

    it("rejects scheduledEnd", () => {
      const r = updateVisitSchema.safeParse({ scheduledEnd: new Date().toISOString() });
      expect(r.success).toBe(false);
    });

    it("rejects isAllDay", () => {
      const r = updateVisitSchema.safeParse({ isAllDay: true });
      expect(r.success).toBe(false);
    });

    it("rejects estimatedDurationMinutes", () => {
      const r = updateVisitSchema.safeParse({ estimatedDurationMinutes: 90 });
      expect(r.success).toBe(false);
    });

    it("rejects assignedTechnicianIds", () => {
      const r = updateVisitSchema.safeParse({ assignedTechnicianIds: [uuidv4()] });
      expect(r.success).toBe(false);
    });

    it("rejects status", () => {
      const r = updateVisitSchema.safeParse({ status: "in_progress" });
      expect(r.success).toBe(false);
    });

    it("rejects scheduledDate (legacy)", () => {
      const r = updateVisitSchema.safeParse({ scheduledDate: new Date().toISOString() });
      expect(r.success).toBe(false);
    });
  });

  // ==========================================================================
  // PATCH /api/calendar/visit/:id/assign-crew — canonical crew field name
  // ==========================================================================
  describe("assignCrewSchema (canonical crew contract)", () => {
    it("accepts assignedTechnicianIds", () => {
      const r = assignCrewSchema.safeParse({
        assignedTechnicianIds: [uuidv4()],
        version: 1,
      });
      expect(r.success).toBe(true);
    });

    it("accepts an empty crew array (clearing assignment)", () => {
      const r = assignCrewSchema.safeParse({
        assignedTechnicianIds: [],
        version: 1,
      });
      expect(r.success).toBe(true);
    });

    it("rejects the legacy technicianUserIds field", () => {
      const r = assignCrewSchema.safeParse({
        technicianUserIds: [uuidv4()],
        version: 1,
      });
      expect(r.success).toBe(false);
    });

    it("rejects missing version", () => {
      const r = assignCrewSchema.safeParse({
        assignedTechnicianIds: [uuidv4()],
      });
      expect(r.success).toBe(false);
    });
  });

  // ==========================================================================
  // lifecycle.assignVisitCrew — new orchestrator method
  // ==========================================================================
  describe("lifecycle.assignVisitCrew", () => {
    it("replaces crew and increments visit version", async () => {
      const { visitId, visitVersion } = await createScheduledVisit();

      const result = await lifecycle.assignVisitCrew({
        type: "ASSIGN_VISIT_CREW",
        companyId,
        visitId,
        assignedTechnicianIds: [techBId],
        expectedVersion: visitVersion,
      });

      expect(result.visit.assignedTechnicianIds).toEqual([techBId]);
      expect(result.visit.version).toBe(visitVersion + 1);
      expect(result.jobId).toBeTruthy();
    });

    it("clears crew when given an empty array", async () => {
      const { visitId, visitVersion } = await createScheduledVisit();

      const result = await lifecycle.assignVisitCrew({
        type: "ASSIGN_VISIT_CREW",
        companyId,
        visitId,
        assignedTechnicianIds: [],
        expectedVersion: visitVersion,
      });

      expect(result.visit.assignedTechnicianIds).toEqual([]);
      expect(result.visit.version).toBe(visitVersion + 1);
    });

    it("dedupes crew via canonical normalizer", async () => {
      const { visitId, visitVersion } = await createScheduledVisit();

      const result = await lifecycle.assignVisitCrew({
        type: "ASSIGN_VISIT_CREW",
        companyId,
        visitId,
        assignedTechnicianIds: [techAId, techBId, techAId],
        expectedVersion: visitVersion,
      });

      expect(result.visit.assignedTechnicianIds).toEqual([techAId, techBId]);
    });

    it("rejects a stale version", async () => {
      const { visitId, visitVersion } = await createScheduledVisit();

      await expect(
        lifecycle.assignVisitCrew({
          type: "ASSIGN_VISIT_CREW",
          companyId,
          visitId,
          assignedTechnicianIds: [techBId],
          expectedVersion: visitVersion + 99,
        }),
      ).rejects.toBeInstanceOf(VersionMismatchError);
    });

    it("rejects crew assignment on a completed visit", async () => {
      const { visitId, visitVersion } = await createScheduledVisit({
        status: "completed",
        outcome: "completed",
        completedAt: new Date(),
      });

      await expect(
        lifecycle.assignVisitCrew({
          type: "ASSIGN_VISIT_CREW",
          companyId,
          visitId,
          assignedTechnicianIds: [techBId],
          expectedVersion: visitVersion,
        }),
      ).rejects.toThrow(/completed/);
    });
  });

  // ==========================================================================
  // lifecycle.unscheduleVisit — actioned-visit protection
  // ==========================================================================
  describe("lifecycle.unscheduleVisit", () => {
    it("unschedules a plain scheduled visit and clears schedule/crew", async () => {
      const { visitId, visitVersion } = await createScheduledVisit();

      const result = await lifecycle.unscheduleVisit({
        type: "UNSCHEDULE_VISIT",
        companyId,
        visitId,
        expectedVersion: visitVersion,
      });

      expect(result.visitId).toBe(visitId);

      const persisted = await jobVisitsRepository.getJobVisit(companyId, visitId);
      expect(persisted!.scheduledStart).toBeNull();
      expect(persisted!.scheduledEnd).toBeNull();
      expect(persisted!.assignedTechnicianIds ?? []).toEqual([]);
    });

    it("REJECTS unscheduling an actioned (in_progress) visit", async () => {
      const { visitId, visitVersion } = await createScheduledVisit({
        status: "in_progress",
        checkedInAt: new Date(),
      });

      await expect(
        lifecycle.unscheduleVisit({
          type: "UNSCHEDULE_VISIT",
          companyId,
          visitId,
          expectedVersion: visitVersion,
        }),
      ).rejects.toThrow(/actioned/i);

      // Visit state must be untouched — this is the whole point of the guard.
      const persisted = await jobVisitsRepository.getJobVisit(companyId, visitId);
      expect(persisted!.status).toBe("in_progress");
      expect(persisted!.scheduledStart).not.toBeNull();
    });

    it("REJECTS unscheduling an en_route visit", async () => {
      const { visitId, visitVersion } = await createScheduledVisit({ status: "en_route" });

      await expect(
        lifecycle.unscheduleVisit({
          type: "UNSCHEDULE_VISIT",
          companyId,
          visitId,
          expectedVersion: visitVersion,
        }),
      ).rejects.toThrow(/actioned/i);
    });

    it("REJECTS unscheduling a visit that only has checkedInAt set (no status flip)", async () => {
      // isVisitActioned treats `checkedInAt` as a strong actioned signal even
      // when the status field lags — regression pin for that branch.
      const { visitId, visitVersion } = await createScheduledVisit({
        checkedInAt: new Date(),
      });

      await expect(
        lifecycle.unscheduleVisit({
          type: "UNSCHEDULE_VISIT",
          companyId,
          visitId,
          expectedVersion: visitVersion,
        }),
      ).rejects.toThrow(/actioned/i);
    });
  });

  // ==========================================================================
  // Equipment persistence through the narrow metadata PATCH
  // ==========================================================================
  describe("equipment persistence via narrow PATCH", () => {
    it("writes and reads equipmentIds on the visit row", async () => {
      const { visitId, visitVersion } = await createScheduledVisit();
      const equip = [uuidv4(), uuidv4()];

      await jobVisitsRepository.updateJobVisit(companyId, visitId, visitVersion, {
        equipmentIds: equip,
      });

      const persisted = await jobVisitsRepository.getJobVisit(companyId, visitId);
      expect((persisted as any)!.equipmentIds).toEqual(equip);
    });

    it("can be cleared by writing an empty array", async () => {
      const { visitId, visitVersion } = await createScheduledVisit();
      const equip = [uuidv4()];

      await jobVisitsRepository.updateJobVisit(companyId, visitId, visitVersion, {
        equipmentIds: equip,
      });
      const afterSet = await jobVisitsRepository.getJobVisit(companyId, visitId);
      expect((afterSet as any)!.equipmentIds).toEqual(equip);

      await jobVisitsRepository.updateJobVisit(companyId, visitId, afterSet!.version, {
        equipmentIds: [],
      });
      const afterClear = await jobVisitsRepository.getJobVisit(companyId, visitId);
      expect((afterClear as any)!.equipmentIds ?? []).toEqual([]);
    });
  });
});
