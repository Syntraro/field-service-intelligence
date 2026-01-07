import { Router } from "express";
import type { Response } from "express";
import { db } from "../db";
import {
  suppliers,
  supplierLocations,
  insertSupplierSchema,
  updateSupplierSchema,
  insertSupplierLocationSchema,
  updateSupplierLocationSchema,
  type Supplier,
  type SupplierLocation,
} from "@shared/schema";
import { eq, and, ilike, sql, desc, inArray } from "drizzle-orm";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";

const router = Router();

// ========================================
// SUPPLIER ROUTES
// ========================================

// GET /api/suppliers - List all suppliers with optional search
router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const searchQuery = req.query.q as string | undefined;
  const includeLocations = req.query.includeLocations === 'true';

  let query = db
    .select()
    .from(suppliers)
    .where(eq(suppliers.companyId, companyId))
    .orderBy(suppliers.name)
    .$dynamic();

  // Apply search filter if provided
  if (searchQuery && searchQuery.trim()) {
    query = query.where(
      and(
        eq(suppliers.companyId, companyId),
        ilike(suppliers.name, `%${searchQuery.trim()}%`)
      )
    );
  }

  const items = await query;

  // If includeLocations is true, fetch locations for each supplier
  let suppliersWithLocations = items;
  if (includeLocations && items.length > 0) {
    const supplierIds = items.map(s => s.id);
    const locations = await db
  .select()
  .from(supplierLocations)
  .where(
    and(
      eq(supplierLocations.companyId, companyId),
      inArray(supplierLocations.supplierId, supplierIds)
    )
  )
      .orderBy(supplierLocations.name);

    // Group locations by supplierId
    const locationsBySupplier = locations.reduce((acc, loc) => {
      if (!acc[loc.supplierId]) acc[loc.supplierId] = [];
      acc[loc.supplierId].push(loc);
      return acc;
    }, {} as Record<string, SupplierLocation[]>);

    suppliersWithLocations = items.map(s => ({
      ...s,
      locations: locationsBySupplier[s.id] || [],
    }));
  }

  res.json({
    items: suppliersWithLocations,
    total: items.length,
  });
}));

// POST /api/suppliers - Create new supplier
router.post("/", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const validated = validateSchema(insertSupplierSchema.strict(), req.body);

  const [supplier] = await db
    .insert(suppliers)
    .values({
      ...validated,
      companyId,
      isActive: true,
      qboSyncStatus: 'NOT_SYNCED',
      updatedAt: new Date(),
    })
    .returning();

  res.json({ supplier });
}));

// GET /api/suppliers/:id - Get single supplier with locations
router.get("/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const { id } = req.params;

  const [supplier] = await db
    .select()
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, id),
        eq(suppliers.companyId, companyId)
      )
    );

  if (!supplier) {
    throw createError(404, "Supplier not found");
  }

  // Fetch locations for this supplier
  const locations = await db
    .select()
    .from(supplierLocations)
    .where(
      and(
        eq(supplierLocations.supplierId, id),
        eq(supplierLocations.companyId, companyId)
      )
    )
    .orderBy(desc(supplierLocations.isPrimary), supplierLocations.name);

  res.json({ supplier, locations });
}));

// PATCH /api/suppliers/:id - Update supplier
router.patch("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const { id } = req.params;
  const validated = validateSchema(updateSupplierSchema.strict(), req.body);

  // Verify supplier exists and belongs to company
  const [existing] = await db
    .select()
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, id),
        eq(suppliers.companyId, companyId)
      )
    );

  if (!existing) {
    throw createError(404, "Supplier not found");
  }

  // If qboVendorId exists and any field changes, set qboSyncStatus to PENDING
  const updateData: any = {
    ...validated,
    updatedAt: new Date(),
  };

  if (existing.qboVendorId && Object.keys(validated).length > 0) {
    updateData.qboSyncStatus = 'PENDING';
  }

  const [supplier] = await db
    .update(suppliers)
    .set(updateData)
    .where(
      and(
        eq(suppliers.id, id),
        eq(suppliers.companyId, companyId)
      )
    )
    .returning();

  res.json({ supplier });
}));

// DELETE /api/suppliers/:id - Soft delete supplier
router.delete("/:id", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const { id } = req.params;

  // Verify supplier exists and belongs to company
  const [existing] = await db
    .select()
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, id),
        eq(suppliers.companyId, companyId)
      )
    );

  if (!existing) {
    throw createError(404, "Supplier not found");
  }

  // Soft delete by setting isActive to false
  await db
    .update(suppliers)
    .set({
      isActive: false,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(suppliers.id, id),
        eq(suppliers.companyId, companyId)
      )
    );

  res.json({ success: true });
}));

// ========================================
// SUPPLIER LOCATION ROUTES
// ========================================

