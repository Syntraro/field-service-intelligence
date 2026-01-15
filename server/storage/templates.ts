import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { jobTemplates, jobTemplateLineItems, jobParts } from "@shared/schema";
import type { InsertJobTemplate, JobTemplate } from "@shared/schema";
import { BaseRepository } from "./base";

export class TemplateRepository extends BaseRepository {
  /**
   * Get job templates with optional filters
   */
  async getJobTemplates(
    companyId: string,
    filter?: { jobType?: string; activeOnly?: boolean }
  ) {
    let query = db
      .select()
      .from(jobTemplates)
      .where(eq(jobTemplates.companyId, companyId))
      .$dynamic();

    if (filter?.jobType) {
      query = query.where(eq(jobTemplates.jobType, filter.jobType));
    }

    if (filter?.activeOnly !== false) {
      query = query.where(eq(jobTemplates.isActive, true));
    }

    return await query.orderBy(jobTemplates.name);
  }

  /**
   * Get single job template
   */
  async getJobTemplate(companyId: string, templateId: string) {
    const rows = await db
      .select()
      .from(jobTemplates)
      .where(
        and(eq(jobTemplates.id, templateId), eq(jobTemplates.companyId, companyId))
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Get job template line items
   */
  async getJobTemplateLineItems(templateId: string) {
    return await db
      .select()
      .from(jobTemplateLineItems)
      .where(eq(jobTemplateLineItems.templateId, templateId))
      .orderBy(jobTemplateLineItems.sortOrder);
  }

  /**
   * Create job template with line items
   */
  async createJobTemplate(
    companyId: string,
    templateData: InsertJobTemplate,
    lines: Array<any> = []
  ): Promise<JobTemplate> {
    return await db.transaction(async (tx) => {
      // Create template
      const [template] = await tx
        .insert(jobTemplates)
        .values({ ...templateData, companyId })
        .returning();

      // Add line items
      if (lines.length > 0) {
        await tx.insert(jobTemplateLineItems).values(
          lines.map((line, index) => ({
            ...line,
            templateId: template.id,
            sortOrder: line.sortOrder ?? index,
          }))
        );
      }

      return template;
    });
  }

  /**
   * Update job template
   */
  async updateJobTemplate(
    companyId: string,
    templateId: string,
    templateData: Partial<InsertJobTemplate>,
    lines?: Array<any>
  ) {
    return await db.transaction(async (tx) => {
      // Update template
      const [template] = await tx
        .update(jobTemplates)
        .set({ ...templateData, updatedAt: new Date() })
        .where(
          and(eq(jobTemplates.id, templateId), eq(jobTemplates.companyId, companyId))
        )
        .returning();

      if (!template) return null;

      // Update line items if provided
      if (lines !== undefined) {
        // Delete existing lines
        await tx
          .delete(jobTemplateLineItems)
          .where(eq(jobTemplateLineItems.templateId, templateId));

        // Insert new lines
        if (lines.length > 0) {
          await tx.insert(jobTemplateLineItems).values(
            lines.map((line, index) => ({
              ...line,
              templateId: template.id,
              sortOrder: line.sortOrder ?? index,
            }))
          );
        }
      }

      return template;
    });
  }

  /**
   * Delete job template
   */
  async deleteJobTemplate(companyId: string, templateId: string): Promise<boolean> {
    const result = await db
      .update(jobTemplates)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(eq(jobTemplates.id, templateId), eq(jobTemplates.companyId, companyId))
      )
      .returning();

    return result.length > 0;
  }

  /**
   * Set job template as default for a job type
   */
  async setJobTemplateAsDefault(
    companyId: string,
    templateId: string,
    jobType: string
  ) {
    return await db.transaction(async (tx) => {
      // Unset all defaults for this job type
      await tx
        .update(jobTemplates)
        .set({ isDefaultForJobType: false })
        .where(
          and(
            eq(jobTemplates.companyId, companyId),
            eq(jobTemplates.jobType, jobType)
          )
        );

      // Set this template as default
      const [template] = await tx
        .update(jobTemplates)
        .set({ isDefaultForJobType: true, jobType, updatedAt: new Date() })
        .where(
          and(eq(jobTemplates.id, templateId), eq(jobTemplates.companyId, companyId))
        )
        .returning();

      return template ?? null;
    });
  }

  /**
   * Get default job template for a job type
   */
  async getDefaultJobTemplateForJobType(companyId: string, jobType: string) {
    const rows = await db
      .select()
      .from(jobTemplates)
      .where(
        and(
          eq(jobTemplates.companyId, companyId),
          eq(jobTemplates.jobType, jobType),
          eq(jobTemplates.isDefaultForJobType, true),
          eq(jobTemplates.isActive, true)
        )
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Apply job template to a job (copy line items to job parts)
   * @param mode - "replace" adds all template items, "merge" skips items with duplicate productId
   * @returns { appliedCount, skippedCount, parts }
   */
  async applyJobTemplateToJob(
    companyId: string,
    jobId: string,
    templateId: string,
    mode: "replace" | "merge" = "replace"
  ): Promise<{ appliedCount: number; skippedCount: number; parts: any[] }> {
    const template = await this.getJobTemplate(companyId, templateId);
    if (!template) {
      throw this.notFoundError("Template");
    }

    const lines = await this.getJobTemplateLineItems(templateId);

    // For merge mode, get existing job parts to check for duplicates
    let existingProductIds: Set<string> = new Set();
    if (mode === "merge") {
      const existingParts = await db
        .select({ productId: jobParts.productId })
        .from(jobParts)
        .where(eq(jobParts.jobId, jobId));
      existingProductIds = new Set(
        existingParts.map((p) => p.productId).filter((id): id is string => id !== null)
      );
    }

    // Get current max sortOrder for merge mode
    let maxSortOrder = 0;
    if (mode === "merge") {
      const [maxResult] = await db
        .select({ maxSort: jobParts.sortOrder })
        .from(jobParts)
        .where(eq(jobParts.jobId, jobId))
        .orderBy(jobParts.sortOrder)
        .limit(1);
      maxSortOrder = (maxResult?.maxSort ?? -1) + 1;
    }

    // Create job parts from template lines
    const createdParts = [];
    let skippedCount = 0;

    for (const line of lines) {
      // In merge mode, skip if productId already exists
      if (mode === "merge" && existingProductIds.has(line.productId)) {
        skippedCount++;
        continue;
      }

      const sortOrder = mode === "merge" ? maxSortOrder++ : line.sortOrder;

      const [part] = await db
        .insert(jobParts)
        .values({
          companyId,
          jobId,
          productId: line.productId,
          description: line.descriptionOverride || "",
          quantity: line.quantity,
          unitPrice: line.unitPriceOverride || "0",
          sortOrder,
        })
        .returning();

      createdParts.push(part);
    }

    return {
      appliedCount: createdParts.length,
      skippedCount,
      parts: createdParts,
    };
  }

  /**
   * Clone job template
   */
  async cloneJobTemplate(companyId: string, templateId: string) {
    const template = await this.getJobTemplate(companyId, templateId);
    if (!template) {
      throw this.notFoundError("Template");
    }

    const lines = await this.getJobTemplateLineItems(templateId);

    return await db.transaction(async (tx) => {
      // Create cloned template
      const [cloned] = await tx
        .insert(jobTemplates)
        .values({
          companyId,
          name: `${template.name} (Copy)`,
          jobType: template.jobType,
          description: template.description,
          isDefaultForJobType: false, // Clone is never default
          isActive: true,
        })
        .returning();

      // Copy line items
      if (lines.length > 0) {
        await tx.insert(jobTemplateLineItems).values(
          lines.map((line) => ({
            templateId: cloned.id,
            productId: line.productId,
            descriptionOverride: line.descriptionOverride,
            quantity: line.quantity,
            unitPriceOverride: line.unitPriceOverride,
            sortOrder: line.sortOrder,
          }))
        );
      }

      return cloned;
    });
  }
}

export const templateRepository = new TemplateRepository();