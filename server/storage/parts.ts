import { db } from "../db";
import { eq, and, or, like, sql, count } from "drizzle-orm";
import { items } from "@shared/schema";
import type { InsertItem, Item } from "@shared/schema";
import { BaseRepository } from "./base";

// Alias for backwards compatibility
const parts = items;
type Part = Item;
type InsertPart = InsertItem;

export interface GetPartsOptions {
  searchQuery?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedPartsResult {
  items: Part[];
  total: number;
  hasMore: boolean;
}

export class PartRepository extends BaseRepository {
  /**
   * Get parts with optional search query and DB-level pagination
   */
  async getParts(companyId: string, options?: GetPartsOptions): Promise<Part[]>;
  async getParts(companyId: string, searchQuery?: string): Promise<Part[]>;
  async getParts(companyId: string, optionsOrSearch?: GetPartsOptions | string): Promise<Part[]> {
    // Handle legacy signature (just searchQuery string)
    const options: GetPartsOptions = typeof optionsOrSearch === 'string'
      ? { searchQuery: optionsOrSearch }
      : optionsOrSearch ?? {};

    const { searchQuery, limit, offset } = options;

    let query = db
      .select()
      .from(parts)
      .where(and(eq(parts.companyId, companyId), eq(parts.isActive, true)))
      .$dynamic();

    if (searchQuery) {
      const search = `%${searchQuery}%`;
      query = query.where(
        or(
          like(parts.name, search),
          like(parts.sku, search),
          like(parts.description, search),
          like(parts.category, search)
        )
      );
    }

    query = query.orderBy(parts.name);

    // Apply DB-level pagination if provided
    if (limit !== undefined) {
      query = query.limit(limit);
    }
    if (offset !== undefined) {
      query = query.offset(offset);
    }

    return await query;
  }

  /**
   * Get paginated parts with total count (for efficient pagination)
   */
  async getPartsPaginated(companyId: string, options: GetPartsOptions): Promise<PaginatedPartsResult> {
    const { searchQuery, limit = 50, offset = 0 } = options;

    // Build base where condition
    const baseWhere = and(eq(parts.companyId, companyId), eq(parts.isActive, true));

    // Build search condition if provided
    let searchWhere;
    if (searchQuery) {
      const search = `%${searchQuery}%`;
      searchWhere = or(
        like(parts.name, search),
        like(parts.sku, search),
        like(parts.description, search),
        like(parts.category, search)
      );
    }

    const whereCondition = searchWhere ? and(baseWhere, searchWhere) : baseWhere;

    // Use limit + 1 pattern to determine hasMore without counting
    const items = await db
      .select()
      .from(parts)
      .where(whereCondition)
      .orderBy(parts.name)
      .limit(limit + 1)
      .offset(offset);

    const hasMore = items.length > limit;
    const resultItems = hasMore ? items.slice(0, limit) : items;

    return {
      items: resultItems,
      total: offset + items.length, // Approximate total for current page
      hasMore,
    };
  }

  /**
   * Get single part
   */
  async getPart(companyId: string, partId: string): Promise<Part | null> {
    const rows = await db
      .select()
      .from(parts)
      .where(and(eq(parts.id, partId), eq(parts.companyId, companyId)))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Create part
   */
  async createPart(companyId: string, userId: string, partData: any): Promise<Part> {
    // Auto-calculate unitPrice from cost and markup if provided
    let unitPrice = partData.unitPrice;
    if (!unitPrice && partData.cost && partData.markupPercent) {
      const cost = parseFloat(partData.cost);
      const markup = parseFloat(partData.markupPercent);
      unitPrice = (cost * (1 + markup / 100)).toFixed(2);
    }

    const rows = await db
      .insert(parts)
      .values({
        ...partData,
        companyId,
        userId,
        unitPrice: unitPrice || partData.unitPrice,
      })
      .returning();

    return rows[0];
  }

  /**
   * Update part
   */
  async updatePart(
    companyId: string,
    partId: string,
    patch: Partial<InsertPart>
  ): Promise<Part | null> {
    // Auto-calculate unitPrice from cost and markup if provided
    if (patch.cost && patch.markupPercent && !patch.unitPrice) {
      const cost = parseFloat(String(patch.cost));
      const markup = parseFloat(String(patch.markupPercent));
      patch.unitPrice = (cost * (1 + markup / 100)).toFixed(2);
    }

    const rows = await db
      .update(parts)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(parts.id, partId), eq(parts.companyId, companyId)))
      .returning();

    return rows[0] ?? null;
  }

  /**
   * Delete part (soft delete)
   */
  async deletePart(companyId: string, partId: string): Promise<{ success: boolean }> {
    const rows = await db
      .update(parts)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(parts.id, partId), eq(parts.companyId, companyId)))
      .returning();

    return { success: rows.length > 0 };
  }
}

export const partRepository = new PartRepository();