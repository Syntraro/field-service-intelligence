/**
 * Active Work Filter Tests
 *
 * Validates that "Active Work" includes ALL open jobs (including unscheduled
 * PM jobs) and excludes completed/invoiced/archived/deleted jobs.
 *
 * Canonical rule:
 *   Active Work = activeJobFilter() AND jobs.status = 'open'
 *   No scheduledStart requirement.
 *
 * Test scenarios:
 * 1) Open job with scheduledStart = NULL → included (unscheduled/backlog/PM)
 * 2) Open job with scheduledStart set → included
 * 3) Completed job → excluded
 * 4) Invoiced job → excluded
 * 5) Archived job → excluded
 * 6) Soft-deleted open job → excluded
 * 7) Deactivated open job (isActive=false) → excluded
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import { jobs, companies, users, clientLocations, customerCompanies } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { activeWorkJobFilter } from "../server/storage/jobFilters";
import { v4 as uuidv4 } from "uuid";

const TEST_PREFIX = "active_work_test_";
let companyId: string;
let userId: string;
let customerCompanyId: string;
let locationId: string;
const createdJobIds: string[] = [];
let jobSeq = 900000; // Test-only sequence to avoid collisions

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
  if (createdJobIds.length > 0) {
    await db.delete(jobs).where(inArray(jobs.id, createdJobIds));
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

/** Create a job and track its ID for cleanup */
async function createJob(overrides: Record<string, unknown> = {}): Promise<string> {
  const jobId = uuidv4();
  createdJobIds.push(jobId);

  jobSeq += 1;
  await db.insert(jobs).values({
    id: jobId,
    companyId,
    locationId,
    jobNumber: jobSeq,
    status: "open",
    jobType: "maintenance",
    summary: `${TEST_PREFIX}job`,
    isActive: true,
    ...overrides,
  });

  return jobId;
}

/** Query Active Work jobs for our test company using the canonical filter */
async function queryActiveWork(): Promise<string[]> {
  const rows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.companyId, companyId), activeWorkJobFilter()));
  return rows.map((r) => r.id);
}

describe("Active Work Filter", () => {
  beforeAll(async () => {
    await createFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  // ==========================================================================
  // Test 1: Unscheduled open job IS Active Work
  // ==========================================================================
  it("includes open job with scheduledStart=NULL (unscheduled/PM)", async () => {
    const jobId = await createJob({
      summary: `${TEST_PREFIX}unscheduled_pm`,
      scheduledStart: null,
      status: "open",
    });

    const activeIds = await queryActiveWork();
    expect(activeIds).toContain(jobId);
  });

  // ==========================================================================
  // Test 2: Scheduled open job IS Active Work
  // ==========================================================================
  it("includes open job with scheduledStart set", async () => {
    const jobId = await createJob({
      summary: `${TEST_PREFIX}scheduled`,
      scheduledStart: new Date("2026-03-15T09:00:00Z"),
      status: "open",
    });

    const activeIds = await queryActiveWork();
    expect(activeIds).toContain(jobId);
  });

  // ==========================================================================
  // Test 3: Open job with in_progress sub-status IS Active Work
  // ==========================================================================
  it("includes open job with openSubStatus=in_progress", async () => {
    const jobId = await createJob({
      summary: `${TEST_PREFIX}in_progress`,
      status: "open",
      openSubStatus: "in_progress",
    });

    const activeIds = await queryActiveWork();
    expect(activeIds).toContain(jobId);
  });

  // ==========================================================================
  // Test 4: Open job with on_hold sub-status IS Active Work
  // ==========================================================================
  it("includes open job with openSubStatus=on_hold", async () => {
    const jobId = await createJob({
      summary: `${TEST_PREFIX}on_hold`,
      status: "open",
      openSubStatus: "on_hold",
      holdReason: "parts",
    });

    const activeIds = await queryActiveWork();
    expect(activeIds).toContain(jobId);
  });

  // ==========================================================================
  // Test 5: Completed job is NOT Active Work
  // ==========================================================================
  it("excludes completed job", async () => {
    const jobId = await createJob({
      summary: `${TEST_PREFIX}completed`,
      status: "completed",
    });

    const activeIds = await queryActiveWork();
    expect(activeIds).not.toContain(jobId);
  });

  // ==========================================================================
  // Test 6: Invoiced job is NOT Active Work
  // ==========================================================================
  it("excludes invoiced job", async () => {
    const jobId = await createJob({
      summary: `${TEST_PREFIX}invoiced`,
      status: "invoiced",
    });

    const activeIds = await queryActiveWork();
    expect(activeIds).not.toContain(jobId);
  });

  // ==========================================================================
  // Test 7: Archived job is NOT Active Work
  // ==========================================================================
  it("excludes archived job", async () => {
    const jobId = await createJob({
      summary: `${TEST_PREFIX}archived`,
      status: "archived",
    });

    const activeIds = await queryActiveWork();
    expect(activeIds).not.toContain(jobId);
  });

  // ==========================================================================
  // Test 8: Soft-deleted open job is NOT Active Work
  // ==========================================================================
  it("excludes soft-deleted open job", async () => {
    const jobId = await createJob({
      summary: `${TEST_PREFIX}soft_deleted`,
      status: "open",
    });

    // Soft-delete the job
    await db
      .update(jobs)
      .set({ deletedAt: new Date(), isActive: false })
      .where(eq(jobs.id, jobId));

    const activeIds = await queryActiveWork();
    expect(activeIds).not.toContain(jobId);
  });

  // ==========================================================================
  // Test 9: Deactivated open job is NOT Active Work
  // ==========================================================================
  it("excludes deactivated open job (isActive=false)", async () => {
    const jobId = await createJob({
      summary: `${TEST_PREFIX}deactivated`,
      status: "open",
      isActive: false,
    });

    const activeIds = await queryActiveWork();
    expect(activeIds).not.toContain(jobId);
  });

  // ==========================================================================
  // Test 10: Mixed — only open, non-deleted jobs appear
  // ==========================================================================
  it("returns only open non-deleted jobs from a mixed set", async () => {
    // Create one of each status
    const openId = await createJob({ summary: `${TEST_PREFIX}mix_open`, status: "open" });
    const completedId = await createJob({ summary: `${TEST_PREFIX}mix_completed`, status: "completed" });
    const archivedId = await createJob({ summary: `${TEST_PREFIX}mix_archived`, status: "archived" });

    const activeIds = await queryActiveWork();

    expect(activeIds).toContain(openId);
    expect(activeIds).not.toContain(completedId);
    expect(activeIds).not.toContain(archivedId);
  });
});
