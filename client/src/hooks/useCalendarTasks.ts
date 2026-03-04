/**
 * useCalendarTasks - Hooks for fetching tasks for calendar integration
 *
 * Phase 3 of Calendar Page UI Rewrite (2026-03-04)
 *
 * - useCalendarTasks: Fetches tasks with scheduledStartAt in a date range
 * - useUnscheduledTasks: Fetches pending tasks without a scheduled date
 */

import { useQuery } from "@tanstack/react-query";

/** Normalize API response to task array (handles {items:[...]}, [...], {data:[...]}) */
function normalizeTasks(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

/**
 * Fetch tasks scheduled within a calendar date range.
 * Uses scheduledFromDate/scheduledToDate query params (Phase 2 backend).
 */
export function useCalendarTasks(startDate: string, endDate: string, enabled: boolean) {
  return useQuery({
    queryKey: ["/api/tasks", "calendar", startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams({
        scheduledFromDate: startDate,
        scheduledToDate: endDate,
        limit: "200",
      });
      const res = await fetch(`/api/tasks?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch calendar tasks");
      return normalizeTasks(await res.json());
    },
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Fetch unscheduled pending tasks (no scheduledStartAt).
 * Client-side filters for items where scheduledStartAt is null.
 */
export function useUnscheduledTasks(enabled: boolean) {
  return useQuery({
    queryKey: ["/api/tasks", "unscheduled"],
    queryFn: async () => {
      const params = new URLSearchParams({
        status: "pending",
        limit: "100",
      });
      const res = await fetch(`/api/tasks?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch unscheduled tasks");
      const tasks = normalizeTasks(await res.json());
      return tasks.filter((t: any) => !t.scheduledStartAt);
    },
    enabled,
    staleTime: 30_000,
  });
}
