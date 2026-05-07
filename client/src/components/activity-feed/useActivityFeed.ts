/**
 * Activity Feed query/mutation hooks.
 *
 * - useActivityFeed:        paginated list of operational events.
 * - useActivityPreferences: GET the user's enabled event_type list.
 * - useUpdateActivityPreferences: PUT replacement set.
 *
 * Tenant scoping is enforced server-side; query keys are stable strings
 * so cache survives across pages.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ActivityFeedEventType } from "@shared/activityFeedRegistry";

export interface ActivityFeedItem {
  id: string;
  tenantId: string;
  actorUserId: string | null;
  actorType: string;
  entityType: string;
  entityId: string;
  eventType: string;
  severity: string;
  summary: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
  /**
   * Server-side enrichment from the LEFT JOIN on `users` keyed by
   * `actorUserId`. Null when the event was emitted by the system or the
   * user has been deleted (FK ON DELETE SET NULL).
   */
  actor: { id: string; name: string } | null;
}

export interface ActivityFeedResponse {
  items: ActivityFeedItem[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ActivityPreferencesResponse {
  enabledEventTypes: ActivityFeedEventType[];
  availableEventTypes: readonly ActivityFeedEventType[];
  defaultEnabledEventTypes: ActivityFeedEventType[];
}

export const ACTIVITY_FEED_QUERY_KEY = ["/api/activity-feed"] as const;
export const ACTIVITY_PREFERENCES_QUERY_KEY = ["/api/activity-feed/preferences"] as const;

export function useActivityFeed(opts: { enabled?: boolean; limit?: number } = {}) {
  const { enabled = true, limit = 30 } = opts;
  return useQuery<ActivityFeedResponse>({
    queryKey: [...ACTIVITY_FEED_QUERY_KEY, limit],
    queryFn: async () => {
      const res = await fetch(`/api/activity-feed?limit=${limit}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load activity feed (${res.status})`);
      return res.json();
    },
    enabled,
    // Refetch when the drawer is reopened — but never poll in the
    // background. Background polling is forbidden by the perf baseline
    // unless explicitly justified (CLAUDE.md §Performance Regression).
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

export function useActivityPreferences(opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;
  return useQuery<ActivityPreferencesResponse>({
    queryKey: ACTIVITY_PREFERENCES_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/activity-feed/preferences", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load preferences (${res.status})`);
      return res.json();
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useUpdateActivityPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabledEventTypes: ActivityFeedEventType[]) => {
      return apiRequest<ActivityPreferencesResponse>("/api/activity-feed/preferences", {
        method: "PUT",
        body: JSON.stringify({ enabledEventTypes }),
      });
    },
    onSuccess: (data) => {
      // Optimistically replace the prefs cache + invalidate the feed
      // so the next render reflects the new visibility set.
      queryClient.setQueryData(ACTIVITY_PREFERENCES_QUERY_KEY, data);
      queryClient.invalidateQueries({ queryKey: ACTIVITY_FEED_QUERY_KEY });
    },
  });
}
