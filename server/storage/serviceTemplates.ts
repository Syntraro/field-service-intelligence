/**
 * Service Templates repository (2026-05-18 RALPH Phase 1).
 *
 * Flat-rate service templates: single customer-facing line items with
 * internal component breakdown for cost estimation and operational
 * guidance. Components are NEVER exposed on invoices or synced to QBO.
 *
 * All methods scope reads/writes by companyId (tenant isolation).
 * Soft-delete via deleted_at — active queries always filter WHERE deleted_at IS NULL.
 */
import { db } from "../db";
import { and, eq, isNull, inArray, sql, asc, desc } from "drizzle-orm";
import {
  serviceTemplates,
  serviceTemplateComponents,
  items,
  type ServiceTemplate,
  type ServiceTemplateComponent,
  type ServiceTemplateWithComponents,
} from "@shared/schema";
import { BaseRepository } from "./base";

export class ServiceTemplateNameConflictError extends Error {
  constructor(name: string) {
    super(`A service template named "${name}" already exists`);
    this.name = "ServiceTemplateNameConflictError";
  }
}

export class ServiceTemplateNotFoundError extends Error {
  constructor() {
    super("Service template not found");
    this.name = "ServiceTemplateNotFoundError";
  }
}

export class ServiceTemplateComponentItemError extends Error {
  constructor(itemId: string) {
    super(`Catalog item ${itemId} not found or belongs to a different tenant`);
    this.name = "ServiceTemplateComponentItemError";
  }
}

export interface CreateServiceTemplateInput {
  name: string;
  internalName?: string | null;
  description?: string | null;
  internalNotes?: string | null;
  category?: string | null;
  subcategory?: string | null;
  flatRatePrice: string;
  estimatedDurationMinutes?: number | null;
  requiredSkillTags?: string[];
  teamSizeRequired?: number;
}

export interface UpdateServiceTemplateInput {
  name?: string;
  internalName?: string | null;
  description?: string | null;
  internalNotes?: string | null;
  category?: string | null;
  subcategory?: string | null;
  flatRatePrice?: string;
  estimatedDurationMinutes?: number | null;
  requiredSkillTags?: string[];
  teamSizeRequired?: number;
  isActive?: boolean;
}

export interface SetComponentInput {
  itemId: string;
  quantity: string;
  unitCostSnapshot?: string | null;
  sortOrder?: number;
  notes?: string | null;
}

class ServiceTemplateRepository extends BaseRepository {
  /** List all active (non-deleted) templates for a tenant. */
  async listForCompany(companyId: string): Promise<ServiceTemplateWithComponents[]> {
    this.assertCompanyId(companyId);

    const rows = await db
      .select()
      .from(serviceTemplates)
      .where(
        and(
          eq(serviceTemplates.companyId, companyId),
          isNull(serviceTemplates.deletedAt),
        ),
      )
      .orderBy(desc(serviceTemplates.usageCount), asc(serviceTemplates.name));

    if (rows.length === 0) return [];

    const templateIds = rows.map((r) => r.id);

    const componentRows = await db
      .select({
        component: serviceTemplateComponents,
        itemName: items.name,
        itemType: items.type,
      })
      .from(serviceTemplateComponents)
      .innerJoin(items, eq(serviceTemplateComponents.itemId, items.id))
      .where(
        and(
          eq(serviceTemplateComponents.companyId, companyId),
          inArray(serviceTemplateComponents.templateId, templateIds),
        ),
      )
      .orderBy(asc(serviceTemplateComponents.sortOrder));

    const componentsByTemplate = new Map<string, (ServiceTemplateComponent & { itemName: string | null; itemType: string | null })[]>();
    for (const row of componentRows) {
      const list = componentsByTemplate.get(row.component.templateId) ?? [];
      list.push({ ...row.component, itemName: row.itemName, itemType: row.itemType });
      componentsByTemplate.set(row.component.templateId, list);
    }

    return rows.map((t) => ({
      ...t,
      components: componentsByTemplate.get(t.id) ?? [],
    }));
  }

  /** Get a single template with its components. Returns null if not found or soft-deleted. */
  async getById(companyId: string, id: string): Promise<ServiceTemplateWithComponents | null> {
    this.assertCompanyId(companyId);

    const [template] = await db
      .select()
      .from(serviceTemplates)
      .where(
        and(
          eq(serviceTemplates.id, id),
          eq(serviceTemplates.companyId, companyId),
          isNull(serviceTemplates.deletedAt),
        ),
      )
      .limit(1);

    if (!template) return null;

    const componentRows = await db
      .select({
        component: serviceTemplateComponents,
        itemName: items.name,
        itemType: items.type,
      })
      .from(serviceTemplateComponents)
      .innerJoin(items, eq(serviceTemplateComponents.itemId, items.id))
      .where(eq(serviceTemplateComponents.templateId, id))
      .orderBy(asc(serviceTemplateComponents.sortOrder));

    return {
      ...template,
      components: componentRows.map((r) => ({
        ...r.component,
        itemName: r.itemName,
        itemType: r.itemType,
      })),
    };
  }

