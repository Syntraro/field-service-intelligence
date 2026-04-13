/**
 * Recurring Job Templates Storage Layer
 *
 * CRUD operations for recurring job templates and instances.
 */

import { db } from "../db";
import { eq, and, desc, asc, gte, lte, sql, inArray, isNull, or, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  recurringJobTemplates,
  recurringJobInstances,
  jobs,
  jobVisits,
  customerCompanies,
  clientLocations,
  type RecurringJobTemplate,
  type RecurringJobInstance,
  type InsertRecurringJobTemplate,
  type UpdateRecurringJobTemplate,
} from "@shared/schema";
import { BaseRepository } from "./base";

/**
 * Instance with linked job info for UI display
 */
export interface InstanceWithJob {
  id: string;
  instanceDate: string;
  status: string;
  generatedJobId: string | null;
  claimedAt: Date | null;
  createdAt: Date;
  // Linked job info (if generated)
  job: {
    id: string;
    jobNumber: number;
    summary: string;
    status: string;
  } | null;
}

/**
 * Phase 4C: Template with joined client/location display names
 */
export interface TemplateWithNames extends RecurringJobTemplate {
  clientName: string | null;
  locationName: string | null;
  locationAddress: string | null;
}

export class RecurringJobsRepository extends BaseRepository {
  // ============================================================================
  // Templates CRUD
  // ============================================================================

  /**
   * Get all recurring job templates for a company.
   *
   * Phase 4C: Joins customer_companies and client_locations to return
   * clientName, locationName, locationAddress for PM Setups list display.
   */
  async getTemplates(
    companyId: string,
    options?: { activeOnly?: boolean; type?: "pm" | "recurring_job" }
  ): Promise<TemplateWithNames[]> {
    this.assertCompanyId(companyId);

    const conditions = [eq(recurringJobTemplates.companyId, companyId)];
    if (options?.activeOnly) {
      conditions.push(eq(recurringJobTemplates.isActive, true));
    }
    // Server-side type filter: pm = maintenance jobType, recurring_job = any non-maintenance jobType
    if (options?.type === "pm") {
      conditions.push(eq(recurringJobTemplates.jobType, "maintenance"));
    } else if (options?.type === "recurring_job") {
      conditions.push(ne(recurringJobTemplates.jobType, "maintenance"));
    }

    // Fallback: when template.clientId is null, resolve customer name via location's parentCompanyId
    const parentCustomer = alias(customerCompanies, "parentCustomer");

    const rows = await db
      .select({
        template: recurringJobTemplates,
        clientName: customerCompanies.name,
        parentCustomerName: parentCustomer.name,
        locationName: clientLocations.companyName,
        locationLabel: clientLocations.location,
        locationAddress: clientLocations.address,
        locationCity: clientLocations.city,
      })
      .from(recurringJobTemplates)
      .leftJoin(customerCompanies, eq(recurringJobTemplates.clientId, customerCompanies.id))
      .leftJoin(clientLocations, eq(recurringJobTemplates.locationId, clientLocations.id))
      .leftJoin(parentCustomer, eq(clientLocations.parentCompanyId, parentCustomer.id))
      .where(and(...conditions))
      .orderBy(desc(recurringJobTemplates.createdAt));

    return rows.map((r) => ({
      ...r.template,
      // Prefer direct clientId → customer_companies; fall back to location's parent customer
      clientName: r.clientName ?? r.parentCustomerName ?? null,
      // Phase 5B: Return location label (site name) separately — avoid repeating company name
      locationName: r.locationLabel || r.locationName || null,
      locationAddress: [r.locationAddress, r.locationCity].filter(Boolean).join(", ") || null,
    }));
  }

  /**
   * Get a single recurring job template by ID
   */
  async getTemplate(
    companyId: string,
    templateId: string
  ): Promise<RecurringJobTemplate | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(templateId, "templateId");

