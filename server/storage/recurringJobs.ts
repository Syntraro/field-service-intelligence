/**
 * Recurring Job Templates Storage Layer
 *
 * CRUD operations for recurring job templates and instances.
 */

import { db } from "../db";
import { eq, and, desc, asc, gte, lte, sql } from "drizzle-orm";
import {
  recurringJobTemplates,
  recurringJobInstances,
  jobs,
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

export class RecurringJobsRepository extends BaseRepository {
  // ============================================================================
  // Templates CRUD
  // ============================================================================

  /**
   * Get all recurring job templates for a company
   */
  async getTemplates(
    companyId: string,
    options?: { activeOnly?: boolean }
  ): Promise<RecurringJobTemplate[]> {
    this.assertCompanyId(companyId);

    let query = db
      .select()
      .from(recurringJobTemplates)
      .where(eq(recurringJobTemplates.companyId, companyId))
      .orderBy(desc(recurringJobTemplates.createdAt));

    if (options?.activeOnly) {
      query = db
        .select()
        .from(recurringJobTemplates)
        .where(
          and(
            eq(recurringJobTemplates.companyId, companyId),
            eq(recurringJobTemplates.isActive, true)
          )
        )
        .orderBy(desc(recurringJobTemplates.createdAt));
    }

    return await query;
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
      preferredTechnicianId?: string | null;
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
        preferredTechnicianId: data.preferredTechnicianId ?? null,
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
   * Deactivate a recurring job template (soft delete)
   */
  async deactivateTemplate(
    companyId: string,
    templateId: string
  ): Promise<boolean> {
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

    return result.length > 0;
  }

  /**
   * Delete a recurring job template (hard delete)
   * Note: This will cascade delete all instances
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
      .leftJoin(jobs, eq(recurringJobInstances.generatedJobId, jobs.id))
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
}

// Export singleton instance
export const recurringJobsRepository = new RecurringJobsRepository();
