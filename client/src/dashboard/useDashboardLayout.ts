/**
 * useDashboardLayout — canonical hook for the customizable dashboard
 * framework (2026-05-07 RALPH).
 *
 * Reads the resolved layout from `GET /api/dashboard-layout`, exposes
 * the resolved widget order + visibility to the page, and provides
 * stable mutators for the customize drawer:
 *
 *   • `widgets`        — the FULL resolved list (visible + hidden),
 *                         in resolved order. Permission-gated widgets
 *                         the user lacks are filtered out by the
 *                         server, so this list is safe to render
 *                         verbatim.
 *   • `visibleWidgets` — convenience filter (`widgets.filter(w => w.visible)`).
 *   • `setVisibility(widgetKey, visible)` — toggles ONE widget's
 *                         visibility and persists the new layout.
 *   • `setOrder(orderedKeys)` — replaces the order of the entire list
 *                         (drag-and-drop end handler in the drawer).
 *   • `reset()`        — POSTs to /reset; layout falls back to
 *                         registry defaults.
 *   • `isLoading`      — initial query loading flag.
 *   • `isSaving`       — true while a mutation is in flight.
 *
 * Stability contract:
 *   • Persistence mutations use the SAME query key as the read query
 *     so React Query keeps the rest of the page's queries untouched
 *     when layout changes — drag-reordering does NOT remount the
 *     dashboard or refetch dashboard data.
 *   • Mutations apply optimistic updates: the local cache flips
 *     instantly; rollback on error.
 *   • No widget-component imports here — the hook is data-only.
 *     Page-level renderer maps wire components in.
 */
import { useCallback, useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  DashboardLayoutResponse,
  DashboardLayoutResponseEntry,
} from "@shared/dashboardLayoutSchemas";

const LAYOUT_QUERY_KEY = (dashboardKey: string) =>
  ["dashboard-layout", dashboardKey] as const;

interface UseDashboardLayoutResult {
  /** Resolved widget list — registry defaults + user overrides
   *  applied + permission-gated widgets filtered out. Includes
   *  hidden widgets (the customize drawer needs them). */
  widgets: DashboardLayoutResponseEntry[];
  /** Visible-only convenience view. Same order as `widgets`. */
  visibleWidgets: DashboardLayoutResponseEntry[];
  /** True while the initial GET is in flight. */
  isLoading: boolean;
  /** True while a PUT or reset is being persisted. */
  isSaving: boolean;
  /** Toggle ONE widget's visibility. */
  setVisibility: (widgetKey: string, visible: boolean) => void;
  /** Replace the full ordered list (drag-end handler). */
  setOrder: (orderedKeys: readonly string[]) => void;
  /** Reset to tenant / registry defaults (clears user override rows). */
  reset: () => void;
  /** Last error from a mutation (cleared on next success). */
  error: Error | null;
}

export function useDashboardLayout(
  dashboardKey: string,
): UseDashboardLayoutResult {
  const queryClient = useQueryClient();
  const queryKey = LAYOUT_QUERY_KEY(dashboardKey);

  const query = useQuery<DashboardLayoutResponse>({
    queryKey,
    queryFn: () =>
      apiRequest<DashboardLayoutResponse>(
        `/api/dashboard-layout?dashboardKey=${encodeURIComponent(dashboardKey)}`,
      ),
    // Layout is per-user settings — refetch on focus is overkill and
    // would briefly flicker the customize drawer between local edits
    // and the server response. Manual invalidation only.
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });

  // Replace-style PUT mutation. The server treats the array as the
  // complete new layout; entries omitted fall back to defaults.
  const replaceMutation = useMutation({
    mutationFn: async (next: DashboardLayoutResponseEntry[]) => {
      const payload = {
        dashboardKey,
        widgets: next.map((w) => ({
          widgetKey: w.widgetKey,
          visible: w.visible,
          orderIndex: w.orderIndex,
        })),
      };
      return apiRequest<DashboardLayoutResponse>(
        "/api/dashboard-layout",
        {
          method: "PUT",
          body: JSON.stringify(payload),
        },
      );
    },
    onMutate: async (next) => {
      // Optimistic: update the cache immediately so toggles + drag
      // feel instant. Snapshot for rollback on error.
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<DashboardLayoutResponse>(queryKey);
      queryClient.setQueryData<DashboardLayoutResponse>(queryKey, {
        dashboardKey,
        widgets: next,
      });
      return { previous };
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(queryKey, ctx.previous);
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData<DashboardLayoutResponse>(queryKey, data);
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      await apiRequest<{ ok: boolean }>(
        `/api/dashboard-layout/reset?dashboardKey=${encodeURIComponent(dashboardKey)}`,
        { method: "POST" },
      );
      // Server-side state is cleared; refetch to pick up the resolved
      // registry defaults in one round-trip.
      return queryClient.invalidateQueries({ queryKey });
    },
  });

  const widgets = useMemo<DashboardLayoutResponseEntry[]>(
    () => query.data?.widgets ?? [],
    [query.data],
  );

  const visibleWidgets = useMemo(
    () => widgets.filter((w) => w.visible),
    [widgets],
  );

  const setVisibility = useCallback(
    (widgetKey: string, visible: boolean) => {
      const next = widgets.map((w) =>
        w.widgetKey === widgetKey ? { ...w, visible } : w,
      );
      replaceMutation.mutate(next);
    },
    [widgets, replaceMutation],
  );

  const setOrder = useCallback(
    (orderedKeys: readonly string[]) => {
      // Build a map of incoming order; preserve every widget's other
      // fields (visibility, title, sizePreset) by looking each up.
      const byKey = new Map(widgets.map((w) => [w.widgetKey, w]));
      const reordered: DashboardLayoutResponseEntry[] = [];
      for (let i = 0; i < orderedKeys.length; i++) {
        const w = byKey.get(orderedKeys[i]);
        if (!w) continue;
        reordered.push({ ...w, orderIndex: i });
      }
      // Append any widgets the caller didn't include (defensive — the
      // drawer always passes the full list, but a future caller could
      // pass a subset).
      for (const w of widgets) {
        if (!orderedKeys.includes(w.widgetKey)) {
          reordered.push({ ...w, orderIndex: reordered.length });
        }
      }
      replaceMutation.mutate(reordered);
    },
    [widgets, replaceMutation],
  );

  const reset = useCallback(() => {
    resetMutation.mutate();
  }, [resetMutation]);

  return {
    widgets,
    visibleWidgets,
    isLoading: query.isLoading,
    isSaving: replaceMutation.isPending || resetMutation.isPending,
    setVisibility,
    setOrder,
    reset,
    error:
      (replaceMutation.error as Error | null) ??
      (resetMutation.error as Error | null) ??
      null,
  };
}
