/**
 * Reference Fields Service — Canonical business logic for field definitions and values.
 *
 * 2026-04-10: Created as part of controlled reference fields system.
 * Owns validation, applicability checks, type/value enforcement, atomic save.
 * Single centralized service — no per-entity duplication.
 *
 * Blank-value policy: blank/empty/whitespace-only text = REMOVE value.
 * Null/undefined number or date = REMOVE value.
 * This keeps the values table clean — no null-valued rows.
 */

import { db } from "../db";
import {
  referenceFieldDefinitions,
  referenceFieldValues,
  type ReferenceFieldDefinition,
  type ReferenceFieldEntityType,
  referenceFieldEntityTypeEnum,
  referenceFieldTypeEnum,
} from "@shared/schema";
import {
  referenceFieldRepository,
  type DefinitionListOptions,
} from "../storage/referenceFields";

// ============================================================================
// TYPES
// ============================================================================

interface CreateDefinitionInput {
  label: string;
  key?: string;    // auto-generated from label if not provided
  type?: string;   // hardcoded to "text"
  appliesToJobs?: boolean;
  appliesToQuotes?: boolean;
  appliesToInvoices?: boolean;
  // 2026-04-22 Phase 2b
  appliesToCustomers?: boolean;
  appliesToLocations?: boolean;
  appliesToProducts?: boolean;
  searchable?: boolean;
  displayOrder?: number;
}

interface UpdateDefinitionInput {
  label?: string;
  appliesToJobs?: boolean;
  appliesToQuotes?: boolean;
  appliesToInvoices?: boolean;
  // 2026-04-22 Phase 2b
  appliesToCustomers?: boolean;
  appliesToLocations?: boolean;
  appliesToProducts?: boolean;
  searchable?: boolean;
  active?: boolean;
  displayOrder?: number;
}

interface SubmittedFieldValue {
  fieldDefinitionId: string;
  textValue?: string | null;
}

/** Returned by getEntityFields — definition + optional current value */
export interface EntityFieldWithValue {
  definition: ReferenceFieldDefinition;
  value: {
    textValue: string | null;
  } | null;
}

// ============================================================================
// HELPERS
// ============================================================================

const VALID_ENTITY_TYPES = new Set(referenceFieldEntityTypeEnum);
const VALID_FIELD_TYPES = new Set(referenceFieldTypeEnum);

function assertEntityType(entityType: string): asserts entityType is ReferenceFieldEntityType {
  if (!VALID_ENTITY_TYPES.has(entityType as any)) {
    const err = new Error(`Invalid entity type: ${entityType}. Must be one of: ${referenceFieldEntityTypeEnum.join(", ")}`);
    (err as any).statusCode = 400;
    throw err;
  }
}

function definitionAppliesToEntity(def: ReferenceFieldDefinition, entityType: ReferenceFieldEntityType): boolean {
  if (entityType === "job") return def.appliesToJobs;
  if (entityType === "quote") return def.appliesToQuotes;
  if (entityType === "invoice") return def.appliesToInvoices;
  // 2026-04-22 Phase 2b
  if (entityType === "customer_company") return def.appliesToCustomers;
  if (entityType === "client_location") return def.appliesToLocations;
  if (entityType === "item") return def.appliesToProducts;
  return false;
}

function makeError(status: number, message: string): Error {
  const err = new Error(message);
  (err as any).statusCode = status;
  return err;
}

// ============================================================================
// SERVICE
// ============================================================================

// ── Definitions ──

export async function listDefinitions(
  companyId: string,
  options?: DefinitionListOptions,
): Promise<ReferenceFieldDefinition[]> {
  return referenceFieldRepository.listDefinitions(companyId, options);
}

