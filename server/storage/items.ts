import { db } from "../db";
import { eq, and, or, like, sql, isNull } from "drizzle-orm";
import { items } from "@shared/schema";
import type { InsertItem, Item } from "@shared/schema";
import { BaseRepository } from "./base";

export class ItemRepository extends BaseRepository {
  /**
   * Get items with optional search query
   * Excludes soft-deleted items (deletedAt is not null)
   */
  async getItems(companyId: string, searchQuery?: string): Promise<Item[]> {
    let query = db
      .select()
      .from(items)
      .where(and(
        eq(items.companyId, companyId),
        eq(items.isActive, true),
        isNull(items.deletedAt) // Exclude soft-deleted items
      ))
      .$dynamic();

    if (searchQuery) {
      const search = `%${searchQuery}%`;
      query = query.where(
        or(
          like(items.name, search),
          like(items.sku, search),
          like(items.description, search)
        )
      );
    }

    return await query.orderBy(items.name);
  }

  /**
   * Get single item
   */
  async getItem(companyId: string, itemId: string): Promise<Item | null> {
    const rows = await db
      .select()
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.companyId, companyId)))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Create item
   */
  async createItem(companyId: string, userId: string, itemData: any): Promise<Item> {
    // Auto-calculate unitPrice from cost and markup if provided
    let unitPrice = itemData.unitPrice;
    if (!unitPrice && itemData.cost && itemData.markupPercent) {
      const cost = parseFloat(itemData.cost);
      const markup = parseFloat(itemData.markupPercent);
      unitPrice = (cost * (1 + markup / 100)).toFixed(2);
    }

    const rows = await db
      .insert(items)
      .values({
        ...itemData,
        companyId,
        userId,
        unitPrice: unitPrice || itemData.unitPrice,
      })
      .returning();

    return rows[0];
  }

  /**
   * Update item
   */
  async updateItem(
    companyId: string,
    itemId: string,
    patch: Partial<InsertItem>
  ): Promise<Item | null> {
    // Auto-calculate unitPrice from cost and markup if provided
    if (patch.cost && patch.markupPercent && !patch.unitPrice) {
      const cost = parseFloat(String(patch.cost));
      const markup = parseFloat(String(patch.markupPercent));
      patch.unitPrice = (cost * (1 + markup / 100)).toFixed(2);
    }

    const rows = await db
      .update(items)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(items.id, itemId), eq(items.companyId, companyId)))
      .returning();

    return rows[0] ?? null;
  }

  /**
   * Delete item (soft delete)
   * Sets isActive to false and deletedAt timestamp
   */
  async deleteItem(companyId: string, itemId: string): Promise<{ success: boolean }> {
    const rows = await db
      .update(items)
      .set({
        isActive: false,
        deletedAt: new Date(), // Soft delete timestamp
        updatedAt: new Date()
      })
      .where(and(eq(items.id, itemId), eq(items.companyId, companyId)))
      .returning();

    return { success: rows.length > 0 };
  }

  /**
   * Restore a soft-deleted item
   */
  async restoreItem(companyId: string, itemId: string): Promise<Item | null> {
    const rows = await db
      .update(items)
      .set({
        isActive: true,
        deletedAt: null,
        updatedAt: new Date()
      })
      .where(and(eq(items.id, itemId), eq(items.companyId, companyId)))
      .returning();

    return rows[0] ?? null;
  }
}

export const itemRepository = new ItemRepository();
