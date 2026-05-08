/**
 * Pricebook Groups — TanStack Query hooks (2026-05-07 RALPH).
 *
 * Read + mutation hooks for `/api/pricebook-groups`. Centralizes the
 * query keys + invalidation strategy so the picker rail, the New
 * Group modal, and any future group-management UI all share one
 * cache. Mutations invalidate the list so the rail reflects new /
 * edited / archived groups without a manual refetch.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { PricebookGroupSummaryDto } from "@/components/line-items/pricebookHelpers";

const GROUPS_LIST_KEY = ["/api/pricebook-groups"] as const;

/** Read all active groups for the tenant (most-used first). */
export function usePricebookGroups(opts: { enabled?: boolean } = {}) {
  return useQuery<PricebookGroupSummaryDto[]>({
    queryKey: GROUPS_LIST_KEY,
    queryFn: () =>
      apiRequest<PricebookGroupSummaryDto[]>(
        "/api/pricebook-groups?sort=most_used",
      ),
    staleTime: 30_000,
    enabled: opts.enabled ?? true,
  });
}

export interface CreatePricebookGroupBody {
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  children: ReadonlyArray<{
    itemId: string;
    quantity: string;
    sortOrder?: number;
  }>;
}

export function useCreatePricebookGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePricebookGroupBody) =>
      apiRequest<PricebookGroupSummaryDto>("/api/pricebook-groups", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GROUPS_LIST_KEY });
    },
  });
}

export interface UpdatePricebookGroupBody {
  name?: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  children?: ReadonlyArray<{
    itemId: string;
    quantity: string;
    sortOrder?: number;
  }>;
}

export function useUpdatePricebookGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePricebookGroupBody }) =>
      apiRequest<PricebookGroupSummaryDto>(`/api/pricebook-groups/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GROUPS_LIST_KEY });
    },
  });
}

/**
 * Hard-delete a Pricebook Group. Removes the group row and its
 * child rows (FK cascade). The underlying pricebook items are NOT
 * deleted — only the bundle definition. List-key invalidation makes
 * the picker rail re-render without the deleted card.
 *
 * 2026-05-07 RALPH: renamed from `useArchivePricebookGroup`. The
 * server endpoint is unchanged (`DELETE /api/pricebook-groups/:id`)
 * but its semantics flipped from soft-archive to hard delete; the
 * hook name now matches.
 */
export function useDeletePricebookGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<{ ok: boolean }>(`/api/pricebook-groups/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GROUPS_LIST_KEY });
    },
  });
}

/**
 * Fire-and-forget usage increment. Called from the picker submit
 * handler after a successful bulk-add. Returns a void promise so
 * callers can `Promise.all` multiple increments (one per selected
 * group). Errors are swallowed at the caller side — usage tracking
 * is advisory and should never block the bulk-add UX.
 */
export interface RecordPricebookGroupUsageBody {
  target: "job" | "quote" | "invoice" | "job_template" | "quote_template" | "pm_template";
  targetId?: string | null;
  delta?: number;
}

export function recordPricebookGroupUsage(
  id: string,
  body: RecordPricebookGroupUsageBody,
): Promise<void> {
  return apiRequest<unknown>(`/api/pricebook-groups/${id}/usage`, {
    method: "POST",
    body: JSON.stringify(body),
  }).then(() => undefined);
}
