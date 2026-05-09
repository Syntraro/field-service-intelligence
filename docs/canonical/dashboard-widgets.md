# Canonical Dashboard Widget Framework

Registry: `shared/dashboardWidgetRegistry.ts`
Implementation: `DashboardWidgetGrid.tsx`, `DashboardCustomizeDrawer.tsx`, `useDashboardLayout`

## Architecture

The registry is the SINGLE source of truth for which widgets exist, their default order, default visibility, required permission, and column-span. No hardcoded widget order anywhere else.

### Key Invariants

- **Key stability:** Widget `key` values are persisted in `user_dashboard_widgets`. Renaming requires a SQL migration or compat alias. See the file-level "STABILITY WARNING" in the registry.
- **Hidden widgets must not fetch:** Page-level queries gate on `enabled: visibleSet.has(widgetKey)`. Toggling a widget off stops its data load.
- **Drag-to-reorder lives on the live grid only.** `DashboardWidgetGrid.tsx` mounts `DndContext` + `SortableContext` (`rectSortingStrategy`), wraps each visible widget cell with `useSortable`, and renders a drag handle in the cell's top-right corner. The drag handle button is the only DnD activator — `attributes` + `listeners` spread on the button, NOT on the cell wrapper.
- **Customize drawer is show/hide only.** No drag wiring in `DashboardCustomizeDrawer.tsx`.
- **Persistence:** Once on drag-end and once per toggle. Not on drag-over. Optimistic update + rollback on error.
- **`setOrder` preserves hidden widget order:** The hook's `setOrder` appends any omitted (hidden) keys, so dragging visible cards never re-enables hidden ones.

### Server Enforcement

- **GET resolver:** Iterates the registry (not override rows), filtering out widgets the user lacks permission for. Orphan persisted rows (key no longer in registry) are silently ignored.
- **PUT handler:** Rejects unknown keys at HTTP 400 (stale client cannot persist orphans). Rejects unauthorized widget keys at HTTP 403.

## Adding a Widget

1. Append a `DashboardWidgetDefinition` to the appropriate `*_DASHBOARD_WIDGETS` array in `shared/dashboardWidgetRegistry.ts`. Choose a stable snake_case `key`. Set `defaultOrder` to next free slot (existing rows spaced by 10).
2. If permission-gated, set `requiredPermission` to the canonical permission key (e.g., `"finance.view"`).
3. On the page, add the renderer entry to the `Record<widgetKey, ReactNode>` map. The page owns data-fetching.
4. Gate expensive queries: `useQuery({ ..., enabled: visibleSet.has("widget_key") })`.
5. Add a registry-pin assertion to `tests/dashboard-customize-framework.test.ts` for the new key, sizePreset, and permission.
6. Update `CHANGELOG.md`.

## Widget Definition Shape

```ts
{
  key: "revenue_summary",        // stable, snake_case, persisted
  label: "Revenue Summary",
  defaultOrder: 10,              // spaced by 10
  defaultVisible: true,
  sizePreset: "half",            // "full" | "half" | "third"
  requiredPermission: "finance.view",  // omit if unrestricted
}
```
