import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceConfig, WorkspaceController, WorkspaceFilters, WorkspaceSort } from "@/components/workspace/types";
import { useWorkspaceRailCollapse } from "./useWorkspaceRailCollapse";
import { useWorkspaceViewUrl } from "./useWorkspaceViewUrl";

/**
 * Canonical workspace controller hook.
 *
 * Owns: left-rail collapse (localStorage-persisted), active view (URL-synced),
 * searchQuery, filters, sort. Resets search/filters/sort synchronously when
 * the active view changes.
 *
 * Does NOT own: selection state, right-rail expansion. Those remain at the
 * domain coordinator level because selection context is entity-typed
 * (InvoicesWorkspaceTab owns SelectedReceivablesContext, etc.).
 *
 * Navigation: if WorkspaceConfig.onNavigate is provided, setView calls it
 * and the domain handles URL construction (e.g. preserving tab=invoices).
 * Otherwise setView is a no-op for navigation — the domain must call its
 * own setLocation.
 */
export function useWorkspaceState(config: WorkspaceConfig): WorkspaceController {
  const { lsKey, validViews, defaultView = validViews[0] as string, onNavigate, onViewChange } = config;

  const { collapsed: leftRailCollapsed, toggle: toggleLeftRail } =
    useWorkspaceRailCollapse(`${lsKey}.railCollapsed`);

  const activeView = useWorkspaceViewUrl(validViews, defaultView as typeof validViews[number]);

  const [searchQuery, setSearchQueryInternal] = useState("");
  const [filters, setFiltersInternal] = useState<WorkspaceFilters>({});
  const [sort, setSortInternal] = useState<WorkspaceSort | null>(null);

  // Reset search/filters/sort when view changes, then notify domain.
  // Synchronous via useEffect (React batches this with the URL update render).
  const prevViewRef = useRef(activeView);
  useEffect(() => {
    if (prevViewRef.current !== activeView) {
      prevViewRef.current = activeView;
      setSearchQueryInternal("");
      setFiltersInternal({});
      setSortInternal(null);
      onViewChangeRef.current?.();
    }
  }, [activeView]);

  // Stable refs so callbacks can be called without appearing in dep arrays.
  const onNavigateRef = useRef(onNavigate);
  useEffect(() => { onNavigateRef.current = onNavigate; }, [onNavigate]);

  const onViewChangeRef = useRef(onViewChange);
  useEffect(() => { onViewChangeRef.current = onViewChange; }, [onViewChange]);

  const setView = useCallback((view: string) => {
    onNavigateRef.current?.(view);
  }, []);

  const setSearchQuery = useCallback((q: string) => setSearchQueryInternal(q), []);

  const setFilter = useCallback((key: string, value: unknown) => {
    setFiltersInternal((prev) => ({ ...prev, [key]: value }));
  }, []);

  const clearFilters = useCallback(() => setFiltersInternal({}), []);

  const setSort = useCallback((field: string, direction: "asc" | "desc") => {
    setSortInternal({ field, direction });
  }, []);

  const clearSort = useCallback(() => setSortInternal(null), []);

  // Phase 2: selection managed by domain. These are stubs satisfying the
  // WorkspaceController interface for future Phase 3 wiring.
  const setSelectedIds = useCallback((_ids: string[], _activeId?: string | null) => {}, []);
  const clearSelection = useCallback(() => {}, []);

  return {
    // Rail geometry
    leftRailCollapsed,
    rightRailExpanded: false, // domain-owned in Phase 2
    toggleLeftRail,
    // View
    activeView,
    setView,
    // Search
    searchQuery,
    setSearchQuery,
    // Filters
    filters,
    setFilter,
    clearFilters,
    // Sort
    sort,
    setSort,
    clearSort,
    // Selection (domain-owned in Phase 2)
    selectedIds: [],
    activeEntityId: null,
    setSelectedIds,
    clearSelection,
  };
}
