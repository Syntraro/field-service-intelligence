/**
 * useCalendarDnD - Calendar Drag/Drop with Optimistic Updates
 *
 * Handles:
 * - Create assignment mutations
 * - Update assignment mutations
 * - Delete assignment mutations
 * - Optimistic UI updates with snapshot rollback
 * - Error handling via calendarErrorHandler
 */

import { useCallback, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { handleCalendarMutationError } from "@/components/calendar/calendarErrorHandler";

// ============================================================================
// Types
// ============================================================================

export interface CreateAssignmentParams {
  locationId: string;
  day: number;
  scheduledHour?: number;
  scheduledStartMinutes?: number;
  targetYear: number;
  targetMonth: number;
}

export interface UpdateAssignmentParams {
  id: string;
  day: number;
  scheduledHour?: number | null;
  scheduledStartMinutes?: number | null;
  targetYear?: number;
  targetMonth?: number;
}

export interface AssignTechniciansParams {
  assignmentId: string;
  technicianIds: string[];
}

// Snapshot for rollback
interface OptimisticSnapshot {
  queryKey: unknown[];
  data: unknown;
}

// ============================================================================
// Hook
// ============================================================================

export function useCalendarDnD(
  year: number,
  month: number,
  currentDate: Date,
  view: string,
  refetchCalendar: () => Promise<unknown>
) {
  const { toast } = useToast();
  const snapshotRef = useRef<OptimisticSnapshot | null>(null);

  // Query key for current calendar data
  const getCalendarQueryKey = useCallback(() => {
    return ["/api/calendar", view, year, month, currentDate.getTime()];
  }, [view, year, month, currentDate]);

  // ========================================
  // Create Assignment Mutation
  // ========================================
  const createAssignment = useMutation({
    mutationFn: async (params: CreateAssignmentParams) => {
      const { locationId, day, scheduledHour, scheduledStartMinutes, targetYear, targetMonth } = params;
      return apiRequest(`/api/calendar/assignments`, {
        method: "POST",
        body: JSON.stringify({
          locationId,
          clientId: locationId, // Legacy fallback
          year: targetYear,
          month: targetMonth,
          day,
          scheduledDate: new Date(targetYear, targetMonth - 1, day).toISOString().split('T')[0],
          scheduledHour: scheduledHour !== undefined ? scheduledHour : undefined,
          scheduledStartMinutes: scheduledStartMinutes !== undefined ? scheduledStartMinutes : undefined,
          autoDueDate: false,
        }),
      });
    },
    onMutate: async (params) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: getCalendarQueryKey() });

      // Snapshot current data for rollback
      const queryKey = getCalendarQueryKey();
      const previousData = queryClient.getQueryData(queryKey);
      snapshotRef.current = { queryKey, data: previousData };

      // Optimistic update: add a placeholder assignment
      if (previousData && typeof previousData === 'object' && 'assignments' in previousData) {
        const optimisticAssignment = {
          id: `optimistic-${Date.now()}`,
          locationId: params.locationId,
          clientId: params.locationId,
          year: params.targetYear,
          month: params.targetMonth,
          day: params.day,
          scheduledHour: params.scheduledHour ?? null,
          scheduledStartMinutes: params.scheduledStartMinutes ?? 0,
          durationMinutes: 60,
          completed: false,
          _optimistic: true,
        };

        queryClient.setQueryData(queryKey, {
          ...(previousData as object),
          assignments: [...((previousData as any).assignments || []), optimisticAssignment],
        });
      }

      return { previousData, queryKey };
    },
    onSuccess: async () => {
      snapshotRef.current = null;
      await refetchCalendar();
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Client scheduled",
        description: "The client has been added to the calendar",
      });
    },
    onError: async (error: any, _, context) => {
      // Rollback to snapshot
      if (context?.previousData && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousData);
      }
      snapshotRef.current = null;

      const handled = await handleCalendarMutationError(error);
      if (!handled) {
        toast({
          title: "Error",
          description: error.message || "Failed to schedule client",
          variant: "destructive",
        });
      }
    },
  });

  // ========================================
  // Update Assignment Mutation
  // ========================================
  const updateAssignment = useMutation({
    mutationFn: async (params: UpdateAssignmentParams) => {
      const { id, day, scheduledHour, scheduledStartMinutes } = params;
      // Use provided values or fall back to hook's year/month
      const useYear = params.targetYear ?? year;
      const useMonth = params.targetMonth ?? month;
      return apiRequest(`/api/calendar/assignments/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          year: useYear,
          month: useMonth,
          day,
          scheduledDate: new Date(useYear, useMonth - 1, day).toISOString().split('T')[0],
          scheduledHour: scheduledHour !== undefined ? scheduledHour : undefined,
          scheduledStartMinutes: scheduledStartMinutes !== undefined ? scheduledStartMinutes : undefined,
        }),
      });
    },
    onMutate: async (params) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: getCalendarQueryKey() });

      // Snapshot current data for rollback
      const queryKey = getCalendarQueryKey();
      const previousData = queryClient.getQueryData(queryKey);
      snapshotRef.current = { queryKey, data: previousData };

      // Use provided values or fall back to hook's year/month for optimistic update
      const useYear = params.targetYear ?? year;
      const useMonth = params.targetMonth ?? month;

      // Optimistic update: modify the assignment in place
      if (previousData && typeof previousData === 'object' && 'assignments' in previousData) {
        const updatedAssignments = ((previousData as any).assignments || []).map((a: any) => {
          if (a.id === params.id) {
            return {
              ...a,
              year: useYear,
              month: useMonth,
              day: params.day,
              scheduledHour: params.scheduledHour ?? a.scheduledHour,
              scheduledStartMinutes: params.scheduledStartMinutes ?? a.scheduledStartMinutes,
              _optimistic: true,
            };
          }
          return a;
        });

        queryClient.setQueryData(queryKey, {
          ...(previousData as object),
          assignments: updatedAssignments,
        });
      }

      return { previousData, queryKey };
    },
    onSuccess: async () => {
      snapshotRef.current = null;
      await refetchCalendar();
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/overdue"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Updated",
        description: "The assignment has been moved",
      });
    },
    onError: async (error: any, _, context) => {
      // Rollback to snapshot
      if (context?.previousData && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousData);
      }
      snapshotRef.current = null;

      const handled = await handleCalendarMutationError(error);
      if (!handled) {
        toast({
          title: "Error",
          description: error.message || "Failed to update assignment",
          variant: "destructive",
        });
      }
    },
  });

  // ========================================
  // Update Duration Mutation
  // ========================================
  const updateDuration = useMutation({
    mutationFn: async ({ id, durationMinutes }: { id: string; durationMinutes: number }) => {
      return apiRequest(`/api/calendar/assignments/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ durationMinutes }),
      });
    },
    onSuccess: async () => {
      await refetchCalendar();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update duration",
        variant: "destructive",
      });
    },
  });

  // ========================================
  // Delete Assignment Mutation
  // ========================================
  const deleteAssignment = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/calendar/assignments/${id}`, { method: "DELETE" });
    },
    onMutate: async (id) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: getCalendarQueryKey() });

      // Snapshot current data for rollback
      const queryKey = getCalendarQueryKey();
      const previousData = queryClient.getQueryData(queryKey);
      snapshotRef.current = { queryKey, data: previousData };

      // Optimistic update: remove the assignment
      if (previousData && typeof previousData === 'object' && 'assignments' in previousData) {
        const filteredAssignments = ((previousData as any).assignments || []).filter(
          (a: any) => a.id !== id
        );

        queryClient.setQueryData(queryKey, {
          ...(previousData as object),
          assignments: filteredAssignments,
        });
      }

      return { previousData, queryKey };
    },
    onSuccess: async () => {
      snapshotRef.current = null;
      await refetchCalendar();
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Removed",
        description: "The client has been unscheduled",
      });
    },
    onError: async (error: any, _, context) => {
      // Rollback to snapshot
      if (context?.previousData && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousData);
      }
      snapshotRef.current = null;

      toast({
        title: "Error",
        description: error.message || "Failed to remove assignment",
        variant: "destructive",
      });
    },
  });

  // ========================================
  // Assign Technicians Mutation
  // ========================================
  const assignTechnicians = useMutation({
    mutationFn: async ({ assignmentId, technicianIds }: AssignTechniciansParams) => {
      return apiRequest(`/api/calendar/assignments/${assignmentId}`, {
        method: "PATCH",
        body: JSON.stringify({ assignedTechnicianIds: technicianIds }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar"], exact: false });
      toast({
        title: "Updated",
        description: "Technician assignments updated",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to assign technicians",
        variant: "destructive",
      });
    },
  });

  // ========================================
  // Clear Schedule Mutations
  // ========================================
  const clearSchedule = useMutation({
    mutationFn: async (assignmentsToDelete: any[]) => {
      const deletePromises = assignmentsToDelete.map((assignment: any) =>
        apiRequest(`/api/calendar/assignments/${assignment.id}`, { method: "DELETE" })
      );
      return Promise.all(deletePromises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar", year, month] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Schedule cleared",
        description: "All clients have been moved to unscheduled",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to clear schedule",
        variant: "destructive",
      });
    },
  });

  const clearDay = useMutation({
    mutationFn: async ({ day, dayAssignments }: { day: number; dayAssignments: any[] }) => {
      const deletePromises = dayAssignments.map((assignment: any) =>
        apiRequest(`/api/calendar/assignments/${assignment.id}`, { method: "DELETE" })
      );
      return Promise.all(deletePromises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar", year, month] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Day cleared",
        description: "All clients for this day have been unscheduled",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to clear day",
        variant: "destructive",
      });
    },
  });

  // ========================================
  // Toggle Complete Mutation
  // ========================================
  const toggleComplete = useMutation({
    mutationFn: async ({ assignmentId, currentCompleted }: { assignmentId: string; currentCompleted: boolean }) => {
      return apiRequest(`/api/calendar/assignments/${assignmentId}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: !currentCompleted }),
      });
    },
    onSuccess: (_, { currentCompleted }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar", year, month] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/unscheduled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calendar/overdue"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/recently-completed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/statuses"] });
      toast({
        title: "Updated",
        description: currentCompleted ? "Marked as incomplete" : "Marked as complete",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update completion status",
        variant: "destructive",
      });
    },
  });

  // Computed saving state
  const isSavingDrag = createAssignment.isPending || updateAssignment.isPending || deleteAssignment.isPending;

  return {
    // Mutations
    createAssignment,
    updateAssignment,
    updateDuration,
    deleteAssignment,
    assignTechnicians,
    clearSchedule,
    clearDay,
    toggleComplete,

    // State
    isSavingDrag,
  };
}
