/**
 * Timer Integrity Tests (2026-04-10)
 *
 * Validates canonical timer integrity:
 *   T1. Editing running task notes does not stop active timer
 *   T2. Starting same task twice is idempotent (returns current state)
 *   T3. Starting second task while first is active is rejected (409)
 *   T4. Starting visit while task is active is rejected (strict mode)
 *   T5. Starting task while visit is active is rejected
 *   T6. Done/stop explicitly ends timer
 *   T7. No duplicate active time entries per technician
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../server/db";
import {
  tasks,
  timeEntries,
  companies,
  users,
  jobs,
  clientLocations,
  customerCompanies,
} from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { taskRepository, createTechTask } from "../server/storage/tasks";
import { timeTrackingRepository } from "../server/storage/timeTracking";
import { startTaskTimer, stopTaskTimer } from "../server/services/taskTimerService";
import { v4 as uuidv4 } from "uuid";

const TEST_PREFIX = "timer_integ_test_";
let companyId: string;
let userId: string;
let jobId: string;

beforeAll(async () => {
  companyId = uuidv4();
  await db.insert(companies).values({ id: companyId, name: `${TEST_PREFIX}company` });
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
  await db.insert(jobs).values({ id: jobId, companyId, locationId: locId, summary: `${TEST_PREFIX}job`, status: "open", jobType: "Repair", jobNumber: 5555 });
});

afterAll(async () => {
  await db.delete(timeEntries).where(eq(timeEntries.companyId, companyId));
  await db.delete(tasks).where(eq(tasks.companyId, companyId));
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

describe("Timer Integrity", () => {
  it("T1. editing running task notes does not stop active timer", async () => {
    const task = await createTechTask(companyId, userId, {
      type: "GENERAL", title: `${TEST_PREFIX}edit_test`,
    });

    // Start timer
    const { timeEntry } = await startTaskTimer(companyId, task.id, userId);
    expect(timeEntry.endAt).toBeNull();

    // Edit task metadata (simulates admin editing notes)
    await taskRepository.updateTask(companyId, task.id, { notes: "Updated note" });

    // Timer must still be running
    const running = await timeTrackingRepository.getRunningTimeEntry(companyId, userId);
    expect(running).not.toBeNull();
    expect(running!.id).toBe(timeEntry.id);
    expect(running!.endAt).toBeNull();
  });

  it("T2. starting same task twice is idempotent", async () => {
    const task = await createTechTask(companyId, userId, {
      type: "GENERAL", title: `${TEST_PREFIX}idempotent`,
    });

    const first = await startTaskTimer(companyId, task.id, userId);
    const second = await startTaskTimer(companyId, task.id, userId);

    // Same time entry returned
    expect(second.timeEntry.id).toBe(first.timeEntry.id);

    // Only one running entry exists
    const allRunning = await db.select().from(timeEntries)
      .where(and(eq(timeEntries.companyId, companyId), eq(timeEntries.technicianId, userId), isNull(timeEntries.endAt)));
    expect(allRunning.length).toBe(1);
  });

  it("T3. starting second task while first is active is rejected", async () => {
    const task1 = await createTechTask(companyId, userId, {
      type: "GENERAL", title: `${TEST_PREFIX}task1`,
    });
    const task2 = await createTechTask(companyId, userId, {
      type: "GENERAL", title: `${TEST_PREFIX}task2`,
    });

    await startTaskTimer(companyId, task1.id, userId);

    await expect(
      startTaskTimer(companyId, task2.id, userId)
    ).rejects.toThrow(/another timer is already running/i);
  });

  it("T4. starting visit while task is active is rejected (strict)", async () => {
    const task = await createTechTask(companyId, userId, {
      type: "GENERAL", title: `${TEST_PREFIX}blocking_visit`,
    });

    await startTaskTimer(companyId, task.id, userId);

    // Try to start a visit entry in strict mode
    await expect(
      timeTrackingRepository.startTimeEntry(companyId, userId, {
        type: "on_site", jobId, mode: "strict",
      })
    ).rejects.toThrow(/another timer is already running/i);
  });

  it("T5. starting task while visit is active is rejected", async () => {
    // Start visit timer
    await timeTrackingRepository.startTimeEntry(companyId, userId, {
      type: "on_site", jobId, mode: "transition",
    });

    const task = await createTechTask(companyId, userId, {
      type: "GENERAL", title: `${TEST_PREFIX}blocked_by_visit`,
    });

    await expect(
      startTaskTimer(companyId, task.id, userId)
    ).rejects.toThrow(/another timer is already running/i);
  });

  it("T6. done/stop explicitly ends timer", async () => {
    const task = await createTechTask(companyId, userId, {
      type: "GENERAL", title: `${TEST_PREFIX}stop_test`,
    });

    await startTaskTimer(companyId, task.id, userId);

    const { timeEntry } = await stopTaskTimer(companyId, task.id, userId);
    expect(timeEntry).not.toBeNull();
    expect(timeEntry!.endAt).not.toBeNull();

    // No running entries
    const running = await timeTrackingRepository.getRunningTimeEntry(companyId, userId);
    expect(running).toBeNull();
  });

  it("T7. no duplicate active time entries per technician", async () => {
    const task = await createTechTask(companyId, userId, {
      type: "GENERAL", title: `${TEST_PREFIX}no_dup`,
    });

    await startTaskTimer(companyId, task.id, userId);
    // Idempotent second start
    await startTaskTimer(companyId, task.id, userId);

    const allRunning = await db.select().from(timeEntries)
      .where(and(eq(timeEntries.companyId, companyId), eq(timeEntries.technicianId, userId), isNull(timeEntries.endAt)));
    expect(allRunning.length).toBe(1);
  });
});
