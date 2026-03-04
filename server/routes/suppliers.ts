import { Router } from "express";
import type { Response } from "express";
import {
  insertSupplierSchema,
  updateSupplierSchema,
  insertSupplierLocationSchema,
  updateSupplierLocationSchema,
} from "@shared/schema";
import { requireRole } from "../auth/requireRole";
import { MANAGER_ROLES } from "../auth/roles";
import { asyncHandler, createError } from "../middleware/errorHandler";
import { validateSchema } from "../utils/validationHelpers";
import { AuthedRequest } from "../auth/tenantIsolation";
import { supplierRepository } from "../storage/suppliers";
import { normalizeServiceAddress } from "../lib/addressNormalize";

const router = Router();

// ========================================
// SUPPLIER ROUTES
// ========================================

// GET /api/suppliers - List all suppliers with optional search
router.get(
  "/",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const searchQuery = req.query.q as string | undefined;
    const includeLocations = req.query.includeLocations === "true";

    const items = await supplierRepository.listSuppliers(companyId, {
      search: searchQuery,
      includeLocations,
    });

    res.json({
      items,
      total: items.length,
    });
  })
);

// POST /api/suppliers - Create new supplier
router.post(
  "/",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const validated = validateSchema(insertSupplierSchema.strict(), req.body);

    const supplier = await supplierRepository.createSupplier(companyId, validated);

    res.json({ supplier });
  })
);

// GET /api/suppliers/:id - Get single supplier with locations
router.get(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { id } = req.params;

    const result = await supplierRepository.getSupplierWithLocations(companyId, id);
    if (!result) {
      throw createError(404, "Supplier not found");
    }

    res.json(result);
  })
);

// PATCH /api/suppliers/:id - Update supplier
router.patch(
  "/:id",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { id } = req.params;
    const validated = validateSchema(updateSupplierSchema.strict(), req.body);

    const supplier = await supplierRepository.updateSupplier(companyId, id, validated);

    res.json({ supplier });
  })
);

// DELETE /api/suppliers/:id - Soft delete supplier
router.delete(
  "/:id",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { id } = req.params;

    await supplierRepository.deleteSupplier(companyId, id);

    res.json({ success: true });
  })
);

// ========================================
// SUPPLIER LOCATION ROUTES
// ========================================

// GET /api/suppliers/:supplierId/locations - List locations for a supplier
router.get(
  "/:supplierId/locations",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { supplierId } = req.params;
    const includeInactive = req.query.includeInactive === "true";

    const items = await supplierRepository.listSupplierLocations(companyId, supplierId, {
      includeInactive,
    });

    res.json({ items });
  })
);

// POST /api/suppliers/:supplierId/locations - Create new location
router.post(
  "/:supplierId/locations",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { supplierId } = req.params;
    // Phase 3: normalize province variants + postal code before validation
    const validated = validateSchema(insertSupplierLocationSchema.strict(), normalizeServiceAddress(req.body));

    const location = await supplierRepository.createSupplierLocation(
      companyId,
      supplierId,
      validated
    );

    res.json({ location });
  })
);

// GET /api/suppliers/:supplierId/locations/:locationId - Get single location
router.get(
  "/:supplierId/locations/:locationId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { supplierId, locationId } = req.params;

    const location = await supplierRepository.getSupplierLocation(
      companyId,
      supplierId,
      locationId
    );

    if (!location) {
      throw createError(404, "Location not found");
    }

    res.json({ location });
  })
);

// PATCH /api/suppliers/:supplierId/locations/:locationId - Update location
router.patch(
  "/:supplierId/locations/:locationId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { supplierId, locationId } = req.params;
    // Phase 3: normalize province variants + postal code before validation
    const validated = validateSchema(updateSupplierLocationSchema.strict(), normalizeServiceAddress(req.body));

    const location = await supplierRepository.updateSupplierLocation(
      companyId,
      supplierId,
      locationId,
      validated
    );

    res.json({ location });
  })
);

// PATCH /api/suppliers/:supplierId/locations/:locationId/primary - Set location as primary
router.patch(
  "/:supplierId/locations/:locationId/primary",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { supplierId, locationId } = req.params;

    const location = await supplierRepository.setSupplierLocationPrimary(
      companyId,
      supplierId,
      locationId
    );

    res.json({ location });
  })
);

// DELETE /api/suppliers/:supplierId/locations/:locationId - Soft delete location
router.delete(
  "/:supplierId/locations/:locationId",
  requireRole(MANAGER_ROLES),
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const companyId = req.companyId!;
    const { supplierId, locationId } = req.params;

    await supplierRepository.deleteSupplierLocation(companyId, supplierId, locationId);

    res.json({ success: true });
  })
);

export default router;
