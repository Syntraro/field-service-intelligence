/**
 * useTenantFeatures — read-only tenant feature flags for the office UI.
 *
 * Backs portal-aware CTAs on InvoiceDetailPage and ClientBillingTab by
 * telling the UI whether `customerPortalEnabled` / `customerPortalPaymentsEnabled`
 * are on for this tenant. Source of truth: `GET /api/company-settings/features`.
 *
 * Query key namespaced under `company-settings` so invalidation from a
 * future admin-side features editor propagates here naturally.
 */
import { useQuery } from "@tanstack/react-query";

export interface TenantFeatures {
  companyId: string;
  // Portal flags (the only two we consume today; the endpoint returns
  // the full row so additional feature flags can be read without a new
  // round-trip if needed).
  customerPortalEnabled: boolean;
  customerPortalPaymentsEnabled: boolean;
  // Other known flags — typed loosely; not consumed directly here.
  [key: string]: unknown;
}

export function useTenantFeatures() {
  return useQuery<TenantFeatures>({
    queryKey: ["company-settings", "features"],
    queryFn: async () => {
      const res = await fetch("/api/company-settings/features", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load tenant features (${res.status})`);
      return res.json();
    },
    // Features rarely change; mirror the server cache window.
    staleTime: 5 * 60_000,
  });
}
