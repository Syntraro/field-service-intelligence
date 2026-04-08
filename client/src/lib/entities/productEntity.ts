/**
 * Canonical product/service entity — owns search, mapping, and option formatting
 * for Products & Services selection across quote templates, line items, and parts flows.
 *
 * Consumers should use this module instead of raw /api/items queries.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// ── Canonical product option shape ──

export interface ProductOption {
  id: string;
  name: string;
  type: string; // "product" | "service"
  unitPrice: string | null;
  cost: string | null;
}

// ── Search ──

export function useProductSearch(searchText: string, options?: { limit?: number; enabled?: boolean }) {
  const minLength = 2;
  const isEnabled = (options?.enabled ?? true) && (searchText?.length ?? 0) >= minLength;
  const limit = options?.limit ?? 20;

  return useQuery<ProductOption[]>({
    queryKey: ["/api/items", "search", searchText],
    queryFn: async () => {
      const res = await apiRequest<any>(`/api/items?q=${encodeURIComponent(searchText)}&limit=${limit}`);
      const rows = Array.isArray(res) ? res : (res?.data ?? res?.items ?? []);
      return rows.map(normalizeProductRow);
    },
    enabled: isEnabled,
  });
}

// ── Normalization ──

export function normalizeProductRow(r: any): ProductOption {
  return {
    id: r.id,
    name: r.name ?? "Unknown",
    type: r.type ?? "product",
    unitPrice: r.unitPrice ?? r.unit_price ?? null,
    cost: r.cost ?? null,
  };
}

// ── Option helpers for selector shell ──

export function getProductKey(p: ProductOption): string {
  return p.id;
}

export function getProductLabel(p: ProductOption): string {
  return p.name;
}

export function getProductDescription(p: ProductOption): string | undefined {
  const parts: string[] = [];
  if (p.type) parts.push(p.type === "service" ? "Service" : "Product");
  if (p.unitPrice) parts.push(`$${parseFloat(p.unitPrice).toFixed(2)}`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