export async function createDefinition(
  companyId: string,
  input: CreateDefinitionInput,
): Promise<ReferenceFieldDefinition> {
  // Tenant-level limit guard
  const MAX_DEFINITIONS = 20;
  const count = await referenceFieldRepository.countDefinitions(companyId);
  if (count >= MAX_DEFINITIONS) {
    throw makeError(400, "Maximum of 20 reference fields reached.");
  }

  // Normalize
  const label = (input.label ?? "").trim();
  if (!label) throw makeError(400, "Label is required");

  // 2026-04-10: Key auto-generated from label. Type hardcoded to text.
  // Key and type are internal — not user-facing.
  const key = (input.key ?? label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    || "field";
  const type = "text";

  const appliesToJobs = input.appliesToJobs ?? false;
  const appliesToQuotes = input.appliesToQuotes ?? false;
  const appliesToInvoices = input.appliesToInvoices ?? false;
  // 2026-04-22 Phase 2b
  const appliesToCustomers = input.appliesToCustomers ?? false;
  const appliesToLocations = input.appliesToLocations ?? false;
  const appliesToProducts = input.appliesToProducts ?? false;

  if (
    !appliesToJobs &&
    !appliesToQuotes &&
    !appliesToInvoices &&
    !appliesToCustomers &&
    !appliesToLocations &&
    !appliesToProducts
  ) {
    throw makeError(400, "At least one 'applies to' option must be selected");
  }

  // Check key uniqueness within tenant
  const existing = await referenceFieldRepository.getDefinitionByKey(companyId, key);
  if (existing) {
    throw makeError(409, `A field with key "${key}" already exists`);
  }

  return referenceFieldRepository.createDefinition(companyId, {
    label,
    key,
    type,
    appliesToJobs,
    appliesToQuotes,
    appliesToInvoices,
    appliesToCustomers,
    appliesToLocations,
    appliesToProducts,
    searchable: input.searchable ?? true,
    active: true,
    displayOrder: input.displayOrder ?? 0,
  });
}

export async function updateDefinition(
  companyId: string,
  definitionId: string,
  input: UpdateDefinitionInput,
): Promise<ReferenceFieldDefinition> {
  const existing = await referenceFieldRepository.getDefinitionById(companyId, definitionId);
  if (!existing) throw makeError(404, "Reference field definition not found");

  // Compute effective applies-to values (merge update with existing)
  const effectiveJobs = input.appliesToJobs ?? existing.appliesToJobs;
  const effectiveQuotes = input.appliesToQuotes ?? existing.appliesToQuotes;
  const effectiveInvoices = input.appliesToInvoices ?? existing.appliesToInvoices;
  // 2026-04-22 Phase 2b
  const effectiveCustomers = input.appliesToCustomers ?? existing.appliesToCustomers;
  const effectiveLocations = input.appliesToLocations ?? existing.appliesToLocations;
  const effectiveProducts = input.appliesToProducts ?? existing.appliesToProducts;

  if (
    !effectiveJobs &&
    !effectiveQuotes &&
    !effectiveInvoices &&
    !effectiveCustomers &&
    !effectiveLocations &&
    !effectiveProducts
  ) {
    throw makeError(400, "At least one 'applies to' option must remain selected");
  }

  // Build update payload — only mutable fields
  const update: Record<string, any> = {};
  if (input.label !== undefined) update.label = input.label.trim();
  if (input.appliesToJobs !== undefined) update.appliesToJobs = input.appliesToJobs;
  if (input.appliesToQuotes !== undefined) update.appliesToQuotes = input.appliesToQuotes;
  if (input.appliesToInvoices !== undefined) update.appliesToInvoices = input.appliesToInvoices;
  if (input.appliesToCustomers !== undefined) update.appliesToCustomers = input.appliesToCustomers;
  if (input.appliesToLocations !== undefined) update.appliesToLocations = input.appliesToLocations;
  if (input.appliesToProducts !== undefined) update.appliesToProducts = input.appliesToProducts;
  if (input.searchable !== undefined) update.searchable = input.searchable;
  if (input.active !== undefined) update.active = input.active;
  if (input.displayOrder !== undefined) update.displayOrder = input.displayOrder;

  return referenceFieldRepository.updateDefinition(companyId, definitionId, update);
}

export async function deactivateDefinition(
  companyId: string,
  definitionId: string,
): Promise<ReferenceFieldDefinition> {
  return updateDefinition(companyId, definitionId, { active: false });
}

// ── Values ──

/**
 * Get all fields applicable to an entity, with their current values.
 * Returns active definitions applicable to entityType, PLUS any inactive
 * definitions that have existing values (for safe historical rendering).
 */
export async function getEntityFields(
  companyId: string,
  entityType: string,
  entityId: string,
): Promise<EntityFieldWithValue[]> {
  assertEntityType(entityType);

  // Get all active definitions for this entity type
  const activeDefs = await referenceFieldRepository.listDefinitions(companyId, {
    activeOnly: true,
    entityType: entityType as ReferenceFieldEntityType,
  });

  // Get all existing values for this entity (includes inactive defs with historical values)
  const existingValues = await referenceFieldRepository.listValuesForEntity(
    companyId,
    entityType,
    entityId,
  );

  // Build a value map keyed by definitionId
  const valueMap = new Map<string, typeof existingValues[number]>();
  existingValues.forEach((v) => valueMap.set(v.fieldDefinitionId, v));

  // Build result: active defs (with or without values) + inactive defs that have values
  const result: EntityFieldWithValue[] = [];
  const includedDefIds = new Set<string>();

  // Active definitions first (ordered by storage query)
  for (const def of activeDefs) {
    includedDefIds.add(def.id);
    const val = valueMap.get(def.id);
    result.push({
      definition: def,
      value: val
        ? { textValue: val.textValue }
        : null,
    });
  }

  // Inactive definitions that have existing values (historical)
  for (const val of existingValues) {
    if (includedDefIds.has(val.fieldDefinitionId)) continue;
    // This is an inactive definition with a historical value — include as read-only
    const def = await referenceFieldRepository.getDefinitionById(companyId, val.fieldDefinitionId);
    if (!def) continue; // orphaned value, skip
    result.push({
      definition: def,
      value: { textValue: val.textValue },
    });
  }

  return result;
}

/**
 * Atomic save of all reference field values for an entity.
 *
 * Replace-all behavior:
 * - Upserts values for submitted fields with non-empty values
 * - Deletes values for fields omitted from the submission
 * - Rolls back entirely on any validation error
 *
 * Blank-value policy: empty/whitespace text, null number/date = REMOVE (no null-valued rows).
 */
export async function saveEntityValues(
  companyId: string,
  entityType: string,
  entityId: string,
  submittedValues: SubmittedFieldValue[],
): Promise<void> {
  assertEntityType(entityType);

  // Reject duplicate definition IDs in submission
  const defIdSet = new Set<string>();
  for (const sv of submittedValues) {
    if (defIdSet.has(sv.fieldDefinitionId)) {
      throw makeError(400, `Duplicate field definition ID in submission: ${sv.fieldDefinitionId}`);
    }
    defIdSet.add(sv.fieldDefinitionId);
  }

  // Load all referenced definitions in one query
  const defIds = submittedValues.map((sv) => sv.fieldDefinitionId);
  const allDefs = defIds.length > 0
    ? await referenceFieldRepository.listDefinitions(companyId)
    : [];
  const defMap = new Map<string, ReferenceFieldDefinition>();
  allDefs.forEach((d) => defMap.set(d.id, d));

  // Validate each submitted value and build the upsert list
  const upserts: Array<{
    fieldDefinitionId: string;
    textValue: string | null;
  }> = [];

  for (const sv of submittedValues) {
    const def = defMap.get(sv.fieldDefinitionId);
    if (!def) {
      throw makeError(404, `Field definition not found: ${sv.fieldDefinitionId}`);
    }
    if (def.companyId !== companyId) {
      throw makeError(403, `Field definition does not belong to this tenant`);
    }
    if (!definitionAppliesToEntity(def, entityType as ReferenceFieldEntityType)) {
      throw makeError(400, `Field "${def.label}" does not apply to ${entityType}`);
    }

    // Normalize and validate value by type
    // 2026-04-10: All fields are text-only. No number/date branching.
    let textValue: string | null = null;
    const trimmed = (sv.textValue ?? "").trim();
    if (trimmed) {
      if (!def.active) {
        throw makeError(400, `Field "${def.label}" is inactive and cannot accept new values`);
      }
      textValue = trimmed;
    }

    // Only upsert if there's a non-empty value
    if (textValue) {
      upserts.push({ fieldDefinitionId: sv.fieldDefinitionId, textValue });
    }
  }

  // Atomic transaction: upsert retained values + delete omitted
  const retainedDefIds = upserts.map((u) => u.fieldDefinitionId);

  await db.transaction(async (txDb) => {
    // Upsert each non-empty value
    for (const u of upserts) {
      await referenceFieldRepository.upsertValue(
        companyId,
        { ...u, entityType, entityId },
        txDb as any,
      );
    }

    // Delete values for definitions not in the retained set
    await referenceFieldRepository.deleteValuesForEntityExcept(
      companyId,
      entityType,
      entityId,
      retainedDefIds,
      txDb as any,
    );
  });
}

/**
 * List active, searchable definitions for a tenant.
 * Used by search integration (Phase 7).
 */
export async function getSearchableDefinitions(
  companyId: string,
): Promise<ReferenceFieldDefinition[]> {
  const all = await referenceFieldRepository.listDefinitions(companyId, { activeOnly: true });
  return all.filter((d) => d.searchable);
}
