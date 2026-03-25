import { useMutation, UseMutationOptions } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";

// Common query key groups for invalidation
export const QUERY_GROUPS = {
  calendar: [
    ["/api/calendar"],
    ["/api/calendar/unscheduled"],
  ],
  // Phase 4 Step C5: canonical family key
  jobs: [
    ["jobs"],
  ],
  clients: [
    ["/api/clients"],
  ],
  maintenance: [
    ["/api/maintenance/statuses"],
    ["/api/maintenance/recently-completed"],
  ],
  // Phase 5 Step A7: canonical family key
  invoices: [
    ["invoices"],
  ],
  equipment: [
    ["/api/equipment"],
  ],
  parts: [
    ["/api/items"],
    ["/api/client-parts/bulk"],
  ],
  // Phase 5 Step B3: canonical family key
  dashboard: [
    ["dashboard"],
  ],
} as const;

type QueryGroup = keyof typeof QUERY_GROUPS;

interface InvalidateOptions {
  groups?: QueryGroup[];
  keys?: (string | readonly unknown[])[];
}

/**
 * Invalidate multiple query groups at once
 */
export function invalidateQueries(options: InvalidateOptions) {
  const { groups = [], keys = [] } = options;

  // Invalidate by group
  groups.forEach((group) => {
    QUERY_GROUPS[group].forEach((queryKey) => {
      queryClient.invalidateQueries({ queryKey });
    });
  });

  // Invalidate specific keys
  keys.forEach((key) => {
    const queryKey = typeof key === "string" ? [key] : key;
    queryClient.invalidateQueries({ queryKey });
  });
}

interface MutationWithToastOptions<TData, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  successMessage?: string | ((data: TData, variables: TVariables) => string);
  errorMessage?: string;
  invalidate?: InvalidateOptions;
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: Error) => void;
}

/**
 * A wrapper around useMutation that handles:
 * - Toast notifications on success/error
 * - Query invalidation
 * - Consistent error handling
 */
export function useMutationWithToast<TData = unknown, TVariables = void>({
  mutationFn,
  successMessage,
  errorMessage = "Operation failed",
  invalidate,
  onSuccess,
  onError,
}: MutationWithToastOptions<TData, TVariables>) {
  return useMutation({
    mutationFn,
    onSuccess: (data, variables) => {
      // Invalidate queries
      if (invalidate) {
        invalidateQueries(invalidate);
      }

      // Show success toast
      if (successMessage) {
        const message = typeof successMessage === "function"
          ? successMessage(data, variables)
          : successMessage;
        toast({ title: message });
      }

      // Call custom onSuccess
      onSuccess?.(data, variables);
    },
    onError: (error: Error) => {
      toast({
        title: errorMessage,
        description: error.message,
        variant: "destructive",
      });
      onError?.(error);
    },
  });
}

// Convenience functions for common API patterns
