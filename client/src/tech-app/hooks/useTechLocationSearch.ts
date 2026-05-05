/**
 * useTechLocationSearch — Phase 2 PR 3 (2026-05-04).
 *
 * Tech-PWA-only sibling of the canonical office hook
 * `useLocationSearch` (in `client/src/lib/entities/locationEntity.ts`).
 *
 * Why a separate hook? The office hook hits the office client-search
 * surface, authorized for tenant-admin reads. Tech callers need an
 * assignment-scoped data source; the backend exposes that as
 *   GET /api/tech/locations/search
 *   GET /api/tech/locations/:locationId
 * Sharing the office hook would either pull office permissions onto
 * tech callers (defeating the authz goal) or require runtime branching
 * inside a shared module. Two clearly named hooks keep each surface
 * coherent; the office hook is unchanged.
 *
 * Return shape is intentionally compatible with `LocationOption` from
 * the office hook so consumers (CreateJobPage, CreateLeadPage,
 * SearchPage) can swap the import without changing the rendering
 * code. `parentCompanyName` is dropped from the tech DTO; the field
 * stays optional on the type — tech callers that read it just see
 * `undefined`, which falsy-checks the same as the office hook's
 * already-equal value.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { LocationOption } from "@/lib/entities/locationEntity";

export type { LocationOption };
/** Alias kept for parity with the office hook's `LocationResult` export. */
export type LocationResult = LocationOption;

interface TechSearchResponse {
  data: Array<{
    id: string;
    companyName: string | null;
    location: string | null;
    address: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    phone: string | null;
  }>;
  meta: { hasMore: boolean };
}

function normalizeRow(r: TechSearchResponse["data"][number]): LocationOption {
  return {
    id: r.id,
    companyName: r.companyName ?? "Unknown",
    location: r.location ?? null,
    address: r.address ?? null,
    city: r.city ?? null,
    parentCompanyName: null,
    phone: r.phone ?? null,
  };
}

export function useTechLocationSearch(
  searchText: string,
  options?: { limit?: number; enabled?: boolean },
) {
  const minLength = 2;
  const trimmed = (searchText ?? "").trim();
  const isEnabled =
    (options?.enabled ?? true) && trimmed.length >= minLength;
  const limit = options?.limit ?? 20;

  return useQuery<LocationOption[]>({
    queryKey: ["/api/tech/locations/search", trimmed, limit],
    queryFn: async () => {
      const res = await apiRequest<TechSearchResponse>(
        `/api/tech/locations/search?q=${encodeURIComponent(trimmed)}&limit=${limit}`,
      );
      const rows = Array.isArray(res?.data) ? res.data : [];
      return rows.map(normalizeRow);
    },
    enabled: isEnabled,
  });
}

/**
 * Resolve a single location by id through the tech-safe location read.
 * Tech-only sibling of `useLocationById` from `locationEntity.ts`.
 */
export function useTechLocationById(locationId: string | null | undefined) {
  return useQuery<LocationOption | null>({
    queryKey: ["/api/tech/locations/resolve", locationId],
    queryFn: async () => {
      if (!locationId) return null;
      const r = await apiRequest<{
        id: string;
        companyName: string | null;
        parentCompanyName: string | null;
        location: string | null;
        address: string | null;
        city: string | null;
        phone: string | null;
      }>(`/api/tech/locations/${locationId}`);
      if (!r?.id) return null;
      return {
        id: r.id,
        // The detail endpoint already resolves parent name into its
        // response, but the canonical display value is parent | own.
        companyName: r.parentCompanyName ?? r.companyName ?? "Unknown",
        location: r.location ?? null,
        address: r.address ?? null,
        city: r.city ?? null,
        parentCompanyName: r.parentCompanyName ?? null,
        phone: r.phone ?? null,
      };
    },
    enabled: !!locationId,
    staleTime: 60_000,
  });
}
