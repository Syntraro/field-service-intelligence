import { db } from "../db";
import { eq, and, desc, ilike, inArray, isNull, isNotNull, sql, or } from "drizzle-orm";
import {
  customerCompanies, clients, jobs, invoices, quotes, contactPersons, clientParts, clientNotes,
  leads, payments, paymentAllocations, maintenanceRecords, jobVisits, recurringJobSeries, clientFiles, locationPMPlans,
  paymentDisputes, noteAttachments, jobNotes, jobNoteAttachments, invoiceNotes, invoiceNoteAttachments,
  quoteNotes, quoteNoteAttachments, leadNotes, leadNoteAttachments, locationEquipment, equipmentOcrScans, files,
  fileCleanupQueue, recurringJobTemplates, contractFiles,
} from "@shared/schema";
import type { Client } from "@shared/schema";
import { queueFileCleanupInTx, type FileCleanupEntry } from "../services/fileCleanupService";
import { BaseRepository, clampLimit, clampOffset } from "./base";
import { activeJobFilter, notDeletedClientFilter, notDeletedCustomerCompanyFilter } from "./jobFilters";
import { geocodeToLatLng } from "../utils/geocode";
import { normalizeForMatch } from "@shared/normalizeForMatch";

// Orphan location info for admin linking
export interface OrphanLocation {
  id: string;
  companyName: string | null;
  location: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  createdAt: Date;
  // Suggested match (if exactly one customer company with same name exists)
  suggestedCustomerCompanyId: string | null;
  suggestedCustomerCompanyName: string | null;
}

export interface CustomerCompanyOverview {
  company: typeof customerCompanies.$inferSelect;
  locations: Client[];
  jobs: any[];
  invoices: any[];
  stats: {
    totalLocations: number;
    openJobs: number;
    openInvoices: number;
  };
  // 2026-04-19 Fix B: canonical billing aggregates computed over the
  // FULL invoice set; UI uses these instead of deriving from the
  // truncated `invoices` list.
  billingAggregates: {
    lifetimeRevenue: string;
    paidYtd: string;
    outstanding: { count: number; total: string; overdueTotal: string };
    agingBuckets: { current: string; d30: string; d60: string; d90: string };
  } | null;
}

export interface LocationsPaginationOptions {
  limit?: number;
  offset?: number;
}

export class CustomerCompanyRepository extends BaseRepository {
  // ========================================
  // CUSTOMER COMPANY QUERIES
  // ========================================

  /**
   * List all customer companies for a tenant with canonical identity fields.
   * Used by PM wizard company picker, selectors, and any surface needing getClientDisplayName().
   */
  async listCustomerCompanies(
    companyId: string
  ): Promise<{ id: string; name: string; firstName: string | null; lastName: string | null; useCompanyAsPrimary: boolean }[]> {
    this.assertCompanyId(companyId);

    const rows = await db
      .select({
        id: customerCompanies.id,
        name: customerCompanies.name,
        firstName: customerCompanies.firstName,
        lastName: customerCompanies.lastName,
        useCompanyAsPrimary: customerCompanies.useCompanyAsPrimary,
      })
      .from(customerCompanies)
      .where(
        and(
          eq(customerCompanies.companyId, companyId),
          eq(customerCompanies.isActive, true),
          isNull(customerCompanies.deletedAt)
        )
      )
      .orderBy(customerCompanies.name);
    return rows.map(r => ({
      id: r.id,
      name: r.name ?? "",
      firstName: r.firstName,
      lastName: r.lastName,
      useCompanyAsPrimary: r.useCompanyAsPrimary,
    }));
  }

  /**
   * Get customer company by ID (tenant-scoped)
   */
  async getCustomerCompany(
    companyId: string,
    customerCompanyId: string
  ): Promise<typeof customerCompanies.$inferSelect | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");

    const [company] = await db
      .select()
      .from(customerCompanies)
      .where(
        and(
          eq(customerCompanies.id, customerCompanyId),
          eq(customerCompanies.companyId, companyId)
        )
      )
      .limit(1);

