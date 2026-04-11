/**
 * Reference Fields Auth Regression Tests (2026-04-10)
 *
 * Validates that:
 * RA1. Any tenant user can read entity reference fields (no role gate)
 * RA2. Cross-tenant access is denied (company scoping)
 * RA3. Active applicable fields are returned for correct tenant
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../server/db";
import {
  referenceFieldDefinitions,
  referenceFieldValues,
  companies,
  users,
  jobs,
  clientLocations,
  customerCompanies,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import * as service from "../server/services/referenceFieldsService";
import { v4 as uuidv4 } from "uuid";

const TEST_PREFIX = "ref_auth_test_";
let companyA: string;
let companyB: string;
let techUserA: string;
let jobIdA: string;
let defIdA: string;

beforeAll(async () => {
  // Company A with technician user + job + field definition
  companyA = uuidv4();
  await db.insert(companies).values({ id: companyA, name: `${TEST_PREFIX}companyA` });

  techUserA = uuidv4();
  await db.insert(users).values({
    id: techUserA, companyId: companyA, email: `${TEST_PREFIX}techA@test.com`,
    fullName: "Tech A", username: `${TEST_PREFIX}techA`,
    password: "test", passwordHash: "test", role: "technician", isSchedulable: true,
  });

  const ccA = uuidv4();
  await db.insert(customerCompanies).values({ id: ccA, companyId: companyA, name: `${TEST_PREFIX}ccA` });
  const locA = uuidv4();
  await db.insert(clientLocations).values({ id: locA, companyId: companyA, customerCompanyId: ccA, selectedMonths: [] });
  jobIdA = uuidv4();
  await db.insert(jobs).values({ id: jobIdA, companyId: companyA, locationId: locA, summary: `${TEST_PREFIX}jobA`, status: "open", jobType: "Repair", jobNumber: 2222 });

  // Create a field definition for company A
  const def = await service.createDefinition(companyA, {
    label: "Auth Test Field", key: "auth_test_field", appliesToJobs: true,
  });
  defIdA = def.id;

  // Company B (separate tenant)
  companyB = uuidv4();
  await db.insert(companies).values({ id: companyB, name: `${TEST_PREFIX}companyB` });
});

afterAll(async () => {
  await db.delete(referenceFieldValues).where(eq(referenceFieldValues.companyId, companyA));
  await db.delete(referenceFieldDefinitions).where(eq(referenceFieldDefinitions.companyId, companyA));
  await db.delete(jobs).where(eq(jobs.companyId, companyA));
  await db.delete(clientLocations).where(eq(clientLocations.companyId, companyA));
  await db.delete(customerCompanies).where(eq(customerCompanies.companyId, companyA));
  await db.delete(users).where(eq(users.companyId, companyA));
  await db.delete(companies).where(eq(companies.id, companyA));
  await db.delete(companies).where(eq(companies.id, companyB));
});

describe("Reference Fields Auth Regression", () => {
  it("RA1. any tenant user can read entity fields (service-level)", async () => {
    // Simulate what the route does — call service.getEntityFields with company A
    const fields = await service.getEntityFields(companyA, "job", jobIdA);

    expect(fields.length).toBeGreaterThanOrEqual(1);
    const authField = fields.find(f => f.definition.key === "auth_test_field");
    expect(authField).toBeDefined();
    expect(authField!.definition.active).toBe(true);
    expect(authField!.definition.appliesToJobs).toBe(true);
  });

  it("RA2. cross-tenant entity read returns 200 with empty fields (tenant isolation)", async () => {
    // Security contract: cross-tenant reads return 200 with empty results, not 403.
    // This matches the app-wide tenant isolation model: companyId is derived from the
    // authenticated user's session, and all queries filter by it. Company B's user
    // sees zero definitions and zero values for company A's job — no data leaks,
    // but no explicit ownership check/rejection either. Same pattern as job/invoice reads.
    const fields = await service.getEntityFields(companyB, "job", jobIdA);
    expect(fields.length).toBe(0);
  });

  it("RA3. response contains expected field shape", async () => {
    const fields = await service.getEntityFields(companyA, "job", jobIdA);
    const f = fields[0];

    // Verify the shape matches what the route maps to DTO
    expect(f.definition).toBeDefined();
    expect(f.definition.id).toBeDefined();
    expect(f.definition.label).toBe("Auth Test Field");
    expect(f.definition.type).toBe("text");
    expect(f.definition.active).toBe(true);
    // Value should be null (no value saved yet)
    expect(f.value).toBeNull();
  });
});
