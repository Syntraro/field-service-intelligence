import { db } from "../db";
import { eq, and, desc, inArray, isNull, sql } from "drizzle-orm";
import { customerCompanies, clients, jobs, invoices } from "@shared/schema";
import type { Client } from "@shared/schema";
import { BaseRepository, clampLimit, clampOffset } from "./base";

// Orphan location info for admin linking
export interface OrphanLocation {
  id: string;
  companyName: string;
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
          eq(customerCompanies.name, name)
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
      name: string;
      phone?: string | null;
      email?: string | null;
      billingStreet?: string | null;
      billingCity?: string | null;
      billingProvince?: string | null;
      billingPostalCode?: string | null;
      billingCountry?: string | null;
    }
  ): Promise<typeof customerCompanies.$inferSelect> {
    this.assertCompanyId(companyId);

    const [company] = await db
      .insert(customerCompanies)
      .values({
        companyId,
        name: data.name,
        phone: data.phone ?? null,
        email: data.email ?? null,
        billingStreet: data.billingStreet ?? null,
        billingCity: data.billingCity ?? null,
        billingProvince: data.billingProvince ?? null,
        billingPostalCode: data.billingPostalCode ?? null,
        billingCountry: data.billingCountry ?? null,
      })
      .returning();

    return company;
  }

  /**
   * Find or create customer company by name (tenant-scoped)
   * Returns existing if found, creates new if not
   */
  async findOrCreateCustomerCompany(
    companyId: string,
    data: {
      name: string;
      phone?: string | null;
      email?: string | null;
      billingStreet?: string | null;
      billingCity?: string | null;
      billingProvince?: string | null;
      billingPostalCode?: string | null;
      billingCountry?: string | null;
    }
  ): Promise<typeof customerCompanies.$inferSelect> {
    this.assertCompanyId(companyId);

    const existing = await this.findCustomerCompanyByName(companyId, data.name);
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
    const locations = await db
      .select()
      .from(clients)
      .where(
        and(
          eq(clients.companyId, companyId),
          eq(clients.parentCompanyId, customerCompanyId)
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
          eq(clients.parentCompanyId, customerCompanyId)
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
          eq(clients.companyName, companyName)
        )
      )
      .orderBy(desc(clients.createdAt));
  }

  /**
   * Get unlinked locations by company name (parentCompanyId IS NULL)
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
          eq(clients.companyName, companyName),
          // CRITICAL: Must use isNull() for NULL comparison, not eq(col, null)
          isNull(clients.parentCompanyId)
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
    const [jobsList, invoicesList] = await Promise.all([
      locationIds.length === 0
        ? []
        : db
            .select()
            .from(jobs)
            .where(
              and(
                eq(jobs.companyId, companyId),
                inArray(jobs.locationId, locationIds)
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
    // Closed job statuses that should NOT count as "open"
    const closedJobStatuses = ["completed", "requires_invoicing", "invoiced", "closed", "archived", "cancelled"];
    const stats = {
      totalLocations: locations.length,
      openJobs: jobsList.filter(
        (j: any) => !closedJobStatuses.includes(j.status)
      ).length,
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

    const [jobsList, invoicesList] = await Promise.all([
      db
        .select()
        .from(jobs)
        .where(
          and(eq(jobs.companyId, companyId), inArray(jobs.locationId, locationIds))
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
          isNull(customerCompanies.deletedAt)
        )
      );

    // Build name -> companies map for exact matching
    const nameToCompanies = new Map<string, { id: string; name: string }[]>();
    for (const cc of allCustomerCompanies) {
      const key = cc.name.toLowerCase().trim();
      if (!nameToCompanies.has(key)) {
        nameToCompanies.set(key, []);
      }
      nameToCompanies.get(key)!.push(cc);
    }

    // Map orphans with suggested matches (only if exactly one match)
    return orphans.map((orphan) => {
      const key = orphan.companyName.toLowerCase().trim();
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
}

export const customerCompanyRepository = new CustomerCompanyRepository();
