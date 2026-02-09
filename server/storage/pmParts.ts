/**
 * PM Parts Repository
 *
 * CRUD operations for location_pm_part_templates — the parts
 * that should be included every time a PM job is generated for a location.
 *
 * Bulk-upsert replaces the full set for a location in a single transaction.
 */

import { db } from "../db";
import { eq, and, isNull } from "drizzle-orm";
import { locationPMPartTemplates, items } from "@shared/schema";
import type { LocationPMPartTemplate } from "@shared/schema";
import { BaseRepository } from "./base";

/** Shape returned to the frontend — includes joined item fields. */
export interface PMPartWithItem extends LocationPMPartTemplate {
  itemName: string | null;
  itemSku: string | null;
  itemCategory: string | null;
  itemCost: string | null;
}

export class PMPartRepository extends BaseRepository {
  /**
   * Get all active PM part templates for a location, joined with item details.
   */
  async getLocationPMParts(companyId: string, locationId: string): Promise<PMPartWithItem[]> {
    this.assertCompanyId(companyId);

    const rows = await db
      .select({
        // All template columns
        id: locationPMPartTemplates.id,
        companyId: locationPMPartTemplates.companyId,
        locationId: locationPMPartTemplates.locationId,
        productId: locationPMPartTemplates.productId,
        equipmentId: locationPMPartTemplates.equipmentId,
        descriptionOverride: locationPMPartTemplates.descriptionOverride,
        quantityPerVisit: locationPMPartTemplates.quantityPerVisit,
        equipmentLabel: locationPMPartTemplates.equipmentLabel,
        isActive: locationPMPartTemplates.isActive,
        deletedAt: locationPMPartTemplates.deletedAt,
        createdAt: locationPMPartTemplates.createdAt,
        updatedAt: locationPMPartTemplates.updatedAt,
        // Joined item fields
        itemName: items.name,
        itemSku: items.sku,
        itemCategory: items.category,
        itemCost: items.cost,
      })
      .from(locationPMPartTemplates)
      .leftJoin(items, eq(locationPMPartTemplates.productId, items.id))
      .where(
        and(
          eq(locationPMPartTemplates.companyId, companyId),
          eq(locationPMPartTemplates.locationId, locationId),
          eq(locationPMPartTemplates.isActive, true),
          isNull(locationPMPartTemplates.deletedAt)
        )
      )
      .orderBy(locationPMPartTemplates.createdAt);

    return rows as PMPartWithItem[];
  }

  /**
   * Bulk-upsert PM parts for a location.
   *
   * Replaces the full set: parts not in the incoming list are soft-deleted,
   * existing parts are updated, new parts are inserted.
   */
  async bulkUpsertPMParts(
    companyId: string,
    locationId: string,
    parts: { productId: string; quantity: string }[]
  ): Promise<PMPartWithItem[]> {
    this.assertCompanyId(companyId);

    await this.tx(async (txDb) => {
      // 1. Get existing active templates for this location
      const existing = await txDb
        .select()
        .from(locationPMPartTemplates)
        .where(
          and(
            eq(locationPMPartTemplates.companyId, companyId),
            eq(locationPMPartTemplates.locationId, locationId),
            eq(locationPMPartTemplates.isActive, true),
            isNull(locationPMPartTemplates.deletedAt)
          )
        );

      const incomingProductIds = new Set(parts.map((p) => p.productId));
      const existingByProductId = new Map(existing.map((e) => [e.productId, e]));

      // 2. Soft-delete templates not in the incoming list
      const toDelete = existing.filter((e) => !incomingProductIds.has(e.productId));
      for (const row of toDelete) {
        await txDb
          .update(locationPMPartTemplates)
          .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(locationPMPartTemplates.id, row.id));
      }

      // 3. Upsert incoming parts
      for (const part of parts) {
        const existingRow = existingByProductId.get(part.productId);
        if (existingRow) {
          // Update quantity if changed
          if (existingRow.quantityPerVisit !== part.quantity) {
            await txDb
              .update(locationPMPartTemplates)
              .set({ quantityPerVisit: part.quantity, updatedAt: new Date() })
              .where(eq(locationPMPartTemplates.id, existingRow.id));
          }
        } else {
          // Insert new template
          await txDb
            .insert(locationPMPartTemplates)
            .values({
              companyId,
              locationId,
              productId: part.productId,
              quantityPerVisit: part.quantity,
            });
        }
      }
    });

    // Return the updated list (read after write)
    return this.getLocationPMParts(companyId, locationId);
  }
}

export const pmPartRepository = new PMPartRepository();
