/**
 * Platform Tenants Service — Ops Portal core.
 *
 * Thin orchestration layer for /api/platform/tenants/*.
 *
 * 2026-04-21 Phase 3 canonical policy architecture:
 *   The feature-read + feature-write orchestration that used to live here
 *   has been deleted along with the legacy tenant_features table. Platform
 *   feature management lives entirely on the canonical entitlement surfaces.
 *
 * 2026-04-22 Admin Phase A4:
 *   Search rows are enriched with `tenantHealthService` data so the
 *   operator list can prioritize by worst-health. `sortBy=health` causes
 *   the service to overfetch (up to SORT_OVERFETCH_CAP rows), score all
 *   of them, sort worst-first, and re-paginate. No new tables; scoring
 *   lives in a single canonical place.
 */

import {
  platformTenantsStorage,
  type PlatformTenantRow,
} from "../storage/platformTenantsStorage";
import { adminRepository, type TenantAccountDetail } from "../storage/admin";
import {
  tenantHealthService,
  type TenantHealth,
} from "./tenantHealthService";

export interface SearchTenantsInput {
  q?: string;
  status?: string;
  plan?: string;
  limit?: number;
  offset?: number;
  /** When set to `"health"`, overfetch + sort worst-first. */
  sortBy?: "createdAt" | "health";
}

export interface EnrichedTenantRow extends PlatformTenantRow {
  health: TenantHealth | null;
}

export interface SearchTenantsServiceResult {
  rows: EnrichedTenantRow[];
  total: number;
  limit: number;
  offset: number;
  sortBy: "createdAt" | "health";
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
/**
 * Safety cap on health-sort overfetch. The operator surface can page
 * through worst-first by repeated requests; this bounds the single-call
 * cost when a tenant count is small-to-moderate. Raise if platform ever
 * grows past this and users feel the truncation.
 */
const SORT_OVERFETCH_CAP = 500;

function normalizeSearchInput(input: SearchTenantsInput) {
  const limit = Math.min(
    Math.max(1, Number.isFinite(input.limit) ? Number(input.limit) : DEFAULT_LIMIT),
    MAX_LIMIT,
  );
  const offset = Math.max(0, Number.isFinite(input.offset) ? Number(input.offset) : 0);
  const sortBy: "createdAt" | "health" =
    input.sortBy === "health" ? "health" : "createdAt";
  return {
    q: input.q?.trim() || undefined,
    status: input.status?.trim() || undefined,
    plan: input.plan?.trim() || undefined,
    limit,
    offset,
    sortBy,
  };
}

async function searchTenants(
  input: SearchTenantsInput,
): Promise<SearchTenantsServiceResult> {
  const params = normalizeSearchInput(input);

  // Health-sort path: overfetch up to SORT_OVERFETCH_CAP, enrich every
  // row, sort, then paginate in memory.
  if (params.sortBy === "health") {
    const overfetch = await platformTenantsStorage.searchTenants({
      q: params.q,
      status: params.status,
      plan: params.plan,
      limit: SORT_OVERFETCH_CAP,
      offset: 0,
    });

    const ids = overfetch.rows.map((r) => r.id);
    const healthMap = await tenantHealthService.getHealthForCompanies(ids);

    const enriched: EnrichedTenantRow[] = overfetch.rows.map((r) => ({
      ...r,
      health: healthMap.get(r.id) ?? null,
    }));

    enriched.sort((a, b) => {
      const sa = a.health?.score ?? 100;
      const sb = b.health?.score ?? 100;
      if (sa !== sb) return sa - sb; // ascending = worst first
      // Tie-break: newest first so the operator still sees fresh trials
      // above older healthy-by-default rows.
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    const page = enriched.slice(params.offset, params.offset + params.limit);

    return {
      rows: page,
      total: overfetch.total,
      limit: params.limit,
      offset: params.offset,
      sortBy: params.sortBy,
    };
  }

  // Default path: storage handles paging; enrich just the returned page.
  const result = await platformTenantsStorage.searchTenants({
    q: params.q,
    status: params.status,
    plan: params.plan,
    limit: params.limit,
    offset: params.offset,
  });

  const healthMap = await tenantHealthService.getHealthForCompanies(
    result.rows.map((r) => r.id),
  );

  const enriched: EnrichedTenantRow[] = result.rows.map((r) => ({
    ...r,
    health: healthMap.get(r.id) ?? null,
  }));

  return {
    rows: enriched,
    total: result.total,
    limit: params.limit,
    offset: params.offset,
    sortBy: params.sortBy,
  };
}

export interface PlatformTenantDetail {
  tenant: TenantAccountDetail;
  /** Populated once support sessions land (Phase 4). */
  recentSupportAt: Date | null;
  /** 2026-04-22 Admin Phase A4: canonical health snapshot. */
  health: TenantHealth | null;
}

async function getTenantDetail(tenantId: string): Promise<PlatformTenantDetail | null> {
  const tenant = await adminRepository.getTenantDetail(tenantId);
  if (!tenant) return null;

  const health = await tenantHealthService.getHealthForCompany(tenantId);

  return {
    tenant,
    recentSupportAt: null,
    health,
  };
}

export const platformTenantsService = {
  searchTenants,
  getTenantDetail,
};
