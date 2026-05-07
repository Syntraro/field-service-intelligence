/**
 * Frontend-side re-export of the canonical dashboard widget registry
 * (2026-05-07 RALPH).
 *
 * The single source of truth lives at `shared/dashboardWidgetRegistry.ts`
 * (server consumes the same module for permission validation). This
 * file is a passthrough so frontend imports can read
 * `@/dashboard/dashboardWidgetRegistry` instead of crossing the
 * shared/ boundary on every call site.
 *
 * NEVER add React imports here — keep it metadata-only so any future
 * refactor that splits client/server can keep this file unchanged.
 */
export {
  type DashboardWidgetDefinition,
  type DashboardWidgetSizePreset,
  FINANCIAL_DASHBOARD_WIDGETS,
  DASHBOARD_WIDGETS,
  DASHBOARD_KEYS,
  getDashboardWidget,
  listDashboardWidgets,
  isKnownDashboard,
} from "@shared/dashboardWidgetRegistry";
