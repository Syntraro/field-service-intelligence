/**
 * User Dashboard Widget Layout — storage layer (2026-05-07 RALPH).
 *
 * Thin Drizzle wrapper over the `user_dashboard_widgets` table.
 * Permission enforcement does NOT live here — it's the route
 * handler's responsibility (the storage layer takes already-validated
 * input). Two-layer separation matches the canonical pattern used by
 * the rest of the storage modules in this directory.
 *
 * Shape recap (see migrations/2026_05_07_user_dashboard_widgets.sql):
 *   user_id, dashboard_key, widget_key,
 *   visible, order_index, created_at, updated_at
 *   UNIQUE (user_id, dashboard_key, widget_key)
 *
 * Operations:
 *   • listForUser(userId, dashboardKey)         — read user's overrides
 *   • replaceForUser(userId, dashboardKey, …)   — atomic delete-then-insert
 *   • resetForUser(userId, dashboardKey)        — DELETE all rows for one
 *                                                  (user, dashboard) pair
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  userDashboardWidgets,
  type UserDashboardWidget,
} from "@shared/schema";

export interface DashboardLayoutEntryInput {
  widgetKey: string;
  visible: boolean;
  orderIndex: number;
}

/** Read every layout row a user has saved for a single dashboard,
 *  ordered by `order_index ASC`. Empty array when the user has no
 *  override rows yet — caller resolves against registry defaults. */
async function listForUser(
  userId: string,
  dashboardKey: string,
): Promise<UserDashboardWidget[]> {
  return db
    .select()
    .from(userDashboardWidgets)
    .where(
      and(
        eq(userDashboardWidgets.userId, userId),
        eq(userDashboardWidgets.dashboardKey, dashboardKey),
      ),
    )
    .orderBy(asc(userDashboardWidgets.orderIndex));
}

/**
 * Replace the user's layout for one dashboard in a single transaction:
 * DELETE every existing row for (user, dashboard), then INSERT the
 * supplied entries. The PUT contract is "the array IS the new layout"
 * — entries omitted from the input fall back to registry defaults at
 * resolve time, which is intentionally lossy (drop a row to revert it
 * to default). Empty `entries` is equivalent to `resetForUser` and
 * supported as a degenerate case.
 *
 * Caller MUST validate every `widgetKey` against the canonical
 * registry AND check the user's permission for it before calling
 * this function — the storage layer trusts its input.
 */
async function replaceForUser(
  userId: string,
  dashboardKey: string,
  entries: ReadonlyArray<DashboardLayoutEntryInput>,
): Promise<UserDashboardWidget[]> {
  return db.transaction(async (tx) => {
    await tx
      .delete(userDashboardWidgets)
      .where(
        and(
          eq(userDashboardWidgets.userId, userId),
          eq(userDashboardWidgets.dashboardKey, dashboardKey),
        ),
      );

    if (entries.length === 0) return [];

    const rows = await tx
      .insert(userDashboardWidgets)
      .values(
        entries.map((e) => ({
          userId,
          dashboardKey,
          widgetKey: e.widgetKey,
          visible: e.visible,
          orderIndex: e.orderIndex,
          updatedAt: new Date(),
        })),
      )
      .returning();
    return rows;
  });
}

/** Delete every layout row for a (user, dashboard) pair. Subsequent
 *  reads return zero rows → resolver falls back to registry defaults.
 *  Idempotent — calling on a user with no rows is a no-op. */
async function resetForUser(
  userId: string,
  dashboardKey: string,
): Promise<void> {
  await db
    .delete(userDashboardWidgets)
    .where(
      and(
        eq(userDashboardWidgets.userId, userId),
        eq(userDashboardWidgets.dashboardKey, dashboardKey),
      ),
    );
}

export const userDashboardWidgetsRepository = {
  listForUser,
  replaceForUser,
  resetForUser,
};
