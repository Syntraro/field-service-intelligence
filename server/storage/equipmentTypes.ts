/**
 * EquipmentTypeRepository — tenant-owned equipment type catalog.
 *
 * Backs the searchable combobox in the Add Equipment dialog. Vertical-agnostic:
 * each tenant manages their own list (RTU, Walk-in Cooler, Boiler, custom).
 */
import { db } from "../db";
import { eq, and, sql, asc } from "drizzle-orm";
import { equipmentTypes } from "@shared/schema";
import type { EquipmentType } from "@shared/schema";
import { BaseRepository } from "./base";

export class EquipmentTypeRepository extends BaseRepository {
  /** List active types for a tenant, ordered by name (case-insensitive). */
  async listActive(companyId: string): Promise<EquipmentType[]> {
    this.assertCompanyId(companyId);
    return db
      .select()
      .from(equipmentTypes)
      .where(and(eq(equipmentTypes.companyId, companyId), eq(equipmentTypes.active, true)))
      .orderBy(asc(sql`lower(${equipmentTypes.name})`));
  }

  /**
   * Create-or-return: trims input, returns the existing row if a
   * case-insensitive match already exists for this tenant. Avoids
   * duplicates from the create-on-the-fly UX (typing "boiler" twice
   * shouldn't make two rows).
   */
  async createOrGet(companyId: string, rawName: string): Promise<EquipmentType> {
    this.assertCompanyId(companyId);
    const name = rawName.trim();
    if (!name) {
      throw new Error("Equipment type name cannot be empty");
    }

    const existing = await db
      .select()
      .from(equipmentTypes)
      .where(
        and(
          eq(equipmentTypes.companyId, companyId),
          sql`lower(${equipmentTypes.name}) = lower(${name})`,
        ),
      )
      .limit(1);

    if (existing[0]) {
      // If the row was previously deactivated, surface it as active again
      // so the user can pick it (one canonical row per name per tenant).
      if (!existing[0].active) {
        const [reactivated] = await db
          .update(equipmentTypes)
          .set({ active: true, updatedAt: new Date() })
          .where(eq(equipmentTypes.id, existing[0].id))
          .returning();
        return reactivated;
      }
      return existing[0];
    }

    const [created] = await db
      .insert(equipmentTypes)
      .values({ companyId, name })
      .returning();
    return created;
  }
}

export const equipmentTypeRepository = new EquipmentTypeRepository();
