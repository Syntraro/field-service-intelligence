/**
 * Canonical dashboard widget registry — pure metadata, no React deps.
 *
 * 2026-05-07 RALPH: backbone of the customizable dashboard framework.
 * Both server and client consult this registry to validate widget keys,
 * resolve permissions, derive default ordering, and pick the responsive
 * column-span for each widget.
 *
 * SHAPE
 * -----
 * One `DashboardWidgetDefinition` per widget. Widgets are grouped by
 * `dashboardKey` (e.g. `"financial"`) so multiple dashboards can share
 * this registry without colliding. Listing order in this file is also
 * the canonical default order — the resolver prefers each row's
 * `defaultOrder` field, but lexical order is the ergonomic default
 * when adding a new widget.
 *
 * USAGE — SERVER
 * --------------
 * `PUT /api/dashboard/layout` validates each posted widget key against
 * `getDashboardWidget(dashboardKey, widgetKey)` AND, when the widget
 * declares `requiredPermission`, against `userHasPermission()`. Unknown
 * keys / unauthorized widgets are rejected at HTTP 400 — users cannot
 * persist a layout entry for a widget they aren't allowed to see.
 *
 * USAGE — CLIENT
 * --------------
 * `useDashboardLayout(dashboardKey)` reads the registry, layers user
 * overrides on top, and filters out permission-gated widgets the
 * current user lacks. The page provides a `Record<widgetKey, ReactNode>`
 * renderer map (so widgets keep their existing data-fetching props),
 * and `<DashboardWidgetGrid>` arranges them by resolved order using
 * the per-widget `sizePreset`.
 *
 * NEVER:
 *   • Import React from this file (the server consumes it too).
 *   • Hardcode widget order anywhere outside this registry.
 *   • Add per-widget styling — every widget owns its own card chrome.
 *   • Reuse a widget key across dashboards (keys are GLOBALLY unique
 *     for clarity even though the schema enforces uniqueness only per
 *     dashboard_key).
 *
 * STABILITY WARNING — DO NOT RENAME WIDGET KEYS CASUALLY
 * ------------------------------------------------------
 * Widget `key` values are PERSISTED USER DATA. Each row of
 * `user_dashboard_widgets` references a `widget_key` verbatim. Renaming
 * a key in this registry orphans every prior persisted row — users who
 * had reordered or hidden that widget will silently lose their override
 * after the rename (the resolver falls back to registry defaults).
 *
 * If you absolutely must rename a key:
 *   1. Add a SQL migration that backfills the old → new key in
 *      `user_dashboard_widgets` (a single UPDATE keyed on widget_key).
 *   2. OR keep a compatibility alias: leave the old key in the registry
 *      with `defaultVisible: false` until everyone has rolled forward.
 *   3. Document the rename in CHANGELOG.md and reference the migration.
 *
 * REMOVING A WIDGET — orphan safety is already handled
 * ----------------------------------------------------
 * Removing a widget from the registry is safe at runtime. The route
 * resolver iterates the REGISTRY (not the override rows) when building
 * the GET response, so unknown persisted rows are silently ignored.
 * `PUT /api/dashboard-layout` rejects unknown widget keys at HTTP 400
 * so a stale client cannot persist orphaned keys forward. Old rows are
 * harmless ballast — sweep them with a one-off DELETE if you care.
 *
 * HOW TO ADD A WIDGET
 * -------------------
 *   1. Append a new `DashboardWidgetDefinition` to the appropriate
 *      `*_DASHBOARD_WIDGETS` array below. Pick a stable snake_case key
 *      (e.g. `tech_utilization`). Set `defaultOrder` to the next free
 *      slot (we space them by 10 so future widgets can slot in).
 *   2. If the widget needs a permission, set `requiredPermission` to
 *      the canonical key (e.g. `"finance.view"`). The server filters
 *      it out for users without that permission AND rejects PUTs that
 *      reference it from unauthorized users.
 *   3. Add the renderer mapping on the page that hosts the dashboard
 *      (e.g. `FinancialDashboard.tsx` keeps a `Record<widgetKey,
 *      ReactNode>` map). The page owns data-fetching for each widget.
 *   4. If the widget triggers an expensive query, gate that query
 *      behind the resolved visibility (`enabled: visibleSet.has(key)`)
 *      so hidden widgets do NOT mount or fetch.
 *   5. Add a test pin to `tests/dashboard-customize-framework.test.ts`
 *      asserting the new key appears in the registry with the expected
 *      sizePreset / permission.
 *   6. Update `CHANGELOG.md` under `[Unreleased]`.
 */

