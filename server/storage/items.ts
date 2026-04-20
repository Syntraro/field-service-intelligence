import { db } from "../db";
import { eq, and, or, ilike, sql, isNull } from "drizzle-orm";
import { items } from "@shared/schema";
import type { InsertItem, Item } from "@shared/schema";
import { BaseRepository } from "./base";

export class ItemRepository extends BaseRepository {
  /**
   * Get items with optional search query
   * Excludes soft-deleted items (deletedAt is not null)
   */
  async getItems(companyId: string, searchQuery?: string): Promise<Item[]> {
    // Build WHERE conditions — always include tenant + active filters
    const conditions = [
      eq(items.companyId, companyId),
      eq(items.isActive, true),
      isNull(items.deletedAt),
    ];

    if (searchQuery) {
      const search = `%${searchQuery}%`;
      // Case-insensitive search (ILIKE for Postgres)
      conditions.push(
        or(
          ilike(items.name, search),
          ilike(items.sku, search),
          ilike(items.description, search)
        )!
      );
    }

    return await db
      .select()
      .from(items)
      .where(and(...conditions))
      .orderBy(items.name);
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
   * Create item — direct insert. Prefer `createOrGet` for the canonical
   * create path; this method exists for the QBO catalog importer which
   * has its own explicit conflict-resolution flow and writes QBO sync
   * metadata that doesn't fit the createOrGet contract.
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
   * Canonical create-or-get for catalog items.
   *
   * 2026-04-19: company-scoped, case-insensitive, type-aware dedupe.
   * The natural key is `(company_id, type, lower(name))` — a "Filter"
   * service and a "Filter" product can coexist, but two products named
   * "filter"/"FILTER" cannot. Mirrors `EquipmentTypeRepository.createOrGet`
   * and is paired with the matching partial unique index in
   * `migrations/2026_04_19_items_unique_name_per_type.sql` (the index is
   * the safety net; this method is the primary dedupe).
   *
   * Behavior:
   *   - Active match exists → return it (no insert, no field overwrite).
   *   - Soft-deleted match exists → reactivate (clear deletedAt, set
   *     isActive=true) and return. Preserves catalog history without
   *     forcing the user to manually un-archive.
   *   - No match → insert new row.
   *
   * `name` and `type` are required; the rest of the payload is forwarded
   * to the insert when a new row is created.
   *
   * Used by: POST /api/items, POST /api/tech/items, productImport CSV
   * executor. NOT used by the QBO catalog importer (see `createItem`).
   */
  async createOrGet(
    companyId: string,
    userId: string,
    itemData: any,
  ): Promise<Item> {
    const rawName = typeof itemData?.name === "string" ? itemData.name.trim() : "";
    const type = typeof itemData?.type === "string" ? itemData.type : null;
    if (!rawName) {
      throw new Error("Item name is required");
    }
    if (!type) {
      throw new Error("Item type is required");
    }

    // Case-insensitive lookup against the canonical natural key. Includes
    // soft-deleted rows so a returning name doesn't bypass the unique index.
    const existing = await db
      .select()
      .from(items)
      .where(
        and(
          eq(items.companyId, companyId),
          eq(items.type, type),
          sql`lower(${items.name}) = lower(${rawName})`,
        ),
      )
      .limit(1);

    if (existing[0]) {
      const row = existing[0];
      const isLive = row.isActive && row.deletedAt === null;
      if (isLive) return row;
      // Reactivate the archived row so it's pickable from selectors again.
      const [reactivated] = await db
        .update(items)
        .set({ isActive: true, deletedAt: null, updatedAt: new Date() })
        .where(eq(items.id, row.id))
        .returning();
      return reactivated;
    }

    // No match — fall through to the canonical insert with auto-priced unitPrice.
    return this.createItem(companyId, userId, { ...itemData, name: rawName });
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
