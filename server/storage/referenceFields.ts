/**
 * Reference Fields Storage — Canonical repository for field definitions and values.
 *
 * 2026-04-10: Created as part of controlled reference fields system.
 * Single centralized storage file for both definitions and values.
 * No per-entity duplication. All methods are tenant-scoped.
 */

import { db } from "../db";
import { eq, and, asc, desc, inArray, sql } from "drizzle-orm";
import {
  referenceFieldDefinitions,
  referenceFieldValues,
  type ReferenceFieldDefinition,
  type ReferenceFieldValue,
  type ReferenceFieldEntityType,
} from "@shared/schema";
import { BaseRepository } from "./base";

export interface DefinitionListOptions {
  activeOnly?: boolean;
  entityType?: ReferenceFieldEntityType;
}

export class ReferenceFieldRepository extends BaseRepository {
  // ============================================================================
  // DEFINITIONS
  // ============================================================================

  async listDefinitions(
    companyId: string,
    options?: DefinitionListOptions,
  ): Promise<ReferenceFieldDefinition[]> {
    this.assertCompanyId(companyId);

    const conditions = [eq(referenceFieldDefinitions.companyId, companyId)];

    if (options?.activeOnly) {
      conditions.push(eq(referenceFieldDefinitions.active, true));
    }

    if (options?.entityType === "job") {
      conditions.push(eq(referenceFieldDefinitions.appliesToJobs, true));
    } else if (options?.entityType === "quote") {
      conditions.push(eq(referenceFieldDefinitions.appliesToQuotes, true));
    } else if (options?.entityType === "invoice") {
      conditions.push(eq(referenceFieldDefinitions.appliesToInvoices, true));
    }

    return db
      .select()
      .from(referenceFieldDefinitions)
      .where(and(...conditions))
      .orderBy(
        asc(referenceFieldDefinitions.displayOrder),
        asc(referenceFieldDefinitions.label),
      );
  }

  async getDefinitionById(
    companyId: string,
    definitionId: string,
  ): Promise<ReferenceFieldDefinition | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(definitionId, "definitionId");

    const [row] = await db
      .select()
      .from(referenceFieldDefinitions)
      .where(and(
        eq(referenceFieldDefinitions.id, definitionId),
        eq(referenceFieldDefinitions.companyId, companyId),
      ))
      .limit(1);