/** Canonical dashboard width preset — the 3-column card system.
 *  Every widget occupies 1, 2, or 3 of the dashboard's three equal
 *  columns at desktop. The preset NAMES preserve the historical
 *  registry vocabulary; the INTERNAL model in DashboardWidgetGrid.tsx
 *  maps each preset to a `widthUnits` value (1 | 2 | 3) so the row
 *  packer can think in clean column units rather than 12-col math.
 *
 *  - "third"       → 1 column  → col-span-12 mobile, col-span-6 md,
 *                                col-span-4 xl.
 *  - "two-thirds"  → 2 columns → col-span-12 mobile, col-span-8 xl.
 *  - "full"        → 3 columns → col-span-12 at every breakpoint.
 *
 *  The grid honours each widget's natural width when a row's units
 *  sum to exactly 3, and rebalances slack rows (sum < 3) by stretching
 *  the row's contents to clean shares (single widget → full; two
 *  widgets → half + half) so hiding one card never produces awkward
 *  staggered spacing. See DashboardWidgetGrid.tsx for the algorithm.
 *
 *  Today's Schedule supports a runtime `widthUnitsOverride` (1 | 2 | 3)
 *  threaded into <DashboardWidgetGrid> from the page when the schedule
 *  card has fewer than 3 visible team members. This keeps the schedule
 *  card from stretching wider than the data inside it warrants. */
export type DashboardWidgetSizePreset =
  | "full"
  | "two-thirds"
  | "third";

/** Optional per-widget content-height preset. Default is "auto" — the
 *  card grows to its content. Other presets pin a min-height so summary
 *  cards align across a row without forcing every card to match the
 *  tallest neighbour.
 *  - "summary"  → ~280 px min height. The default for KPI summary cards
 *                 in the metric row (Pipeline, Collections, Scheduled
 *                 Revenue, Operational Alerts).
 *  - "large"    → ~440 px min height. Today's Schedule and similar
 *                 dense list widgets.
 *  - "compact"  → no min height beyond the card chrome. Needs Attention
 *                 (full-width, single line of action chips).
 *  - "auto"     → no min height; the widget controls its own height. */
export type DashboardWidgetHeightPreset =
  | "summary"
  | "large"
  | "compact"
  | "auto";

export interface DashboardWidgetDefinition {
  /**
   * Globally unique widget key (snake_case). Persisted verbatim in
   * `user_dashboard_widgets.widget_key`. **DO NOT RENAME** without a
   * migration or a compatibility alias — renaming silently orphans
   * every user's saved layout for this widget. See the file-level
   * "STABILITY WARNING" doc-block for the full rule.
   */
  key: string;
  /** Dashboard this widget belongs to. Initial values: "financial". */
  dashboardKey: string;
  /**
   * Human-readable title shown in the customize drawer. Stays here so
   * a widget rename doesn't require updating the page-level renderer
   * map AND the drawer copy.
   */
  title: string;
  /** Default visibility when the user has no override row. */
  defaultVisible: boolean;
  /** Default order when the user has no override row. Lower = top. */
  defaultOrder: number;
  /**
   * Canonical permission key required to see this widget. `null` =
   * everyone with dashboard access can see it. The server enforces
   * this on PUT (rejects unauthorized widgets); the client filters
   * the registry through it on read.
   */
  requiredPermission: string | null;
  /** Responsive column-span preset on the dashboard's 12-column grid. */
  sizePreset: DashboardWidgetSizePreset;
  /**
   * Optional content-height preset. Defaults to `"auto"` (widget owns
   * its own height). Use `"summary"` for KPI cards that should share
   * a baseline min-height with peers in the same row; `"large"` for
   * dense list widgets like Today's Schedule; `"compact"` for thin
   * full-width strips like Needs Attention. Mapping to Tailwind
   * classes lives in DashboardWidgetGrid.tsx.
   */
  heightPreset?: DashboardWidgetHeightPreset;
  /**
   * Optional short description rendered under the toggle in the
   * customize drawer. Keep to one sentence.
   */
  description?: string;
}

/** Initial Financial dashboard widget set. Order matches the prior
 *  hardcoded JSX layout in FinancialDashboard.tsx so a fresh tenant
 *  with no override rows sees the same dashboard they saw before
 *  this framework landed. */
