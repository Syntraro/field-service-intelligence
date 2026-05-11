/**
 * Item Categories storage layer.
 *
 * Manages the item_categories catalog table — named, persistent category
 * labels per company. Items reference categories via the text `category`
 * field (no FK); this layer handles the catalog CRUD and keeps item rows
 * consistent on rename/delete.
 *
 * "Uncategorized" is NOT a stored category. The API returns a separate
 * `uncategorizedCount` for items with a null category field.
 */
import { db } from "../db";
import { eq, and, sql, isNull, ne } from "drizzle-orm";
import { itemCategories, items } from "@shared/schema";
import type { ItemCategory } from "@shared/schema";

export const DEFAULT_SYSTEM_CATEGORIES = [
  "Belts",
  "Electrical",
  "Filters",
  "Labour",
  "HVAC Parts",
  "Refrigeration",
  "Plumbing",
  "Controls",
  "Sheet Metal",
  "Other",
];

export interface ItemCategoryWithCount extends ItemCategory {
  count: number;
}

export interface CategoryListResult {
  categories: ItemCategoryWithCount[];
  uncategorizedCount: number;
}

/** Seed DEFAULT_SYSTEM_CATEGORIES for a company on first access. */
async function lazySeed(companyId: string): Promise<void> {
  const [first] = await db
    .select({ id: itemCategories.id })
    .from(itemCategories)
    .where(eq(itemCategories.companyId, companyId))
    .limit(1);

  if (!first) {
    await db
      .insert(itemCategories)
      .values(DEFAULT_SYSTEM_CATEGORIES.map((name) => ({ companyId, name, isSystem: true })))
      .onConflictDoNothing();
  }
}

/**
 * List all categories for a company with item counts.
 * Lazy-seeds the 10 system defaults on first call for new companies.
 */
export async function listCategoriesWithCounts(companyId: string): Promise<CategoryListResult> {
  await lazySeed(companyId);

  const cats = await db
    .select()
    .from(itemCategories)
    .where(eq(itemCategories.companyId, companyId))
    .orderBy(sql`lower(${itemCategories.name})`);

  // Fetch all active item category values for counting
  const itemRows = await db
    .select({ category: items.category })
    .from(items)
    .where(
      and(
        eq(items.companyId, companyId),
        eq(items.isActive, true),
        isNull(items.deletedAt),
      ),
    );

  const countMap = new Map<string, number>();
  let uncategorizedCount = 0;

  itemRows.forEach((r) => {
    if (!r.category) {
      uncategorizedCount++;
    } else {
      const key = r.category.toLowerCase();
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
    }
  });

  return {
    categories: cats.map((cat) => ({
      ...cat,
      count: countMap.get(cat.name.toLowerCase()) ?? 0,
    })),
    uncategorizedCount,
  };
}

/** Create a new user category. Throws CATEGORY_NAME_CONFLICT on duplicate. */
export async function createCategory(companyId: string, name: string): Promise<ItemCategory> {
  const trimmed = name.trim();

  const [conflict] = await db
    .select({ id: itemCategories.id })
    .from(itemCategories)
    .where(
      and(
        eq(itemCategories.companyId, companyId),
        sql`lower(${itemCategories.name}) = lower(${trimmed})`,
      ),
    )
    .limit(1);

  if (conflict) {
    throw Object.assign(new Error(`A category named "${trimmed}" already exists.`), {
      code: "CATEGORY_NAME_CONFLICT",
    });
  }

  const [created] = await db
    .insert(itemCategories)
    .values({ companyId, name: trimmed, isSystem: false })
    .returning();

  return created;
}

/**
 * Rename a category and update all items that reference the old name.
 * Throws NOT_FOUND or CATEGORY_NAME_CONFLICT.
 */
export async function renameCategory(
  companyId: string,
  id: string,
  newName: string,
): Promise<ItemCategory> {
  const trimmed = newName.trim();

  const [current] = await db
    .select()
    .from(itemCategories)
    .where(and(eq(itemCategories.id, id), eq(itemCategories.companyId, companyId)))
    .limit(1);

  if (!current) {
    throw Object.assign(new Error("Category not found."), { code: "NOT_FOUND" });
  }

  // Check for name collision (excluding self)
  const [conflict] = await db
    .select({ id: itemCategories.id })
    .from(itemCategories)
    .where(
      and(
        eq(itemCategories.companyId, companyId),
        sql`lower(${itemCategories.name}) = lower(${trimmed})`,
        ne(itemCategories.id, id),
      ),
    )
    .limit(1);

  if (conflict) {
    throw Object.assign(new Error(`A category named "${trimmed}" already exists.`), {
      code: "CATEGORY_NAME_CONFLICT",
    });
  }

  const [updated] = await db
    .update(itemCategories)
    .set({ name: trimmed })
    .where(and(eq(itemCategories.id, id), eq(itemCategories.companyId, companyId)))
    .returning();

  // Propagate rename to all items with the old name (case-insensitive)
  await db
    .update(items)
    .set({ category: trimmed, updatedAt: new Date() })
    .where(
      and(
        eq(items.companyId, companyId),
        sql`lower(${items.category}) = lower(${current.name})`,
      ),
    );

  return updated;
}

/**
 * Delete a category and move all its items to Uncategorized (null category).
 * Throws NOT_FOUND.
 */
export async function deleteCategory(companyId: string, id: string): Promise<void> {
  const [cat] = await db
    .select()
    .from(itemCategories)
    .where(and(eq(itemCategories.id, id), eq(itemCategories.companyId, companyId)))
    .limit(1);

  if (!cat) {
    throw Object.assign(new Error("Category not found."), { code: "NOT_FOUND" });
  }

  // Null-out items referencing this category
  await db
    .update(items)
    .set({ category: null, updatedAt: new Date() })
    .where(
      and(
        eq(items.companyId, companyId),
        sql`lower(${items.category}) = lower(${cat.name})`,
      ),
    );

  await db
    .delete(itemCategories)
    .where(and(eq(itemCategories.id, id), eq(itemCategories.companyId, companyId)));
}
