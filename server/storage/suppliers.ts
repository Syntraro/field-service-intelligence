import { db } from "../db";
import { eq, and, ilike, desc, inArray } from "drizzle-orm";
import { suppliers, supplierLocations, type Supplier, type SupplierLocation } from "@shared/schema";
import { BaseRepository, clampLimit, escapeLike } from "./base";

/**
 * Supplier repository - handles all supplier-related database operations.
 * Ensures tenant isolation via companyId scoping.
 * Uses soft delete (isActive flag) for all delete operations.
 */
export class SupplierRepository extends BaseRepository {
  // ========================================
  // SUPPLIERS
  // ========================================

  /**
   * List all suppliers for a company
   */
  async listSuppliers(
    companyId: string,
    options: { search?: string; includeLocations?: boolean; includeInactive?: boolean } = {}
  ) {
    this.assertCompanyId(companyId);

    const whereConditions: any[] = [eq(suppliers.companyId, companyId)];

    // Filter by active status unless includeInactive is true
    if (!options.includeInactive) {
      whereConditions.push(eq(suppliers.isActive, true));
    }

    // Apply search filter if provided
    if (options.search && options.search.trim()) {
      whereConditions.push(ilike(suppliers.name, `%${escapeLike(options.search.trim())}%`));
    }

    const items = await db
      .select()
      .from(suppliers)
      .where(and(...whereConditions))
      .orderBy(suppliers.name);

    // If includeLocations is true, fetch locations for each supplier
    if (options.includeLocations && items.length > 0) {
      const supplierIds = items.map((s) => s.id);
      const locations = await db
        .select()
        .from(supplierLocations)
        .where(
          and(
            eq(supplierLocations.companyId, companyId),
            inArray(supplierLocations.supplierId, supplierIds),
            eq(supplierLocations.isActive, true)
          )
        )
        .orderBy(supplierLocations.name);

      // Group locations by supplierId
      const locationsBySupplier = locations.reduce(
        (acc, loc) => {
          if (!acc[loc.supplierId]) acc[loc.supplierId] = [];
          acc[loc.supplierId].push(loc);
          return acc;
        },
        {} as Record<string, SupplierLocation[]>
      );

      return items.map((s) => ({
        ...s,
        locations: locationsBySupplier[s.id] || [],
      }));
    }

    return items;
  }

