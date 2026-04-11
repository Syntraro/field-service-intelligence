/**
 * Reference Fields Schema Constraint Tests (2026-04-10)
 *
 * Validates DB-level constraints on reference_field_definitions and reference_field_values.
 *
 * S1. Valid definition inserts successfully
 * S2. Duplicate key per tenant rejected
 * S3. Invalid type rejected
 * S4. Zero applies-to flags rejected
 * S5. Invalid entity_type rejected
 * S6. Multiple value columns rejected
 * S7. Valid value inserts successfully
 * S8. Duplicate field+entity value rejected (unique constraint)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../server/db";
import {
  referenceFieldDefinitions,
  referenceFieldValues,
  companies,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

const TEST_PREFIX = "ref_schema_test_";
let companyId: string;

beforeAll(async () => {
  companyId = uuidv4();
  await db.insert(companies).values({ id: companyId, name: `${TEST_PREFIX}company` });
});

afterAll(async () => {
  await db.delete(referenceFieldValues).where(eq(referenceFieldValues.companyId, companyId));
  await db.delete(referenceFieldDefinitions).where(eq(referenceFieldDefinitions.companyId, companyId));
  await db.delete(companies).where(eq(companies.id, companyId));
});

beforeEach(async () => {
  await db.delete(referenceFieldValues).where(eq(referenceFieldValues.companyId, companyId));
  await db.delete(referenceFieldDefinitions).where(eq(referenceFieldDefinitions.companyId, companyId));
});

describe("Reference Fields Schema Constraints", () => {
  it("S1. valid definition inserts successfully", async () => {
    const [def] = await db.insert(referenceFieldDefinitions).values({
      companyId,
      label: "PO Number",
      key: "po_number",
      type: "text",
      appliesToJobs: true,
    }).returning();

    expect(def.id).toBeDefined();
    expect(def.key).toBe("po_number");
    expect(def.active).toBe(true);
    expect(def.searchable).toBe(true);
  });

  it("S2. duplicate key per tenant rejected", async () => {
    await db.insert(referenceFieldDefinitions).values({
      companyId,
      label: "Field A",
      key: "duplicate_key",
      type: "text",
      appliesToJobs: true,
    });

    await expect(
      db.insert(referenceFieldDefinitions).values({
        companyId,
        label: "Field B",
        key: "duplicate_key",
        type: "text",
        appliesToInvoices: true,
      })
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("S3. invalid type rejected", async () => {
    await expect(
      db.insert(referenceFieldDefinitions).values({
        companyId,
        label: "Bad Type",
        key: "bad_type",
        type: "boolean", // not allowed
        appliesToJobs: true,
      })
    ).rejects.toThrow(/ref_field_defs_type_check|check constraint/i);
  });

  it("S4. zero applies-to flags rejected", async () => {
    await expect(
      db.insert(referenceFieldDefinitions).values({
        companyId,
        label: "No Applies",
        key: "no_applies",
        type: "text",
        appliesToJobs: false,
        appliesToQuotes: false,
        appliesToInvoices: false,
      })
    ).rejects.toThrow(/ref_field_defs_applies_to_check|check constraint/i);
  });

  it("S5. invalid entity_type rejected", async () => {
    const [def] = await db.insert(referenceFieldDefinitions).values({
      companyId,
      label: "Test",
      key: "entity_test",
      type: "text",
      appliesToJobs: true,
    }).returning();

    await expect(
      db.insert(referenceFieldValues).values({
        companyId,
        fieldDefinitionId: def.id,
        entityType: "client", // not allowed
        entityId: uuidv4(),
        textValue: "test",
      })
    ).rejects.toThrow(/ref_field_vals_entity_type_check|check constraint/i);
  });

  it("S6. type=number rejected by CHECK (text-only system)", async () => {
    await expect(
      db.insert(referenceFieldDefinitions).values({
        companyId,
        label: "Number Type",
        key: "number_type_test",
        type: "number", // not allowed — text only
        appliesToJobs: true,
      })
    ).rejects.toThrow(/ref_field_defs_type_check|check constraint/i);
  });

  it("S7. valid value inserts successfully", async () => {
    const [def] = await db.insert(referenceFieldDefinitions).values({
      companyId,
      label: "Claim Number",
      key: "claim_number",
      type: "text",
      appliesToJobs: true,
      appliesToInvoices: true,
    }).returning();

    const entityId = uuidv4();
    const [val] = await db.insert(referenceFieldValues).values({
      companyId,
      fieldDefinitionId: def.id,
      entityType: "job",
      entityId,
      textValue: "CLM-2024-001",
    }).returning();

    expect(val.id).toBeDefined();
    expect(val.textValue).toBe("CLM-2024-001");
  });

  it("S8. duplicate field+entity value rejected", async () => {
    const [def] = await db.insert(referenceFieldDefinitions).values({
      companyId,
      label: "Permit",
      key: "permit_uq_test",
      type: "text",
      appliesToJobs: true,
    }).returning();

    const entityId = uuidv4();
    await db.insert(referenceFieldValues).values({
      companyId,
      fieldDefinitionId: def.id,
      entityType: "job",
      entityId,
      textValue: "PERMIT-001",
    });

    await expect(
      db.insert(referenceFieldValues).values({
        companyId,
        fieldDefinitionId: def.id,
        entityType: "job",
        entityId, // same entity
        textValue: "PERMIT-002",
      })
    ).rejects.toThrow(/unique|duplicate/i);
  });
});
