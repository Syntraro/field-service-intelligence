/**
 * Dashboard Layout Routes — per-user widget visibility / ordering
 * (2026-05-07 RALPH).
 *
 * Mounted at `/api/dashboard-layout` to keep the data-aggregation
 * dashboard router (`/api/dashboard/...`) free of settings routes —
 * the existing route-whitelist test in
 * `tests/dashboard-layout.test.ts` enforces that the data router only
 * exposes aggregation endpoints (financial / workflow / capacity / …).
 *
 * Endpoints
 * ---------
 *   GET    /api/dashboard-layout?dashboardKey=financial
 *           Returns the resolved layout for the current user. Always
 *           returns the full registry-derived widget list — user
 *           overrides are layered on top, registry defaults fill in
 *           the gaps. Permission-gated widgets the user lacks are
 *           filtered out at the route layer (NOT at the storage
 *           layer — storage is permission-agnostic).
 *
 *   PUT    /api/dashboard-layout
 *           Replaces the user's layout for one dashboard. Body matches
 *           `dashboardLayoutPutSchema`. Every posted `widgetKey` is
 *           validated against the canonical registry AND the user's
 *           permissions. Unknown keys + unauthorized widgets are
 *           rejected at HTTP 400 — a user MUST NOT be able to persist
 *           a row for a widget they aren't allowed to see.
 *
 *   POST   /api/dashboard-layout/reset?dashboardKey=financial
 *           Deletes every override row for (user, dashboard).
 *           Subsequent GETs return registry defaults.
 *
 * Permissions
 * -----------
 * Every endpoint requires `dashboard.view` (mounted at the router
 * level). Per-widget permission checks happen inside the handlers via
 * `userHasPermission(userId, widget.requiredPermission)`.
 */
import { Router, type Response } from "express";
import { z } from "zod";
import type { AuthedRequest } from "../auth/tenantIsolation";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { requirePermission, userHasPermission } from "../permissions";
import { userDashboardWidgetsRepository } from "../storage/userDashboardWidgets";
import {
  DASHBOARD_WIDGETS,
  getDashboardWidget,
  isKnownDashboard,
  listDashboardWidgets,
  type DashboardWidgetDefinition,
} from "@shared/dashboardWidgetRegistry";
import { dashboardLayoutPutSchema } from "../../client/src/dashboard/dashboardLayoutSchemas";

const router = Router();

// Mount-level permission gate. Every endpoint below requires the
// canonical `dashboard.view` permission — same gate the data
// aggregation router (`/api/dashboard/...`) uses.
router.use(requirePermission("dashboard.view"));

const dashboardKeyQuerySchema = z.object({
  dashboardKey: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/),
}).strict();

/** Filter the registry by per-widget permissions. */
async function filterByPermissions(
  userId: string,
  widgets: readonly DashboardWidgetDefinition[],
): Promise<DashboardWidgetDefinition[]> {
  const allowed: DashboardWidgetDefinition[] = [];
  for (const w of widgets) {
    if (!w.requiredPermission) {
      allowed.push(w);
      continue;
    }
    const ok = await userHasPermission(userId, w.requiredPermission);
    if (ok) allowed.push(w);
  }
  return allowed;
}

// ─── GET /api/dashboard-layout ─────────────────────────────────────

router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { dashboardKey } = validateSchema(
    dashboardKeyQuerySchema,
    req.query,
  );
  if (!isKnownDashboard(dashboardKey)) {
    throw createError(400, `Unknown dashboardKey: ${dashboardKey}`);
  }
  const userId = req.user!.id;

  // Registry-derived defaults, filtered by user permissions.
  const allowed = await filterByPermissions(
    userId,
    listDashboardWidgets(dashboardKey),
  );

  // User overrides, indexed by widgetKey for O(1) merge.
  const overrideRows = await userDashboardWidgetsRepository.listForUser(
    userId,
    dashboardKey,
  );
  const overrides = new Map(overrideRows.map((r) => [r.widgetKey, r]));

  // Resolve: registry default + optional user override. Sort by the
  // resolved orderIndex (user override wins; falls back to default).
  const resolved = allowed
    .map((w) => {
      const override = overrides.get(w.key);
      return {
        widgetKey: w.key,
        title: w.title,
        sizePreset: w.sizePreset,
        heightPreset: w.heightPreset ?? "auto",
        description: w.description ?? null,
        visible: override?.visible ?? w.defaultVisible,
        orderIndex: override?.orderIndex ?? w.defaultOrder,
        allowed: true,
      };
    })
    .sort((a, b) => a.orderIndex - b.orderIndex);

  res.json({ dashboardKey, widgets: resolved });
}));

// ─── PUT /api/dashboard-layout ─────────────────────────────────────

router.put("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = validateSchema(dashboardLayoutPutSchema, req.body);
  if (!isKnownDashboard(body.dashboardKey)) {
    throw createError(400, `Unknown dashboardKey: ${body.dashboardKey}`);
  }
  const userId = req.user!.id;

  // Validate each posted widget key against the registry AND the
  // user's permissions. Unauthorized → reject (the user must NOT be
  // able to persist a row for a widget they can't see).
  for (const entry of body.widgets) {
    const def = getDashboardWidget(body.dashboardKey, entry.widgetKey);
    if (!def) {
      throw createError(
        400,
        `Unknown widgetKey "${entry.widgetKey}" for dashboard "${body.dashboardKey}"`,
      );
    }
    if (def.requiredPermission) {
      const ok = await userHasPermission(userId, def.requiredPermission);
      if (!ok) {
        throw createError(
          403,
          `Forbidden: user lacks "${def.requiredPermission}" required by widget "${entry.widgetKey}"`,
        );
      }
    }
  }

  await userDashboardWidgetsRepository.replaceForUser(
    userId,
    body.dashboardKey,
    body.widgets,
  );

  // Re-read so the response shape mirrors GET — keeps the client's
  // optimistic-update path simple (PUT response IS the new state).
  const overrideRows = await userDashboardWidgetsRepository.listForUser(
    userId,
    body.dashboardKey,
  );
  const overrides = new Map(overrideRows.map((r) => [r.widgetKey, r]));
  const allowed = await filterByPermissions(
    userId,
    listDashboardWidgets(body.dashboardKey),
  );
  const resolved = allowed
    .map((w) => {
      const override = overrides.get(w.key);
      return {
        widgetKey: w.key,
        title: w.title,
        sizePreset: w.sizePreset,
        heightPreset: w.heightPreset ?? "auto",
        description: w.description ?? null,
        visible: override?.visible ?? w.defaultVisible,
        orderIndex: override?.orderIndex ?? w.defaultOrder,
        allowed: true,
      };
    })
    .sort((a, b) => a.orderIndex - b.orderIndex);

  res.json({ dashboardKey: body.dashboardKey, widgets: resolved });
}));

// ─── POST /api/dashboard-layout/reset ──────────────────────────────

router.post(
  "/reset",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { dashboardKey } = validateSchema(
      dashboardKeyQuerySchema,
      req.query,
    );
    if (!isKnownDashboard(dashboardKey)) {
      throw createError(400, `Unknown dashboardKey: ${dashboardKey}`);
    }
    const userId = req.user!.id;
    await userDashboardWidgetsRepository.resetForUser(userId, dashboardKey);
    res.json({ ok: true });
  }),
);

export default router;

// Re-export the registry size sanity check for the test suite — pins
// the registry has at least the financial dashboard's six widgets so
// a future split doesn't silently drop any.
export const __TEST_DASHBOARD_WIDGET_COUNT = DASHBOARD_WIDGETS.length;
