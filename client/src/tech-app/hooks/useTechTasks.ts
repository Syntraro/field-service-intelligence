/**
 * useTechTasks — fetches active tasks assigned to the authenticated tech.
 *
 * Backend: GET /api/tech/tasks/mine
 * Visibility: unscheduled (always), scheduled today/overdue, NOT completed/cancelled.
 * Ordering: overdue first, then today, then unscheduled.
 *
 * 2026-04-10: Created to add task visibility to the tech Today page.
 * 2026-04-10: Added startTask/stopTask mutations for canonical time_entries timer.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Task } from "@shared/schema";

export const TECH_TASKS_QUERY_KEY = ["/api/tech/tasks/mine"] as const;

interface TechTasksResponse {
  tasks: Task[];
  count: number;
  /** ID of task with currently running timer (from canonical time_entries), or null */
  runningTaskId: string | null;
}

export function useTechTasks() {
  const queryClient = useQueryClient();

  const query = useQuery<TechTasksResponse>({
    queryKey: TECH_TASKS_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/tech/tasks/mine", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch tasks");
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: TECH_TASKS_QUERY_KEY });
    // Also invalidate time tracking status since timer state changed
    queryClient.invalidateQueries({ queryKey: ["/api/tech/status"] });
  };

  const startMutation = useMutation({
    mutationFn: async (taskId: string) =>
      apiRequest(`/api/tech/tasks/${taskId}/start`, { method: "POST" }),
    onSuccess: invalidate,
  });

  const stopMutation = useMutation({
    mutationFn: async (taskId: string) =>
      apiRequest(`/api/tech/tasks/${taskId}/stop`, { method: "POST" }),
    onSuccess: invalidate,
  });

  const closeMutation = useMutation({
    mutationFn: async (taskId: string) =>
      apiRequest(`/api/tech/tasks/${taskId}/close`, { method: "POST" }),
    onSuccess: invalidate,
  });

  return {
    tasks: query.data?.tasks ?? [],
    runningTaskId: query.data?.runningTaskId ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    startTask: startMutation,
    stopTask: stopMutation,
    closeTask: closeMutation,
  };
}
