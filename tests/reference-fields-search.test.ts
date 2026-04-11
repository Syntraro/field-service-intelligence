/**
 * Reference Fields Search Integration Tests (2026-04-10)
 *
 * Validates that reference field values surface in global search results.
 *
 * RS1. searchable text value returns linked job
 * RS2. searchable text value returns linked invoice
 * RS3. non-searchable definition does NOT return results
 * RS4. tenant scoping prevents cross-tenant leakage
 * RS5. exact reference match appears in results
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../server/db";
import {
  referenceFieldDefinitions,
  referenceFieldValues,
  companies,
  users,
  jobs,
  invoices,
  clientLocations,
  customerCompanies,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { universalSearch } from "../server/storage/search";
import { v4 as uuidv4 } from "uuid";

const TEST_PREFIX = "ref_search_test_";
let companyId: string;
let companyId2: string;
let jobId: string;
let invoiceId: string;
let locationId: string;
let ccId: string;

beforeAll(async () => {
  // Tenant A
  companyId = uuidv4();
  await db.insert(companies).values({ id: companyId, name: `${TEST_PREFIX}co` });

  ccId = uuidv4();
  await db.insert(customerCompanies).values({ id: ccId, companyId, name: `${TEST_PREFIX}customer` });

  locationId = uuidv4();
  await db.insert(clientLocations).values({ id: locationId, companyId, customerCompanyId: ccId, selectedMonths: [] });

  jobId = uuidv4();
  await db.insert(jobs).values({ id: jobId, companyId, locationId, summary: `${TEST_PREFIX}job`, status: "open", jobType: "Repair", jobNumber: 3333 });

  invoiceId = uuidv4();
  await db.insert(invoices).values({
    id: invoiceId, companyId, locationId, customerCompanyId: ccId,
    invoiceNumber: "INV-9999", total: "100.00",
    subtotal: "100.00", taxTotal: "0.00",
    issueDate: "2026-04-10", status: "draft",
  });

  // Tenant B (for isolation test)
  companyId2 = uuidv4();
  await db.insert(companies).values({ id: companyId2, name: `${TEST_PREFIX}co2` });
});

afterAll(async () => {
  await db.delete(referenceFieldValues).where(eq(referenceFieldValues.companyId, companyId));
  await db.delete(referenceFieldDefinitions).where(eq(referenceFieldDefinitions.companyId, companyId));
  await db.delete(referenceFieldValues).where(eq(referenceFieldValues.companyId, companyId2));
  await db.delete(referenceFieldDefinitions).where(eq(referenceFieldDefinitions.companyId, companyId2));
  await db.delete(invoices).where(eq(invoices.companyId, companyId));
  await db.delete(jobs).where(eq(jobs.companyId, companyId));
  await db.delete(clientLocations).where(eq(clientLocations.companyId, companyId));
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, companyId));
  await db.delete(companies).where(eq(companies.id, companyId));
  await db.delete(companies).where(eq(companies.id, companyId2));
});

beforeEach(async () => {
  await db.delete(referenceFieldValues).where(eq(referenceFieldValues.companyId, companyId));
  await db.delete(referenceFieldDefinitions).where(eq(referenceFieldDefinitions.companyId, companyId));
  await db.delete(referenceFieldValues).where(eq(referenceFieldValues.companyId, companyId2));
  await db.delete(referenceFieldDefinitions).where(eq(referenceFieldDefinitions.companyId, companyId2));
});

describe("Reference Fields Search", () => {
  it("RS1. searchable text value returns linked job", async () => {
    const [def] = await db.insert(referenceFieldDefinitions).values({
      companyId, label: "PO Number", key: "po_number", type: "text",
      appliesToJobs: true, searchable: true,
    }).returning();

    await db.insert(referenceFieldValues).values({
      companyId, fieldDefinitionId: def.id,
      entityType: "job", entityId: jobId,
      textValue: "PO-8891-UNIQUE",
    });

    const results = await universalSearch({ query: "PO-8891-UNIQUE", companyId });
    const jobResults = results.filter(r => r.type === "job" && r.id === jobId);
    expect(jobResults.length).toBe(1);
    expect(jobResults[0].match).toContain("ref:");
  });

  it("RS2. searchable text value returns linked invoice", async () => {
    const [def] = await db.insert(referenceFieldDefinitions).values({
      companyId, label: "Claim #", key: "claim_number", type: "text",
      appliesToInvoices: true, searchable: true,
    }).returning();

    await db.insert(referenceFieldValues).values({
      companyId, fieldDefinitionId: def.id,
      entityType: "invoice", entityId: invoiceId,
      textValue: "CLAIM-204-UNIQUE",
    });

    const results = await universalSearch({ query: "CLAIM-204-UNIQUE", companyId });
    const invResults = results.filter(r => r.type === "invoice" && r.id === invoiceId);
    expect(invResults.length).toBe(1);
    expect(invResults[0].match).toContain("ref:");
  });

  it("RS3. non-searchable definition does NOT return results", async () => {
    const [def] = await db.insert(referenceFieldDefinitions).values({
      companyId, label: "Internal", key: "internal_ref", type: "text",
      appliesToJobs: true, searchable: false, // NOT searchable
    }).returning();

    await db.insert(referenceFieldValues).values({
      companyId, fieldDefinitionId: def.id,
      entityType: "job", entityId: jobId,
      textValue: "NONSEARCHABLE-XYZ",
    });

    const results = await universalSearch({ query: "NONSEARCHABLE-XYZ", companyId });
    const refMatches = results.filter(r => r.match?.includes("ref:"));
    expect(refMatches.length).toBe(0);
  });

  it("RS4. tenant scoping prevents cross-tenant leakage", async () => {
    // Create field+value in tenant A
    const [def] = await db.insert(referenceFieldDefinitions).values({
      companyId, label: "Permit", key: "permit_search", type: "text",
      appliesToJobs: true, searchable: true,
    }).returning();

    await db.insert(referenceFieldValues).values({
      companyId, fieldDefinitionId: def.id,
      entityType: "job", entityId: jobId,
      textValue: "PERMIT-TENANT-A",
    });

    // Search from tenant B — must NOT find tenant A's value
    const results = await universalSearch({ query: "PERMIT-TENANT-A", companyId: companyId2 });
    expect(results.length).toBe(0);
  });

  it("RS5. exact reference match appears in results", async () => {
    const [def] = await db.insert(referenceFieldDefinitions).values({
      companyId, label: "WO #", key: "wo_number", type: "text",
      appliesToJobs: true, searchable: true,
    }).returning();

    await db.insert(referenceFieldValues).values({
      companyId, fieldDefinitionId: def.id,
      entityType: "job", entityId: jobId,
      textValue: "A67421",
    });

    const results = await universalSearch({ query: "A67421", companyId });
    expect(results.some(r => r.type === "job" && r.id === jobId)).toBe(true);
  });

  it("RS6. exact reference value match ranks at top tier", async () => {
    const [def] = await db.insert(referenceFieldDefinitions).values({
      companyId, label: "Permit #", key: "permit_rank", type: "text",
      appliesToJobs: true, searchable: true,
    }).returning();

    // Job title does NOT contain the search term — only the ref value does
    await db.insert(referenceFieldValues).values({
      companyId, fieldDefinitionId: def.id,
      entityType: "job", entityId: jobId,
      textValue: "EXACTMATCH123",
    });

    const results = await universalSearch({ query: "EXACTMATCH123", companyId });
    const jobResult = results.find(r => r.type === "job" && r.id === jobId);
    expect(jobResult).toBeDefined();

    // The result should be first or near-first (rank 0 = exact match on ref value)
    const idx = results.indexOf(jobResult!);
    expect(idx).toBeLessThanOrEqual(1); // at most second (after any title exact match)
  });

  it("RS7. _matchedValue is not exposed in final results", async () => {
    const [def] = await db.insert(referenceFieldDefinitions).values({
      companyId, label: "Internal", key: "no_leak", type: "text",
      appliesToJobs: true, searchable: true,
    }).returning();

    await db.insert(referenceFieldValues).values({
      companyId, fieldDefinitionId: def.id,
      entityType: "job", entityId: jobId,
      textValue: "NOLEAK999",
    });

    const results = await universalSearch({ query: "NOLEAK999", companyId });
    const jobResult = results.find(r => r.type === "job" && r.id === jobId);
    expect(jobResult).toBeDefined();
    expect((jobResult as any)._matchedValue).toBeUndefined();
    expect((jobResult as any)._rank).toBeUndefined();
  });
});
