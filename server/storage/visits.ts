/**
 * Canonical Visit Queries — single source of truth for visit reads.
 *
 * All visit read paths (tech field app, calendar, admin) should import from here.
 * This prevents query divergence where one consumer adds a join/filter and others don't.
 *
 * User-scoped functions enforce assignment validation (tech can only see their visits).
 * Tenant-scoped functions return all visits for a company (calendar, admin views).
 *
 * Tenant isolation is enforced at every entry point via companyId.
 *
 * Phase 3 Step C: Added VisitFeedFilters, getVisitFeed (QueryCtx-based),
 * and toVisitFeedItem mapper for the canonical visit API.
 */
import { db } from "../db";
import { and, eq, gte, lte, asc, isNull, sql, type SQL } from "drizzle-orm";
import { jobVisits, jobs, clientLocations, customerCompanies } from "@shared/schema";
import type { QueryCtx } from "../lib/queryCtx";
import { activeJobFilter } from "./jobFilters";
import { activeVisitGuard } from "../lib/visitPredicates";
import { locationDisplayNameExpr } from "../lib/queryHelpers";
import type {
  EnrichedVisit,
  VisitJobInfo,
  VisitLocationInfo,
} from "./jobVisits";

// Re-export shared types so consumers only need one import
export type { EnrichedVisit, VisitJobInfo, VisitLocationInfo };

// ============================================================================
// INTERNAL: Shared enrichment query builder
// ============================================================================

/** Standard select columns for the visit + job + location join. */
const ENRICHED_VISIT_SELECT = {
  visit: jobVisits,
  jobId: jobs.id,
  jobNumber: jobs.jobNumber,
  jobSummary: jobs.summary,
  jobType: jobs.jobType,
  jobDescription: jobs.description,
  jobPriority: jobs.priority,
  locationId: clientLocations.id,
  // Phase 5.3 G3: COALESCE parent company name for consistent display across surfaces
  locationCompanyName: locationDisplayNameExpr,
  locationLocation: clientLocations.location,
  locationAddress: clientLocations.address,
  locationCity: clientLocations.city,
  locationProvince: clientLocations.province,
  locationPostalCode: clientLocations.postalCode,
  locationPhone: clientLocations.phone,
} as const;

/** Map a raw row from the enriched select into an EnrichedVisit. */
function toEnrichedVisit(r: {
  visit: typeof jobVisits.$inferSelect;
  jobId: string;
  jobNumber: number;
  jobSummary: string;
  jobType: string;
  jobDescription: string | null;
  jobPriority: string | null;
  locationId: string | null;
  locationCompanyName: string | null;
  locationLocation: string | null;
  locationAddress: string | null;
  locationCity: string | null;
  locationProvince: string | null;
  locationPostalCode: string | null;
  locationPhone: string | null;
}): EnrichedVisit {
  return {
    ...r.visit,
    job: {
      id: r.jobId,
      jobNumber: r.jobNumber,
      summary: r.jobSummary,
      jobType: r.jobType,
      description: r.jobDescription,
      priority: r.jobPriority,
    },
    location: r.locationId
      ? {
          id: r.locationId,
          companyName: r.locationCompanyName,
          location: r.locationLocation,
          address: r.locationAddress,
          city: r.locationCity,
          province: r.locationProvince,
          postalCode: r.locationPostalCode,
          phone: r.locationPhone,
        }
      : null,
  };
}

/** SQL fragment: visit is assigned to userId (single or multi-tech). */
function assignedToUser(userId: string) {
  return sql`(${jobVisits.assignedTechnicianId} = ${userId} OR ${userId} = ANY(${jobVisits.assignedTechnicianIds}))`;
}

function assertCompanyId(companyId: string): void {
  if (!companyId || typeof companyId !== "string") {
    throw new Error("Tenant context missing (companyId)");
  }
}

// ============================================================================
// USER-SCOPED QUERIES (tech field app)
// ============================================================================

/**
 * Get visits assigned to a user within a date range, enriched with job + location.
 * Used by: /api/tech/visits/today, tech schedule page.
 */
export async function getVisitsForUserInRange(
  tenantId: string,
  userId: string,
  start: Date,
  end: Date
): Promise<EnrichedVisit[]> {
  assertCompanyId(tenantId);

  const rows = await db
    .select(ENRICHED_VISIT_SELECT)
    .from(jobVisits)
    .innerJoin(jobs, eq(jobVisits.jobId, jobs.id))
    .leftJoin(clientLocations, eq(jobs.locationId, clientLocations.id))
    .leftJoin(customerCompanies, eq(clientLocations.parentCompanyId, customerCompanies.id))
    .where(
      and(
        eq(jobVisits.companyId, tenantId),
        activeVisitGuard(),
        // Phase 5.3 G4: exclude visits for soft-deleted/inactive jobs
        activeJobFilter(),
        gte(jobVisits.scheduledStart, start),
        lte(jobVisits.scheduledStart, end),
        assignedToUser(userId)
      )
    )
    .orderBy(asc(jobVisits.scheduledStart));

  return rows.map(toEnrichedVisit);
}

