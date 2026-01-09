import { db } from "../db";
import { eq, and, or, like, sql } from "drizzle-orm";
import { items } from "@shared/schema";
import type { InsertItem, Item } from "@shared/schema";
import { BaseRepository } from "./base";

export class ItemRepository extends BaseRepository {
  /**
   * Get items with optional search query
   */
  async getItems(companyId: string, searchQuery?: string): Promise<Item[]> {
    let query = db
      .select()
      .from(items)
      .where(and(eq(items.companyId, companyId), eq(items.isActive, true)))
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
    console.log("=== STORAGE createItem ===");
    console.log("Params:", { companyId, userId });
    console.log("Data:", itemData);

    try {
      // Auto-calculate unitPrice from cost and markup if provided
      let unitPrice = itemData.unitPrice;
      if (!unitPrice && itemData.cost && itemData.markupPercent) {
        const cost = parseFloat(itemData.cost);
        const markup = parseFloat(itemData.markupPercent);
        unitPrice = (cost * (1 + markup / 100)).toFixed(2);
      }

      const insertData = {
        ...itemData,
        companyId,
        userId,
        unitPrice: unitPrice || itemData.unitPrice,
      };

      console.log("Inserting:", insertData);
      const rows = await db.insert(items).values(insertData).returning();
      console.log("Insert successful:", rows[0]?.id);

      return rows[0];
    } catch (error: any) {
      console.error("=== STORAGE ERROR ===");
      console.error("Message:", error.message);
      console.error("Code:", error.code);
      console.error("Detail:", error.detail);
      throw error;
    }
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
   */
  async deleteItem(companyId: string, itemId: string): Promise<{ success: boolean }> {
    const rows = await db
      .update(items)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(items.id, itemId), eq(items.companyId, companyId)))
      .returning();

    return { success: rows.length > 0 };
  }
}

export const itemRepository = new ItemRepository();
