/**
 * Tax Repository — CRUD for tax rates, tax groups, and group-rate junctions.
 * All methods enforce tenant isolation via companyId.
 */
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import {
  companyTaxRates,
  companyTaxGroups,
  companyTaxGroupRates,
} from "@shared/schema";
import { BaseRepository } from "./base";

export class TaxRepository extends BaseRepository {
  // ========================================
  // TAX RATES
  // ========================================

  /** List all active tax rates for a company */
  async getTaxRates(companyId: string) {
    this.assertCompanyId(companyId);
    return db
      .select()
      .from(companyTaxRates)
      .where(
        and(
          eq(companyTaxRates.companyId, companyId),
          eq(companyTaxRates.active, true)
        )
      );
  }

  /** Get a single tax rate by ID */
  async getTaxRate(companyId: string, id: string) {
    this.assertCompanyId(companyId);
    const rows = await db
      .select()
      .from(companyTaxRates)
      .where(
        and(
          eq(companyTaxRates.id, id),
          eq(companyTaxRates.companyId, companyId)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Create a new tax rate */
  async createTaxRate(companyId: string, data: { name: string; rate: string; description?: string }) {
    this.assertCompanyId(companyId);
    const [created] = await db
      .insert(companyTaxRates)
      .values({ companyId, ...data })
      .returning();
    return created;
  }

  /** Update a tax rate */
  async updateTaxRate(companyId: string, id: string, data: { name?: string; rate?: string; description?: string }) {
    this.assertCompanyId(companyId);
    const [updated] = await db
      .update(companyTaxRates)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(companyTaxRates.id, id),
          eq(companyTaxRates.companyId, companyId)
        )
      )
      .returning();
    return updated ?? null;
  }

  /** Soft-delete a tax rate (set active=false) */
  async deleteTaxRate(companyId: string, id: string) {
    this.assertCompanyId(companyId);
    const [updated] = await db
      .update(companyTaxRates)
      .set({ active: false, updatedAt: new Date() })
      .where(
        and(
          eq(companyTaxRates.id, id),
          eq(companyTaxRates.companyId, companyId)
        )
      )
      .returning();
    return updated ?? null;
  }

  // ========================================
  // TAX GROUPS
  // ========================================

  /** List all active tax groups with their joined rates */
  async getTaxGroups(companyId: string) {
    this.assertCompanyId(companyId);
    const groups = await db
      .select()
      .from(companyTaxGroups)
      .where(
        and(
          eq(companyTaxGroups.companyId, companyId),
          eq(companyTaxGroups.active, true)
        )
      );

    // Join rates for each group
    const result = [];
    for (const group of groups) {
      const rates = await this.getGroupRates(group.id);
      result.push({ ...group, rates });
    }
    return result;
  }

  /** Get a single tax group with its rates */
  async getTaxGroup(companyId: string, id: string) {
    this.assertCompanyId(companyId);
    const rows = await db
      .select()
      .from(companyTaxGroups)
      .where(
        and(
          eq(companyTaxGroups.id, id),
          eq(companyTaxGroups.companyId, companyId)
        )
      )
      .limit(1);
    const group = rows[0] ?? null;
    if (!group) return null;

    const rates = await this.getGroupRates(group.id);
    return { ...group, rates };
  }

  /** Create a tax group with rate associations */
  async createTaxGroup(
    companyId: string,
    data: { name: string; description?: string; isDefault?: boolean; rateIds: string[] }
  ) {
    this.assertCompanyId(companyId);
    const { rateIds, ...groupData } = data;

    return db.transaction(async (tx) => {
      // If setting as default, unset existing default
      if (groupData.isDefault) {
        await tx
          .update(companyTaxGroups)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(
            and(
              eq(companyTaxGroups.companyId, companyId),
              eq(companyTaxGroups.isDefault, true),
              eq(companyTaxGroups.active, true)
            )
          );
      }

      const [group] = await tx
        .insert(companyTaxGroups)
        .values({ companyId, ...groupData })
        .returning();

      // Insert junction rows
      if (rateIds.length > 0) {
        await tx
          .insert(companyTaxGroupRates)
          .values(rateIds.map((taxRateId) => ({ groupId: group.id, taxRateId })));
      }

      const rates = await this.getGroupRatesInTx(tx, group.id);
      return { ...group, rates };
    });
  }

  /** Update a tax group and sync its rate associations */
  async updateTaxGroup(
    companyId: string,
    id: string,
    data: { name?: string; description?: string; isDefault?: boolean; rateIds?: string[] }
  ) {
    this.assertCompanyId(companyId);
    const { rateIds, ...groupData } = data;

    return db.transaction(async (tx) => {
      // If setting as default, unset existing default
      if (groupData.isDefault) {
        await tx
          .update(companyTaxGroups)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(
            and(
              eq(companyTaxGroups.companyId, companyId),
              eq(companyTaxGroups.isDefault, true),
              eq(companyTaxGroups.active, true)
            )
          );
      }

      const [updated] = await tx
        .update(companyTaxGroups)
        .set({ ...groupData, updatedAt: new Date() })
        .where(
          and(
            eq(companyTaxGroups.id, id),
            eq(companyTaxGroups.companyId, companyId)
          )
        )
        .returning();

      if (!updated) return null;

      // Sync junction rows if rateIds provided
      if (rateIds !== undefined) {
        await tx
          .delete(companyTaxGroupRates)
          .where(eq(companyTaxGroupRates.groupId, id));

        if (rateIds.length > 0) {
          await tx
            .insert(companyTaxGroupRates)
            .values(rateIds.map((taxRateId) => ({ groupId: id, taxRateId })));
        }
      }

      const rates = await this.getGroupRatesInTx(tx, id);
      return { ...updated, rates };
    });
  }

  /** Soft-delete a tax group */
  async deleteTaxGroup(companyId: string, id: string) {
    this.assertCompanyId(companyId);
    const [updated] = await db
      .update(companyTaxGroups)
      .set({ active: false, isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(companyTaxGroups.id, id),
          eq(companyTaxGroups.companyId, companyId)
        )
      )
      .returning();
    return updated ?? null;
  }

  /** Set a group as the default for its company (unsets previous default) */
  async setDefaultTaxGroup(companyId: string, groupId: string) {
    this.assertCompanyId(companyId);
    return db.transaction(async (tx) => {
      // Unset existing default
      await tx
        .update(companyTaxGroups)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(companyTaxGroups.companyId, companyId),
            eq(companyTaxGroups.isDefault, true),
            eq(companyTaxGroups.active, true)
          )
        );

      // Set new default
      const [updated] = await tx
        .update(companyTaxGroups)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(
          and(
            eq(companyTaxGroups.id, groupId),
            eq(companyTaxGroups.companyId, companyId),
            eq(companyTaxGroups.active, true)
          )
        )
        .returning();

      if (!updated) return null;
      const rates = await this.getGroupRatesInTx(tx, groupId);
      return { ...updated, rates };
    });
  }

  /** Get the default tax group for a company (with rates) */
  async getDefaultTaxGroup(companyId: string) {
    this.assertCompanyId(companyId);
    const rows = await db
      .select()
      .from(companyTaxGroups)
      .where(
        and(
          eq(companyTaxGroups.companyId, companyId),
          eq(companyTaxGroups.isDefault, true),
          eq(companyTaxGroups.active, true)
        )
      )
      .limit(1);
    const group = rows[0] ?? null;
    if (!group) return null;

    const rates = await this.getGroupRates(group.id);
    return { ...group, rates };
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  /** Get rates for a group (joins through junction table) */
  private async getGroupRates(groupId: string) {
    const junctions = await db
      .select()
      .from(companyTaxGroupRates)
      .where(eq(companyTaxGroupRates.groupId, groupId));

    if (junctions.length === 0) return [];

    const rateIds = junctions.map((j) => j.taxRateId);
    const rates = await db
      .select()
      .from(companyTaxRates)
      .where(sql`${companyTaxRates.id} IN (${sql.join(rateIds.map(id => sql`${id}`), sql`, `)})`);

    return rates;
  }

  /** Get rates for a group within a transaction */
  private async getGroupRatesInTx(tx: any, groupId: string) {
    const junctions = await tx
      .select()
      .from(companyTaxGroupRates)
      .where(eq(companyTaxGroupRates.groupId, groupId));

    if (junctions.length === 0) return [];

    const rateIds = junctions.map((j: any) => j.taxRateId);
    const rates = await tx
      .select()
      .from(companyTaxRates)
      .where(sql`${companyTaxRates.id} IN (${sql.join(rateIds.map((id: string) => sql`${id}`), sql`, `)})`);

    return rates;
  }
}

export const taxRepository = new TaxRepository();