  /** Create a new template (no components). */
  async create(
    companyId: string,
    userId: string | null,
    input: CreateServiceTemplateInput,
  ): Promise<ServiceTemplateWithComponents> {
    this.assertCompanyId(companyId);

    await this._assertNameAvailable(companyId, input.name);

    const [created] = await db
      .insert(serviceTemplates)
      .values({
        companyId,
        userId,
        name: input.name,
        internalName: input.internalName ?? null,
        description: input.description ?? null,
        internalNotes: input.internalNotes ?? null,
        category: input.category ?? null,
        subcategory: input.subcategory ?? null,
        flatRatePrice: input.flatRatePrice,
        estimatedDurationMinutes: input.estimatedDurationMinutes ?? null,
        requiredSkillTags: input.requiredSkillTags ?? [],
        teamSizeRequired: input.teamSizeRequired ?? 1,
        isActive: true,
        usageCount: 0,
      })
      .returning();

    return { ...created, components: [] };
  }

  /** Update mutable fields. Returns updated template with components, or null if not found. */
  async update(
    companyId: string,
    id: string,
    input: UpdateServiceTemplateInput,
  ): Promise<ServiceTemplateWithComponents | null> {
    this.assertCompanyId(companyId);

    const existing = await this.getById(companyId, id);
    if (!existing) return null;

    if (input.name && input.name !== existing.name) {
      await this._assertNameAvailable(companyId, input.name);
    }

    const [updated] = await db
      .update(serviceTemplates)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.internalName !== undefined && { internalName: input.internalName }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.internalNotes !== undefined && { internalNotes: input.internalNotes }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.subcategory !== undefined && { subcategory: input.subcategory }),
        ...(input.flatRatePrice !== undefined && { flatRatePrice: input.flatRatePrice }),
        ...(input.estimatedDurationMinutes !== undefined && { estimatedDurationMinutes: input.estimatedDurationMinutes }),
        ...(input.requiredSkillTags !== undefined && { requiredSkillTags: input.requiredSkillTags }),
        ...(input.teamSizeRequired !== undefined && { teamSizeRequired: input.teamSizeRequired }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(serviceTemplates.id, id),
          eq(serviceTemplates.companyId, companyId),
          isNull(serviceTemplates.deletedAt),
        ),
      )
      .returning();

    if (!updated) return null;

    return this.getById(companyId, id) as Promise<ServiceTemplateWithComponents>;
  }

  /**
   * Replace the component list for a template inside a single transaction.
   * Deletes all existing components, then inserts the new set.
   * Validates each itemId belongs to the tenant.
   */
  async setComponents(
    companyId: string,
    templateId: string,
    components: SetComponentInput[],
  ): Promise<ServiceTemplateWithComponents | null> {
    this.assertCompanyId(companyId);

    const existing = await this.getById(companyId, templateId);
    if (!existing) return null;

    if (components.length > 0) {
      const itemIds = components.map((c) => c.itemId);
      const foundItems = await db
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.companyId, companyId), inArray(items.id, itemIds)));

      if (foundItems.length !== itemIds.length) {
        const found = new Set(foundItems.map((i) => i.id));
        const missing = itemIds.find((id) => !found.has(id))!;
        throw new ServiceTemplateComponentItemError(missing);
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(serviceTemplateComponents)
        .where(eq(serviceTemplateComponents.templateId, templateId));

      if (components.length > 0) {
        await tx.insert(serviceTemplateComponents).values(
          components.map((c, idx) => ({
            companyId,
            templateId,
            itemId: c.itemId,
            quantity: c.quantity,
            unitCostSnapshot: c.unitCostSnapshot ?? null,
            sortOrder: c.sortOrder ?? idx,
            notes: c.notes ?? null,
          })),
        );
      }
    });

    return this.getById(companyId, templateId);
  }

  /** Soft-delete a template. Returns true if found and deleted, false if not found. */
  async softDelete(companyId: string, id: string): Promise<boolean> {
    this.assertCompanyId(companyId);

    const [result] = await db
      .update(serviceTemplates)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(serviceTemplates.id, id),
          eq(serviceTemplates.companyId, companyId),
          isNull(serviceTemplates.deletedAt),
        ),
      )
      .returning({ id: serviceTemplates.id });

    return !!result;
  }

  /** Atomically increment usage_count when a template is applied. */
  async incrementUsage(companyId: string, id: string): Promise<void> {
    this.assertCompanyId(companyId);

    await db
      .update(serviceTemplates)
      .set({ usageCount: sql`${serviceTemplates.usageCount} + 1` })
      .where(
        and(
          eq(serviceTemplates.id, id),
          eq(serviceTemplates.companyId, companyId),
          isNull(serviceTemplates.deletedAt),
        ),
      );
  }

  private async _assertNameAvailable(companyId: string, name: string): Promise<void> {
    const [conflict] = await db
      .select({ id: serviceTemplates.id })
      .from(serviceTemplates)
      .where(
        and(
          eq(serviceTemplates.companyId, companyId),
          eq(serviceTemplates.name, name),
          isNull(serviceTemplates.deletedAt),
        ),
      )
      .limit(1);

    if (conflict) throw new ServiceTemplateNameConflictError(name);
  }
}

export const serviceTemplateRepository = new ServiceTemplateRepository();
