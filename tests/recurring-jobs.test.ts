/**
 * Recurring Jobs Tests
 *
 * Validates:
 * 1) Weekly template generates correct instance dates and creates jobs without duplication
 * 2) Monthly template clamps day_of_month safely
 * 3) Generation is idempotent (running twice creates 0 new jobs second run)
 * 4) Generated jobs are unscheduled (scheduled_start NULL) and have valid backlog status
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
import {
  computeOccurrenceDates,
  generateInstances,
  recoverStaleClaims,
} from "../server/domain/recurrence";
import { recurringJobsRepository } from "../server/storage/recurringJobs";
import { v4 as uuidv4 } from "uuid";

// Test data IDs
const TEST_PREFIX = "recurring_test_";
let testCompanyId: string;
let testUserId: string;
let testCustomerCompanyId: string;
let testLocationId: string;
let createdTemplateIds: string[] = [];
let createdJobIds: string[] = [];

/**
 * Create test fixtures
 */
async function createTestFixtures() {
  // Create test company
  testCompanyId = uuidv4();
  await db.insert(companies).values({
    id: testCompanyId,
    name: `${TEST_PREFIX}company`,
  });

  // Create test user
  testUserId = uuidv4();
  await db.insert(users).values({
    id: testUserId,
    companyId: testCompanyId,
    email: `${TEST_PREFIX}${Date.now()}@test.com`,
    password: "test_password_hash",
    role: "technician",
    firstName: "Test",
    lastName: "Tech",
  });

  // Create test customer company
  testCustomerCompanyId = uuidv4();
  await db.insert(customerCompanies).values({
    id: testCustomerCompanyId,
    companyId: testCompanyId,
    name: `${TEST_PREFIX}customer`,
  });

  // Create test location
  testLocationId = uuidv4();
  await db.insert(clientLocations).values({
    id: testLocationId,
    companyId: testCompanyId,
    parentCompanyId: testCustomerCompanyId,
    companyName: `${TEST_PREFIX}location`,
    address: "123 Test St",
    selectedMonths: [],
  });
}

/**
 * Cleanup test fixtures
 */
async function cleanupTestFixtures() {
  // Clean up instances first (references templates)
  if (createdTemplateIds.length > 0) {
    await db
      .delete(recurringJobInstances)
      .where(inArray(recurringJobInstances.templateId, createdTemplateIds));
  }

  // Clean up all jobs for this company (they reference locations)
  if (testCompanyId) {
    await db.delete(jobs).where(eq(jobs.companyId, testCompanyId));
  }

  // Clean up templates
  if (createdTemplateIds.length > 0) {
    await db
      .delete(recurringJobTemplates)
      .where(inArray(recurringJobTemplates.id, createdTemplateIds));
  }

  // Clean up in reverse order of creation (due to foreign keys)
  if (testLocationId) {
    await db.delete(clientLocations).where(eq(clientLocations.id, testLocationId));
  }
  if (testCustomerCompanyId) {
    await db.delete(customerCompanies).where(eq(customerCompanies.id, testCustomerCompanyId));
  }
  if (testUserId) {
    await db.delete(users).where(eq(users.id, testUserId));
  }
  if (testCompanyId) {
    await db.delete(companies).where(eq(companies.id, testCompanyId));
  }
}

