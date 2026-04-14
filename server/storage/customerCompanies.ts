import { db } from "../db";
import { eq, and, desc, ilike, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { customerCompanies, clients, jobs, invoices, quotes, contactPersons, clientParts, clientNotes } from "@shared/schema";
import type { Client } from "@shared/schema";
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
   * Find customer company by name (tenant-scoped)
   * Used for upsert/deduplication logic
   */
  async findCustomerCompanyByName(
    companyId: string,
    name: string
  ): Promise<typeof customerCompanies.$inferSelect | null> {
    this.assertCompanyId(companyId);

    const [company] = await db
      .select()
      .from(customerCompanies)
      .where(
        and(
          eq(customerCompanies.companyId, companyId),
          eq(customerCompanies.name, name),
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
   * Find or create customer company by name (tenant-scoped)
   * Returns existing if found, creates new if not
   */
  async findOrCreateCustomerCompany(
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

    // Use normalized matching for case-insensitive dedup (company name or person name)
    const matchName = data.name?.trim() || (data.firstName ? `${data.firstName} ${data.lastName || ""}`.trim() : "");
    const normalized = normalizeForMatch(matchName);
    const existing = normalized ? await this.findCustomerCompanyByNormalizedName(companyId, normalized) : null;
    if (existing) return existing;

    return await this.createCustomerCompany(companyId, data);
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
  async getUnlinkedLocationsByCompanyName(
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

  /**
   * Create location under customer company (tenant-scoped)
   */
  async createLocationUnderCustomerCompany(
    companyId: string,
    userId: string,
    customerCompanyId: string,
    data: {
      location?: string;
      address?: string | null;
      city?: string | null;
      province?: string | null;
      postalCode?: string | null;
      contactName?: string | null;
      email?: string | null;
      phone?: string | null;
      roofLadderCode?: string | null;
      billWithParent?: boolean;
      inactive?: boolean;
    }
  ): Promise<Client> {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");

    // Get customer company to inherit name
    const company = await this.getCustomerCompany(companyId, customerCompanyId);
    if (!company) {
      throw this.notFoundError("Customer company");
    }

    // Auto-geocode address if lat/lng not provided (includes country for disambiguation)
    const coords = await geocodeToLatLng(data.address, data.city, data.province, data.postalCode, (data as any).country);

    const [location] = await db
      .insert(clients)
      .values({
        companyId,
        userId,
        parentCompanyId: customerCompanyId,
        companyName: company.name,
        location: data.location || "",
        address: data.address ?? null,
        city: data.city ?? null,
        province: data.province ?? null,
        postalCode: data.postalCode ?? null,
        contactName: data.contactName ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        roofLadderCode: data.roofLadderCode ?? null,
        billWithParent: data.billWithParent ?? true,
        inactive: data.inactive ?? false,
        isPrimary: false,
        needsDetails: false,
        selectedMonths: [],
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      })
      .returning();

    return location;
  }

  /**
   * Part A: Transaction-aware variant of createLocationUnderCustomerCompany.
   * Accepts an external transaction so the caller can bundle location + contact
   * creation atomically (no partial-save state possible).
   */
  async createLocationUnderCustomerCompanyTx(
    tx: any,
    companyId: string,
    userId: string,
    customerCompanyId: string,
    data: {
      location?: string;
      address?: string | null;
      city?: string | null;
      province?: string | null;
      postalCode?: string | null;
      contactName?: string | null;
      email?: string | null;
      phone?: string | null;
      roofLadderCode?: string | null;
      billWithParent?: boolean;
      inactive?: boolean;
    }
  ): Promise<Client> {
    this.assertCompanyId(companyId);
    this.validateUUID(customerCompanyId, "customerCompanyId");

    // Get customer company to inherit name
    const company = await this.getCustomerCompany(companyId, customerCompanyId);
    if (!company) {
      throw this.notFoundError("Customer company");
    }

    // Auto-geocode address (outside transaction — external API call is fine; includes country)
    const coords = await geocodeToLatLng(data.address, data.city, data.province, data.postalCode, (data as any).country);

    const [location] = await tx
      .insert(clients)
      .values({
        companyId,
        userId,
        parentCompanyId: customerCompanyId,
        companyName: company.name,
        location: data.location || "",
        address: data.address ?? null,
        city: data.city ?? null,
        province: data.province ?? null,
        postalCode: data.postalCode ?? null,
        contactName: data.contactName ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        roofLadderCode: data.roofLadderCode ?? null,
        billWithParent: data.billWithParent ?? true,
        inactive: data.inactive ?? false,
        isPrimary: false,
        needsDetails: false,
        selectedMonths: [],
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      })
      .returning();

    return location;
  }

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
    const [jobsList, invoicesList] = await Promise.all([
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
  // DELETION — eligibility checks and hard/soft delete
  // ========================================

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
