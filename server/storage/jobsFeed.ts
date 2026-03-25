/**
 * Canonical Jobs Feed — Phase 4 Part A
 *
 * Single source of truth for all job list and job detail queries.
 * Uses the QueryCtx pattern from Phase 3 for tenant isolation.
 *
 * Key fixes over the old divergent queries:
 *   - getJob() now joins customerCompanies and uses the correct COALESCE
 *     for locationDisplayName (was missing, causing name mismatch list vs detail)
 *   - All queries use activeJobFilter() for consistent soft-delete handling
 *   - Filters are composable via JobFeedFilters interface
 *
 * Phase 4 Steps A1–A4.
 */

import {
  eq,
  and,
  or,
  gte,
  lte,
  lt,
  desc,
  asc,
  sql,
  isNull,
  ilike,
  type SQL,
} from "drizzle-orm";
import {
  jobs,
  clients,
  customerCompanies,
} from "@shared/schema";
import type { QueryCtx } from "../lib/queryCtx";
import { activeJobFilter } from "./jobFilters";
import { effectiveEndExpr, locationDisplayNameExpr } from "../lib/queryHelpers";

// ---------------------------------------------------------------------------
// Step A1: JobFeedFilters — every WHERE clause across all 6 divergent queries
// ---------------------------------------------------------------------------

