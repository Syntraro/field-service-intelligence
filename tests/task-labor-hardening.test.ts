/**
 * Task Labor Hardening Tests (2026-04-10)
 *
 * Validates timer enforcement, attribution integrity, and close consistency.
 *
 * Locks:
 *   H1. Cannot start task if visit timer running (strict mode → 409)
 *   H2. Cannot start visit-context entry if task timer running (strict mode → 409)
 *   H3. Stopping task does NOT stop visit timer (targeted stop → 409)
 *   H4. Task start via service is atomic (status + entry)
 *   H5. Visit transition mode allows auto-stop (travel → on_site)
 *   H6. task_work without taskId rejected by DB constraint
 *   H7. Cannot complete task with active timer (closeTask guard)
 *   H8. Cannot complete task via updateTask with active timer
 *   H9. Cannot change jobId on task with existing labor entries
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
import { eq, and } from "drizzle-orm";
import { taskRepository, createTechTask } from "../server/storage/tasks";
import { timeTrackingRepository } from "../server/storage/timeTracking";
import { startTaskTimer, stopTaskTimer } from "../server/services/taskTimerService";
import { v4 as uuidv4 } from "uuid";

const TEST_PREFIX = "hardening_test_";
let companyId: string;
let userId: string;
let jobId: string;
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
  await db.insert(jobs).values({ id: jobId, companyId, locationId, summary: `${TEST_PREFIX}job`, status: "open", jobType: "Repair", jobNumber: 8888 });
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
  // Clean slate for every test — no leftover timers or entries
  await db.delete(timeEntries).where(eq(timeEntries.companyId, companyId));
  await db.delete(tasks).where(eq(tasks.companyId, companyId));
});

describe("Task Labor Hardening", () => {
  // ── H1: Cannot start task if visit timer running ──

  it("H1. strict mode blocks task start when visit timer is running", async () => {
    // Start a visit-type timer
    await timeTrackingRepository.startTimeEntry(companyId, userId, {
      type: "on_site",
      jobId,
      mode: "transition", // simulate visit lifecycle
    });

    // Try to start a task timer — should throw 409
    const task = await createTechTask(companyId, userId, {
      type: "GENERAL",
      title: `${TEST_PREFIX}blocked_by_visit`,
    });

    await expect(
      startTaskTimer(companyId, task.id, userId)
    ).rejects.toThrow(/another timer is already running/i);
  });

  // ── H2: Cannot start visit-context entry if task timer running (strict mode) ──

  it("H2. strict mode blocks manual entry when task timer is running", async () => {
    const task = await createTechTask(companyId, userId, {
      type: "GENERAL",
      title: `${TEST_PREFIX}blocking_manual`,
    });

    await startTaskTimer(companyId, task.id, userId);

    // Try to start a manual time entry (office route uses strict by default)
    await expect(
      timeTrackingRepository.startTimeEntry(companyId, userId, {
        type: "on_site",
        jobId,
        // mode defaults to "strict"
      })
    ).rejects.toThrow(/another timer is already running/i);
  });

  // ── H3: Stopping task does NOT stop visit timer ──

  it("H3. stopTaskTimer rejects when running entry belongs to different context", async () => {
    // Start a visit timer
    await timeTrackingRepository.startTimeEntry(companyId, userId, {
      type: "on_site",
      jobId,
      mode: "transition",
    });

    // Create a task and try to stop "its" timer — but the running entry is a visit
    const task = await createTechTask(companyId, userId, {
      type: "GENERAL",
      title: `${TEST_PREFIX}wrong_context`,
    });

    await expect(
      stopTaskTimer(companyId, task.id, userId)
    ).rejects.toThrow(/running timer belongs to/i);

    // Visit timer must still be running
    const running = await timeTrackingRepository.getRunningTimeEntry(companyId, userId);
    expect(running).not.toBeNull();
    expect(running!.type).toBe("on_site");
  });

  // ── H4: Task start is atomic ──

  it("H4. startTaskTimer creates entry and transitions status atomically", async () => {
    const task = await createTechTask(companyId, userId, {
      type: "GENERAL",
      title: `${TEST_PREFIX}atomic`,
    });
    expect(task.status).toBe("pending");

    const { task: updated, timeEntry } = await startTaskTimer(companyId, task.id, userId);

    expect(updated.status).toBe("in_progress");
    expect(timeEntry.taskId).toBe(task.id);
    expect(timeEntry.type).toBe("task_work");
    expect(timeEntry.endAt).toBeNull();
  });

  // ── H5: Visit transition mode allows auto-stop ──

  it("H5. transition mode auto-stops within visit lifecycle", async () => {
    // Start travel_to_job
    const travel = await timeTrackingRepository.startTimeEntry(companyId, userId, {
      type: "travel_to_job",
      jobId,
      mode: "transition",
    });
    expect(travel.type).toBe("travel_to_job");

    // Transition to on_site (should auto-stop travel)
    const onSite = await timeTrackingRepository.startTimeEntry(companyId, userId, {
      type: "on_site",
      jobId,
      mode: "transition",
    });

    // Verify travel was stopped
    const [travelAfter] = await db.select().from(timeEntries).where(eq(timeEntries.id, travel.id));
    expect(travelAfter.endAt).not.toBeNull();

    // on_site is running
    const running = await timeTrackingRepository.getRunningTimeEntry(companyId, userId);
    expect(running!.id).toBe(onSite.id);
  });

  // ── H6: DB constraint rejects task_work without taskId ──

  it("H6. DB rejects task_work entry without taskId", async () => {
    await expect(
      db.insert(timeEntries).values({
        companyId,
        technicianId: userId,
        type: "task_work",
        startAt: new Date(),
        billable: false,
        taskId: null, // violates CHECK constraint
      })
    ).rejects.toThrow(/task_work_requires_task_id|check constraint/i);
  });

  // ── H7: Cannot close task with active timer ──

  it("H7. closeTask rejects when active timer exists", async () => {
    const task = await createTechTask(companyId, userId, {
      type: "GENERAL",
      title: `${TEST_PREFIX}close_blocked`,
    });

    // Start timer
    await startTaskTimer(companyId, task.id, userId);

    // Try to close — should reject
    await expect(
      taskRepository.closeTask(companyId, task.id, userId)
    ).rejects.toThrow(/active timer/i);

    // Stop timer first, then close should succeed
    await stopTaskTimer(companyId, task.id, userId);
    const closed = await taskRepository.closeTask(companyId, task.id, userId);
    expect(closed.status).toBe("completed");
  });

  // ── H8: Cannot complete via updateTask with active timer ──

  it("H8. updateTask rejects completed status when timer running", async () => {
    const task = await createTechTask(companyId, userId, {
      type: "GENERAL",
      title: `${TEST_PREFIX}update_blocked`,
    });

    await startTaskTimer(companyId, task.id, userId);

    await expect(
      taskRepository.updateTask(companyId, task.id, { status: "completed" })
    ).rejects.toThrow(/active timer/i);
  });

  // ── H9: Cannot change jobId with existing labor ──

  it("H9. updateTask blocks jobId change when task has labor entries", async () => {
    const task = await taskRepository.createTask(companyId, {
      createdByUserId: userId,
      assignedToUserId: userId,
      type: "GENERAL",
      title: `${TEST_PREFIX}job_lock`,
      jobId,
    });

    // Create and stop a timer to generate a labor entry
    await startTaskTimer(companyId, task.id, userId);
    await stopTaskTimer(companyId, task.id, userId);

    // Try to change jobId — should reject
    const newJobId = uuidv4();
    await expect(
      taskRepository.updateTask(companyId, task.id, { jobId: newJobId })
    ).rejects.toThrow(/existing labor entries/i);

    // Verify the original jobId is preserved
    const current = await taskRepository.getTask(companyId, task.id);
    expect(current!.jobId).toBe(jobId);
  });
});
