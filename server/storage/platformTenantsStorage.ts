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
import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { companies, companySettings, impersonationSessions } from "@shared/schema";

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
    // Search matches BOTH the canonical companies.name and the user-set
    // company_settings.companyName — either can be the visible label.
    const like = `%${params.q.trim()}%`;
    preds.push(or(
      ilike(companies.name, like),
      ilike(companySettings.companyName, like),
    )!);
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

  // Phase 7 identity fix: COALESCE the user-configured company_settings.companyName
  // over the signup-time companies.name. Legacy rows sometimes hold an
  // email-derived placeholder ("service's Company") in companies.name while
  // the real name lives in company_settings.companyName.
  const rowsQuery = db
    .select({
      id: companies.id,
      name: sql<string>`COALESCE(${companySettings.companyName}, ${companies.name})`,
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
    .from(companies)
    .leftJoin(companySettings, eq(companySettings.companyId, companies.id));

  const totalQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(companies)
    .leftJoin(companySettings, eq(companySettings.companyId, companies.id));

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
