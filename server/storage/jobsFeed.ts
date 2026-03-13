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

/** Canonical job list item shape. All timestamps are ISO strings. */
export interface JobFeedItem {
  id: string;
  companyId: string;
  jobNumber: number;
  summary: string;
  description: string | null;
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
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string | null;
  // Hold / action-required fields (needed by Jobs list page)
  onHoldAt: string | null;
  holdReason: string | null;
  holdNotes: string | null;
  nextActionDate: string | null;
  actionRequiredAt: string | null;
  actionRequiredNotes: string | null;
  actionRequiredEscalatedAt: string | null;
  invoiceId: string | null;
  closedAt: string | null;
}

/** Canonical single-job detail header. Extends feed item with detail-only fields. */
export interface JobHeaderDetail extends JobFeedItem {
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
  actionRequiredReason: string | null;
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
const feedSelectFields = {
  id: jobs.id,
  companyId: jobs.companyId,
  jobNumber: jobs.jobNumber,
  summary: jobs.summary,
  description: jobs.description,
  jobType: jobs.jobType,
  status: jobs.status,
  openSubStatus: jobs.openSubStatus,
  priority: jobs.priority,
  scheduledStart: jobs.scheduledStart,
  scheduledEnd: jobs.scheduledEnd,
  isAllDay: jobs.isAllDay,
  durationMinutes: jobs.durationMinutes,
  locationId: jobs.locationId,
  // Phase 4 fix: correct COALESCE for location name
  locationDisplayName: sql<string>`COALESCE(${customerCompanies.name}, ${clients.companyName})`,
  locationName: clients.location,
  locationAddress: clients.address,
  locationCity: clients.city,
  primaryTechnicianId: jobs.primaryTechnicianId,
  assignedTechnicianIds: jobs.assignedTechnicianIds,
  isActive: jobs.isActive,
  version: jobs.version,
  createdAt: jobs.createdAt,
  updatedAt: jobs.updatedAt,
  onHoldAt: jobs.onHoldAt,
  holdReason: jobs.holdReason,
  holdNotes: jobs.holdNotes,
  nextActionDate: jobs.nextActionDate,
  actionRequiredAt: jobs.actionRequiredAt,
  actionRequiredNotes: jobs.actionRequiredNotes,
  actionRequiredEscalatedAt: jobs.actionRequiredEscalatedAt,
  invoiceId: jobs.invoiceId,
  closedAt: jobs.closedAt,
};

/** Detail-level select fields (extends feed fields). */
const detailSelectFields = {
  ...feedSelectFields,
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
  actionRequiredReason: jobs.actionRequiredReason,
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

function mapFeedRow(row: any): JobFeedItem {
  return {
    id: row.id,
    companyId: row.companyId,
    jobNumber: row.jobNumber,
    summary: row.summary,
    description: row.description ?? null,
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
    isActive: row.isActive,
    version: row.version,
    createdAt: toISOOrNull(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toISOOrNull(row.updatedAt),
    onHoldAt: toISOOrNull(row.onHoldAt),
    holdReason: row.holdReason ?? null,
    holdNotes: row.holdNotes ?? null,
    nextActionDate: row.nextActionDate ?? null,
    actionRequiredAt: toISOOrNull(row.actionRequiredAt),
    actionRequiredNotes: row.actionRequiredNotes ?? null,
    actionRequiredEscalatedAt: toISOOrNull(row.actionRequiredEscalatedAt),
    invoiceId: row.invoiceId ?? null,
    closedAt: toISOOrNull(row.closedAt),
  };
}

function mapDetailRow(row: any): JobHeaderDetail {
  const base = mapFeedRow(row);
  return {
    ...base,
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
    actionRequiredReason: row.actionRequiredReason ?? null,
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

  // Search (ILIKE on jobNumber, summary, location names)
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        ilike(jobs.summary, term),
        sql`CAST(${jobs.jobNumber} AS TEXT) LIKE ${term}`,
        ilike(clients.companyName, term),
        ilike(clients.location, term),
        ilike(customerCompanies.name, term)
      )!
    );
  }

  // Build ORDER BY
  // Priority sort: CASE-based bucket ordering for dispatch-oriented default view.
  // Bucket 1=Overdue open, 2=Completed needing invoice, 3=In Progress,
  // 4=Scheduled open, 5=Backlog, 6=Completed (invoiced/done), 7=Archived.
  // Secondary sort varies per bucket (see inline comments).

  // Canonical effectiveEnd: matches isJobOverdue() in shared/schema.ts and
  // overdue SQL in maintenance.ts / admin.ts.
  // Priority: scheduledEnd → scheduledStart+duration → scheduledStart fallback.
  const effectiveEndExpr = sql`CASE
    WHEN ${jobs.scheduledEnd} IS NOT NULL THEN ${jobs.scheduledEnd}
    WHEN ${jobs.durationMinutes} IS NOT NULL THEN ${jobs.scheduledStart} + (${jobs.durationMinutes} || ' minutes')::interval
    ELSE ${jobs.scheduledStart}
  END`;

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
