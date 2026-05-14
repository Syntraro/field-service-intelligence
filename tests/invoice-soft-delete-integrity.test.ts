/**
 * Invoice Feed Job-Isolation Tests
 *
 * Proves that soft-deleted jobs do not leak through invoice feed joins.
 * Invoice soft-delete was removed in migration 2026_04_09_invoice_permanent_delete.sql
 * — invoices now use a permanent-delete model (is_active / deleted_at dropped).
 * Job soft-delete remains valid; this file covers job-level isolation only.
 *
 * 2026-03-18: Created to prove invoice soft-delete integrity gaps are sealed.
 * 2026-05-14: Removed stale invoice soft-delete tests (invoice is_active /
 *             deleted_at columns were dropped 2026-04-09). Kept active-invoice
 *             baseline reads and job-isolation coverage.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../server/db";
import {
  jobs,
  invoices,
  companies,
  users,
  clientLocations,
  customerCompanies,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { invoiceRepository } from "../server/storage/invoices";
import { v4 as uuidv4 } from "uuid";

let companyId: string;
let userId: string;
let customerCompanyId: string;
let locationId: string;
const createdInvoiceIds: string[] = [];
const createdJobIds: string[] = [];

async function setup() {
  companyId = uuidv4();
  await db.insert(companies).values({ id: companyId, name: "inv_sd_test_company" });

  userId = uuidv4();
  await db.insert(users).values({
    id: userId, companyId,
    email: `inv_sd_test_${Date.now()}@test.com`,
    password: "hash", role: "admin", firstName: "Inv", lastName: "Test",
  });

  customerCompanyId = uuidv4();
  await db.insert(customerCompanies).values({
    id: customerCompanyId, companyId, name: "inv_sd_test_customer",
  });

  locationId = uuidv4();
  await db.insert(clientLocations).values({
    id: locationId, companyId, parentCompanyId: customerCompanyId,
    companyName: "inv_sd_test_location", address: "100 Invoice St", selectedMonths: [],
  });
}

async function createInvoice(overrides?: Record<string, unknown>): Promise<string> {
  const id = uuidv4();
  const invoiceNumber = Math.floor(Math.random() * 100000);
  await db.insert(invoices).values({
    id,
    companyId,
    locationId,
    invoiceNumber,
    status: "draft",
    issueDate: new Date().toISOString().slice(0, 10),
    subtotal: "100.00",
    taxTotal: "13.00",
    total: "113.00",
    balance: "113.00",
    ...overrides,
  } as any);
  createdInvoiceIds.push(id);
  return id;
}

async function createJob(overrides?: Record<string, unknown>): Promise<string> {
  const id = uuidv4();
  await db.insert(jobs).values({
    id,
    companyId,
    locationId,
    jobType: "Repair",
    summary: "inv_sd_test_job",
    status: "open",
    jobNumber: Math.floor(Math.random() * 100000),
    ...overrides,
  });
  createdJobIds.push(id);
  return id;
}

async function softDeleteJob(jobId: string) {
  await db.update(jobs).set({
    deletedAt: new Date(),
    isActive: false,
  }).where(eq(jobs.id, jobId));
}

async function cleanup() {
  for (const id of createdInvoiceIds) {
    await db.delete(invoices).where(eq(invoices.id, id)).catch(() => {});
  }
  for (const id of createdJobIds) {
    await db.delete(jobs).where(eq(jobs.id, id)).catch(() => {});
  }
  if (locationId) await db.delete(clientLocations).where(eq(clientLocations.id, locationId)).catch(() => {});
  if (customerCompanyId) await db.delete(customerCompanies).where(eq(customerCompanies.id, customerCompanyId)).catch(() => {});
  if (userId) await db.delete(users).where(eq(users.id, userId)).catch(() => {});
  if (companyId) await db.delete(companies).where(eq(companies.id, companyId)).catch(() => {});
}

describe("Invoice Soft-Delete Integrity", () => {
  beforeAll(async () => { await setup(); });
  afterAll(async () => { await cleanup(); });

  // ==========================================================================
  // Active-invoice baseline: reads and mutations work normally
  // (These serve as a regression guard — if the feed or repository starts
  //  silently dropping active invoices, these catch it first.)
  // ==========================================================================

  it("active invoices are returned normally by getInvoice", async () => {
    const id = await createInvoice({ status: "draft" });

    const result = await invoiceRepository.getInvoice(companyId, id);
    expect(result).toBeDefined();
    expect(result!.id).toBe(id);
    expect(result!.status).toBe("draft");
  });

  it("active invoices can be updated normally", async () => {
    const id = await createInvoice({ status: "draft" });

    const result = await invoiceRepository.updateInvoice(companyId, id, undefined, {
      workDescription: "test update",
    });

    expect(result).toBeDefined();
    expect(result.workDescription).toBe("test update");
  });

  // ==========================================================================
  // Part C: Invoice feed does not leak soft-deleted joined job data
  // ==========================================================================

  it("invoice feed does not leak soft-deleted joined job data", async () => {
    const jobId = await createJob();
    const invoiceId = await createInvoice({ jobId });

    const { getInvoicesFeed } = await import("../server/storage/invoicesFeed");

    // Job is active — feed item should carry job number.
    const beforeFeed = await getInvoicesFeed(
      { db: (await import("../server/db")).db, tenantId: companyId, userId: "", role: "" },
      {}
    );
    const beforeItem = beforeFeed.items.find((i: any) => i.id === invoiceId);
    expect(beforeItem).toBeDefined();
    expect(beforeItem!.jobNumber).toBeDefined();

    // Soft-delete the job; invoice itself remains (permanent-delete model).
    await softDeleteJob(jobId);

    // Invoice still visible but joined job data must be NULL.
    const afterFeed = await getInvoicesFeed(
      { db: (await import("../server/db")).db, tenantId: companyId, userId: "", role: "" },
      {}
    );
    const afterItem = afterFeed.items.find((i: any) => i.id === invoiceId);
    expect(afterItem).toBeDefined();
    expect(afterItem!.jobNumber).toBeNull();
  });
});