export interface JobFeedFilters {
  status?: string;
  statuses?: string[];
  excludeStatuses?: string[];
  locationId?: string;
  locationIds?: string[];
  clientId?: string;
  technicianId?: string;
  jobType?: string;
  priority?: string;
  search?: string;
  scheduledOnly?: boolean;
  unscheduledOnly?: boolean;
  overdue?: boolean;
  dateRange?: { start: string; end: string };
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

// ---------------------------------------------------------------------------
// Step A4: Canonical response types
// ---------------------------------------------------------------------------

/** Canonical job list item shape. All timestamps are ISO strings.
 * PERF-02: Trimmed to fields actually needed by list pages (Jobs, LocationDetail).
 * Fields removed here are re-added in JobHeaderDetail for the detail view. */
export interface JobFeedItem {
  id: string;
  jobNumber: number;
  summary: string;
  jobType: string;
  status: string;
  openSubStatus: string | null;
  priority: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  isAllDay: boolean;
  durationMinutes: number | null;
  locationId: string;
  locationDisplayName: string | null;
  locationName: string | null;
  locationAddress: string | null;
  locationCity: string | null;
  primaryTechnicianId: string | null;
  assignedTechnicianIds: string[] | null;
  // Hold / action-required fields (needed by Jobs list page)
  onHoldAt: string | null;
}

/** Canonical single-job detail header. Extends feed item with detail-only fields.
 * PERF-02: Fields removed from JobFeedItem are declared here for the detail view. */
export interface JobHeaderDetail extends JobFeedItem {
  // PERF-02: Fields removed from feed, required for detail
  companyId: string;
  description: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string | null;
  holdReason: string | null;
  holdNotes: string | null;
  nextActionDate: string | null;
  invoiceId: string | null;
  closedAt: string | null;
  // Detail-only fields
  accessInstructions: string | null;
  billingNotes: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  travelStartedAt: string | null;
  arrivedOnSiteAt: string | null;
  qboInvoiceId: string | null;
  recurringSeriesId: string | null;
  recurrenceTemplateId: string | null;
  recurrenceInstanceDate: string | null;
  // PM Billing Disposition fields
  pmBillingModel: string | null;
  pmBillingDisposition: string | null;
  pmBillingStatus: string | null;
  pmBillingLabel: string | null;
  deletedAt: string | null;
  previousStatus: string | null;
  closedBy: string | null;
  // Nested location object for detail page
  location: {
    id: string;
    companyName: string | null;
    location: string | null;
    address: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    parentCompanyId: string | null;
  } | null;
  // Parent company (for detail page link)
  parentCompany: {
    id: string;
    name: string;
  } | null;
}

// ---------------------------------------------------------------------------
// Internal: shared select fields and joins
// ---------------------------------------------------------------------------

/** Feed-level select fields (used by list queries). */
/** Feed-level select fields — trimmed to only what list pages need.
 * PERF-02: Removed 11 fields not used by Jobs list, LocationDetail, or ClientDetail
 * feed consumers. Those fields are re-added in detailSelectFields for the detail view. */
const feedSelectFields = {
  id: jobs.id,
  jobNumber: jobs.jobNumber,
  summary: jobs.summary,
  jobType: jobs.jobType,
  status: jobs.status,
  openSubStatus: jobs.openSubStatus,
  priority: jobs.priority,
  scheduledStart: jobs.scheduledStart,
  scheduledEnd: jobs.scheduledEnd,
  isAllDay: jobs.isAllDay,
  durationMinutes: jobs.durationMinutes,
  locationId: jobs.locationId,
  // Phase 4 fix: correct COALESCE for location name — uses canonical helper
  locationDisplayName: locationDisplayNameExpr,
  locationName: clients.location,
  locationAddress: clients.address,
  locationCity: clients.city,
  primaryTechnicianId: jobs.primaryTechnicianId,
  assignedTechnicianIds: jobs.assignedTechnicianIds,
  onHoldAt: jobs.onHoldAt,
};

/** Detail-level select fields (extends feed fields).
 * PERF-02: Re-adds fields removed from feed for the detail view. */
const detailSelectFields = {
  ...feedSelectFields,
  // Fields removed from feed but required for detail view
  companyId: jobs.companyId,
  description: jobs.description,
  isActive: jobs.isActive,
  version: jobs.version,
  createdAt: jobs.createdAt,
  updatedAt: jobs.updatedAt,
  holdReason: jobs.holdReason,
  holdNotes: jobs.holdNotes,
  nextActionDate: jobs.nextActionDate,
  invoiceId: jobs.invoiceId,
  closedAt: jobs.closedAt,
  // Detail-only fields
  accessInstructions: jobs.accessInstructions,
  billingNotes: jobs.billingNotes,
  actualStart: jobs.actualStart,
  actualEnd: jobs.actualEnd,
  travelStartedAt: jobs.travelStartedAt,
  arrivedOnSiteAt: jobs.arrivedOnSiteAt,
  qboInvoiceId: jobs.qboInvoiceId,
  recurringSeriesId: jobs.recurringSeriesId,
  recurrenceTemplateId: jobs.recurrenceTemplateId,
  recurrenceInstanceDate: jobs.recurrenceInstanceDate,
  // PM Billing Disposition
  pmBillingModel: jobs.pmBillingModel,
  pmBillingDisposition: jobs.pmBillingDisposition,
  pmBillingStatus: jobs.pmBillingStatus,
  pmBillingLabel: jobs.pmBillingLabel,
  deletedAt: jobs.deletedAt,
  previousStatus: jobs.previousStatus,
  closedBy: jobs.closedBy,
  // Nested location object
  location: {
    id: clients.id,
    companyName: clients.companyName,
    location: clients.location,
    address: clients.address,
    city: clients.city,
    province: clients.province,
    postalCode: clients.postalCode,
    parentCompanyId: clients.parentCompanyId,
  },
  // Parent company
  parentCompanyId: customerCompanies.id,
  parentCompanyName: customerCompanies.name,
};

// ---------------------------------------------------------------------------
// Mapper: raw DB row → canonical types (timestamps → ISO strings)
// ---------------------------------------------------------------------------

function toISOOrNull(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  return val;
}

/** PERF-02: Maps only the fields present in feedSelectFields. */
function mapFeedRow(row: any): JobFeedItem {
  return {
    id: row.id,
    jobNumber: row.jobNumber,
    summary: row.summary,
    jobType: row.jobType,
    status: row.status,
    openSubStatus: row.openSubStatus ?? null,
    priority: row.priority,
    scheduledStart: toISOOrNull(row.scheduledStart),
    scheduledEnd: toISOOrNull(row.scheduledEnd),
    isAllDay: row.isAllDay ?? false,
    durationMinutes: row.durationMinutes ?? null,
    locationId: row.locationId,
    locationDisplayName: row.locationDisplayName ?? null,
    locationName: row.locationName ?? null,
    locationAddress: row.locationAddress ?? null,
    locationCity: row.locationCity ?? null,
    primaryTechnicianId: row.primaryTechnicianId ?? null,
    assignedTechnicianIds: row.assignedTechnicianIds ?? null,
    onHoldAt: toISOOrNull(row.onHoldAt),
  };
}

/** PERF-02: Maps feed base + the 11 fields re-added in detailSelectFields + detail-only fields. */
function mapDetailRow(row: any): JobHeaderDetail {
  const base = mapFeedRow(row);
  return {
    ...base,
    // PERF-02: Fields removed from feed, present in detail
    companyId: row.companyId,
    description: row.description ?? null,
    isActive: row.isActive,
    version: row.version,
    createdAt: toISOOrNull(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toISOOrNull(row.updatedAt),
    holdReason: row.holdReason ?? null,
    holdNotes: row.holdNotes ?? null,
    nextActionDate: row.nextActionDate ?? null,
    invoiceId: row.invoiceId ?? null,
    closedAt: toISOOrNull(row.closedAt),
    // Detail-only fields
    accessInstructions: row.accessInstructions ?? null,
    billingNotes: row.billingNotes ?? null,
    actualStart: toISOOrNull(row.actualStart),
    actualEnd: toISOOrNull(row.actualEnd),
    travelStartedAt: toISOOrNull(row.travelStartedAt),
    arrivedOnSiteAt: toISOOrNull(row.arrivedOnSiteAt),
    qboInvoiceId: row.qboInvoiceId ?? null,
    recurringSeriesId: row.recurringSeriesId ?? null,
    recurrenceTemplateId: row.recurrenceTemplateId ?? null,
    recurrenceInstanceDate: row.recurrenceInstanceDate ?? null,
    pmBillingModel: row.pmBillingModel ?? null,
    pmBillingDisposition: row.pmBillingDisposition ?? null,
    pmBillingStatus: row.pmBillingStatus ?? null,
    pmBillingLabel: row.pmBillingLabel ?? null,
    deletedAt: toISOOrNull(row.deletedAt),
    previousStatus: row.previousStatus ?? null,
    closedBy: row.closedBy ?? null,
    location: row.location?.id
      ? {
          id: row.location.id,
          companyName: row.location.companyName ?? null,
          location: row.location.location ?? null,
          address: row.location.address ?? null,
          city: row.location.city ?? null,
          province: row.location.province ?? null,
          postalCode: row.location.postalCode ?? null,
          parentCompanyId: row.location.parentCompanyId ?? null,
        }
      : null,
    parentCompany:
      row.parentCompanyId && row.parentCompanyName
        ? { id: row.parentCompanyId, name: row.parentCompanyName }
        : null,
  };
}

// ---------------------------------------------------------------------------
// Step A2: getJobsFeed — canonical list query
// ---------------------------------------------------------------------------

/**
 * Canonical job list query with composable filters.
 * Always scopes by tenant, applies soft-delete guard, and joins
 * customerCompanies for correct COALESCE location name.
 */
export async function getJobsFeed(
  ctx: QueryCtx,
  filters: JobFeedFilters = {}
): Promise<{ items: JobFeedItem[]; total: number }> {
  const limit = filters.limit ?? 200;
  const offset = filters.offset ?? 0;

  // Build WHERE conditions
  const conditions: SQL[] = [
    eq(jobs.companyId, ctx.tenantId),
    activeJobFilter(),
  ];

  // Status filters
  if (filters.status) {
    conditions.push(eq(jobs.status, filters.status));
  }
  if (filters.statuses?.length) {
    conditions.push(
      sql`${jobs.status} IN (${sql.join(
        filters.statuses.map((s) => sql`${s}`),
        sql`, `
      )})`
    );
  }
  if (filters.excludeStatuses?.length) {
    conditions.push(
      sql`${jobs.status} NOT IN (${sql.join(
        filters.excludeStatuses.map((s) => sql`${s}`),
        sql`, `
      )})`
    );
  }

  // Location filters
  if (filters.locationId) {
    conditions.push(eq(jobs.locationId, filters.locationId));
  }
  if (filters.locationIds?.length) {
    conditions.push(
      sql`${jobs.locationId} IN (${sql.join(
        filters.locationIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    );
  }

  // Client (parent company) filter
  if (filters.clientId) {
    conditions.push(eq(clients.parentCompanyId, filters.clientId));
  }

  // Technician filter
  if (filters.technicianId) {
    conditions.push(
      sql`${filters.technicianId} = ANY(${jobs.assignedTechnicianIds})`
    );
  }

  // Type/priority filters
  if (filters.jobType) {
    conditions.push(eq(jobs.jobType, filters.jobType));
  }
  if (filters.priority) {
    conditions.push(eq(jobs.priority, filters.priority));
  }

  // Scheduling filters
  if (filters.scheduledOnly) {
    conditions.push(sql`${jobs.scheduledStart} IS NOT NULL`);
  }
  if (filters.unscheduledOnly) {
    conditions.push(isNull(jobs.scheduledStart));
  }

  // Date range
  if (filters.dateRange) {
    const start = new Date(filters.dateRange.start);
    const end = new Date(filters.dateRange.end);
    if (!isNaN(start.getTime())) {
      conditions.push(gte(jobs.scheduledStart, start));
    }
    if (!isNaN(end.getTime())) {
      conditions.push(lte(jobs.scheduledStart, end));
    }
  }

  // Search (ILIKE on jobNumber, summary, location names, address, city)
  // Hybrid search: aligned with client-side Jobs.tsx local search fields
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        ilike(jobs.summary, term),
        sql`CAST(${jobs.jobNumber} AS TEXT) LIKE ${term}`,
        ilike(clients.companyName, term),
        ilike(clients.location, term),
        ilike(customerCompanies.name, term),
        ilike(clients.address, term),
        ilike(clients.city, term)
      )!
    );
  }

  // Build ORDER BY
  // Priority sort: CASE-based bucket ordering for dispatch-oriented default view.
  // Bucket 1=Overdue open, 2=Completed needing invoice, 3=In Progress,
  // 4=Scheduled open, 5=Backlog, 6=Completed (invoiced/done), 7=Archived.
  // Secondary sort varies per bucket (see inline comments).

  // 2026-03-18: effectiveEndExpr centralized in server/lib/queryHelpers.ts (imported at top)

  const priorityBucket = sql<number>`CASE
    WHEN ${jobs.status} = 'open' AND ${jobs.scheduledStart} IS NOT NULL AND ${effectiveEndExpr} < NOW() THEN 1
    WHEN ${jobs.status} = 'completed' AND ${jobs.invoiceId} IS NULL THEN 2
    WHEN ${jobs.status} = 'open' AND ${jobs.openSubStatus} = 'in_progress' THEN 3
    WHEN ${jobs.status} = 'open' AND ${jobs.scheduledStart} IS NOT NULL THEN 4
    WHEN ${jobs.status} = 'open' THEN 5
    WHEN ${jobs.status} IN ('completed', 'invoiced') THEN 6
    ELSE 7
  END`;

  let orderClauses: SQL[] = [];
  const dir = filters.sortOrder === "asc" ? asc : desc;
  switch (filters.sortBy) {
    case "jobNumber":
      orderClauses = [dir(jobs.jobNumber)];
      break;
    case "scheduledStart":
      orderClauses = [dir(jobs.scheduledStart)];
      break;
    case "status":
      orderClauses = [dir(jobs.status)];
      break;
    case "priority":
      orderClauses = [
        asc(priorityBucket),
        asc(jobs.scheduledStart),
        desc(jobs.createdAt),
      ];
      break;
    default:
      orderClauses = [desc(jobs.createdAt)];
  }

  const rows = await ctx.db
    .select(feedSelectFields)
    .from(jobs)
    .leftJoin(clients, eq(jobs.locationId, clients.id))
    .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
    .where(and(...conditions))
    .orderBy(...orderClauses, desc(jobs.id))
    .limit(limit)
    .offset(offset);

  return {
    items: rows.map(mapFeedRow),
    total: rows.length,
  };
}

// ---------------------------------------------------------------------------
// P3-05: getJobCounts — true aggregate counts (not capped by feed limit)
// ---------------------------------------------------------------------------

/** P3-05: True aggregate job counts shape */
export interface JobCounts {
  lifecycle: {
    open: number;
    completed: number;
    invoiced: number;
    archived: number;
  };
  openSubStatus: {
    in_progress: number;
    on_route: number;
    on_hold: number;
  };
  total: number;
}

/**
 * P3-05: Single aggregate query with FILTER clauses.
 * Uses canonical activeJobFilter() — same visibility as getJobsFeed().
 */
export async function getJobCounts(ctx: QueryCtx): Promise<JobCounts> {
  const rows = await ctx.db
    .select({
      total: sql<number>`COUNT(*)::int`,
      open: sql<number>`COUNT(*) FILTER (WHERE ${jobs.status} = 'open')::int`,
      completed: sql<number>`COUNT(*) FILTER (WHERE ${jobs.status} = 'completed')::int`,
      invoiced: sql<number>`COUNT(*) FILTER (WHERE ${jobs.status} = 'invoiced')::int`,
      archived: sql<number>`COUNT(*) FILTER (WHERE ${jobs.status} = 'archived')::int`,
      subInProgress: sql<number>`COUNT(*) FILTER (WHERE ${jobs.status} = 'open' AND ${jobs.openSubStatus} = 'in_progress')::int`,
      subOnRoute: sql<number>`COUNT(*) FILTER (WHERE ${jobs.status} = 'open' AND ${jobs.openSubStatus} = 'on_route')::int`,
      subOnHold: sql<number>`COUNT(*) FILTER (WHERE ${jobs.status} = 'open' AND ${jobs.openSubStatus} = 'on_hold')::int`,
    })
    .from(jobs)
    .where(and(eq(jobs.companyId, ctx.tenantId), activeJobFilter()));

  const r = rows[0];
  return {
    lifecycle: { open: r.open, completed: r.completed, invoiced: r.invoiced, archived: r.archived },
    openSubStatus: { in_progress: r.subInProgress, on_route: r.subOnRoute, on_hold: r.subOnHold },
    total: r.total,
  };
}

// ---------------------------------------------------------------------------
// Step A3: getJobHeader — canonical single-job detail query
// ---------------------------------------------------------------------------

/**
 * Canonical single-job detail query.
 * Joins customerCompanies for correct COALESCE (the critical fix missing in old getJob).
 * Returns null if job doesn't exist, is deleted, or doesn't belong to the tenant.
 */
export async function getJobHeader(
  ctx: QueryCtx,
  jobId: string
): Promise<JobHeaderDetail | null> {
  const rows = await ctx.db
    .select(detailSelectFields)
    .from(jobs)
    .leftJoin(clients, eq(jobs.locationId, clients.id))
    .leftJoin(customerCompanies, eq(clients.parentCompanyId, customerCompanies.id))
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.companyId, ctx.tenantId),
        activeJobFilter()
      )
    )
    .limit(1);

  if (rows.length === 0) return null;
  return mapDetailRow(rows[0]);
}
