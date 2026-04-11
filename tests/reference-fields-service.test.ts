/**
 * Reference Fields Service Tests (2026-04-10)
 *
 * Validates business logic in the centralized reference fields service.
 *
 * Definitions:
 *   D1. create valid definition
 *   D2. reject duplicate key in same tenant
 *   D3. reject zero applies-to
 *   D4. update mutable fields only (key/type immutable)
 *   D5. deactivate preserves values
 *
 * Values:
 *   V1. getEntityFields returns applicable active definitions
 *   V2. save valid text value for job
 *   V3. save valid number value for invoice
 *   V4. reject text payload for number field
 *   V5. reject field applied to wrong entity type
 *   V6. reject inactive field for new value
 *   V7. replace-all removes omitted values
 *   V8. duplicate definition ids in submission rejected
 *   V9. atomic rollback on mixed valid/invalid payload
 *   V10. list values ordered by display_order then label
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../server/db";
import {
  referenceFieldDefinitions,
  referenceFieldValues,
  companies,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import * as service from "../server/services/referenceFieldsService";
import { referenceFieldRepository } from "../server/storage/referenceFields";
import { v4 as uuidv4 } from "uuid";

const TEST_PREFIX = "ref_svc_test_";
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

describe("Reference Fields Service — Definitions", () => {
  it("D1. create valid definition", async () => {
    const def = await service.createDefinition(companyId, {
      label: "PO Number",
      key: "po_number",
      type: "text",
      appliesToJobs: true,
      appliesToInvoices: true,
    });
    expect(def.label).toBe("PO Number");
    expect(def.key).toBe("po_number");
    expect(def.type).toBe("text");
    expect(def.appliesToJobs).toBe(true);
    expect(def.appliesToInvoices).toBe(true);
    expect(def.appliesToQuotes).toBe(false);
    expect(def.active).toBe(true);
    expect(def.searchable).toBe(true);
  });

  it("D2. reject duplicate key in same tenant", async () => {
    await service.createDefinition(companyId, {
      label: "Field A",
      key: "dup_key",
      type: "text",
      appliesToJobs: true,
    });
    await expect(
      service.createDefinition(companyId, {
        label: "Field B",
        key: "dup_key",
        type: "number",
        appliesToQuotes: true,
      })
    ).rejects.toThrow(/already exists/i);
  });

  it("D3. reject zero applies-to", async () => {
    await expect(
      service.createDefinition(companyId, {
        label: "No Target",
        key: "no_target",
        type: "text",
      })
    ).rejects.toThrow(/at least one/i);
  });

  it("D4. update mutable fields, key/type remain unchanged", async () => {
    const def = await service.createDefinition(companyId, {
      label: "Original",
      key: "immutable_test",
      type: "text",
      appliesToJobs: true,
      displayOrder: 0,
    });

    const updated = await service.updateDefinition(companyId, def.id, {
      label: "Updated Label",
      displayOrder: 5,
      appliesToQuotes: true,
    });

    expect(updated.label).toBe("Updated Label");
    expect(updated.displayOrder).toBe(5);
    expect(updated.appliesToQuotes).toBe(true);
    // key and type unchanged (storage doesn't update them)
    expect(updated.key).toBe("immutable_test");
    expect(updated.type).toBe("text");
  });

  it("D5. deactivate preserves historical values", async () => {
    const def = await service.createDefinition(companyId, {
      label: "Deactivate Test",
      key: "deactivate_test",
      type: "text",
      appliesToJobs: true,
    });

    const entityId = uuidv4();
    await service.saveEntityValues(companyId, "job", entityId, [
      { fieldDefinitionId: def.id, textValue: "keep-me" },
    ]);

    const deactivated = await service.deactivateDefinition(companyId, def.id);
    expect(deactivated.active).toBe(false);

    // Value still exists
    const count = await referenceFieldRepository.countValuesForDefinition(companyId, def.id);
    expect(count).toBe(1);
  });

  it("D6. creating 21st definition is rejected (limit=20)", async () => {
    // Create exactly 20 definitions
    for (let i = 0; i < 20; i++) {
      await service.createDefinition(companyId, {
        label: `Limit Field ${i}`,
        key: `limit_field_${i}`,
        type: "text",
        appliesToJobs: true,
      });
    }

    // 21st must be rejected
    await expect(
      service.createDefinition(companyId, {
        label: "Over Limit",
        key: "over_limit",
        type: "text",
        appliesToJobs: true,
      })
    ).rejects.toThrow(/maximum of 20/i);
  });

  it("D7. creating 20th definition succeeds", async () => {
    // Create 19 definitions
    for (let i = 0; i < 19; i++) {
      await service.createDefinition(companyId, {
        label: `OK Field ${i}`,
        key: `ok_field_${i}`,
        type: "text",
        appliesToJobs: true,
      });
    }

    // 20th should succeed
    const twentieth = await service.createDefinition(companyId, {
      label: "Twentieth",
      key: "twentieth_field",
      type: "text",
      appliesToJobs: true,
    });
    expect(twentieth.label).toBe("Twentieth");
  });
});

describe("Reference Fields Service — Values", () => {
  it("V1. getEntityFields returns applicable active definitions", async () => {
    await service.createDefinition(companyId, {
      label: "Job Field",
      key: "job_only",
      type: "text",
      appliesToJobs: true,
    });
    await service.createDefinition(companyId, {
      label: "Quote Field",
      key: "quote_only",
      type: "text",
      appliesToQuotes: true,
    });

    const jobFields = await service.getEntityFields(companyId, "job", uuidv4());
    expect(jobFields.length).toBe(1);
    expect(jobFields[0].definition.key).toBe("job_only");

    const quoteFields = await service.getEntityFields(companyId, "quote", uuidv4());
    expect(quoteFields.length).toBe(1);
    expect(quoteFields[0].definition.key).toBe("quote_only");
  });

  it("V2. save valid text value for job", async () => {
    const def = await service.createDefinition(companyId, {
      label: "Claim #",
      key: "claim_number",
      type: "text",
      appliesToJobs: true,
    });

    const entityId = uuidv4();
    await service.saveEntityValues(companyId, "job", entityId, [
      { fieldDefinitionId: def.id, textValue: "CLM-001" },
    ]);

    const fields = await service.getEntityFields(companyId, "job", entityId);
    expect(fields[0].value?.textValue).toBe("CLM-001");
  });

  it("V3. save valid text value for invoice", async () => {
    const def = await service.createDefinition(companyId, {
      label: "Invoice Ref",
      key: "inv_ref",
      appliesToInvoices: true,
    });

    const entityId = uuidv4();
    await service.saveEntityValues(companyId, "invoice", entityId, [
      { fieldDefinitionId: def.id, textValue: "REF-42" },
    ]);

    const fields = await service.getEntityFields(companyId, "invoice", entityId);
    expect(fields[0].value?.textValue).toBe("REF-42");
  });

  it("V4. blank text value removes field value", async () => {
    const def = await service.createDefinition(companyId, {
      label: "Clearable",
      key: "clearable_field",
      appliesToJobs: true,
    });

    const entityId = uuidv4();
    // Set a value
    await service.saveEntityValues(companyId, "job", entityId, [
      { fieldDefinitionId: def.id, textValue: "initial" },
    ]);

    // Clear it by sending blank
    await service.saveEntityValues(companyId, "job", entityId, [
      { fieldDefinitionId: def.id, textValue: "" },
    ]);

    // Value should be gone (blank = remove)
    const fields = await service.getEntityFields(companyId, "job", entityId);
    const valForDef = fields.find(f => f.definition.id === def.id);
    expect(valForDef?.value).toBeNull();
  });

  it("V5. reject field applied to wrong entity type", async () => {
    const def = await service.createDefinition(companyId, {
      label: "Jobs Only",
      key: "jobs_only_v5",
      type: "text",
      appliesToJobs: true,
    });

    await expect(
      service.saveEntityValues(companyId, "invoice", uuidv4(), [
        { fieldDefinitionId: def.id, textValue: "nope" },
      ])
    ).rejects.toThrow(/does not apply/i);
  });

  it("V6. reject inactive field for new value", async () => {
    const def = await service.createDefinition(companyId, {
      label: "Inactive",
      key: "inactive_field",
      type: "text",
      appliesToJobs: true,
    });
    await service.deactivateDefinition(companyId, def.id);

    await expect(
      service.saveEntityValues(companyId, "job", uuidv4(), [
        { fieldDefinitionId: def.id, textValue: "should-fail" },
      ])
    ).rejects.toThrow(/inactive/i);
  });

  it("V7. replace-all removes omitted values", async () => {
    const def1 = await service.createDefinition(companyId, {
      label: "Field 1", key: "replace_a", type: "text", appliesToJobs: true,
    });
    const def2 = await service.createDefinition(companyId, {
      label: "Field 2", key: "replace_b", type: "text", appliesToJobs: true,
    });

    const entityId = uuidv4();

    // Save both
    await service.saveEntityValues(companyId, "job", entityId, [
      { fieldDefinitionId: def1.id, textValue: "val1" },
      { fieldDefinitionId: def2.id, textValue: "val2" },
    ]);

    let fields = await service.getEntityFields(companyId, "job", entityId);
    expect(fields.filter(f => f.value).length).toBe(2);

    // Save only def1 — def2 should be removed
    await service.saveEntityValues(companyId, "job", entityId, [
      { fieldDefinitionId: def1.id, textValue: "val1-updated" },
    ]);

    fields = await service.getEntityFields(companyId, "job", entityId);
    const withValues = fields.filter(f => f.value);
    expect(withValues.length).toBe(1);
    expect(withValues[0].value?.textValue).toBe("val1-updated");
  });

  it("V8. duplicate definition ids in submission rejected", async () => {
    const def = await service.createDefinition(companyId, {
      label: "Dup", key: "dup_submit", type: "text", appliesToJobs: true,
    });

    await expect(
      service.saveEntityValues(companyId, "job", uuidv4(), [
        { fieldDefinitionId: def.id, textValue: "a" },
        { fieldDefinitionId: def.id, textValue: "b" },
      ])
    ).rejects.toThrow(/duplicate/i);
  });

  it("V9. atomic rollback on mixed valid/invalid payload", async () => {
    const goodDef = await service.createDefinition(companyId, {
      label: "Good", key: "atomic_good", type: "text", appliesToJobs: true,
    });

    const entityId = uuidv4();

    // Submit: one valid field + one nonexistent field → whole thing fails
    await expect(
      service.saveEntityValues(companyId, "job", entityId, [
        { fieldDefinitionId: goodDef.id, textValue: "should-not-persist" },
        { fieldDefinitionId: uuidv4(), textValue: "bad-def" },
      ])
    ).rejects.toThrow(/not found/i);

    // Good value should NOT have been persisted
    const fields = await service.getEntityFields(companyId, "job", entityId);
    expect(fields.filter(f => f.value).length).toBe(0);
  });

  it("V10. list values ordered by display_order then label", async () => {
    const defC = await service.createDefinition(companyId, {
      label: "C Field", key: "order_c", type: "text", appliesToJobs: true, displayOrder: 2,
    });
    const defA = await service.createDefinition(companyId, {
      label: "A Field", key: "order_a", type: "text", appliesToJobs: true, displayOrder: 1,
    });
    const defB = await service.createDefinition(companyId, {
      label: "B Field", key: "order_b", type: "text", appliesToJobs: true, displayOrder: 1,
    });

    const entityId = uuidv4();
    await service.saveEntityValues(companyId, "job", entityId, [
      { fieldDefinitionId: defC.id, textValue: "c" },
      { fieldDefinitionId: defA.id, textValue: "a" },
      { fieldDefinitionId: defB.id, textValue: "b" },
    ]);

    const fields = await service.getEntityFields(companyId, "job", entityId);
    const labels = fields.map(f => f.definition.label);
    // displayOrder 1 first (A, B alphabetical), then displayOrder 2 (C)
    expect(labels).toEqual(["A Field", "B Field", "C Field"]);
  });
});
