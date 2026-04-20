/**
 * useMyCapabilities — resolves the authenticated user's effective permissions
 * once and exposes a fast `has(key)` predicate. Wraps the canonical
 * `/api/team/:userId/effective-permissions` endpoint (same source of truth
 * used by the Manage Roles UI — no parallel permission store).
 *
 * Cached for the tech-app session; permissions change rarely in field use,
 * and the TanStack default `staleTime` keeps this from polling.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAuth } from "@/lib/auth";

export function useMyCapabilities() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const query = useQuery<string[]>({
    queryKey: userId ? [`/api/team/${userId}/effective-permissions`] : [],
    enabled: !!userId,
    staleTime: 10 * 60 * 1000,
  });

  const permissionSet = useMemo(() => new Set(query.data ?? []), [query.data]);

  return {
    isLoading: query.isLoading,
    has: (key: string) => permissionSet.has(key),
    all: permissionSet,
  };
}
