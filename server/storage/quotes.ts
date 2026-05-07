import { db } from "../db";
import { eq, and, desc, sql, ilike, or, isNull } from "drizzle-orm";
import {
  quotes,
  quoteLines,
  clientLocations,
  customerCompanies,
  companyCounters,
  type Quote,
  type QuoteLine,
  type InsertQuote,
  type InsertQuoteLine,
} from "@shared/schema";
import { BaseRepository, clampLimit, clampOffset, escapeLike } from "./base";

interface PaginationOptions {
  limit?: number;
  offset?: number;
  search?: string;
  status?: string;
  locationId?: string;
  customerCompanyId?: string;
}

interface PaginatedResult<T> {
  items: T[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export class QuoteRepository extends BaseRepository {
  /**
   * Get paginated quotes for a company
   */
  async getQuotes(
    companyId: string,
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<Quote & { location?: any; customerCompany?: any }>> {
    this.assertCompanyId(companyId);

    const limit = clampLimit(options.limit ?? 50);
    const offset = clampOffset(options.offset ?? 0);

    // Build base conditions
    // 2026-04-26: isActive filter removed — quotes use permanent-delete now.
    const conditions = [
      eq(quotes.companyId, companyId),
    ];

    // Add status filter
    if (options.status && options.status !== "all") {
      conditions.push(eq(quotes.status, options.status));
    }

    // Scope by location or customer company
    if (options.locationId) {
      conditions.push(eq(quotes.locationId, options.locationId));
    }
    if (options.customerCompanyId) {
      conditions.push(eq(quotes.customerCompanyId, options.customerCompanyId));
    }

    // Count total
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(quotes)
      .where(and(...conditions));

    const total = countResult?.count ?? 0;

    // Fetch quotes with joins
    const rows = await db
      .select({
        quote: quotes,
        location: clientLocations,
        customerCompany: customerCompanies,
      })
      .from(quotes)
      .leftJoin(clientLocations, eq(quotes.locationId, clientLocations.id))
      .leftJoin(customerCompanies, eq(quotes.customerCompanyId, customerCompanies.id))
      .where(and(...conditions))
      .orderBy(desc(quotes.createdAt))
      .limit(limit)
      .offset(offset);

    const items = rows.map((row) => ({
      ...row.quote,
      location: row.location,
      customerCompany: row.customerCompany,
    }));

    return {
      items,
      meta: {
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
      },
    };
  }

  /**
   * Get a single quote by ID
   */
  async getQuote(companyId: string, quoteId: string): Promise<Quote | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(quoteId, "quoteId");

    const [quote] = await db
      .select()
      .from(quotes)
      .where(
        and(
          eq(quotes.id, quoteId),
          eq(quotes.companyId, companyId),
        )
      )
      .limit(1);

    return quote ?? null;
  }

  /**
   * Get quote with related data (location, customer company)
   */
  async getQuoteDetails(companyId: string, quoteId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(quoteId, "quoteId");

    const [row] = await db
      .select({
        quote: quotes,
        location: clientLocations,
        customerCompany: customerCompanies,
      })
      .from(quotes)
      .leftJoin(clientLocations, eq(quotes.locationId, clientLocations.id))
      .leftJoin(customerCompanies, eq(quotes.customerCompanyId, customerCompanies.id))
      .where(
        and(
          eq(quotes.id, quoteId),
          eq(quotes.companyId, companyId),
        )
      )
      .limit(1);

    if (!row) return null;

    const lines = await this.getQuoteLines(companyId, quoteId);

    return {
      quote: row.quote,
      lines,
      location: row.location,
      customerCompany: row.customerCompany,
    };
  }

  /**
   * Get quote line items
   */
  async getQuoteLines(companyId: string, quoteId: string): Promise<QuoteLine[]> {
    this.assertCompanyId(companyId);
    this.validateUUID(quoteId, "quoteId");

    return await db
      .select()
      .from(quoteLines)
      .where(
        and(
          eq(quoteLines.quoteId, quoteId),
          eq(quoteLines.companyId, companyId)
        )
      )
      .orderBy(quoteLines.lineNumber);
  }

  /**
   * Generate next quote number for company
   */
  private async getNextQuoteNumber(companyId: string): Promise<string> {
    // Use atomic increment pattern with upsert
    const [result] = await db
      .insert(companyCounters)
      .values({
        companyId,
        nextQuoteNumber: 1001,
      })
      .onConflictDoUpdate({
        target: companyCounters.companyId,
        set: {
          nextQuoteNumber: sql`${companyCounters.nextQuoteNumber} + 1`,
        },
      })
      .returning({ value: companyCounters.nextQuoteNumber });

    const num = result?.value ?? 1001;
    return `Q-${String(num).padStart(5, "0")}`;
  }

  /**
   * Create a new quote
   */
  async createQuote(
    companyId: string,
    data: Omit<InsertQuote, "companyId">,
    lines: Array<Partial<Omit<InsertQuoteLine, "companyId" | "quoteId">> & { description: string; lineNumber?: number }> = []
  ): Promise<Quote> {
    this.assertCompanyId(companyId);

    return await db.transaction(async (tx) => {
      // Generate quote number
      const quoteNumber = await this.getNextQuoteNumber(companyId);

      // Create quote
      const [quote] = await tx
        .insert(quotes)
        .values({
          ...data,
          companyId,
          quoteNumber,
        })
        .returning();

      // Add line items
      if (lines.length > 0) {
        await tx.insert(quoteLines).values(
          lines.map((line, index) => ({
            ...line,
            companyId,
            quoteId: quote.id,
            lineNumber: line.lineNumber ?? index + 1,
            lineItemType: line.lineItemType || "service",
          }))
        );
      }

      // Recalculate totals
      await this.recalculateTotals(tx as any, quote.id);

      // Return fresh quote
      const [freshQuote] = await tx
        .select()
        .from(quotes)
        .where(eq(quotes.id, quote.id))
        .limit(1);

      return freshQuote;
    });
  }

  /**
   * Update a quote
   */
  async updateQuote(
    companyId: string,
    quoteId: string,
    data: Partial<InsertQuote>,
    txHandle?: any,
  ): Promise<Quote | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(quoteId, "quoteId");

    const queryDb = txHandle ?? db;
    const [updated] = await queryDb
      .update(quotes)
      .set({
        ...data,
        updatedAt: new Date(),
        version: sql`${quotes.version} + 1`,
      })
      .where(
        and(
          eq(quotes.id, quoteId),
          eq(quotes.companyId, companyId),
        )
      )
      .returning();

    return updated ?? null;
  }

  /**
   * Permanent-delete a quote.
   *
   * 2026-04-26: matches the invoice permanent-delete model. Only quotes that
   * are in `draft` status AND have not been converted to a job may be
   * deleted. Returns false if the row exists but fails the precondition
   * (caller should map to 409). quote_lines and quote_notes cascade-delete
   * via their FK on quotes.id.
   */
  async deleteQuote(companyId: string, quoteId: string): Promise<boolean> {
    this.assertCompanyId(companyId);
    this.validateUUID(quoteId, "quoteId");

    const result = await db
      .delete(quotes)
      .where(
        and(
          eq(quotes.id, quoteId),
          eq(quotes.companyId, companyId),
          eq(quotes.status, "draft"),
          isNull(quotes.convertedToJobId),
        )
      )
      .returning({ id: quotes.id });

    return result.length > 0;
  }

  /**
   * Create a quote line item
   */
  async createQuoteLine(
    companyId: string,
    quoteId: string,
    data: Partial<Omit<InsertQuoteLine, "companyId" | "quoteId" | "lineNumber">> & { description: string }
  ): Promise<QuoteLine> {
    this.assertCompanyId(companyId);
    this.validateUUID(quoteId, "quoteId");

    return await db.transaction(async (tx) => {
      // Get next line number
      const [maxLine] = await tx
        .select({ max: sql<number>`COALESCE(MAX(line_number), 0)` })
        .from(quoteLines)
        .where(eq(quoteLines.quoteId, quoteId));

      const lineNumber = (maxLine?.max ?? 0) + 1;

      const [line] = await tx
        .insert(quoteLines)
        .values({
          ...data,
          companyId,
          quoteId,
          lineNumber,
          lineItemType: data.lineItemType || "service",
        })
        .returning();

      // Recalculate quote totals
      await this.recalculateTotals(tx as any, quoteId);

      return line;
    });
  }

  /**
   * Update a quote line item
   */
  async updateQuoteLine(
    companyId: string,
    quoteId: string,
    lineId: string,
    data: Partial<InsertQuoteLine>
  ): Promise<QuoteLine | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(lineId, "lineId");

    return await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(quoteLines)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(quoteLines.id, lineId),
            eq(quoteLines.quoteId, quoteId),
            eq(quoteLines.companyId, companyId)
          )
        )
        .returning();

      if (updated) {
        await this.recalculateTotals(tx as any, quoteId);
      }

      return updated ?? null;
    });
  }

  /**
   * Delete a quote line item
   */
  async deleteQuoteLine(
    companyId: string,
    quoteId: string,
    lineId: string
  ): Promise<boolean> {
    this.assertCompanyId(companyId);
    this.validateUUID(lineId, "lineId");

    return await db.transaction(async (tx) => {
      const result = await tx
        .delete(quoteLines)
        .where(
          and(
            eq(quoteLines.id, lineId),
            eq(quoteLines.quoteId, quoteId),
            eq(quoteLines.companyId, companyId)
          )
        )
        .returning();

      if (result.length > 0) {
        await this.recalculateTotals(tx as any, quoteId);
      }

      return result.length > 0;
    });
  }

  /**
   * Recalculate quote totals from line items
   */
  private async recalculateTotals(txDb: typeof db, quoteId: string) {
    const [totals] = await txDb
      .select({
        subtotal: sql<string>`COALESCE(SUM(line_subtotal::numeric), 0)::text`,
        taxTotal: sql<string>`COALESCE(SUM(tax_amount::numeric), 0)::text`,
        total: sql<string>`COALESCE(SUM(line_total::numeric), 0)::text`,
      })
      .from(quoteLines)
      .where(eq(quoteLines.quoteId, quoteId));

    await txDb
      .update(quotes)
      .set({
        subtotal: totals?.subtotal ?? "0.00",
        taxTotal: totals?.taxTotal ?? "0.00",
        total: totals?.total ?? "0.00",
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, quoteId));
  }

  /**
   * Get quote statistics
   */
  async getQuoteStats(companyId: string) {
    this.assertCompanyId(companyId);

    const rows = await db
      .select({
        status: quotes.status,
        count: sql<number>`count(*)::int`,
        total: sql<string>`COALESCE(SUM(total::numeric), 0)::text`,
      })
      .from(quotes)
      .where(eq(quotes.companyId, companyId))
      .groupBy(quotes.status);

    return rows;
  }

  /**
   * 2026-05-06 RALPH: drill-down rows for the dashboard Pipeline
   * "Stale Opportunities" modal. Returns open quotes (status IN
   * draft/sent) whose last activity (`COALESCE(updated_at, created_at)`)
   * is older than `staleDays` (default 14, matches the dashboard
   * aggregate). Joins location + customerCompany the same way `getQuotes`
   * does so the modal can render Customer / Quote # / Amount / date.
   * Excludes approved / declined / converted by definition.
   */
  async getStalePipelineQuotes(
    companyId: string,
    staleDays: number = 14,
    limit: number = 50,
  ): Promise<(Quote & { location?: any; customerCompany?: any })[]> {
    this.assertCompanyId(companyId);
    const lim = clampLimit(limit);
    const rows = await db
      .select({
        quote: quotes,
        location: clientLocations,
        customerCompany: customerCompanies,
      })
      .from(quotes)
      .leftJoin(clientLocations, eq(quotes.locationId, clientLocations.id))
      .leftJoin(customerCompanies, eq(quotes.customerCompanyId, customerCompanies.id))
      .where(
        and(
          eq(quotes.companyId, companyId),
          sql`${quotes.status} IN ('draft', 'sent')`,
          sql`COALESCE(${quotes.updatedAt}, ${quotes.createdAt}) < NOW() - (${staleDays} || ' days')::interval`,
        )
      )
      .orderBy(sql`COALESCE(${quotes.updatedAt}, ${quotes.createdAt}) ASC`)
      .limit(lim);
    return rows.map((row) => ({
      ...row.quote,
      location: row.location,
      customerCompany: row.customerCompany,
    }));
  }
}

export const quoteRepository = new QuoteRepository();
