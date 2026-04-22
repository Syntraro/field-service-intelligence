/**
 * useEffectivePermissions — canonical read hook for the currently
 * authenticated user's effective permission set (role perms merged with
 * user overrides).
 *
 * 2026-04-21 Phase 1 canonical policy architecture:
 *   Single round-trip to `GET /api/me/permissions`. Intended for UI
 *   affordance decisions (show / hide buttons). Server still enforces
 *   on every protected route — this hook is NOT a policy surface.
 */
import { useQuery } from "@tanstack/react-query";

export interface EffectivePermissionsResponse {
  userId: string;
  permissions: string[];
}

export function useEffectivePermissions() {
  return useQuery<EffectivePermissionsResponse>({
    queryKey: ["/api/me/permissions"],
    queryFn: async () => {
      const res = await fetch("/api/me/permissions", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load effective permissions (${res.status})`);
      return res.json();
    },
    staleTime: 60_000,
  });
}

/**
 * Convenience: does the current user hold the named permission? Returns
 * `undefined` while loading so callers can distinguish "not yet known"
 * from "no permission".
 */
export function useHasPermission(permissionKey: string): boolean | undefined {
  const { data, isLoading } = useEffectivePermissions();
  if (isLoading || !data) return undefined;
  return data.permissions.includes(permissionKey);
}
