/**
 * Pricebook Groups storage repository (2026-05-07 RALPH).
 *
 * Saved bundles of pricebook items. The picker right rail reads from
 * `listForCompany`; create / update / hardDelete go through this
 * repo; `incrementUsage` is called from the canonical
 * `pricebookUsageService` when a tenant adds a group to a job /
 * quote / invoice.
 *
 * Tenant scoping is enforced on every query (`company_id = ?`). The
 * `is_active` column is currently a no-op carry-over from an earlier
 * iteration that supported soft-archive; v1 just always reads `true`
 * and we keep the column to avoid a schema migration. Delete is a
 * hard-delete (FK cascade removes the join rows automatically).
 *
 * Group children are joined via `pricebook_group_items` and returned
 * with the canonical item snapshot fields (name, type, price, cost,
 * taxable). The picker / mapper consumes these directly so a group
 * expansion does NOT require a follow-up `/api/items` round-trip per
 * child.
 */
import { db } from "../db";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  items,
  pricebookGroups,
  pricebookGroupItems,
} from "@shared/schema";
import { BaseRepository } from "./base";

export type PricebookGroupListSort = "most_used" | "name";

export interface PricebookGroupChildSummary {
  id: string;
  itemId: string;
  name: string | null;
  description: string | null;
  type: string;
  quantity: string;
  unitPrice: string | null;
  cost: string | null;
  isTaxable: boolean | null;
  sortOrder: number;
}

export interface PricebookGroupSummary {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  isActive: boolean;
  usageCount: number;
  createdAt: Date;
  updatedAt: Date | null;
  itemCount: number;
  totalEstimate: string;
  children: PricebookGroupChildSummary[];
}

export interface CreatePricebookGroupInput {
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  children: ReadonlyArray<{
    itemId: string;
    quantity: string;
    sortOrder?: number;
  }>;
}

export interface UpdatePricebookGroupInput {
  name?: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  /** When provided, replaces the full child list (DELETE + INSERT in
   *  one tx). When omitted, children are left untouched. */
  children?: ReadonlyArray<{
    itemId: string;
    quantity: string;
    sortOrder?: number;
  }>;
}

export class PricebookGroupItemNotFoundError extends Error {
  constructor(public readonly missingItemIds: string[]) {
    super(
      `One or more group child items do not exist or are not accessible: ${missingItemIds.join(
        ", ",
      )}`,
    );
    this.name = "PricebookGroupItemNotFoundError";
  }
}

export class PricebookGroupNameConflictError extends Error {
  constructor(public readonly name: string) {
    super(`Pricebook group "${name}" already exists.`);
    this.name = "PricebookGroupNameConflictError";
  }
}

class PricebookGroupRepository extends BaseRepository {
  /**
   * List all active groups for a tenant, with child summaries.
   *
   * Sort:
   *   - `"most_used"` (default): usage_count DESC, name ASC tiebreak.
   *     Unused groups (usage_count = 0) sort to the bottom alphabetical.
   *   - `"name"`: alphabetical only.
   *
   * Read shape mirrors the picker's needs: each group includes its
   * resolved child items in `sortOrder` order with the canonical item
   * snapshot fields. Group `totalEstimate` is the SUM of
   * (quantity × unit_price) across children, computed in-app from the
   * already-fetched child rows (no extra round-trip).
   */
  async listForCompany(
    companyId: string,
    sort: PricebookGroupListSort = "most_used",
  ): Promise<PricebookGroupSummary[]> {
    const groupRows = await db
      .select()
      .from(pricebookGroups)
      .where(
        and(
          eq(pricebookGroups.companyId, companyId),
          eq(pricebookGroups.isActive, true),
        ),
      );

    if (groupRows.length === 0) return [];

    const groupIds = groupRows.map((g) => g.id);

    // Single round-trip: pull every child of every group, join the
    // canonical item row for the snapshot fields. Filter both sides
    // by company_id for defense-in-depth (the FKs already prevent
    // cross-tenant linkage but the explicit filter is cheap).
    const childRows = await db
      .select({
        id: pricebookGroupItems.id,
        groupId: pricebookGroupItems.groupId,
        itemId: pricebookGroupItems.itemId,
        quantity: pricebookGroupItems.quantity,
        sortOrder: pricebookGroupItems.sortOrder,
        itemName: items.name,
        itemDescription: items.description,
        itemType: items.type,
        itemUnitPrice: items.unitPrice,
        itemCost: items.cost,
        itemIsTaxable: items.isTaxable,
      })
      .from(pricebookGroupItems)
      .innerJoin(items, eq(pricebookGroupItems.itemId, items.id))
      .where(
        and(
          eq(pricebookGroupItems.companyId, companyId),
          eq(items.companyId, companyId),
          inArray(pricebookGroupItems.groupId, groupIds),
        ),
      );

    const childrenByGroup = new Map<string, PricebookGroupChildSummary[]>();
    for (const r of childRows) {
      const arr = childrenByGroup.get(r.groupId) ?? [];
      arr.push({
        id: r.id,
        itemId: r.itemId,
        name: r.itemName,
        description: r.itemDescription,
        type: r.itemType,
        quantity: r.quantity,
        unitPrice: r.itemUnitPrice,
        cost: r.itemCost,
        isTaxable: r.itemIsTaxable,
        sortOrder: r.sortOrder,
      });
      childrenByGroup.set(r.groupId, arr);
    }

    // Sort children inside each group by sortOrder ASC, name ASC.
    // Iterate via `Array.from(...values())` so the loop doesn't need
    // `--downlevelIteration`. Explicit param types keep the sort callback
    // out of `noImplicitAny`.
    for (const arr of Array.from(childrenByGroup.values())) {
      arr.sort((a: PricebookGroupChildSummary, b: PricebookGroupChildSummary) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return (a.name ?? "").localeCompare(b.name ?? "");
      });
    }

