import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  quoteTemplates,
  quoteTemplateLines,
  quoteLines,
  quotes,
  type QuoteTemplate,
  type QuoteTemplateLine,
  type InsertQuoteTemplate,
  type InsertQuoteTemplateLine,
} from "@shared/schema";
import { BaseRepository } from "./base";

interface ListOptions {
  activeOnly?: boolean;
}

export class QuoteTemplateRepository extends BaseRepository {
  /**
   * List quote templates for a company
   */
  async listQuoteTemplates(
    companyId: string,
    options: ListOptions = {}
  ): Promise<QuoteTemplate[]> {
    this.assertCompanyId(companyId);

    const conditions = [eq(quoteTemplates.companyId, companyId)];

    if (options.activeOnly !== false) {
      conditions.push(eq(quoteTemplates.isActive, true));
    }

    return await db
      .select()
      .from(quoteTemplates)
      .where(and(...conditions))
      .orderBy(quoteTemplates.name);
  }

  /**
   * Get a single quote template with its lines
   */
  async getQuoteTemplate(
    companyId: string,
    templateId: string
  ): Promise<(QuoteTemplate & { lines: QuoteTemplateLine[] }) | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(templateId, "templateId");

    const [template] = await db
      .select()
      .from(quoteTemplates)
      .where(
        and(
          eq(quoteTemplates.id, templateId),
          eq(quoteTemplates.companyId, companyId)
        )
      )
      .limit(1);

    if (!template) return null;

    const lines = await this.getQuoteTemplateLines(templateId);

