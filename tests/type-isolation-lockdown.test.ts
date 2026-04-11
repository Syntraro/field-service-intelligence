/**
 * Type Isolation Lockdown Tests (2026-04-10)
 *
 * Validates bidirectional type↔attribution constraints and transition guards.
 *
 * Locks:
 *   L1. cannot create on_site entry with task_id (DB constraint)
 *   L2. cannot create task_work entry without task_id (DB constraint)
 *   L3. transition mode rejects task_work → visit (transition guard)
 *   L4. transition mode rejects visit → unrelated-job visit (transition guard)
 *   L5. valid transition travel_to_job → on_site still works
 *   L6. getVisitContextFromEntry correctly classifies entries
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
import { eq } from "drizzle-orm";
import { timeTrackingRepository } from "../server/storage/timeTracking";
import { createTechTask } from "../server/storage/tasks";
import { startTaskTimer } from "../server/services/taskTimerService";
import { getVisitContextFromEntry, isVisitEntryType } from "../server/lib/visitEntryContext";
import { v4 as uuidv4 } from "uuid";

const TEST_PREFIX = "lockdown_test_";
let companyId: string;
let userId: string;
let jobId: string;
let jobId2: string;
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
  await db.insert(jobs).values({ id: jobId, companyId, locationId, summary: `${TEST_PREFIX}job1`, status: "open", jobType: "Repair", jobNumber: 7777 });

  jobId2 = uuidv4();
  await db.insert(jobs).values({ id: jobId2, companyId, locationId, summary: `${TEST_PREFIX}job2`, status: "open", jobType: "PM", jobNumber: 7778 });
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

describe("Type Isolation Lockdown", () => {
  // ── L1: non-task_work with task_id rejected ──

  it("L1. DB rejects on_site entry with task_id set", async () => {
    const task = await createTechTask(companyId, userId, {
      type: "GENERAL",
      title: `${TEST_PREFIX}hybrid`,
    });

    await expect(
      db.insert(timeEntries).values({
        companyId,
        technicianId: userId,
        type: "on_site",
        startAt: new Date(),
        billable: true,
        jobId,
        taskId: task.id, // violates: non-task_work MUST NOT have task_id
      })
    ).rejects.toThrow(/type_task_isolation|check constraint/i);
  });

  // ── L2: task_work without task_id rejected ──

  it("L2. DB rejects task_work entry without task_id", async () => {
    await expect(
      db.insert(timeEntries).values({
        companyId,
        technicianId: userId,
        type: "task_work",
        startAt: new Date(),
        billable: false,
        taskId: null, // violates: task_work MUST have task_id
      })
    ).rejects.toThrow(/type_task_isolation|check constraint/i);
  });

  // ── L3: transition mode rejects task_work → visit ──

  it("L3. transition mode rejects when running entry is task_work", async () => {
    const task = await createTechTask(companyId, userId, {
      type: "GENERAL",
      title: `${TEST_PREFIX}task_running`,
    });

    // Start a task timer (strict mode — no timer running)
    await startTaskTimer(companyId, task.id, userId);

    // Try to start a visit entry in transition mode — should reject
    await expect(
      timeTrackingRepository.startTimeEntry(companyId, userId, {
        type: "on_site",
        jobId,
        mode: "transition",
      })
    ).rejects.toThrow(/active timer is a task entry/i);
  });

  // ── L4: transition mode rejects cross-job visit ──

  it("L4. transition mode rejects visit → different-job visit", async () => {
    // Start travel_to_job for job1
    await timeTrackingRepository.startTimeEntry(companyId, userId, {
      type: "travel_to_job",
      jobId,
      mode: "transition",
    });

    // Try to transition to on_site for job2 — different job = reject
    await expect(
      timeTrackingRepository.startTimeEntry(companyId, userId, {
        type: "on_site",
        jobId: jobId2,
        mode: "transition",
      })
    ).rejects.toThrow(/active timer is for job/i);
  });

  // ── L5: valid transition works ──

  it("L5. transition travel_to_job → on_site (same job) succeeds", async () => {
    // Start travel
    const travel = await timeTrackingRepository.startTimeEntry(companyId, userId, {
      type: "travel_to_job",
      jobId,
      mode: "transition",
    });

    // Transition to on_site — same job, valid pair
    const onSite = await timeTrackingRepository.startTimeEntry(companyId, userId, {
      type: "on_site",
      jobId,
      mode: "transition",
    });

    expect(onSite.type).toBe("on_site");

    // travel was stopped
    const [travelAfter] = await db.select().from(timeEntries).where(eq(timeEntries.id, travel.id));
    expect(travelAfter.endAt).not.toBeNull();

    // on_site is running
    const running = await timeTrackingRepository.getRunningTimeEntry(companyId, userId);
    expect(running!.id).toBe(onSite.id);
  });

  // ── L6: visit context helper ──

  it("L6. getVisitContextFromEntry classifies correctly", () => {
    expect(getVisitContextFromEntry({ type: "on_site", jobId: "j1", taskId: null })).toEqual({
      isVisitEntry: true,
      isTaskEntry: false,
      jobId: "j1",
      taskId: null,
    });

    expect(getVisitContextFromEntry({ type: "task_work", jobId: "j1", taskId: "t1" })).toEqual({
      isVisitEntry: false,
      isTaskEntry: true,
      jobId: "j1",
      taskId: "t1",
    });

    expect(getVisitContextFromEntry({ type: "admin", jobId: null, taskId: null })).toEqual({
      isVisitEntry: false,
      isTaskEntry: false,
      jobId: null,
      taskId: null,
    });

    expect(getVisitContextFromEntry({ type: "travel_to_supplier", jobId: null, taskId: null })).toEqual({
      isVisitEntry: true,
      isTaskEntry: false,
      jobId: null,
      taskId: null,
    });

    expect(isVisitEntryType("on_site")).toBe(true);
    expect(isVisitEntryType("task_work")).toBe(false);
    expect(isVisitEntryType("break")).toBe(false);
  });
});