export const FINANCIAL_DASHBOARD_WIDGETS: readonly DashboardWidgetDefinition[] = [
  {
    // 2026-05-07 RALPH: heightPreset is now `summary` like every
    // other dashboard card. Card height no longer depends on
    // technician count — TS body scrolls internally if it overflows.
    // Width is still dynamic (1/2/3 units) via the page's runtime
    // widthOverrides.
    key: "todays_schedule",
    dashboardKey: "financial",
    title: "Today's Schedule",
    description: "Per-tech capacity, open slots, and booked visits for today.",
    defaultVisible: true,
    defaultOrder: 10,
    requiredPermission: null,
    sizePreset: "two-thirds",
    heightPreset: "summary",
  },
  {
    // 2026-05-07 RALPH: Pipeline now sits next to Today's Schedule on
    // row 1 (TS = 2 units, Pipeline = 1 unit → packs to a clean 3-unit
    // row). This matches the brief's "default expected layout":
    //   Row 1: TS + Pipeline
    //   Row 2: Collections + Scheduled Revenue + Operational Alerts
    //   Row 3: Needs Attention
    key: "pipeline_snapshot",
    dashboardKey: "financial",
    title: "Pipeline",
    description: "Leads needing follow-up, quote drafts, awaiting response, stale.",
    defaultVisible: true,
    defaultOrder: 20,
    requiredPermission: null,
    sizePreset: "third",
    heightPreset: "summary",
  },
  {
    key: "collections_overview",
    dashboardKey: "financial",
    title: "Collections",
    description: "Outstanding A/R, overdue invoices, top customer balances.",
    defaultVisible: true,
    defaultOrder: 30,
    requiredPermission: null,
    sizePreset: "third",
    heightPreset: "summary",
  },
  {
    key: "scheduled_revenue",
    dashboardKey: "financial",
    title: "Scheduled Revenue",
    description: "Revenue booked over the next 1 / 7 / 30 days.",
    defaultVisible: true,
    defaultOrder: 40,
    requiredPermission: null,
    sizePreset: "third",
    heightPreset: "summary",
  },
  {
    // 2026-05-07 RALPH: moved from row-1 (next to TS) to row-2 to
    // match the brief's expected default layout. The widget key is
    // unchanged, so users who already saved a custom order keep it.
    key: "operational_alerts",
    dashboardKey: "financial",
    title: "Operational Alerts",
    description: "Past due, requires attention, ready to invoice, unscheduled.",
    defaultVisible: true,
    defaultOrder: 50,
    requiredPermission: null,
    sizePreset: "third",
    heightPreset: "summary",
  },
  {
    // 2026-05-07 RALPH: heightPreset is now `summary` like every
    // other dashboard card. The dashboard's visual rhythm is one
    // standard card height; NA's empty bottom space inside the card
    // is acceptable and preferable to mismatched card heights.
    key: "needs_attention",
    dashboardKey: "financial",
    title: "Needs Attention",
    description: "Billing / admin items waiting on action (invoices not sent).",
    defaultVisible: true,
    defaultOrder: 60,
    requiredPermission: null,
    sizePreset: "third",
    heightPreset: "summary",
  },
];

/** Every widget known to this build. Keyed first by dashboardKey, then
 *  by widgetKey. Frozen for reference stability (so a downstream
 *  `useMemo` against `DASHBOARD_WIDGETS` never re-runs on import). */
export const DASHBOARD_WIDGETS: ReadonlyArray<DashboardWidgetDefinition> = Object.freeze([
  ...FINANCIAL_DASHBOARD_WIDGETS,
]);

/** Every dashboard key the registry knows about. */
export const DASHBOARD_KEYS: readonly string[] = Object.freeze(
  Array.from(new Set(DASHBOARD_WIDGETS.map((w) => w.dashboardKey))),
);

/** O(1) lookup by (dashboardKey, widgetKey). Returns null when the key
 *  is unknown — server route rejects unknown keys at 400. */
export function getDashboardWidget(
  dashboardKey: string,
  widgetKey: string,
): DashboardWidgetDefinition | null {
  for (const w of DASHBOARD_WIDGETS) {
    if (w.dashboardKey === dashboardKey && w.key === widgetKey) return w;
  }
  return null;
}

/** All widgets for a given dashboard, in canonical default order. */
export function listDashboardWidgets(
  dashboardKey: string,
): DashboardWidgetDefinition[] {
  return DASHBOARD_WIDGETS.filter((w) => w.dashboardKey === dashboardKey)
    .slice()
    .sort((a, b) => a.defaultOrder - b.defaultOrder);
}

/** Whether the registry recognizes the given dashboard. */
export function isKnownDashboard(dashboardKey: string): boolean {
  return DASHBOARD_KEYS.includes(dashboardKey);
}
