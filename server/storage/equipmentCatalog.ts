/**
 * Equipment Catalog Repository — data access for equipment catalog items,
 * timeline, notes, and parts queries.
 *
 * Owns all reads/writes to equipmentCatalogItems and equipment-scoped
 * queries on jobEquipment, jobNotes, jobParts tables.
 *
 * 2026-04-08: Extracted from equipment.routes.ts to enforce Route→Service→Storage.
 */

import { db } from "../db";
import { eq, and, asc, desc, isNull } from "drizzle-orm";
import {
  equipmentCatalogItems, items, jobEquipment, jobs, jobVisits,
  users, jobNotes, jobParts, updateEquipmentCatalogItemSchema,
} from "@shared/schema";

export const equipmentCatalogRepository = {
  /**
   * Fetch catalog item associations with joined item data.
   */
  async getAssociationsWithItems(companyId: string, equipmentId: string) {
    const rows = await db
      .select({
        id: equipmentCatalogItems.id,
        equipmentId: equipmentCatalogItems.equipmentId,
        catalogItemId: equipmentCatalogItems.catalogItemId,
        quantity: equipmentCatalogItems.quantity,
        notes: equipmentCatalogItems.notes,
        sortOrder: equipmentCatalogItems.sortOrder,
        createdAt: equipmentCatalogItems.createdAt,
        updatedAt: equipmentCatalogItems.updatedAt,
        catalogItemName: items.name,
        catalogItemSku: items.sku,
        catalogItemType: items.type,
        catalogItemDescription: items.description,
        catalogItemUnitPrice: items.unitPrice,
      })
      .from(equipmentCatalogItems)
      .innerJoin(items, eq(equipmentCatalogItems.catalogItemId, items.id))
      .where(
        and(
          eq(equipmentCatalogItems.companyId, companyId),
          eq(equipmentCatalogItems.equipmentId, equipmentId),
        )
      )
      .orderBy(asc(equipmentCatalogItems.sortOrder), asc(equipmentCatalogItems.createdAt));

    return rows.map(r => ({
      id: r.id,
      equipmentId: r.equipmentId,
      catalogItemId: r.catalogItemId,
      quantity: r.quantity,
      notes: r.notes,
      sortOrder: r.sortOrder,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      catalogItem: {
        id: r.catalogItemId,
        name: r.catalogItemName,
        code: r.catalogItemSku,
        type: r.catalogItemType,
        description: r.catalogItemDescription,
        unitPrice: r.catalogItemUnitPrice,
      },
    }));
  },

  /**
   * Verify a catalog item exists and belongs to the company.
   */
  async verifyCatalogItemOwnership(companyId: string, catalogItemId: string) {
    const [row] = await db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.companyId, companyId), eq(items.id, catalogItemId)))
      .limit(1);
    return row ?? null;
  },

  /**
   * Check if a catalog item is already associated with this equipment.
   */
  async findExistingAssociation(companyId: string, equipmentId: string, catalogItemId: string) {
    const [row] = await db
      .select({ id: equipmentCatalogItems.id })
      .from(equipmentCatalogItems)
      .where(
        and(
          eq(equipmentCatalogItems.companyId, companyId),
          eq(equipmentCatalogItems.equipmentId, equipmentId),
          eq(equipmentCatalogItems.catalogItemId, catalogItemId),
        )
      )
      .limit(1);
    return row ?? null;
  },

  /**
   * Add a catalog item association.
   */
  async addAssociation(values: {
    companyId: string;
    equipmentId: string;
    catalogItemId: string;
    quantity: number;
    notes: string | null;
    sortOrder: number;
  }) {
    await db.insert(equipmentCatalogItems).values(values);
  },

  /**
   * Verify an association exists and belongs to equipment+company.
   */
  async getAssociation(companyId: string, equipmentId: string, associationId: string) {
    const [row] = await db
      .select({ id: equipmentCatalogItems.id })
      .from(equipmentCatalogItems)
      .where(
        and(
          eq(equipmentCatalogItems.companyId, companyId),
          eq(equipmentCatalogItems.id, associationId),
          eq(equipmentCatalogItems.equipmentId, equipmentId),
        )
      )
      .limit(1);
    return row ?? null;
  },

  /**
   * Update a catalog item association.
   */
  async updateAssociation(associationId: string, data: Record<string, unknown>) {
    await db
      .update(equipmentCatalogItems)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(equipmentCatalogItems.id, associationId));
  },

  /**
   * Delete a catalog item association.
   */
  async deleteAssociation(associationId: string) {
    await db
      .delete(equipmentCatalogItems)
      .where(eq(equipmentCatalogItems.id, associationId));
  },

  /**
   * Batch reorder catalog items (atomic — wrapped in transaction).
   */
  async reorderAssociations(companyId: string, equipmentId: string, orderedItems: Array<{ id: string; sortOrder: number }>) {
    await db.transaction(async (tx) => {
      for (const item of orderedItems) {
        await tx
          .update(equipmentCatalogItems)
          .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
          .where(
            and(
              eq(equipmentCatalogItems.companyId, companyId),
              eq(equipmentCatalogItems.id, item.id),
              eq(equipmentCatalogItems.equipmentId, equipmentId),
            )
          );
      }
    });
  },

  /**
   * Get equipment service timeline (visit-level history via job_equipment joins).
   */
  async getTimeline(companyId: string, equipmentId: string) {
    return db
      .select({
        visitId: jobVisits.id,
        jobId: jobs.id,
        jobNumber: jobs.jobNumber,
        jobType: jobs.jobType,
        jobSummary: jobs.summary,
        visitDate: jobVisits.scheduledStart,
        visitDateFallback: jobVisits.scheduledDate,
        visitStatus: jobVisits.status,
        visitNotes: jobVisits.visitNotes,
        outcome: jobVisits.outcome,
        outcomeNote: jobVisits.outcomeNote,
        completedAt: jobVisits.completedAt,
        equipmentNotes: jobEquipment.notes,
        assignedTechnicianIds: jobVisits.assignedTechnicianIds,
      })
      .from(jobEquipment)
      .innerJoin(jobs, eq(jobEquipment.jobId, jobs.id))
      .innerJoin(jobVisits, and(
        eq(jobVisits.jobId, jobs.id),
        eq(jobVisits.isActive, true),
        isNull(jobVisits.archivedAt),
      ))
      .where(
        and(
          eq(jobEquipment.companyId, companyId),
          eq(jobEquipment.equipmentId, equipmentId),
        )
      )
      .orderBy(desc(jobVisits.scheduledStart), desc(jobVisits.scheduledDate))
      .limit(50);
  },

  /**
   * Get notes linked to this equipment.
   */
  async getNotes(companyId: string, equipmentId: string) {
    return db
      .select({
        id: jobNotes.id,
        noteText: jobNotes.noteText,
        createdAt: jobNotes.createdAt,
        jobId: jobNotes.jobId,
        userName: users.fullName,
        userFirstName: users.firstName,
      })
      .from(jobNotes)
      .leftJoin(users, eq(jobNotes.userId, users.id))
      .where(
        and(
          eq(jobNotes.companyId, companyId),
          eq(jobNotes.equipmentId, equipmentId),
        )
      )
      .orderBy(desc(jobNotes.createdAt))
      .limit(50);
  },

  /**
   * Get active parts linked to this equipment.
   */
  async getParts(companyId: string, equipmentId: string) {
    return db
      .select({
        id: jobParts.id,
        description: jobParts.description,
        quantity: jobParts.quantity,
        createdAt: jobParts.createdAt,
        jobId: jobParts.jobId,
      })
      .from(jobParts)
      .where(
        and(
          eq(jobParts.companyId, companyId),
          eq(jobParts.equipmentId, equipmentId),
          isNull(jobParts.deletedAt),
        )
      )
      .orderBy(desc(jobParts.createdAt))
      .limit(50);
  },
};
