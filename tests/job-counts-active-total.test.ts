/**
 * Job Counts activeTotal Tests (2026-04-09)
 *
 * Verifies the additive `activeTotal` field on `JobCounts`:
 *   - Shape: response includes `activeTotal` alongside `total`.
 *   - Semantics: activeTotal === total - lifecycle.archived.
 *   - Parity: existing `total` field is unchanged (still the full lifecycle sum).
 *
 * Added because `Jobs.tsx` used to compute this by hand
 * (`counts.total - counts.lifecycle.archived`). The manual subtraction has
 * been replaced with `counts.activeTotal`; these tests lock that contract.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import {
  jobs,
  companies,
  users,
  clientLocations,
  customerCompanies,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { jobRepository } from "../server/storage/jobs";
import { getJobCounts } from "../server/storage/jobsFeed";
import type { QueryCtx } from "../server/lib/queryCtx";
import { v4 as uuidv4 } from "uuid";

const TEST_PREFIX = "counts_active_total_test_";
let companyId: string;
let userId: string;
let customerCompanyId: string;
let locationId: string;
let ctx: QueryCtx;

/**
 * Create four jobs — one in each lifecycle bucket — so we can assert exact
 * count math: total=4, archived=1, activeTotal=3.
 */
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
    role: "owner",
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

  // Canonical pattern: create every job as "open" via the repo, then UPDATE
  // directly into the terminal bucket so we exercise real insert code paths.
  const mk = async (suffix: string, finalStatus: "open" | "completed" | "invoiced" | "archived") => {
    const job = await jobRepository.createJob(companyId, {
      companyId,
      locationId,
      summary: `${TEST_PREFIX}${suffix}`,
      status: "open",
      jobType: "maintenance",
      priority: "medium",
    });
    if (finalStatus !== "open") {
      await db.update(jobs).set({ status: finalStatus }).where(eq(jobs.id, job.id));
    }
  };

  await mk("open_job", "open");
  await mk("completed_job", "completed");
  await mk("invoiced_job", "invoiced");
  await mk("archived_job", "archived");

  ctx = {
    db: db as any,
    tenantId: companyId,
    userId,
    role: "owner",
  };
}

async function cleanupFixtures() {
  await db.delete(jobs).where(eq(jobs.companyId, companyId));
  await db.delete(clientLocations).where(eq(clientLocations.companyId, companyId));
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, companyId));
  await db.delete(users).where(eq(users.companyId, companyId));
  await db.delete(companies).where(eq(companies.id, companyId));
}

describe("getJobCounts — activeTotal", () => {
  beforeAll(async () => {
    await createFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  it("response shape includes activeTotal alongside total", async () => {
    const counts = await getJobCounts(ctx);
    expect(counts).toHaveProperty("total");
    expect(counts).toHaveProperty("activeTotal");
    expect(counts.lifecycle).toBeDefined();
    expect(typeof counts.activeTotal).toBe("number");
    expect(typeof counts.total).toBe("number");
  });

  it("activeTotal equals total minus lifecycle.archived", async () => {
    const counts = await getJobCounts(ctx);
    expect(counts.activeTotal).toBe(counts.total - counts.lifecycle.archived);
  });

  it("matches exact fixture math: 4 total, 1 archived, 3 activeTotal", async () => {
    const counts = await getJobCounts(ctx);
    expect(counts.total).toBe(4);
    expect(counts.lifecycle.open).toBe(1);
    expect(counts.lifecycle.completed).toBe(1);
    expect(counts.lifecycle.invoiced).toBe(1);
    expect(counts.lifecycle.archived).toBe(1);
    expect(counts.activeTotal).toBe(3);
  });

  it("existing total field is unchanged by the additive activeTotal change", async () => {
    // Sanity: total must still count every row the feed sees, including archived.
    const counts = await getJobCounts(ctx);
    const sumOfBuckets =
      counts.lifecycle.open +
      counts.lifecycle.completed +
      counts.lifecycle.invoiced +
      counts.lifecycle.archived;
    expect(counts.total).toBe(sumOfBuckets);
  });
});
