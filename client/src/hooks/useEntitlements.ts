/**
 * useEntitlements — canonical read hook for feature + limit + usage +
 * account state.
 *
 * 2026-04-21 Phase 1 canonical policy architecture:
 *   Single round-trip to `GET /api/me/entitlements`. Returns the shape the
 *   entitlement resolver produces on the server — `features[key].enabled`,
 *   `limits[key]`, `accountState`, `plan`. This replaces scattered calls
 *   to `/api/company-settings/features` + `/api/subscriptions/usage` for
 *   surfaces migrated in Phase 2. Phase 1 adds the hook without wiring it
 *   into existing UI (opt-in for new surfaces).
 */
import { useQuery } from "@tanstack/react-query";

export interface EntitlementFeature {
  enabled: boolean;
  source: string;
  isCore: boolean;
  category: string;
  displayName: string;
}

export interface EntitlementLimit {
  limit: number | null;
  usage: number;
  isUnlimited: boolean;
  limitType: string;
}

export interface EntitlementAccountState {
  subscriptionStatus: string | null;
  entitled: boolean;
  reason: string | null;
  trialEndsAt: string | null;
}

export interface EntitlementResponse {
  companyId: string;
  plan: {
    id: string | null;
    name: string | null;
  };
  accountState: EntitlementAccountState;
  features: Record<string, EntitlementFeature>;
  limits: Record<string, EntitlementLimit>;
  usage: Record<string, number>;
}

export function useEntitlements() {
  return useQuery<EntitlementResponse>({
    queryKey: ["/api/me/entitlements"],
    queryFn: async () => {
      const res = await fetch("/api/me/entitlements", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load entitlements (${res.status})`);
      return res.json();
    },
    // Feature state rarely changes; match the server-side resolver cache window.
    staleTime: 60_000,
  });
}

/**
 * Convenience: returns `true` if the named feature is enabled. Returns
 * `undefined` while the entitlement query is still loading so callers can
 * distinguish "not yet known" from "explicitly disabled".
 */
export function useFeatureEnabled(featureKey: string): boolean | undefined {
  const { data, isLoading } = useEntitlements();
  if (isLoading || !data) return undefined;
  return data.features[featureKey]?.enabled ?? false;
}
