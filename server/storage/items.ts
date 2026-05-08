import { db } from "../db";
import { eq, and, or, ilike, sql, isNull } from "drizzle-orm";
import { items } from "@shared/schema";
import type { InsertItem, Item } from "@shared/schema";
import { BaseRepository } from "./base";

export type ItemListSort = "name" | "most_used";

export class ItemRepository extends BaseRepository {
  /**
   * Get items with optional search query and sort order.
   *
   * Sort options:
   *   - `"name"` (default) — alphabetical ASC. Used by every existing
   *     caller (catalog management, line-item pickers, etc.). Audited
   *     2026-05-07 — no caller depends on a specific sort, so this
   *     remains the safe default.
   *   - `"most_used"` — orders by historical usage count (desc) across
   *     `invoice_lines`, `quote_lines`, and `job_parts`, with item
   *     name as the tiebreaker. Items with zero usage appear after
   *     used items (alphabetical). Tenant-scoped via the same
   *     `companyId` filter applied to the items table; the usage
   *     subquery also filters each line table by `companyId` for
   *     defense in depth.
   *
   * Soft-delete handling for usage counts:
   *   - `job_parts` has `is_active` + `deleted_at`; we exclude
   *     soft-deleted rows.
   *   - `invoice_lines` and `quote_lines` have NO soft-delete columns;
   *     all rows count toward usage. Voided invoices / lost quotes
   *     still represent historical usage of the catalog item, which
   *     is the intended ranking signal for "what items does this
   *     tenant tend to use."
   *
   * Excludes soft-deleted items (`deletedAt is not null`) regardless
   * of sort.
   */
  async getItems(
    companyId: string,
    searchQuery?: string,
    sort: ItemListSort = "name",
  ): Promise<Item[]> {
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

    const rows = await db
      .select()
      .from(items)
      .where(and(...conditions))
      .orderBy(items.name);

    if (sort !== "most_used") {
      return rows;
    }

    // Most-used path: aggregate productId counts across the three
    // line tables (UNION ALL → COUNT GROUP BY), then in-memory sort
    // the items array we already have. Issuing it as a single
    // round-trip + in-memory sort keeps the SQL simple and lets us
    // reuse the existing tenant + soft-delete filters on the items
    // query above.
    //
    // Indexes used:
    //   • idx_invoice_lines_product_id (partial; added 2026-05-07).
    //   • idx_quote_lines_product_id   (partial; added 2026-05-07).
    //   • idx_job_parts_product        (partial; pre-existing).
    type UsageRow = { product_id: string; cnt: string };
    const usageRows = (await db.execute(sql`
      SELECT product_id, COUNT(*)::text AS cnt FROM (
        SELECT product_id FROM invoice_lines
          WHERE company_id = ${companyId} AND product_id IS NOT NULL
        UNION ALL
        SELECT product_id FROM quote_lines
          WHERE company_id = ${companyId} AND product_id IS NOT NULL
        UNION ALL
        SELECT product_id FROM job_parts
          WHERE company_id = ${companyId}
            AND product_id IS NOT NULL
            AND deleted_at IS NULL
            AND is_active = true
      ) AS u
      GROUP BY product_id
    `)) as unknown as { rows: UsageRow[] };

    const usageMap = new Map<string, number>();
    for (const r of usageRows.rows ?? []) {
      const n = Number(r.cnt);
      if (Number.isFinite(n)) usageMap.set(r.product_id, n);
    }

    // Stable sort: primary key = usage count desc (zero last);
    // secondary key = item name asc (matches default behavior so
    // unused items remain alphabetical among themselves).
    return [...rows].sort((a, b) => {
      const aCount = usageMap.get(a.id) ?? 0;
      const bCount = usageMap.get(b.id) ?? 0;
      if (aCount !== bCount) return bCount - aCount;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
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
  ): Promise<Item & { _matched?: boolean }> {
    const rawName = typeof itemData?.name === "string" ? itemData.name.trim() : "";
    const type = typeof itemData?.type === "string" ? itemData.type : null;
    if (!rawName) {
      throw new Error("Item name is required");
    }
    if (!type) {
      throw new Error("Item type is required");
    }

    // 2026-04-29: Type-AGNOSTIC dedupe (was type-scoped on (companyId, type,
    // lower(name)) before this change). Per UX requirement: a Product
    // "Thermostat" and a Service "Thermostat" must NOT coexist. The natural
    // key is now (companyId, lower(trim(name))) regardless of type. If a
    // match is found across any type, return it as-is and flag `_matched`
    // so the route handler / client can show "Reusing existing item"
    // instead of "Created". Includes soft-deleted rows so a returning
    // name doesn't bypass the unique index.
    const existing = await db
      .select()
      .from(items)
      .where(
        and(
          eq(items.companyId, companyId),
          sql`lower(${items.name}) = lower(${rawName})`,
        ),
      )
      .limit(1);

    if (existing[0]) {
      const row = existing[0];
      const isLive = row.isActive && row.deletedAt === null;
      if (isLive) return { ...row, _matched: true };
      // Reactivate the archived row so it's pickable from selectors again.
      const [reactivated] = await db
        .update(items)
        .set({ isActive: true, deletedAt: null, updatedAt: new Date() })
        .where(eq(items.id, row.id))
        .returning();
      return { ...reactivated, _matched: true };
    }

    // No match — fall through to the canonical insert with auto-priced unitPrice.
    const created = await this.createItem(companyId, userId, { ...itemData, name: rawName });
    return { ...created, _matched: false };
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

    // 2026-04-29: Rename-conflict guard. If the patch renames the item,
    // verify no other ACTIVE row in the tenant already owns the new
    // (case-insensitive, trimmed) name. The DB unique index would also
    // catch this on commit, but we throw a typed error here so the
    // route handler can return a clean 409 instead of a raw constraint
    // violation. Type-agnostic per the same dedupe rule used in
    // createOrGet().
    if (typeof patch.name === "string") {
      const newName = patch.name.trim();
      if (newName.length === 0) {
        throw new Error("Item name cannot be empty");
      }
      const conflict = await db
        .select({ id: items.id })
        .from(items)
        .where(
          and(
            eq(items.companyId, companyId),
            sql`lower(${items.name}) = lower(${newName})`,
            sql`${items.id} != ${itemId}`,
            sql`${items.deletedAt} is null`,
            eq(items.isActive, true),
          ),
        )
        .limit(1);
      if (conflict[0]) {
        const err: any = new Error(`An item named "${newName}" already exists.`);
        err.code = "ITEM_NAME_CONFLICT";
        err.statusCode = 409;
        throw err;
      }
      patch.name = newName;
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