    const [template] = await db
      .select()
      .from(recurringJobTemplates)
      .where(
        and(
          eq(recurringJobTemplates.id, templateId),
          eq(recurringJobTemplates.companyId, companyId)
        )
      )
      .limit(1);

    return template ?? null;
  }

  /**
   * Detect PM-like templates for default service window selection.
   * Mirrors server/domain/recurrence.ts isPmTemplate() but works on creation
   * input (before the row exists). PM templates get 14-day after-window;
   * non-PM recurring jobs get 0-day after-window.
   * 2026-04-02: Added to prevent recurring jobs from inheriting PM-style windows.
   */
  private isPmLikeTemplate(data: { jobType?: string; monthsOfYear?: number[] | null }): boolean {
    return data.jobType === "maintenance"
      && Array.isArray(data.monthsOfYear)
      && data.monthsOfYear.length > 0;
  }

  /**
   * Create a new recurring job template
   *
   * @param companyId - Company ID for tenant isolation
   * @param data - Template data (title and startDate required, rest have defaults)
   */
  async createTemplate(
    companyId: string,
    data: {
      title: string;
      startDate: string;
      clientId?: string | null;
      locationId?: string | null;
      description?: string | null;
      notes?: string | null;
      defaultDurationMinutes?: number | null;
      jobType?: string;
      priority?: string;
      openSubStatusDefault?: string | null;
      holdReason?: string | null;
      isActive?: boolean;
      endDate?: string | null;
      timezone?: string | null;
      recurrenceKind?: string;
      interval?: number;
      daysOfWeek?: number[] | null;
      dayOfMonth?: number | null;
      // PM scheduling extensions
      monthsOfYear?: number[] | null;
      generationMode?: string;
      generationDayOfMonth?: number | null;
      includeLocationPmParts?: boolean;
      // PM Phase 3: Service window
      serviceWindowDaysBefore?: number;
      serviceWindowDaysAfter?: number;
    }
  ): Promise<RecurringJobTemplate> {
    this.assertCompanyId(companyId);

    const [template] = await db
      .insert(recurringJobTemplates)
      .values({
        companyId,
        title: data.title,
        startDate: data.startDate,
        // Optional fields with defaults
        clientId: data.clientId ?? null,
        locationId: data.locationId ?? null,
        description: data.description ?? null,
        notes: data.notes ?? null,
        defaultDurationMinutes: data.defaultDurationMinutes ?? null,
        jobType: data.jobType ?? "maintenance",
        priority: data.priority ?? "medium",
        openSubStatusDefault: data.openSubStatusDefault ?? null,
        holdReason: data.holdReason ?? null,
        isActive: data.isActive ?? true,
        endDate: data.endDate ?? null,
        timezone: data.timezone ?? null,
        recurrenceKind: data.recurrenceKind ?? "weekly",
        interval: data.interval ?? 1,
        daysOfWeek: data.daysOfWeek ?? null,
        dayOfMonth: data.dayOfMonth ?? null,
        // PM scheduling extensions
        monthsOfYear: data.monthsOfYear ?? null,
        generationMode: data.generationMode ?? "phase",
        generationDayOfMonth: data.generationDayOfMonth ?? null,
        includeLocationPmParts: data.includeLocationPmParts ?? false,
        // Service window defaults — PM templates keep 7/14, recurring jobs use 7/0.
        // 2026-04-02: Non-PM recurring jobs default to 0 days after (tight window)
        // so they don't inherit the PM-style 14-day after-window.
        serviceWindowDaysBefore: data.serviceWindowDaysBefore ?? 7,
        serviceWindowDaysAfter: data.serviceWindowDaysAfter
          ?? (this.isPmLikeTemplate(data) ? 14 : 0),
      })
      .returning();

    return template;
  }

  /**
   * Update a recurring job template
   */
  async updateTemplate(
    companyId: string,
    templateId: string,
    data: UpdateRecurringJobTemplate
  ): Promise<RecurringJobTemplate | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(templateId, "templateId");

    const [updated] = await db
      .update(recurringJobTemplates)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(recurringJobTemplates.id, templateId),
          eq(recurringJobTemplates.companyId, companyId)
        )
      )
      .returning();

    return updated ?? null;
  }

  /**
   * Deactivate a recurring job template (soft delete / archive).
   * Also cancels all pending (not-yet-generated) instances so they stop
   * appearing as actionable due items on the Dashboard.
   */
  async deactivateTemplate(
    companyId: string,
    templateId: string
  ): Promise<{ deactivated: boolean; instancesCanceled: number }> {
    this.assertCompanyId(companyId);
    this.validateUUID(templateId, "templateId");

    const result = await db
      .update(recurringJobTemplates)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(recurringJobTemplates.id, templateId),
          eq(recurringJobTemplates.companyId, companyId)
        )
      )
      .returning({ id: recurringJobTemplates.id });

    if (result.length === 0) {
      return { deactivated: false, instancesCanceled: 0 };
    }

    // Cancel all pending instances — they are no longer actionable since the
    // contract is archived. Generated instances (with jobs) are preserved.
    const canceled = await db
      .update(recurringJobInstances)
      .set({ status: "canceled" })
      .where(
        and(
          eq(recurringJobInstances.templateId, templateId),
          eq(recurringJobInstances.companyId, companyId),
          eq(recurringJobInstances.status, "pending"),
          isNull(recurringJobInstances.generatedJobId)
        )
      )
      .returning({ id: recurringJobInstances.id });

    return { deactivated: true, instancesCanceled: canceled.length };
  }

  /**
   * Check if a template has downstream activity (instances with generated jobs
   * or jobs linked via recurrenceTemplateId). Used to decide hard delete vs archive.
   */
  async hasDownstreamActivity(
    companyId: string,
    templateId: string
  ): Promise<boolean> {
    this.assertCompanyId(companyId);
    this.validateUUID(templateId, "templateId");

    // Check for any instance that was converted to a job
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(recurringJobInstances)
      .where(
        and(
          eq(recurringJobInstances.templateId, templateId),
          eq(recurringJobInstances.companyId, companyId),
          sql`${recurringJobInstances.generatedJobId} IS NOT NULL`
        )
      );

    return (row?.count ?? 0) > 0;
  }

  /**
   * Delete a recurring job template (hard delete).
   * Cascade deletes all instances. Only safe when hasDownstreamActivity is false.
   */
  async deleteTemplate(
    companyId: string,
    templateId: string
  ): Promise<boolean> {
    this.assertCompanyId(companyId);
    this.validateUUID(templateId, "templateId");

    const result = await db
      .delete(recurringJobTemplates)
      .where(
        and(
          eq(recurringJobTemplates.id, templateId),
          eq(recurringJobTemplates.companyId, companyId)
        )
      )
      .returning({ id: recurringJobTemplates.id });

    return result.length > 0;
  }

  /**
   * Duplicate a recurring job template (PM Phase 2 - copy flow)
   *
   * Creates a new template with the same configuration but:
   * - New UUID, fresh timestamps
   * - Title suffixed with " (Copy)"
   * - Starts in paused state (isActive = false)
   */
  async duplicateTemplate(
    companyId: string,
    templateId: string
  ): Promise<RecurringJobTemplate | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(templateId, "templateId");

    const source = await this.getTemplate(companyId, templateId);
    if (!source) return null;

    // Strip system fields, override title + active state
    const { id, createdAt, updatedAt, ...rest } = source;

    const [copy] = await db
      .insert(recurringJobTemplates)
      .values({
        ...rest,
        companyId,
        title: `${source.title} (Copy)`,
        isActive: false, // Start paused so user can review before activating
      })
      .returning();

    return copy;
  }

  // ============================================================================
  // Instances
  // ============================================================================

  /**
   * Get instances for a template
   */
  async getInstancesForTemplate(
    companyId: string,
    templateId: string,
    options?: { limit?: number }
  ): Promise<RecurringJobInstance[]> {
    this.assertCompanyId(companyId);
    this.validateUUID(templateId, "templateId");

    let query = db
      .select()
      .from(recurringJobInstances)
      .where(
        and(
          eq(recurringJobInstances.templateId, templateId),
          eq(recurringJobInstances.companyId, companyId)
        )
      )
      .orderBy(desc(recurringJobInstances.instanceDate));

    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }

    return await query;
  }

  /**
   * Get instances with linked job info for a template within a date range
   *
   * @param companyId - Company ID for tenant isolation
   * @param templateId - Template ID to get instances for
   * @param options - Date range and limit options
   * @returns Instances with linked job info
   */
  async getInstancesWithJobs(
    companyId: string,
    templateId: string,
    options?: { from?: string; to?: string; limit?: number }
  ): Promise<InstanceWithJob[]> {
    this.assertCompanyId(companyId);
    this.validateUUID(templateId, "templateId");

    // Build where conditions
    const conditions = [
      eq(recurringJobInstances.templateId, templateId),
      eq(recurringJobInstances.companyId, companyId),
    ];

    if (options?.from) {
      conditions.push(gte(recurringJobInstances.instanceDate, options.from));
    }
    if (options?.to) {
      conditions.push(lte(recurringJobInstances.instanceDate, options.to));
    }

    // Query instances with left join to jobs
    const results = await db
      .select({
        id: recurringJobInstances.id,
        instanceDate: recurringJobInstances.instanceDate,
        status: recurringJobInstances.status,
        generatedJobId: recurringJobInstances.generatedJobId,
        claimedAt: recurringJobInstances.claimedAt,
        createdAt: recurringJobInstances.createdAt,
        jobId: jobs.id,
        jobNumber: jobs.jobNumber,
        jobSummary: jobs.summary,
        jobStatus: jobs.status,
      })
      .from(recurringJobInstances)
      // Exclude soft-deleted jobs so they resolve to job: null (same as hard-deleted)
      .leftJoin(jobs, and(eq(recurringJobInstances.generatedJobId, jobs.id), isNull(jobs.deletedAt)))
      .where(and(...conditions))
      .orderBy(asc(recurringJobInstances.instanceDate))
      .limit(options?.limit ?? 100);

    // Transform results
    return results.map((row) => ({
      id: row.id,
      instanceDate: row.instanceDate,
      status: row.status,
      generatedJobId: row.generatedJobId,
      claimedAt: row.claimedAt,
      createdAt: row.createdAt,
      job: row.jobId
        ? {
            id: row.jobId,
            jobNumber: row.jobNumber!,
            summary: row.jobSummary!,
            status: row.jobStatus!,
          }
        : null,
    }));
  }

  /**
   * Cancel an instance (prevents job creation if not yet generated)
   */
  async cancelInstance(
    companyId: string,
    instanceId: string
  ): Promise<RecurringJobInstance | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(instanceId, "instanceId");

    const [updated] = await db
      .update(recurringJobInstances)
      .set({ status: "canceled" })
      .where(
        and(
          eq(recurringJobInstances.id, instanceId),
          eq(recurringJobInstances.companyId, companyId)
        )
      )
      .returning();

    return updated ?? null;
  }

  /**
   * Skip an instance
   */
  async skipInstance(
    companyId: string,
    instanceId: string
  ): Promise<RecurringJobInstance | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(instanceId, "instanceId");

    const [updated] = await db
      .update(recurringJobInstances)
      .set({ status: "skipped" })
      .where(
        and(
          eq(recurringJobInstances.id, instanceId),
          eq(recurringJobInstances.companyId, companyId)
        )
      )
      .returning();

    return updated ?? null;
  }
  // ============================================================================
  // PM Phase 3+4A: Upcoming Planning Queue with Scheduling Visibility
  // ============================================================================

  /**
   * Get upcoming PM instances across all active templates for the company.
   *
   * Phase 4A: Enhanced with visit scheduling data, dual compliance/scheduling
   * states, and completion timing for operational visibility.
   *
   * Two-pass approach:
   *   1. Main query joins instances→templates→jobs→customer→location→tech
   *   2. Batch-fetch visits for all jobs in the result set
   *
   * This avoids complex lateral joins while keeping the query fast.
   */
  async getUpcomingQueue(
    companyId: string,
    options?: {
      from?: string;
      to?: string;
      statuses?: string[];
      limit?: number;
      offset?: number;
    }
  ): Promise<UpcomingQueueItem[]> {
    this.assertCompanyId(companyId);

    const conditions = [
      eq(recurringJobInstances.companyId, companyId),
      // PM Due Queue eligibility: instance lifecycle status is the authoritative gate.
      // Only "pending" instances are legitimately queue-visible.
      // "claiming" is a transitional state (mid-generation); stale claims are recovered
      // back to "pending" by recoverStaleClaims() before any generation attempt.
      // "generated" instances must stay hidden even if generatedJobId is later nulled
      // by FK cascade when the linked job is deleted — the occurrence is consumed.
      // "skipped" and "canceled" are terminal and must never reappear.
      eq(recurringJobInstances.status, "pending"),
      // Only show instances from active contracts — archived/deactivated contracts
      // must not surface actionable due items on the Dashboard
      eq(recurringJobTemplates.isActive, true),
    ];

    if (options?.from) {
      conditions.push(gte(recurringJobInstances.instanceDate, options.from));
    }
    if (options?.to) {
      conditions.push(lte(recurringJobInstances.instanceDate, options.to));
    }
    if (options?.statuses && options.statuses.length > 0) {
      conditions.push(inArray(recurringJobInstances.status, options.statuses));
    }

    // Pass 1: Core query — instances + templates + jobs + names
    const rows = await db
      .select({
        instanceId: recurringJobInstances.id,
        instanceDate: recurringJobInstances.instanceDate,
        instanceStatus: recurringJobInstances.status,
        generatedJobId: recurringJobInstances.generatedJobId,
        instanceCreatedAt: recurringJobInstances.createdAt,
        templateId: recurringJobTemplates.id,
        templateTitle: recurringJobTemplates.title,
        templateIsActive: recurringJobTemplates.isActive,
        // Dashboard unification: surface jobType so the dashboard can distinguish PM vs recurring job occurrences
        templateJobType: recurringJobTemplates.jobType,
        monthsOfYear: recurringJobTemplates.monthsOfYear,
        serviceWindowDaysBefore: recurringJobTemplates.serviceWindowDaysBefore,
        serviceWindowDaysAfter: recurringJobTemplates.serviceWindowDaysAfter,
        locationId: recurringJobTemplates.locationId,
        clientId: recurringJobTemplates.clientId,
        jobId: jobs.id,
        jobNumber: jobs.jobNumber,
        jobStatus: jobs.status,
        jobSummary: jobs.summary,
        jobCompletedAt: jobs.actualEnd,
        customerName: customerCompanies.name,
        locationName: clientLocations.companyName,
        locationLabel: clientLocations.location,
        // Phase 4B: Location coordinates + address for proximity grouping
        locationLat: clientLocations.lat,
        locationLng: clientLocations.lng,
        locationAddress: clientLocations.address,
        locationCity: clientLocations.city,
      })
      .from(recurringJobInstances)
      .innerJoin(recurringJobTemplates, eq(recurringJobInstances.templateId, recurringJobTemplates.id))
      .leftJoin(jobs, eq(recurringJobInstances.generatedJobId, jobs.id))
      .leftJoin(customerCompanies, eq(recurringJobTemplates.clientId, customerCompanies.id))
      .leftJoin(clientLocations, eq(recurringJobTemplates.locationId, clientLocations.id))
      .where(and(...conditions))
      .orderBy(asc(recurringJobInstances.instanceDate))
      .limit(options?.limit ?? 200)
      .offset(options?.offset ?? 0);

    // Pass 2: Batch-fetch visits for all linked jobs
    const jobIds = rows
      .map((r) => r.jobId)
      .filter((id): id is string => id !== null);

    // Map jobId → earliest visit info
    const visitMap = new Map<string, {
      visitId: string;
      visitStatus: string;
      scheduledStart: Date | null;
      scheduledDate: Date;
      completedAt: Date | null;
      assignedTechnicianIds: string[] | null;
    }>();

    if (jobIds.length > 0) {
      const visits = await db
        .select({
          jobId: jobVisits.jobId,
          visitId: jobVisits.id,
          visitStatus: jobVisits.status,
          scheduledStart: jobVisits.scheduledStart,
          scheduledDate: jobVisits.scheduledDate,
          completedAt: jobVisits.completedAt,
          assignedTechnicianIds: jobVisits.assignedTechnicianIds,
        })
        .from(jobVisits)
        .where(and(
          inArray(jobVisits.jobId, jobIds),
          eq(jobVisits.companyId, companyId),
        ))
        .orderBy(asc(jobVisits.scheduledDate));

      // Keep the earliest visit per job (first in date order)
      for (const v of visits) {
        if (!visitMap.has(v.jobId)) {
          visitMap.set(v.jobId, {
            visitId: v.visitId,
            visitStatus: v.visitStatus,
            scheduledStart: v.scheduledStart,
            scheduledDate: v.scheduledDate,
            completedAt: v.completedAt,
            assignedTechnicianIds: v.assignedTechnicianIds,
          });
        }
      }
    }

    const today = new Date().toISOString().split("T")[0];

    return rows.map((r) => {
      // Phase 5B: Use location label (site name) — avoid repeating company name
      const locationDisplay = r.locationLabel || r.locationName || "";
      // Technician name no longer on template — derived from visit assignment
      const techName: string | null = null;

      const windowBefore = r.serviceWindowDaysBefore ?? 7;
      const windowAfter = r.serviceWindowDaysAfter ?? 14;
      const idealDate = new Date(r.instanceDate + "T00:00:00");
      const windowStart = new Date(idealDate);
      windowStart.setDate(windowStart.getDate() - windowBefore);
      const windowEnd = new Date(idealDate);
      windowEnd.setDate(windowEnd.getDate() + windowAfter);

      const windowStartStr = windowStart.toISOString().split("T")[0];
      const windowEndStr = windowEnd.toISOString().split("T")[0];

      // Visit data for this job
      const visit = r.jobId ? visitMap.get(r.jobId) ?? null : null;

      // --- Scheduling state (Phase 4A) ---
      let schedulingState: UpcomingQueueItem["schedulingState"];
      if (r.instanceStatus === "skipped") {
        schedulingState = "skipped";
      } else if (r.instanceStatus === "canceled") {
        schedulingState = "canceled";
      } else if (r.jobStatus === "completed" || r.jobStatus === "invoiced") {
        schedulingState = "completed";
      } else if (!r.jobId) {
        schedulingState = "not_generated";
      } else if (visit && visit.scheduledStart) {
        schedulingState = "scheduled";
      } else {
        schedulingState = "generated_unscheduled";
      }

      // --- Compliance state ---
      let complianceStatus: UpcomingQueueItem["complianceStatus"];
      if (r.instanceStatus === "skipped") {
        complianceStatus = "skipped";
      } else if (r.instanceStatus === "canceled") {
        complianceStatus = "canceled";
      } else if (r.jobStatus === "completed" || r.jobStatus === "invoiced") {
        // Phase 4A: Distinguish on-time vs late completions
        const completionDate = visit?.completedAt ?? r.jobCompletedAt;
        if (completionDate) {
          const completedStr = new Date(completionDate).toISOString().split("T")[0];
          complianceStatus = completedStr > windowEndStr ? "completed_late" : "completed_on_time";
        } else {
          complianceStatus = "completed_on_time"; // Completed but no timestamp — assume on time
        }
      } else if (today > windowEndStr) {
        complianceStatus = "overdue";
      } else if (today >= windowStartStr && today <= windowEndStr) {
        const daysToEnd = Math.ceil((windowEnd.getTime() - new Date(today + "T00:00:00").getTime()) / (1000 * 60 * 60 * 24));
        complianceStatus = daysToEnd <= 3 ? "due_soon" : "in_window";
      } else {
        complianceStatus = "upcoming";
      }

      // Visit scheduled display time
      const visitScheduledDate = visit?.scheduledStart
        ? visit.scheduledStart.toISOString()
        : visit?.scheduledDate
          ? visit.scheduledDate.toISOString()
          : null;

      return {
        instanceId: r.instanceId,
        instanceDate: r.instanceDate,
        instanceStatus: r.instanceStatus,
        templateId: r.templateId,
        templateTitle: r.templateTitle,
        templateIsActive: r.templateIsActive,
        templateJobType: r.templateJobType,
        serviceWindowDaysBefore: windowBefore,
        serviceWindowDaysAfter: windowAfter,
        windowStart: windowStartStr,
        windowEnd: windowEndStr,
        complianceStatus,
        schedulingState,
        locationId: r.locationId,
        locationName: locationDisplay || null,
        locationLat: r.locationLat ? parseFloat(r.locationLat) : null,
        locationLng: r.locationLng ? parseFloat(r.locationLng) : null,
        locationAddress: r.locationAddress ?? null,
        locationCity: r.locationCity ?? null,
        clientId: r.clientId,
        customerName: r.customerName ?? null,
        technicianName: techName,
        generatedJobId: r.generatedJobId,
        job: r.jobId ? {
          id: r.jobId,
          jobNumber: r.jobNumber!,
          status: r.jobStatus!,
          summary: r.jobSummary!,
        } : null,
        // Phase 4A: Visit scheduling info
        visit: visit ? {
          visitId: visit.visitId,
          visitStatus: visit.visitStatus,
          scheduledDate: visitScheduledDate,
          completedAt: visit.completedAt?.toISOString() ?? null,
          assignedTechnicianIds: visit.assignedTechnicianIds ?? [],
        } : null,
      };
    });
  }
}

