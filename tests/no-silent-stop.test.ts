/**
 * No Silent Stop Tests (2026-04-10)
 *
 * Validates that no timer start flow silently stops another timer.
 * All cross-context starts must be rejected with 409.
 *
 * NS1. Visit en_route while task running → 409, task timer preserved
 * NS2. Visit arrived while task running → 409, task timer preserved
 * NS3. Visit resumed while task running → 409, task timer preserved
 * NS4. Task start while visit running → 409, visit timer preserved
 * NS5. Visit en_route is idempotent (same visit travel already running)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../server/db";
import {
  tasks, timeEntries, companies, users, jobs, jobVisits,
  clientLocations, customerCompanies,
} from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { createTechTask } from "../server/storage/tasks";
import { timeTrackingRepository } from "../server/storage/timeTracking";
import { startTaskTimer } from "../server/services/taskTimerService";
import { v4 as uuidv4 } from "uuid";

const TEST_PREFIX = "no_silent_stop_";
let companyId: string;
let userId: string;
let jobId: string;
let visitId: string;

beforeAll(async () => {
  companyId = uuidv4();
  await db.insert(companies).values({ id: companyId, name: `${TEST_PREFIX}co` });
  userId = uuidv4();
  await db.insert(users).values({
    id: userId, companyId, email: `${TEST_PREFIX}@test.com`,
    fullName: `${TEST_PREFIX}Tech`, username: `${TEST_PREFIX}tech`,
    password: "test", passwordHash: "test", role: "technician", isSchedulable: true,
  });
  const ccId = uuidv4();
  await db.insert(customerCompanies).values({ id: ccId, companyId, name: `${TEST_PREFIX}cc` });
  const locId = uuidv4();
  await db.insert(clientLocations).values({ id: locId, companyId, customerCompanyId: ccId, selectedMonths: [] });
  jobId = uuidv4();
  await db.insert(jobs).values({ id: jobId, companyId, locationId: locId, summary: `${TEST_PREFIX}job`, status: "open", jobType: "Repair", jobNumber: 4444 });
  visitId = uuidv4();
  await db.insert(jobVisits).values({ id: visitId, companyId, jobId, visitNumber: 1, status: "scheduled", assignedTechnicianIds: [userId], scheduledDate: new Date() });
});

afterAll(async () => {
  await db.delete(timeEntries).where(eq(timeEntries.companyId, companyId));
  await db.delete(tasks).where(eq(tasks.companyId, companyId));
  await db.delete(jobVisits).where(eq(jobVisits.companyId, companyId));
  await db.delete(jobs).where(eq(jobs.companyId, companyId));
  await db.delete(clientLocations).where(eq(clientLocations.companyId, companyId));
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, companyId));
  await db.delete(users).where(eq(users.companyId, companyId));
  await db.delete(companies).where(eq(companies.id, companyId));
});

beforeEach(async () => {
  await db.delete(timeEntries).where(eq(timeEntries.companyId, companyId));
  await db.delete(tasks).where(eq(tasks.companyId, companyId));
});

describe("No Silent Stop", () => {
  it("NS1. visit en_route while task running → 409, task timer preserved", async () => {
    const task = await createTechTask(companyId, userId, { type: "GENERAL", title: `${TEST_PREFIX}t1` });
    const { timeEntry: taskEntry } = await startTaskTimer(companyId, task.id, userId);

    await expect(
      timeTrackingRepository.recordJobStatus(companyId, userId, jobId, {
        status: "en_route", visitId, source: "mobile",
      })
    ).rejects.toThrow(/another timer is already running|Cannot start/i);

    // Task timer must still be running
    const running = await timeTrackingRepository.getRunningTimeEntry(companyId, userId);
    expect(running).not.toBeNull();
    expect(running!.id).toBe(taskEntry.id);
    expect(running!.taskId).toBe(task.id);
  });

  it("NS2. visit arrived while task running → 409, task timer preserved", async () => {
    const task = await createTechTask(companyId, userId, { type: "GENERAL", title: `${TEST_PREFIX}t2` });
    const { timeEntry: taskEntry } = await startTaskTimer(companyId, task.id, userId);

    await expect(
      timeTrackingRepository.recordJobStatus(companyId, userId, jobId, {
        status: "arrived", visitId, source: "mobile",
      })
    ).rejects.toThrow(/another timer is already running|task entry|Cannot start/i);

    const running = await timeTrackingRepository.getRunningTimeEntry(companyId, userId);
    expect(running!.id).toBe(taskEntry.id);
  });

  it("NS3. visit resumed while task running → 409, task timer preserved", async () => {
    const task = await createTechTask(companyId, userId, { type: "GENERAL", title: `${TEST_PREFIX}t3` });
    const { timeEntry: taskEntry } = await startTaskTimer(companyId, task.id, userId);

    await expect(
      timeTrackingRepository.recordJobStatus(companyId, userId, jobId, {
        status: "resumed", visitId, source: "mobile",
      })
    ).rejects.toThrow(/another timer is already running|Cannot start/i);

    const running = await timeTrackingRepository.getRunningTimeEntry(companyId, userId);
    expect(running!.id).toBe(taskEntry.id);
  });

  it("NS4. task start while visit running → 409, visit timer preserved", async () => {
    // Start visit timer via strict en_route (no existing timer)
    await timeTrackingRepository.recordJobStatus(companyId, userId, jobId, {
      status: "en_route", visitId, source: "mobile",
    });
    const visitEntry = await timeTrackingRepository.getRunningTimeEntry(companyId, userId);
    expect(visitEntry).not.toBeNull();

    const task = await createTechTask(companyId, userId, { type: "GENERAL", title: `${TEST_PREFIX}t4` });

    await expect(
      startTaskTimer(companyId, task.id, userId)
    ).rejects.toThrow(/another timer is already running/i);

    // Visit timer preserved
    const running = await timeTrackingRepository.getRunningTimeEntry(companyId, userId);
    expect(running!.id).toBe(visitEntry!.id);
  });

  it("NS5. valid visit transition travel→on_site still works", async () => {
    // Start travel
    const { timeEntry: travel } = await timeTrackingRepository.recordJobStatus(companyId, userId, jobId, {
      status: "en_route", visitId, source: "mobile",
    });
    expect(travel!.type).toBe("travel_to_job");

    // Arrive (transition mode — same job, travel→on_site is valid)
    const { timeEntry: onSite } = await timeTrackingRepository.recordJobStatus(companyId, userId, jobId, {
      status: "arrived", visitId, source: "mobile",
    });
    expect(onSite!.type).toBe("on_site");

    // Travel was stopped, on_site is running
    const [travelAfter] = await db.select().from(timeEntries).where(eq(timeEntries.id, travel!.id));
    expect(travelAfter.endAt).not.toBeNull();
    const running = await timeTrackingRepository.getRunningTimeEntry(companyId, userId);
    expect(running!.id).toBe(onSite!.id);
  });
});