// GET /api/suppliers/:supplierId/locations - List locations for a supplier
router.get("/:supplierId/locations", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const { supplierId } = req.params;
  const includeInactive = req.query.includeInactive === 'true';

  // Verify supplier exists and belongs to company
  const [supplier] = await db
    .select()
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, supplierId),
        eq(suppliers.companyId, companyId)
      )
    );

  if (!supplier) {
    throw createError(404, "Supplier not found");
  }

  let query = db
    .select()
    .from(supplierLocations)
    .where(
      and(
        eq(supplierLocations.supplierId, supplierId),
        eq(supplierLocations.companyId, companyId)
      )
    )
    .$dynamic();

  // Filter by active status unless includeInactive is true
  if (!includeInactive) {
    query = query.where(
      and(
        eq(supplierLocations.supplierId, supplierId),
        eq(supplierLocations.companyId, companyId),
        eq(supplierLocations.isActive, true)
      )
    );
  }

  const items = await query.orderBy(desc(supplierLocations.isPrimary), supplierLocations.name);

  res.json({ items });
}));

// POST /api/suppliers/:supplierId/locations - Create new location
router.post("/:supplierId/locations", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const { supplierId } = req.params;
  const validated = validateSchema(insertSupplierLocationSchema.strict(), req.body);

  // Verify supplier exists and belongs to company
  const [supplier] = await db
    .select()
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, supplierId),
        eq(suppliers.companyId, companyId)
      )
    );

  if (!supplier) {
    throw createError(404, "Supplier not found");
  }

  // Check if this is the first location for this supplier
  const existingLocations = await db
    .select()
    .from(supplierLocations)
    .where(
      and(
        eq(supplierLocations.supplierId, supplierId),
        eq(supplierLocations.companyId, companyId)
      )
    );

  const isFirstLocation = existingLocations.length === 0;
  const shouldBePrimary = isFirstLocation || validated.isPrimary;

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
      ...validated,
      supplierId,
      companyId,
      isPrimary: shouldBePrimary,
      updatedAt: new Date(),
    })
    .returning();

  res.json({ location });
}));

// GET /api/suppliers/:supplierId/locations/:locationId - Get single location
router.get("/:supplierId/locations/:locationId", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const { supplierId, locationId } = req.params;

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

  if (!location) {
    throw createError(404, "Location not found");
  }

  res.json({ location });
}));

// PATCH /api/suppliers/:supplierId/locations/:locationId - Update location
router.patch("/:supplierId/locations/:locationId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const { supplierId, locationId } = req.params;
  const validated = validateSchema(updateSupplierLocationSchema.strict(), req.body);

  // Verify location exists and belongs to company
  const [existing] = await db
    .select()
    .from(supplierLocations)
    .where(
      and(
        eq(supplierLocations.id, locationId),
        eq(supplierLocations.supplierId, supplierId),
        eq(supplierLocations.companyId, companyId)
      )
    );

  if (!existing) {
    throw createError(404, "Location not found");
  }

  const [location] = await db
    .update(supplierLocations)
    .set({
      ...validated,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(supplierLocations.id, locationId),
        eq(supplierLocations.supplierId, supplierId),
        eq(supplierLocations.companyId, companyId)
      )
    )
    .returning();

  res.json({ location });
}));

// PATCH /api/suppliers/:supplierId/locations/:locationId/primary - Set location as primary
router.patch("/:supplierId/locations/:locationId/primary", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const { supplierId, locationId } = req.params;

  // Verify location exists and belongs to company
  const [existing] = await db
    .select()
    .from(supplierLocations)
    .where(
      and(
        eq(supplierLocations.id, locationId),
        eq(supplierLocations.supplierId, supplierId),
        eq(supplierLocations.companyId, companyId)
      )
    );

  if (!existing) {
    throw createError(404, "Location not found");
  }

  // Use a transaction to ensure atomicity
  await db.transaction(async (tx) => {
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
    await tx
      .update(supplierLocations)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(
        and(
          eq(supplierLocations.id, locationId),
          eq(supplierLocations.supplierId, supplierId),
          eq(supplierLocations.companyId, companyId)
        )
      );
  });

  // Fetch updated location
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

  res.json({ location });
}));

// DELETE /api/suppliers/:supplierId/locations/:locationId - Soft delete location
router.delete("/:supplierId/locations/:locationId", requireRole(MANAGER_ROLES), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const companyId = req.companyId;
  const { supplierId, locationId } = req.params;

  // Verify location exists and belongs to company
  const [existing] = await db
    .select()
    .from(supplierLocations)
    .where(
      and(
        eq(supplierLocations.id, locationId),
        eq(supplierLocations.supplierId, supplierId),
        eq(supplierLocations.companyId, companyId)
      )
    );

  if (!existing) {
    throw createError(404, "Location not found");
  }

  // Prevent deletion of primary location
  if (existing.isPrimary) {
    throw createError(400, "Cannot delete primary location. Set another location as primary first.");
  }

  // Soft delete by setting isActive to false
  await db
    .update(supplierLocations)
    .set({
      isActive: false,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(supplierLocations.id, locationId),
        eq(supplierLocations.supplierId, supplierId),
        eq(supplierLocations.companyId, companyId)
      )
    );

  res.json({ success: true });
}));

export default router;
