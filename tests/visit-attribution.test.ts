/**
 * Visit Attribution Tests (2026-04-10)
 *
 * Validates visitId write path, constraint enforcement, and output shapes.
 *
 * V1. visit-originated entry (via recordJobStatus) writes visitId
 * V2. task_work entry with visitId rejected by DB constraint
 * V3. manual entry without visitId remains valid
 * V4. getJobTimeSummary includes visitId and sourceType
 * V5. deriveSourceType classifies correctly
 * V6. transition mode visit entry writes visitId
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../server/db";
import {
  tasks,
  timeEntries,
  companies,
  users,
  jobs,
  jobVisits,
  clientLocations,
  customerCompanies,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { timeTrackingRepository } from "../server/storage/timeTracking";
import { v4 as uuidv4 } from "uuid";

const TEST_PREFIX = "visit_attr_test_";
let companyId: string;
let userId: string;
let jobId: string;
let visitId: string;
let locationId: string;
let customerCompanyId: string;

beforeAll(async () => {
  companyId = uuidv4();
  await db.insert(companies).values({ id: companyId, name: `${TEST_PREFIX}company` });

  userId = uuidv4();
  await db.insert(users).values({
    id: userId,
    companyId,
    email: `${TEST_PREFIX}tech@test.com`,
    fullName: `${TEST_PREFIX}Tech`,
    username: `${TEST_PREFIX}tech`,
    password: "test",
    passwordHash: "test",
    role: "technician",
    isSchedulable: true,
  });

  customerCompanyId = uuidv4();
  await db.insert(customerCompanies).values({ id: customerCompanyId, companyId, name: `${TEST_PREFIX}customer` });

  locationId = uuidv4();
  await db.insert(clientLocations).values({ id: locationId, companyId, companyName: `${TEST_PREFIX}loc`, customerCompanyId, selectedMonths: [] });

  jobId = uuidv4();
  await db.insert(jobs).values({ id: jobId, companyId, locationId, summary: `${TEST_PREFIX}job`, status: "open", jobType: "Repair", jobNumber: 6666 });

  visitId = uuidv4();
  await db.insert(jobVisits).values({
    id: visitId,
    companyId,
    jobId,
    visitNumber: 1,
    status: "in_progress",
    assignedTechnicianId: userId,
    scheduledDate: new Date(),
  });
});

afterAll(async () => {
  await db.delete(timeEntries).where(eq(timeEntries.companyId, companyId));
  await db.delete(jobVisits).where(eq(jobVisits.companyId, companyId));
  await db.delete(jobs).where(eq(jobs.companyId, companyId));
  await db.delete(clientLocations).where(eq(clientLocations.companyId, companyId));
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, companyId));
  await db.delete(users).where(eq(users.companyId, companyId));
  await db.delete(companies).where(eq(companies.id, companyId));
});

beforeEach(async () => {
  await db.delete(timeEntries).where(eq(timeEntries.companyId, companyId));
});

describe("Visit Attribution", () => {
  it("V1. recordJobStatus writes visitId on visit-originated entry", async () => {
    const { timeEntry } = await timeTrackingRepository.recordJobStatus(companyId, userId, jobId, {
      status: "arrived",
      visitId,
      notes: "test arrival",
      source: "mobile",
    });

    expect(timeEntry).toBeDefined();
    expect(timeEntry!.visitId).toBe(visitId);
    expect(timeEntry!.jobId).toBe(jobId);
    expect(timeEntry!.type).toBe("on_site");
  });

  it("V2. DB rejects task_work entry with visitId", async () => {
    const taskId = uuidv4();
    // Insert a minimal task first
    await db.insert(tasks).values({
      id: taskId,
      companyId,
      createdByUserId: userId,
      type: "GENERAL",
      title: `${TEST_PREFIX}dummy_task`,
    });

    await expect(
      db.insert(timeEntries).values({
        companyId,
        technicianId: userId,
        type: "task_work",
        startAt: new Date(),
        billable: false,
        taskId,
        visitId, // violates: task_work MUST NOT have visit_id
      })
    ).rejects.toThrow(/type_attribution_isolation|check constraint/i);

    await db.delete(tasks).where(eq(tasks.id, taskId));
  });

  it("V3. manual entry without visitId remains valid", async () => {
    const entry = await timeTrackingRepository.startTimeEntry(companyId, userId, {
      type: "admin",
      // no visitId, no jobId, no taskId — pure manual
    });

    expect(entry.visitId).toBeNull();
    expect(entry.jobId).toBeNull();
    expect(entry.taskId).toBeNull();
    expect(entry.type).toBe("admin");

    await timeTrackingRepository.stopTimeEntry(companyId, userId);
  });

  it("V4. getJobTimeSummary includes visitId and sourceType", async () => {
    // Create a visit-originated entry
    await timeTrackingRepository.recordJobStatus(companyId, userId, jobId, {
      status: "arrived",
      visitId,
      source: "mobile",
    });
    // Stop it
    await timeTrackingRepository.stopTimeEntry(companyId, userId);

    const summary = await timeTrackingRepository.getJobTimeSummary(companyId, jobId);
    expect(summary.entries.length).toBeGreaterThan(0);

    const visitEntry = summary.entries.find(e => e.visitId === visitId);
    expect(visitEntry).toBeDefined();
    expect(visitEntry!.sourceType).toBe("visit");
    expect(visitEntry!.visitId).toBe(visitId);
  });

  it("V5. sourceType correctly classifies entries", async () => {
    await db.delete(timeEntries).where(eq(timeEntries.companyId, companyId));

    // Insert two completed entries directly to test output classification
    // without triggering the overlap guard
    const manualId = uuidv4();
    const visitEntryId = uuidv4();

    await db.insert(timeEntries).values({
      id: manualId,
      companyId,
      technicianId: userId,
      type: "on_site",
      jobId,
      startAt: new Date("2026-04-09T08:00:00.000Z"),
      endAt: new Date("2026-04-09T09:00:00.000Z"),
      durationMinutes: 60,
      billable: true,
      // no visitId — manual context
    });

    await db.insert(timeEntries).values({
      id: visitEntryId,
      companyId,
      technicianId: userId,
      type: "on_site",
      jobId,
      visitId, // visit-originated
      startAt: new Date("2026-04-09T10:00:00.000Z"),
      endAt: new Date("2026-04-09T11:00:00.000Z"),
      durationMinutes: 60,
      billable: true,
    });

    const summary = await timeTrackingRepository.getJobTimeSummary(companyId, jobId);

    const manualResult = summary.entries.find(e => e.id === manualId);
    const visitResult = summary.entries.find(e => e.id === visitEntryId);

    expect(manualResult).toBeDefined();
    expect(manualResult!.sourceType).toBe("manual");
    expect(visitResult).toBeDefined();
    expect(visitResult!.sourceType).toBe("visit");
  });

  it("V6. transition mode writes visitId through travel→on_site", async () => {
    await db.delete(timeEntries).where(eq(timeEntries.companyId, companyId));

    const travelStart = new Date(Date.now() - 60_000 * 15); // 15 min ago
    const arrivalTime = new Date(Date.now() - 60_000 * 5);  // 5 min ago

    // Start travel via recordJobStatus
    const { timeEntry: travel } = await timeTrackingRepository.recordJobStatus(companyId, userId, jobId, {
      status: "en_route",
      visitId,
      source: "mobile",
      at: travelStart,
    });
    expect(travel!.visitId).toBe(visitId);
    expect(travel!.type).toBe("travel_to_job");

    // Transition to arrived (on_site) — same visit, 10min later so travel is not trivial
    const { timeEntry: onSite } = await timeTrackingRepository.recordJobStatus(companyId, userId, jobId, {
      status: "arrived",
      visitId,
      source: "mobile",
      at: arrivalTime,
    });
    expect(onSite!.visitId).toBe(visitId);
    expect(onSite!.type).toBe("on_site");

    // Travel entry should be stopped (not discarded — 10min duration), with visitId
    const [travelRow] = await db.select().from(timeEntries).where(eq(timeEntries.id, travel!.id));
    expect(travelRow).toBeDefined();
    expect(travelRow.visitId).toBe(visitId);
    expect(travelRow.endAt).not.toBeNull();
  });
});
