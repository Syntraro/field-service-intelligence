/**
 * Canonical location entity — owns search, mapping, create-new, and selection behavior
 * for location/client selection across all standard office flows.
 *
 * Consumers should use this module instead of raw search-locations queries.
 * Replaces per-page location search plumbing.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// ── Canonical location option shape ──

export interface LocationOption {
  id: string;
  companyName: string;
  location?: string | null;
  address?: string | null;
  city?: string | null;
  parentCompanyName?: string | null;
  phone?: string | null;
}

// ── Search ──

export function useLocationSearch(searchText: string, options?: { limit?: number; enabled?: boolean }) {
  const minLength = 2;
  const isEnabled = (options?.enabled ?? true) && (searchText?.length ?? 0) >= minLength;
  const limit = options?.limit ?? 20;

  return useQuery<LocationOption[]>({
    queryKey: ["/api/clients/search-locations", searchText],
    queryFn: async () => {
      const res = await apiRequest<any[]>(
        `/api/clients/search-locations?q=${encodeURIComponent(searchText)}&limit=${limit}`
      );
      const rows = Array.isArray(res) ? res : [];
      return rows.map(normalizeLocationRow);
    },
    enabled: isEnabled,
  });
}

// ── Normalization (snake_case API → camelCase) ──

export function normalizeLocationRow(r: any): LocationOption {
  return {
    id: r.id,
    companyName: r.company_name ?? r.companyName ?? "Unknown",
    location: r.location ?? null,
    address: r.address ?? null,
    city: r.city ?? null,
    parentCompanyName: r.parent_company_name ?? r.parentCompanyName ?? null,
    phone: r.phone ?? null,
  };
}

// ── Option helpers for selector shell ──

export function getLocationKey(loc: LocationOption): string {
  return loc.id;
}

export function getLocationLabel(loc: LocationOption): string {
  return loc.companyName;
}

export function getLocationDescription(loc: LocationOption): string | undefined {
  return [loc.location, loc.address, loc.city].filter(Boolean).join(", ") || undefined;
}

/** Resolve a single location by ID for pre-selection display */
export function useLocationById(locationId: string | null | undefined) {
  return useQuery<LocationOption | null>({
    queryKey: ["/api/clients/resolve", locationId],
    queryFn: async () => {
      if (!locationId) return null;
      const r = await apiRequest<any>(`/api/clients/${locationId}`);
      if (!r?.id) return null;
      return normalizeLocationRow(r);
    },
    enabled: !!locationId,
    staleTime: 60_000,
  });
}