describe("Recurring Jobs Tests", () => {
  beforeAll(async () => {
    await createTestFixtures();
  });

  afterAll(async () => {
    await cleanupTestFixtures();
  });

  // ============================================================================
  // Test 1: Weekly template generates correct dates without duplication
  // ============================================================================
  it("Test 1: Weekly template generates correct instance dates", async () => {
    // Create a weekly template for Monday and Wednesday
    const templateId = uuidv4();
    createdTemplateIds.push(templateId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = today.toISOString().split("T")[0];

    await db.insert(recurringJobTemplates).values({
      id: templateId,
      companyId: testCompanyId,
      locationId: testLocationId,
      title: `${TEST_PREFIX}weekly_job`,
      startDate,
      recurrenceKind: "weekly",
      interval: 1,
      daysOfWeek: [1, 3], // Monday, Wednesday
      openSubStatusDefault: null, // Phase 2 Step 6: null = normal backlog job
      isActive: true,
    });

    // Generate for next 14 days
    const result = await generateInstances(testCompanyId, 14);

    expect(result.templatesProcessed).toBe(1);
    expect(result.errors.length).toBe(0);

    // Should have at least 2 instances per week (Mon, Wed) for 2 weeks = ~4 instances
    // Exact count depends on what day today is
    expect(result.instancesCreated).toBeGreaterThanOrEqual(2);
    expect(result.jobsCreated).toBeGreaterThanOrEqual(2);

    // Get created jobs
    const createdJobs = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.companyId, testCompanyId),
          eq(jobs.summary, `${TEST_PREFIX}weekly_job`)
        )
      );

    // Track for cleanup
    createdJobIds.push(...createdJobs.map((j) => j.id));

    // Verify jobs are unscheduled
    for (const job of createdJobs) {
      expect(job.scheduledStart).toBeNull();
      expect(job.scheduledEnd).toBeNull();
      expect(job.status).toBe("open");
    }

    // Run again - should create 0 new jobs (idempotent)
    const secondResult = await generateInstances(testCompanyId, 14);
    expect(secondResult.jobsCreated).toBe(0);
    expect(secondResult.instancesCreated).toBe(0);
  });

  // ============================================================================
  // Test 2: Monthly template clamps day_of_month safely
  // ============================================================================
  it("Test 2: Monthly template clamps day_of_month for short months", async () => {
    // Create a monthly template for day 31
    const templateId = uuidv4();
    createdTemplateIds.push(templateId);

    // Start from January 31 of current year
    const year = new Date().getFullYear();
    const startDate = `${year}-01-31`;

    await db.insert(recurringJobTemplates).values({
      id: templateId,
      companyId: testCompanyId,
      locationId: testLocationId,
      title: `${TEST_PREFIX}monthly_job`,
      startDate,
      recurrenceKind: "monthly",
      interval: 1,
      dayOfMonth: 31,
      openSubStatusDefault: null, // Phase 2 Step 6: null = normal backlog job
      isActive: true,
      preferredTechnicianId: testUserId,
    });

    // Compute occurrences for a 3-month window
    const template = await db
      .select()
      .from(recurringJobTemplates)
      .where(eq(recurringJobTemplates.id, templateId))
      .limit(1)
      .then((r) => r[0]);

    // Test date computation directly
    const windowStart = new Date(year, 0, 1); // Jan 1
    const windowEnd = new Date(year, 3, 30); // Apr 30

    const occurrences = computeOccurrenceDates(template, windowStart, windowEnd);

    // Should have occurrences for Jan 31, Feb 28/29, Mar 31
    expect(occurrences.length).toBeGreaterThanOrEqual(3);

    // February should be clamped to 28 or 29
    const febOccurrence = occurrences.find(
      (d) => d.getMonth() === 1 // February
    );
    if (febOccurrence) {
      const febDay = febOccurrence.getDate();
      expect(febDay).toBeLessThanOrEqual(29);
    }
  });

  // ============================================================================
  // Test 3: Generation is idempotent
  // ============================================================================
  it("Test 3: Running generation twice creates 0 new jobs on second run", async () => {
    // Create a simple weekly template
    const templateId = uuidv4();
    createdTemplateIds.push(templateId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = today.toISOString().split("T")[0];

    await db.insert(recurringJobTemplates).values({
      id: templateId,
      companyId: testCompanyId,
      locationId: testLocationId,
      title: `${TEST_PREFIX}idempotent_job`,
      startDate,
      recurrenceKind: "weekly",
      interval: 1,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6], // Every day
      openSubStatusDefault: null, // Phase 2 Step 6: null = normal backlog job
      isActive: true,
    });

    // First run
    const firstResult = await generateInstances(testCompanyId, 7);
    expect(firstResult.jobsCreated).toBeGreaterThan(0);

    // Track jobs for cleanup
    const jobsAfterFirst = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.companyId, testCompanyId),
          eq(jobs.summary, `${TEST_PREFIX}idempotent_job`)
        )
      );
    createdJobIds.push(...jobsAfterFirst.map((j) => j.id));

    const firstCount = jobsAfterFirst.length;

    // Second run
    const secondResult = await generateInstances(testCompanyId, 7);

    // Should create 0 new jobs
    expect(secondResult.jobsCreated).toBe(0);

    // Verify same job count
    const jobsAfterSecond = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.companyId, testCompanyId),
          eq(jobs.summary, `${TEST_PREFIX}idempotent_job`)
        )
      );

    expect(jobsAfterSecond.length).toBe(firstCount);
  });

  // ============================================================================
  // Test 4: Generated jobs have correct backlog status
  // ============================================================================
  it("Test 4: Generated jobs are unscheduled and have valid backlog status", async () => {
    // Create templates with different statuses
    const templateIds = {
      open: uuidv4(),
      assigned: uuidv4(),
    };
    createdTemplateIds.push(...Object.values(templateIds));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = today.toISOString().split("T")[0];

    // Create "open" template
    await db.insert(recurringJobTemplates).values({
      id: templateIds.open,
      companyId: testCompanyId,
      locationId: testLocationId,
      title: `${TEST_PREFIX}open_status_job`,
      startDate,
      recurrenceKind: "weekly",
      interval: 1,
      daysOfWeek: [today.getDay()], // Today's day
      openSubStatusDefault: null, // Phase 2 Step 6: null = normal backlog job
      isActive: true,
    });

    // Create "assigned" template
    await db.insert(recurringJobTemplates).values({
      id: templateIds.assigned,
      companyId: testCompanyId,
      locationId: testLocationId,
      title: `${TEST_PREFIX}assigned_status_job`,
      startDate,
      recurrenceKind: "weekly",
      interval: 1,
      daysOfWeek: [today.getDay()],
      openSubStatusDefault: null, // Phase 2 Step 6: null = normal backlog job
      preferredTechnicianId: testUserId,
      isActive: true,
    });

    // Generate
    const result = await generateInstances(testCompanyId, 1);
    expect(result.jobsCreated).toBeGreaterThanOrEqual(2);

    // Check open status job
    const openJobs = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.companyId, testCompanyId),
          eq(jobs.summary, `${TEST_PREFIX}open_status_job`)
        )
      );

    if (openJobs.length > 0) {
      createdJobIds.push(...openJobs.map((j) => j.id));
      for (const job of openJobs) {
        expect(job.scheduledStart).toBeNull();
        expect(job.scheduledEnd).toBeNull();
        expect(job.isAllDay).toBe(false);
        expect(job.status).toBe("open");
      }
    }

    // Check tech-assigned template still produces status "open" (Phase 2 Step 6:
    // "assigned" is derived, not a persisted status — generator always sets "open")
    const techJobs = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.companyId, testCompanyId),
          eq(jobs.summary, `${TEST_PREFIX}assigned_status_job`)
        )
      );

    if (techJobs.length > 0) {
      createdJobIds.push(...techJobs.map((j) => j.id));
      for (const job of techJobs) {
        expect(job.scheduledStart).toBeNull();
        expect(job.scheduledEnd).toBeNull();
        expect(job.isAllDay).toBe(false);
        // Phase 2 Step 6: all generated jobs are "open"; tech assignment doesn't change status
        expect(job.status).toBe("open");
        expect(job.primaryTechnicianId).toBe(testUserId);
      }
    }
  });

  // ============================================================================
  // Test 5: Concurrent generation produces no duplicates
  // ============================================================================
  it("Test 5: Concurrent generation produces no duplicate jobs", async () => {
    // Create a template that will generate multiple instances
    const templateId = uuidv4();
    createdTemplateIds.push(templateId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = today.toISOString().split("T")[0];

    await db.insert(recurringJobTemplates).values({
      id: templateId,
      companyId: testCompanyId,
      locationId: testLocationId,
      title: `${TEST_PREFIX}concurrent_test_job`,
      startDate,
      recurrenceKind: "weekly",
      interval: 1,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6], // Every day
      openSubStatusDefault: null, // Phase 2 Step 6: null = normal backlog job
      isActive: true,
    });

    // Get job count before test
    const jobsBefore = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.companyId, testCompanyId),
          eq(jobs.summary, `${TEST_PREFIX}concurrent_test_job`)
        )
      );
    const countBefore = jobsBefore.length;

    // Run multiple generations concurrently
    const concurrentPromises = [
      generateInstances(testCompanyId, 7),
      generateInstances(testCompanyId, 7),
      generateInstances(testCompanyId, 7),
    ];

    const results = await Promise.all(concurrentPromises);

    // Get actual jobs in database for THIS template only
    const actualJobs = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.companyId, testCompanyId),
          eq(jobs.summary, `${TEST_PREFIX}concurrent_test_job`)
        )
      );

    createdJobIds.push(...actualJobs.map((j) => j.id));

    // Calculate jobs created for this specific template
    const jobsCreatedForTemplate = actualJobs.length - countBefore;

    // Check that jobs were created
    expect(jobsCreatedForTemplate).toBeGreaterThan(0);

    // Verify no duplicates: the number of jobs should match the number of instances
    const instancesForTemplate = await db
      .select()
      .from(recurringJobInstances)
      .where(eq(recurringJobInstances.templateId, templateId));

    // Each instance should have at most one job
    const generatedInstances = instancesForTemplate.filter((i) => i.status === "generated");
    expect(generatedInstances.length).toBe(jobsCreatedForTemplate);

    // Verify each generated instance has a unique job
    const jobIds = new Set(generatedInstances.map((i) => i.generatedJobId));
    expect(jobIds.size).toBe(generatedInstances.length); // No duplicate job IDs

    // No errors should have occurred
    for (const result of results) {
      expect(result.errors.length).toBe(0);
    }
  });

  // ============================================================================
  // Test 6: Generated jobs include recurrence linkage fields
  // ============================================================================
  it("Test 6: Generated jobs have recurrence linkage fields populated", async () => {
    // Create a template
    const templateId = uuidv4();
    createdTemplateIds.push(templateId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = today.toISOString().split("T")[0];

    await db.insert(recurringJobTemplates).values({
      id: templateId,
      companyId: testCompanyId,
      locationId: testLocationId,
      title: `${TEST_PREFIX}linkage_test_job`,
      startDate,
      recurrenceKind: "weekly",
      interval: 1,
      daysOfWeek: [today.getDay()], // Today only
      openSubStatusDefault: null, // Phase 2 Step 6: null = normal backlog job
      isActive: true,
    });

    // Generate jobs
    const result = await generateInstances(testCompanyId, 7);
    expect(result.jobsCreated).toBeGreaterThan(0);

    // Get created jobs
    const linkageJobs = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.companyId, testCompanyId),
          eq(jobs.summary, `${TEST_PREFIX}linkage_test_job`)
        )
      );

    createdJobIds.push(...linkageJobs.map((j) => j.id));
    expect(linkageJobs.length).toBeGreaterThan(0);

    // Verify linkage fields are populated
    for (const job of linkageJobs) {
      expect(job.recurrenceTemplateId).toBe(templateId);
      expect(job.recurrenceInstanceDate).not.toBeNull();
      // Instance date should be a valid date string
      expect(typeof job.recurrenceInstanceDate).toBe("string");
    }

    // Also verify instances in the instances table have job linkage
    const instances = await db
      .select()
      .from(recurringJobInstances)
      .where(eq(recurringJobInstances.templateId, templateId));

    expect(instances.length).toBeGreaterThan(0);

    for (const instance of instances) {
      if (instance.status === "generated") {
        expect(instance.generatedJobId).not.toBeNull();
        // Verify the generated job ID exists in our created jobs
        const linkedJob = linkageJobs.find((j) => j.id === instance.generatedJobId);
        expect(linkedJob).toBeDefined();
      }
    }
  });

  // ============================================================================
  // Test 7: Stale claiming rows are recovered to pending
  // ============================================================================
  it("Test 7: Stale claiming rows are recovered to pending", async () => {
    // Create a template
    const templateId = uuidv4();
    createdTemplateIds.push(templateId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = today.toISOString().split("T")[0];

    await db.insert(recurringJobTemplates).values({
      id: templateId,
      companyId: testCompanyId,
      locationId: testLocationId,
      title: `${TEST_PREFIX}stale_claim_test`,
      startDate,
      recurrenceKind: "weekly",
      interval: 1,
      daysOfWeek: [today.getDay()],
      openSubStatusDefault: null, // Phase 2 Step 6: null = normal backlog job
      isActive: true,
    });

    // Manually create a "stuck" instance in claiming status with old claimedAt
    const instanceId = uuidv4();
    const staleClaimedAt = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes ago (older than 10 min threshold)

    await db.insert(recurringJobInstances).values({
      id: instanceId,
      companyId: testCompanyId,
      templateId: templateId,
      instanceDate: startDate,
      status: "claiming",
      claimedAt: staleClaimedAt,
    });

    // Verify the instance is in claiming status
    const [beforeRecovery] = await db
      .select()
      .from(recurringJobInstances)
      .where(eq(recurringJobInstances.id, instanceId))
      .limit(1);

    expect(beforeRecovery.status).toBe("claiming");

    // Run recovery
    const recovered = await recoverStaleClaims(testCompanyId);

    // Should have recovered 1 claim
    expect(recovered).toBe(1);

    // Verify the instance is now pending
    const [afterRecovery] = await db
      .select()
      .from(recurringJobInstances)
      .where(eq(recurringJobInstances.id, instanceId))
      .limit(1);

    expect(afterRecovery.status).toBe("pending");
    expect(afterRecovery.claimedAt).toBeNull();
  });

  // ============================================================================
  // Test 8: Instances endpoint returns correct rows and respects date range
  // ============================================================================
  it("Test 8: Instances endpoint returns correct rows and respects date range", async () => {
    // Create a template
    const templateId = uuidv4();
    createdTemplateIds.push(templateId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = today.toISOString().split("T")[0];

    await db.insert(recurringJobTemplates).values({
      id: templateId,
      companyId: testCompanyId,
      locationId: testLocationId,
      title: `${TEST_PREFIX}instances_endpoint_test`,
      startDate,
      recurrenceKind: "weekly",
      interval: 1,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6], // Every day
      openSubStatusDefault: null, // Phase 2 Step 6: null = normal backlog job
      isActive: true,
    });

    // Generate jobs for 14 days
    await generateInstances(testCompanyId, 14);

    // Get all instances (no date filter)
    const allInstances = await recurringJobsRepository.getInstancesWithJobs(
      testCompanyId,
      templateId,
      { limit: 100 }
    );

    // Should have instances
    expect(allInstances.length).toBeGreaterThan(0);

    // Each instance should have proper fields
    for (const instance of allInstances) {
      expect(instance.id).toBeDefined();
      expect(instance.instanceDate).toBeDefined();
      expect(instance.status).toBeDefined();
      expect(["pending", "claiming", "generated", "skipped", "canceled"]).toContain(instance.status);

      // If generated, should have job info
      if (instance.status === "generated") {
        expect(instance.job).not.toBeNull();
        expect(instance.job?.jobNumber).toBeDefined();
        expect(instance.job?.summary).toBe(`${TEST_PREFIX}instances_endpoint_test`);
      }
    }

    // Test date range filtering
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const threeDaysLater = new Date(today);
    threeDaysLater.setDate(threeDaysLater.getDate() + 3);

    const fromDate = tomorrow.toISOString().split("T")[0];
    const toDate = threeDaysLater.toISOString().split("T")[0];

    const filteredInstances = await recurringJobsRepository.getInstancesWithJobs(
      testCompanyId,
      templateId,
      { from: fromDate, to: toDate }
    );

    // All filtered instances should be within the date range
    for (const instance of filteredInstances) {
      expect(instance.instanceDate >= fromDate).toBe(true);
      expect(instance.instanceDate <= toDate).toBe(true);
    }
  });
});
