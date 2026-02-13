/**
 * PM Current-Month Generation Tests
 *
 * Validates the month-keyed PM generation function (generatePmForCurrentMonth)
 * that fixes the bug where "Generate This Month" produces 0 jobs mid-month
 * for period_start schedules.
 *
 * Test scenarios:
 * 1) Mid-month generation: template with period_start, current month included,
 *    today is mid-month → must create 1 job with recurrence_instance_date = 1st of month
 * 2) Soft-delete recovery: delete the job, generate again → must create new job
 * 3) New template after delete: remove schedule, recreate, generate → must create 1 job
 * 4) Idempotency: second call in same month → returns 0 with existing job reference
 * 5) Month exclusion: current month NOT in monthsOfYear → returns 0 with MONTH_EXCLUDED
 * 6) Mid-month template creation: startDate = today (mid-month), period_start →
 *    must still create job with instance_date = 1st of month
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import {
  jobs,
  companies,
  users,
  clientLocations,
  customerCompanies,
  recurringJobTemplates,
  recurringJobInstances,
} from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { generatePmForCurrentMonth } from "../server/domain/recurrence";
import { jobRepository } from "../server/storage/jobs";
import { v4 as uuidv4 } from "uuid";

const TEST_PREFIX = "pm_curmonth_test_";
let companyId: string;
let userId: string;
let customerCompanyId: string;
let locationId: string;
const createdTemplateIds: string[] = [];

/** Current month (1-indexed) and monthKey (YYYY-MM-01) */
const now = new Date();
const currentMonth = now.getMonth() + 1;
const monthKey = `${now.getFullYear()}-${String(currentMonth).padStart(2, "0")}-01`;