/**
 * Get unscheduled visits assigned to a user (scheduledStart IS NULL).
 * Used by: tech backlog view.
 */
export async function getUnscheduledVisitsForUser(
  tenantId: string,
  userId: string
): Promise<EnrichedVisit[]> {
  assertCompanyId(tenantId);

  const rows = await db
    .select(ENRICHED_VISIT_SELECT)
    .from(jobVisits)
    .innerJoin(jobs, eq(jobVisits.jobId, jobs.id))
    .leftJoin(clientLocations, eq(jobs.locationId, clientLocations.id))
    .leftJoin(customerCompanies, eq(clientLocations.parentCompanyId, customerCompanies.id))
    .where(
      and(
        eq(jobVisits.companyId, tenantId),
        activeVisitGuard(),
        // Phase 5.3 G4: exclude visits for soft-deleted/inactive jobs
        activeJobFilter(),
        isNull(jobVisits.scheduledStart),
        assignedToUser(userId)
      )
    )
    .orderBy(asc(jobs.jobNumber));

  return rows.map(toEnrichedVisit);
}

/**
 * Get a single visit by ID with strict assignment validation.
 * Returns null if not found or not assigned to the user.
 * Includes job, location, and job notes.
 */
export async function getVisitByIdForUser(
  tenantId: string,
  userId: string,
  visitId: string
): Promise<EnrichedVisit | null> {
  assertCompanyId(tenantId);

  const rows = await db
    .select(ENRICHED_VISIT_SELECT)
    .from(jobVisits)
    .innerJoin(jobs, eq(jobVisits.jobId, jobs.id))
    .leftJoin(clientLocations, eq(jobs.locationId, clientLocations.id))
    .leftJoin(customerCompanies, eq(clientLocations.parentCompanyId, customerCompanies.id))
    .where(
      and(
        eq(jobVisits.id, visitId),
        eq(jobVisits.companyId, tenantId),
        activeVisitGuard(),
        // Phase 5.3 G4: exclude visits for soft-deleted/inactive jobs
        activeJobFilter(),
        assignedToUser(userId)
      )
    );

  if (rows.length === 0) return null;
  return toEnrichedVisit(rows[0]);
}

// ============================================================================
// TENANT-SCOPED QUERIES (calendar, admin views)
// ============================================================================

export interface TenantVisitRangeOptions {
  /** Optional: filter to visits assigned to a specific user. */
  userId?: string;
  /** Exclude visit statuses (default: none). Calendar passes ['cancelled','completed']. */
  excludeStatuses?: string[];
}

/**
 * Get all active visits for a tenant within a date range.
 * Superset of getVisitsForUserInRange — no assignment filter by default.
 * Calendar + admin views use this; pass userId to narrow to one technician.
 */
export async function getVisitsForTenantInRange(
  tenantId: string,
  start: Date,
  end: Date,
  options: TenantVisitRangeOptions = {}
): Promise<EnrichedVisit[]> {
  assertCompanyId(tenantId);

  const conditions = [
    eq(jobVisits.companyId, tenantId),
    activeVisitGuard(),
    // Phase 5.3 G4: exclude visits for soft-deleted/inactive jobs
    activeJobFilter(),
    gte(jobVisits.scheduledStart, start),
    lte(jobVisits.scheduledStart, end),
  ];

  if (options.userId) {
    conditions.push(assignedToUser(options.userId));
  }

  if (options.excludeStatuses && options.excludeStatuses.length > 0) {
    conditions.push(
      sql`${jobVisits.status} NOT IN (${sql.join(
        options.excludeStatuses.map((s) => sql`${s}`),
        sql`, `
      )})`
    );
  }

  const rows = await db
    .select(ENRICHED_VISIT_SELECT)
    .from(jobVisits)
    .innerJoin(jobs, eq(jobVisits.jobId, jobs.id))
    .leftJoin(clientLocations, eq(jobs.locationId, clientLocations.id))
    .leftJoin(customerCompanies, eq(clientLocations.parentCompanyId, customerCompanies.id))
    .where(and(...conditions))
    .orderBy(asc(jobVisits.scheduledStart));

  return rows.map(toEnrichedVisit);
}

// ============================================================================
// VISIT FEED — QueryCtx-based canonical query (Phase 3 Step C)
// ============================================================================

/**
 * Typed filter object covering all visit query patterns.
 * Used by the canonical getVisitFeed function and the GET /api/visits endpoint.
 */
export interface VisitFeedFilters {
  /** Date range start (inclusive). Required for scheduled visit queries. */
  from?: Date;
  /** Date range end (inclusive). Required for scheduled visit queries. */
  to?: Date;
  /** Filter to visits assigned to a specific technician. */
  technicianId?: string;
  /** Filter by visit status (e.g. "scheduled", "completed"). */
  status?: string;
  /** Exclude these statuses (e.g. ["cancelled"]). */
  excludeStatuses?: string[];
  /** Only return unscheduled visits (scheduledStart IS NULL). */
  unscheduled?: boolean;
  /** Filter to visits for a specific job. */
  jobId?: string;
  /** Filter to visits for a specific location. */
  locationId?: string;
}

