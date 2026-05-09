/**
 * Tier 1 equipment-lock policy tests (2026-05-08)
 *
 * Locks the contract that:
 *   1. Invoiced jobs allow add / update / remove equipment (lock removed).
 *   2. The remaining JOB_INVOICED_LOCKED guard still fires for billing-field
 *      mutations on invoiced jobs (updateJob with invoiceId / billingNotes).
 *
 * Prior to this change, createJobEquipment / updateJobEquipment /
 * deleteJobEquipment called assertJobNotInvoiced — blocking technicians from
 * linking equipment to already-invoiced service calls even though equipment
 * links are pure metadata (never line items on the invoice).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import {
  jobs,
  jobEquipment,
  locationEquipment,
  companies,
  users,
  clientLocations,
  customerCompanies,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { jobRepository } from "../server/storage/jobs";
import { v4 as uuidv4 } from "uuid";

const TEST_PREFIX = "equip_policy_test_";

let companyId: string;
let locationId: string;
let invoicedJobId: string;
let equipmentId: string;

async function createFixtures() {
  companyId = uuidv4();
  await db.insert(companies).values({ id: companyId, name: `${TEST_PREFIX}company` });

  await db.insert(users).values({
    id: uuidv4(),
    companyId,
    email: `${TEST_PREFIX}${Date.now()}@test.com`,
    password: "test_hash",
    role: "owner",
    status: "active",
  });

  const customerCompanyId = uuidv4();
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

  // Create a normal job then force status to "invoiced" via direct SQL to
  // bypass lifecycle guards — the lock tests need a truly invoiced job.
  const job = await jobRepository.createJob(companyId, {
    companyId,
    locationId,
    summary: `${TEST_PREFIX}invoiced_job`,
    status: "open",
    jobType: "maintenance",
    priority: "medium",
  });
  invoicedJobId = job.id;
  await db.update(jobs).set({ status: "invoiced" }).where(eq(jobs.id, invoicedJobId));

  // Seed a piece of location equipment to link.
  equipmentId = uuidv4();
  await db.insert(locationEquipment).values({
    id: equipmentId,
    companyId,
    locationId,
    name: `${TEST_PREFIX}RTU-1`,
    isActive: true,
  });
}

async function cleanupFixtures() {
  await db.delete(jobEquipment).where(eq(jobEquipment.companyId, companyId));
  await db.delete(locationEquipment).where(eq(locationEquipment.companyId, companyId));
  await db.delete(jobs).where(eq(jobs.companyId, companyId));
  await db.delete(clientLocations).where(eq(clientLocations.companyId, companyId));
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, companyId));
  await db.delete(users).where(eq(users.companyId, companyId));
  await db.delete(companies).where(eq(companies.id, companyId));
}

beforeAll(createFixtures);
afterAll(cleanupFixtures);

// ─── 1. Equipment operations are allowed on invoiced jobs ────────────────────

describe("invoiced job — equipment links are unlocked (Tier 1 policy)", () => {
  let jobEquipmentId: string;

  it("createJobEquipment succeeds on an invoiced job", async () => {
    const row = await jobRepository.createJobEquipment(
      companyId,
      invoicedJobId,
      { equipmentId, notes: "Initial link on invoiced job" },
    );
    expect(row).toBeDefined();
    expect(row.jobId).toBe(invoicedJobId);
    expect(row.equipmentId).toBe(equipmentId);
    jobEquipmentId = row.id;
  });

  it("updateJobEquipment succeeds on an invoiced job", async () => {
    const updated = await jobRepository.updateJobEquipment(
      companyId,
      jobEquipmentId,
      { notes: "Updated note on invoiced job" },
    );
    expect(updated).toBeDefined();
    expect(updated!.notes).toBe("Updated note on invoiced job");
  });

  it("deleteJobEquipment succeeds on an invoiced job", async () => {
    const deleted = await jobRepository.deleteJobEquipment(companyId, jobEquipmentId);
    expect(deleted).toBe(true);
  });
});

// ─── 2. Billing-field lock still fires for financial mutations ───────────────

describe("invoiced job — billing-field lock remains via updateJob", () => {
  it("updateJob with billingNotes throws JOB_INVOICED_LOCKED (409)", async () => {
    await expect(
      jobRepository.updateJob(companyId, invoicedJobId, undefined, { billingNotes: "should be blocked" }),
    ).rejects.toMatchObject({ statusCode: 409, code: "JOB_INVOICED_LOCKED" });
  });

  it("updateJob with invoiceId throws JOB_INVOICED_LOCKED (409)", async () => {
    await expect(
      jobRepository.updateJob(companyId, invoicedJobId, undefined, { invoiceId: uuidv4() }),
    ).rejects.toMatchObject({ statusCode: 409, code: "JOB_INVOICED_LOCKED" });
  });

  it("updateJob with non-billing fields succeeds on an invoiced job", async () => {
    const updated = await jobRepository.updateJob(companyId, invoicedJobId, undefined, {
      summary: `${TEST_PREFIX}updated_summary`,
    });
    expect(updated).toBeDefined();
  });
});
