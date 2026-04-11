/**
 * job_parts.unit_cost hydration regression test (2026-04-10)
 *
 * Locks the canonical invariant enforced by `normalizeJobPartUnitCost` inside
 * `jobRepository.createJobPart` (server/storage/jobs.ts):
 *
 *   1. When productId is set and unitCost is omitted → hydrated from items.cost.
 *   2. When caller explicitly provides unitCost → caller value wins.
 *   3. When productId is null (manual line) and unitCost omitted → stays null.
 *
 * These three cases cover the exact data-integrity bug fixed on 2026-04-10
 * where template-apply and quote→job conversion paths inserted NULL unit_cost.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import {
  jobs,
  jobParts,
  items,
  companies,
  users,
  clientLocations,
  customerCompanies,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { jobRepository } from "../server/storage/jobs";
import { v4 as uuidv4 } from "uuid";

const TEST_PREFIX = "unit_cost_test_";
let companyId: string;
let userId: string;
let customerCompanyId: string;
let locationId: string;
let jobId: string;
let catalogItemId: string;
const CATALOG_COST = "20.00";
const CATALOG_PRICE = "45.00";

async function createFixtures() {
  companyId = uuidv4();
  await db.insert(companies).values({ id: companyId, name: `${TEST_PREFIX}company` });

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

  const job = await jobRepository.createJob(companyId, {
    companyId,
    locationId,
    summary: `${TEST_PREFIX}job`,
    status: "open",
    jobType: "maintenance",
    priority: "medium",
  });
  jobId = job.id;

  // Catalog item with a known cost — the source of truth for hydration.
  catalogItemId = uuidv4();
  await db.insert(items).values({
    id: catalogItemId,
    companyId,
    userId,
    type: "product",
    name: `${TEST_PREFIX}Truck Charge`,
    cost: CATALOG_COST,
    unitPrice: CATALOG_PRICE,
  });
}

async function cleanupFixtures() {
  await db.delete(jobParts).where(eq(jobParts.companyId, companyId));
  await db.delete(items).where(eq(items.companyId, companyId));
  await db.delete(jobs).where(eq(jobs.companyId, companyId));
  await db.delete(clientLocations).where(eq(clientLocations.companyId, companyId));
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, companyId));
  await db.delete(users).where(eq(users.companyId, companyId));
  await db.delete(companies).where(eq(companies.id, companyId));
}

describe("createJobPart — unit_cost hydration", () => {
  beforeAll(async () => {
    await createFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  it("hydrates unitCost from items.cost when caller omits it", async () => {
    const part = await jobRepository.createJobPart(companyId, jobId, {
      companyId,
      jobId,
      productId: catalogItemId,
      description: "Hydration test — omitted unitCost",
      quantity: "1",
      unitPrice: CATALOG_PRICE,
      // unitCost intentionally NOT provided
    });

    expect(part.productId).toBe(catalogItemId);
    expect(part.unitCost).toBe(CATALOG_COST);
  });

  it("preserves explicit caller-supplied unitCost (does not overwrite from catalog)", async () => {
    const EXPLICIT_COST = "7.50";
    const part = await jobRepository.createJobPart(companyId, jobId, {
      companyId,
      jobId,
      productId: catalogItemId,
      description: "Explicit cost test",
      quantity: "1",
      unitPrice: CATALOG_PRICE,
      unitCost: EXPLICIT_COST,
    });

    expect(part.productId).toBe(catalogItemId);
    expect(part.unitCost).toBe(EXPLICIT_COST);
  });

  it("leaves unitCost null for manual lines with no productId", async () => {
    const part = await jobRepository.createJobPart(companyId, jobId, {
      companyId,
      jobId,
      productId: null,
      description: "Manual line — no catalog link",
      quantity: "1",
      unitPrice: "50.00",
      // no productId → nothing to look up → should stay null
    });

    expect(part.productId).toBeNull();
    expect(part.unitCost).toBeNull();
  });
});