  /**
   * Get a single supplier by ID
   */
  async getSupplier(companyId: string, supplierId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(supplierId, "supplierId");

    const [supplier] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.companyId, companyId)));

    return supplier ?? null;
  }

  /**
   * Get supplier with locations
   */
  async getSupplierWithLocations(companyId: string, supplierId: string) {
    const supplier = await this.getSupplier(companyId, supplierId);
    if (!supplier) return null;

    const locations = await this.listSupplierLocations(companyId, supplierId, {
      includeInactive: false,
    });

    return { supplier, locations };
  }

  /**
   * Create a supplier
   */
  async createSupplier(companyId: string, data: Partial<Supplier>) {
    this.assertCompanyId(companyId);

    const [supplier] = await db
      .insert(suppliers)
      .values({
        ...data,
        companyId,
        isActive: true,
        qboSyncStatus: "NOT_SYNCED",
        updatedAt: new Date(),
      } as any)
      .returning();

    return supplier;
  }

  /**
   * Update a supplier
   */
  async updateSupplier(companyId: string, supplierId: string, data: Partial<Supplier>) {
    this.assertCompanyId(companyId);
    this.validateUUID(supplierId, "supplierId");

    const existing = await this.getSupplier(companyId, supplierId);
    if (!existing) {
      throw this.notFoundError("Supplier");
    }

    const updateData: any = {
      ...data,
      updatedAt: new Date(),
    };

    // If qboVendorId exists and any field changes, set qboSyncStatus to PENDING
    if (existing.qboVendorId && Object.keys(data).length > 0) {
      updateData.qboSyncStatus = "PENDING";
    }

    const [supplier] = await db
      .update(suppliers)
      .set(updateData)
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.companyId, companyId)))
      .returning();

    return supplier;
  }

  /**
   * Delete a supplier (soft delete)
   */
  async deleteSupplier(companyId: string, supplierId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(supplierId, "supplierId");

    const existing = await this.getSupplier(companyId, supplierId);
    if (!existing) {
      throw this.notFoundError("Supplier");
    }

    await db
      .update(suppliers)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.companyId, companyId)));

    return { success: true };
  }

  // ========================================
  // SUPPLIER LOCATIONS
  // ========================================

  /**
   * List locations for a supplier
   */
  async listSupplierLocations(
    companyId: string,
    supplierId: string,
    options: { includeInactive?: boolean } = {}
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(supplierId, "supplierId");

    // Verify supplier exists and belongs to company
    const supplier = await this.getSupplier(companyId, supplierId);
    if (!supplier) {
      throw this.notFoundError("Supplier");
    }

    const whereConditions: any[] = [
      eq(supplierLocations.supplierId, supplierId),
      eq(supplierLocations.companyId, companyId),
    ];

    if (!options.includeInactive) {
      whereConditions.push(eq(supplierLocations.isActive, true));
    }

    return await db
      .select()
      .from(supplierLocations)
      .where(and(...whereConditions))
      .orderBy(desc(supplierLocations.isPrimary), supplierLocations.name);
  }

  /**
   * Get a single supplier location
   */
  async getSupplierLocation(companyId: string, supplierId: string, locationId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(supplierId, "supplierId");
    this.validateUUID(locationId, "locationId");

    const [location] = await db
      .select()
      .from(supplierLocations)
      .where(
        and(
          eq(supplierLocations.id, locationId),
          eq(supplierLocations.supplierId, supplierId),
          eq(supplierLocations.companyId, companyId)
        )
      );

    return location ?? null;
  }

  /**
   * Create a supplier location
   */
  async createSupplierLocation(
    companyId: string,
    supplierId: string,
    data: Partial<SupplierLocation>
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(supplierId, "supplierId");

    // Verify supplier exists and belongs to company
    const supplier = await this.getSupplier(companyId, supplierId);
    if (!supplier) {
      throw this.notFoundError("Supplier");
    }

    // Check if this is the first location for this supplier
    const existingLocations = await this.listSupplierLocations(companyId, supplierId, {
      includeInactive: true,
    });

    const isFirstLocation = existingLocations.length === 0;
    const shouldBePrimary = isFirstLocation || data.isPrimary;

    // If setting as primary, clear primary flag from other locations
    if (shouldBePrimary) {
      await db
        .update(supplierLocations)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(
          and(
            eq(supplierLocations.supplierId, supplierId),
            eq(supplierLocations.companyId, companyId)
          )
        );
    }

    const [location] = await db
      .insert(supplierLocations)
      .values({
        ...data,
        supplierId,
        companyId,
        isPrimary: shouldBePrimary,
        isActive: true,
        updatedAt: new Date(),
      } as any)
      .returning();

    return location;
  }

  /**
   * Update a supplier location
   */
  async updateSupplierLocation(
    companyId: string,
    supplierId: string,
    locationId: string,
    data: Partial<SupplierLocation>
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(supplierId, "supplierId");
    this.validateUUID(locationId, "locationId");

    const existing = await this.getSupplierLocation(companyId, supplierId, locationId);
    if (!existing) {
      throw this.notFoundError("Location");
    }

    const [location] = await db
      .update(supplierLocations)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(supplierLocations.id, locationId),
          eq(supplierLocations.supplierId, supplierId),
          eq(supplierLocations.companyId, companyId)
        )
      )
      .returning();

    return location;
  }

  /**
   * Set a location as primary
   */
  async setSupplierLocationPrimary(
    companyId: string,
    supplierId: string,
    locationId: string
  ) {
    this.assertCompanyId(companyId);
    this.validateUUID(supplierId, "supplierId");
    this.validateUUID(locationId, "locationId");

    const existing = await this.getSupplierLocation(companyId, supplierId, locationId);
    if (!existing) {
      throw this.notFoundError("Location");
    }

    return await db.transaction(async (tx) => {
      // Clear primary flag from all other locations
      await tx
        .update(supplierLocations)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(
          and(
            eq(supplierLocations.supplierId, supplierId),
            eq(supplierLocations.companyId, companyId)
          )
        );

      // Set this location as primary
      const [updated] = await tx
        .update(supplierLocations)
        .set({ isPrimary: true, updatedAt: new Date() })
        .where(
          and(
            eq(supplierLocations.id, locationId),
            eq(supplierLocations.supplierId, supplierId),
            eq(supplierLocations.companyId, companyId)
          )
        )
        .returning();

      return updated;
    });
  }

  /**
   * Delete a supplier location (soft delete)
   */
  async deleteSupplierLocation(companyId: string, supplierId: string, locationId: string) {
    this.assertCompanyId(companyId);
    this.validateUUID(supplierId, "supplierId");
    this.validateUUID(locationId, "locationId");

    const existing = await this.getSupplierLocation(companyId, supplierId, locationId);
    if (!existing) {
      throw this.notFoundError("Location");
    }

    // Prevent deletion of primary location
    if (existing.isPrimary) {
      throw this.validationError(
        "Cannot delete primary location. Set another location as primary first."
      );
    }

    await db
      .update(supplierLocations)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(supplierLocations.id, locationId),
          eq(supplierLocations.supplierId, supplierId),
          eq(supplierLocations.companyId, companyId)
        )
      );

    return { success: true };
  }
}

export const supplierRepository = new SupplierRepository();