/**
 * API-facing visit item with timestamps as ISO strings (not Date objects).
 * This is what GET /api/visits returns — JSON-safe.
 */
export interface VisitFeedItem {
  id: string;
  visitNumber: number;
  jobId: string;
  companyId: string;
  status: string;
  isActive: boolean;
  isAllDay: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  assignedTechnicianId: string | null;
  assignedTechnicianIds: string[];
  visitNotes: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  estimatedDurationMinutes: number | null;
  createdAt: string;
  updatedAt: string;
  job: VisitJobInfo;
  location: VisitLocationInfo | null;
}

/**
 * Map an EnrichedVisit (Drizzle Dates) to a VisitFeedItem (ISO strings).
 * This is the single normalization point — every API consumer gets the same shape.
 */
function toVisitFeedItem(v: EnrichedVisit): VisitFeedItem {
  return {
    id: v.id,
    visitNumber: v.visitNumber,
    jobId: v.jobId,
    companyId: v.companyId,
    status: v.status,
    isActive: v.isActive,
    isAllDay: v.isAllDay ?? false,
    scheduledStart: v.scheduledStart ? new Date(v.scheduledStart).toISOString() : null,
    scheduledEnd: v.scheduledEnd ? new Date(v.scheduledEnd).toISOString() : null,
    assignedTechnicianId: v.assignedTechnicianId ?? null,
    assignedTechnicianIds: v.assignedTechnicianIds ?? [],
    visitNotes: v.visitNotes ?? null,
    checkedInAt: v.checkedInAt ? new Date(v.checkedInAt).toISOString() : null,
    checkedOutAt: v.checkedOutAt ? new Date(v.checkedOutAt).toISOString() : null,
    estimatedDurationMinutes: v.estimatedDurationMinutes ?? null,
    createdAt: new Date(v.createdAt).toISOString(),
    updatedAt: new Date(v.updatedAt).toISOString(),
    job: v.job,
    location: v.location,
  };
}

/** RBAC: Technician roles see only their own visits. */
const TECH_ROLES = ["technician"] as const;

/**
 * Canonical visit feed query using QueryCtx.
 *
 * Applies RBAC:
 * - Technicians see only visits assigned to them (overrides technicianId filter)
 * - All other roles see all visits for the tenant (can optionally filter by technicianId)
 *
 * Returns API-safe VisitFeedItem[] with timestamps as ISO strings.
 */
export async function getVisitFeed(
  ctx: QueryCtx,
  filters: VisitFeedFilters = {}
): Promise<VisitFeedItem[]> {
  // Build conditions array
  const conditions: SQL[] = [
    eq(jobVisits.companyId, ctx.tenantId),
    activeVisitGuard(),
    // Phase 5.3 G4: exclude visits for soft-deleted/inactive jobs
    activeJobFilter(),
  ];

  // RBAC: Force technician assignment filter for tech roles
  const effectiveTechId = (TECH_ROLES as readonly string[]).includes(ctx.role)
    ? ctx.userId
    : filters.technicianId;

  if (effectiveTechId) {
    conditions.push(assignedToUser(effectiveTechId));
  }

  // Date range
  if (filters.unscheduled) {
    conditions.push(isNull(jobVisits.scheduledStart));
  } else {
    if (filters.from) {
      conditions.push(gte(jobVisits.scheduledStart, filters.from));
    }
    if (filters.to) {
      conditions.push(lte(jobVisits.scheduledStart, filters.to));
    }
  }

  // Status filters
  if (filters.status) {
    conditions.push(eq(jobVisits.status, filters.status));
  }
  if (filters.excludeStatuses && filters.excludeStatuses.length > 0) {
    conditions.push(
      sql`${jobVisits.status} NOT IN (${sql.join(
        filters.excludeStatuses.map((s) => sql`${s}`),
        sql`, `
      )})`
    );
  }

  // Job-level filters
  if (filters.jobId) {
    conditions.push(eq(jobVisits.jobId, filters.jobId));
  }
  if (filters.locationId) {
    conditions.push(eq(jobs.locationId, filters.locationId));
  }

  const rows = await db
    .select(ENRICHED_VISIT_SELECT)
    .from(jobVisits)
    .innerJoin(jobs, eq(jobVisits.jobId, jobs.id))
    .leftJoin(clientLocations, eq(jobs.locationId, clientLocations.id))
    .leftJoin(customerCompanies, eq(clientLocations.parentCompanyId, customerCompanies.id))
    .where(and(...conditions))
    .orderBy(
      filters.unscheduled
        ? asc(jobs.jobNumber)
        : asc(jobVisits.scheduledStart)
    );

  return rows.map(toEnrichedVisit).map(toVisitFeedItem);
}

// Re-export toVisitFeedItem for consumers that need to map existing EnrichedVisit results
export { toVisitFeedItem };