async function createFixtures() {
  companyId = uuidv4();
  await db.insert(companies).values({
    id: companyId,
    name: `${TEST_PREFIX}company`,
  });

  userId = uuidv4();
  await db.insert(users).values({
    id: userId,
    companyId,
    email: `${TEST_PREFIX}${Date.now()}@test.com`,
    password: "test_password_hash",
    role: "dispatcher",
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
}

async function cleanupFixtures() {
  if (createdTemplateIds.length > 0) {
    await db
      .delete(recurringJobInstances)
      .where(inArray(recurringJobInstances.templateId, createdTemplateIds));
  }
  if (companyId) {
    await db.delete(jobs).where(eq(jobs.companyId, companyId));
  }
  if (createdTemplateIds.length > 0) {
    await db
      .delete(recurringJobTemplates)
      .where(inArray(recurringJobTemplates.id, createdTemplateIds));
  }
  if (locationId) {
    await db.delete(clientLocations).where(eq(clientLocations.id, locationId));
  }
  if (customerCompanyId) {
    await db.delete(customerCompanies).where(eq(customerCompanies.id, customerCompanyId));
  }
  if (userId) {
    await db.delete(users).where(eq(users.id, userId));
  }
  if (companyId) {
    await db.delete(companies).where(eq(companies.id, companyId));
  }
}

/** Helper: create a PM template with period_start mode including current month */
async function createPmTemplate(overrides: Record<string, unknown> = {}): Promise<string> {
  const templateId = uuidv4();
  createdTemplateIds.push(templateId);

  await db.insert(recurringJobTemplates).values({
    id: templateId,
    companyId,
    locationId,
    title: `${TEST_PREFIX}pm_job`,
    startDate: "2026-01-01", // Well before current month
    recurrenceKind: "monthly",
    interval: 1,
    jobType: "maintenance",
    generationMode: "period_start",
    monthsOfYear: [currentMonth],
    isActive: true,
    ...overrides,
  });

  return templateId;
}

describe("PM Current-Month Generation (generatePmForCurrentMonth)", () => {
  beforeAll(async () => {
    await createFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  // ==========================================================================
  // Test 1: Mid-month generation creates 1 job with correct instance date
  // ==========================================================================
  it("creates 1 job mid-month with recurrence_instance_date = 1st of month", async () => {
    const templateId = await createPmTemplate();

    const result = await generatePmForCurrentMonth(companyId, templateId);

    expect(result.createdCount).toBe(1);
    expect(result.reason).toBe("CREATED");
    expect(result.monthKey).toBe(monthKey);
    expect(result.existingJob).toBeDefined();
    expect(result.existingJob!.id).toBeTruthy();
    expect(result.existingJob!.jobNumber).toBeGreaterThan(0);

    // Verify the job in the database
    const [createdJob] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, result.existingJob!.id))
      .limit(1);

    expect(createdJob).toBeDefined();
    expect(createdJob.recurrenceTemplateId).toBe(templateId);
    expect(createdJob.recurrenceInstanceDate).toBe(monthKey);
    expect(createdJob.status).toBe("open");
    expect(createdJob.jobType).toBe("maintenance");
    expect(createdJob.isActive).toBe(true);
    expect(createdJob.deletedAt).toBeNull();
  });

  // ==========================================================================
  // Test 2: Soft-delete recovery — delete job, generate again creates new job
  // ==========================================================================
  it("creates new job after soft-deleting the previous one (RECOVERED_INSTANCE)", async () => {
    const templateId = await createPmTemplate({
      title: `${TEST_PREFIX}pm_recovery`,
    });

    // First generation
    const first = await generatePmForCurrentMonth(companyId, templateId);
    expect(first.createdCount).toBe(1);
    const firstJobId = first.existingJob!.id;

    // Soft-delete the job
    await jobRepository.deleteJob(companyId, firstJobId);

    // Verify job is soft-deleted
    const [deleted] = await db
      .select({ deletedAt: jobs.deletedAt, isActive: jobs.isActive })
      .from(jobs)
      .where(eq(jobs.id, firstJobId))
      .limit(1);
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.isActive).toBe(false);

    // Generate again — should recover the instance and create a new job
    const second = await generatePmForCurrentMonth(companyId, templateId);
    expect(second.createdCount).toBe(1);
    expect(second.reason).toBe("RECOVERED_INSTANCE");
    expect(second.existingJob!.id).not.toBe(firstJobId); // Different job
    expect(second.monthKey).toBe(monthKey);

    // Verify new job exists and is active
    const [newJob] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, second.existingJob!.id))
      .limit(1);
    expect(newJob.isActive).toBe(true);
    expect(newJob.deletedAt).toBeNull();
    expect(newJob.recurrenceInstanceDate).toBe(monthKey);
  });

  // ==========================================================================
  // Test 3: New template after old one deleted — generates 1 job
  // ==========================================================================
  it("creates 1 job for a fresh template (no prior instances)", async () => {
    // Create first template
    const oldTemplateId = await createPmTemplate({
      title: `${TEST_PREFIX}pm_old_template`,
    });

    // Generate for old template
    const oldResult = await generatePmForCurrentMonth(companyId, oldTemplateId);
    expect(oldResult.createdCount).toBe(1);

    // "Delete" old template (deactivate)
    await db
      .update(recurringJobTemplates)
      .set({ isActive: false })
      .where(eq(recurringJobTemplates.id, oldTemplateId));

    // Create new template (different ID, same location)
    const newTemplateId = await createPmTemplate({
      title: `${TEST_PREFIX}pm_new_template`,
    });

    // Generate for new template — must create 1 job (no "0 created")
    const newResult = await generatePmForCurrentMonth(companyId, newTemplateId);
    expect(newResult.createdCount).toBe(1);
    expect(newResult.reason).toBe("CREATED");
    expect(newResult.existingJob!.id).toBeTruthy();
  });

  // ==========================================================================
  // Test 4: Idempotency — second call returns 0 with existing job reference
  // ==========================================================================
  it("returns 0 with EXISTS reason on duplicate call in same month", async () => {
    const templateId = await createPmTemplate({
      title: `${TEST_PREFIX}pm_idempotent`,
    });

    // First call creates
    const first = await generatePmForCurrentMonth(companyId, templateId);
    expect(first.createdCount).toBe(1);
    expect(first.reason).toBe("CREATED");

    // Second call is idempotent
    const second = await generatePmForCurrentMonth(companyId, templateId);
    expect(second.createdCount).toBe(0);
    expect(second.reason).toBe("EXISTS");
    expect(second.existingJob).toBeDefined();
    expect(second.existingJob!.id).toBe(first.existingJob!.id);
    expect(second.existingJob!.jobNumber).toBe(first.existingJob!.jobNumber);
    expect(second.monthKey).toBe(monthKey);
  });

  // ==========================================================================
  // Test 5: Month exclusion — current month not in schedule
  // ==========================================================================
  it("returns 0 with MONTH_EXCLUDED when current month not in schedule", async () => {
    // Pick a month that is NOT the current month
    const excludedMonth = currentMonth === 12 ? 1 : currentMonth + 1;
    const templateId = await createPmTemplate({
      title: `${TEST_PREFIX}pm_excluded`,
      monthsOfYear: [excludedMonth],
    });

    const result = await generatePmForCurrentMonth(companyId, templateId);
    expect(result.createdCount).toBe(0);
    expect(result.reason).toBe("MONTH_EXCLUDED");
    expect(result.monthKey).toBe(monthKey);
  });

  // ==========================================================================
  // Test 6: Mid-month template creation — startDate = today still works
  // ==========================================================================
  it("creates job even when template startDate is today (mid-month)", async () => {
    // This was the original bug: template created today (e.g., Feb 11),
    // period_start occurrence is Feb 1, which is before startDate → filtered out.
    // generatePmForCurrentMonth bypasses this by not checking startDate at day-level.
    const todayStr = now.toISOString().split("T")[0];

    const templateId = await createPmTemplate({
      title: `${TEST_PREFIX}pm_midmonth_start`,
      startDate: todayStr, // Created today, mid-month
    });

    const result = await generatePmForCurrentMonth(companyId, templateId);
    expect(result.createdCount).toBe(1);
    expect(result.reason).toBe("CREATED");
    expect(result.monthKey).toBe(monthKey);

    // Verify instance date is 1st of month, not today
    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, result.existingJob!.id))
      .limit(1);
    expect(job.recurrenceInstanceDate).toBe(monthKey);
  });

  // ==========================================================================
  // Test 7: Response shape always includes reason, monthKey, createdCount
  // ==========================================================================
  it("pmResult always includes reason, monthKey, createdCount keys", async () => {
    // Test CREATED shape
    const templateA = await createPmTemplate({
      title: `${TEST_PREFIX}pm_shape_created`,
    });
    const created = await generatePmForCurrentMonth(companyId, templateA);
    expect(created).toHaveProperty("reason");
    expect(created).toHaveProperty("monthKey");
    expect(created).toHaveProperty("createdCount");
    expect(typeof created.reason).toBe("string");
    expect(typeof created.monthKey).toBe("string");
    expect(typeof created.createdCount).toBe("number");
    expect(created.reason).toBe("CREATED");

    // Test EXISTS shape (second call)
    const exists = await generatePmForCurrentMonth(companyId, templateA);
    expect(exists).toHaveProperty("reason");
    expect(exists).toHaveProperty("monthKey");
    expect(exists).toHaveProperty("createdCount");
    expect(exists.reason).toBe("EXISTS");
    expect(exists.createdCount).toBe(0);
    expect(exists.existingJob).toBeDefined();

    // Test MONTH_EXCLUDED shape
    const excludedMonth = currentMonth === 12 ? 1 : currentMonth + 1;
    const templateB = await createPmTemplate({
      title: `${TEST_PREFIX}pm_shape_excluded`,
      monthsOfYear: [excludedMonth],
    });
    const excluded = await generatePmForCurrentMonth(companyId, templateB);
    expect(excluded).toHaveProperty("reason");
    expect(excluded).toHaveProperty("monthKey");
    expect(excluded).toHaveProperty("createdCount");
    expect(excluded.reason).toBe("MONTH_EXCLUDED");
    expect(excluded.createdCount).toBe(0);
  });

  // ==========================================================================
  // Test 8: Inactive template throws error
  // ==========================================================================
  it("throws error for inactive template", async () => {
    const templateId = await createPmTemplate({
      title: `${TEST_PREFIX}pm_inactive`,
      isActive: false,
    });

    await expect(
      generatePmForCurrentMonth(companyId, templateId)
    ).rejects.toThrow("Template is not active");
  });

  // ==========================================================================
  // Test 9: Non-PM template throws error
  // ==========================================================================
  it("throws error for non-PM template (no monthsOfYear)", async () => {
    const templateId = uuidv4();
    createdTemplateIds.push(templateId);

    await db.insert(recurringJobTemplates).values({
      id: templateId,
      companyId,
      locationId,
      title: `${TEST_PREFIX}non_pm`,
      startDate: "2026-01-01",
      recurrenceKind: "weekly",
      interval: 1,
      daysOfWeek: [1],
      jobType: "repair",
      monthsOfYear: null,
      isActive: true,
    });

    await expect(
      generatePmForCurrentMonth(companyId, templateId)
    ).rejects.toThrow("not a PM template");
  });
});