    const summaries: PricebookGroupSummary[] = groupRows.map((g) => {
      const children = childrenByGroup.get(g.id) ?? [];
      let total = 0;
      for (const c of children) {
        const q = Number(c.quantity);
        const p = Number(c.unitPrice ?? 0);
        if (Number.isFinite(q) && Number.isFinite(p)) {
          total += q * p;
        }
      }
      return {
        id: g.id,
        name: g.name,
        description: g.description,
        color: g.color,
        icon: g.icon,
        isActive: g.isActive,
        usageCount: g.usageCount,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
        itemCount: children.length,
        totalEstimate: total.toFixed(2),
        children,
      };
    });

    // Application-layer sort. The lookup index supports the
    // (company, active) filter; the result set per tenant is small
    // enough that an in-memory sort is the right call.
    return summaries.sort((a, b) => {
      if (sort === "name") {
        return a.name.localeCompare(b.name);
      }
      // most_used: count DESC, name ASC tiebreak.
      if (a.usageCount !== b.usageCount) {
        return b.usageCount - a.usageCount;
      }
      return a.name.localeCompare(b.name);
    });
  }

  /** Single group with child summaries. Returns null when missing or
   *  cross-tenant. */
  async getById(
    companyId: string,
    groupId: string,
  ): Promise<PricebookGroupSummary | null> {
    const summaries = await this.listForCompany(companyId, "name");
    return summaries.find((g) => g.id === groupId) ?? null;
  }

  /**
   * Create a new group + its children inside one transaction. Children
   * are validated for tenant ownership (every itemId must resolve to
   * an active item belonging to the same tenant) before the insert.
   * Throws `PricebookGroupItemNotFoundError` when an itemId is missing
   * / cross-tenant / soft-deleted, and `PricebookGroupNameConflictError`
   * when the name collides with an existing active group.
   */
  async create(
    companyId: string,
    userId: string | null,
    input: CreatePricebookGroupInput,
  ): Promise<PricebookGroupSummary> {
    await this.assertItemsBelongToCompany(
      companyId,
      input.children.map((c) => c.itemId),
    );

    try {
      const newId = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(pricebookGroups)
          .values({
            companyId,
            userId,
            name: input.name,
            description: input.description ?? null,
            color: input.color ?? null,
            icon: input.icon ?? null,
          })
          .returning({ id: pricebookGroups.id });

        if (input.children.length > 0) {
          await tx.insert(pricebookGroupItems).values(
            input.children.map((c, idx) => ({
              companyId,
              groupId: created.id,
              itemId: c.itemId,
              quantity: c.quantity,
              sortOrder: c.sortOrder ?? idx,
            })),
          );
        }

        return created.id;
      });

      const summary = await this.getById(companyId, newId);
      if (!summary) {
        throw new Error(
          "Failed to read back created pricebook group — concurrent delete?",
        );
      }
      return summary;
    } catch (err) {
      if (isUniqueViolation(err, "pricebook_groups_company_name_active_uq")) {
        throw new PricebookGroupNameConflictError(input.name);
      }
      throw err;
    }
  }

  /**
   * Update group metadata + optionally replace children. When
   * `children` is provided the update runs DELETE + INSERT inside a
   * single transaction so observers see one consistent state. When
   * omitted, children are untouched.
   */
  async update(
    companyId: string,
    groupId: string,
    input: UpdatePricebookGroupInput,
  ): Promise<PricebookGroupSummary | null> {
    if (input.children) {
      await this.assertItemsBelongToCompany(
        companyId,
        input.children.map((c) => c.itemId),
      );
    }

    try {
      await db.transaction(async (tx) => {
        const patch: Record<string, unknown> = {
          updatedAt: new Date(),
        };
        if (input.name !== undefined) patch.name = input.name;
        if (input.description !== undefined) patch.description = input.description;
        if (input.color !== undefined) patch.color = input.color;
        if (input.icon !== undefined) patch.icon = input.icon;

        await tx
          .update(pricebookGroups)
          .set(patch)
          .where(
            and(
              eq(pricebookGroups.id, groupId),
              eq(pricebookGroups.companyId, companyId),
              eq(pricebookGroups.isActive, true),
            ),
          );

        if (input.children) {
          await tx
            .delete(pricebookGroupItems)
            .where(
              and(
                eq(pricebookGroupItems.companyId, companyId),
                eq(pricebookGroupItems.groupId, groupId),
              ),
            );
          if (input.children.length > 0) {
            await tx.insert(pricebookGroupItems).values(
              input.children.map((c, idx) => ({
                companyId,
                groupId,
                itemId: c.itemId,
                quantity: c.quantity,
                sortOrder: c.sortOrder ?? idx,
              })),
            );
          }
        }
      });
    } catch (err) {
      if (isUniqueViolation(err, "pricebook_groups_company_name_active_uq")) {
        throw new PricebookGroupNameConflictError(input.name ?? "");
      }
      throw err;
    }

    return this.getById(companyId, groupId);
  }

  /** Hard-delete: removes the group row. The migration declares
   *  `pricebook_group_items.group_id REFERENCES pricebook_groups(id)
   *  ON DELETE CASCADE`, so the join rows go away with the parent in
   *  one statement — no manual children-cleanup needed. The
   *  underlying `items` rows are untouched (the cascade goes group →
   *  group_items only; items have their own lifecycle).
   *
   *  2026-05-07 RALPH: replaced the prior soft-archive (`is_active =
   *  false`) per product brief. Tenants want delete to mean delete;
   *  there is no "unarchive" UX, the soft flag was orphan state. */
  async hardDelete(companyId: string, groupId: string): Promise<boolean> {
    const result = await db
      .delete(pricebookGroups)
      .where(
        and(
          eq(pricebookGroups.id, groupId),
          eq(pricebookGroups.companyId, companyId),
        ),
      )
      .returning({ id: pricebookGroups.id });
    return result.length > 0;
  }

  /** Atomic increment of `usage_count`. Called from
   *  `pricebookUsageService.recordUsage({ kind: "group", id })` after
   *  a successful bulk-add. Tenant filter is enforced at the SQL
   *  layer — a stale client can't bump another tenant's count. */
  async incrementUsage(
    companyId: string,
    groupId: string,
    delta = 1,
  ): Promise<void> {
    await db
      .update(pricebookGroups)
      .set({
        usageCount: sql`${pricebookGroups.usageCount} + ${delta}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(pricebookGroups.id, groupId),
          eq(pricebookGroups.companyId, companyId),
          eq(pricebookGroups.isActive, true),
        ),
      );
  }

  /** Validates every itemId resolves to an active item owned by this
   *  tenant. Throws `PricebookGroupItemNotFoundError` listing the
   *  missing ids when any fail. Returns silently on success. */
  private async assertItemsBelongToCompany(
    companyId: string,
    itemIds: ReadonlyArray<string>,
  ): Promise<void> {
    if (itemIds.length === 0) return;
    const unique = Array.from(new Set(itemIds));
    const rows = await db
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          eq(items.companyId, companyId),
          eq(items.isActive, true),
          inArray(items.id, unique),
        ),
      );
    const found = new Set(rows.map((r) => r.id));
    const missing = unique.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new PricebookGroupItemNotFoundError(missing);
    }
  }
}

function isUniqueViolation(err: unknown, constraintName: string): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; constraint?: string };
  return e.code === "23505" && e.constraint === constraintName;
}

export const pricebookGroupRepository = new PricebookGroupRepository();
