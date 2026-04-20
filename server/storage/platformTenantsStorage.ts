/**
 * Platform Tenants Storage — Phase 2 (Ops Portal Core).
 *
 * Read-only search/list queries against the canonical `companies` table for
 * the internal Ops Portal. Feature-flag reads/writes and tenant detail are
 * delegated by the service layer to their existing canonical owners
 * (`tenantFeaturesRepository`, `adminRepository`). This module exists ONLY
 * because platform search has a different shape than the owner-facing
 * tenant health list (`adminRepository.getTenantHealthList`).
 *
 * Layering: Service is the only caller. No route or HTTP access here.
 */

import { db } from "../db";
import { and, desc, eq, ilike, ne, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { companies, impersonationSessions } from "@shared/schema";

export interface PlatformTenantRow {
  id: string;
  name: string;
  plan: string | null;
  status: string;
  createdAt: Date;
  /** Placeholder until support sessions land (Phase 4). Always null today. */
  recentSupportAt: Date | null;
}

export interface SearchTenantsParams {
  q?: string;
  status?: string;
  plan?: string;
  limit: number;
  offset: number;
}

export interface SearchTenantsResult {
  rows: PlatformTenantRow[];
  total: number;
}

function buildFilter(params: SearchTenantsParams): SQL | undefined {
  const preds: SQL[] = [];
  if (params.q && params.q.trim().length > 0) {
    // 2026-04-19 Profile consolidation: `companies.name` is the single
    // canonical display name. The old fallback to company_settings.companyName
    // is no longer required — the Phase 1 backfill wrote meaningful settings
    // values onto `companies`.
    const like = `%${params.q.trim()}%`;
    preds.push(ilike(companies.name, like));
  }
  if (params.status) {
    preds.push(eq(companies.subscriptionStatus, params.status));
  } else {
    // Default view excludes internal-only companies (e.g. the dedicated
    // "Syntraro Platform (Internal)" row that backs the ops admin account).
    // Callers can opt back in by passing ?status=internal explicitly.
    preds.push(ne(companies.subscriptionStatus, "internal"));
  }
  if (params.plan) {
    preds.push(eq(companies.subscriptionPlan, params.plan));
  }
  if (preds.length === 0) return undefined;
  if (preds.length === 1) return preds[0];
  return and(...preds);
}

export async function searchTenants(params: SearchTenantsParams): Promise<SearchTenantsResult> {
  const where = buildFilter(params);

  // 2026-04-19 Profile consolidation: `companies.name` is canonical — the
  // Phase 1 backfill folded meaningful `company_settings.company_name`
  // values onto the companies row. No COALESCE / leftJoin needed.
  const rowsQuery = db
    .select({
      id: companies.id,
      name: companies.name,
      plan: companies.subscriptionPlan,
      status: companies.subscriptionStatus,
      createdAt: companies.createdAt,
      // Populated via correlated subquery against impersonation_sessions.
      // Returns the most recent support-session start for this tenant, or
      // null if none exist. Low-cost on the current index set.
      recentSupportAt: sql<Date | null>`(
        SELECT MAX(${impersonationSessions.createdAt})
        FROM ${impersonationSessions}
        WHERE ${impersonationSessions.companyId} = ${companies.id}
      )`,
    })
    .from(companies);

  const totalQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(companies);

  const [rowsResult, totalResult] = await Promise.all([
    (where ? rowsQuery.where(where) : rowsQuery)
      .orderBy(desc(companies.createdAt))
      .limit(params.limit)
      .offset(params.offset),
    where ? totalQuery.where(where) : totalQuery,
  ]);

  const rows: PlatformTenantRow[] = rowsResult.map((r) => ({
    id: r.id,
    name: r.name,
    plan: r.plan,
    status: r.status,
    createdAt: r.createdAt,
    recentSupportAt: r.recentSupportAt ?? null,
  }));

  return {
    rows,
    total: totalResult[0]?.count ?? 0,
  };
}

export const platformTenantsStorage = {
  searchTenants,
};