    return company ?? null;
  }

  /**
   * Find customer company by normalized name (tenant-scoped, case-insensitive).
   * Uses the indexed name_normalized column for fast dedup lookups.
   */
  async findCustomerCompanyByNormalizedName(
    companyId: string,
    normalizedName: string
  ): Promise<typeof customerCompanies.$inferSelect | null> {
    this.assertCompanyId(companyId);

    const [company] = await db
      .select()
      .from(customerCompanies)
      .where(
        and(
          eq(customerCompanies.companyId, companyId),
          eq(customerCompanies.nameNormalized, normalizedName),
          notDeletedCustomerCompanyFilter()
        )
      )
      .limit(1);

    return company ?? null;
  }

  /**
   * Create customer company (tenant-scoped)
   */
  async createCustomerCompany(
    companyId: string,
    data: {
      name?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      useCompanyAsPrimary?: boolean;
      phone?: string | null;
      email?: string | null;
      billingStreet?: string | null;
      billingStreet2?: string | null;
      billingCity?: string | null;
      billingProvince?: string | null;
      billingPostalCode?: string | null;
      billingCountry?: string | null;
      nameSource?: string | null;
    }
  ): Promise<typeof customerCompanies.$inferSelect> {
    this.assertCompanyId(companyId);

    // Normalize on the primary identity for dedup
    const matchName = data.name?.trim() || (data.firstName ? `${data.firstName} ${data.lastName || ""}`.trim() : "");

    const [company] = await db
      .insert(customerCompanies)
      .values({
        companyId,
        name: data.name ?? null,
        nameNormalized: normalizeForMatch(matchName),
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        useCompanyAsPrimary: data.useCompanyAsPrimary !== false,
        phone: data.phone ?? null,
        email: data.email ?? null,
        billingStreet: data.billingStreet ?? null,
        billingCity: data.billingCity ?? null,
        billingProvince: data.billingProvince ?? null,
        billingPostalCode: data.billingPostalCode ?? null,
        billingCountry: data.billingCountry ?? null,
        nameSource: data.nameSource ?? "company",
      })
      .returning();

    return company;
  }

  /**
   * Transaction-aware variant of createCustomerCompany.
   * Auto-sets nameNormalized. Used by CSV import for row-level transactions.
   */
  async createCustomerCompanyTx(
    tx: any,
    companyId: string,
    data: {
      name: string;
      phone?: string | null;
      email?: string | null;
      billingStreet?: string | null;
      billingStreet2?: string | null;
      billingCity?: string | null;
      billingProvince?: string | null;
      billingPostalCode?: string | null;
      billingCountry?: string | null;
      nameSource?: string | null;
    }
  ): Promise<typeof customerCompanies.$inferSelect> {
    this.assertCompanyId(companyId);

    const [company] = await tx
      .insert(customerCompanies)
      .values({
        companyId,
        name: data.name,
        nameNormalized: normalizeForMatch(data.name),
        phone: data.phone ?? null,
        email: data.email ?? null,
        billingStreet: data.billingStreet ?? null,
        billingCity: data.billingCity ?? null,
        billingProvince: data.billingProvince ?? null,
        billingPostalCode: data.billingPostalCode ?? null,
        billingCountry: data.billingCountry ?? null,
        nameSource: data.nameSource ?? "company",
      })
      .returning();

    return company;
  }

  /**
   * Update customer company fields (tenant-scoped).
   * Only updates fields that are explicitly provided.
   */
  async updateCustomerCompany(
    companyId: string,
    customerCompanyId: string,
    data: {
      name?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      useCompanyAsPrimary?: boolean;
      phone?: string | null;
      email?: string | null;
      billingStreet?: string | null;
      billingStreet2?: string | null;
      billingCity?: string | null;
      billingProvince?: string | null;
      billingPostalCode?: string | null;
      billingCountry?: string | null;
      nameSource?: string | null;
      isActive?: boolean;
      // 2026-05-07: per-client invoice payment-terms default. NULL =
      // inherit from companies.defaultPaymentTermsDays.
      paymentTermsDays?: number | null;
    }
  ): Promise<typeof customerCompanies.$inferSelect | null> {
    this.assertCompanyId(companyId);

    // Recompute nameNormalized when name or identity changes
    const updateData: Record<string, unknown> = { ...data };
    if (data.name !== undefined || data.firstName !== undefined) {
      const matchName = (data.name ?? "").trim() || ((data.firstName ?? "") + " " + (data.lastName ?? "")).trim();
      updateData.nameNormalized = normalizeForMatch(matchName);
    }

    const [updated] = await db
      .update(customerCompanies)
      .set(updateData)
      .where(
        and(
          eq(customerCompanies.id, customerCompanyId),
          eq(customerCompanies.companyId, companyId),
          notDeletedCustomerCompanyFilter(),
        )
      )
      .returning();

    return updated ?? null;
  }

  /**
   * Canonical create-or-get for customer companies.
   *
   * 2026-04-19 (Customer Data Integrity pass): tenant-scoped, case-insensitive
   * dedupe on the existing `name_normalized` column (already populated by
   * every write path via `normalizeForMatch`). Lookup is scoped to
   * `is_active = true` so deactivated companies don't shadow new creates.
   * No `deleted_at` logic is introduced here — soft-delete is being phased
   * out per architectural direction. Existing soft-deleted rows already
   * carry `is_active = false` (set by the same code path), so they are
   * naturally excluded from both the lookup and the matching partial
   * unique index in `2026_04_19_customer_data_unique_indexes.sql`.
   *
   * Returns `{customerCompany, created}` so callers can distinguish
   * insert-vs-match without a second lookup. `findOrCreateCustomerCompany`
   * (the historical name) delegates to this method and preserves its
   * single-row return shape for backward compat with existing call sites.
   */
  async createOrGetCustomerCompany(
    companyId: string,
    data: {
      name?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      useCompanyAsPrimary?: boolean;
      phone?: string | null;
      email?: string | null;
      billingStreet?: string | null;
      billingStreet2?: string | null;
      billingCity?: string | null;
      billingProvince?: string | null;
      billingPostalCode?: string | null;
      billingCountry?: string | null;
      nameSource?: string | null;
    }
  ): Promise<{ customerCompany: typeof customerCompanies.$inferSelect; created: boolean }> {
    this.assertCompanyId(companyId);

    const matchName = data.name?.trim() || (data.firstName ? `${data.firstName} ${data.lastName || ""}`.trim() : "");
    const normalized = normalizeForMatch(matchName);
    if (normalized) {
      const [existing] = await db
        .select()
        .from(customerCompanies)
        .where(
          and(
            eq(customerCompanies.companyId, companyId),
            eq(customerCompanies.nameNormalized, normalized),
            eq(customerCompanies.isActive, true),
          )
        )
        .limit(1);
      if (existing) return { customerCompany: existing, created: false };
    }

    const created = await this.createCustomerCompany(companyId, data);
    return { customerCompany: created, created: true };
  }

  /**
   * Backward-compat alias. New callers should use `createOrGetCustomerCompany`
   * to access the `{customerCompany, created}` discriminator.
   */
  async findOrCreateCustomerCompany(
    companyId: string,
    data: Parameters<CustomerCompanyRepository["createOrGetCustomerCompany"]>[1],
  ): Promise<typeof customerCompanies.$inferSelect> {
    const { customerCompany } = await this.createOrGetCustomerCompany(companyId, data);
    return customerCompany;
  }

  /**
   * Transaction variant of `createOrGetCustomerCompany`. Same dedupe
   * semantics — `(companyId, name_normalized, is_active = true)` — but
   * the lookup + insert both run on the caller-provided `tx`, so the
   * CSV importer sees its own uncommitted sibling rows correctly.
   *
   * 2026-04-20: added for the CSV import refactor. Matches the shape of
   * `clientRepository.createOrGetLocationTx` and
   * `clientContactRepository.createOrGetPersonTx`.
   */
  async createOrGetCustomerCompanyTx(
    tx: any,
    companyId: string,
    data: Parameters<CustomerCompanyRepository["createOrGetCustomerCompany"]>[1],
  ): Promise<{ customerCompany: typeof customerCompanies.$inferSelect; created: boolean }> {
    this.assertCompanyId(companyId);

    const matchName = data.name?.trim() || (data.firstName ? `${data.firstName} ${data.lastName || ""}`.trim() : "");
    const normalized = normalizeForMatch(matchName);
    if (normalized) {
      const rows: Array<typeof customerCompanies.$inferSelect> = await tx
        .select()
        .from(customerCompanies)
        .where(
          and(
            eq(customerCompanies.companyId, companyId),
            eq(customerCompanies.nameNormalized, normalized),
            eq(customerCompanies.isActive, true),
          )
        )
        .limit(1);
      if (rows[0]) return { customerCompany: rows[0], created: false };
    }

    const created = await this.createCustomerCompanyTx(tx, companyId, {
      name: matchName,
      phone: data.phone ?? null,
      email: data.email ?? null,
      billingStreet: data.billingStreet ?? null,
      billingStreet2: data.billingStreet2 ?? null,
      billingCity: data.billingCity ?? null,
      billingProvince: data.billingProvince ?? null,
      billingPostalCode: data.billingPostalCode ?? null,
      billingCountry: data.billingCountry ?? null,
      nameSource: data.nameSource ?? null,
    });
    return { customerCompany: created, created: true };
  }

  // ========================================
  // LOCATION QUERIES (clients under customer companies)
  // ========================================

  /**
   * Get locations for a customer company with pagination (tenant-scoped)
   */
  async getCustomerCompanyLocations(
    companyId: string,
    customerCompanyId: string,
    options: LocationsPaginationOptions = {}
  ): Promise<{ items: Client[]; hasMore: boolean; nextOffset?: number }> {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");

    // Verify customer company exists and belongs to tenant
    const company = await this.getCustomerCompany(companyId, customerCompanyId);
    if (!company) {
      throw this.notFoundError("Customer company");
    }

    const limit = clampLimit(options.limit ?? 50, 200);
    const offset = clampOffset(options.offset ?? 0);

    // Fetch LIMIT + 1 to determine hasMore
    // Filter out soft-deleted locations
    const locations = await db
      .select()
      .from(clients)
      .where(
        and(
          eq(clients.companyId, companyId),
          eq(clients.parentCompanyId, customerCompanyId),
          notDeletedClientFilter()
        )
      )
      .orderBy(desc(clients.createdAt))
      .limit(limit + 1)
      .offset(offset);

    const hasMore = locations.length > limit;
    const items = hasMore ? locations.slice(0, limit) : locations;

    return {
      items,
      hasMore,
      nextOffset: hasMore ? offset + limit : undefined,
    };
  }

  /**
   * Get all locations for a customer company (no pagination, for aggregation)
   */
  async getAllCustomerCompanyLocations(
    companyId: string,
    customerCompanyId: string
  ): Promise<Client[]> {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");

    return await db
      .select()
      .from(clients)
      .where(
        and(
          eq(clients.companyId, companyId),
          eq(clients.parentCompanyId, customerCompanyId),
          notDeletedClientFilter()
        )
      )
      .orderBy(desc(clients.createdAt));
  }

  /**
   * Get locations by company name (for legacy migration/linking)
   */
  async getLocationsByCompanyName(
    companyId: string,
    companyName: string
  ): Promise<Client[]> {
    this.assertCompanyId(companyId);

    return await db
      .select()
      .from(clients)
      .where(
        and(
          eq(clients.companyId, companyId),
          eq(clients.companyName, companyName),
          notDeletedClientFilter()
        )
      )
      .orderBy(desc(clients.createdAt));
  }

  /**
   * Get unlinked locations by company name (parentCompanyId IS NULL).
   *
   * 2026-04-14: case-insensitive match on `companyName`. Previously used
   * `eq()` which is case-sensitive in Postgres; tenants whose legacy
   * rows had variant casing (e.g. "Basil HVAC" and "basil hvac") failed
   * to auto-link, leaving Client Detail empty. Matches the existing
   * project convention — `ilike()` is already used across
   * `server/storage/clients.ts` for name comparisons.
   */
  async getOrphanLocationsByCompanyName(
    companyId: string,
    companyName: string
  ): Promise<Array<{ id: string; isPrimary: boolean | null; createdAt: Date | null }>> {
    this.assertCompanyId(companyId);

    const rows = await db
      .select({
        id: clients.id,
        isPrimary: clients.isPrimary,
        createdAt: clients.createdAt,
      })
      .from(clients)
      .where(
        and(
          eq(clients.companyId, companyId),
          // Case-insensitive exact match — no wildcards.
          ilike(clients.companyName, companyName),
          // CRITICAL: Must use isNull() for NULL comparison, not eq(col, null)
          isNull(clients.parentCompanyId),
          notDeletedClientFilter()
        )
      );

    return rows;
  }

  /**
   * Link locations to customer company (batch update in transaction)
   * Sets parentCompanyId and isPrimary flag
   */
  async linkLocationsToCustomerCompany(
    companyId: string,
    customerCompanyId: string,
    locationUpdates: Array<{ id: string; isPrimary: boolean }>
  ): Promise<void> {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");

    if (locationUpdates.length === 0) return;

    await db.transaction(async (tx) => {
      for (const update of locationUpdates) {
        await tx
          .update(clients)
          .set({
            parentCompanyId: customerCompanyId,
            isPrimary: update.isPrimary,
          })
          .where(
            and(eq(clients.id, update.id), eq(clients.companyId, companyId))
          );
      }
    });
  }

  /**
   * Set location as primary (clears other locations' isPrimary flag)
   */
  async setLocationAsPrimary(
    companyId: string,
    parentCompanyId: string,
    locationId: string
  ): Promise<void> {
    this.assertCompanyId(companyId);
    this.validateUUID(parentCompanyId, "parentCompanyId");
    this.validateUUID(locationId, "locationId");

    await db.transaction(async (tx) => {
      // Clear isPrimary on all locations with same parentCompanyId AND companyId
      await tx
        .update(clients)
        .set({ isPrimary: false })
        .where(
          and(
            eq(clients.companyId, companyId),
            eq(clients.parentCompanyId, parentCompanyId)
          )
        );

      // Set this location as primary
      await tx
        .update(clients)
        .set({ isPrimary: true })
        .where(and(eq(clients.id, locationId), eq(clients.companyId, companyId)));
    });
  }

  // 2026-04-20: createLocationUnderCustomerCompany (+ Tx variant) deleted.
  // Zero callers after the canonical createOrGetLocation(Tx) migration.
  // Location creation under a customer company now goes through
  // `clientRepository.createOrGetLocation(Tx)` (accessed via
  // `storage.createOrGetLocation` or the repo directly in transaction
  // contexts). The parent customer-company's `name` inheritance the old
  // helper performed is now the caller's responsibility (they pass
  // `companyName` on the InsertClient payload — see the wired routes in
  // `server/routes/customer-companies.ts` for the pattern).

  // ========================================
  // OVERVIEW / AGGREGATION QUERIES
  // ========================================

  /**
   * Get customer company overview with jobs and invoices
   * Aggregates data through locationIds (schema-correct)
   */
  async getCustomerCompanyOverview(
    companyId: string,
    customerCompanyId: string
  ): Promise<CustomerCompanyOverview | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");

    // Get customer company
    const company = await this.getCustomerCompany(companyId, customerCompanyId);
    if (!company) return null;

    // Get all locations
    const locations = await this.getAllCustomerCompanyLocations(
      companyId,
      customerCompanyId
    );

    const locationIds = locations.map((l) => l.id).filter(Boolean);

    // Get jobs and invoices through locationIds (limited to 100 for performance)
    // Bug fix: apply activeJobFilter() to exclude soft-deleted jobs (deletedAt IS NULL, isActive = true)
    // 2026-04-19 Fix B: billing aggregates computed over the FULL
    // invoice set in parallel with the truncated list reads.
    const [jobsList, invoicesList, aggregates] = await Promise.all([
      locationIds.length === 0
        ? []
        : db
            .select()
            .from(jobs)
            .where(
              and(
                eq(jobs.companyId, companyId),
                inArray(jobs.locationId, locationIds),
                activeJobFilter()
              )
            )
            .orderBy(desc(jobs.createdAt))
            .limit(100),
      locationIds.length === 0
        ? []
        : db
            .select()
            .from(invoices)
            .where(
              and(
                eq(invoices.companyId, companyId),
                inArray(invoices.locationId, locationIds)
              )
            )
            .orderBy(desc(invoices.createdAt))
            .limit(100),
      this.getBillingAggregatesForLocations(companyId, locationIds),
    ]);

    // Calculate stats
    // Using normalized 4-status model: open, completed, invoiced, archived
    // Only "open" status jobs count as active
    const stats = {
      totalLocations: locations.length,
      openJobs: jobsList.filter((j: any) => j.status === "open").length,
      openInvoices: invoicesList.filter(
        (i: any) => i.status !== "paid" && i.status !== "void"
      ).length,
    };

    return {
      company,
      locations,
      jobs: jobsList,
      invoices: invoicesList,
      stats,
      billingAggregates: aggregates,
    };
  }

  /**
   * Get jobs and invoices for a set of location IDs (tenant-scoped)
   * Used by client overview endpoint
   */
  async getJobsAndInvoicesForLocations(
    companyId: string,
    locationIds: string[],
    limit = 100
  ): Promise<{ jobs: any[]; invoices: any[] }> {
    this.assertCompanyId(companyId);

    if (locationIds.length === 0) {
      return { jobs: [], invoices: [] };
    }

    // Bug fix: apply activeJobFilter() to exclude soft-deleted jobs
    const [jobsList, invoicesList] = await Promise.all([
      db
        .select()
        .from(jobs)
        .where(
          and(eq(jobs.companyId, companyId), inArray(jobs.locationId, locationIds), activeJobFilter())
        )
        .orderBy(desc(jobs.createdAt))
        .limit(limit),
      db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.companyId, companyId),
            inArray(invoices.locationId, locationIds)
          )
        )
        .orderBy(desc(invoices.createdAt))
        .limit(limit),
    ]);

    return { jobs: jobsList, invoices: invoicesList };
  }

  /**
   * 2026-04-19 Fix B: canonical billing aggregates over the FULL invoice
   * set for a client's locations — computed server-side so the overview
   * totals (outstanding, past-due, aging buckets, lifetime revenue,
   * paid-YTD) are correct even when the UI list is paginated/truncated.
   *
   * All amounts are returned as numeric strings (same convention as the
   * other money fields) to avoid float drift on large ledgers.
   */
  async getBillingAggregatesForLocations(
    companyId: string,
    locationIds: string[],
  ): Promise<{
    lifetimeRevenue: string;
    paidYtd: string;
    outstanding: { count: number; total: string; overdueTotal: string };
    agingBuckets: { current: string; d30: string; d60: string; d90: string };
  }> {
    this.assertCompanyId(companyId);

    if (locationIds.length === 0) {
      const zero = "0.00";
      return {
        lifetimeRevenue: zero,
        paidYtd: zero,
        outstanding: { count: 0, total: zero, overdueTotal: zero },
        agingBuckets: { current: zero, d30: zero, d60: zero, d90: zero },
      };
    }

    // Canonical unpaid statuses must match `UNPAID_INVOICE_STATUSES` in
    // `@shared/invoiceStatus`. Inlined here as a SQL fragment to keep
    // this aggregate a single round-trip.
    const unpaidSql = sql.raw("'awaiting_payment', 'sent', 'partial_paid'");
    const ytdStart = `${new Date().getUTCFullYear()}-01-01`;

    // Single query covering every aggregate the client overview needs.
    // SUM(balance) for outstanding / aging to match the canonical A/R
    // math; SUM(total) for paid rows since balance is 0 on paid.
    const [row] = await db
      .select({
        lifetimeRevenue: sql<string>`COALESCE(SUM(CAST(${invoices.total} AS numeric)) FILTER (WHERE ${invoices.status} = 'paid'), 0)::text`,
        paidYtd: sql<string>`COALESCE(SUM(CAST(${invoices.total} AS numeric)) FILTER (
          WHERE ${invoices.status} = 'paid' AND ${invoices.issueDate} >= ${ytdStart}
        ), 0)::text`,
        outstandingCount: sql<number>`COUNT(*) FILTER (WHERE ${invoices.status} IN (${unpaidSql}))::int`,
        outstandingTotal: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)) FILTER (
          WHERE ${invoices.status} IN (${unpaidSql})
        ), 0)::text`,
        overdueTotal: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)) FILTER (
          WHERE ${invoices.status} IN (${unpaidSql})
            AND ${invoices.dueDate} IS NOT NULL
            AND ${invoices.dueDate} < CURRENT_DATE
        ), 0)::text`,
        agingCurrent: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)) FILTER (
          WHERE ${invoices.status} IN (${unpaidSql})
            AND (${invoices.dueDate} IS NULL OR ${invoices.dueDate} >= CURRENT_DATE)
        ), 0)::text`,
        aging30: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)) FILTER (
          WHERE ${invoices.status} IN (${unpaidSql})
            AND ${invoices.dueDate} < CURRENT_DATE
            AND ${invoices.dueDate} >= CURRENT_DATE - INTERVAL '30 days'
        ), 0)::text`,
        aging60: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)) FILTER (
          WHERE ${invoices.status} IN (${unpaidSql})
            AND ${invoices.dueDate} < CURRENT_DATE - INTERVAL '30 days'
            AND ${invoices.dueDate} >= CURRENT_DATE - INTERVAL '60 days'
        ), 0)::text`,
        aging90: sql<string>`COALESCE(SUM(CAST(${invoices.balance} AS numeric)) FILTER (
          WHERE ${invoices.status} IN (${unpaidSql})
            AND ${invoices.dueDate} < CURRENT_DATE - INTERVAL '60 days'
        ), 0)::text`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          inArray(invoices.locationId, locationIds),
        ),
      );

    return {
      lifetimeRevenue: row?.lifetimeRevenue ?? "0",
      paidYtd: row?.paidYtd ?? "0",
      outstanding: {
        count: Number(row?.outstandingCount ?? 0),
        total: row?.outstandingTotal ?? "0",
        overdueTotal: row?.overdueTotal ?? "0",
      },
      agingBuckets: {
        current: row?.agingCurrent ?? "0",
        d30: row?.aging30 ?? "0",
        d60: row?.aging60 ?? "0",
        d90: row?.aging90 ?? "0",
      },
    };
  }

  // ========================================
  // ORPHAN LOCATION MANAGEMENT
  // ========================================

  /**
   * Get all orphan locations (parentCompanyId IS NULL) for a tenant
   * Includes suggested matches when exactly one customer company matches by name
   */
  async getOrphanLocations(companyId: string): Promise<OrphanLocation[]> {
    this.assertCompanyId(companyId);

    // Get all locations with parentCompanyId IS NULL
    const orphans = await db
      .select({
        id: clients.id,
        companyName: clients.companyName,
        location: clients.location,
        address: clients.address,
        city: clients.city,
        province: clients.province,
        createdAt: clients.createdAt,
      })
      .from(clients)
      .where(
        and(
          eq(clients.companyId, companyId),
          isNull(clients.parentCompanyId)
        )
      )
      .orderBy(desc(clients.createdAt));

    if (orphans.length === 0) return [];

    // Get all customer companies for potential matching
    const allCustomerCompanies = await db
      .select({
        id: customerCompanies.id,
        name: customerCompanies.name,
      })
      .from(customerCompanies)
      .where(
        and(
          eq(customerCompanies.companyId, companyId),
          notDeletedCustomerCompanyFilter()
        )
      );

    // Build name -> companies map for exact matching
    const nameToCompanies = new Map<string, { id: string; name: string }[]>();
    for (const cc of allCustomerCompanies) {
      const key = (cc.name ?? "").toLowerCase().trim();
      if (!nameToCompanies.has(key)) {
        nameToCompanies.set(key, []);
      }
      nameToCompanies.get(key)!.push({ id: cc.id, name: cc.name ?? "" });
    }

    // Map orphans with suggested matches (only if exactly one match)
    return orphans.map((orphan) => {
      const key = (orphan.companyName ?? "").toLowerCase().trim();
      const matches = nameToCompanies.get(key) || [];

      // Only suggest if exactly ONE match (avoid ambiguity)
      const suggestion = matches.length === 1 ? matches[0] : null;

      return {
        id: orphan.id,
        companyName: orphan.companyName,
        location: orphan.location,
        address: orphan.address,
        city: orphan.city,
        province: orphan.province,
        createdAt: orphan.createdAt,
        suggestedCustomerCompanyId: suggestion?.id ?? null,
        suggestedCustomerCompanyName: suggestion?.name ?? null,
      };
    });
  }

  /**
   * Link a single location to a customer company
   * Safe: validates both records belong to the same tenant
   */
  async linkLocationToCustomerCompany(
    companyId: string,
    locationId: string,
    customerCompanyId: string
  ): Promise<Client> {
    this.assertCompanyId(companyId);
    this.validateUUID(locationId, "locationId");
    this.validateUUID(customerCompanyId, "customerCompanyId");

    // Verify customer company exists and belongs to tenant
    const company = await this.getCustomerCompany(companyId, customerCompanyId);
    if (!company) {
      throw this.notFoundError("Customer company");
    }

    // Verify location exists and belongs to tenant
    const [existingLocation] = await db
      .select()
      .from(clients)
      .where(
        and(
          eq(clients.id, locationId),
          eq(clients.companyId, companyId)
        )
      )
      .limit(1);

    if (!existingLocation) {
      throw this.notFoundError("Location");
    }

    // Check if already linked to a different company
    if (existingLocation.parentCompanyId && existingLocation.parentCompanyId !== customerCompanyId) {
      throw this.validationError(
        "Location is already linked to a different customer company"
      );
    }

    // Link the location (set parentCompanyId and optionally update companyName to match)
    const [updated] = await db
      .update(clients)
      .set({
        parentCompanyId: customerCompanyId,
        // Sync companyName to match customer company name for consistency
        companyName: company.name,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(clients.id, locationId),
          eq(clients.companyId, companyId)
        )
      )
      .returning();

    return updated;
  }

  /**
   * Get count of orphan locations for a tenant (for admin dashboard)
   */
  async getOrphanLocationCount(companyId: string): Promise<number> {
    this.assertCompanyId(companyId);

    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(clients)
      .where(
        and(
          eq(clients.companyId, companyId),
          isNull(clients.parentCompanyId)
        )
      );

    return Number(result?.count || 0);
  }

  // ========================================
  // DELETION — impact counts, cascade delete, soft delete/archive
  // ========================================

  /** Counts of records that would be permanently deleted for a given customer company. */
  async getCompanyDeleteImpact(
    companyId: string,
    customerCompanyId: string
  ): Promise<{
    locationCount: number; jobs: number; visits: number; invoices: number;
    quotes: number; leads: number; servicePlans: number; recurringJobs: number;
    notes: number; files: number; maintenanceRecords: number;
  }> {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");

    const locationRows = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.companyId, companyId), eq(clients.parentCompanyId, customerCompanyId)));
    const locationIds = locationRows.map(r => r.id);

    if (locationIds.length === 0) {
      return { locationCount: 0, jobs: 0, visits: 0, invoices: 0, quotes: 0, leads: 0, servicePlans: 0, recurringJobs: 0, notes: 0, files: 0, maintenanceRecords: 0 };
    }

    const [
      [jobRow], [visitRow], [invRow], [quoteRow], [leadRow],
      [planRow], [recurRow], [noteRow], [fileRow], [maintRow],
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(jobs)
        .where(and(eq(jobs.companyId, companyId), inArray(jobs.locationId, locationIds))),
      db.select({ count: sql<number>`count(*)` }).from(jobVisits)
        .innerJoin(jobs, eq(jobs.id, jobVisits.jobId))
        .where(and(eq(jobs.companyId, companyId), inArray(jobs.locationId, locationIds))),
      db.select({ count: sql<number>`count(*)` }).from(invoices)
        .where(and(eq(invoices.companyId, companyId), inArray(invoices.locationId, locationIds))),
      db.select({ count: sql<number>`count(*)` }).from(quotes)
        .where(and(eq(quotes.companyId, companyId), inArray(quotes.locationId, locationIds))),
      db.select({ count: sql<number>`count(*)` }).from(leads)
        .where(and(eq(leads.companyId, companyId), inArray(leads.locationId, locationIds))),
      db.select({ count: sql<number>`count(*)` }).from(locationPMPlans)
        .where(and(eq(locationPMPlans.companyId, companyId), inArray(locationPMPlans.locationId, locationIds))),
      db.select({ count: sql<number>`count(*)` }).from(recurringJobSeries)
        .where(and(eq(recurringJobSeries.companyId, companyId), inArray(recurringJobSeries.locationId, locationIds))),
      db.select({ count: sql<number>`count(*)` }).from(clientNotes)
        .where(and(eq(clientNotes.companyId, companyId), inArray(clientNotes.locationId, locationIds))),
      db.select({ count: sql<number>`count(*)` }).from(clientFiles)
        .where(and(eq(clientFiles.companyId, companyId), inArray(clientFiles.clientId, locationIds))),
      db.select({ count: sql<number>`count(*)` }).from(maintenanceRecords)
        .where(and(eq(maintenanceRecords.companyId, companyId), inArray(maintenanceRecords.locationId, locationIds))),
    ]);

    return {
      locationCount: locationIds.length,
      jobs: Number(jobRow.count),
      visits: Number(visitRow.count),
      invoices: Number(invRow.count),
      quotes: Number(quoteRow.count),
      leads: Number(leadRow.count),
      servicePlans: Number(planRow.count),
      recurringJobs: Number(recurRow.count),
      notes: Number(noteRow.count),
      files: Number(fileRow.count),
      maintenanceRecords: Number(maintRow.count),
    };
  }

  /** Counts of records that would be permanently deleted for a single location. */
  async getLocationDeleteImpact(
    companyId: string,
    locationId: string
  ): Promise<{
    jobs: number; visits: number; invoices: number; quotes: number;
    leads: number; servicePlans: number; recurringJobs: number;
    notes: number; files: number; maintenanceRecords: number;
  }> {
    this.assertCompanyId(companyId);
    this.validateUUID(locationId, "locationId");

    const [
      [jobRow], [visitRow], [invRow], [quoteRow], [leadRow],
      [planRow], [recurRow], [noteRow], [fileRow], [maintRow],
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(jobs)
        .where(and(eq(jobs.companyId, companyId), eq(jobs.locationId, locationId))),
      db.select({ count: sql<number>`count(*)` }).from(jobVisits)
        .innerJoin(jobs, eq(jobs.id, jobVisits.jobId))
        .where(and(eq(jobs.companyId, companyId), eq(jobs.locationId, locationId))),
      db.select({ count: sql<number>`count(*)` }).from(invoices)
        .where(and(eq(invoices.companyId, companyId), eq(invoices.locationId, locationId))),
      db.select({ count: sql<number>`count(*)` }).from(quotes)
        .where(and(eq(quotes.companyId, companyId), eq(quotes.locationId, locationId))),
      db.select({ count: sql<number>`count(*)` }).from(leads)
        .where(and(eq(leads.companyId, companyId), eq(leads.locationId, locationId))),
      db.select({ count: sql<number>`count(*)` }).from(locationPMPlans)
        .where(and(eq(locationPMPlans.companyId, companyId), eq(locationPMPlans.locationId, locationId))),
      db.select({ count: sql<number>`count(*)` }).from(recurringJobSeries)
        .where(and(eq(recurringJobSeries.companyId, companyId), eq(recurringJobSeries.locationId, locationId))),
      db.select({ count: sql<number>`count(*)` }).from(clientNotes)
        .where(and(eq(clientNotes.companyId, companyId), eq(clientNotes.locationId, locationId))),
      db.select({ count: sql<number>`count(*)` }).from(clientFiles)
        .where(and(eq(clientFiles.companyId, companyId), eq(clientFiles.clientId, locationId))),
      db.select({ count: sql<number>`count(*)` }).from(maintenanceRecords)
        .where(and(eq(maintenanceRecords.companyId, companyId), eq(maintenanceRecords.locationId, locationId))),
    ]);

    return {
      jobs: Number(jobRow.count),
      visits: Number(visitRow.count),
      invoices: Number(invRow.count),
      quotes: Number(quoteRow.count),
      leads: Number(leadRow.count),
      servicePlans: Number(planRow.count),
      recurringJobs: Number(recurRow.count),
      notes: Number(noteRow.count),
      files: Number(fileRow.count),
      maintenanceRecords: Number(maintRow.count),
    };
  }

  /**
   * Check whether a customer company can be hard-deleted.
   * Returns { canHardDelete, reasons[] } where reasons lists blocking dependencies.
   */
  async checkCompanyDeleteEligibility(
    companyId: string,
    customerCompanyId: string
  ): Promise<{ canHardDelete: boolean; reasons: string[]; locationCount: number }> {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");

    const company = await this.getCustomerCompany(companyId, customerCompanyId);
    if (!company) throw this.notFoundError("Customer company");

    // Get all location IDs (including soft-deleted) under this company
    const locationRows = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.companyId, companyId), eq(clients.parentCompanyId, customerCompanyId)));
    const locationIds = locationRows.map(r => r.id);
    const reasons: string[] = [];

    if (locationIds.length > 0) {
      // Check jobs (any status, including soft-deleted — history exists)
      const [jobCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(jobs)
        .where(and(eq(jobs.companyId, companyId), inArray(jobs.locationId, locationIds)));
      if (Number(jobCount.count) > 0) reasons.push(`${jobCount.count} job(s) exist`);

      // Check invoices
      const [invCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(invoices)
        .where(and(eq(invoices.companyId, companyId), inArray(invoices.locationId, locationIds)));
      if (Number(invCount.count) > 0) reasons.push(`${invCount.count} invoice(s) exist`);

      // Check quotes
      const [quoteCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(quotes)
        .where(and(eq(quotes.companyId, companyId), inArray(quotes.locationId, locationIds)));
      if (Number(quoteCount.count) > 0) reasons.push(`${quoteCount.count} quote(s) exist`);
    }

    // Check QBO sync — synced companies should not be hard-deleted
    if (company.qboCustomerId) {
      reasons.push("Synced with QuickBooks Online");
    }

    return { canHardDelete: reasons.length === 0, reasons, locationCount: locationIds.length };
  }

  /**
   * Hard-delete a customer company and all child records.
   * ONLY call after checkCompanyDeleteEligibility confirms canHardDelete=true.
   * Cascade FKs handle: clientContacts, clientTagAssignments, clientNotes (via customerCompanyId).
   * Locations must be deleted first (they have RESTRICT FKs on jobs/invoices but we verified none exist).
   */
  async hardDeleteCustomerCompany(
    companyId: string,
    customerCompanyId: string
  ): Promise<boolean> {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");

    return await db.transaction(async (tx) => {
      // Get all location IDs under this company
      const locationRows = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.companyId, companyId), eq(clients.parentCompanyId, customerCompanyId)));

      // Hard-delete clientParts for each location (no cascade FK, uses RESTRICT)
      for (const loc of locationRows) {
        await tx.delete(clientParts).where(
          and(eq(clientParts.companyId, companyId), eq(clientParts.locationId, loc.id))
        );
      }

      // Hard-delete client notes that reference these locations (RESTRICT FK)
      for (const loc of locationRows) {
        await tx.delete(clientNotes).where(
          and(eq(clientNotes.companyId, companyId), eq(clientNotes.locationId, loc.id))
        );
      }

      // Hard-delete all locations (CASCADE handles: locationEquipment, locationPMPlans,
      // locationPMPartTemplates, locationTagAssignments, location-level clientContacts)
      for (const loc of locationRows) {
        await tx.delete(clients).where(
          and(eq(clients.id, loc.id), eq(clients.companyId, companyId))
        );
      }

      // Hard-delete customer company (CASCADE handles: company-level clientContacts,
      // clientTagAssignments, company-level clientNotes)
      const deleted = await tx
        .delete(customerCompanies)
        .where(and(eq(customerCompanies.id, customerCompanyId), eq(customerCompanies.companyId, companyId)))
        .returning();

      return deleted.length > 0;
    });
  }

  /**
   * Fully cascade-delete a single location and all owned records.
   * Call inside an existing transaction. Handles FK order:
   *   payments/allocations → invoices → jobs → quotes → leads →
   *   maintenance_records → client_parts → client_notes → location (cascade rest)
   *
   * Orphaned after delete (known limitation): `files` metadata rows and any
   * cloud storage objects (R2/local) that were referenced by client_files or
   * equipment_ocr_scans. These require a separate async cleanup job.
   */
  /**
   * Collects all file refs attached to a location and its child entities.
   * Called before cascade deletes so attachment join rows still exist.
   */
  private async collectLocationFileRefs(
    tx: typeof db,
    companyId: string,
    locationId: string,
    invoiceIds: string[],
    jobIds: string[],
    quoteIds: string[],
    leadIds: string[],
  ): Promise<FileCleanupEntry[]> {
    const fileIdSet = new Set<string>();

    // 1. Client notes → note_attachments
    const clientNoteRows = await (tx as any)
      .select({ id: clientNotes.id })
      .from(clientNotes)
      .where(and(
        eq(clientNotes.companyId, companyId),
        or(eq(clientNotes.locationId, locationId), eq(clientNotes.clientId, locationId)),
      ));
    const clientNoteIds: string[] = clientNoteRows.map((r: any) => r.id);
    if (clientNoteIds.length > 0) {
      const rows = await (tx as any)
        .select({ fileId: noteAttachments.fileId })
        .from(noteAttachments)
        .where(inArray(noteAttachments.noteId, clientNoteIds));
      rows.forEach((r: any) => fileIdSet.add(r.fileId));
    }

    // 2. Job notes → job_note_attachments
    if (jobIds.length > 0) {
      const jnRows = await (tx as any)
        .select({ id: jobNotes.id })
        .from(jobNotes)
        .where(inArray(jobNotes.jobId, jobIds));
      const jnIds: string[] = jnRows.map((r: any) => r.id);
      if (jnIds.length > 0) {
        const rows = await (tx as any)
          .select({ fileId: jobNoteAttachments.fileId })
          .from(jobNoteAttachments)
          .where(inArray(jobNoteAttachments.noteId, jnIds));
        rows.forEach((r: any) => fileIdSet.add(r.fileId));
      }
    }

    // 3. Invoice notes → invoice_note_attachments
    if (invoiceIds.length > 0) {
      const inRows = await (tx as any)
        .select({ id: invoiceNotes.id })
        .from(invoiceNotes)
        .where(inArray(invoiceNotes.invoiceId, invoiceIds));
      const inIds: string[] = inRows.map((r: any) => r.id);
      if (inIds.length > 0) {
        const rows = await (tx as any)
          .select({ fileId: invoiceNoteAttachments.fileId })
          .from(invoiceNoteAttachments)
          .where(inArray(invoiceNoteAttachments.noteId, inIds));
        rows.forEach((r: any) => fileIdSet.add(r.fileId));
      }
    }

    // 4. Quote notes → quote_note_attachments
    if (quoteIds.length > 0) {
      const qnRows = await (tx as any)
        .select({ id: quoteNotes.id })
        .from(quoteNotes)
        .where(inArray(quoteNotes.quoteId, quoteIds));
      const qnIds: string[] = qnRows.map((r: any) => r.id);
      if (qnIds.length > 0) {
        const rows = await (tx as any)
          .select({ fileId: quoteNoteAttachments.fileId })
          .from(quoteNoteAttachments)
          .where(inArray(quoteNoteAttachments.noteId, qnIds));
        rows.forEach((r: any) => fileIdSet.add(r.fileId));
      }
    }

    // 5. Lead notes → lead_note_attachments
    if (leadIds.length > 0) {
      const lnRows = await (tx as any)
        .select({ id: leadNotes.id })
        .from(leadNotes)
        .where(inArray(leadNotes.leadId, leadIds));
      const lnIds: string[] = lnRows.map((r: any) => r.id);
      if (lnIds.length > 0) {
        const rows = await (tx as any)
          .select({ fileId: leadNoteAttachments.fileId })
          .from(leadNoteAttachments)
          .where(inArray(leadNoteAttachments.noteId, lnIds));
        rows.forEach((r: any) => fileIdSet.add(r.fileId));
      }
    }

    // 6. Client files (location documents)
    const cfRows = await (tx as any)
      .select({ fileId: clientFiles.fileId })
      .from(clientFiles)
      .where(and(eq(clientFiles.companyId, companyId), eq(clientFiles.clientId, locationId)));
    cfRows.forEach((r: any) => fileIdSet.add(r.fileId));

    // 7. Equipment — OCR scan files and nameplate photos
    const equipRows = await (tx as any)
      .select({ id: locationEquipment.id, nameplatePhotoId: locationEquipment.nameplatePhotoId })
      .from(locationEquipment)
      .where(and(eq(locationEquipment.companyId, companyId), eq(locationEquipment.locationId, locationId)));
    const equipIds: string[] = equipRows.map((r: any) => r.id);
    equipRows.forEach((r: any) => { if (r.nameplatePhotoId) fileIdSet.add(r.nameplatePhotoId); });
    if (equipIds.length > 0) {
      const scanRows = await (tx as any)
        .select({ fileId: equipmentOcrScans.fileId })
        .from(equipmentOcrScans)
        .where(inArray(equipmentOcrScans.equipmentId, equipIds));
      scanRows.forEach((r: any) => fileIdSet.add(r.fileId));
    }

    // 8. Recurring job template contract files
    const templateRows = await (tx as any)
      .select({ id: recurringJobTemplates.id })
      .from(recurringJobTemplates)
      .where(and(eq(recurringJobTemplates.companyId, companyId), eq(recurringJobTemplates.locationId, locationId)));
    const templateIds: string[] = templateRows.map((r: any) => r.id);
    if (templateIds.length > 0) {
      const cfRows = await (tx as any)
        .select({ fileId: contractFiles.fileId })
        .from(contractFiles)
        .where(and(eq(contractFiles.companyId, companyId), inArray(contractFiles.contractId, templateIds)));
      cfRows.forEach((r: any) => fileIdSet.add(r.fileId));
    }

    if (fileIdSet.size === 0) return [];

    // Resolve file metadata for queued entries.
    const allFileIds = Array.from(fileIdSet);
    const fileRows = await (tx as any)
      .select({
        id: files.id,
        bucket: files.bucket,
        storageKey: files.storageKey,
        storageProvider: files.storageProvider,
      })
      .from(files)
      .where(and(
        eq(files.companyId, companyId),
        inArray(files.id, allFileIds),
        isNotNull(files.bucket),
      ));

    return fileRows
      .filter((r: any) => r.bucket && r.storageKey)
      .map((r: any) => ({
        fileId: r.id,
        bucket: r.bucket as string,
        storageKey: r.storageKey as string,
        storageProvider: (r.storageProvider as string) ?? "r2",
      }));
  }

  private async deleteLocationCascadeInTx(
    tx: typeof db,
    companyId: string,
    locationId: string
  ): Promise<void> {
    // ── Collect entity IDs upfront for file ref collection and cascade ────────
    const invoiceRows = await (tx as any)
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.companyId, companyId), eq(invoices.locationId, locationId)));
    const invoiceIds: string[] = invoiceRows.map((r: { id: string }) => r.id);

    const jobRows = await (tx as any)
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.companyId, companyId), eq(jobs.locationId, locationId)));
    const jobIds: string[] = jobRows.map((r: { id: string }) => r.id);

    const quoteRows = await (tx as any)
      .select({ id: quotes.id })
      .from(quotes)
      .where(and(eq(quotes.companyId, companyId), eq(quotes.locationId, locationId)));
    const quoteIds: string[] = quoteRows.map((r: { id: string }) => r.id);

    const leadRows = await (tx as any)
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.companyId, companyId), eq(leads.locationId, locationId)));
    const leadIds: string[] = leadRows.map((r: { id: string }) => r.id);

    // ── Collect file refs and queue cleanup before deleting anything ──────────
    const fileEntries = await this.collectLocationFileRefs(
      tx, companyId, locationId, invoiceIds, jobIds, quoteIds, leadIds,
    );
    if (fileEntries.length > 0) {
      await queueFileCleanupInTx(tx, companyId, fileEntries, `location_delete:${locationId}`);
    }

    // ── Payments ─────────────────────────────────────────────────────────────
    if (invoiceIds.length > 0) {
      // Multi-invoice payments that have allocations to these invoices
      const multiPayRows = await (tx as any)
        .selectDistinct({ paymentId: paymentAllocations.paymentId })
        .from(paymentAllocations)
        .where(inArray(paymentAllocations.invoiceId, invoiceIds));
      const multiPayIds: string[] = multiPayRows.map((r: { paymentId: string }) => r.paymentId);

      // Legacy 1:1 payments directly linked to these invoices
      const legacyPayRows = await (tx as any)
        .select({ id: payments.id })
        .from(payments)
        .where(and(eq(payments.companyId, companyId), inArray(payments.invoiceId, invoiceIds)));
      const legacyPayIds: string[] = legacyPayRows.map((r: { id: string }) => r.id);

      const allPayIds = Array.from(new Set([...multiPayIds, ...legacyPayIds]));

      // Delete refund/reversal children first (RESTRICT on parentPaymentId)
      if (allPayIds.length > 0) {
        await (tx as any).delete(payments).where(
          and(eq(payments.companyId, companyId), inArray(payments.parentPaymentId, allPayIds))
        );
      }

      // Delete payment_disputes that reference these invoices or payments.
      // paymentDisputes.invoiceId/paymentId are SET NULL, but we delete them
      // explicitly so orphaned disputes don't accumulate with null FKs.
      await (tx as any).delete(paymentDisputes).where(
        and(
          eq(paymentDisputes.companyId, companyId),
          inArray(paymentDisputes.invoiceId, invoiceIds),
        )
      );
      if (allPayIds.length > 0) {
        await (tx as any).delete(paymentDisputes).where(
          and(
            eq(paymentDisputes.companyId, companyId),
            inArray(paymentDisputes.paymentId, allPayIds),
          )
        );
      }

      // Delete allocations for these invoices
      await (tx as any).delete(paymentAllocations).where(
        inArray(paymentAllocations.invoiceId, invoiceIds)
      );

      // Delete multi-invoice payments that now have no remaining allocations
      if (multiPayIds.length > 0) {
        const remainingRows = await (tx as any)
          .select({ paymentId: paymentAllocations.paymentId })
          .from(paymentAllocations)
          .where(inArray(paymentAllocations.paymentId, multiPayIds));
        const remainingIds = new Set(remainingRows.map((r: { paymentId: string }) => r.paymentId));
        const orphanedIds = multiPayIds.filter(id => !remainingIds.has(id));
        if (orphanedIds.length > 0) {
          await (tx as any).delete(payments).where(
            and(eq(payments.companyId, companyId), isNull(payments.invoiceId), inArray(payments.id, orphanedIds))
          );
        }
      }
    }

    // ── Invoices — CASCADE: invoice_lines, invoice_notes, legacy 1:1 payments ──
    await (tx as any).delete(invoices).where(
      and(eq(invoices.companyId, companyId), eq(invoices.locationId, locationId))
    );

    // ── Jobs — CASCADE: job_notes, job_visits, job_parts, job_equipment, labor_entries, etc. ──
    await (tx as any).delete(jobs).where(
      and(eq(jobs.companyId, companyId), eq(jobs.locationId, locationId))
    );

    // ── Quotes — CASCADE: quote_lines, quote_notes ────────────────────────────
    await (tx as any).delete(quotes).where(
      and(eq(quotes.companyId, companyId), eq(quotes.locationId, locationId))
    );

    // ── Leads ─────────────────────────────────────────────────────────────────
    await (tx as any).delete(leads).where(
      and(eq(leads.companyId, companyId), eq(leads.locationId, locationId))
    );

    // ── Maintenance records ───────────────────────────────────────────────────
    await (tx as any).delete(maintenanceRecords).where(
      and(eq(maintenanceRecords.companyId, companyId), eq(maintenanceRecords.locationId, locationId))
    );

    // ── Client parts ──────────────────────────────────────────────────────────
    await (tx as any).delete(clientParts).where(
      and(eq(clientParts.companyId, companyId), eq(clientParts.locationId, locationId))
    );

    // ── Client notes — both locationId and deprecated clientId reference this location ──
    await (tx as any).delete(clientNotes).where(
      and(
        eq(clientNotes.companyId, companyId),
        or(eq(clientNotes.locationId, locationId), eq(clientNotes.clientId, locationId))
      )
    );

    // ── Recurring job templates — CASCADE: contract_files, pm_billing_events,
    //   recurring_job_series (→ recurring_job_phases) ──────────────────────────
    // Files were already queued in collectLocationFileRefs (section 8).
    await (tx as any).delete(recurringJobTemplates).where(
      and(eq(recurringJobTemplates.companyId, companyId), eq(recurringJobTemplates.locationId, locationId))
    );

    // ── Location — CASCADE: location_tag_assignments, contact_assignments,
    //   client_files, location_pm_plans, location_pm_part_templates,
    //   location_equipment (→ equipment_ocr_scans, equipment_catalog_items) ────
    await (tx as any).delete(clients).where(
      and(eq(clients.id, locationId), eq(clients.companyId, companyId))
    );
  }

  /**
   * Permanently delete a customer company and all owned records.
   * No eligibility gate — always proceeds. Returns { deletedCount } summary.
   * Wrap all sub-deletes in a single transaction for atomicity.
   */
  async permanentDeleteCustomerCompany(
    companyId: string,
    customerCompanyId: string
  ): Promise<{ locationCount: number }> {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");

    return await db.transaction(async (tx) => {
      const locationRows = await (tx as any)
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.companyId, companyId), eq(clients.parentCompanyId, customerCompanyId)));

      for (const loc of locationRows) {
        await this.deleteLocationCascadeInTx(tx as any, companyId, loc.id);
      }

      // Delete customer company — CASCADE handles company-level clientNotes
      // (customerCompanyId FK), contactAssignments, clientTagAssignments
      const deleted = await (tx as any)
        .delete(customerCompanies)
        .where(and(eq(customerCompanies.id, customerCompanyId), eq(customerCompanies.companyId, companyId)))
        .returning();

      if (deleted.length === 0) throw this.notFoundError("Customer company");
      return { locationCount: locationRows.length };
    });
  }

  /**
   * Permanently delete a single location and all owned records.
   * No eligibility gate. Does NOT check isLastLocation — caller is responsible.
   */
  async permanentDeleteLocation(
    companyId: string,
    locationId: string
  ): Promise<boolean> {
    this.assertCompanyId(companyId);
    this.validateUUID(locationId, "locationId");

    return await db.transaction(async (tx) => {
      const locRows = await (tx as any)
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.id, locationId), eq(clients.companyId, companyId)));
      if (locRows.length === 0) return false;

      await this.deleteLocationCascadeInTx(tx as any, companyId, locationId);
      return true;
    });
  }

  /**
   * Soft-delete (archive) a customer company.
   * Sets isActive=false and deletedAt=now. Locations are also marked inactive.
   */
  async softDeleteCustomerCompany(
    companyId: string,
    customerCompanyId: string
  ): Promise<typeof customerCompanies.$inferSelect | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");

    const now = new Date();
    return await db.transaction(async (tx) => {
      // Mark all active locations as inactive
      await tx
        .update(clients)
        .set({ inactive: true, deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(clients.companyId, companyId),
            eq(clients.parentCompanyId, customerCompanyId),
            notDeletedClientFilter()
          )
        );

      // Soft-delete the company itself
      const [updated] = await tx
        .update(customerCompanies)
        .set({ isActive: false, deletedAt: now })
        .where(
          and(eq(customerCompanies.id, customerCompanyId), eq(customerCompanies.companyId, companyId))
        )
        .returning();

      return updated ?? null;
    });
  }

  /**
   * Restore a soft-deleted customer company.
   * Clears deletedAt and sets isActive=true. Locations remain inactive (user can restore individually).
   */
  async restoreCustomerCompany(
    companyId: string,
    customerCompanyId: string
  ): Promise<typeof customerCompanies.$inferSelect | null> {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");

    const now = new Date();
    return await db.transaction(async (tx) => {
      // Restore the company
      const [updated] = await tx
        .update(customerCompanies)
        .set({ isActive: true, deletedAt: null, updatedAt: now })
        .where(
          and(eq(customerCompanies.id, customerCompanyId), eq(customerCompanies.companyId, companyId))
        )
        .returning();

      if (!updated) return null;

      // Also restore all locations under this company
      await tx
        .update(clients)
        .set({ inactive: false, deletedAt: null, updatedAt: now })
        .where(
          and(
            eq(clients.companyId, companyId),
            eq(clients.parentCompanyId, customerCompanyId),
            isNotNull(clients.deletedAt)
          )
        );

      return updated;
    });
  }

  /**
   * Check whether a single location can be hard-deleted.
   */
  async checkLocationDeleteEligibility(
    companyId: string,
    locationId: string
  ): Promise<{ canHardDelete: boolean; reasons: string[]; isLastLocation: boolean; parentCompanyId: string | null }> {
    this.assertCompanyId(companyId);
    this.validateUUID(locationId, "locationId");

    const location = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, locationId), eq(clients.companyId, companyId)))
      .limit(1);
    if (location.length === 0) throw this.notFoundError("Location");

    const loc = location[0];
    const reasons: string[] = [];

    // Check jobs
    const [jobCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(jobs)
      .where(and(eq(jobs.companyId, companyId), eq(jobs.locationId, locationId)));
    if (Number(jobCount.count) > 0) reasons.push(`${jobCount.count} job(s) exist`);

    // Check invoices
    const [invCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(invoices)
      .where(and(eq(invoices.companyId, companyId), eq(invoices.locationId, locationId)));
    if (Number(invCount.count) > 0) reasons.push(`${invCount.count} invoice(s) exist`);

    // Check quotes
    const [quoteCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(quotes)
      .where(and(eq(quotes.companyId, companyId), eq(quotes.locationId, locationId)));
    if (Number(quoteCount.count) > 0) reasons.push(`${quoteCount.count} quote(s) exist`);

    // Check if QBO-synced
    if (loc.qboCustomerId) {
      reasons.push("Synced with QuickBooks Online");
    }

    // Check if this is the last location under its parent company
    let isLastLocation = false;
    if (loc.parentCompanyId) {
      const [siblingCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(clients)
        .where(
          and(
            eq(clients.companyId, companyId),
            eq(clients.parentCompanyId, loc.parentCompanyId),
            notDeletedClientFilter()
          )
        );
      isLastLocation = Number(siblingCount.count) <= 1;
    }

    return { canHardDelete: reasons.length === 0, reasons, isLastLocation, parentCompanyId: loc.parentCompanyId };
  }

  /**
   * Hard-delete a single location.
   * ONLY call after checkLocationDeleteEligibility confirms canHardDelete=true and !isLastLocation.
   */
  async hardDeleteLocation(
    companyId: string,
    locationId: string
  ): Promise<boolean> {
    this.assertCompanyId(companyId);
    this.validateUUID(locationId, "locationId");

    return await db.transaction(async (tx) => {
      // Delete clientParts (RESTRICT FK)
      await tx.delete(clientParts).where(
        and(eq(clientParts.companyId, companyId), eq(clientParts.locationId, locationId))
      );

      // Delete client notes referencing this location (RESTRICT FK)
      await tx.delete(clientNotes).where(
        and(eq(clientNotes.companyId, companyId), eq(clientNotes.locationId, locationId))
      );

      // Delete the location itself (CASCADE handles: locationEquipment, locationPMPlans,
      // locationPMPartTemplates, locationTagAssignments, location-level clientContacts)
      const deleted = await tx
        .delete(clients)
        .where(and(eq(clients.id, locationId), eq(clients.companyId, companyId)))
        .returning();

      return deleted.length > 0;
    });
  }
}

export const customerCompanyRepository = new CustomerCompanyRepository();