    return row ?? null;
  }

  async getDefinitionByKey(
    companyId: string,
    key: string,
  ): Promise<ReferenceFieldDefinition | null> {
    this.assertCompanyId(companyId);

    const [row] = await db
      .select()
      .from(referenceFieldDefinitions)
      .where(and(
        eq(referenceFieldDefinitions.key, key),
        eq(referenceFieldDefinitions.companyId, companyId),
      ))
      .limit(1);

    return row ?? null;
  }

  async createDefinition(
    companyId: string,
    input: {
      label: string;
      key: string;
      type: string;
      appliesToJobs: boolean;
      appliesToQuotes: boolean;
      appliesToInvoices: boolean;
      searchable: boolean;
      active: boolean;
      displayOrder: number;
    },
  ): Promise<ReferenceFieldDefinition> {
    this.assertCompanyId(companyId);

    const [row] = await db
      .insert(referenceFieldDefinitions)
      .values({ companyId, ...input })
      .returning();

    return row;
  }

  async updateDefinition(
    companyId: string,
    definitionId: string,
    input: Partial<{
      label: string;
      appliesToJobs: boolean;
      appliesToQuotes: boolean;
      appliesToInvoices: boolean;
      searchable: boolean;
      active: boolean;
      displayOrder: number;
    }>,
  ): Promise<ReferenceFieldDefinition> {
    this.assertCompanyId(companyId);
    this.validateUUID(definitionId, "definitionId");

    const [row] = await db
      .update(referenceFieldDefinitions)
      .set({ ...input, updatedAt: new Date() })
      .where(and(
        eq(referenceFieldDefinitions.id, definitionId),
        eq(referenceFieldDefinitions.companyId, companyId),
      ))
      .returning();

    if (!row) throw this.notFoundError("Reference field definition");
    return row;
  }

  async countDefinitions(companyId: string): Promise<number> {
    this.assertCompanyId(companyId);

    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(referenceFieldDefinitions)
      .where(eq(referenceFieldDefinitions.companyId, companyId));

    return result?.count ?? 0;
  }

  async countValuesForDefinition(
    companyId: string,
    definitionId: string,
  ): Promise<number> {
    this.assertCompanyId(companyId);
    this.validateUUID(definitionId, "definitionId");

    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(referenceFieldValues)
      .where(and(
        eq(referenceFieldValues.companyId, companyId),
        eq(referenceFieldValues.fieldDefinitionId, definitionId),
      ));

    return result?.count ?? 0;
  }

  // ============================================================================
  // VALUES
  // ============================================================================

  /**
   * Get all values for a specific entity, joined with definition metadata.
   * Returns values ordered by definition display_order, then label.
   */
  async listValuesForEntity(
    companyId: string,
    entityType: string,
    entityId: string,
  ): Promise<Array<ReferenceFieldValue & {
    definitionLabel: string;
    definitionKey: string;
    definitionType: string;
    definitionActive: boolean;
    definitionDisplayOrder: number;
  }>> {
    this.assertCompanyId(companyId);
    this.validateUUID(entityId, "entityId");

    const rows = await db
      .select({
        id: referenceFieldValues.id,
        companyId: referenceFieldValues.companyId,
        fieldDefinitionId: referenceFieldValues.fieldDefinitionId,
        entityType: referenceFieldValues.entityType,
        entityId: referenceFieldValues.entityId,
        textValue: referenceFieldValues.textValue,
        createdAt: referenceFieldValues.createdAt,
        updatedAt: referenceFieldValues.updatedAt,
        definitionLabel: referenceFieldDefinitions.label,
        definitionKey: referenceFieldDefinitions.key,
        definitionType: referenceFieldDefinitions.type,
        definitionActive: referenceFieldDefinitions.active,
        definitionDisplayOrder: referenceFieldDefinitions.displayOrder,
      })
      .from(referenceFieldValues)
      .innerJoin(
        referenceFieldDefinitions,
        eq(referenceFieldValues.fieldDefinitionId, referenceFieldDefinitions.id),
      )
      .where(and(
        eq(referenceFieldValues.companyId, companyId),
        eq(referenceFieldValues.entityType, entityType),
        eq(referenceFieldValues.entityId, entityId),
      ))
      .orderBy(
        asc(referenceFieldDefinitions.displayOrder),
        asc(referenceFieldDefinitions.label),
      );

    return rows;
  }

  async getValue(
    companyId: string,
    fieldDefinitionId: string,
    entityType: string,
    entityId: string,
  ): Promise<ReferenceFieldValue | null> {
    this.assertCompanyId(companyId);

    const [row] = await db
      .select()
      .from(referenceFieldValues)
      .where(and(
        eq(referenceFieldValues.companyId, companyId),
        eq(referenceFieldValues.fieldDefinitionId, fieldDefinitionId),
        eq(referenceFieldValues.entityType, entityType),
        eq(referenceFieldValues.entityId, entityId),
      ))
      .limit(1);

    return row ?? null;
  }

  /**
   * Upsert a single field value. Uses the unique constraint for conflict resolution.
   */
  async upsertValue(
    companyId: string,
    input: {
      fieldDefinitionId: string;
      entityType: string;
      entityId: string;
      textValue: string | null;
    },
    txDb?: typeof db,
  ): Promise<ReferenceFieldValue> {
    this.assertCompanyId(companyId);

    const target = txDb ?? db;

    const [row] = await target
      .insert(referenceFieldValues)
      .values({
        companyId,
        fieldDefinitionId: input.fieldDefinitionId,
        entityType: input.entityType,
        entityId: input.entityId,
        textValue: input.textValue,
      })
      .onConflictDoUpdate({
        target: [
          referenceFieldValues.companyId,
          referenceFieldValues.fieldDefinitionId,
          referenceFieldValues.entityType,
          referenceFieldValues.entityId,
        ],
        set: {
          textValue: input.textValue,
          updatedAt: new Date(),
        },
      })
      .returning();

    return row;
  }

  /**
   * Delete values for an entity whose definition IDs are NOT in the retained set.
   * Used during replace-all save to clean up omitted fields.
   */
  async deleteValuesForEntityExcept(
    companyId: string,
    entityType: string,
    entityId: string,
    retainedDefinitionIds: string[],
    txDb?: typeof db,
  ): Promise<void> {
    this.assertCompanyId(companyId);

    const target = txDb ?? db;

    if (retainedDefinitionIds.length === 0) {
      // Delete ALL values for this entity
      await target
        .delete(referenceFieldValues)
        .where(and(
          eq(referenceFieldValues.companyId, companyId),
          eq(referenceFieldValues.entityType, entityType),
          eq(referenceFieldValues.entityId, entityId),
        ));
    } else {
      // Delete values NOT in the retained set
      await target
        .delete(referenceFieldValues)
        .where(and(
          eq(referenceFieldValues.companyId, companyId),
          eq(referenceFieldValues.entityType, entityType),
          eq(referenceFieldValues.entityId, entityId),
          sql`${referenceFieldValues.fieldDefinitionId} NOT IN (${sql.join(
            retainedDefinitionIds.map(id => sql`${id}`),
            sql`, `,
          )})`,
        ));
    }
  }
}

export const referenceFieldRepository = new ReferenceFieldRepository();