    return { ...template, lines };
  }

  /**
   * Get quote template lines
   */
  async getQuoteTemplateLines(templateId: string): Promise<QuoteTemplateLine[]> {
    return await db
      .select()
      .from(quoteTemplateLines)
      .where(eq(quoteTemplateLines.templateId, templateId))
      .orderBy(quoteTemplateLines.sortOrder);
  }

  /**
   * Create a new quote template with lines
   */
  async createQuoteTemplate(
    companyId: string,
    data: Omit<InsertQuoteTemplate, "companyId">,
    lines: Array<Omit<InsertQuoteTemplateLine, "companyId" | "templateId">> = []
  ): Promise<QuoteTemplate & { lines: QuoteTemplateLine[] }> {
    this.assertCompanyId(companyId);

    return await db.transaction(async (tx) => {
      // If setting as default, unset any existing default
      if (data.isDefault) {
        await tx
          .update(quoteTemplates)
          .set({ isDefault: false })
          .where(eq(quoteTemplates.companyId, companyId));
      }

      // Create template
      const [template] = await tx
        .insert(quoteTemplates)
        .values({
          ...data,
          companyId,
        })
        .returning();

      // Add lines
      let createdLines: QuoteTemplateLine[] = [];
      if (lines.length > 0) {
        createdLines = await tx
          .insert(quoteTemplateLines)
          .values(
            lines.map((line, index) => ({
              ...line,
              companyId,
              templateId: template.id,
              sortOrder: line.sortOrder ?? index,
            }))
          )
          .returning();
      }

      return { ...template, lines: createdLines };
    });
  }

  /**
   * Update a quote template
   */
  async updateQuoteTemplate(
    companyId: string,
    templateId: string,
    data: Partial<InsertQuoteTemplate>,
    lines?: Array<Omit<InsertQuoteTemplateLine, "companyId" | "templateId">>
  ): Promise<(QuoteTemplate & { lines: QuoteTemplateLine[] }) | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(templateId, "templateId");

    return await db.transaction(async (tx) => {
      // If setting as default, unset any existing default
      if (data.isDefault) {
        await tx
          .update(quoteTemplates)
          .set({ isDefault: false })
          .where(
            and(
              eq(quoteTemplates.companyId, companyId),
              sql`${quoteTemplates.id} != ${templateId}`
            )
          );
      }

      // Update template
      const [template] = await tx
        .update(quoteTemplates)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(quoteTemplates.id, templateId),
            eq(quoteTemplates.companyId, companyId)
          )
        )
        .returning();

      if (!template) return null;

      // Update lines if provided
      let updatedLines: QuoteTemplateLine[] = [];
      if (lines !== undefined) {
        // Delete existing lines
        await tx
          .delete(quoteTemplateLines)
          .where(eq(quoteTemplateLines.templateId, templateId));

        // Insert new lines
        if (lines.length > 0) {
          updatedLines = await tx
            .insert(quoteTemplateLines)
            .values(
              lines.map((line, index) => ({
                ...line,
                companyId,
                templateId: template.id,
                sortOrder: line.sortOrder ?? index,
              }))
            )
            .returning();
        }
      } else {
        // Fetch existing lines
        updatedLines = await tx
          .select()
          .from(quoteTemplateLines)
          .where(eq(quoteTemplateLines.templateId, templateId))
          .orderBy(quoteTemplateLines.sortOrder);
      }

      return { ...template, lines: updatedLines };
    });
  }

  /**
   * Delete a quote template (soft delete)
   */
  async deleteQuoteTemplate(
    companyId: string,
    templateId: string
  ): Promise<boolean> {
    this.assertCompanyId(companyId);
    this.validateUUID(templateId, "templateId");

    const result = await db
      .update(quoteTemplates)
      .set({
        isActive: false,
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(quoteTemplates.id, templateId),
          eq(quoteTemplates.companyId, companyId)
        )
      )
      .returning();

    return result.length > 0;
  }

  /**
   * Clone a quote template
   */
  async cloneQuoteTemplate(
    companyId: string,
    templateId: string
  ): Promise<(QuoteTemplate & { lines: QuoteTemplateLine[] }) | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(templateId, "templateId");

    const original = await this.getQuoteTemplate(companyId, templateId);
    if (!original) return null;

    return await db.transaction(async (tx) => {
      // Create cloned template
      const [cloned] = await tx
        .insert(quoteTemplates)
        .values({
          companyId,
          name: `${original.name} (Copy)`,
          description: original.description,
          isDefault: false,
          isActive: true,
        })
        .returning();

      // Clone lines
      let clonedLines: QuoteTemplateLine[] = [];
      if (original.lines.length > 0) {
        clonedLines = await tx
          .insert(quoteTemplateLines)
          .values(
            original.lines.map((line) => ({
              companyId,
              templateId: cloned.id,
              productId: line.productId,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              sortOrder: line.sortOrder,
            }))
          )
          .returning();
      }

      return { ...cloned, lines: clonedLines };
    });
  }

  /**
   * Toggle template active status
   */
  async toggleQuoteTemplateActive(
    companyId: string,
    templateId: string,
    isActive: boolean
  ): Promise<QuoteTemplate | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(templateId, "templateId");

    const [updated] = await db
      .update(quoteTemplates)
      .set({
        isActive,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(quoteTemplates.id, templateId),
          eq(quoteTemplates.companyId, companyId)
        )
      )
      .returning();

    return updated ?? null;
  }

  /**
   * Set template as default
   */
  async setQuoteTemplateAsDefault(
    companyId: string,
    templateId: string
  ): Promise<QuoteTemplate | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(templateId, "templateId");

    return await db.transaction(async (tx) => {
      // Unset all defaults
      await tx
        .update(quoteTemplates)
        .set({ isDefault: false })
        .where(eq(quoteTemplates.companyId, companyId));

      // Set this one as default
      const [template] = await tx
        .update(quoteTemplates)
        .set({
          isDefault: true,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(quoteTemplates.id, templateId),
            eq(quoteTemplates.companyId, companyId)
          )
        )
        .returning();

      return template ?? null;
    });
  }

  /**
   * Apply template to a quote
   * @param mode "replace" deletes existing lines first, "merge" appends and skips duplicates by productId
   */
  async applyQuoteTemplateToQuote(
    companyId: string,
    quoteId: string,
    templateId: string,
    mode: "replace" | "merge" = "replace"
  ): Promise<{ appliedCount: number; skippedCount: number; lines: any[] }> {
    this.assertCompanyId(companyId);
    this.validateUUID(quoteId, "quoteId");
    this.validateUUID(templateId, "templateId");

    const template = await this.getQuoteTemplate(companyId, templateId);
    if (!template) {
      throw this.notFoundError("Quote template");
    }

    // Verify quote exists and belongs to company
    const [quote] = await db
      .select()
      .from(quotes)
      .where(
        and(
          eq(quotes.id, quoteId),
          eq(quotes.companyId, companyId),
          eq(quotes.isActive, true)
        )
      )
      .limit(1);

    if (!quote) {
      throw this.notFoundError("Quote");
    }

    // For merge mode, get existing productIds
    let existingProductIds: Set<string> = new Set();
    if (mode === "merge") {
      const existingLines = await db
        .select({ productId: quoteLines.productId })
        .from(quoteLines)
        .where(eq(quoteLines.quoteId, quoteId));
      existingProductIds = new Set(
        existingLines.map((l) => l.productId).filter((id): id is string => id !== null)
      );
    }

    return await db.transaction(async (tx) => {
      // In replace mode, delete existing lines
      if (mode === "replace") {
        await tx.delete(quoteLines).where(eq(quoteLines.quoteId, quoteId));
      }

      // Get max line number for merge mode
      let maxLineNumber = 0;
      if (mode === "merge") {
        const [maxResult] = await tx
          .select({ max: sql<number>`COALESCE(MAX(line_number), 0)` })
          .from(quoteLines)
          .where(eq(quoteLines.quoteId, quoteId));
        maxLineNumber = maxResult?.max ?? 0;
      }

      const createdLines: any[] = [];
      let skippedCount = 0;

      for (const templateLine of template.lines) {
        // In merge mode, skip if productId already exists
        if (mode === "merge" && templateLine.productId && existingProductIds.has(templateLine.productId)) {
          skippedCount++;
          continue;
        }

        const lineNumber = mode === "replace"
          ? templateLine.sortOrder + 1
          : ++maxLineNumber;

        const [line] = await tx
          .insert(quoteLines)
          .values({
            companyId,
            quoteId,
            lineNumber,
            description: templateLine.description,
            quantity: templateLine.quantity,
            unitPrice: templateLine.unitPrice,
            lineSubtotal: (parseFloat(templateLine.quantity) * parseFloat(templateLine.unitPrice)).toFixed(2),
            lineTotal: (parseFloat(templateLine.quantity) * parseFloat(templateLine.unitPrice)).toFixed(2),
            productId: templateLine.productId,
            lineItemType: "service",
          })
          .returning();

        createdLines.push(line);
      }

      // Recalculate quote totals
      const [totals] = await tx
        .select({
          subtotal: sql<string>`COALESCE(SUM(line_subtotal::numeric), 0)::text`,
          taxTotal: sql<string>`COALESCE(SUM(tax_amount::numeric), 0)::text`,
          total: sql<string>`COALESCE(SUM(line_total::numeric), 0)::text`,
        })
        .from(quoteLines)
        .where(eq(quoteLines.quoteId, quoteId));

      await tx
        .update(quotes)
        .set({
          subtotal: totals?.subtotal ?? "0.00",
          taxTotal: totals?.taxTotal ?? "0.00",
          total: totals?.total ?? "0.00",
          updatedAt: new Date(),
        })
        .where(eq(quotes.id, quoteId));

      return {
        appliedCount: createdLines.length,
        skippedCount,
        lines: createdLines,
      };
    });
  }

  /**
   * Get default quote template
   */
  async getDefaultQuoteTemplate(companyId: string): Promise<(QuoteTemplate & { lines: QuoteTemplateLine[] }) | null> {
    this.assertCompanyId(companyId);

    const [template] = await db
      .select()
      .from(quoteTemplates)
      .where(
        and(
          eq(quoteTemplates.companyId, companyId),
          eq(quoteTemplates.isDefault, true),
          eq(quoteTemplates.isActive, true)
        )
      )
      .limit(1);

    if (!template) return null;

    const lines = await this.getQuoteTemplateLines(template.id);
    return { ...template, lines };
  }
}

export const quoteTemplateRepository = new QuoteTemplateRepository();