/** Phase 4A: Scheduling states derived from job/visit data */
type SchedulingState = "not_generated" | "generated_unscheduled" | "scheduled" | "completed" | "canceled" | "skipped";

/** Phase 4A: Compliance states — expanded with on-time/late distinction */
type ComplianceStatus = "upcoming" | "in_window" | "due_soon" | "overdue" | "completed_on_time" | "completed_late" | "skipped" | "canceled";

/** Shape returned by getUpcomingQueue */
export interface UpcomingQueueItem {
  instanceId: string;
  instanceDate: string;
  instanceStatus: string;
  templateId: string;
  templateTitle: string;
  templateIsActive: boolean;
  /** Dashboard unification: jobType from template — "maintenance" = PM, anything else = Recurring Job */
  templateJobType: string;
  serviceWindowDaysBefore: number;
  serviceWindowDaysAfter: number;
  windowStart: string;
  windowEnd: string;
  complianceStatus: ComplianceStatus;
  schedulingState: SchedulingState;
  locationId: string | null;
  locationName: string | null;
  /** Phase 4B: Location coordinates for proximity grouping */
  locationLat: number | null;
  locationLng: number | null;
  locationAddress: string | null;
  locationCity: string | null;
  clientId: string | null;
  customerName: string | null;
  technicianName: string | null;
  generatedJobId: string | null;
  job: {
    id: string;
    jobNumber: number;
    status: string;
    summary: string;
  } | null;
  /** Phase 4A: Linked visit scheduling info (earliest visit for the job) */
  visit: {
    visitId: string;
    visitStatus: string;
    scheduledDate: string | null;
    completedAt: string | null;
    assignedTechnicianIds: string[];
  } | null;
}

// Export singleton instance
export const recurringJobsRepository = new RecurringJobsRepository();
