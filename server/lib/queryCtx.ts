/**
 * QueryCtx — Canonical context bundle for repository queries.
 *
 * Bundles the four pieces of context every tenant-scoped query needs:
 *   - db:        Drizzle ORM instance
 *   - tenantId:  Company ID (multi-tenant isolation)
 *   - userId:    Authenticated user ID
 *   - role:      User role (for RBAC filtering, e.g. technicians see own visits only)
 *
 * Usage in route handlers:
 *   import { getQueryCtx } from "../lib/queryCtx";
 *
 *   router.get("/api/visits", requireAuth, async (req: AuthedRequest, res) => {
 *     const ctx = getQueryCtx(req);
 *     const visits = await getVisitFeed(ctx, filters);
 *     res.json(visits);
 *   });
 *
 * Phase 3 Step B: Created as part of Canonical Visit Feed Migration.
 */

import type { AuthedRequest } from "../auth/tenantIsolation";
import { db as defaultDb } from "../db";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";

/** Canonical context bundle for tenant-scoped queries. */
export interface QueryCtx {
  /** Drizzle ORM database instance */
  db: NeonDatabase<any>;
  /** Company ID for multi-tenant isolation */
  tenantId: string;
  /** Authenticated user ID */
  userId: string;
  /** User role (e.g. "owner", "admin", "technician") */
  role: string;
}

/**
 * Extract QueryCtx from an authenticated Express request.
 *
 * Must be called after requireAuth + ensureTenantContext middleware
 * (i.e. req.companyId and req.user are guaranteed to exist).
 */
export function getQueryCtx(req: AuthedRequest): QueryCtx {
  return {
    db: defaultDb as unknown as NeonDatabase<any>,
    tenantId: req.companyId,
    userId: req.user.id,
    role: req.user.role ?? "technician",
  };
}
